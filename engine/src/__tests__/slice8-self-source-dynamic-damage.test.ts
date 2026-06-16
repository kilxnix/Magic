/**
 * Slice 8 — Self-source dynamic damage triggers
 *
 * Covers the new matchers: "this <type> deals X damage to that player, where X
 * is the number of cards in their hand/graveyard" and "deals X damage to that
 * player, where X is the number of <filter> in their hand".
 *
 * Also covers extending matchDealDamageXWhereX to handle "that player" (EventPlayer)
 * and "defending player" (EventPlayer) targets alongside "each opponent".
 *
 * Real oracle wordings used:
 *   Viseling — "this creature deals X damage to that player, where X is the number
 *               of cards in their hand minus 4" (declined — arithmetic not supported)
 *   Unquenchable Fury — "it deals X damage to defending player, where X is the
 *               number of cards in their hand"
 *   Citadel of Pain — "this enchantment deals X damage to that player, where X is
 *               the number of untapped lands they control" (declined — no untapped filter)
 *   Ancient Runes — "this enchantment deals damage to that player equal to the
 *               number of artifacts they control" (existing Slice 12 coverage)
 *   Thundering Raiju trigger tail — "this creature deals X damage to each opponent,
 *               where X is the number of modified creatures you control" (each opponent)
 *
 * For the new shapes we exercise the exact engine path:
 *   1. Parse: parseOracleText emits Spell/Triggered with DealDamage + ForEach amount
 *   2. Execute: executeEffects with eventContext.eventPlayerId deals the right damage
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, ForEachAmount } from '../effects/ast';
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

function makeCardDef(id: string, name: string, typeLine: string): CardDefinition {
  const cardTypes = typeLine.toLowerCase().split(/[\s—-]/).filter(t =>
    ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t),
  );
  return {
    id, name, type_line: typeLine, oracle_text: '',
    mana_cost: '{1}', cmc: 1,
    colors: [], color_identity: [], keywords: [],
    card_types: cardTypes,
  };
}

function addCard(
  state: GameState,
  instanceId: string,
  def: CardDefinition,
  ownerId: string,
  zone: CardInstance['zone'],
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId, definitionId: def.id, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function lifeOf(state: GameState, id: string): number {
  return state.players.find(p => p.id === id)?.life ?? 20;
}

// ---------------------------------------------------------------------------
// 1. "deals X damage to that player, where X is the number of cards in their hand"
//    Unquenchable Fury / Viseling-style (cards in their hand, no arithmetic)
// ---------------------------------------------------------------------------

describe('Slice 8 — deals X damage to that player, where X is the number of cards in their hand', () => {
  const clause = 'This creature deals X damage to that player, where X is the number of cards in their hand.';

  it('parses as a Spell effect with DealDamage + ForEach(hand, eventPlayer)', () => {
    const parsed = parseOracleText(clause);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amt = eff.amount as ForEachAmount;
    expect(amt.kind).toBe('ForEach');
    expect(amt.zone).toBe('hand');
    expect(amt.controller).toBe('eventPlayer');
  });

  it('parses inside a trigger (each opponent upkeep form)', () => {
    const fullTrigger =
      "At the beginning of each opponent's upkeep, this creature deals X damage to that player, where X is the number of cards in their hand.";
    const parsed = parseOracleText(fullTrigger);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amt = eff.amount as ForEachAmount;
    expect(amt.kind).toBe('ForEach');
    expect(amt.zone).toBe('hand');
    expect(amt.controller).toBe('eventPlayer');
  });

  it('executes: deals damage equal to event player hand size', () => {
    const cardDef = makeCardDef('spell-def', 'Shock', 'Instant');

    // p2 has 3 cards in hand
    let state = baseState();
    state = addCard(state, 'c1', cardDef, 'p2', 'hand');
    state = addCard(state, 'c2', cardDef, 'p2', 'hand');
    state = addCard(state, 'c3', cardDef, 'p2', 'hand');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' } as ForEachAmount,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // p2 had 3 cards in hand → 3 damage (starts at 40)
    expect(lifeOf(result, 'p2')).toBe(37);
    // p1 unaffected
    expect(lifeOf(result, 'p1')).toBe(40);
  });

  it('executes: deals 0 when event player has empty hand', () => {
    const state = baseState(); // no cards added

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' } as ForEachAmount,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 0 cards in hand → 0 damage
    expect(lifeOf(result, 'p2')).toBe(40);
    expect(lifeOf(result, 'p1')).toBe(40);
  });

  it('executes: counts only the event player hand, not the caster hand', () => {
    const cardDef = makeCardDef('spell-def', 'Shock', 'Instant');

    // p1 (caster) has 5 cards in hand, p2 (event player) has 2
    let state = baseState();
    state = addCard(state, 'p1c1', cardDef, 'p1', 'hand');
    state = addCard(state, 'p1c2', cardDef, 'p1', 'hand');
    state = addCard(state, 'p1c3', cardDef, 'p1', 'hand');
    state = addCard(state, 'p1c4', cardDef, 'p1', 'hand');
    state = addCard(state, 'p1c5', cardDef, 'p1', 'hand');
    state = addCard(state, 'p2c1', cardDef, 'p2', 'hand');
    state = addCard(state, 'p2c2', cardDef, 'p2', 'hand');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' } as ForEachAmount,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // p2 had 2 cards → 2 damage
    expect(lifeOf(result, 'p2')).toBe(38);
    // p1 unaffected
    expect(lifeOf(result, 'p1')).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 2. "deals X damage to that player, where X is the number of creature cards
//    in their graveyard"
// ---------------------------------------------------------------------------

describe('Slice 8 — deals X damage to that player, where X is the number of cards in their graveyard', () => {
  it('parses: ForEach(graveyard, eventPlayer)', () => {
    const clause = 'This enchantment deals X damage to that player, where X is the number of creature cards in their graveyard.';
    const parsed = parseOracleText(clause);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amt = eff.amount as ForEachAmount;
    expect(amt.kind).toBe('ForEach');
    expect(amt.zone).toBe('graveyard');
    expect(amt.controller).toBe('eventPlayer');
    expect(amt.filter).toMatchObject({ types: ['creature'] });
  });

  it('executes: counts creature cards in event player graveyard', () => {
    const creatureDef = makeCardDef('cre-def', 'Bear', 'Creature — Bear');
    const instantDef = makeCardDef('inst-def', 'Shock', 'Instant');

    // p2 has 3 creature cards + 1 instant in graveyard
    let state = baseState();
    state = addCard(state, 'g1', creatureDef, 'p2', 'graveyard');
    state = addCard(state, 'g2', creatureDef, 'p2', 'graveyard');
    state = addCard(state, 'g3', creatureDef, 'p2', 'graveyard');
    state = addCard(state, 'g4', instantDef,  'p2', 'graveyard');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: {
        kind: 'ForEach', zone: 'graveyard', controller: 'eventPlayer',
        filter: { types: ['creature'] },
      } as ForEachAmount,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 3 creature cards → 3 damage
    expect(lifeOf(result, 'p2')).toBe(37);
    expect(lifeOf(result, 'p1')).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 3. "this artifact deals X damage to that player, where X is the number
//    of cards in their hand" — artifact subject variant
// ---------------------------------------------------------------------------

describe('Slice 8 — artifact subject form', () => {
  it('parses with "this artifact" subject', () => {
    const clause = 'This artifact deals X damage to that player, where X is the number of cards in their hand.';
    const parsed = parseOracleText(clause);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amt = eff.amount as ForEachAmount;
    expect(amt.kind).toBe('ForEach');
    expect(amt.zone).toBe('hand');
    expect(amt.controller).toBe('eventPlayer');
  });
});

// ---------------------------------------------------------------------------
// 4. Declined cases — honest bar
// ---------------------------------------------------------------------------

describe('Slice 8 — honest declines', () => {
  it('declines "where X is the number of cards in their hand minus 4" (arithmetic)', () => {
    // Viseling: "this creature deals X damage to that player, where X is the number
    // of cards in their hand minus 4." — arithmetic subtraction not supported.
    const parsed = parseOracleText(
      "At the beginning of each opponent's upkeep, this creature deals X damage to that player, where X is the number of cards in their hand minus 4.",
    );
    // Should stay Unparsed (or parse the upkeep trigger with an Unparsed body)
    // The matcher must not claim to parse the arithmetic form.
    if (parsed.kind === 'Triggered') {
      // If the trigger prefix is parsed, the body must fail → effects empty or Unparsed body
      expect(parsed.ability.effects.length).toBe(0);
    } else {
      expect(parsed.kind).toBe('Unparsed');
    }
  });

  it('parses "where X is the number of untapped lands they control" (Citadel of Pain, slice 7)', () => {
    // Citadel of Pain: untapped-land counting is now supported as of slice 7.
    // The "tapped: false" CardFilter is applied in resolveForEachCount (executor.ts).
    const parsed = parseOracleText(
      "At the beginning of each player's end step, this enchantment deals X damage to that player, where X is the number of untapped lands they control.",
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.effects.length).toBeGreaterThan(0);
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    // Amount is a ForEach counting untapped lands controlled by the event player.
    const amount = eff.amount as import('../effects/ast').ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.filter?.tapped).toBe(false);
    expect(amount.filter?.types).toContain('land');
  });
});

// ---------------------------------------------------------------------------
// 5. EventPlayer symmetry: switching eventPlayerId switches the target
// ---------------------------------------------------------------------------

describe('Slice 8 — EventPlayer symmetry across players', () => {
  it('damages p1 when eventPlayerId is p1 (their upkeep)', () => {
    const cardDef = makeCardDef('card-def', 'Lightning Bolt', 'Instant');
    // p1 has 4 cards in hand; p2 has 1
    let state = baseState();
    state = addCard(state, 'p1h1', cardDef, 'p1', 'hand');
    state = addCard(state, 'p1h2', cardDef, 'p1', 'hand');
    state = addCard(state, 'p1h3', cardDef, 'p1', 'hand');
    state = addCard(state, 'p1h4', cardDef, 'p1', 'hand');
    state = addCard(state, 'p2h1', cardDef, 'p2', 'hand');

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' } as ForEachAmount,
    }];

    // p1's upkeep
    const result = executeEffects(state, effects, 'p2', [], [], 0, {
      eventContext: { eventPlayerId: 'p1' },
    });
    // p1 had 4 cards → 4 damage
    expect(lifeOf(result, 'p1')).toBe(36);
    expect(lifeOf(result, 'p2')).toBe(40);
  });

  it('damages p2 when eventPlayerId is p2 (their upkeep)', () => {
    const cardDef = makeCardDef('card-def2', 'Lightning Bolt', 'Instant');
    // p2 has 2 cards in hand; p1 has 5
    let state = baseState();
    state = addCard(state, 'p2h1', cardDef, 'p2', 'hand');
    state = addCard(state, 'p2h2', cardDef, 'p2', 'hand');
    ['a','b','c','d','e'].forEach(x => {
      state = addCard(state, `p1h${x}`, cardDef, 'p1', 'hand');
    });

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: { kind: 'ForEach', zone: 'hand', controller: 'eventPlayer' } as ForEachAmount,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // p2 had 2 cards → 2 damage
    expect(lifeOf(result, 'p2')).toBe(38);
    expect(lifeOf(result, 'p1')).toBe(40);
  });
});
