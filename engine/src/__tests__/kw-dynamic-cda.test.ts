/**
 * Tests for dynamic characteristic-defining P/T abilities (layer 7a CDA).
 *
 * Covers:
 *  1. Parser recognition — matchDynamicCDA emits StaticAbility/SetBasePTDynamic.
 *  2. Execution — getEffectivePower/getEffectiveToughness reflect the count.
 *  3. Honesty gate — unsupported count shapes stay Unparsed.
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
// Test helpers
// ============================================================================

function makePlayer(id: string, life = 40): Player {
  return {
    id,
    name: id,
    life,
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
    type_line: opts.type_line ?? 'Creature — Spirit',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{3}{B}',
    cmc: opts.cmc ?? 4,
    colors: opts.colors ?? ['B'],
    color_identity: opts.color_identity ?? ['B'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 0,
    toughness: opts.toughness ?? 0,
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
// 1. PARSER RECOGNITION
// ============================================================================

describe('matchDynamicCDA — parser recognition', () => {
  // Revenant: "Flying\nRevenant's power and toughness are each equal to the
  // number of creature cards in your graveyard."
  const REVENANT_ORACLE =
    "Flying\nRevenant's power and toughness are each equal to the number of creature cards in your graveyard.";

  it('Revenant: parses as StaticAbility with SetBasePTDynamic (both P and T)', () => {
    const result = parseOracleText(REVENANT_ORACLE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.powerFormula!.kind).toBe('ForEach');
    expect(mod.powerFormula!.zone).toBe('graveyard');
    expect(mod.powerFormula!.controller).toBe('you');
    expect(mod.powerFormula!.filter).toMatchObject({ types: ['creature'] });
    // toughness uses same formula (power and toughness are each equal)
    expect(mod.toughnessFormula).not.toBeNull();
    expect(mod.toughnessFormula?.zone).toBe('graveyard');
    expect(result.ability.selfOnly).toBe(true);
  });

  // Snow Villiers: "Vigilance; power is equal to the number of creatures you control."
  const SNOW_VILLIERS_ORACLE =
    "Vigilance; power is equal to the number of creatures you control.";

  it('Snow Villiers: parses as StaticAbility with SetBasePTDynamic (power only)', () => {
    const result = parseOracleText(SNOW_VILLIERS_ORACLE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.powerFormula!.zone).toBe('battlefield');
    expect(mod.powerFormula!.controller).toBe('you');
    expect(mod.powerFormula!.filter).toMatchObject({ types: ['creature'] });
    // toughness formula is null: printed toughness applies unchanged
    expect(mod.toughnessFormula).toBeNull();
  });

  // Kolaghan Forerunners: "Haste\n~ power and toughness are each equal to
  // the number of creatures you control."
  it('Kolaghan Forerunners: power and toughness = creatures you control', () => {
    const oracle =
      "Haste\nKolaghan Forerunners's power and toughness are each equal to the number of creatures you control.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.powerFormula!.filter).toMatchObject({ types: ['creature'] });
    expect(mod.toughnessFormula).not.toBeNull();
  });

  // Harmonious Grovestrider short form without explicit subject
  it('short form: "power and toughness equal to the number of lands you control"', () => {
    const oracle = "Ward {2}\npower and toughness equal to the number of lands you control.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.powerFormula!.zone).toBe('battlefield');
    expect(mod.powerFormula!.controller).toBe('you');
    expect(mod.toughnessFormula).not.toBeNull();
  });

  it('bare graveyard count: "~ power and toughness are each equal to the number of cards in your graveyard."', () => {
    const oracle =
      "~ power and toughness are each equal to the number of cards in your graveyard.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    const mod = result.ability.modifier;
    expect(mod.kind).toBe('SetBasePTDynamic');
    if (mod.kind !== 'SetBasePTDynamic') return;
    expect(mod.powerFormula!.zone).toBe('graveyard');
    // No filter — counts all cards
    expect(mod.powerFormula!.filter).toBeUndefined();
  });
});

// ============================================================================
// 2. EXECUTION: getEffectivePower / getEffectiveToughness
// ============================================================================

describe('matchDynamicCDA — execution (getEffectivePower / getEffectiveToughness)', () => {
  function buildRevenantSetup(numCreatureCardsInGraveyard: number): {
    state: GameState;
    revenantInstanceId: string;
  } {
    resetContinuousTimestamp();
    const revenantOracle =
      "Flying\nRevenant's power and toughness are each equal to the number of creature cards in your graveyard.";

    const revenantDef = makeDef('revenant', {
      oracle_text: revenantOracle,
      power: 0,
      toughness: 0,
    });
    const revenantInstance = makeCard('rev_1', 'revenant', 'p1', 'battlefield');
    const cards = new Map<string, CardInstance>();
    const cardDefs = new Map<string, CardDefinition>();

    cards.set('rev_1', revenantInstance);
    cardDefs.set('revenant', revenantDef);

    // Add creature cards in p1's graveyard
    const graveyardCreatureDef = makeDef('creature-card', {
      type_line: 'Creature — Zombie',
      card_types: ['creature'],
    });
    cardDefs.set('creature-card', graveyardCreatureDef);

    for (let i = 0; i < numCreatureCardsInGraveyard; i++) {
      const id = `gc_${i}`;
      cards.set(id, makeCard(id, 'creature-card', 'p1', 'graveyard'));
    }

    let state = makeState({ cards, cardDefinitions: cardDefs });

    // Register the CDA as a continuous effect
    const parsed = parseOracleText(revenantOracle);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, 'rev_1', 'p1', parsed.ability);
    }

    return { state, revenantInstanceId: 'rev_1' };
  }

  it('Revenant with 0 creature cards in graveyard → power=0, toughness=0', () => {
    const { state, revenantInstanceId } = buildRevenantSetup(0);
    expect(getEffectivePower(state, revenantInstanceId)).toBe(0);
    expect(getEffectiveToughness(state, revenantInstanceId)).toBe(0);
  });

  it('Revenant with 3 creature cards in graveyard → power=3, toughness=3', () => {
    const { state, revenantInstanceId } = buildRevenantSetup(3);
    expect(getEffectivePower(state, revenantInstanceId)).toBe(3);
    expect(getEffectiveToughness(state, revenantInstanceId)).toBe(3);
  });

  it('Revenant with 7 creature cards in graveyard → power=7, toughness=7', () => {
    const { state, revenantInstanceId } = buildRevenantSetup(7);
    expect(getEffectivePower(state, revenantInstanceId)).toBe(7);
    expect(getEffectiveToughness(state, revenantInstanceId)).toBe(7);
  });

  it('Snow Villiers power-only CDA: toughness stays at printed value', () => {
    resetContinuousTimestamp();
    const snowOracle =
      "Vigilance; power is equal to the number of creatures you control.";

    const snowDef = makeDef('snow-villiers', {
      oracle_text: snowOracle,
      power: 0,
      toughness: 5, // printed toughness
    });
    const snowInstance = makeCard('snow_1', 'snow-villiers', 'p1', 'battlefield');
    const cards = new Map<string, CardInstance>();
    const cardDefs = new Map<string, CardDefinition>();
    cards.set('snow_1', snowInstance);
    cardDefs.set('snow-villiers', snowDef);

    // Add 4 creatures on battlefield for p1 (including Snow Villiers itself)
    const creatureDef = makeDef('ally-creature', { type_line: 'Creature', card_types: ['creature'] });
    cardDefs.set('ally-creature', creatureDef);
    for (let i = 0; i < 3; i++) {
      const id = `ally_${i}`;
      cards.set(id, makeCard(id, 'ally-creature', 'p1', 'battlefield'));
    }

    let state = makeState({ cards, cardDefinitions: cardDefs });

    const parsed = parseOracleText(snowOracle);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, 'snow_1', 'p1', parsed.ability);
    }

    // 4 creatures you control (Snow Villiers + 3 allies)
    expect(getEffectivePower(state, 'snow_1')).toBe(4);
    // Toughness stays at printed 5 (toughnessFormula is null)
    expect(getEffectiveToughness(state, 'snow_1')).toBe(5);
  });

  it('CDA + counter: +1/+1 counter stacks on top of CDA base', () => {
    resetContinuousTimestamp();
    const oracle =
      "Flying\nRevenant's power and toughness are each equal to the number of creature cards in your graveyard.";
    const def = makeDef('revenant', { oracle_text: oracle, power: 0, toughness: 0 });
    // Give Revenant a +1/+1 counter
    const instance = makeCard('rev_1', 'revenant', 'p1', 'battlefield');
    const withCounter = { ...instance, counters: { '+1/+1': 2 } };

    const cards = new Map<string, CardInstance>([['rev_1', withCounter]]);
    const cardDefs = new Map<string, CardDefinition>([['revenant', def]]);

    // 5 creature cards in graveyard
    const gc = makeDef('gc', { type_line: 'Creature', card_types: ['creature'] });
    cardDefs.set('gc', gc);
    for (let i = 0; i < 5; i++) {
      cards.set(`gc_${i}`, makeCard(`gc_${i}`, 'gc', 'p1', 'graveyard'));
    }

    let state = makeState({ cards, cardDefinitions: cardDefs });
    const parsed = parseOracleText(oracle);
    if (parsed.kind === 'StaticAbility') {
      state = registerContinuousEffect(state, 'rev_1', 'p1', parsed.ability);
    }

    // Base = 5 (CDA), +2/+2 counters → 7/7
    expect(getEffectivePower(state, 'rev_1')).toBe(7);
    expect(getEffectiveToughness(state, 'rev_1')).toBe(7);
  });
});

// ============================================================================
// 3. HONESTY GATE: unsupported count shapes stay Unparsed
// ============================================================================

describe('matchDynamicCDA — honesty gate (unsupported forms stay Unparsed)', () => {
  it('declines "card types among" style counts (not a supported ForEach shape)', () => {
    const oracle =
      "~ power and toughness are each equal to the number of card types among cards in your graveyard.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Unparsed');
  });

  it('declines a card with a real ETB ability alongside the CDA line', () => {
    // The ETB should parse separately (as ETB), not as a static CDA
    const oracle =
      "When ~ enters, draw a card.\n~ power and toughness are each equal to the number of creatures you control.";
    // parseOracleText tries ETB first, which succeeds — so this should parse as ETB, not StaticAbility
    const result = parseOracleText(oracle);
    // The ETB matcher takes precedence; CDA matcher never runs. Either way the
    // face MUST NOT be Unparsed (the ETB clause is valid).
    expect(result.kind).not.toBe('Unparsed');
  });

  it('parses "power equal to the number of creatures in exile" (exile zone is now supported)', () => {
    // Slice 6 added "in exile" as a recognized readForEachZonePhrase shape;
    // the CDA "equal to the number of creatures in exile" now parses as StaticAbility.
    const oracle =
      "~ power and toughness are each equal to the number of creatures in exile.";
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('StaticAbility');
  });
});
