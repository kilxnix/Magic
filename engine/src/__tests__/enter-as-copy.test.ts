// Slice 9: Tests for enter-as-copy (Clone / Jwari Shapeshifter family)

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Minimal test state factory
// ---------------------------------------------------------------------------

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // Entering permanent: a face-down creature / blank shapeshifter before copy.
  cards.set('entering', {
    instanceId: 'entering',
    definitionId: 'def-shapeshifter',
    ownerId: 'player-1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: true,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-shapeshifter', {
    id: 'def-shapeshifter',
    name: 'Test Shapeshifter',
    type_line: 'Creature — Shapeshifter',
    oracle_text: 'You may have this creature enter as a copy of any creature on the battlefield.',
    mana_cost: '{2}{U}',
    cmc: 3,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: 0,
    toughness: 0,
    card_types: ['creature'],
  });

  // Opponent's large creature — optimal copy target.
  cards.set('opp-creature', {
    instanceId: 'opp-creature',
    definitionId: 'def-opp-creature',
    ownerId: 'player-2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-opp-creature', {
    id: 'def-opp-creature',
    name: 'Opponent Big Creature',
    type_line: 'Creature — Dragon',
    oracle_text: 'Flying.',
    mana_cost: '{5}{R}',
    cmc: 6,
    colors: ['R'],
    color_identity: ['R'],
    keywords: ['Flying'],
    power: 5,
    toughness: 5,
    card_types: ['creature'],
  });

  // Ally creature for the Jwari Shapeshifter test.
  cards.set('ally-creature', {
    instanceId: 'ally-creature',
    definitionId: 'def-ally',
    ownerId: 'player-2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  cardDefinitions.set('def-ally', {
    id: 'def-ally',
    name: 'Sea Gate Loremaster',
    type_line: 'Creature — Merfolk Ally Wizard',
    oracle_text: '{T}: Draw a card for each Ally you control.',
    mana_cost: '{4}{U}',
    cmc: 5,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    power: 1,
    toughness: 2,
    card_types: ['creature'],
  });

  const players = [
    {
      id: 'player-1',
      name: 'Player 1',
      life: 40,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      hasPlayedLand: false,
      hand: [],
      library: [],
      graveyard: [],
      commandZone: [],
      hasLost: false,
      commanderDamage: {},
      counters: {},
    },
    {
      id: 'player-2',
      name: 'Player 2',
      life: 40,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      hasPlayedLand: false,
      hand: [],
      library: [],
      graveyard: [],
      commandZone: [],
      hasLost: false,
      commanderDamage: {},
      counters: {},
    },
  ];

  return {
    cards,
    cardDefinitions,
    players,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    turnNumber: 1,
    phase: 'precombat_main',
    step: 'begin_combat',
    stack: [],
    pendingTriggers: [],
    attackers: [],
    blockers: [],
    pendingDamage: [],
  } as unknown as GameState;
}

// ---------------------------------------------------------------------------
// Parser tests
// ---------------------------------------------------------------------------

describe('matchEnterAsCopy — parser', () => {
  it('parses generic "enter as a copy of any creature" form', () => {
    const result = parseOracleText(
      'You may have this creature enter as a copy of any creature on the battlefield.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('EnterAsCopy');
    const effect = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(effect.subtypeFilter).toBeUndefined();
    expect(effect.includesArtifacts).toBeUndefined();
  });

  it('parses Jwari Shapeshifter — Ally subtype filter', () => {
    const result = parseOracleText(
      'You may have this creature enter as a copy of any Ally creature on the battlefield.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('EnterAsCopy');
    const effect = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(effect.subtypeFilter).toBe('ally');
  });

  it('parses "any creature or artifact" form (includesArtifacts)', () => {
    const result = parseOracleText(
      'You may have this creature enter as a copy of any creature or artifact on the battlefield.',
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0].kind).toBe('EnterAsCopy');
    const effect = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(effect.includesArtifacts).toBe(true);
    expect(effect.subtypeFilter).toBeUndefined();
  });

  it('parses "except it\'s an artifact in addition to its other types" rider (Slice-6)', () => {
    // Phyrexian Metamorph style — now parsed by Slice-6 additionalTypes rider.
    const result = parseOracleText(
      "You may have this creature enter as a copy of any creature or artifact on the battlefield, except it's an artifact in addition to its other types.",
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as Extract<Effect, { kind: 'EnterAsCopy' }>;
    expect(eff.kind).toBe('EnterAsCopy');
    expect(eff.includesArtifacts).toBe(true);
    expect(eff.additionalTypes).toEqual(['artifact']);
  });

  it('does not parse unrelated text', () => {
    const result = parseOracleText('Draw a card.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects[0].kind).not.toBe('EnterAsCopy');
  });
});

// ---------------------------------------------------------------------------
// Executor tests
// ---------------------------------------------------------------------------

describe('executeEnterAsCopy — executor', () => {
  it('applies copy-characteristics to entering permanent (generic form)', () => {
    const state = makeState();
    const effects: Effect[] = [{ kind: 'EnterAsCopy' }];

    const newState = executeEffects(
      state,
      effects,
      'player-1',
      [],
      [],
      0,
      { sourceInstanceId: 'entering' },
    );

    const updated = newState.cards.get('entering');
    expect(updated).toBeDefined();
    // Should have been remapped to the opponent's big creature definition
    // (highest P+T + opponent-preference heuristic)
    expect(updated!.definitionId).toBe('def-opp-creature');
    expect(updated!.copiedFromDefinitionId).toBe('def-opp-creature');
    // Controller stays the same
    expect(updated!.ownerId).toBe('player-1');
    // Still on battlefield
    expect(updated!.zone).toBe('battlefield');
  });

  it('respects subtypeFilter — only copies Ally creatures', () => {
    const state = makeState();
    const effects: Effect[] = [{ kind: 'EnterAsCopy', subtypeFilter: 'ally' }];

    const newState = executeEffects(
      state,
      effects,
      'player-1',
      [],
      [],
      0,
      { sourceInstanceId: 'entering' },
    );

    const updated = newState.cards.get('entering');
    expect(updated).toBeDefined();
    // Only the ally-creature matches the Ally subtype filter
    expect(updated!.definitionId).toBe('def-ally');
    expect(updated!.copiedFromDefinitionId).toBe('def-ally');
  });

  it('is a no-op when no legal copy target exists (subtypeFilter with no matches)', () => {
    const state = makeState();
    // Use a subtype that no battlefield creature has
    const effects: Effect[] = [{ kind: 'EnterAsCopy', subtypeFilter: 'phyrexian' }];

    const newState = executeEffects(
      state,
      effects,
      'player-1',
      [],
      [],
      0,
      { sourceInstanceId: 'entering' },
    );

    const updated = newState.cards.get('entering');
    expect(updated).toBeDefined();
    // No match — definition stays unchanged
    expect(updated!.definitionId).toBe('def-shapeshifter');
  });

  it('is a no-op when sourceInstanceId is absent', () => {
    const state = makeState();
    const effects: Effect[] = [{ kind: 'EnterAsCopy' }];

    // No sourceInstanceId provided
    const newState = executeEffects(state, effects, 'player-1', [], []);

    // State must be unchanged for the entering permanent
    const updated = newState.cards.get('entering');
    expect(updated!.definitionId).toBe('def-shapeshifter');
  });
});
