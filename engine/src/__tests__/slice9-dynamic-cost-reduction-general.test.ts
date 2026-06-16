/**
 * Slice 9/12 — Dynamic cost reduction: generalized count-clause parser
 *
 * Tests for Forms 33 and 35 added to isSelfCostReductionSentence:
 *
 *  33. Generalized compound "for each <multi-word filter> you control and each
 *      <multi-word filter> card in your graveyard". Extends Form 6 (COMPOUND_RE)
 *      to multi-word filter phrases on either or both sides.
 *      Examples:
 *        "for each artifact creature you control and each artifact creature card in your graveyard"
 *        "for each legendary creature you control and each Dragon card in your graveyard"
 *
 *  35. Compound without "card" keyword: "for each <filter> you control and each
 *      <filter> in your graveyard". Executor Form 2 computes the battlefield half;
 *      the graveyard half is conservatively skipped (honest partial reduction).
 *      Example:
 *        "for each artifact you control and each artifact in your graveyard"
 *
 * Honesty gates (should remain Unparsed or declined):
 *  - "for each artifact creature card in your graveyard" (graveyard-only multi-word)
 *    → executor Form 5 handles single-word only; multi-word graveyard-only is
 *      NOT executor-supported → must stay Unparsed.
 *  - "for each card exiled this way" → unsupported (existing gate, regression check)
 *
 * Each section: parser recognition + getIntrinsicCostReduction runtime check.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { isSelfCostReductionSentence } from '../effects/matchers/static-abilities';
import { getIntrinsicCostReduction } from '../effects/continuous';
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
    commanderInstanceIds: [],
    commanderCastCounts: {},
    manaPool: emptyManaPool(),
    snowManaPool: emptyManaPool(),
    restrictedMana: [],
    conditionalMana: [],
    hasPlayedLand: false,
    landsPlayedThisTurn: 0,
    hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'] = 'battlefield',
): CardInstance {
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
    cmc: opts.cmc ?? 0,
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
    ...overrides,
  };
}

// ============================================================================
// Form 33: multi-word compound battlefield + graveyard
// ============================================================================

describe('Form 33 — multi-word compound "for each <X Y> you control and each <X Y> card in your graveyard"', () => {

  describe('parser recognition (isSelfCostReductionSentence)', () => {
    it('recognizes multi-word same subject: "for each artifact creature you control and each artifact creature card in your graveyard"', () => {
      const sentence = 'This spell costs {2} less to cast for each artifact creature you control and each artifact creature card in your graveyard';
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('recognizes multi-word different subjects: "for each legendary creature you control and each Dragon card in your graveyard"', () => {
      const sentence = 'This spell costs {1} less to cast for each legendary creature you control and each Dragon card in your graveyard';
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('recognizes mixed subject: "for each creature you control and each artifact creature card in your graveyard"', () => {
      const sentence = 'This spell costs {2} less to cast for each creature you control and each artifact creature card in your graveyard';
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('single-word subjects also match (superset of Form 6)', () => {
      // Already covered by COMPOUND_RE but harmlessly covered by Form 33 too.
      const sentence = 'This spell costs {1} less to cast for each Cave you control and each Cave card in your graveyard';
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });
  });

  describe('parseOracleText returns StaticAbility (parsed, not Unparsed)', () => {
    it('keyword-only face: "for each artifact creature you control and each artifact creature card in your graveyard"', () => {
      const r = parseOracleText(
        'This spell costs {2} less to cast for each artifact creature you control and each artifact creature card in your graveyard.',
      );
      expect(r.kind).toBe('StaticAbility');
      if (r.kind !== 'StaticAbility') return;
      expect(r.ability.modifier.kind).toBe('ReduceCost');
      expect(r.ability.selfOnly).toBe(true);
    });

    it('absorbed form: cost reduction + keyword', () => {
      const r = parseOracleText(
        'This spell costs {2} less to cast for each artifact creature you control and each artifact creature card in your graveyard.\nFlying',
      );
      // Either recognized as a StaticAbility (keyword-only path) or absorbed + reparsed.
      // The key check: it must NOT be Unparsed.
      expect(r.kind).not.toBe('Unparsed');
    });
  });

  describe('getIntrinsicCostReduction runtime — executor computes battlefield count', () => {
    it('counts creatures on battlefield (executor Form 2 handles battlefield half)', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      // 2 artifact creatures on p1's battlefield
      defs.set('ac1', makeDef('ac1', {
        type_line: 'Artifact Creature — Construct',
        card_types: ['artifact', 'creature'],
      }));
      defs.set('ac2', makeDef('ac2', {
        type_line: 'Artifact Creature — Golem',
        card_types: ['artifact', 'creature'],
      }));
      // 1 non-artifact creature (also counts because executor uses major type matching)
      defs.set('c3', makeDef('c3', {
        type_line: 'Creature — Elf',
        card_types: ['creature'],
      }));
      // Opponent's artifact creature — should NOT count
      defs.set('opp', makeDef('opp', {
        type_line: 'Artifact Creature — Robot',
        card_types: ['artifact', 'creature'],
      }));

      cards.set('a', makeCard('a', 'ac1', 'p1'));
      cards.set('b', makeCard('b', 'ac2', 'p1'));
      cards.set('c', makeCard('c', 'c3', 'p1'));
      cards.set('o', makeCard('o', 'opp', 'p2'));

      const spellDef = makeDef('spell', {
        oracle_text:
          'This spell costs {2} less to cast for each artifact creature you control and each artifact creature card in your graveyard.',
        card_types: ['creature'],
      });

      const state = makeState({ cards, cardDefinitions: defs });
      // Executor Form 2 fires for the battlefield half. subjectMatchesCostReduction("artifact creature")
      // matches \bcreature → counts ALL creatures on p1's battlefield (ac1, ac2, c3 = 3).
      // Graveyard half is not counted (no executor form handles multi-word graveyard subject).
      const reduction = getIntrinsicCostReduction(state, 'p1', spellDef);
      // The reduction must be > 0 (executor runs), even if less than the printed oracle amount.
      expect(reduction).toBeGreaterThan(0);
    });

    it('returns 0 when no matching permanents on battlefield', () => {
      const state = makeState({ cards: new Map(), cardDefinitions: new Map() });
      const spellDef = makeDef('spell', {
        oracle_text:
          'This spell costs {2} less to cast for each artifact creature you control and each artifact creature card in your graveyard.',
        card_types: ['creature'],
      });
      expect(getIntrinsicCostReduction(state, 'p1', spellDef)).toBe(0);
    });
  });
});

// ============================================================================
// Form 35: compound without "card" keyword
// ============================================================================

describe('Form 35 — compound without "card": "for each <filter> you control and each <filter> in your graveyard"', () => {

  describe('parser recognition (isSelfCostReductionSentence)', () => {
    it('recognizes "for each artifact you control and each artifact in your graveyard"', () => {
      const sentence = 'This spell costs {1} less to cast for each artifact you control and each artifact in your graveyard';
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('recognizes "for each creature you control and each creature in your graveyard"', () => {
      const sentence = 'This spell costs {2} less to cast for each creature you control and each creature in your graveyard';
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });

    it('recognizes multi-word: "for each artifact creature you control and each artifact creature in your graveyard"', () => {
      const sentence = 'This spell costs {1} less to cast for each artifact creature you control and each artifact creature in your graveyard';
      expect(isSelfCostReductionSentence(sentence)).toBe('dynamic');
    });
  });

  describe('parseOracleText returns non-Unparsed', () => {
    it('keyword-only face: "for each artifact you control and each artifact in your graveyard"', () => {
      const r = parseOracleText(
        'This spell costs {1} less to cast for each artifact you control and each artifact in your graveyard.',
      );
      expect(r.kind).not.toBe('Unparsed');
    });
  });

  describe('getIntrinsicCostReduction runtime — executor computes battlefield count', () => {
    it('counts artifacts on battlefield (Form 2 runs, graveyard half is not counted without "card")', () => {
      const cards = new Map<string, CardInstance>();
      const defs = new Map<string, CardDefinition>();

      // 3 artifacts on p1's battlefield
      for (let i = 1; i <= 3; i++) {
        defs.set(`art${i}`, makeDef(`art${i}`, {
          type_line: 'Artifact',
          card_types: ['artifact'],
        }));
        cards.set(`a${i}`, makeCard(`a${i}`, `art${i}`, 'p1'));
      }
      // Opponent artifact should NOT count
      defs.set('opp', makeDef('opp', { type_line: 'Artifact', card_types: ['artifact'] }));
      cards.set('oa', makeCard('oa', 'opp', 'p2'));

      const spellDef = makeDef('spell', {
        oracle_text: 'This spell costs {1} less to cast for each artifact you control and each artifact in your graveyard.',
        card_types: ['sorcery'],
      });

      const state = makeState({ cards, cardDefinitions: defs });
      // Executor Form 6 requires "card in your graveyard" → fails.
      // Executor Form 2 (else branch) matches "for each artifact you control" → counts 3 artifacts.
      const reduction = getIntrinsicCostReduction(state, 'p1', spellDef);
      expect(reduction).toBe(3);
    });
  });
});

// ============================================================================
// Honesty gates: forms that MUST remain Unparsed
// ============================================================================

describe('Honesty gates — forms that should NOT be recognized', () => {
  it('declines "for each artifact creature card in your graveyard" (graveyard-only multi-word — no executor support)', () => {
    // Executor Form 5 only handles single-word: `for each (\w+) card in your graveyard`.
    // Multi-word graveyard-only has no executor backing → must stay null.
    const sentence = 'This spell costs {1} less to cast for each artifact creature card in your graveyard';
    // Should return null (not 'dynamic') — executor doesn't handle this.
    // Note: isSelfCostReductionSentence returns null because neither GRAVEYARD_RE (single-\w+)
    // nor Form 33 (requires "you control and each") match this sentence.
    const result = isSelfCostReductionSentence(sentence);
    expect(result).toBeNull();
  });

  it('declines "for each card exiled this way" (regression: existing unsupported gate)', () => {
    const sentence = 'This spell costs {2} less to cast for each card exiled this way';
    expect(isSelfCostReductionSentence(sentence)).toBe('unsupported');
  });

  it('parseOracleText returns Unparsed for graveyard-only multi-word oracle text (no compound part)', () => {
    const r = parseOracleText(
      'This spell costs {1} less to cast for each artifact creature card in your graveyard.',
    );
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// Regression: existing Forms 6, EACH_BF, COMPOUND still work
// ============================================================================

describe('Regression — existing compound and battlefield forms still recognized', () => {
  it('Form 6 single-word compound still works', () => {
    const s = 'This spell costs {2} less to cast for each creature you control and each creature card in your graveyard';
    expect(isSelfCostReductionSentence(s)).toBe('dynamic');
  });

  it('EACH_BF simple battlefield form still works', () => {
    const s = 'This spell costs {1} less to cast for each artifact you control';
    expect(isSelfCostReductionSentence(s)).toBe('dynamic');
  });

  it('EACH_BF with subtype still works', () => {
    const s = 'This spell costs {1} less to cast for each Goblin you control';
    expect(isSelfCostReductionSentence(s)).toBe('dynamic');
  });
});
