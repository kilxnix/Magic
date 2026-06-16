import { describe, it, expect } from 'vitest';
import type { GameState, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { getEntersWithCountersConditionalForTest } from '../stack';

// Slice 2: Conditional ETB enters-with-counters (Morbid / Raid ability-word forms)
//
// Parser: matchEntersWithCountersConditional emits a recognition-only StaticAbility
//   (GrantKeyword 'EntersWithCountersConditional', selfOnly) so faces like
//   "This creature enters with four +1/+1 counters on it if a creature died this turn."
//   and "Raid — This creature enters with a +1/+1 counter if you attacked this turn."
//   are no longer Unparsed.
//
// Runtime: entersWithCountersConditional in stack.ts re-reads the oracle text at ETB
//   time, evaluates the condition, and places counters only when the condition is true.
//
// Conditions supported (both have state trackers):
//   • "if a creature died this turn"  →  state.creaturesDiedThisTurn > 0  (Morbid)
//   • "if you attacked this turn"     →  state.playersWhoAttackedThisTurn  (Raid)
//
// Conditions DECLINED (no state tracker — honesty bar):
//   • "if a permanent left the battlefield" (Revolt — no permanentLeftThisTurn tracker)
//   • "if an opponent lost life this turn"  (no lifeLostThisTurn tracker)
//   • "if you control a modified creature"  (no 'modified' filter in CardFilter)
//
// Oracle texts exercised:
//   A. Plain Morbid:   "This creature enters with four +1/+1 counters on it if a creature died this turn."
//   B. Raid form:      "War-Name Aspirant: Raid — This creature enters with a +1/+1 counter on it if you attacked this turn."
//   C. Multi-line:     keyword line + conditional-counter line
//
// Honesty bar tests:
//   D. Revolt declined (no tracker)
//   E. Opponent-lost-life declined (no tracker)
//   F. Modified-creature declined (no tracker)

// ── helpers ────────────────────────────────────────────────────────────────────

function makeState(
  overrides: Partial<Pick<GameState, 'creaturesDiedThisTurn' | 'playersWhoAttackedThisTurn'>> = {},
): GameState {
  const cards = new Map<string, CardInstance>();
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards,
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    creaturesDiedThisTurn: 0,
    playersWhoAttackedThisTurn: [],
    ...overrides,
  };
}

// ── Parser tests ───────────────────────────────────────────────────────────────

describe('slice-2 ETB counters conditional: parser recognition', () => {

  // ── A. Plain Morbid form ────────────────────────────────────────────────────

  it('parses plain Morbid: "This creature enters with four +1/+1 counters on it if a creature died this turn."', () => {
    const oracle = 'This creature enters with four +1/+1 counters on it if a creature died this turn.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.selfOnly).toBe(true);
  });

  // ── B. Raid ability-word form ───────────────────────────────────────────────

  it('parses Raid ability-word: "Raid — This creature enters with a +1/+1 counter on it if you attacked this turn."', () => {
    const oracle = 'Raid — This creature enters with a +1/+1 counter on it if you attacked this turn.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.selfOnly).toBe(true);
  });

  it('parses bare "if you attacked this turn" (without ability-word prefix)', () => {
    const oracle = 'This creature enters with a +1/+1 counter on it if you attacked this turn.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
  });

  it('parses "Morbid —" prefix form', () => {
    const oracle = 'Morbid — This creature enters with two +1/+1 counters on it if a creature died this turn.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
  });

  // ── C. Multi-line absorption ────────────────────────────────────────────────

  it('absorbs conditional line in multi-line face (keyword + conditional counter)', () => {
    const oracle =
      'Haste\n' +
      'This creature enters with four +1/+1 counters on it if a creature died this turn.';
    const parsed = parseOracleText(oracle);
    // The face must not be Unparsed — both lines are absorbed/parsed.
    expect(parsed.kind).not.toBe('Unparsed');
  });

  it('absorbs conditional line alongside an ETB trigger', () => {
    const oracle =
      'This creature enters with a +1/+1 counter on it if you attacked this turn.\n' +
      'When this creature enters, draw a card.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
  });

  // ── D/E/F. Honesty-bar declined forms ────────────────────────────────────────

  it('DECLINES Revolt "if a permanent left the battlefield" (no tracker)', () => {
    const oracle =
      'Revolt — This creature enters with two +1/+1 counters on it if a permanent left the battlefield this turn.';
    const parsed = parseOracleText(oracle);
    // Must NOT be recognised by matchEntersWithCountersConditional — Revolt has no tracker.
    // It may remain Unparsed (honest skip) or be caught by another matcher.
    // The important check: it must NOT emit a StaticAbility with the conditional keyword
    // (which would falsely claim the engine supports Revolt at ETB time).
    if (parsed.kind === 'StaticAbility') {
      // If somehow it parsed, it must not be our conditional keyword
      const modifier = (parsed.ability as { modifier?: { keyword?: string } }).modifier;
      expect(modifier?.keyword).not.toBe('EntersWithCountersConditional');
    }
  });

  it('DECLINES "if an opponent lost life this turn" (no tracker)', () => {
    const oracle =
      'This creature enters with a +1/+1 counter on it if an opponent lost life this turn.';
    const parsed = parseOracleText(oracle);
    if (parsed.kind === 'StaticAbility') {
      const modifier = (parsed.ability as { modifier?: { keyword?: string } }).modifier;
      expect(modifier?.keyword).not.toBe('EntersWithCountersConditional');
    }
  });

  it('DECLINES "if you control a modified creature" (no modified filter)', () => {
    const oracle =
      'This creature enters with a +1/+1 counter on it if you control a modified creature.';
    const parsed = parseOracleText(oracle);
    if (parsed.kind === 'StaticAbility') {
      const modifier = (parsed.ability as { modifier?: { keyword?: string } }).modifier;
      expect(modifier?.keyword).not.toBe('EntersWithCountersConditional');
    }
  });
});

// ── Runtime tests ──────────────────────────────────────────────────────────────

describe('slice-2 ETB counters conditional: runtime (entersWithCountersConditional)', () => {

  // ── Morbid condition ─────────────────────────────────────────────────────────

  it('places four +1/+1 counters when creaturesDiedThisTurn > 0 (Morbid)', () => {
    const oracle = 'This creature enters with four +1/+1 counters on it if a creature died this turn.';
    const state = makeState({ creaturesDiedThisTurn: 1 });
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(1);
    expect(result[0].counterType).toBe('+1/+1');
    expect(result[0].count).toBe(4);
  });

  it('places NO counters when creaturesDiedThisTurn is 0 (Morbid condition not met)', () => {
    const oracle = 'This creature enters with four +1/+1 counters on it if a creature died this turn.';
    const state = makeState({ creaturesDiedThisTurn: 0 });
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(0);
  });

  it('places NO counters when creaturesDiedThisTurn is undefined (no creatures died)', () => {
    const oracle = 'This creature enters with four +1/+1 counters on it if a creature died this turn.';
    const state = makeState();
    delete (state as Partial<typeof state>).creaturesDiedThisTurn;
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(0);
  });

  // ── Raid condition ────────────────────────────────────────────────────────────

  it('places one +1/+1 counter when player attacked this turn (Raid)', () => {
    const oracle = 'Raid — This creature enters with a +1/+1 counter on it if you attacked this turn.';
    const state = makeState({ playersWhoAttackedThisTurn: ['p0'] });
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(1);
    expect(result[0].counterType).toBe('+1/+1');
    expect(result[0].count).toBe(1);
  });

  it('places NO counters when owner did NOT attack this turn (Raid condition not met)', () => {
    const oracle = 'This creature enters with a +1/+1 counter on it if you attacked this turn.';
    // p0 did not attack; p1 did
    const state = makeState({ playersWhoAttackedThisTurn: ['p1'] });
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(0);
  });

  it('places NO counters when playersWhoAttackedThisTurn is empty (Raid)', () => {
    const oracle = 'This creature enters with a +1/+1 counter on it if you attacked this turn.';
    const state = makeState({ playersWhoAttackedThisTurn: [] });
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(0);
  });

  // ── Declined conditions return empty ─────────────────────────────────────────

  it('returns empty for "if a permanent left the battlefield" (Revolt — no tracker)', () => {
    const oracle = 'Revolt — This creature enters with two +1/+1 counters on it if a permanent left the battlefield this turn.';
    const state = makeState({ creaturesDiedThisTurn: 1 }); // even with died, Revolt is declined
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(0);
  });

  it('returns empty for "if an opponent lost life this turn" (no tracker)', () => {
    const oracle = 'This creature enters with a +1/+1 counter on it if an opponent lost life this turn.';
    const state = makeState({ creaturesDiedThisTurn: 1 });
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(0);
  });

  // ── Two +1/+1 counters: Morbid two-counter form ──────────────────────────────

  it('places two +1/+1 counters with "enters with two +1/+1 counters if a creature died this turn"', () => {
    const oracle = 'Morbid — This creature enters with two +1/+1 counters on it if a creature died this turn.';
    const state = makeState({ creaturesDiedThisTurn: 2 });
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(1);
    expect(result[0].counterType).toBe('+1/+1');
    expect(result[0].count).toBe(2);
  });

  // ── Unconditional text must NOT be matched by the conditional function ────────

  it('returns empty for unconditional "enters with a +1/+1 counter on it." (no "if" clause)', () => {
    const oracle = 'This creature enters with a +1/+1 counter on it.';
    const state = makeState({ creaturesDiedThisTurn: 1 });
    const result = getEntersWithCountersConditionalForTest(oracle, state, 'p0');
    expect(result).toHaveLength(0);
  });
});
