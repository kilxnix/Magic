/**
 * Slice 3 (engine-gap): Jodah / legendary-filtered dynamic anthems.
 *
 * Covers:
 *   1. Parse — the anthem line from Jodah, the Unifier produces a StaticAbility
 *      with modifier: ModifyPTDynamic and filter: { types:['creature'], supertypes:['Legendary'] }
 *   2. Execution — with Jodah + 2 other legendary creatures on board, each
 *      legendary creature gets +3/+3 (X = 3); non-legendary creatures are unaffected.
 *   3. Dynamic X — when a legendary creature leaves, X decreases and each remaining
 *      legendary creature's buff drops accordingly.
 *
 * Oracle text used (single anthem line, from the real card):
 *   "Legendary creatures you control get +X/+X, where X is the number of
 *    legendary creatures you control."
 *
 * Per-line dispatch (parseOracleTextPerLine) is exercised by using the full
 * multi-line Jodah oracle text (the trigger line is NOT yet parsed but should
 * be absorbed gracefully — this test asserts the anthem line parses successfully
 * and produces the expected StaticAbility).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseOracleText } from '../effects/parser';
import {
  registerContinuousEffect,
  unregisterContinuousEffects,
  getContinuousPTModification,
  getEffectivePower,
  getEffectiveToughness,
  resetContinuousTimestamp,
} from '../effects/continuous';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';
import type { StaticAbilityEffect, ForEachAmount } from '../effects/ast';
import { emptyManaPool } from '../types';

// ============================================================================
// Helpers
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

function makeCardInst(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    ...extra,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name ?? id,
    type_line: opts.type_line ?? 'Creature',
    oracle_text: opts.oracle_text ?? '',
    mana_cost: opts.mana_cost ?? '{3}{W}{U}{B}{R}{G}',
    cmc: opts.cmc ?? 5,
    colors: opts.colors ?? ['W', 'U', 'B', 'R', 'G'],
    color_identity: opts.color_identity ?? ['W', 'U', 'B', 'R', 'G'],
    keywords: opts.keywords ?? [],
    card_types: opts.card_types ?? ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(
  cards: Map<string, CardInstance>,
  cardDefs: Map<string, CardDefinition>,
  extras: Partial<GameState> = {},
): GameState {
  return {
    players: [makePlayer('p1'), makePlayer('p2')],
    cards,
    cardDefinitions: cardDefs,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'main1',
    step: 'none',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: extras.continuousEffects ?? [],
  };
}

// ============================================================================
// Test 1: Parse — anthem line only
// ============================================================================

describe('matchLegendaryCreaturesDynamicAnthem — parse', () => {
  const ANTHEM_LINE =
    'Legendary creatures you control get +X/+X, where X is the number of legendary creatures you control.';

  it('parses the anthem line as StaticAbility with ModifyPTDynamic', () => {
    const result = parseOracleText(ANTHEM_LINE);
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    const { ability } = result;
    expect(ability.modifier.kind).toBe('ModifyPTDynamic');
    expect(ability.controller).toBe('you');
    expect(ability.excludeSelf).toBe(false);
    expect(ability.selfOnly).toBeFalsy();
    expect(ability.attachedOnly).toBeFalsy();
    expect(ability.filter.types).toContain('creature');
    expect(ability.filter.supertypes).toContain('Legendary');

    if (ability.modifier.kind !== 'ModifyPTDynamic') return;
    expect(ability.modifier.powerSign).toBe(1);
    expect(ability.modifier.toughnessSign).toBe(1);

    // powerFormula — ForEachAmount counting legendary creatures you control
    const pf = ability.modifier.powerFormula as ForEachAmount;
    expect(pf.kind).toBe('ForEach');
    expect(pf.zone).toBe('battlefield');
    expect(pf.controller).toBe('you');
    expect(pf.filter?.types).toContain('creature');
    expect(pf.filter?.supertypes).toContain('Legendary');

    // toughnessFormula — same shape
    const tf = ability.modifier.toughnessFormula as ForEachAmount;
    expect(tf.kind).toBe('ForEach');
    expect(tf.zone).toBe('battlefield');
    expect(tf.controller).toBe('you');
  });

  it('parses the anthem when embedded in Jodah\'s full oracle text (per-line dispatch)', () => {
    // Full Jodah oracle text — the trigger line may or may not parse, but
    // the anthem line should produce a StaticAbility either way.
    const JODAH_FULL =
      'Legendary creatures you control get +X/+X, where X is the number of legendary creatures you control.\n' +
      'Whenever you cast a legendary spell from your hand, exile cards from the top of your library until you exile a legendary nonland card with lesser mana value. You may cast that card without paying its mana cost. Put the rest on the bottom of your library in a random order.';

    const result = parseOracleText(JODAH_FULL);
    // Per-line dispatch should extract the StaticAbility from line 1.
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;
    expect(result.ability.modifier.kind).toBe('ModifyPTDynamic');
  });
});

// ============================================================================
// Test 2: Execution — 3 legendary creatures → each gets +3/+3
// ============================================================================

describe('matchLegendaryCreaturesDynamicAnthem — execution', () => {
  const ANTHEM_LINE =
    'Legendary creatures you control get +X/+X, where X is the number of legendary creatures you control.';

  beforeEach(() => {
    resetContinuousTimestamp();
  });

  function buildScenario(legendaryCount: number) {
    // Parse the anthem ability
    const parsed = parseOracleText(ANTHEM_LINE);
    expect(parsed.kind).toBe('StaticAbility');
    const ability = (parsed as { kind: 'StaticAbility'; ability: StaticAbilityEffect }).ability;

    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    // Jodah (the anthem source) — Legendary Creature 5/5
    const jodahDef = makeDef('jodah_def', {
      name: 'Jodah, the Unifier',
      type_line: 'Legendary Creature — Human Wizard',
      card_types: ['creature'],
      power: 5,
      toughness: 5,
      oracle_text: ANTHEM_LINE,
    });
    defs.set('jodah_def', jodahDef);
    cards.set('jodah', makeCardInst('jodah', 'jodah_def', 'p1'));

    // Additional legendary creatures (2/2 base)
    for (let i = 1; i < legendaryCount; i++) {
      const defId = `leg_def_${i}`;
      const instId = `leg_${i}`;
      defs.set(defId, makeDef(defId, {
        name: `Legend ${i}`,
        type_line: 'Legendary Creature — Human',
        card_types: ['creature'],
        power: 2,
        toughness: 2,
      }));
      cards.set(instId, makeCardInst(instId, defId, 'p1'));
    }

    let state = makeState(cards, defs);
    // Register Jodah's continuous effect (the anthem is from his source)
    state = registerContinuousEffect(state, 'jodah', 'p1', ability);
    return state;
  }

  it('X=3 when 3 legendary creatures on board — each gets +3/+3', () => {
    const state = buildScenario(3);

    // Jodah himself (5/5 base + 3 = 8/8)
    expect(getEffectivePower(state, 'jodah')).toBe(8);
    expect(getEffectiveToughness(state, 'jodah')).toBe(8);

    // Other legendary creatures (2/2 base + 3 = 5/5)
    expect(getEffectivePower(state, 'leg_1')).toBe(5);
    expect(getEffectiveToughness(state, 'leg_1')).toBe(5);

    expect(getEffectivePower(state, 'leg_2')).toBe(5);
    expect(getEffectiveToughness(state, 'leg_2')).toBe(5);
  });

  it('X=1 when only Jodah on board — Jodah gets +1/+1', () => {
    const state = buildScenario(1);

    // Jodah alone: X = 1
    expect(getEffectivePower(state, 'jodah')).toBe(6);
    expect(getEffectiveToughness(state, 'jodah')).toBe(6);
  });

  it('non-legendary creatures are NOT affected by the anthem', () => {
    // Build a scenario with Jodah + 1 non-legendary creature
    const parsed = parseOracleText(ANTHEM_LINE);
    expect(parsed.kind).toBe('StaticAbility');
    const ability = (parsed as { kind: 'StaticAbility'; ability: StaticAbilityEffect }).ability;

    const cards = new Map<string, CardInstance>();
    const defs = new Map<string, CardDefinition>();

    defs.set('jodah_def', makeDef('jodah_def', {
      name: 'Jodah, the Unifier',
      type_line: 'Legendary Creature — Human Wizard',
      card_types: ['creature'],
      power: 5,
      toughness: 5,
    }));
    cards.set('jodah', makeCardInst('jodah', 'jodah_def', 'p1'));

    defs.set('vanilla_def', makeDef('vanilla_def', {
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',   // NOT legendary
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    }));
    cards.set('vanilla', makeCardInst('vanilla', 'vanilla_def', 'p1'));

    let state = makeState(cards, defs);
    state = registerContinuousEffect(state, 'jodah', 'p1', ability);

    // Jodah gets +1/+1 (X=1, counts himself)
    expect(getEffectivePower(state, 'jodah')).toBe(6);
    expect(getEffectiveToughness(state, 'jodah')).toBe(6);

    // Non-legendary bear is NOT buffed
    expect(getEffectivePower(state, 'vanilla')).toBe(2);
    expect(getEffectiveToughness(state, 'vanilla')).toBe(2);
  });

  it('X updates dynamically — after legendary leaves, buff drops', () => {
    // Start with 3 legendaries → X=3
    let state = buildScenario(3);

    expect(getEffectivePower(state, 'jodah')).toBe(8);  // 5 + 3
    expect(getEffectivePower(state, 'leg_1')).toBe(5);   // 2 + 3

    // Move leg_2 to graveyard
    const leg2 = state.cards.get('leg_2')!;
    const updatedCards = new Map(state.cards);
    updatedCards.set('leg_2', { ...leg2, zone: 'graveyard' });
    state = { ...state, cards: updatedCards };

    // Now X=2 (Jodah + leg_1 remain)
    expect(getEffectivePower(state, 'jodah')).toBe(7);   // 5 + 2
    expect(getEffectivePower(state, 'leg_1')).toBe(4);   // 2 + 2
  });
});
