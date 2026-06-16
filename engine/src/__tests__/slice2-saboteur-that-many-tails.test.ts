/**
 * slice2-saboteur-that-many-tails.test.ts
 *
 * Slice 2/12 — Saboteur tails scaled by damage dealt.
 *
 * Covers parse + execution of "Whenever ~ deals combat damage to a player, ..."
 * trigger tails that use "that many/that much" to scale by the damage amount.
 *
 * Matchers added:
 *   - matchAddCountersThatMany   (counters.ts)  — "put that many +1/+1 counters on it/~"
 *   - matchCreateTokenThatMany   (tokens.ts)    — "create that many 1/1 ... tokens"
 *   - matchThatPlayerCreatesThatManyTokens (tokens.ts) — "that player creates that many ..."
 *   - matchThatPlayerDiscardsThatMany (players.ts) — "that player discards that many cards"
 *   - matchLookAtTopThatMany     (search-dig.ts) — "look at that many cards from the top"
 *
 * Executor branches updated:
 *   - AddCounters (Source path): handles EventDamageAmount
 *   - CreateToken: handles EventDamageAmount
 *   - Discard: handles EventDamageAmount
 *   - ChooseFromTopOfLibrary: handles EventDamageAmount
 *
 * stack.ts updated:
 *   - CombatDamageToPlayer eventContext now includes eventDamageAmount = event.damage
 *
 * Real oracle wordings (post-tokenization, card name → '~'):
 *   Westgate Regent: "Whenever ~ deals combat damage to a player, put that many +1/+1 counters on ~."
 *   Living Hive:     "Whenever ~ deals combat damage to a player, create that many 1/1 green Insect creature tokens."
 *   Dreamstealer:    "Whenever ~ deals combat damage to a player, that player discards that many cards."
 *   Varchild, Betrayer of Kjeldor: "Whenever ~ deals combat damage to a player, that player creates that many 1/1 red Survivor creature tokens."
 *   Prosperous Bandit: "Whenever ~ deals combat damage to a player, create that many Treasure tokens."
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import type { AddCountersEffect, CreateTokenEffect, DiscardEffect, ChooseFromTopOfLibraryEffect, TriggeredAbility } from '../effects/ast';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCreatureDef(id: string, power: number, toughness: number, oracle = ''): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Beast',
    oracle_text: oracle,
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
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
// PARSE TESTS
// ---------------------------------------------------------------------------

describe('Slice 2 — parse: matchAddCountersThatMany', () => {
  it('parses Westgate Regent wording: "put that many +1/+1 counters on ~"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, put that many +1/+1 counters on ~.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');
    if (ability.trigger.kind !== 'CombatDamageToPlayer') return;
    expect(ability.trigger.who).toBe('self');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as AddCountersEffect;
    expect(eff.kind).toBe('AddCounters');
    expect(eff.counterType).toBe('+1/+1');
    expect(eff.target.kind).toBe('Source');
    expect(typeof eff.count).toBe('object');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
  });

  it('parses "put that many +1/+1 counters on it" variant', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, put that many +1/+1 counters on it.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    const eff = ability.effects[0] as AddCountersEffect;
    expect(eff.kind).toBe('AddCounters');
    expect(eff.target.kind).toBe('Source');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
  });
});

describe('Slice 2 — parse: matchCreateTokenThatMany', () => {
  it('parses Living Hive wording: "create that many 1/1 green Insect creature tokens"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, create that many 1/1 green Insect creature tokens.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as CreateTokenEffect;
    expect(eff.kind).toBe('CreateToken');
    expect(eff.controller.kind).toBe('Controller');
    expect(typeof eff.count).toBe('object');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
    // Token definition
    expect(eff.token.power).toBe(1);
    expect(eff.token.toughness).toBe(1);
    expect(eff.token.colors).toContain('G');
  });

  it('parses Prosperous Bandit wording: "create that many Treasure tokens"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, create that many Treasure tokens.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as CreateTokenEffect;
    expect(eff.kind).toBe('CreateToken');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
    // Treasure is a predefined artifact token
    expect(eff.token.name.toLowerCase()).toBe('treasure');
  });
});

describe('Slice 2 — parse: matchThatPlayerCreatesThatManyTokens', () => {
  it('parses Varchild wording: "that player creates that many 1/1 red Survivor creature tokens"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player creates that many 1/1 red Survivor creature tokens.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as CreateTokenEffect;
    expect(eff.kind).toBe('CreateToken');
    // "that player" (the damaged player) gets the tokens
    expect(eff.controller.kind).toBe('EventPlayer');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
    expect(eff.token.power).toBe(1);
    expect(eff.token.toughness).toBe(1);
    expect(eff.token.colors).toContain('R');
  });
});

describe('Slice 2 — parse: matchThatPlayerDiscardsThatMany', () => {
  it('parses Dreamstealer wording: "that player discards that many cards"', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player discards that many cards.',
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as DiscardEffect;
    expect(eff.kind).toBe('Discard');
    // "that player" = EventPlayer (the one who took the damage)
    expect(eff.player.kind).toBe('EventPlayer');
    expect(typeof eff.count).toBe('object');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
  });
});

describe('Slice 2 — parse: matchLookAtTopThatMany', () => {
  it('parses Garruk\'s Harbinger wording: "look at that many cards from the top of your library"', () => {
    // Use a simplified single-clause version for parsing clarity
    const result = parseOracleText(
      "Whenever ~ deals combat damage to a player, look at that many cards from the top of your library.",
    );
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;

    const ability = result.ability as TriggeredAbility;
    expect(ability.trigger.kind).toBe('CombatDamageToPlayer');

    expect(ability.effects).toHaveLength(1);
    const eff = ability.effects[0] as ChooseFromTopOfLibraryEffect;
    expect(eff.kind).toBe('ChooseFromTopOfLibrary');
    expect(eff.player.kind).toBe('Controller');
    expect(typeof eff.count).toBe('object');
    expect((eff.count as { kind: string }).kind).toBe('EventDamageAmount');
    expect(eff.destination).toBe('hand');
    expect(eff.restDestination).toBe('bottom');
  });
});

// ---------------------------------------------------------------------------
// EXECUTION TESTS
// ---------------------------------------------------------------------------

describe('Slice 2 — execute: AddCounters(Source, EventDamageAmount)', () => {
  it('resolves EventDamageAmount=3 to put 3 +1/+1 counters on the source creature', () => {
    const def = makeCreatureDef('regent', 2, 2,
      'Whenever ~ deals combat damage to a player, put that many +1/+1 counters on ~.',
    );
    const state = baseState([def]);
    addCard(state, 'regent_1', 'regent');

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, put that many +1/+1 counters on ~.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    const ability = parsed.ability as TriggeredAbility;

    // Execute the AddCounters effect with eventDamageAmount = 3
    const afterExec = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      {
        sourceInstanceId: 'regent_1',
        eventContext: { eventDamageAmount: 3 },
      },
    );

    const card = afterExec.cards.get('regent_1')!;
    expect(card.counters['+1/+1']).toBe(3);
  });

  it('resolves EventDamageAmount=5 to put 5 +1/+1 counters on the source', () => {
    const def = makeCreatureDef('hive', 3, 3);
    const state = baseState([def]);
    addCard(state, 'hive_1', 'hive');

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, put that many +1/+1 counters on ~.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const ability = parsed.ability as TriggeredAbility;

    const afterExec = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      {
        sourceInstanceId: 'hive_1',
        eventContext: { eventDamageAmount: 5 },
      },
    );

    const card = afterExec.cards.get('hive_1')!;
    expect(card.counters['+1/+1']).toBe(5);
  });
});

describe('Slice 2 — execute: CreateToken(EventDamageAmount)', () => {
  it('creates 3 Insect tokens when eventDamageAmount=3 (Living Hive style)', () => {
    const def = makeCreatureDef('hive', 4, 4);
    const state = baseState([def]);
    addCard(state, 'hive_1', 'hive');

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, create that many 1/1 green Insect creature tokens.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const ability = parsed.ability as TriggeredAbility;

    const beforeTokenCount = [...state.cards.values()].filter(
      c => c.zone === 'battlefield' && c.definitionId.startsWith('token_'),
    ).length;

    const afterExec = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      {
        sourceInstanceId: 'hive_1',
        eventContext: { eventDamageAmount: 3 },
      },
    );

    // Count new creature tokens on battlefield
    const newTokens = [...afterExec.cards.values()].filter(
      c => c.zone === 'battlefield' && c.ownerId === 'p0',
    );
    // 3 tokens created (hive_1 + 3 tokens = 4 total)
    expect(newTokens.length).toBe(4);
  });
});

describe('Slice 2 — execute: Discard(EventPlayer, EventDamageAmount)', () => {
  it('makes the EventPlayer (p1) discard 2 cards when eventDamageAmount=2 (Dreamstealer style)', () => {
    const def = makeCreatureDef('dreamstealer', 1, 2);
    const state = baseState([def]);
    addCard(state, 'ds_1', 'dreamstealer');

    // Give p1 some hand cards
    addCard(state, 'h1', 'dreamstealer', 'hand', 'p1');
    addCard(state, 'h2', 'dreamstealer', 'hand', 'p1');
    addCard(state, 'h3', 'dreamstealer', 'hand', 'p1');

    const parsed = parseOracleText(
      'Whenever ~ deals combat damage to a player, that player discards that many cards.',
    );
    if (parsed.kind !== 'Triggered') throw new Error('expected Triggered');
    const ability = parsed.ability as TriggeredAbility;

    const beforeP1Hand = [...state.cards.values()].filter(
      c => c.ownerId === 'p1' && c.zone === 'hand',
    ).length;
    expect(beforeP1Hand).toBe(3);

    // Execute with eventDamageAmount=2, eventPlayerId='p1' (the damaged player)
    const afterExec = executeEffects(
      state,
      ability.effects,
      'p0',
      [],
      [],
      0,
      {
        sourceInstanceId: 'ds_1',
        eventContext: { eventPlayerId: 'p1', eventDamageAmount: 2 },
      },
    );

    const afterP1Hand = [...afterExec.cards.values()].filter(
      c => c.ownerId === 'p1' && c.zone === 'hand',
    ).length;
    // p1 had 3 cards, discarded 2, now has 1
    expect(afterP1Hand).toBe(1);
  });
});
