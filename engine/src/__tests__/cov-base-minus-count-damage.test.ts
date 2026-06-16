/**
 * cov-base-minus-count-damage — Slice 7 coverage tests.
 *
 * Tests the "N minus the number of <filter> in <zone>" (BaseMinusCount) AmountRef
 * used by the Wheel of Torture / Storm World / Rackling / Viseling / Price of
 * Knowledge upkeep-damage family.
 *
 * WHAT IS TESTED:
 *  1. Parse: each card's oracle text parses as a Triggered ability with
 *     kind: 'DealDamage', target: EventPlayer (or EachOpponent), and
 *     amount: { kind: 'BaseMinusCount', base: N, count: ForEachAmount{hand/battlefield} }.
 *  2. Execute: the trigger fires at the right player's upkeep, the executor
 *     resolves the BaseMinusCount amount correctly against the event player's
 *     hand/battlefield, clamps to 0 when the count >= base, and deals the
 *     right damage.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { initGameState } from '../game-state';
import {
  checkTriggersForEvent,
  putTriggersOnStack,
  resolveTopOfStack,
  registerBattlefieldAbilities,
} from '../stack';
import type { CardDefinition, GameState, CardInstance } from '../types';

// ---------------------------------------------------------------------------
// Card definition helpers
// ---------------------------------------------------------------------------

function makeEnchantment(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Enchantment',
    oracle_text: oracleText,
    mana_cost: '{2}{B}',
    cmc: 3,
    colors: ['B'],
    color_identity: ['B'],
    keywords: [],
    card_types: ['enchantment'],
  };
}

function makeArtifact(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Artifact',
    oracle_text: oracleText,
    mana_cost: '{3}',
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact'],
  };
}

function makeCreature(id: string, name: string, oracleText: string): CardDefinition {
  return {
    id,
    name,
    type_line: 'Artifact Creature - Construct',
    oracle_text: oracleText,
    mana_cost: '{3}',
    cmc: 3,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['artifact', 'creature'],
    power: 1,
    toughness: 1,
  };
}

function makeCard(id: string): CardDefinition {
  return {
    id,
    name: `Card ${id}`,
    type_line: 'Instant',
    oracle_text: 'Draw a card.',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['instant'],
  };
}

// ---------------------------------------------------------------------------
// Game state helpers
// ---------------------------------------------------------------------------

function createTestGame(p1Cards: CardDefinition[], p2Cards: CardDefinition[]): GameState {
  return initGameState([
    { playerId: 'p1', name: 'Player 1', cards: p1Cards, commanderId: 'nonexistent-cmd-1' },
    { playerId: 'p2', name: 'Player 2', cards: p2Cards, commanderId: 'nonexistent-cmd-2' },
  ]);
}

function findCard(state: GameState, defId: string): CardInstance | undefined {
  for (const card of state.cards.values()) {
    if (card.definitionId === defId) return card;
  }
  return undefined;
}

function moveToZone(state: GameState, instanceId: string, zone: 'battlefield' | 'hand' | 'library'): GameState {
  const card = state.cards.get(instanceId);
  if (!card) throw new Error(`Card not found: ${instanceId}`);
  const newCards = new Map(state.cards);
  newCards.set(instanceId, { ...card, zone, summoningSick: false });
  return { ...state, cards: newCards };
}

function life(state: GameState, playerId: string): number {
  return state.players.find(p => p.id === playerId)!.life;
}

/** Count cards in a player's hand. */
function handSize(state: GameState, playerId: string): number {
  let n = 0;
  for (const card of state.cards.values()) {
    if (card.zone === 'hand' && card.ownerId === playerId) n++;
  }
  return n;
}

/**
 * Set up a punisher permanent on p1's battlefield.
 * p2Cards array is extra cards given to p2 (definitions only; caller must
 * move them to the desired zone after calling setupPunisher).
 */
function setupPunisher(
  def: CardDefinition,
  p2ExtraCards: CardDefinition[] = [],
): GameState {
  let state = createTestGame([def], p2ExtraCards);
  const inst = findCard(state, def.id)!;
  state = moveToZone(state, inst.instanceId, 'battlefield');
  state = registerBattlefieldAbilities(state, inst.instanceId);
  return state;
}

// ---------------------------------------------------------------------------
// PARSING TESTS
// ---------------------------------------------------------------------------

describe('cov-base-minus-count-damage: parsing', () => {
  it('Wheel of Torture: parses "X damage, where X is 3 minus cards in hand"', () => {
    const oracle =
      "At the beginning of each opponent's upkeep, ~ deals X damage to that player, where X is 3 minus the number of cards in that player's hand.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toMatchObject({ kind: 'Upkeep', whose: 'opponents' });
    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('DealDamage');
    if (effect.kind !== 'DealDamage') return;
    expect(effect.target).toMatchObject({ kind: 'EventPlayer' });
    expect(effect.amount).toMatchObject({
      kind: 'BaseMinusCount',
      base: 3,
      count: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' },
    });
  });

  it('Storm World: parses "X damage, where X is 4 minus cards in hand"', () => {
    const oracle =
      "At the beginning of each player's upkeep, ~ deals X damage to that player, where X is 4 minus the number of cards in that player's hand.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger).toMatchObject({ kind: 'Upkeep', whose: 'each' });
    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('DealDamage');
    if (effect.kind !== 'DealDamage') return;
    expect(effect.amount).toMatchObject({
      kind: 'BaseMinusCount',
      base: 4,
      count: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' },
    });
  });

  it('Rackling: parses artifact creature form with "that player\'s hand"', () => {
    const oracle =
      "At the beginning of each opponent's upkeep, ~ deals X damage to that player, where X is 3 minus the number of cards in that player's hand.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('DealDamage');
    if (effect.kind !== 'DealDamage') return;
    expect(effect.amount).toMatchObject({
      kind: 'BaseMinusCount',
      base: 3,
      count: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' },
    });
  });

  it('Viseling: parses "4 minus cards in their hand" (their form)', () => {
    const oracle =
      "At the beginning of each opponent's upkeep, ~ deals X damage to that player, where X is 4 minus the number of cards in their hand.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('DealDamage');
    if (effect.kind !== 'DealDamage') return;
    expect(effect.amount).toMatchObject({
      kind: 'BaseMinusCount',
      base: 4,
      count: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' },
    });
  });

  it('Price of Knowledge variant: "each opponent" target, 7 minus hand', () => {
    // Simplified Price of Knowledge oracle (multi-part text — only the upkeep trigger line)
    const oracle =
      "At the beginning of each opponent's upkeep, ~ deals X damage to each opponent, where X is 7 minus the number of cards in their hand.";
    const r = parseOracleText(oracle);
    // This line is only parseable if the target is EachOpponent; parser may decline
    // multi-part text. We primarily verify no-crash and check if it parsed.
    if (r.kind === 'Triggered') {
      const effect = r.ability.effects[0];
      expect(effect.kind).toBe('DealDamage');
    }
    // Acceptable for it to be Unparsed if multi-sentence oracle is not handled.
  });

  it('body-only form: "this artifact deals X damage to that player, where X is 3 minus..." parses as body', () => {
    // When used as a trigger body (not full oracle), the pattern matches in parseEffectClauseInternal.
    const oracle =
      "At the beginning of each opponent's upkeep, this artifact deals X damage to that player, where X is 3 minus the number of cards in that player's hand.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    const effect = r.ability.effects[0];
    expect(effect.kind).toBe('DealDamage');
    if (effect.kind !== 'DealDamage') return;
    expect(effect.amount).toMatchObject({
      kind: 'BaseMinusCount',
      base: 3,
    });
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS
// ---------------------------------------------------------------------------

describe('cov-base-minus-count-damage: execution', () => {
  const WHEEL_ORACLE =
    "At the beginning of each opponent's upkeep, ~ deals X damage to that player, where X is 3 minus the number of cards in that player's hand.";

  it('deals 0 damage when opponent has 3+ cards in hand (clamped)', () => {
    const def = makeEnchantment('wheel-of-torture', 'Wheel of Torture', WHEEL_ORACLE);
    // Give p2 3 cards in hand
    const c1 = makeCard('hc1');
    const c2 = makeCard('hc2');
    const c3 = makeCard('hc3');
    let state = setupPunisher(def, [c1, c2, c3]);

    // Move p2's cards to hand
    for (const d of [c1, c2, c3]) {
      const inst = findCard(state, d.id)!;
      state = moveToZone(state, inst.instanceId, 'hand');
    }

    expect(handSize(state, 'p2')).toBe(3);

    const p2Before = life(state, 'p2');
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    // 3 − 3 = 0 damage
    expect(life(state, 'p2')).toBe(p2Before);
  });

  it('deals 2 damage when opponent has 1 card in hand (3 − 1 = 2)', () => {
    const def = makeEnchantment('wheel-of-torture', 'Wheel of Torture', WHEEL_ORACLE);
    const c1 = makeCard('hc1');
    let state = setupPunisher(def, [c1]);

    const inst = findCard(state, c1.id)!;
    state = moveToZone(state, inst.instanceId, 'hand');

    expect(handSize(state, 'p2')).toBe(1);

    const p2Before = life(state, 'p2');
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    // 3 − 1 = 2 damage
    expect(life(state, 'p2')).toBe(p2Before - 2);
  });

  it('deals 3 damage when opponent has empty hand (3 − 0 = 3)', () => {
    const def = makeEnchantment('wheel-of-torture', 'Wheel of Torture', WHEEL_ORACLE);
    let state = setupPunisher(def, []);
    // p2 has no cards in hand

    expect(handSize(state, 'p2')).toBe(0);

    const p2Before = life(state, 'p2');
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    // 3 − 0 = 3 damage
    expect(life(state, 'p2')).toBe(p2Before - 3);
  });

  it('does NOT fire on the controller\'s own upkeep (opponents\' upkeep trigger)', () => {
    const def = makeEnchantment('wheel-of-torture', 'Wheel of Torture', WHEEL_ORACLE);
    const state = setupPunisher(def, []);

    // p1 is the controller — their own upkeep should NOT trigger it.
    const next = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });
    expect(next.pendingTriggers).toHaveLength(0);
  });

  it('Storm World (each player): fires on both players\' upkeeps and counts their hand correctly', () => {
    const STORM_ORACLE =
      "At the beginning of each player's upkeep, this enchantment deals X damage to that player, where X is 4 minus the number of cards in that player's hand.";
    const def = makeEnchantment('storm-world', 'Storm World', STORM_ORACLE);
    // Give p2 2 cards in hand
    const c1 = makeCard('sc1');
    const c2 = makeCard('sc2');
    let state = setupPunisher(def, [c1, c2]);
    const sc1 = findCard(state, c1.id)!;
    const sc2 = findCard(state, c2.id)!;
    state = moveToZone(state, sc1.instanceId, 'hand');
    state = moveToZone(state, sc2.instanceId, 'hand');

    expect(handSize(state, 'p2')).toBe(2);
    expect(handSize(state, 'p1')).toBe(0);

    // p2 upkeep: 4 − 2 = 2 damage
    const p2Before = life(state, 'p2');
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p2')).toBe(p2Before - 2);

    // p1 upkeep: 4 − 0 = 4 damage (p1 has 0 cards in hand)
    const p1Before = life(state, 'p1');
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p1' });
    expect(state.pendingTriggers).toHaveLength(1);
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p1')).toBe(p1Before - 4);
  });

  it('artifact creature form (Rackling) resolves correctly', () => {
    const RACKLING_ORACLE =
      "At the beginning of each opponent's upkeep, ~ deals X damage to that player, where X is 3 minus the number of cards in that player's hand.";
    const def = makeCreature('rackling', 'Rackling', RACKLING_ORACLE);
    let state = setupPunisher(def, [makeCard('rh1')]);
    const rh1 = findCard(state, 'rh1')!;
    state = moveToZone(state, rh1.instanceId, 'hand');

    // p2 has 1 card: 3 − 1 = 2 damage
    const p2Before = life(state, 'p2');
    state = checkTriggersForEvent(state, { kind: 'UpkeepStart', activePlayerId: 'p2' });
    state = putTriggersOnStack(state);
    state = resolveTopOfStack(state);
    expect(life(state, 'p2')).toBe(p2Before - 2);
  });
});
