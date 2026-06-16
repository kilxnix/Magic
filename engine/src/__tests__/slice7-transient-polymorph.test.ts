/**
 * Slice 7 — Transient polymorph: "Until end of turn, target creature loses all
 * abilities and becomes a <color> <type> with base power and toughness X/Y."
 *
 * Oracle families covered:
 *   Turn to Frog:             "Until end of turn, target creature loses all abilities
 *                              and becomes a blue Frog with base power and toughness 1/1."
 *   Turn // Burn (Turn half): "Until end of turn, target creature loses all abilities
 *                              and becomes a red Weird with base power and toughness 0/1."
 *   Dance of the Skywise:     "Until end of turn, target creature you control becomes a
 *                              blue Dragon Illusion with base power and toughness 4/4,
 *                              loses all abilities, and gains flying."
 *   Mordenkainen's Polymorph: "Until end of turn, target creature becomes a Dragon with
 *                              base power and toughness 4/4 and gains flying."
 *
 * Tests:
 *   1. Parser recognises each form and emits SetBasePT (not Unparsed).
 *   2. SetBasePTEffect carries correct power/toughness, losesAllAbilities, subtypes,
 *      and keywords.
 *   3. Executor: _setBasePower/_setBaseToughness set on target; transientLosesAllAbilities
 *      set when losesAllAbilities is true; grantedSubtypes set; keywords granted.
 *   4. instanceLosesAllAbilities returns true for a creature whose card has
 *      transientLosesAllAbilities set.
 *   5. End-of-turn cleanup (cleanupDamage) clears transientLosesAllAbilities and
 *      grantedSubtypes (same as other UEOT fields).
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { cleanupDamage } from '../state-based';
import { instanceLosesAllAbilities } from '../keywords';
import type { GameState, CardInstance, CardDefinition } from '../types';
import type { SetBasePTEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function makeDef(id: string, power = 5, toughness = 5, colors: string[] = ['G']): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Beast',
    oracle_text: '',
    mana_cost: '{3}{G}',
    cmc: 4,
    colors,
    color_identity: colors,
    keywords: ['Flying'],
    power,
    toughness,
    card_types: ['creature'],
  } as CardDefinition;
}

function makeCreature(instanceId: string, ownerId: string, defId = 'def-beast'): CardInstance {
  return {
    instanceId,
    definitionId: defId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();
  cardDefinitions.set('def-beast', makeDef('def-beast', 5, 5));

  cards.set('c1', makeCreature('c1', 'player-1'));
  cards.set('c2', makeCreature('c2', 'player-2'));

  const players = ['player-1', 'player-2'].map((id, idx) => ({
    id,
    name: id,
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: idx === 0,
    hasLost: false,
  }));

  return {
    players,
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
  } as GameState;
}

function exec(
  state: GameState,
  effects: SetBasePTEffect[],
  targetSpecId: string,
  targetId: string,
): GameState {
  return executeEffects(
    state,
    effects as any,
    'player-1',
    [targetId],
    [{ id: targetSpecId }],
    0,
  );
}

// ---------------------------------------------------------------------------
// 1. PARSER TESTS
// ---------------------------------------------------------------------------

describe('slice7-transient-polymorph: parser', () => {
  it('parses Turn to Frog: loses all abilities form (Form A)', () => {
    const oracle =
      'Until end of turn, target creature loses all abilities and becomes a blue Frog with base power and toughness 1/1.';
    const result = parseOracleText(oracle);

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');

    const eff = result.effects[0] as SetBasePTEffect;
    expect(eff.kind).toBe('SetBasePT');
    expect(eff.power).toBe(1);
    expect(eff.toughness).toBe(1);
    expect(eff.losesAllAbilities).toBe(true);
    expect(eff.subtypes).toContain('frog');
    expect(eff.target.kind).toBe('Chosen');
  });

  it('parses Turn // Burn (Turn half): red Weird 0/1 form (Form D)', () => {
    const oracle =
      'Until end of turn, target creature loses all abilities and becomes a red Weird with base power and toughness 0/1.';
    const result = parseOracleText(oracle);

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as SetBasePTEffect;
    expect(eff.kind).toBe('SetBasePT');
    expect(eff.power).toBe(0);
    expect(eff.toughness).toBe(1);
    expect(eff.losesAllAbilities).toBe(true);
    // "weird" is not in CREATURE_SUBTYPE_MAP but should be stored as-is
    expect(eff.subtypes).toBeDefined();
    expect(eff.subtypes!.length).toBeGreaterThan(0);
  });

  it('parses Dance of the Skywise: becomes first, then loses, then gains flying (Form B)', () => {
    const oracle =
      'Until end of turn, target creature you control becomes a blue Dragon Illusion with base power and toughness 4/4, loses all abilities, and gains flying.';
    const result = parseOracleText(oracle);

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as SetBasePTEffect;
    expect(eff.kind).toBe('SetBasePT');
    expect(eff.power).toBe(4);
    expect(eff.toughness).toBe(4);
    expect(eff.losesAllAbilities).toBe(true);
    expect(eff.subtypes).toBeDefined();
    // Should contain dragon and/or illusion
    expect(eff.subtypes!.length).toBeGreaterThan(0);
    expect(eff.keywords).toContain('Flying');
    // Target must be constrained to controller's creatures
    expect(result.targets[0].constraints?.controllerControls).toBe(true);
  });

  it("parses Mordenkainen's Polymorph: becomes Dragon with flying, no 'loses all abilities' (Form C)", () => {
    const oracle =
      "Until end of turn, target creature becomes a Dragon with base power and toughness 4/4 and gains flying.";
    const result = parseOracleText(oracle);

    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0] as SetBasePTEffect;
    expect(eff.kind).toBe('SetBasePT');
    expect(eff.power).toBe(4);
    expect(eff.toughness).toBe(4);
    // No "loses all abilities" in this wording
    expect(eff.losesAllAbilities).toBeUndefined();
    expect(eff.subtypes).toContain('dragon');
    expect(eff.keywords).toContain('Flying');
  });

  it('emits a Chosen ref matching the target spec', () => {
    const oracle =
      'Until end of turn, target creature loses all abilities and becomes a blue Frog with base power and toughness 1/1.';
    const result = parseOracleText(oracle);
    if (result.kind !== 'Spell') return;

    const eff = result.effects[0] as SetBasePTEffect;
    expect(eff.target.kind).toBe('Chosen');
    const chosenId = (eff.target as Extract<typeof eff.target, { kind: 'Chosen' }>).targetId;
    expect(result.targets[0].id).toBe(chosenId);
  });
});

// ---------------------------------------------------------------------------
// 2. EXECUTOR TESTS
// ---------------------------------------------------------------------------

describe('slice7-transient-polymorph: executor', () => {
  it('sets _setBasePower/_setBaseToughness and transientLosesAllAbilities on target (Turn to Frog)', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-frog' },
      power: 1,
      toughness: 1,
      losesAllAbilities: true,
      subtypes: ['frog'],
    };

    const after = exec(state, [eff], 'spec-frog', 'c1');
    const c1 = after.cards.get('c1')!;

    // Base P/T counters
    expect(c1.counters['_setBasePower']).toBe(1);
    expect(c1.counters['_setBaseToughness']).toBe(1);
    // Transient ability loss
    expect(c1.transientLosesAllAbilities).toBe(true);
    // Subtype override
    expect(c1.grantedSubtypes).toContain('frog');
  });

  it('getEffectivePower/Toughness reflects the set base P/T after execution', () => {
    const state = makeState();
    // c1 starts at 5/5 (def-beast)
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-1' },
      power: 1,
      toughness: 1,
      losesAllAbilities: true,
      subtypes: ['frog'],
    };

    const after = exec(state, [eff], 'spec-1', 'c1');
    expect(getEffectivePower(after, 'c1')).toBe(1);
    expect(getEffectiveToughness(after, 'c1')).toBe(1);
  });

  it('instanceLosesAllAbilities returns true for target after execution', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-2' },
      power: 1,
      toughness: 1,
      losesAllAbilities: true,
      subtypes: ['frog'],
    };

    const before = instanceLosesAllAbilities(state, 'c1');
    const after = exec(state, [eff], 'spec-2', 'c1');
    const afterLoses = instanceLosesAllAbilities(after, 'c1');

    expect(before).toBe(false);
    expect(afterLoses).toBe(true);
  });

  it('grants flying keyword when keywords field is set (Dance of the Skywise form)', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-3' },
      power: 4,
      toughness: 4,
      losesAllAbilities: true,
      subtypes: ['dragon', 'illusion'],
      keywords: ['Flying'],
    };

    const after = exec(state, [eff], 'spec-3', 'c1');
    const c1 = after.cards.get('c1')!;

    expect(c1.grantedKeywords).toContain('Flying');
    expect(getEffectivePower(after, 'c1')).toBe(4);
    expect(getEffectiveToughness(after, 'c1')).toBe(4);
    expect(c1.grantedSubtypes).toContain('dragon');
    expect(c1.grantedSubtypes).toContain('illusion');
  });

  it('does NOT set transientLosesAllAbilities when losesAllAbilities is absent (Mordenkainen form)', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-4' },
      power: 4,
      toughness: 4,
      subtypes: ['dragon'],
      keywords: ['Flying'],
    };

    const after = exec(state, [eff], 'spec-4', 'c1');
    const c1 = after.cards.get('c1')!;
    expect(c1.transientLosesAllAbilities).toBeUndefined();
    expect(instanceLosesAllAbilities(after, 'c1')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. END-OF-TURN CLEANUP
// ---------------------------------------------------------------------------

describe('slice7-transient-polymorph: end-of-turn cleanup', () => {
  it('cleanupDamage clears transientLosesAllAbilities and grantedSubtypes', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-5' },
      power: 1,
      toughness: 1,
      losesAllAbilities: true,
      subtypes: ['frog'],
    };

    const afterEffect = exec(state, [eff], 'spec-5', 'c1');
    // Verify state is set
    expect(afterEffect.cards.get('c1')!.transientLosesAllAbilities).toBe(true);
    expect(afterEffect.cards.get('c1')!.grantedSubtypes).toContain('frog');

    // Run end-of-turn cleanup
    const afterCleanup = cleanupDamage(afterEffect);
    const c1 = afterCleanup.cards.get('c1')!;

    expect(c1.transientLosesAllAbilities).toBeUndefined();
    expect(c1.grantedSubtypes).toBeUndefined();
    // Base P/T counters should also be cleared
    expect(c1.counters['_setBasePower']).toBeUndefined();
    expect(c1.counters['_setBaseToughness']).toBeUndefined();
  });
});
