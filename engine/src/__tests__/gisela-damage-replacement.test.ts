/**
 * Tests for Gisela, Blade of Goldnight — damage doubling/halving subsystem.
 *
 * Parser coverage:
 *   - Each oracle text line parses as StaticAbility with correct modifier kind
 *
 * Executor coverage (via applyDamageReplacementEffects):
 *   - 3-damage bolt to opponent → 6 dealt
 *   - 3-damage bolt to you (Gisela's controller) → 1 dealt (prevent 2, deal 1)
 *   - 4-damage bolt to you → 2 dealt (prevent 2, deal 2)
 *   - 1-damage bolt to you → 0 dealt (prevent 1, fully prevented)
 *   - combat damage to opponent doubled
 *   - combat damage to self halved
 *   - without Gisela on battlefield → normal damage
 *   - damage to opponent's creature doubled
 *   - damage to own creature halved
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { applyDamageReplacementEffects, clearReplacements } from '../effects/replacement';
import { registerContinuousEffect } from '../effects/continuous';
import type { GameState, CardInstance, CardDefinition } from '../types';
import type { StaticAbilityEffect } from '../effects/ast';

// ============================================================================
// Oracle text lines from Gisela, Blade of Goldnight
// ============================================================================

const GISELA_DOUBLING_LINE =
  'If a source would deal damage to an opponent or a permanent an opponent controls, that source deals double that damage to that player or permanent instead.';

const GISELA_HALVING_LINE =
  'If a source would deal damage to you or a permanent you control, prevent half that damage, rounded up.';

// ============================================================================
// Test state factory
// ============================================================================

function makeBaseState(overrides: {
  giselaOnBattlefield?: boolean;
  giselaContinuousEffects?: boolean;
} = {}): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  // Gisela card definition
  cardDefinitions.set('def-gisela', {
    id: 'def-gisela',
    name: 'Gisela, Blade of Goldnight',
    type_line: 'Legendary Creature — Angel',
    oracle_text: [
      'Flying, first strike',
      GISELA_DOUBLING_LINE,
      GISELA_HALVING_LINE,
    ].join('\n'),
    mana_cost: '{4}{R}{W}{W}',
    cmc: 7,
    colors: ['R', 'W'],
    color_identity: ['R', 'W'],
    keywords: ['Flying', 'First Strike'],
    card_types: ['creature'],
    power: 5,
    toughness: 5,
  });

  // Gisela card instance
  cards.set('gisela', {
    instanceId: 'gisela',
    definitionId: 'def-gisela',
    ownerId: 'p1',
    zone: overrides.giselaOnBattlefield !== false ? 'battlefield' : 'graveyard',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  // A creature controlled by p2 (opponent)
  cardDefinitions.set('def-bear', {
    id: 'def-bear',
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  });
  cards.set('bear-p2', {
    instanceId: 'bear-p2',
    definitionId: 'def-bear',
    ownerId: 'p2',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  // A creature controlled by p1 (Gisela's controller)
  cards.set('bear-p1', {
    instanceId: 'bear-p1',
    definitionId: 'def-bear',
    ownerId: 'p1',
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  });

  const state: GameState = {
    players: [
      {
        id: 'p1',
        name: 'Gisela Controller',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderCastCount: 0,
        commanderInstanceId: null,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'p2',
        name: 'Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderCastCount: 0,
        commanderInstanceId: null,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    continuousEffects: [],
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  return state;
}

/**
 * Build a state where Gisela's continuous abilities have been registered
 * (as registerContinuousAbilitiesForPermanent would do on ETB).
 */
function makeStateWithGisela(): GameState {
  let state = makeBaseState({ giselaOnBattlefield: true });

  // Register the two Gisela statics manually (mirrors registerContinuousAbilitiesForPermanent)
  const doublingAbility: StaticAbilityEffect = {
    kind: 'StaticAbility',
    modifier: { kind: 'GiselaDamageDoubling' },
    filter: {},
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };
  const halvingAbility: StaticAbilityEffect = {
    kind: 'StaticAbility',
    modifier: { kind: 'GiselaDamageHalving' },
    filter: {},
    controller: 'you',
    excludeSelf: false,
    selfOnly: true,
  };

  state = registerContinuousEffect(state, 'gisela', 'p1', doublingAbility);
  state = registerContinuousEffect(state, 'gisela', 'p1', halvingAbility);
  return state;
}

// ============================================================================
// 1. Parser tests
// ============================================================================

describe('Gisela parser — damage doubling line', () => {
  it('parses as StaticAbility with GiselaDamageDoubling modifier', () => {
    const result = parseOracleText(GISELA_DOUBLING_LINE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier.kind).toBe('GiselaDamageDoubling');
    }
  });

  it('sets selfOnly: true so the layer system skips it', () => {
    const result = parseOracleText(GISELA_DOUBLING_LINE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind === 'StaticAbility') {
      expect(result.ability.selfOnly).toBe(true);
    }
  });
});

describe('Gisela parser — damage halving line', () => {
  it('parses as StaticAbility with GiselaDamageHalving modifier', () => {
    const result = parseOracleText(GISELA_HALVING_LINE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier.kind).toBe('GiselaDamageHalving');
    }
  });

  it('sets selfOnly: true so the layer system skips it', () => {
    const result = parseOracleText(GISELA_HALVING_LINE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind === 'StaticAbility') {
      expect(result.ability.selfOnly).toBe(true);
    }
  });
});

// ============================================================================
// 2. Execution tests — damage to opponent (doubling)
// ============================================================================

describe('Gisela execution — damage to OPPONENT is doubled', () => {
  beforeEach(() => {
    clearReplacements();
  });

  it('a 3-damage event to opponent player deals 6 with Gisela out', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p2',
      sourceId: 'some-bolt',
      amount: 3,
    });
    expect(result.event).not.toBeNull();
    expect(result.event?.amount).toBe(6);
    expect(result.appliedReplacements).toContain('gisela_double_gisela');
  });

  it('a 5-damage event to opponent player deals 10 with Gisela out', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p2',
      sourceId: 'some-source',
      amount: 5,
    });
    expect(result.event?.amount).toBe(10);
  });

  it('damage to a permanent controlled by opponent is doubled', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'bear-p2',   // p2's creature
      sourceId: 'some-bolt',
      amount: 3,
    });
    expect(result.event?.amount).toBe(6);
  });

  it('combat damage to opponent is doubled', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p2',
      sourceId: 'gisela',
      amount: 5,
      isCombatDamage: true,
    });
    expect(result.event?.amount).toBe(10);
  });
});

// ============================================================================
// 3. Execution tests — damage to controller (halving, rounded up)
// ============================================================================

describe('Gisela execution — damage to CONTROLLER is halved (rounded up)', () => {
  beforeEach(() => {
    clearReplacements();
  });

  it('3-damage to p1 (Gisela controller) → 1 dealt (prevent ceil(3/2)=2)', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p1',
      sourceId: 'some-bolt',
      amount: 3,
    });
    // ceil(3/2) = 2 prevented → 1 dealt
    expect(result.event).not.toBeNull();
    expect(result.event?.amount).toBe(1);
    expect(result.appliedReplacements).toContain('gisela_halve_gisela');
  });

  it('4-damage to p1 → 2 dealt (prevent ceil(4/2)=2)', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p1',
      sourceId: 'some-bolt',
      amount: 4,
    });
    // ceil(4/2) = 2 prevented → 2 dealt
    expect(result.event?.amount).toBe(2);
  });

  it('1-damage to p1 → 0 dealt (fully prevented, ceil(1/2)=1 prevented)', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p1',
      sourceId: 'some-bolt',
      amount: 1,
    });
    // ceil(1/2) = 1 prevented → 0 dealt → event is null
    expect(result.event).toBeNull();
  });

  it('damage to p1 own creature is halved', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'bear-p1',   // p1's own creature
      sourceId: 'some-bolt',
      amount: 4,
    });
    // 4 → prevent 2, deal 2
    expect(result.event?.amount).toBe(2);
  });

  it('combat damage to self is halved', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p1',
      sourceId: 'bear-p2',
      amount: 6,
      isCombatDamage: true,
    });
    // ceil(6/2) = 3 prevented → 3 dealt
    expect(result.event?.amount).toBe(3);
  });
});

// ============================================================================
// 4. Without Gisela — normal damage
// ============================================================================

describe('Gisela execution — without Gisela on battlefield, damage is normal', () => {
  beforeEach(() => {
    clearReplacements();
  });

  it('3-damage to opponent is NOT doubled when Gisela is absent', () => {
    // Gisela in graveyard — no continuous effects registered
    const state = makeBaseState({ giselaOnBattlefield: false });
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p2',
      sourceId: 'some-bolt',
      amount: 3,
    });
    expect(result.event?.amount).toBe(3);
  });

  it('3-damage to self is NOT halved when Gisela is absent', () => {
    const state = makeBaseState({ giselaOnBattlefield: false });
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p1',
      sourceId: 'some-bolt',
      amount: 3,
    });
    expect(result.event?.amount).toBe(3);
  });

  it('even with continuous effects registered, Gisela in graveyard has no effect', () => {
    // Manually register the statics but put Gisela in the graveyard
    let state = makeBaseState({ giselaOnBattlefield: false });
    const doublingAbility: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'GiselaDamageDoubling' },
      filter: {},
      controller: 'you',
      excludeSelf: false,
      selfOnly: true,
    };
    state = registerContinuousEffect(state, 'gisela', 'p1', doublingAbility);

    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p2',
      sourceId: 'bolt',
      amount: 3,
    });
    // Gisela is in graveyard → source zone check fails → no doubling
    expect(result.event?.amount).toBe(3);
  });
});

// ============================================================================
// 5. Damage to self is NOT doubled; damage to opponent is NOT halved
// ============================================================================

describe('Gisela — directional scoping is respected', () => {
  beforeEach(() => {
    clearReplacements();
  });

  it('damage to p1 (controller) does NOT get doubled', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p1',
      sourceId: 'bolt',
      amount: 3,
    });
    // Only halving applies to p1 target — the amount goes from 3 to 1, not to 6.
    expect(result.event?.amount).toBe(1);
  });

  it('damage to p2 (opponent) does NOT get halved by Gisela', () => {
    const state = makeStateWithGisela();
    const result = applyDamageReplacementEffects(state, {
      type: 'DamageDealt',
      targetId: 'p2',
      sourceId: 'bolt',
      amount: 4,
    });
    // Only doubling applies to p2 target — goes from 4 to 8, not halved.
    expect(result.event?.amount).toBe(8);
  });
});
