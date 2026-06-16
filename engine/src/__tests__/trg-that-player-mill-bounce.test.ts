/**
 * Slice 10/12: Per-player upkeep "that player" clause completion.
 *
 * Tests for:
 *   - matchThatPlayerMill: "that player mills N cards" (EventPlayer ref, Mill effect)
 *   - matchThatPlayerReturnsCreature: "that player returns a creature they control to its
 *     owner's hand" (BounceControlledByPlayer effect, EventPlayer ref, Sunken Hope family)
 *
 * All tests verify both PARSE and EXECUTION. The EventPlayer TargetRef is
 * resolved from eventContext.eventPlayerId supplied to executeEffects.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';
import { createPlayer } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCardDef(id: string, name: string, typeLine: string, cmc: number): CardDefinition {
  const isCreature = typeLine.toLowerCase().includes('creature');
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '{1}',
    cmc,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: typeLine.toLowerCase().split(/[\s—–-]/).filter(t =>
      ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t)
    ),
    power: isCreature ? cmc : undefined,
    toughness: isCreature ? cmc : undefined,
  };
}

function makeLibCards(state: GameState, ownerId: string, prefix: string, count: number): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  const defId = `${prefix}-def`;
  defs.set(defId, makeCardDef(defId, `${prefix} card`, 'Instant', 1));
  for (let i = 1; i <= count; i++) {
    const id = `${prefix}-lib-${i}`;
    newCards.set(id, {
      instanceId: id,
      definitionId: defId,
      ownerId,
      zone: 'library',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function addCreatureToField(
  state: GameState,
  instanceId: string,
  defId: string,
  ownerId: string,
  cmc: number,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(defId, makeCardDef(defId, `Creature-${cmc}`, 'Creature — Soldier', cmc));
  newCards.set(instanceId, {
    instanceId,
    definitionId: defId,
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

function graveyardCount(state: GameState, ownerId: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === ownerId && c.zone === 'graveyard') n++;
  }
  return n;
}

function libraryCount(state: GameState, ownerId: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === ownerId && c.zone === 'library') n++;
  }
  return n;
}

function handCount(state: GameState, ownerId: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === ownerId && c.zone === 'hand') n++;
  }
  return n;
}

function fieldCount(state: GameState, ownerId: string): number {
  let n = 0;
  for (const c of state.cards.values()) {
    if (c.ownerId === ownerId && c.zone === 'battlefield') n++;
  }
  return n;
}

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

// ---------------------------------------------------------------------------
// PARSING TESTS: matchThatPlayerMill
// ---------------------------------------------------------------------------

describe('matchThatPlayerMill — parsing', () => {
  it('parses "that player mills two cards" as Mill with EventPlayer', () => {
    // Verified fail before this slice: "that player mills two cards" was Unparsed.
    const parsed = parseOracleText('That player mills two cards.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(2);
    expect(parsed.targets).toHaveLength(0);
  });

  it('parses "that player mills 3 cards" with a numeric token', () => {
    const parsed = parseOracleText('That player mills 3 cards.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(3);
  });

  it('parses "that player mills five cards" (word-number)', () => {
    const parsed = parseOracleText('That player mills five cards.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.count).toBe(5);
  });

  it('parses upkeep trigger with "that player mills" body as Triggered with Mill', () => {
    // Full Sunken-Hope-style mill variant
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player mills two cards.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('Mill');
    if (eff.kind !== 'Mill') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS: matchThatPlayerMill
// ---------------------------------------------------------------------------

describe('matchThatPlayerMill — execution', () => {
  it('mills the EventPlayer when eventPlayerId is set in context', () => {
    let state = baseState();
    state = makeLibCards(state, 'p2', 'p2', 5); // p2 has 5-card library

    const effects: Effect[] = [{ kind: 'Mill', player: { kind: 'EventPlayer' }, count: 2 }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(graveyardCount(result, 'p2')).toBe(2);
    expect(libraryCount(result, 'p2')).toBe(3);
    expect(graveyardCount(result, 'p1')).toBe(0); // p1 untouched
  });

  it('safe no-op (no mill) when eventPlayerId is absent', () => {
    let state = baseState();
    state = makeLibCards(state, 'p2', 'p2', 5);

    const effects: Effect[] = [{ kind: 'Mill', player: { kind: 'EventPlayer' }, count: 2 }];
    // No eventContext — resolveTargetRef returns '' → executeMill is a no-op.
    const result = executeEffects(state, effects, 'p1', [], []);

    expect(graveyardCount(result, 'p1')).toBe(0);
    expect(graveyardCount(result, 'p2')).toBe(0);
  });

  it('mills the active player identified by eventPlayerId (p1 upkeep -> p1 mills)', () => {
    let state = baseState();
    state = makeLibCards(state, 'p1', 'p1', 4);

    const effects: Effect[] = [{ kind: 'Mill', player: { kind: 'EventPlayer' }, count: 3 }];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });

    expect(graveyardCount(result, 'p1')).toBe(3);
    expect(libraryCount(result, 'p1')).toBe(1);
  });

  it('parses and executes the full "that player mills two cards" oracle text', () => {
    let state = baseState();
    state = makeLibCards(state, 'p2', 'p2mill', 6);

    const parsed = parseOracleText('That player mills two cards.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const result = executeEffects(state, parsed.effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(graveyardCount(result, 'p2')).toBe(2);
    expect(libraryCount(result, 'p2')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// PARSING TESTS: matchThatPlayerReturnsCreature (Sunken Hope family)
// ---------------------------------------------------------------------------

describe('matchThatPlayerReturnsCreature — parsing', () => {
  it("parses Sunken Hope's oracle clause as BounceControlledByPlayer", () => {
    // Sunken Hope: "At the beginning of each player's upkeep, that player returns a
    // creature they control to its owner's hand."
    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player returns a creature they control to its owner's hand.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('BounceControlledByPlayer');
    if (eff.kind !== 'BounceControlledByPlayer') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.filter).toEqual({ types: ['creature'] });
    expect(eff.count).toBe(1);
  });

  it('parses as a standalone spell clause', () => {
    const parsed = parseOracleText(
      "That player returns a creature they control to its owner's hand.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('BounceControlledByPlayer');
    if (eff.kind !== 'BounceControlledByPlayer') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    expect(eff.filter).toEqual({ types: ['creature'] });
  });

  it('parses the "permanent" variant (no type restriction)', () => {
    const parsed = parseOracleText(
      "That player returns a permanent they control to its owner's hand.",
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('BounceControlledByPlayer');
    if (eff.kind !== 'BounceControlledByPlayer') return;
    // No filter for bare "permanent"
    expect(eff.filter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS: BounceControlledByPlayer
// ---------------------------------------------------------------------------

describe('BounceControlledByPlayer — execution', () => {
  it('returns the lowest-CMC creature of the EventPlayer to their hand', () => {
    let state = baseState();
    // p2 has two creatures: 2-CMC and 4-CMC. The 2-CMC one should be bounced.
    state = addCreatureToField(state, 'p2-cre-2', 'def-cre-2', 'p2', 2);
    state = addCreatureToField(state, 'p2-cre-4', 'def-cre-4', 'p2', 4);

    const effects: Effect[] = [
      {
        kind: 'BounceControlledByPlayer',
        player: { kind: 'EventPlayer' },
        filter: { types: ['creature'] },
        count: 1,
      },
    ];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // The 2-CMC creature should be bounced to hand; the 4-CMC stays.
    expect(result.cards.get('p2-cre-2')!.zone).toBe('hand');
    expect(result.cards.get('p2-cre-4')!.zone).toBe('battlefield');
  });

  it('safe no-op when EventPlayer has no matching permanents', () => {
    const state = baseState(); // empty battlefield

    const effects: Effect[] = [
      {
        kind: 'BounceControlledByPlayer',
        player: { kind: 'EventPlayer' },
        filter: { types: ['creature'] },
        count: 1,
      },
    ];
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // Nothing to return — state unchanged.
    expect(fieldCount(result, 'p2')).toBe(0);
    expect(handCount(result, 'p2')).toBe(0);
  });

  it('safe no-op when no eventContext provided', () => {
    let state = baseState();
    state = addCreatureToField(state, 'p2-cre', 'def-cre', 'p2', 2);

    const effects: Effect[] = [
      {
        kind: 'BounceControlledByPlayer',
        player: { kind: 'EventPlayer' },
        filter: { types: ['creature'] },
        count: 1,
      },
    ];
    // No eventContext → eventPlayerId resolves to '' → no player found → state unchanged.
    const result = executeEffects(state, effects, 'p1', [], []);

    expect(result.cards.get('p2-cre')!.zone).toBe('battlefield');
  });

  it('does NOT bounce creatures belonging to the caster', () => {
    let state = baseState();
    state = addCreatureToField(state, 'p1-cre', 'def-p1', 'p1', 2);
    state = addCreatureToField(state, 'p2-cre', 'def-p2', 'p2', 3);

    const effects: Effect[] = [
      {
        kind: 'BounceControlledByPlayer',
        player: { kind: 'EventPlayer' },
        filter: { types: ['creature'] },
        count: 1,
      },
    ];
    // eventPlayerId = p2 → only p2's creature is eligible.
    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(result.cards.get('p1-cre')!.zone).toBe('battlefield'); // p1 untouched
    expect(result.cards.get('p2-cre')!.zone).toBe('hand'); // p2 bounced
  });

  it('parses and executes the full Sunken Hope clause end-to-end', () => {
    let state = baseState();
    state = addCreatureToField(state, 'p2-bear', 'def-bear', 'p2', 2);

    const parsed = parseOracleText(
      "At the beginning of each player's upkeep, that player returns a creature they control to its owner's hand.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;

    const result = executeEffects(state, parsed.ability.effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    expect(result.cards.get('p2-bear')!.zone).toBe('hand');
  });
});
