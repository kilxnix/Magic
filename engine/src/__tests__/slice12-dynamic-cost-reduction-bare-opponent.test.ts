/**
 * Slice 12/12 — Dynamic cost reduction: "for each opponent" bare form (Undaunted keyword)
 *
 * Adds Form 46 to isSelfCostReductionSentence and getIntrinsicCostReduction:
 *
 *   Form 46: "This spell costs {N} less to cast for each opponent."
 *     — Undaunted reminder-text form (no trailing "you have").
 *     Used in Undaunted keyword reminder text ("Undaunted (This spell costs {1}
 *     less to cast for each opponent.)") and as a standalone sentence on
 *     non-Undaunted cards.
 *
 *   Executor: identical to Form 4 ("for each opponent you have") — count
 *   non-eliminated opponents from state.players. The same active-player
 *   filter (p.id !== casterId && !p.hasLost) is applied.
 *
 *   Honesty gate: negative lookahead (?! you have) in the executor regex
 *   prevents double-counting when oracle text contains "for each opponent"
 *   as a strict substring of "for each opponent you have" (Form 4).
 *
 *   Dishonest forms excluded:
 *     - "for each opponent you're attacking" — combat-dependent (unknown at cast)
 *     - "for each opponent you attacked this turn" — history-dependent
 *     - "for each opponent who was dealt damage this turn" — event-history
 *     - "for each card exiled this way" (Gorex) — per-cast exile pile, opaque
 *
 * Real card examples verified:
 *   - Sublime Exhalation: "Undaunted (...for each opponent.)\nDestroy all creatures."
 *   - Seeds of Renewal:   "Undaunted (...for each opponent.)\nReturn up to two target cards..."
 *   - Coastal Breach:     "Undaunted (...for each opponent.)\nReturn all nonland permanents..."
 *   - Curtains' Call:     "Undaunted (...for each opponent.)\nDestroy two target creatures."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { isSelfCostReductionSentence } from '../effects/matchers/static-abilities';
import { getIntrinsicCostReduction } from '../effects/continuous';
import { emptyManaPool } from '../types';
import type { GameState, CardDefinition, Player } from '../types';

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string, life = 40, hasLost = false): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    commanderInstanceIds: [],
    commanderCastCounts: {},
    manaPool: emptyManaPool(),
    snowManaPool: emptyManaPool(),
    restrictedMana: [],
    conditionalMana: [],
    hasPlayedLand: false,
    landsPlayedThisTurn: 0,
    hasPriority: false, hasLost,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Sorcery',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '{5}',
    cmc: opts.cmc ?? 5,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['sorcery'],
    power: opts.power ?? undefined,
    toughness: opts.toughness ?? undefined,
  };
}

function makeState(players: Player[], overrides: Partial<GameState> = {}): GameState {
  return {
    players,
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as any,
    step: 'main' as any,
    turnNumber: 1,
    hasPriorityPassed: players.map(() => false),
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: [],
    ...overrides,
  };
}

// ============================================================================
// 1. PARSER RECOGNITION — isSelfCostReductionSentence
// ============================================================================

describe('Slice 12 — isSelfCostReductionSentence Form 46 recognition', () => {
  it('recognizes bare "for each opponent" (Undaunted extracted from reminder text)', () => {
    // After stripReminderTextForCBC, "Undaunted (This spell costs {1} less to cast for each opponent.)"
    // → "Undaunted"; absorbSelfCostReductionLines sees this. But the standalone sentence form
    // is also used on non-Undaunted cards and for the per-line cost-reduction check.
    const sentence = 'This spell costs {1} less to cast for each opponent';
    expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
  });

  it('recognizes "costs {2} less for each opponent" (higher reduction)', () => {
    const sentence = 'This spell costs {2} less to cast for each opponent';
    expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
  });

  it('still recognizes "for each opponent you have" (Form 4 regression)', () => {
    const sentence = 'This spell costs {1} less to cast for each opponent you have';
    expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
  });

  it('does NOT recognize "for each opponent you\'re attacking" (combat-dependent, opaque)', () => {
    const sentence = "This spell costs {1} less to cast for each opponent you're attacking";
    // Engine cannot evaluate combat attackers at cast-time cost-reduction phase.
    const result = isSelfCostReductionSentence(sentence);
    expect(result).toBeNull(); // not recognized — keeps face Unparsed honestly
  });

  it('does NOT recognize "for each opponent you attacked this turn" (history-dependent)', () => {
    const sentence = 'This spell costs {1} less to cast for each opponent you attacked this turn';
    const result = isSelfCostReductionSentence(sentence);
    expect(result).toBeNull();
  });

  it('does NOT recognize "for each card exiled this way" (Gorex — opaque per-cast)', () => {
    const sentence = 'This spell costs {2} less to cast for each card exiled this way';
    // Returns 'unsupported' from existing SELF_COST_REDUCTION_EXILED_THIS_WAY_RE.
    expect(isSelfCostReductionSentence(sentence)).toBe('unsupported');
  });
});

// ============================================================================
// 2. PARSE — parseOracleText with Undaunted oracle texts
// ============================================================================

describe('Slice 12 — parseOracleText for Undaunted cards (real oracle texts)', () => {
  it('Sublime Exhalation: parses as Spell (destroy-all body)', () => {
    // Real oracle: "Undaunted (This spell costs {1} less to cast for each opponent.)\nDestroy all creatures."
    const oracle = 'Undaunted (This spell costs {1} less to cast for each opponent.)\nDestroy all creatures.';
    const r = parseOracleText(oracle, '{5}{W}');
    expect(r.kind).toBe('Spell');
  });

  it('Curtains\' Call: parses as Spell (destroy two target creatures body)', () => {
    // Real oracle: "Undaunted (This spell costs {1} less to cast for each opponent.)\nDestroy two target creatures."
    const oracle = "Undaunted (This spell costs {1} less to cast for each opponent.)\nDestroy two target creatures.";
    const r = parseOracleText(oracle, '{5}{B}{B}');
    expect(r.kind).toBe('Spell');
  });

  it('Coastal Breach: parses as Spell (return all nonland permanents body)', () => {
    // Real oracle: "Undaunted (...)\nReturn all nonland permanents to their owners' hands."
    const oracle = "Undaunted (This spell costs {1} less to cast for each opponent.)\nReturn all nonland permanents to their owners' hands.";
    const r = parseOracleText(oracle, '{6}{U}');
    expect(r.kind).toBe('Spell');
  });

  it('standalone "for each opponent" + body: keyword-only face parses as StaticAbility', () => {
    // A non-Undaunted card with bare "for each opponent" standalone sentence + keyword.
    const oracle = 'This spell costs {1} less to cast for each opponent.\nTrample';
    const r = parseOracleText(oracle, '{4}{G}');
    // The cost-reduction line is absorbed; Trample is the keyword remainder.
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('ReduceCost');
    expect(r.ability.selfOnly).toBe(true);
  });

  it('standalone "for each opponent" + ETB trigger: absorption gives ETB', () => {
    // Cost-reduction absorbed, remainder is an ETB trigger.
    const oracle = 'This spell costs {1} less to cast for each opponent.\nWhen this creature enters, draw a card.';
    const r = parseOracleText(oracle, '{4}{U}');
    expect(r.kind).toBe('ETB');
  });

  it('Gorex "for each card exiled this way": stays Unparsed (opaque — honest)', () => {
    // The "for each card exiled this way" form is engine-opaque and must stay Unparsed
    // rather than silently under-charging by returning 0 reduction.
    const oracle = "As an additional cost to cast this spell, you may exile any number of creature cards from your graveyard. This spell costs {2} less to cast for each card exiled this way.\nDeathtouch\nWhenever Gorex attacks or dies, choose a card at random exiled with Gorex and put that card into its owner's hand.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// 3. EXECUTION — getIntrinsicCostReduction applies Form 46
// ============================================================================

describe('Slice 12 — getIntrinsicCostReduction Form 46 execution', () => {
  it('2-player game: 1 active opponent → reduction {1}', () => {
    const players = [makePlayer('p1'), makePlayer('p2')];
    const state = makeState(players);
    const def = makeDef('undaunted-2p', {
      oracle_text: 'Undaunted (This spell costs {1} less to cast for each opponent.)\nDestroy all creatures.',
      card_types: ['sorcery'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(1);
  });

  it('3-player game: 2 active opponents → reduction {2}', () => {
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')];
    const state = makeState(players);
    const def = makeDef('undaunted-3p', {
      oracle_text: 'Undaunted (This spell costs {1} less to cast for each opponent.)\nDestroy two target creatures.',
      card_types: ['sorcery'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(2);
  });

  it('4-player Commander game: 3 opponents → reduction {3}', () => {
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3'), makePlayer('p4')];
    const state = makeState(players);
    const def = makeDef('undaunted-4p', {
      oracle_text: 'Undaunted (This spell costs {1} less to cast for each opponent.)\nReturn all nonland permanents to their owners\'s hands.',
      card_types: ['sorcery'],
    });
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(3);
  });

  it('eliminates lost opponents from the count', () => {
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3', 40, true)]; // p3 eliminated
    const state = makeState(players);
    const def = makeDef('undaunted-elim', {
      oracle_text: 'Undaunted (This spell costs {1} less to cast for each opponent.)\nDestroy all creatures.',
      card_types: ['sorcery'],
    });
    // Only p2 active → reduction = 1
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(1);
  });

  it('no double-count: Form 4 "you have" and Form 46 bare are mutually exclusive', () => {
    // "for each opponent you have" should only be counted once (Form 4 wins;
    // Form 46 guard !opponentMatch prevents double-count).
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3')];
    const state = makeState(players);
    const def = makeDef('form4-guard', {
      oracle_text: 'This spell costs {1} less to cast for each opponent you have.',
      card_types: ['sorcery'],
    });
    // 2 opponents × {1} = 2, NOT 4 (no double count)
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(2);
  });

  it('Seeds of Renewal style: return-from-GY body + Undaunted reduction', () => {
    // Seeds of Renewal: "Undaunted (This spell costs {1} less to cast for each opponent.)\n
    //   Return up to two target cards from your graveyard to your hand. Exile Seeds of Renewal."
    const players = [makePlayer('p1'), makePlayer('p2'), makePlayer('p3'), makePlayer('p4')];
    const state = makeState(players);
    const def = makeDef('seeds-of-renewal', {
      oracle_text: "Undaunted (This spell costs {1} less to cast for each opponent.)\nReturn up to two target cards from your graveyard to your hand. Exile Seeds of Renewal.",
      card_types: ['instant'],
    });
    // 4-player game: 3 opponents → reduction = 3
    expect(getIntrinsicCostReduction(state, 'p1', def)).toBe(3);
  });
});
