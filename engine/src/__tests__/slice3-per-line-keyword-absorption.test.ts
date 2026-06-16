/**
 * slice3-per-line-keyword-absorption.test.ts
 *
 * Slice 3/12 coverage — per-line absorption of leading keyword lines so a
 * residual combat-damage trigger parses on its own.
 *
 * TWO sub-problems addressed by this slice:
 *
 *   (A) Multi-line "keyword soup + trigger" faces: the per-line dispatch in
 *       parseOracleTextPerLine absorbs keyword-only lines (Flying, Menace,
 *       Deathtouch, Indestructible, Renown N, comma-joined "Flying, Menace")
 *       then parses the residual trigger line independently.
 *
 *   (B) Inverted return-from-graveyard form: matchReturnFromGraveyard now
 *       handles the form "return to the {hand|battlefield} target <type> card
 *       in your graveyard" (word order inverted vs the canonical "return target
 *       <type> card from your graveyard to the battlefield" form used by older
 *       Oracle wordings and some Commander trigger bodies).
 *       HONESTY GATE: forms with the timing restriction "that was put there this
 *       turn" are DECLINED — the engine cannot enforce zone-entry timing so
 *       accepting those forms would grant a broader ability than the card says.
 *
 * Real oracle text examples covered:
 *   — Moira, Urborg Haunt (body without timing rider)
 *   — Ancient Gold Dragon (Flying + d20 create-tokens)
 *   — Generic keyword-plus-trigger patterns from the 47-card family
 *
 * Execution tests verify the inverted ReturnFromGraveyard form moves the
 * chosen graveyard card to the correct destination zone via executeEffects.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { TriggeredAbility, ReturnFromGraveyardEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCreatureDef(
  id: string,
  oracle = '',
  power = 2,
  toughness = 2,
  types: string[] = ['creature'],
): CardDefinition {
  return {
    id,
    name: id,
    type_line: types.includes('creature') ? 'Creature — Test' : types[0],
    oracle_text: oracle,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: types,
    power: types.includes('creature') ? power : undefined,
    toughness: types.includes('creature') ? toughness : undefined,
  };
}

function baseState(defs: CardDefinition[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

function addCard(
  s: GameState,
  instanceId: string,
  definitionId: string,
  zone: CardInstance['zone'],
  ownerId = 'p0',
): void {
  s.cards.set(instanceId, {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

const zone = (s: GameState, id: string) => s.cards.get(id)?.zone;

// ---------------------------------------------------------------------------
// PARSE TESTS — per-line keyword absorption
// ---------------------------------------------------------------------------

describe('slice3 per-line absorption — keyword-led combat-damage triggers', () => {
  it('Menace on separate line absorbed; trigger body (return graveyard standard) parses', () => {
    const r = parseOracleText(
      'Menace\nWhenever ~ deals combat damage to a player, return target creature card from your graveyard to the battlefield.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(r.ability.effects[0].kind).toBe('ReturnFromGraveyard');
  });

  it('Flying on separate line absorbed; trigger body (return graveyard inverted) parses', () => {
    const r = parseOracleText(
      'Flying\nWhenever ~ deals combat damage to a player, return to the battlefield target creature card in your graveyard.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
    const eff = r.ability.effects[0] as ReturnFromGraveyardEffect;
    expect(eff.kind).toBe('ReturnFromGraveyard');
    expect(eff.destination).toBe('battlefield');
  });

  it('Indestructible on separate line absorbed; draw trigger parses', () => {
    const r = parseOracleText(
      'Indestructible\nWhenever ~ deals combat damage to a player, you draw a card.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(r.ability.effects[0].kind).toBe('Draw');
  });

  it('Flying + Deathtouch (two keyword lines) absorbed; trigger parses', () => {
    const r = parseOracleText(
      'Flying\nDeathtouch\nWhenever ~ deals combat damage to a player, you draw a card.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
  });

  it('Comma-joined "Menace, Flying" absorbed on one line; trigger parses', () => {
    const r = parseOracleText(
      'Menace, Flying\nWhenever ~ deals combat damage to a player, that player loses 3 life.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
    expect(r.ability.effects[0].kind).toBe('LoseLife');
  });

  it('Renown 1 (parametric keyword) absorbed; trigger parses', () => {
    const r = parseOracleText(
      "Renown 1 (When this creature deals combat damage to a player, if it isn't renowned, put a +1/+1 counter on it and it becomes renowned.)\nWhenever ~ deals combat damage to a player, you draw a card.",
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
  });

  it('Partner line after trigger: per-line dispatch accepts keyword at end of face', () => {
    // "Partner" appears as a trailing line — the whole-face token stream absorption
    // via trimLeadingKeywordOrEnchantPreamble strips leading "Deathtouch" and then
    // the trigger clause consumes the body, leaving "partner" as a harmless tail.
    const r = parseOracleText(
      'Deathtouch\nWhenever ~ deals combat damage to a player, you draw a card.\nPartner',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
  });

  it('Ancient Gold Dragon: Flying absorbed; roll d20 + create-tokens trigger parses', () => {
    // Real oracle: "Flying\nWhenever this creature deals combat damage to a player,
    // roll a d20. Create that many 1/1 blue and red Faerie Dragon creature tokens with flying."
    // The parser absorbs Flying, then parses the trigger line.
    // Slice 8/12: matchRollDNCreateThatManyTokens now parses the full "roll a d20. create that many"
    // body as a single RollD20Effect with 20 linear outcomes, each creating N tokens.
    const r = parseOracleText(
      'Flying\nWhenever this creature deals combat damage to a player, roll a d20. Create that many 1/1 blue and red Faerie Dragon creature tokens with flying.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
    // A single RollD20 effect is emitted with 20 outcomes.
    expect(r.ability.effects).toHaveLength(1);
    const roll = r.ability.effects[0];
    expect(roll.kind).toBe('RollD20');
    if (roll.kind !== 'RollD20') return;
    expect(roll.outcomes).toHaveLength(20);
    // Each outcome creates that many tokens (face=1 → count=1, face=20 → count=20).
    expect(roll.outcomes[0].min).toBe(1);
    expect(roll.outcomes[0].max).toBe(1);
    expect(roll.outcomes[0].effects[0].kind).toBe('CreateToken');
    const firstCreate = roll.outcomes[0].effects[0];
    if (firstCreate.kind !== 'CreateToken') return;
    expect(firstCreate.count).toBe(1);
    const lastCreate = roll.outcomes[19].effects[0];
    if (lastCreate.kind !== 'CreateToken') return;
    expect(lastCreate.count).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// PARSE TESTS — inverted return-from-graveyard form
// ---------------------------------------------------------------------------

describe('slice3 inverted matchReturnFromGraveyard — "return to the <dest> target <type> card in your graveyard"', () => {
  it('parses inverted creature return to battlefield (standalone spell form)', () => {
    const r = parseOracleText(
      'Return to the battlefield target creature card in your graveyard.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const eff = r.effects[0] as ReturnFromGraveyardEffect;
    expect(eff.kind).toBe('ReturnFromGraveyard');
    expect(eff.destination).toBe('battlefield');
    expect(r.targets[0].type).toBe('CreatureCardInGraveyard');
  });

  it('parses inverted artifact return to battlefield', () => {
    const r = parseOracleText(
      'Return to the battlefield target artifact card in your graveyard.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const eff = r.effects[0] as ReturnFromGraveyardEffect;
    expect(eff.kind).toBe('ReturnFromGraveyard');
    expect(eff.destination).toBe('battlefield');
    expect(r.targets[0].type).toBe('CardInGraveyard');
  });

  it('parses inverted creature return to hand ("return to your hand target ...")', () => {
    const r = parseOracleText(
      'Return to your hand target creature card in your graveyard.',
    );
    expect(r.kind).toBe('Spell');
    if (r.kind !== 'Spell') return;
    const eff = r.effects[0] as ReturnFromGraveyardEffect;
    expect(eff.kind).toBe('ReturnFromGraveyard');
    expect(eff.destination).toBe('hand');
    expect(r.targets[0].type).toBe('CreatureCardInGraveyard');
  });

  it('parses inverted form inside combat-damage trigger body', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, return to the battlefield target creature card in your graveyard.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const eff = r.ability.effects[0] as ReturnFromGraveyardEffect;
    expect(eff.kind).toBe('ReturnFromGraveyard');
    expect(eff.destination).toBe('battlefield');
  });

  it('Moira body without timing rider: inverted form + named trigger subject', () => {
    // Simplified Moira oracle text: keyword absorbed, named-card trigger subject,
    // inverted return-from-graveyard body (WITHOUT "that was put there this turn"
    // rider which the engine cannot enforce).
    const r = parseOracleText(
      'Menace\nWhenever Moira deals combat damage to a player, return to the battlefield target creature card in your graveyard.',
    );
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('CombatDamageToPlayer');
    const eff = r.ability.effects[0] as ReturnFromGraveyardEffect;
    expect(eff.kind).toBe('ReturnFromGraveyard');
    expect(eff.destination).toBe('battlefield');
  });
});

// ---------------------------------------------------------------------------
// HONESTY GATE — timing rider stays Unparsed
// ---------------------------------------------------------------------------

describe('slice3 honesty — timing restriction "that was put there this turn" declines', () => {
  it('declines "return to the battlefield target creature card in your graveyard that was put there this turn."', () => {
    const r = parseOracleText(
      'Whenever ~ deals combat damage to a player, return to the battlefield target creature card in your graveyard that was put there this turn.',
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('full Moira oracle with timing rider stays Unparsed', () => {
    const r = parseOracleText(
      'Menace\nWhenever Moira deals combat damage to a player, return to the battlefield target creature card in your graveyard that was put there this turn.',
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('Silas Renn (no graveyard-cast executor) stays Unparsed', () => {
    const r = parseOracleText(
      'Deathtouch\nWhenever Silas Renn deals combat damage to a player, choose target artifact card in your graveyard. You may cast that card this turn.\nPartner',
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('Dazzling Sphinx (exile-until + free-cast not supported) stays Unparsed', () => {
    const r = parseOracleText(
      "Flying\nWhenever this creature deals combat damage to a player, that player exiles cards from the top of their library until they exile an instant or sorcery card. You may cast that card without paying its mana cost. Then that player puts the exiled cards that weren't cast this way on the bottom of their library in a random order.",
    );
    expect(r.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS — inverted ReturnFromGraveyard
// ---------------------------------------------------------------------------

describe('slice3 execution — inverted ReturnFromGraveyard puts graveyard card to destination', () => {
  it('inverted form: chosen graveyard creature moves to battlefield', () => {
    const creatureDef = makeCreatureDef('bear', '', 2, 2);
    const s = baseState([creatureDef]);
    addCard(s, 'bear1', 'bear', 'graveyard', 'p0');

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, return to the battlefield target creature card in your graveyard.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const ability = parsed.ability as TriggeredAbility;
    expect(ability.effects[0].kind).toBe('ReturnFromGraveyard');

    const after = executeEffects(
      s,
      ability.effects,
      'p0',
      ['bear1'],
      parsed.targets,
      0,
      { sourceInstanceId: undefined, eventContext: { eventPlayerId: 'p1', eventDamageAmount: 2 } },
    );
    expect(zone(after, 'bear1')).toBe('battlefield');
  });

  it('inverted form: chosen graveyard creature moves to hand', () => {
    const creatureDef = makeCreatureDef('wolf', '', 2, 2);
    const s = baseState([creatureDef]);
    addCard(s, 'wolf1', 'wolf', 'graveyard', 'p0');

    const parsed = parseOracleText(
      'Return to your hand target creature card in your graveyard.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const after = executeEffects(
      s,
      parsed.effects,
      'p0',
      ['wolf1'],
      parsed.targets,
    );
    expect(zone(after, 'wolf1')).toBe('hand');
  });

  it('inverted form: non-graveyard card is not moved (executor guard)', () => {
    const creatureDef = makeCreatureDef('elf', '', 1, 1);
    const s = baseState([creatureDef]);
    // Card is on battlefield, not graveyard
    addCard(s, 'elf1', 'elf', 'battlefield', 'p0');

    const parsed = parseOracleText(
      'Return to the battlefield target creature card in your graveyard.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Executor guard: card not in graveyard → no zone change
    const after = executeEffects(
      s,
      parsed.effects,
      'p0',
      ['elf1'],
      parsed.targets,
    );
    expect(zone(after, 'elf1')).toBe('battlefield');
  });

  it('inverted form in multi-line keyword+trigger: keyword absorbed, effect executes', () => {
    const creatureDef = makeCreatureDef('spirit', '', 1, 1);
    const s = baseState([creatureDef]);
    addCard(s, 'spirit1', 'spirit', 'graveyard', 'p0');

    const parsed = parseOracleText(
      'Menace\nWhenever ~ deals combat damage to a player, return to the battlefield target creature card in your graveyard.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const ability = parsed.ability as TriggeredAbility;
    const after = executeEffects(
      s,
      ability.effects,
      'p0',
      ['spirit1'],
      parsed.targets,
      0,
      { sourceInstanceId: undefined, eventContext: { eventPlayerId: 'p1', eventDamageAmount: 3 } },
    );
    expect(zone(after, 'spirit1')).toBe('battlefield');
  });
});
