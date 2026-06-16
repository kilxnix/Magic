/**
 * Coverage slice 3/11 — Per-player / per-opponent upkeep dynamic-X damage trigger
 * using "that player controls" wording (distinct from "they control").
 *
 * Covered oracle shapes:
 *   Viseling      — "deals X damage to that player, where X is the number of cards in their hand."
 *                   (already parses; verified here for completeness)
 *   Power Surge   — "deals X damage to that player, where X is the number of untapped lands
 *                    that player controls." (the NEW case: "that player controls" vs "they control")
 *   Price of Knowledge — "deals damage to that player equal to the number of cards in their hand."
 *                   (already parses; verified here for completeness)
 *
 * Each test verifies both PARSE (AST shape) and EXECUTION via executeEffects
 * with eventContext.eventPlayerId set to the active player for the trigger.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect, ForEachAmount } from '../effects/ast';
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
  supertypes: string[] = [],
): CardDefinition {
  const cardTypes = typeLine.toLowerCase().split(/[\s—–-]/).filter(t =>
    ['creature', 'instant', 'sorcery', 'enchantment', 'artifact', 'land', 'planeswalker'].includes(t),
  );
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: cmc ? `{${cmc}}` : '',
    cmc,
    colors,
    color_identity: colors,
    keywords: [],
    card_types: cardTypes,
    supertypes,
  };
}

function addBattlefieldCard(
  state: GameState,
  instanceId: string,
  def: CardDefinition,
  ownerId: string,
  tapped = false,
): GameState {
  const newCards = new Map(state.cards);
  const defs = new Map(state.cardDefinitions);
  defs.set(def.id, def);
  newCards.set(instanceId, {
    instanceId,
    definitionId: def.id,
    ownerId,
    zone: 'battlefield',
    tapped,
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

function lifeOf(state: GameState, playerId: string): number {
  return state.players.find(p => p.id === playerId)?.life ?? 20;
}

// ---------------------------------------------------------------------------
// 1. Power Surge wording — "that player controls" (the new case)
// ---------------------------------------------------------------------------

// Simplified Power Surge without the snapshot qualifier (which the engine honestly declines).
// Real Power Surge says "they controlled at the beginning of this turn" — the engine declines
// that snapshot form. Here we test the present-tense "that player controls" wording that IS
// supported and is found on other cards.
const POWER_SURGE_SIMPLE_ORACLE =
  "At the beginning of each player's upkeep, this enchantment deals X damage to that player, where X is the number of untapped lands that player controls.";

describe('Slice 3/11 — Power Surge style: "that player controls" present-tense wording', () => {
  it('parses the full trigger oracle text with "that player controls"', () => {
    const parsed = parseOracleText(POWER_SURGE_SIMPLE_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    expect((parsed.ability.trigger as { kind: string; whose?: string }).whose).toBe('each');
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('battlefield');
    expect(amount.controller).toBe('eventPlayer');
    expect(amount.filter?.tapped).toBe(false);
    expect(amount.filter?.types).toContain('land');
  });

  it('parses the standalone clause with "that player controls"', () => {
    const clause =
      'This enchantment deals X damage to that player, where X is the number of untapped lands that player controls.';
    const parsed = parseOracleText(clause);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('battlefield');
    expect(amount.controller).toBe('eventPlayer');
    expect(amount.filter?.tapped).toBe(false);
    expect(amount.filter?.types).toContain('land');
  });

  it('executes damage equal to untapped lands "that player controls"', () => {
    const landDef = makeCardDef('forest-def', 'Forest', 'Basic Land', 0, [], ['basic']);
    let state = baseState();
    // p2 (event player) controls 3 untapped and 2 tapped lands
    state = addBattlefieldCard(state, 'l1', landDef, 'p2', false);
    state = addBattlefieldCard(state, 'l2', landDef, 'p2', false);
    state = addBattlefieldCard(state, 'l3', landDef, 'p2', false);
    state = addBattlefieldCard(state, 'l4', landDef, 'p2', true);
    state = addBattlefieldCard(state, 'l5', landDef, 'p2', true);

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: {
        kind: 'ForEach',
        zone: 'battlefield',
        controller: 'eventPlayer',
        filter: { types: ['land'], tapped: false },
      },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 3 untapped lands -> 3 damage; p2 starts at 40
    expect(lifeOf(result, 'p2')).toBe(37);
    expect(lifeOf(result, 'p1')).toBe(40);
  });

  it('counts only the event player\'s lands, not the caster\'s', () => {
    const landDef = makeCardDef('island-def', 'Island', 'Basic Land', 0, [], ['basic']);
    let state = baseState();
    // p1 (caster) controls 5 untapped lands — should NOT count
    for (let i = 0; i < 5; i++) {
      state = addBattlefieldCard(state, `p1-land-${i}`, landDef, 'p1', false);
    }
    // p2 (event player) controls 2 untapped lands
    state = addBattlefieldCard(state, 'p2-l1', landDef, 'p2', false);
    state = addBattlefieldCard(state, 'p2-l2', landDef, 'p2', false);

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: {
        kind: 'ForEach',
        zone: 'battlefield',
        controller: 'eventPlayer',
        filter: { types: ['land'], tapped: false },
      },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // Only p2's 2 untapped lands → 2 damage; p2 starts at 40
    expect(lifeOf(result, 'p2')).toBe(38);
    expect(lifeOf(result, 'p1')).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 2. Opponent-upkeep variant — "each opponent's upkeep" + "that player controls"
// ---------------------------------------------------------------------------

const OPPONENT_UPKEEP_ORACLE =
  "At the beginning of each opponent's upkeep, this enchantment deals X damage to that player, where X is the number of untapped lands that player controls.";

describe('Slice 3/11 — opponent upkeep variant with "that player controls"', () => {
  it('parses the opponent-upkeep trigger with "that player controls"', () => {
    const parsed = parseOracleText(OPPONENT_UPKEEP_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    expect((parsed.ability.trigger as { kind: string; whose?: string }).whose).toBe('opponents');
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.controller).toBe('eventPlayer');
    expect(amount.filter?.tapped).toBe(false);
  });

  it('executes damage to opponent based on their untapped land count', () => {
    const landDef = makeCardDef('swamp-def', 'Swamp', 'Basic Land', 0, [], ['basic']);
    let state = baseState();
    // p2 is the "opponent" (event player) — controls 4 untapped lands
    for (let i = 0; i < 4; i++) {
      state = addBattlefieldCard(state, `p2-l${i}`, landDef, 'p2', false);
    }

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: {
        kind: 'ForEach',
        zone: 'battlefield',
        controller: 'eventPlayer',
        filter: { types: ['land'], tapped: false },
      },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 4 untapped lands → 4 damage; p2 starts at 40
    expect(lifeOf(result, 'p2')).toBe(36);
    expect(lifeOf(result, 'p1')).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 3. Viseling — "where X is the number of cards in their hand" (already works;
//    verified here for regression coverage)
// ---------------------------------------------------------------------------

const VISELING_ORACLE =
  "At the beginning of each opponent's upkeep, this creature deals X damage to that player, where X is the number of cards in their hand.";

describe('Slice 3/11 — Viseling: "in their hand" (regression)', () => {
  it('parses the full trigger oracle text', () => {
    const parsed = parseOracleText(VISELING_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('hand');
    expect(amount.controller).toBe('eventPlayer');
  });

  it('executes damage equal to opponent hand size', () => {
    const cardDef = makeCardDef('bolt-def', 'Lightning Bolt', 'Instant', 1);
    let state = baseState();
    // p2 has 5 cards in hand
    for (let i = 0; i < 5; i++) {
      state = addHandCard(state, `p2-h${i}`, cardDef, 'p2');
    }

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: {
        kind: 'ForEach',
        zone: 'hand',
        controller: 'eventPlayer',
      },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 5 cards in hand → 5 damage; p2 starts at 40
    expect(lifeOf(result, 'p2')).toBe(35);
    expect(lifeOf(result, 'p1')).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 4. Price of Knowledge — "deals damage to that player equal to the number of
//    cards in their hand" (already works; regression)
// ---------------------------------------------------------------------------

const PRICE_OF_KNOWLEDGE_ORACLE =
  "At the beginning of each opponent's upkeep, this enchantment deals damage to that player equal to the number of cards in their hand.";

describe('Slice 3/11 — Price of Knowledge: "equal to the number of cards in their hand" (regression)', () => {
  it('parses the full trigger oracle text', () => {
    const parsed = parseOracleText(PRICE_OF_KNOWLEDGE_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('hand');
    expect(amount.controller).toBe('eventPlayer');
  });

  it('executes damage equal to hand size', () => {
    const cardDef = makeCardDef('card-def', 'Test Card', 'Instant', 1);
    let state = baseState();
    // p2 has 3 cards in hand
    for (let i = 0; i < 3; i++) {
      state = addHandCard(state, `p2-h${i}`, cardDef, 'p2');
    }

    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisPermanent' },
      target: { kind: 'EventPlayer' },
      amount: {
        kind: 'ForEach',
        zone: 'hand',
        controller: 'eventPlayer',
      },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });

    // 3 cards in hand → 3 damage; p2 starts at 40
    expect(lifeOf(result, 'p2')).toBe(37);
    expect(lifeOf(result, 'p1')).toBe(40);
  });
});

// ---------------------------------------------------------------------------
// 5. Honesty gate — "that player controlled" with snapshot qualifier must decline
// ---------------------------------------------------------------------------

describe('Slice 3/11 — Honesty gate: snapshot "that player controlled at the beginning" is declined', () => {
  it('declines "untapped lands that player controlled at the beginning of this turn"', () => {
    const clause =
      'This enchantment deals X damage to that player, where X is the number of untapped lands that player controlled at the beginning of this turn.';
    const parsed = parseOracleText(clause);
    // Must NOT parse as DealDamage with a snapshot amount
    if (parsed.kind === 'Spell' && parsed.effects.length > 0) {
      const eff = parsed.effects[0];
      if (eff.kind === 'DealDamage') {
        const amount = eff.amount as ForEachAmount;
        // Should NOT have matched with the "that player controlled at the beginning" snapshot
        expect(amount.kind).not.toBe('ForEach');
      }
    } else {
      // Unparsed is the honest outcome
      expect(parsed.kind).toBe('Unparsed');
    }
  });
});
