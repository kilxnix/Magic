/**
 * slice1-set-base-pt — Slice 1 / base-P/T-set
 *
 * Parse and execute tests for "target creature has base power and toughness N/M
 * until end of turn" (SetBasePT effect family).
 *
 * Real oracle wordings tested:
 *   Diminish:      "Target creature has base power and toughness 1/1 until end of turn."
 *   Square Up:     "Target creature has base power and toughness 4/4 until end of turn."
 *   Sorceress Queen (activated): "{T}: Target creature other than this creature has base
 *                   power and toughness 0/2 until end of turn."
 *   Water Wings:   "Until end of turn, target creature you control has base power and
 *                   toughness 4/4 and gains flying and hexproof."
 */
import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { cleanupDamage } from '../state-based';
import type { GameState, CardInstance, CardDefinition } from '../types';
import type { Effect, SetBasePTEffect } from '../effects/ast';

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function makeDef(id: string, power = 5, toughness = 6): CardDefinition {
  return {
    id,
    name: id,
    type_line: 'Creature — Beast',
    oracle_text: '',
    mana_cost: '{3}{G}',
    cmc: 4,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
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
  // def-beast: base 5/6
  cardDefinitions.set('def-beast', makeDef('def-beast', 5, 6));

  cards.set('c1', makeCreature('c1', 'player-1'));
  cards.set('c2', makeCreature('c2', 'player-2'));

  const players = ['player-1', 'player-2'].map((id, idx) => ({
    id,
    name: id,
    life: 40,
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

// ---------------------------------------------------------------------------
// PARSER TESTS
// ---------------------------------------------------------------------------

describe('slice1-set-base-pt: parser', () => {
  it('parses Diminish: "Target creature has base power and toughness 1/1 until end of turn."', () => {
    const parsed = parseOracleText(
      'Target creature has base power and toughness 1/1 until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(1);
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Creature');

    const eff = parsed.effects[0] as SetBasePTEffect;
    expect(eff.kind).toBe('SetBasePT');
    expect(eff.power).toBe(1);
    expect(eff.toughness).toBe(1);
    expect(eff.keywords).toBeUndefined();
    expect(eff.target.kind).toBe('Chosen');
  });

  it('parses Square Up: "Target creature has base power and toughness 4/4 until end of turn."', () => {
    const parsed = parseOracleText(
      'Target creature has base power and toughness 4/4 until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const eff = parsed.effects[0] as SetBasePTEffect;
    expect(eff.kind).toBe('SetBasePT');
    expect(eff.power).toBe(4);
    expect(eff.toughness).toBe(4);
  });

  it('parses Sorceress Queen activated: "target creature other than this creature has base power and toughness 0/2 until end of turn."', () => {
    // The activated-ability oracle text for Sorceress Queen; we test the effect body.
    const parsed = parseOracleText(
      'Target creature other than this creature has base power and toughness 0/2 until end of turn.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0] as SetBasePTEffect;
    expect(eff.kind).toBe('SetBasePT');
    expect(eff.power).toBe(0);
    expect(eff.toughness).toBe(2);
    expect(parsed.targets[0].type).toBe('Creature');
  });

  it('parses Water Wings: leading-duration form with keyword riders', () => {
    const parsed = parseOracleText(
      'Until end of turn, target creature you control has base power and toughness 4/4 and gains flying and hexproof.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    // Should emit exactly one SetBasePT effect (keywords are embedded in it).
    expect(parsed.effects).toHaveLength(1);
    const eff = parsed.effects[0] as SetBasePTEffect;
    expect(eff.kind).toBe('SetBasePT');
    expect(eff.power).toBe(4);
    expect(eff.toughness).toBe(4);
    expect(eff.keywords).toContain('Flying');
    expect(eff.keywords).toContain('Hexproof');

    // Target must be constrained to "you control"
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('emits a Chosen ref that matches the registered target spec', () => {
    const parsed = parseOracleText(
      'Target creature has base power and toughness 2/2 until end of turn.',
    );
    if (parsed.kind !== 'Spell') return;

    const eff = parsed.effects[0] as SetBasePTEffect;
    expect(eff.target.kind).toBe('Chosen');
    const chosenId = (eff.target as Extract<typeof eff.target, { kind: 'Chosen' }>).targetId;
    expect(parsed.targets[0].id).toBe(chosenId);
  });
});

// ---------------------------------------------------------------------------
// Helper: call executeEffects with the correct multi-arg signature.
// executeEffects(state, effects, casterId, chosenTargetIds[], targetSpecs[], xValue, options)
// ---------------------------------------------------------------------------

function exec(
  state: GameState,
  effects: Effect[],
  targetSpecId: string,
  targetId: string,
  xValue = 0,
): GameState {
  return executeEffects(
    state,
    effects,
    'player-1',
    [targetId],
    [{ id: targetSpecId }],
    xValue,
  );
}

// ---------------------------------------------------------------------------
// EXECUTOR TESTS
// ---------------------------------------------------------------------------

describe('slice1-set-base-pt: executor', () => {
  it('sets _setBasePower / _setBaseToughness counters on the target card', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-1' },
      power: 1,
      toughness: 1,
    };

    const after = exec(state, [eff], 'spec-1', 'c1');

    const c1 = after.cards.get('c1')!;
    expect(c1.counters['_setBasePower']).toBe(1);
    expect(c1.counters['_setBaseToughness']).toBe(1);
  });

  it('getEffectivePower/Toughness reflects the set base overriding the printed value', () => {
    const state = makeState();
    // Creature c1 has printed 5/6; SetBasePT 1/1 should make effective P/T = 1/1.
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-1' },
      power: 1,
      toughness: 1,
    };

    const after = exec(state, [eff], 'spec-1', 'c1');

    // Layer 7b: base is now 1/1, no counters or _powerMod, so effective = 1/1.
    expect(getEffectivePower(after, 'c1')).toBe(1);
    expect(getEffectiveToughness(after, 'c1')).toBe(1);
  });

  it('cleanupDamage removes the set-base counters (until-end-of-turn cleanup)', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-1' },
      power: 4,
      toughness: 4,
    };

    const after = exec(state, [eff], 'spec-1', 'c1');

    // Counters are set before cleanup.
    expect(after.cards.get('c1')!.counters['_setBasePower']).toBe(4);

    // After cleanup the counters should be gone.
    const cleaned = cleanupDamage(after);
    expect(cleaned.cards.get('c1')!.counters['_setBasePower']).toBeUndefined();
    expect(cleaned.cards.get('c1')!.counters['_setBaseToughness']).toBeUndefined();

    // And the effective P/T reverts to printed 5/6.
    expect(getEffectivePower(cleaned, 'c1')).toBe(5);
    expect(getEffectiveToughness(cleaned, 'c1')).toBe(6);
  });

  it('grants keyword riders simultaneously (Water Wings 4/4 flying hexproof)', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-1' },
      power: 4,
      toughness: 4,
      keywords: ['Flying', 'Hexproof'],
    };

    const after = exec(state, [eff], 'spec-1', 'c1');

    const c1 = after.cards.get('c1')!;
    expect(c1.grantedKeywords).toContain('Flying');
    expect(c1.grantedKeywords).toContain('Hexproof');
    expect(getEffectivePower(after, 'c1')).toBe(4);
    expect(getEffectiveToughness(after, 'c1')).toBe(4);
  });

  it('SetBasePT 4/4 on a creature with +2/+2 counters yields effective 6/6 (layer 7c additive)', () => {
    // Base set (layer 7b) → 4/4, then +1/+1 counters add on top (layer 7c).
    const state = makeState();

    // Manually give c1 two +1/+1 counters.
    const c1Before = state.cards.get('c1')!;
    const stateWithCounters: GameState = {
      ...state,
      cards: new Map(state.cards).set('c1', {
        ...c1Before,
        counters: { '+1/+1': 2 },
      }),
    };

    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-1' },
      power: 4,
      toughness: 4,
    };

    const after = exec(stateWithCounters, [eff], 'spec-1', 'c1');

    // Base = 4 (set), +1/+1 counters add 2 → effective 6/6.
    expect(getEffectivePower(after, 'c1')).toBe(6);
    expect(getEffectiveToughness(after, 'c1')).toBe(6);
  });

  it('SetBasePT 0/2 (Sorceress Queen) — 5/6 creature becomes effectively 0/2', () => {
    const state = makeState();
    const eff: SetBasePTEffect = {
      kind: 'SetBasePT',
      target: { kind: 'Chosen', targetId: 'spec-1' },
      power: 0,
      toughness: 2,
    };

    const after = exec(state, [eff], 'spec-1', 'c1');

    expect(getEffectivePower(after, 'c1')).toBe(0);
    expect(getEffectiveToughness(after, 'c1')).toBe(2);
  });
});
