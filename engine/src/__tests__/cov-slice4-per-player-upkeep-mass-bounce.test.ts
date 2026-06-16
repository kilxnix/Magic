/**
 * Coverage slice 4/12 — Per-player upkeep mass-bounce "that player returns each creature"
 * body (Noetic Scales family).
 *
 * Covered oracle shapes:
 *   A) "that player returns each creature they control to its owner's hand"
 *      (unfiltered mass bounce — all EventPlayer creatures go to hand)
 *   B) "that player returns each creature they control with power greater than the
 *      number of cards in their hand to its owner's hand" (Noetic Scales)
 *      (power-filtered bounce — only creatures whose power > hand size bounce)
 *   C) Full upkeep trigger:
 *      "At the beginning of each player's upkeep, that player returns each creature
 *       they control with power greater than the number of cards in their hand to
 *       its owner's hand." (Noetic Scales full oracle body)
 *
 * Each test verifies both PARSE (AST shape) and EXECUTION (state change via
 * executeEffects with eventContext.eventPlayerId = the active player).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseState(): GameState {
  return {
    players: [createPlayer('p1', 'Player 1'), createPlayer('p2', 'Player 2')],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  } as GameState;
}

function makeCreatureDef(id: string, name: string, power: number, cmc: number): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature — Beast',
    oracle_text: '',
    mana_cost: `{${cmc}}`,
    cmc,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness: power,
  };
}

function addCreature(
  state: GameState,
  instanceId: string,
  def: CardDefinition,
  ownerId: string,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance);
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function addHandCard(
  state: GameState,
  instanceId: string,
  defId: string,
  ownerId: string,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  if (!state.cardDefinitions.has(defId)) {
    defs.set(defId, {
      id: defId,
      name: `Hand card ${defId}`,
      type_line: 'Instant',
      oracle_text: '',
      mana_cost: '{1}',
      cmc: 1,
      colors: [],
      color_identity: [],
      keywords: [],
      card_types: ['instant'],
    });
  } else {
    for (const [k, v] of state.cardDefinitions) defs.set(k, v);
  }
  newCards.set(instanceId, {
    instanceId,
    definitionId: defId,
    ownerId,
    zone: 'hand',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance);
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function countZone(state: GameState, ownerId: string, zone: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === ownerId && c.zone === zone) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// PARSE TESTS
// ---------------------------------------------------------------------------

describe('matchThatPlayerReturnsMassBounce — parsing', () => {
  it('parses unfiltered mass bounce as BounceControlledByPlayer with creature filter and count 100', () => {
    const parsed = parseOracleText(
      "That player returns each creature they control to its owner's hand.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0] as Effect;
    expect(eff.kind).toBe('BounceControlledByPlayer');
    if (eff.kind !== 'BounceControlledByPlayer') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(100);
    expect(eff.filter?.types).toEqual(['creature']);
    expect(eff.filter?.powerGreaterThanEventPlayerHandCount).toBeUndefined();
    expect(parsed.targets).toHaveLength(0);
  });

  it('parses power-filtered mass bounce (Noetic Scales body) with powerGreaterThanEventPlayerHandCount', () => {
    const parsed = parseOracleText(
      "That player returns each creature they control with power greater than the number of cards in their hand to its owner's hand.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0] as Effect;
    expect(eff.kind).toBe('BounceControlledByPlayer');
    if (eff.kind !== 'BounceControlledByPlayer') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(100);
    expect(eff.filter?.types).toEqual(['creature']);
    expect(eff.filter?.powerGreaterThanEventPlayerHandCount).toBe(true);
    expect(parsed.targets).toHaveLength(0);
  });

  it('parses full Noetic Scales oracle text as Triggered ability with BounceControlledByPlayer body', () => {
    const oracle =
      "At the beginning of each player's upkeep, that player returns each creature they control with power greater than the number of cards in their hand to its owner's hand.";
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    expect(parsed.ability.effects).toHaveLength(1);
    const eff = parsed.ability.effects[0] as Effect;
    expect(eff.kind).toBe('BounceControlledByPlayer');
    if (eff.kind !== 'BounceControlledByPlayer') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.filter?.powerGreaterThanEventPlayerHandCount).toBe(true);
  });

  it('does NOT shadow matchThatPlayerReturnsCreature for single-creature form', () => {
    // The single-creature form ("that player returns a creature they control") must
    // still parse via matchThatPlayerReturnsCreature with count 1, not count 100.
    const parsed = parseOracleText(
      "That player returns a creature they control to its owner's hand.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0] as Effect;
    expect(eff.kind).toBe('BounceControlledByPlayer');
    if (eff.kind !== 'BounceControlledByPlayer') return;
    expect(eff.count).toBe(1); // single creature, NOT mass bounce
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS
// ---------------------------------------------------------------------------

describe('matchThatPlayerReturnsMassBounce — execution (unfiltered)', () => {
  it('returns all EventPlayer creatures to hand when no power filter', () => {
    let state = baseState();
    // p1 has 2 creatures on battlefield
    state = addCreature(state, 'p1-c1', makeCreatureDef('def1', 'Bear', 2, 2), 'p1');
    state = addCreature(state, 'p1-c2', makeCreatureDef('def2', 'Wolf', 3, 3), 'p1');
    // p2 has 1 creature
    state = addCreature(state, 'p2-c1', makeCreatureDef('def3', 'Dragon', 5, 5), 'p2');

    expect(countZone(state, 'p1', 'battlefield')).toBe(2);
    expect(countZone(state, 'p2', 'battlefield')).toBe(1);

    const parsed = parseOracleText(
      "That player returns each creature they control to its owner's hand.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(state, parsed.effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });

    // p1's creatures all bounce to hand
    expect(countZone(result, 'p1', 'hand')).toBe(2);
    expect(countZone(result, 'p1', 'battlefield')).toBe(0);
    // p2's creature is unaffected
    expect(countZone(result, 'p2', 'battlefield')).toBe(1);
    expect(countZone(result, 'p2', 'hand')).toBe(0);
  });
});

describe('matchThatPlayerReturnsMassBounce — execution (power filter)', () => {
  it('bounces only EventPlayer creatures with power > hand count (Noetic Scales)', () => {
    let state = baseState();
    // p1 has hand size 2 → creatures with power > 2 bounce; power <= 2 stay
    state = addHandCard(state, 'p1-h1', 'hand-def-1', 'p1');
    state = addHandCard(state, 'p1-h2', 'hand-def-2', 'p1');

    // power 2 creature — should NOT bounce (power NOT greater than hand count 2)
    state = addCreature(state, 'p1-c-pow2', makeCreatureDef('def-pow2', 'Bear', 2, 2), 'p1');
    // power 3 creature — should bounce (3 > 2)
    state = addCreature(state, 'p1-c-pow3', makeCreatureDef('def-pow3', 'Wolf', 3, 3), 'p1');
    // power 5 creature — should bounce (5 > 2)
    state = addCreature(state, 'p1-c-pow5', makeCreatureDef('def-pow5', 'Dragon', 5, 5), 'p1');

    expect(countZone(state, 'p1', 'battlefield')).toBe(3);
    expect(countZone(state, 'p1', 'hand')).toBe(2);

    const parsed = parseOracleText(
      "That player returns each creature they control with power greater than the number of cards in their hand to its owner's hand.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(state, parsed.effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });

    // Power 2 stays on battlefield; power 3 and 5 bounce
    expect(countZone(result, 'p1', 'battlefield')).toBe(1);
    // Bounced 2 creatures + 2 hand cards already there = 4 in hand
    expect(countZone(result, 'p1', 'hand')).toBe(4);
    // The power-2 creature is still on the battlefield
    expect(result.cards.get('p1-c-pow2')?.zone).toBe('battlefield');
    // The power-3 and power-5 creatures bounced to hand
    expect(result.cards.get('p1-c-pow3')?.zone).toBe('hand');
    expect(result.cards.get('p1-c-pow5')?.zone).toBe('hand');
  });

  it('bounces no creatures when hand count >= all creature powers', () => {
    let state = baseState();
    // p1 has 5 cards in hand (hand count = 5), all creatures have power <= 5
    for (let i = 1; i <= 5; i++) {
      state = addHandCard(state, `p1-h${i}`, `hand-def-h${i}`, 'p1');
    }
    // Creature with power 3 (3 is not > 5)
    state = addCreature(state, 'p1-c1', makeCreatureDef('def-c1', 'Bear', 3, 3), 'p1');
    // Creature with power 5 (5 is not > 5 — equal, so no bounce)
    state = addCreature(state, 'p1-c2', makeCreatureDef('def-c2', 'Wolf', 5, 5), 'p1');

    expect(countZone(state, 'p1', 'battlefield')).toBe(2);
    expect(countZone(state, 'p1', 'hand')).toBe(5);

    const parsed = parseOracleText(
      "That player returns each creature they control with power greater than the number of cards in their hand to its owner's hand.",
    );
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(state, parsed.effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });

    // No creatures bounce — hand count is 5 and power <= 5 for all creatures
    expect(countZone(result, 'p1', 'battlefield')).toBe(2);
    expect(countZone(result, 'p1', 'hand')).toBe(5);
  });

  it('bounces all creatures when hand is empty (hand count = 0)', () => {
    let state = baseState();
    // p1 has empty hand — all creatures bounce (any positive power > 0)
    state = addCreature(state, 'p1-c1', makeCreatureDef('def-x1', 'Minnow', 1, 1), 'p1');
    state = addCreature(state, 'p1-c2', makeCreatureDef('def-x2', 'Giant', 6, 6), 'p1');

    expect(countZone(state, 'p1', 'hand')).toBe(0);
    expect(countZone(state, 'p1', 'battlefield')).toBe(2);

    const parsed = parseOracleText(
      "That player returns each creature they control with power greater than the number of cards in their hand to its owner's hand.",
    );
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(state, parsed.effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });

    // All 2 creatures bounce (both have power > 0)
    expect(countZone(result, 'p1', 'battlefield')).toBe(0);
    expect(countZone(result, 'p1', 'hand')).toBe(2);
  });
});
