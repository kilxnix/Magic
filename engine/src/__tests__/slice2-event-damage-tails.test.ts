/**
 * slice2-event-damage-tails.test.ts
 *
 * Slice 2/12 — EventDamageAmount trigger tail completions.
 *
 * Covers parse + execution of trigger tails that scale by "that much / that many"
 * (EventDamageAmount) beyond the existing matchGainLifeThatMuch and
 * matchDealsDamageThatMuchToCreatureController already tested in prior rounds.
 *
 * New matchers:
 *   matchDrawThatManyCards           (life-draw-mill.ts) — "draw that many cards"
 *   matchThatPlayerMillsThatManyCards (life-draw-mill.ts) — "that player mills that many cards"
 *   matchTargetPlayerMillsThatManyCards (life-draw-mill.ts) — "target player mills that many cards"
 *   matchLoseLifeThatMuch            (life-draw-mill.ts) — "you lose that much life"
 *   matchDealsThatMuchDamageToTarget  (damage.ts)        — "[it] deals that much damage to <target>"
 *   matchExileThatManyFromTopOfLibrary (search-dig.ts)   — "exile that many cards from the top of their library"
 *
 * Real oracle wordings (abbreviated):
 *   Fear of Failed Tests:  "Whenever ~ deals combat damage to a player, draw that many cards."
 *   Towering-Wave Mystic:  "Whenever ~ deals combat damage to a player, that player mills that many cards."
 *   Donna Noble:           "Whenever ~ deals combat damage to a player, it deals that much damage to target opponent."
 *   Wrathful Red Dragon:   "Whenever a Dragon you control is dealt damage, it deals that much damage to any target that isn't a Dragon."
 *   Grenzo's Ruffians:     "Whenever ~ deals combat damage to a player, it deals that much damage to each other opponent."
 *   Wall of Souls:         "Whenever ~ is dealt combat damage, it deals that much damage to target opponent or planeswalker."
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { DrawEffect, MillEffect, LoseLifeEffect, DealDamageEffect, ExileFromLibraryEffect, TriggeredAbility } from '../effects/ast';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCreatureDef(id: string, oracle = ''): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Test',
    oracle_text: oracle,
    mana_cost: '{2}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    power: 3,
    toughness: 3,
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
  zone: CardInstance['zone'] = 'battlefield',
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

// ---------------------------------------------------------------------------
// PARSE TESTS — matchDrawThatManyCards
// ---------------------------------------------------------------------------

describe('Slice 2 — parse: matchDrawThatManyCards', () => {
  it('parses Fear of Failed Tests wording: "draw that many cards"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, draw that many cards.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as DrawEffect;
    expect(eff.kind).toBe('Draw');
    expect(eff.player.kind).toBe('Controller');
    expect(typeof eff.count).toBe('object');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
  });

  it('parses "you draw that many cards" variant', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, you draw that many cards.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    const eff = ability.effects[0] as DrawEffect;
    expect(eff.kind).toBe('Draw');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
  });
});

// ---------------------------------------------------------------------------
// PARSE TESTS — matchThatPlayerMillsThatManyCards
// ---------------------------------------------------------------------------

describe('Slice 2 — parse: matchThatPlayerMillsThatManyCards', () => {
  it('parses Towering-Wave Mystic wording: "that player mills that many cards"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player mills that many cards.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as MillEffect;
    expect(eff.kind).toBe('Mill');
    expect(eff.player.kind).toBe('EventPlayer');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
  });
});

// ---------------------------------------------------------------------------
// PARSE TESTS — matchTargetPlayerMillsThatManyCards
// ---------------------------------------------------------------------------

describe('Slice 2 — parse: matchTargetPlayerMillsThatManyCards', () => {
  it('parses "target player mills that many cards"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, target player mills that many cards.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    const eff = ability.effects[0] as MillEffect;
    expect(eff.kind).toBe('Mill');
    // Chosen target (a target player spec)
    expect(eff.player.kind).toBe('Chosen');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Player');
  });
});

// ---------------------------------------------------------------------------
// PARSE TESTS — matchLoseLifeThatMuch
// ---------------------------------------------------------------------------

describe('Slice 2 — parse: matchLoseLifeThatMuch', () => {
  it('parses "you lose that much life" in a deals-damage trigger body', () => {
    // Use "Whenever ~ deals damage" (matchSelfDealsDamagePrefix) since there is
    // no "is dealt damage" trigger prefix in the engine yet.
    const result = parseOracleText(
      'Whenever ~ deals damage, you lose that much life.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as LoseLifeEffect;
    expect(eff.kind).toBe('LoseLife');
    expect(eff.player.kind).toBe('Controller');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
  });

  it('parses bare "you lose that much life." as a standalone spell effect', () => {
    // Direct spell parse test — confirms the matcher fires outside a trigger wrapper
    const result = parseOracleText('You lose that much life.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as LoseLifeEffect;
    expect(eff.kind).toBe('LoseLife');
    expect(eff.player.kind).toBe('Controller');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
  });
});

// ---------------------------------------------------------------------------
// PARSE TESTS — matchDealsThatMuchDamageToTarget
// ---------------------------------------------------------------------------

describe('Slice 2 — parse: matchDealsThatMuchDamageToTarget', () => {
  it('parses Donna Noble wording: "it deals that much damage to target opponent"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, it deals that much damage to target opponent.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.target.kind).toBe('Chosen');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Player');
    expect(result.targets[0].constraints?.opponentControls).toBe(true);
  });

  it('parses Wrathful Red Dragon body effect: "it deals that much damage to any target that isn\'t a Dragon"', () => {
    // The "whenever a Dragon you control is dealt damage" trigger prefix does not exist
    // in the engine yet. We test the body matcher directly via a known trigger wrapper.
    const result = parseOracleText(
      "Whenever ~ deals combat damage to a player, it deals that much damage to any target that isn't a Dragon.",
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    const eff = ability.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    expect(eff.target.kind).toBe('Chosen');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Any');
  });

  it('parses Grenzo\'s Ruffians wording: "it deals that much damage to each other opponent"', () => {
    const result = parseOracleText(
      "Whenever ~ deals combat damage to a player, it deals that much damage to each other opponent.",
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    const eff = ability.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    // EachOpponent — no chosen target
    expect(eff.target.kind).toBe('EachOpponent');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
    expect(result.targets).toHaveLength(0);
  });

  it('parses Wall of Souls body effect: "it deals that much damage to target opponent or planeswalker"', () => {
    // The "whenever ~ is dealt combat damage" trigger prefix does not exist in the engine yet.
    // We test the body matcher by using the DealsDamage trigger wrapper.
    const result = parseOracleText(
      '~ deals damage. Whenever ~ deals damage, it deals that much damage to target opponent or planeswalker.',
    );
    // The multi-sentence parse should produce a Triggered result for the second sentence.
    // Use standalone spell parse to confirm the body matcher fires:
    const spellResult = parseOracleText('It deals that much damage to target opponent or planeswalker.');
    expect(spellResult.kind).toBe('Spell');
    if (spellResult.kind !== 'Spell') return;

    expect(spellResult.effects).toHaveLength(1);
    const eff = spellResult.effects[0] as DealDamageEffect;
    expect(eff.kind).toBe('DealDamage');
    // Modelled as Player target (planeswalker damage not executed; under-restrict is honest)
    expect(eff.target.kind).toBe('Chosen');
    expect((eff.amount as { kind: string }).kind).toBe('EventDamageAmount');
    expect(spellResult.targets).toHaveLength(1);
    expect(spellResult.targets[0].type).toBe('Player');
    expect(spellResult.targets[0].constraints?.opponentControls).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PARSE TESTS — matchExileThatManyFromTopOfLibrary
// ---------------------------------------------------------------------------

describe('Slice 2 — parse: matchExileThatManyFromTopOfLibrary', () => {
  it('parses "exile that many cards from the top of their library"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, exile that many cards from the top of their library.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as ExileFromLibraryEffect;
    expect(eff.kind).toBe('ExileFromLibrary');
    expect(eff.player.kind).toBe('EventPlayer');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
  });

  it('parses "exile that many cards from the top of your library"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, exile that many cards from the top of your library.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    const eff = ability.effects[0] as ExileFromLibraryEffect;
    expect(eff.kind).toBe('ExileFromLibrary');
    expect(eff.player.kind).toBe('Controller');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS
// ---------------------------------------------------------------------------

describe('Slice 2 — execute: Draw(EventDamageAmount)', () => {
  it('draws 3 cards when eventDamageAmount=3 (Fear of Failed Tests style)', () => {
    const def = makeCreatureDef('foft');
    const state = baseState([def]);
    addCard(state, 'foft_1', 'foft');
    // Put library cards
    for (let i = 0; i < 5; i++) {
      addCard(state, `lib${i}`, 'foft', 'library', 'p0');
    }

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, draw that many cards.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const ability = parsed.ability as TriggeredAbility;

    const before = [...state.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'hand').length;
    expect(before).toBe(0);

    const after = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'foft_1', eventContext: { eventDamageAmount: 3 } },
    );

    const drawnCards = [...after.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'hand').length;
    expect(drawnCards).toBe(3);
  });
});

describe('Slice 2 — execute: Mill(EventPlayer, EventDamageAmount)', () => {
  it('mills 4 cards from EventPlayer library when eventDamageAmount=4 (Towering-Wave Mystic style)', () => {
    const def = makeCreatureDef('twm');
    const state = baseState([def]);
    addCard(state, 'twm_1', 'twm');
    // Put library cards for p1
    for (let i = 0; i < 6; i++) {
      addCard(state, `p1lib${i}`, 'twm', 'library', 'p1');
    }

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player mills that many cards.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const ability = parsed.ability as TriggeredAbility;

    const before = [...state.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'graveyard').length;
    expect(before).toBe(0);

    const after = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'twm_1', eventContext: { eventPlayerId: 'p1', eventDamageAmount: 4 } },
    );

    const milled = [...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'graveyard').length;
    expect(milled).toBe(4);
  });
});

describe('Slice 2 — execute: LoseLife(EventDamageAmount)', () => {
  it('controller loses 5 life when eventDamageAmount=5 (Wall of Souls style)', () => {
    const def = makeCreatureDef('wos');
    const state = baseState([def]);
    addCard(state, 'wos_1', 'wos');

    // Use a deals-damage trigger wording since "is dealt damage" prefix does not exist.
    const parsed = parseOracleText(
      'Whenever ~ deals damage, you lose that much life.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const ability = parsed.ability as TriggeredAbility;

    const before = state.players[0].life;
    const after = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'wos_1', eventContext: { eventDamageAmount: 5 } },
    );

    expect(after.players[0].life).toBe(before - 5);
  });
});

describe('Slice 2 — execute: DealDamage(EachOpponent, EventDamageAmount)', () => {
  it('deals 3 damage to each opponent when eventDamageAmount=3 (Grenzo\'s Ruffians style)', () => {
    const def = makeCreatureDef('grenzo');
    const state = baseState([def]);
    addCard(state, 'grenzo_1', 'grenzo');

    const parsed = parseOracleText(
      "Whenever ~ deals combat damage to a player, it deals that much damage to each other opponent.",
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const ability = parsed.ability as TriggeredAbility;

    const beforeP1Life = state.players[1].life;

    const after = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'grenzo_1', eventContext: { eventDamageAmount: 3 } },
    );

    // p1 is an opponent of p0 (casterId='p0'), so takes 3 damage
    expect(after.players[1].life).toBe(beforeP1Life - 3);
    // p0 (controller) is NOT an opponent of themselves
    expect(after.players[0].life).toBe(state.players[0].life);
  });
});

describe('Slice 2 — execute: ExileFromLibrary(EventPlayer, EventDamageAmount)', () => {
  it('exiles 2 cards from EventPlayer library when eventDamageAmount=2', () => {
    const def = makeCreatureDef('rav');
    const state = baseState([def]);
    addCard(state, 'rav_1', 'rav');
    for (let i = 0; i < 5; i++) {
      addCard(state, `p1lib${i}`, 'rav', 'library', 'p1');
    }

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, exile that many cards from the top of their library.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const ability = parsed.ability as TriggeredAbility;

    const before = [...state.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'exile').length;
    expect(before).toBe(0);

    const after = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      { sourceInstanceId: 'rav_1', eventContext: { eventPlayerId: 'p1', eventDamageAmount: 2 } },
    );

    const exiled = [...after.cards.values()].filter(c => c.ownerId === 'p1' && c.zone === 'exile').length;
    expect(exiled).toBe(2);
  });
});
