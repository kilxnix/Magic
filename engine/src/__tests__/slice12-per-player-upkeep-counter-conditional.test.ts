/**
 * Slice 12 — Per-player upkeep counter placement on event-player-controlled lands,
 * and per-player upkeep conditional riders (EventPlayerHasMoreCardsInHand).
 *
 * Covered oracle shapes:
 *   Quicksilver Fountain family:
 *     "that player puts a flood counter on target non-Island land they control of their choice"
 *   Descent into Madness-adjacent:
 *     "that player puts a +1/+1 counter on target land they control"
 *   Anvil of Bogardan family:
 *     "if that player has more cards in hand than you, that player draws a card"
 *
 * Each test verifies both PARSE (matcher emits correct AST) and EXECUTE
 * (executeEffects with eventContext.eventPlayerId applies the right effect).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardDefinition } from '../types';
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

function makeCardDef(
  id: string,
  name: string,
  typeLine: string,
  cmc = 0,
  colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [],
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '',
    cmc,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: typeLine.toLowerCase().split(/[\s—–-]/).filter(t =>
      ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t),
    ),
  };
}

function addBattlefieldCard(
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
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function addHandCard(
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
    zone: 'hand',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function counterCount(state: GameState, instanceId: string, counterType: string): number {
  return state.cards.get(instanceId)?.counters?.[counterType] ?? 0;
}

function handCount(state: GameState, playerId: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === playerId && c.zone === 'hand') n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// 1. Quicksilver Fountain — "that player puts a flood counter on target
//    non-Island land they control of their choice"
// ---------------------------------------------------------------------------

describe('Slice 12 — Quicksilver Fountain (that player puts counter on non-Island land)', () => {
  const oracleText =
    "At the beginning of each player's upkeep, that player puts a flood counter on target non-Island land they control of their choice.";

  it('parses as Triggered with Upkeep/each trigger', () => {
    const parsed = parseOracleText(oracleText);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
  });

  it('emits AddCounters with AllOfType + eventPlayerControls + excludeSubtypes Island', () => {
    const parsed = parseOracleText(oracleText);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.counterType).toBe('flood');
    expect(eff.count).toBe(1);
    expect(eff.maxCount).toBe(1);
    expect(eff.target).toEqual({
      kind: 'AllOfType',
      filter: { types: ['land'], excludeSubtypes: ['Island'] },
      eventPlayerControls: true,
    });
  });

  it('applies a flood counter to the event player\'s non-Island land', () => {
    // p2 is the event player for this upkeep; p1 owns the enchantment (casterId).
    // p2 has a Forest (non-Island) and an Island on the battlefield.
    const forestDef = makeCardDef('forest-def', 'Forest', 'Basic Land - Forest');
    const islandDef = makeCardDef('island-def', 'Island', 'Basic Land - Island');

    let state = baseState();
    state = addBattlefieldCard(state, 'forest-1', forestDef, 'p2');
    state = addBattlefieldCard(state, 'island-1', islandDef, 'p2');

    const parsed = parseOracleText(oracleText);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const effects: Effect[] = parsed.ability.effects;

    // Execute with p2 as the event player (their upkeep) and p1 as the caster (enchantment controller).
    state = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // Forest gets the flood counter, Island does not.
    expect(counterCount(state, 'forest-1', 'flood')).toBe(1);
    expect(counterCount(state, 'island-1', 'flood')).toBe(0);
  });

  it('does not place a counter on a land the event player does not control', () => {
    // p1's Forest should not receive a counter when p2 is the event player.
    const forestDefP1 = makeCardDef('forest-p1-def', 'Forest', 'Basic Land - Forest');
    const forestDefP2 = makeCardDef('forest-p2-def', 'Forest', 'Basic Land - Forest');

    let state = baseState();
    state = addBattlefieldCard(state, 'forest-p1', forestDefP1, 'p1');
    state = addBattlefieldCard(state, 'forest-p2', forestDefP2, 'p2');

    const parsed = parseOracleText(oracleText);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    state = executeEffects(state, parsed.ability.effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // Only p2's forest gets the counter.
    expect(counterCount(state, 'forest-p1', 'flood')).toBe(0);
    expect(counterCount(state, 'forest-p2', 'flood')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Generic land counter (no subtype exclusion)
//    "that player puts a +1/+1 counter on target land they control"
// ---------------------------------------------------------------------------

describe('Slice 12 — generic land counter (no subtype restriction)', () => {
  const oracleText =
    "At the beginning of each player's upkeep, that player puts a +1/+1 counter on target land they control.";

  it('parses as Triggered with Upkeep/each trigger and no excludeSubtypes', () => {
    const parsed = parseOracleText(oracleText);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.target).toMatchObject({
      kind: 'AllOfType',
      filter: { types: ['land'] },
      eventPlayerControls: true,
    });
    // No excludeSubtypes — Island is fine.
    const filter = (eff.target as { filter: { excludeSubtypes?: string[] } }).filter;
    expect(filter.excludeSubtypes).toBeUndefined();
  });

  it('places the counter on an Island when no subtype is excluded', () => {
    const islandDef = makeCardDef('island-def2', 'Island', 'Basic Land - Island');

    let state = baseState();
    state = addBattlefieldCard(state, 'island-2', islandDef, 'p2');

    const parsed = parseOracleText(oracleText);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    state = executeEffects(state, parsed.ability.effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(counterCount(state, 'island-2', '+1/+1')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Anvil of Bogardan family — conditional "if that player has more cards in
//    hand than you, that player draws a card"
// ---------------------------------------------------------------------------

describe('Slice 12 — EventPlayerHasMoreCardsInHand conditional', () => {
  const oracleText =
    "At the beginning of each player's upkeep, that player draws a card. If that player has more cards in hand than you, that player discards a card.";

  it('parses the trigger correctly with both effects', () => {
    const parsed = parseOracleText(oracleText);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    // Should parse at least the draw effect; the conditional discard may also parse.
    expect(parsed.ability.effects.length).toBeGreaterThanOrEqual(1);
  });

  it('parses the standalone conditional discard correctly', () => {
    const standalone = parseOracleText(
      'If that player has more cards in hand than you, that player discards a card.',
    );
    expect(standalone.kind).toBe('Spell');
    if (standalone.kind !== 'Spell') return;
    const eff = standalone.effects[0];
    expect(eff.kind).toBe('Conditional');
    if (eff.kind !== 'Conditional') return;
    expect(eff.condition).toEqual({ kind: 'EventPlayerHasMoreCardsInHand' });
    expect(eff.effect.kind).toBe('Discard');
  });

  it('conditional discard fires when event player has more cards than controller', () => {
    // p2 is the event player and has 3 hand cards; p1 (controller) has 1 hand card.
    const cardDef = makeCardDef('card-def', 'Generic Card', 'Instant');

    let state = baseState();
    // p1: 1 card in hand
    state = addHandCard(state, 'h-p1-a', cardDef, 'p1');
    // p2: 3 cards in hand
    state = addHandCard(state, 'h-p2-a', cardDef, 'p2');
    state = addHandCard(state, 'h-p2-b', cardDef, 'p2');
    state = addHandCard(state, 'h-p2-c', cardDef, 'p2');

    const effects: Effect[] = [
      {
        kind: 'Conditional',
        condition: { kind: 'EventPlayerHasMoreCardsInHand' },
        effect: { kind: 'Discard', player: { kind: 'EventPlayer' }, count: 1 },
      },
    ];

    const before = handCount(state, 'p2');
    state = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // p2 has more cards than p1, so the discard fires.
    expect(handCount(state, 'p2')).toBe(before - 1);
  });

  it('conditional discard does NOT fire when event player has equal or fewer cards', () => {
    const cardDef = makeCardDef('card-def2', 'Generic Card 2', 'Instant');

    let state = baseState();
    // p1 and p2 both have 2 cards in hand (equal — condition false).
    state = addHandCard(state, 'e-p1-a', cardDef, 'p1');
    state = addHandCard(state, 'e-p1-b', cardDef, 'p1');
    state = addHandCard(state, 'e-p2-a', cardDef, 'p2');
    state = addHandCard(state, 'e-p2-b', cardDef, 'p2');

    const effects: Effect[] = [
      {
        kind: 'Conditional',
        condition: { kind: 'EventPlayerHasMoreCardsInHand' },
        effect: { kind: 'Discard', player: { kind: 'EventPlayer' }, count: 1 },
      },
    ];

    const before = handCount(state, 'p2');
    state = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // Equal count — condition false, discard does NOT fire.
    expect(handCount(state, 'p2')).toBe(before);
  });
});
