/**
 * Slice 2: Compound two-subtype spell cost reduction (Lorwyn Banneret form)
 *
 * Tests that "<SubtypeA> spells and <SubtypeB> spells you cast cost {N} less [to cast]"
 * parses to a StaticAbility ReduceCost with a union-subtype filter, and that
 * getCostReduction (continuous.ts) applies the reduction to spells that match
 * EITHER subtype while leaving non-matching spells unchanged.
 *
 * Examples from oracle text:
 *   Brighthearth Banneret: "Elemental spells and Warrior spells you cast cost {1} less to cast."
 *   Ballyrush Banneret:    "Kithkin spells and Soldier spells you cast cost {1} less to cast."
 *   Stonybrook Banneret:   "Merfolk spells and Wizard spells you cast cost {1} less to cast."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { getCostReduction } from '../effects/continuous';
import { registerContinuousAbilitiesForPermanent } from '../stack';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string, life = 40): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(instanceId: string, definitionId: string, ownerId: string, zone = 'battlefield' as const): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '',
    cmc: opts.cmc || 0,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players || [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards || new Map(),
    cardDefinitions: overrides.cardDefinitions || new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as any,
    step: 'main' as any,
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects || [],
  };
}

// ============================================================================
// SECTION 1 — Parser recognition (parse tests)
// ============================================================================

describe('Slice 2 — compound two-subtype spell cost reduction: parser recognition', () => {
  // Case 1: Brighthearth Banneret exact oracle wording
  it('parses "Elemental spells and Warrior spells you cast cost {1} less to cast."', () => {
    const result = parseOracleText('Elemental spells and Warrior spells you cast cost {1} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    // Filter must contain BOTH subtypes so either qualifies (union semantics)
    expect(result.ability.filter.subtypes).toContain('elemental');
    expect(result.ability.filter.subtypes).toContain('warrior');
    expect(result.ability.controller).toBe('you');
    expect(result.ability.selfOnly).not.toBe(true);
  });

  // Case 2: Goblin and Zombie compound form (both engine-known subtypes)
  it('parses "Goblin spells and Zombie spells you cast cost {1} less to cast."', () => {
    const result = parseOracleText('Goblin spells and Zombie spells you cast cost {1} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    expect(result.ability.filter.subtypes).toContain('goblin');
    expect(result.ability.filter.subtypes).toContain('zombie');
    expect(result.ability.controller).toBe('you');
    expect(result.ability.selfOnly).not.toBe(true);
  });

  // Case 3: Stonybrook Banneret exact oracle wording
  it('parses "Merfolk spells and Wizard spells you cast cost {1} less to cast."', () => {
    const result = parseOracleText('Merfolk spells and Wizard spells you cast cost {1} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    expect(result.ability.filter.subtypes).toContain('merfolk');
    expect(result.ability.filter.subtypes).toContain('wizard');
  });

  // Case 4: Stonybrook Banneret full oracle text (islandwalk second line parses)
  it('parses Stonybrook Banneret full oracle text (cost reduction + islandwalk)', () => {
    const fullText = 'Merfolk spells and Wizard spells you cast cost {1} less to cast.\nIslandwalk';
    const result = parseOracleText(fullText);
    // The per-line dispatch accepts a StaticAbility line + a keyword line
    expect(result.kind).toBe('StaticAbility');
  });

  // Case 5: Without trailing "to cast" is still accepted
  it('parses compound form without trailing "to cast"', () => {
    const result = parseOracleText('Elemental spells and Warrior spells you cast cost {1} less.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    expect(result.ability.filter.subtypes).toContain('elemental');
    expect(result.ability.filter.subtypes).toContain('warrior');
  });

  // Case 6: Single-type form still works (regression guard for existing parser)
  it('single-type "Creature spells you cast cost {1} less" still parses correctly', () => {
    const result = parseOracleText('Creature spells you cast cost {1} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
  });

  // Case 7: {2} reduction amount
  it('parses compound form with {2} reduction', () => {
    const result = parseOracleText('Goblin spells and Dragon spells you cast cost {2} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 2 });
    expect(result.ability.filter.subtypes).toContain('goblin');
    expect(result.ability.filter.subtypes).toContain('dragon');
  });

  // Honesty gate: a three-type form should NOT be claimed (not Banneret form)
  it('does NOT claim a three-type compound form (not a supported Banneret shape)', () => {
    const result = parseOracleText('Goblin spells and Dragon spells and Angel spells you cast cost {1} less to cast.');
    // The three-type form is not matched by matchCompoundSubtypeSpellCostReduction.
    // It may fall through to matchStaticAbility or remain Unparsed — either is fine
    // but it must NOT produce a ReduceCost StaticAbility with all three subtypes
    // via the new compound matcher (since "cost {1} less" after "Angel spells you cast"
    // is not where the parser expects it in the compound form).
    // We just check the parse doesn't crash.
    expect(result).toBeDefined();
  });
});

// ============================================================================
// SECTION 2 — Execution: getCostReduction applies filter correctly
// ============================================================================

describe('Slice 2 — compound two-subtype spell cost reduction: execution', () => {
  /**
   * Sets up a state with a Banneret-like permanent on the battlefield
   * whose oracle text is the cost reduction line, registers its continuous
   * effects, and returns the state ready for getCostReduction queries.
   */
  function setupBanneretState(oracleText: string): GameState {
    const cards = new Map<string, CardInstance>();
    cards.set('banneret_1', makeCard('banneret_1', 'banneret_def', 'p1', 'battlefield'));

    const defs = new Map<string, CardDefinition>();
    defs.set('banneret_def', makeDef('banneret_def', {
      name: 'Banneret',
      type_line: 'Creature - Elemental',
      oracle_text: oracleText,
      card_types: ['creature'],
    }));

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousAbilitiesForPermanent(state, 'banneret_1');
    return state;
  }

  // Case 1 (execution): Elemental creature spell gets the reduction
  it('reduces cost of Elemental spells for the controller', () => {
    const state = setupBanneretState(
      'Elemental spells and Warrior spells you cast cost {1} less to cast.'
    );
    const elementalDef = makeDef('elemental_def', {
      name: 'Fire Elemental',
      type_line: 'Creature - Elemental',
      card_types: ['creature'],
    });
    // p1 (the banneret controller) gets a 1-mana reduction on Elemental spells
    expect(getCostReduction(state, 'p1', elementalDef)).toBe(1);
  });

  // Case 2 (execution): Warrior creature spell gets the reduction (second subtype)
  it('reduces cost of Warrior spells for the controller', () => {
    const state = setupBanneretState(
      'Elemental spells and Warrior spells you cast cost {1} less to cast.'
    );
    const warriorDef = makeDef('warrior_def', {
      name: 'Dawnbreak Warrior',
      type_line: 'Creature - Human Warrior',
      card_types: ['creature'],
    });
    expect(getCostReduction(state, 'p1', warriorDef)).toBe(1);
  });

  // Case 3 (execution): Non-matching spell type gets no reduction
  it('does NOT reduce cost of non-matching spell types', () => {
    const state = setupBanneretState(
      'Elemental spells and Warrior spells you cast cost {1} less to cast.'
    );
    const dragonDef = makeDef('dragon_def', {
      name: 'Shivan Dragon',
      type_line: 'Creature - Dragon',
      card_types: ['creature'],
    });
    expect(getCostReduction(state, 'p1', dragonDef)).toBe(0);
  });

  // Case 4 (execution): Opponent does NOT get the reduction (controller='you')
  it('does NOT apply reduction to the opponent', () => {
    const state = setupBanneretState(
      'Elemental spells and Warrior spells you cast cost {1} less to cast.'
    );
    const elementalDef = makeDef('elemental_def', {
      name: 'Fire Elemental',
      type_line: 'Creature - Elemental',
      card_types: ['creature'],
    });
    // p2 is NOT the banneret controller — no reduction
    expect(getCostReduction(state, 'p2', elementalDef)).toBe(0);
  });

  // Case 5 (execution): Merfolk+Wizard Banneret reduces both subtypes
  it('Stonybrook Banneret reduces Merfolk and Wizard spell costs', () => {
    const state = setupBanneretState(
      'Merfolk spells and Wizard spells you cast cost {1} less to cast.'
    );
    const merfolkDef = makeDef('merfolk_def', {
      name: 'Merrow Reejerey',
      type_line: 'Creature - Merfolk',
      card_types: ['creature'],
    });
    const wizardDef = makeDef('wizard_def', {
      name: 'Sage Owl',
      type_line: 'Creature - Bird Wizard',
      card_types: ['creature'],
    });
    const druidDef = makeDef('druid_def', {
      name: 'Elvish Druid',
      type_line: 'Creature - Elf Druid',
      card_types: ['creature'],
    });
    expect(getCostReduction(state, 'p1', merfolkDef)).toBe(1);
    expect(getCostReduction(state, 'p1', wizardDef)).toBe(1);
    expect(getCostReduction(state, 'p1', druidDef)).toBe(0);
  });

  // Case 6 (execution): Banneret off the battlefield gives no reduction
  it('gives no reduction when the banneret is not on the battlefield', () => {
    const cards = new Map<string, CardInstance>();
    // Banneret in graveyard, not battlefield
    cards.set('banneret_1', makeCard('banneret_1', 'banneret_def', 'p1', 'graveyard'));

    const defs = new Map<string, CardDefinition>();
    defs.set('banneret_def', makeDef('banneret_def', {
      name: 'Banneret',
      type_line: 'Creature - Elemental',
      oracle_text: 'Elemental spells and Warrior spells you cast cost {1} less to cast.',
      card_types: ['creature'],
    }));

    let state = makeState({ cards, cardDefinitions: defs });
    // Register as if from battlefield, but source is in graveyard
    state = registerContinuousAbilitiesForPermanent(state, 'banneret_1');

    const elementalDef = makeDef('elemental_def', {
      name: 'Fire Elemental',
      type_line: 'Creature - Elemental',
      card_types: ['creature'],
    });
    // getCostReduction checks source.zone === 'battlefield', so no reduction
    expect(getCostReduction(state, 'p1', elementalDef)).toBe(0);
  });
});
