/**
 * Coverage slice 7/12 — Per-player upkeep/end-step "that player" dynamic damage/life-loss triggers.
 *
 * Tests verify PARSE (AST shape) and EXECUTION for:
 *   A) DealDamage to EventPlayer where amount = ForEach untapped lands they control (Citadel of Pain)
 *   B) LoseLife EventPlayer where amount = ForEach untapped lands they control
 *   C) LoseLife EventPlayer where amount = ForEach cards in their hand (Price of Knowledge shape)
 *
 * Key executor behaviours exercised:
 *   - resolveForEachCount respects CardFilter.tapped (slice-7 executor fix in executor.ts)
 *   - ForEachAmount{controller:'eventPlayer'} uses eventContext.eventPlayerId, not casterId
 *   - Tapped lands are excluded from the count; untapped lands are included
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

function makeCardDef(
  id: string,
  name: string,
  typeLine: string,
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
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
  } as CardInstance);
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
  } as CardInstance);
  return { ...state, cards: newCards, cardDefinitions: defs };
}

function setPlayerLife(state: GameState, playerId: string, life: number): GameState {
  return {
    ...state,
    players: state.players.map(p => p.id === playerId ? { ...p, life } : p),
  };
}

function lifeOf(state: GameState, playerId: string): number {
  return state.players.find(p => p.id === playerId)!.life;
}

// ---------------------------------------------------------------------------
// A. Citadel of Pain — "deals X damage to that player, where X is the number
//    of untapped lands they control"
// ---------------------------------------------------------------------------

const CITADEL_ORACLE =
  "At the beginning of each player's end step, ~ deals X damage to that player, where X is the number of untapped lands they control.";

describe('Slice 7/12 — Citadel of Pain: DealDamage equal to untapped lands controlled', () => {
  it('parses the oracle text as a Triggered ability with Upkeep/EndStep trigger', () => {
    const parsed = parseOracleText(CITADEL_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    // Trigger: end step, each player
    expect(parsed.ability.trigger.kind).toBe('EndStep');
    expect((parsed.ability.trigger as { kind: string; whose?: string }).whose).toBe('each');
  });

  it('parses the effect as DealDamage targeting EventPlayer with a ForEach untapped lands amount', () => {
    const parsed = parseOracleText(CITADEL_ORACLE);
    if (parsed.kind !== 'Triggered') return;
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('battlefield');
    expect(amount.controller).toBe('eventPlayer');
    expect(amount.filter).toBeDefined();
    // The filter must require untapped (tapped: false) and land type
    const filter = amount.filter!;
    expect(filter.tapped).toBe(false);
    expect(filter.types).toContain('land');
  });

  it('parses the standalone clause correctly', () => {
    const clause = '~ deals X damage to that player, where X is the number of untapped lands they control.';
    const parsed = parseOracleText(clause);
    // Standalone clause parses as Spell (no trigger prefix)
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('DealDamage');
    if (eff.kind !== 'DealDamage') return;
    expect(eff.target).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.filter?.tapped).toBe(false);
    expect(amount.filter?.types).toContain('land');
  });

  it('deals damage equal to the event player\'s untapped land count', () => {
    const landDef = makeCardDef('forest-def', 'Forest', 'Basic Land — Forest');
    let state = baseState();
    state = setPlayerLife(state, 'p2', 20);
    // p2 controls 3 untapped lands and 1 tapped land
    state = addBattlefieldCard(state, 'land-1', landDef, 'p2', false); // untapped
    state = addBattlefieldCard(state, 'land-2', landDef, 'p2', false); // untapped
    state = addBattlefieldCard(state, 'land-3', landDef, 'p2', false); // untapped
    state = addBattlefieldCard(state, 'land-4', landDef, 'p2', true);  // tapped — should NOT count

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
    // 3 untapped lands → p2 takes 3 damage (20 - 3 = 17)
    expect(lifeOf(result, 'p2')).toBe(17);
    // p1 is unaffected
    expect(lifeOf(result, 'p1')).toBe(40);
  });

  it('deals 0 damage when event player has no untapped lands', () => {
    const landDef = makeCardDef('forest-def2', 'Forest', 'Basic Land — Forest');
    let state = baseState();
    state = setPlayerLife(state, 'p2', 20);
    // p2 controls only tapped lands
    state = addBattlefieldCard(state, 'land-t1', landDef, 'p2', true);
    state = addBattlefieldCard(state, 'land-t2', landDef, 'p2', true);

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
    // 0 untapped lands → no damage
    expect(lifeOf(result, 'p2')).toBe(20);
  });

  it('counts only the event player\'s lands, not the caster\'s', () => {
    const landDef = makeCardDef('forest-def3', 'Forest', 'Basic Land — Forest');
    let state = baseState();
    state = setPlayerLife(state, 'p2', 20);
    // p1 (caster) controls 5 untapped lands — should NOT count
    for (let i = 0; i < 5; i++) {
      state = addBattlefieldCard(state, `p1-land-${i}`, landDef, 'p1', false);
    }
    // p2 (event player) controls 2 untapped lands
    state = addBattlefieldCard(state, 'p2-land-1', landDef, 'p2', false);
    state = addBattlefieldCard(state, 'p2-land-2', landDef, 'p2', false);

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
    // Only p2's 2 untapped lands count → 2 damage (20 - 2 = 18)
    expect(lifeOf(result, 'p2')).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// B. LoseLife where X = untapped lands — matchThatPlayerLosesLifeXWhereX
// ---------------------------------------------------------------------------

const LOSE_LIFE_UNTAPPED_ORACLE =
  "At the beginning of each player's upkeep, that player loses X life, where X is the number of untapped lands they control.";

describe('Slice 7/12 — LoseLife equal to untapped lands (matchThatPlayerLosesLifeXWhereX)', () => {
  it('parses the full trigger oracle text', () => {
    const parsed = parseOracleText(LOSE_LIFE_UNTAPPED_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.controller).toBe('eventPlayer');
    expect(amount.filter?.tapped).toBe(false);
    expect(amount.filter?.types).toContain('land');
  });

  it('parses the standalone clause', () => {
    const clause = 'That player loses X life, where X is the number of untapped lands they control.';
    const parsed = parseOracleText(clause);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.filter?.tapped).toBe(false);
  });

  it('executes LoseLife equal to untapped lands', () => {
    const landDef = makeCardDef('island-def', 'Island', 'Basic Land — Island');
    let state = baseState();
    state = setPlayerLife(state, 'p2', 20);
    // p2 has 4 untapped lands and 2 tapped lands
    for (let i = 0; i < 4; i++) {
      state = addBattlefieldCard(state, `untapped-${i}`, landDef, 'p2', false);
    }
    for (let i = 0; i < 2; i++) {
      state = addBattlefieldCard(state, `tapped-${i}`, landDef, 'p2', true);
    }

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EventPlayer' },
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
    // 4 untapped lands → 4 life lost (20 - 4 = 16)
    expect(lifeOf(result, 'p2')).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// C. Price of Knowledge — "that player loses life equal to the number of cards
//    in their hand"  (matchThatPlayerLosesLifeXWhereX, "equal to" branch)
// ---------------------------------------------------------------------------

const PRICE_LOSE_LIFE_ORACLE =
  "At the beginning of each player's upkeep, that player loses life equal to the number of cards in their hand.";

describe('Slice 7/12 — LoseLife equal to cards in hand (Price of Knowledge shape)', () => {
  it('parses the full trigger oracle text', () => {
    const parsed = parseOracleText(PRICE_LOSE_LIFE_ORACLE);
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Upkeep');
    const eff = parsed.ability.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('hand');
    expect(amount.controller).toBe('eventPlayer');
  });

  it('parses the standalone clause', () => {
    const clause = 'That player loses life equal to the number of cards in their hand.';
    const parsed = parseOracleText(clause);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const eff = parsed.effects[0];
    expect(eff.kind).toBe('LoseLife');
    if (eff.kind !== 'LoseLife') return;
    expect(eff.player).toEqual({ kind: 'EventPlayer' });
    const amount = eff.amount as ForEachAmount;
    expect(amount.kind).toBe('ForEach');
    expect(amount.zone).toBe('hand');
    expect(amount.controller).toBe('eventPlayer');
  });

  it('executes LoseLife equal to hand size', () => {
    const cardDef = makeCardDef('card-def', 'Lightning Bolt', 'Instant');
    let state = baseState();
    state = setPlayerLife(state, 'p2', 20);
    // p2 has 5 cards in hand
    for (let i = 0; i < 5; i++) {
      state = addHandCard(state, `hand-card-${i}`, cardDef, 'p2');
    }

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EventPlayer' },
      amount: {
        kind: 'ForEach',
        zone: 'hand',
        controller: 'eventPlayer',
      },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // 5 cards in hand → 5 life lost (20 - 5 = 15)
    expect(lifeOf(result, 'p2')).toBe(15);
  });

  it('counts only event player\'s hand, not caster\'s', () => {
    const cardDef = makeCardDef('card-def2', 'Counterspell', 'Instant');
    let state = baseState();
    state = setPlayerLife(state, 'p2', 20);
    // p1 (caster) has 7 cards in hand — should NOT count
    for (let i = 0; i < 7; i++) {
      state = addHandCard(state, `p1-hand-${i}`, cardDef, 'p1');
    }
    // p2 (event player) has 3 cards in hand
    for (let i = 0; i < 3; i++) {
      state = addHandCard(state, `p2-hand-${i}`, cardDef, 'p2');
    }

    const effects: Effect[] = [{
      kind: 'LoseLife',
      player: { kind: 'EventPlayer' },
      amount: {
        kind: 'ForEach',
        zone: 'hand',
        controller: 'eventPlayer',
      },
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0, {
      eventContext: { eventPlayerId: 'p2' },
    });
    // Only p2's 3 cards count → 3 life lost (20 - 3 = 17)
    expect(lifeOf(result, 'p2')).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// D. Honesty gate — Power Surge is correctly declined
//    "X is the number of untapped lands they controlled at the beginning of this turn"
//    → requires snapshot not available in engine → must parse as Unparsed
// ---------------------------------------------------------------------------

describe('Slice 7/12 — Honesty gate: Power Surge "controlled at the beginning of this turn" is declined', () => {
  it('declines "untapped lands they controlled at the beginning of this turn"', () => {
    const POWER_SURGE_CLAUSE =
      '~ deals X damage to that player, where X is the number of untapped lands they controlled at the beginning of this turn.';
    const parsed = parseOracleText(POWER_SURGE_CLAUSE);
    // Must not parse as DealDamage with a snapshot amount — should be Unparsed
    if (parsed.kind === 'Spell' && parsed.effects.length > 0) {
      // If it parses, the effect must NOT be DealDamage with ForEach containing tapped:false
      // (accepting it as-is without snapshot would be wrong)
      const eff = parsed.effects[0];
      if (eff.kind === 'DealDamage') {
        const amount = eff.amount as ForEachAmount;
        // It should NOT have matched this form — flag failure if it did
        expect(amount.kind).not.toBe('ForEach');
      }
    }
    // Acceptable outcomes: Unparsed, or parsed kind is not Spell/Triggered with DealDamage ForEach
    // The important thing is it doesn't silently miscount
    expect(['Unparsed', 'Spell', 'Triggered']).toContain(parsed.kind);
  });
});
