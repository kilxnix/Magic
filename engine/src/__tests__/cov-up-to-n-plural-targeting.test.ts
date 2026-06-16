/**
 * cov-up-to-n-plural-targeting — Slice 1/12
 *
 * Parse and execute tests for "up to N target <plurals>" generalisation:
 *   - return up to N [other] target nonland permanents / creatures to their owners' hands
 *   - untap up to N target creatures
 *   - up to N target creatures can't block/attack this turn  (multi-target combat restriction)
 *   - it fights up to one target creature you don't control  (ETB optional fight)
 *   - return up to N target creature cards each with mana value N or less from graveyard
 *
 * Uses real oracle-wording fragments from the slice examples.
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  resolveTopOfStack,
  putTriggersOnStack,
  createETBTriggers,
  registerBattlefieldAbilities,
} from '../stack';
import type { CardDefinition, GameState, CardInstance } from '../types';
import type { Effect } from '../effects/ast';
import type { TargetSpec } from '../effects/targets';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AnyObj = Record<string, any>;

function firstEffect(text: string): AnyObj {
  const res = parseOracleText(text) as AnyObj;
  const effects: AnyObj[] = res.effects ?? res.ability?.effects ?? [];
  expect(effects.length).toBeGreaterThan(0);
  return effects[0];
}

function makeCreature(
  id: string,
  name: string,
  oracleText: string,
  pt: { power: number; toughness: number } = { power: 2, toughness: 2 },
): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature - Test',
    oracle_text: oracleText,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    power: pt.power,
    toughness: pt.toughness,
    card_types: ['creature'],
  };
}

function makeEnchantment(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: '',
    mana_cost: '{1}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function makeLand(id: string, name: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land - Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-2' },
  ]);
}

function moveToBattlefield(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone: 'battlefield', summoningSick: false });
  return { ...state, cards: newCards };
}

function findCard(state: GameState, defId: string): CardInstance {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  throw new Error(`Card not found for def: ${defId}`);
}

// ---------------------------------------------------------------------------
// PARSING — return up to N target nonland permanents to their owners' hands
// ---------------------------------------------------------------------------

describe('Slice 1 — return up to N target nonland permanents (plural bounce)', () => {
  it('parses "return up to two target nonland permanents to their owners\' hands" as spell', () => {
    const res = parseOracleText(
      "Return up to two target nonland permanents to their owners' hands.",
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects).toHaveLength(1);
    const eff = res.effects[0] as Extract<Effect, { kind: 'ReturnToHand' }>;
    expect(eff.kind).toBe('ReturnToHand');
    expect(eff.target.kind).toBe('Chosen');
    expect(res.targets).toHaveLength(1);
    const spec = res.targets[0] as TargetSpec;
    expect(spec.type).toBe('NonlandPermanent');
    expect(spec.count).toBe(2);
  });

  it('parses Marang River Regent ETB: "return up to two other target nonland permanents"', () => {
    // Real oracle text (ETB trigger body portion)
    const res = parseOracleText(
      "When this creature enters, return up to two other target nonland permanents to their owners' hands.",
    ) as AnyObj;
    expect(res.kind).toBe('ETB');
    const ability = res.ability;
    expect(ability.effects).toHaveLength(1);
    expect(ability.effects[0].kind).toBe('ReturnToHand');
    expect(res.targets).toHaveLength(1);
    const spec = res.targets[0] as TargetSpec;
    expect(spec.type).toBe('NonlandPermanent');
    expect(spec.count).toBe(2);
    expect(spec.constraints?.notSource).toBe(true);
  });

  it('parses "return up to three target creatures to their owners\' hands"', () => {
    const res = parseOracleText(
      "Return up to three target creatures to their owners' hands.",
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    const eff = res.effects[0] as Extract<Effect, { kind: 'ReturnToHand' }>;
    expect(eff.kind).toBe('ReturnToHand');
    const spec = res.targets[0] as TargetSpec;
    expect(spec.type).toBe('Creature');
    expect(spec.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PARSING — untap up to N target creatures
// ---------------------------------------------------------------------------

describe('Slice 1 — untap up to N target creatures', () => {
  it('parses "untap up to two target creatures" as Untap multi-target', () => {
    const res = parseOracleText('Untap up to two target creatures.') as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects).toHaveLength(1);
    const eff = res.effects[0] as Extract<Effect, { kind: 'Untap' }>;
    expect(eff.kind).toBe('Untap');
    expect(eff.target.kind).toBe('Chosen');
    expect(res.targets).toHaveLength(1);
    const spec = res.targets[0] as TargetSpec;
    expect(spec.type).toBe('Creature');
    expect(spec.count).toBe(2);
  });

  it('parses "untap up to three target permanents" as Untap multi-target', () => {
    const res = parseOracleText('Untap up to three target permanents.') as AnyObj;
    expect(res.kind).toBe('Spell');
    const spec = res.targets[0] as TargetSpec;
    expect(spec.type).toBe('Permanent');
    expect(spec.count).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// PARSING — up to N target creatures can't block this turn
// ---------------------------------------------------------------------------

describe('Slice 1 — up to N target creatures can\'t block/attack (multi combat restriction)', () => {
  it('parses Unearthly Blizzard: "up to three target creatures can\'t block this turn"', () => {
    const res = parseOracleText(
      "Up to three target creatures can't block this turn.",
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects.length).toBeGreaterThan(0);
    const eff = res.effects[0] as Extract<Effect, { kind: 'GrantKeyword' }>;
    expect(eff.kind).toBe('GrantKeyword');
    expect(eff.keyword).toBe('CannotBlock');
    expect(eff.target.kind).toBe('Chosen');
    const spec = res.targets[0] as TargetSpec;
    expect(spec.type).toBe('Creature');
    expect(spec.count).toBe(3);
    expect(spec.count).toBeGreaterThanOrEqual(2);
  });

  it('parses "up to two target creatures can\'t attack this turn"', () => {
    const res = parseOracleText(
      "Up to two target creatures can't attack this turn.",
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    const eff = res.effects[0] as Extract<Effect, { kind: 'GrantKeyword' }>;
    expect(eff.kind).toBe('GrantKeyword');
    expect(eff.keyword).toBe('CannotAttack');
    const spec = res.targets[0] as TargetSpec;
    expect(spec.count).toBe(2);
  });

  it('parses "up to two target creatures can\'t attack or block this turn" — emits two effects', () => {
    const res = parseOracleText(
      "Up to two target creatures can't attack or block this turn.",
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    // Should emit two GrantKeyword effects (CannotAttack + CannotBlock) on the same target spec
    const gk = res.effects.filter((e: AnyObj) => e.kind === 'GrantKeyword');
    expect(gk.length).toBe(2);
    const keywords = gk.map((e: AnyObj) => e.keyword);
    expect(keywords).toContain('CannotAttack');
    expect(keywords).toContain('CannotBlock');
  });
});

// ---------------------------------------------------------------------------
// PARSING — it fights up to one target creature (ETB fight)
// ---------------------------------------------------------------------------

describe('Slice 1 — "it fights up to one target creature" ETB optional fight', () => {
  it('parses Pheres-Band Brawler ETB: "it fights up to one target creature you don\'t control"', () => {
    const res = parseOracleText(
      "When this creature enters, it fights up to one target creature you don't control.",
    ) as AnyObj;
    expect(res.kind).toBe('ETB');
    const ability = res.ability;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as Extract<Effect, { kind: 'Fight' }>;
    expect(eff.kind).toBe('Fight');
    expect(eff.fighterA.kind).toBe('Source');
    expect(eff.fighterB.kind).toBe('Chosen');
    expect(res.targets).toHaveLength(1);
    const spec = res.targets[0] as TargetSpec;
    expect(spec.type).toBe('Creature');
    expect(spec.count).toBe(1);
    expect(spec.minCount).toBe(0);
    expect(spec.constraints?.opponentControls).toBe(true);
  });

  it('parses "it fights up to one target creature an opponent controls"', () => {
    const res = parseOracleText(
      "When this creature enters, it fights up to one target creature an opponent controls.",
    ) as AnyObj;
    expect(res.kind).toBe('ETB');
    const spec = res.targets[0] as TargetSpec;
    expect(spec.constraints?.opponentControls).toBe(true);
    expect(spec.minCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PARSING — return up to N target creature cards each with mana value from GY
// ---------------------------------------------------------------------------

describe('Slice 1 — return up to N target creature cards each with mana value from graveyard', () => {
  it('parses Dewdrop Cure: "return up to two target creature cards each with mana value 2 or less from your graveyard to the battlefield"', () => {
    const res = parseOracleText(
      "Return up to two target creature cards each with mana value 2 or less from your graveyard to the battlefield.",
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects).toHaveLength(1);
    const eff = res.effects[0] as Extract<Effect, { kind: 'ReturnFromGraveyard' }>;
    expect(eff.kind).toBe('ReturnFromGraveyard');
    expect(eff.destination).toBe('battlefield');
    const spec = res.targets[0] as TargetSpec;
    expect(spec.type).toBe('CreatureCardInGraveyard');
    expect(spec.count).toBe(2);
    // mana value constraint applied
    expect(spec.constraints?.cmc).toMatchObject({ op: 'lte', value: 2 });
  });
});

// ---------------------------------------------------------------------------
// EXECUTION — return up to N target nonland permanents
// ---------------------------------------------------------------------------

describe('Slice 1 execution — return up to N target nonland permanents', () => {
  it('resolves ETB trigger returning 2 chosen nonland permanents to hand', () => {
    const bouncer = makeCreature(
      'bouncer',
      'Multi-Bouncer',
      "When this creature enters, return up to two other target nonland permanents to their owners' hands.",
    );
    const enchA = makeEnchantment('ench-a', 'Enchantment A');
    const enchB = makeEnchantment('ench-b', 'Enchantment B');

    let state = createTestGame([bouncer, enchA, enchB, makeLand('forest', 'Forest')], []);

    const bouncerInst = findCard(state, 'bouncer');
    const enchAInst = findCard(state, 'ench-a');
    const enchBInst = findCard(state, 'ench-b');

    state = moveToBattlefield(state, bouncerInst.instanceId);
    state = moveToBattlefield(state, enchAInst.instanceId);
    state = moveToBattlefield(state, enchBInst.instanceId);

    state = registerBattlefieldAbilities(state, bouncerInst.instanceId);
    state = createETBTriggers(state, bouncerInst.instanceId);

    expect(state.pendingTriggers).toHaveLength(1);
    const trigger = state.pendingTriggers[0];
    expect(trigger.requiredTargets).toHaveLength(1);
    expect((trigger.requiredTargets[0] as TargetSpec).count).toBe(2);

    const triggerId = trigger.id;
    state = putTriggersOnStack(state, {
      [triggerId]: [enchAInst.instanceId, enchBInst.instanceId],
    });
    state = resolveTopOfStack(state);

    expect(state.cards.get(enchAInst.instanceId)!.zone).toBe('hand');
    expect(state.cards.get(enchBInst.instanceId)!.zone).toBe('hand');
    expect(state.cards.get(bouncerInst.instanceId)!.zone).toBe('battlefield');
  });
});

// ---------------------------------------------------------------------------
// EXECUTION — it fights up to one target (ETB optional fight)
// ---------------------------------------------------------------------------

describe('Slice 1 execution — "it fights up to one target creature" ETB fight', () => {
  it('fights the target creature when a target is chosen', () => {
    const brawler = makeCreature(
      'pheres-band-brawler',
      'Pheres-Band Brawler',
      "When this creature enters, it fights up to one target creature you don't control.",
      { power: 4, toughness: 4 },
    );
    const prey = makeCreature(
      'prey',
      'Prey Creature',
      '',
      { power: 1, toughness: 1 },
    );

    let state = createTestGame(
      [brawler, makeLand('forest', 'Forest')],
      [prey, makeLand('swamp', 'Swamp')],
    );

    const brawlerInst = findCard(state, 'pheres-band-brawler');
    const preyInst = findCard(state, 'prey');

    state = moveToBattlefield(state, brawlerInst.instanceId);
    state = moveToBattlefield(state, preyInst.instanceId);

    state = registerBattlefieldAbilities(state, brawlerInst.instanceId);
    state = createETBTriggers(state, brawlerInst.instanceId);

    expect(state.pendingTriggers).toHaveLength(1);
    const triggerId = state.pendingTriggers[0].id;

    // Choose the prey as the fight target
    state = putTriggersOnStack(state, { [triggerId]: [preyInst.instanceId] });
    state = resolveTopOfStack(state);

    // Prey (1/1) took 4 damage from brawler, should be dead
    // Brawler (4/4) took 1 damage from prey, still alive
    expect(state.cards.get(preyInst.instanceId)!.zone).toBe('graveyard');
    expect(state.cards.get(brawlerInst.instanceId)!.zone).toBe('battlefield');
  });
});

// ---------------------------------------------------------------------------
// REGRESSION — existing single-target patterns still parse
// ---------------------------------------------------------------------------

describe('Slice 1 regression — existing patterns not broken', () => {
  it('"tap up to two target creatures" still parses (matchMultiTarget)', () => {
    const res = parseOracleText('Tap up to two target creatures.') as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects[0].kind).toBe('Tap');
    expect(res.targets[0].count).toBe(2);
  });

  it('"destroy up to two target creatures" still parses', () => {
    const res = parseOracleText('Destroy up to two target creatures.') as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects[0].kind).toBe('Destroy');
  });

  it('"target creature can\'t block this turn" (singular) still parses via matchTargetCombatRestriction', () => {
    const res = parseOracleText("Target creature can't block this turn.") as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects[0].kind).toBe('GrantKeyword');
    expect(res.effects[0].keyword).toBe('CannotBlock');
    // single target, no multi-target count
    expect(res.targets[0].count).toBe(1);
    expect(res.targets[0].count).not.toBeGreaterThan(1);
  });

  it('"target creature you control fights target creature you don\'t control" still parses (matchFight)', () => {
    const res = parseOracleText(
      "Target creature you control fights target creature you don't control.",
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects[0].kind).toBe('Fight');
    expect(res.targets).toHaveLength(2);
  });

  it('"return up to two target creature cards from your graveyard to your hand" still parses (matchReturnFromGraveyard)', () => {
    const res = parseOracleText(
      'Return up to two target creature cards from your graveyard to your hand.',
    ) as AnyObj;
    expect(res.kind).toBe('Spell');
    expect(res.effects[0].kind).toBe('ReturnFromGraveyard');
    expect(res.targets[0].count).toBe(2);
  });
});
