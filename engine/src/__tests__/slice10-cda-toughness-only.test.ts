/**
 * Slice 10 CDA widening: toughness-only characteristic-defining ability.
 *
 * Covers:
 *  1. Parser — matchDynamicCDA recognises toughness-only CDAs ("~'s toughness
 *     is equal to the number of <filter> <zone>") and emits SetBasePTDynamic
 *     with powerFormula: null, toughnessFormula: <ForEachAmount>.
 *  2. Execution — getEffectiveToughness reflects the count; getEffectivePower
 *     falls through to the printed value (powerFormula is null).
 *  3. Honesty gate — Nethergoyf-style "card types among" counts and
 *     "that number plus 1" modified formulas are declined (Unparsed). Doc Ock
 *     conditional fixed-PT ("As long as…") is also declined.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  getEffectivePower,
  getEffectiveToughness,
  registerContinuousEffect,
  resetContinuousTimestamp,
} from '../effects/continuous';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';
import { emptyManaPool } from '../types';

// ============================================================================
// Helpers
// ============================================================================

function makePlayer(id: string): Player {
  return {
    id,
    name: id,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    commanderInstanceId: null,
    commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false,
    hasPriority: false,
    hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{2}{G}',
    cmc: opts.cmc ?? 3,
    colors: opts.colors ?? ['G'],
    color_identity: opts.color_identity ?? ['G'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players ?? [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards ?? new Map(),
    cardDefinitions: overrides.cardDefinitions ?? new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as GameState['phase'],
    step: 'main' as GameState['step'],
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects ?? [],
  };
}

// ============================================================================
// 1. PARSER RECOGNITION — toughness-only CDA
// ============================================================================

describe('matchDynamicCDA — toughness-only CDAs (Slice 10 widening)', () => {
  // Yavimaya Kavu: "~'s toughness is equal to the number of green creatures on the battlefield."
  const YAVIMAYA_KAVU_ORACLE =
    "~'s power is equal to the number of green permanents you control.\n" +
    "~'s toughness is equal to the number of green creatures on the battlefield.";

  // Test the toughness-only form in isolation
  const TOUGHNESS_ONLY_ORACLE =
    "~'s toughness is equal to the number of green creatures on the battlefield.";

  it('toughness-only CDA: parses as StaticAbility/SetBasePTDynamic with powerFormula null', () => {
    const result = parseOracleText(TOUGHNESS_ONLY_ORACLE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    // powerFormula is null — printed power applies unchanged
    expect(mod.powerFormula).toBeNull();
    // toughnessFormula counts green creatures on the battlefield
    expect(mod.toughnessFormula).not.toBeNull();
    expect(mod.toughnessFormula!.kind).toBe('ForEach');
    expect(mod.toughnessFormula!.zone).toBe('battlefield');
    expect(mod.toughnessFormula!.controller).toBe('each');
    expect(mod.toughnessFormula!.filter).toMatchObject({ colors: ['G'], types: ['creature'] });
    expect(result.ability.selfOnly).toBe(true);
  });

  it('toughness-only CDA with keyword prefix: "Flying; ~\'s toughness is equal to ..."', () => {
    const oracle =
      "Flying\n~'s toughness is equal to the number of creatures on the battlefield.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.powerFormula).toBeNull();
    expect(mod.toughnessFormula).not.toBeNull();
    expect(mod.toughnessFormula!.zone).toBe('battlefield');
    expect(mod.toughnessFormula!.controller).toBe('each');
  });

  it('toughness-only CDA "in your graveyard" scope', () => {
    const oracle =
      "~'s toughness is equal to the number of creature cards in your graveyard.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.powerFormula).toBeNull();
    expect(mod.toughnessFormula!.zone).toBe('graveyard');
    expect(mod.toughnessFormula!.controller).toBe('you');
    expect(mod.toughnessFormula!.filter).toMatchObject({ types: ['creature'] });
  });
});

// ============================================================================
// 2. EXECUTION — toughness-only CDA uses printed power, dynamic toughness
// ============================================================================

describe('matchDynamicCDA execution — toughness-only (printed power, dynamic toughness)', () => {
  function buildToughnessOnlySetup(numGreenCreaturesOnBF: number): {
    state: GameState;
    kavuInstanceId: string;
  } {
    resetContinuousTimestamp();
    // Kavu with printed power 2, toughness 0 — toughness driven by green creatures on battlefield.
    // Make it red (not green) so it doesn't count itself in the "green creatures" total.
    const kavuOracle =
      "~'s toughness is equal to the number of green creatures on the battlefield.";
    const kavuDef = makeDef('kavu', {
      oracle_text: kavuOracle,
      power: 2,   // printed power — should remain unchanged
      toughness: 0,
      colors: ['R'],
      color_identity: ['R'],
    });
    const kavuInstance = makeCard('kavu_1', 'kavu', 'p1', 'battlefield');
    const cards = new Map<string, CardInstance>();
    const cardDefs = new Map<string, CardDefinition>();

    cards.set('kavu_1', kavuInstance);
    cardDefs.set('kavu', kavuDef);

    // Add green creatures on the battlefield (some for p1, some for p2)
    const greenCreatureDef = makeDef('green-creature', {
      type_line: 'Creature',
      card_types: ['creature'],
      colors: ['G'],
    });
    cardDefs.set('green-creature', greenCreatureDef);

    for (let i = 0; i < numGreenCreaturesOnBF; i++) {
      const id = `gc_${i}`;
      // Alternate between p1 and p2 to test "on the battlefield" (any controller)
      const owner = i % 2 === 0 ? 'p1' : 'p2';
      cards.set(id, makeCard(id, 'green-creature', owner, 'battlefield'));
    }

    let state = makeState({ cards, cardDefinitions: cardDefs });

    const parsed = parseOracleText(kavuOracle);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, 'kavu_1', 'p1', parsed.ability);
    }

    return { state, kavuInstanceId: 'kavu_1' };
  }

  it('0 green creatures → power stays at printed 2, toughness = 0', () => {
    const { state, kavuInstanceId } = buildToughnessOnlySetup(0);
    expect(getEffectivePower(state, kavuInstanceId)).toBe(2);
    expect(getEffectiveToughness(state, kavuInstanceId)).toBe(0);
  });

  it('4 green creatures on battlefield → power stays at printed 2, toughness = 4', () => {
    const { state, kavuInstanceId } = buildToughnessOnlySetup(4);
    expect(getEffectivePower(state, kavuInstanceId)).toBe(2);
    expect(getEffectiveToughness(state, kavuInstanceId)).toBe(4);
  });

  it('7 green creatures on battlefield → power stays at printed 2, toughness = 7', () => {
    const { state, kavuInstanceId } = buildToughnessOnlySetup(7);
    expect(getEffectivePower(state, kavuInstanceId)).toBe(2);
    expect(getEffectiveToughness(state, kavuInstanceId)).toBe(7);
  });
});

// ============================================================================
// 3. HONESTY GATE — unsupported forms are declined
// ============================================================================

describe('matchDynamicCDA — honesty gate for toughness-only / multi-formula forms', () => {
  it('declines Nethergoyf "card types among" count (unsupported delirium count)', () => {
    // "Nethergoyf's power is equal to the number of card types among cards in
    //  your graveyard and its toughness is equal to that number plus 1."
    // "card types among" is not a ForEach shape — declined by parseForEachFilterWords.
    const oracle =
      "Nethergoyf's power is equal to the number of card types among cards in your graveyard and its toughness is equal to that number plus 1.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Unparsed');
  });

  it('declines Doc Ock "as long as there are N cards in graveyard, has base P/T X/X" (conditional fixed PT, not CDA)', () => {
    // "As long as there are eight or more cards in your graveyard, ~ has base power and toughness 8/8."
    // This is a conditional static-ability fix — no dynamic count formula.
    // matchDynamicCDA finds no "equal to the number of" clause and returns null.
    const oracle =
      "As long as there are eight or more cards in your graveyard, ~ has base power and toughness 8/8.";
    const result = parseOracleText(oracle);
    // Must not incorrectly parse as SetBasePTDynamic
    if (result.kind === 'StaticAbility') {
      expect(result.ability.modifier.kind).not.toBe('SetBasePTDynamic');
    }
    // The engine doesn't execute this form, so it's either Unparsed or
    // parsed as something else — but NOT a SetBasePTDynamic CDA.
  });

  it('declines toughness-only CDA with unsupported "card types among" count', () => {
    const oracle =
      "~'s toughness is equal to the number of card types among cards in your graveyard.";
    const result = parseOracleText(oracle);
    // parseForEachFilterWords bails on "types" + "among" as unknown words
    expect(result.kind).toBe('Unparsed');
  });
});
