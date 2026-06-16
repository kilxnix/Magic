/**
 * slice2-prepared-only-credit.test.ts
 *
 * Slice 2/12 — gap (a): "enters prepared"-only faces credited as AbsorbedOnly.
 *
 * WHAT THIS TESTS:
 *   Faces whose ONLY substantive content is "This creature enters prepared." plus
 *   engine keywords currently return null from parseOracleTextPerLine, which the
 *   outer parseOracleText turns into plain { kind: 'Unparsed', reason: 'No
 *   recognized pattern' } — no absorbedKeywords set, so the audit counts these
 *   as hard misses.
 *
 *   After the fix:
 *     (a) Single-line prepared-only faces ("This creature enters prepared."):
 *         parseOracleText detects the prepared-only pattern early and returns
 *         { kind: 'Unparsed', reason: 'Absorbed-only face: prepared-only',
 *           absorbedKeywords: ['This creature enters prepared.'] }
 *     (b) Multi-line faces whose ONLY non-blank lines are engine keywords +
 *         "This creature enters prepared.":
 *         parseOracleTextPerLine's absorbed-only gate fires and returns
 *         { kind: 'Unparsed', ..., absorbedKeywords: [...] }
 *     In both cases kind is still 'Unparsed' (the creature has no executor-
 *     backed effects), but absorbedKeywords is set so the audit classifies the
 *     face as AbsorbedOnly (credited) rather than a hard miss.
 *
 * HONESTY ROUTE: HONEST SKIP
 *   "Prepared" is the Secrets of Strixhaven mechanic that grants a copy-cast
 *   mode. Zero executor support exists — grep src/ confirms no prepared /
 *   shield-counter / copy-cast-from-prepared in stack.ts or executor.ts.
 *   Crediting the face does not claim any effect runs; the creature plays as
 *   its printed body (P/T + enforced keywords from keywords.ts).
 *
 * REAL ORACLE WORDINGS EXERCISED:
 *   Adventurous Eater creature face:
 *     "This creature enters prepared. (While it's prepared, you may cast a
 *      copy of its spell. Doing so unprepares it.)"
 *   Blazing Firesinger creature face:
 *     "This creature enters prepared. (While it's prepared, you may cast a
 *      copy of its spell. Doing so unprepares it.)"
 *   Goblin Glasswright creature face:
 *     "This creature enters prepared. (While it's prepared, you may cast a
 *      copy of its spell. Doing so unprepares it.)"
 *   Maelstrom Artisan creature face:
 *     "Haste\nThis creature enters prepared. (reminder)"
 *   Skycoach Conductor creature face:
 *     "Flash\nFlying, vigilance\nThis creature enters prepared. (reminder)"
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { GameState } from '../types';

// ---------------------------------------------------------------------------
// Minimal test-state factory (no cards needed since there are no effects)
// ---------------------------------------------------------------------------

function makeMinimalState(): GameState {
  return {
    cards: new Map(),
    cardDefinitions: new Map(),
    players: [
      {
        id: 'p1',
        life: 40,
        mana: {},
        library: [],
        graveyard: [],
        hand: [],
        battlefield: [],
        exile: [],
        commandZone: [],
      },
      {
        id: 'p2',
        life: 40,
        mana: {},
        library: [],
        graveyard: [],
        hand: [],
        battlefield: [],
        exile: [],
        commandZone: [],
      },
    ] as any[],
    turn: {
      number: 1,
      activePlayerId: 'p1',
      phase: 'main1',
      priority: 'p1',
      landPlaysRemaining: 1,
      spellsCastThisTurn: 0,
      creaturesDiedThisTurn: 0,
    },
    stack: [],
    triggers: [],
    log: [],
    monarchId: null,
    initiativeHolderId: null,
    citysBlessingPlayers: new Set(),
    havenPlayers: new Set(),
    chainVeilActivationsThisTurn: 0,
  } as unknown as GameState;
}

// ===========================================================================
// (a) Single-line "enters prepared" faces — parse tests
// ===========================================================================

describe('Slice 2/12 gap-a — single-line prepared-only faces', () => {

  it('Adventurous Eater creature face: kind is Unparsed with absorbedKeywords set', () => {
    // Real oracle wording (reminder text is present and stripped by parser).
    const r = parseOracleText(
      "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    expect(r.kind).toBe('Unparsed');
    // absorbedKeywords MUST be set — signals AbsorbedOnly credit to the audit.
    expect(r.absorbedKeywords).toBeDefined();
    expect((r.absorbedKeywords ?? []).length).toBeGreaterThan(0);
    // The prepared line should be in absorbedKeywords.
    const abs = (r.absorbedKeywords ?? []).join(' ');
    expect(abs).toMatch(/enters\s+prepared/i);
  });

  it('Blazing Firesinger creature face: same single-line prepared form credited', () => {
    // Blazing Firesinger's creature face has the identical oracle text pattern.
    const r = parseOracleText(
      "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    expect((r.absorbedKeywords ?? []).some(k => /prepared/i.test(k))).toBe(true);
  });

  it('Goblin Glasswright creature face: prepared-only, absorbedKeywords present', () => {
    // Goblin Glasswright's creature face — same single-line prepared mechanic.
    const r = parseOracleText(
      "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    // Audit gate: absorbedKeywords must be non-empty so classifyFace can see AbsorbedOnly.
    expect((r.absorbedKeywords ?? []).length).toBeGreaterThan(0);
  });

  it('reason field carries "Absorbed-only" description for audit classification', () => {
    const r = parseOracleText("This creature enters prepared.");
    expect(r.kind).toBe('Unparsed');
    // The reason is set — verifies this is the absorbed-only path, not the default miss.
    expect(r.reason ?? '').toMatch(/absorbed.only|prepared/i);
  });

  it('EXECUTION: no effects exist — executeEffects with empty list succeeds', () => {
    // Prepared-only faces have zero executor-backed effects. The "creature plays as
    // printed body" — this test verifies executeEffects handles the empty list
    // correctly (no throw, returns state unchanged).
    const state = makeMinimalState();
    const newState = executeEffects(state, [], 'p1', [], [], 0, {});
    expect(newState).toBeDefined();
    // State is unchanged when there are no effects.
    expect(newState.players[0].life).toBe(40);
  });

});

// ===========================================================================
// (b) Multi-line "keywords + enters prepared" faces — parse tests
// ===========================================================================

describe('Slice 2/12 gap-a — multi-line absorbed-only faces (Maelstrom Artisan style)', () => {

  it('Maelstrom Artisan face: "Haste + enters prepared" → Unparsed with absorbedKeywords', () => {
    // Maelstrom Artisan creature face oracle text: "Haste\nThis creature enters prepared."
    // "Haste" is absorbed as engine keyword (step 1);
    // "This creature enters prepared." is absorbed as unenforced skip (step 1j).
    // After the fix: absorbed-only gate fires, sets absorbedKeywords, credits the face.
    const r = parseOracleText(
      "Haste\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = (r.absorbedKeywords ?? []).join(' ');
    // Both the keyword and the prepared line should be in absorbedKeywords.
    expect(abs).toMatch(/haste/i);
    expect(abs).toMatch(/prepared/i);
  });

  it('Skycoach Conductor style: "Flash + Flying, vigilance + enters prepared" credited', () => {
    // Three lines, all absorbed: Flash (engine keyword), "Flying, vigilance" (engine keywords),
    // "This creature enters prepared." (unenforced skip).
    // After the fix, absorbed-only gate credits the face.
    const r = parseOracleText(
      "Flash\nFlying, vigilance\nThis creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = (r.absorbedKeywords ?? []).join(' ').toLowerCase();
    expect(abs).toMatch(/prepared/);
  });

  it('reason distinguishes absorbed-only from hard miss', () => {
    const r = parseOracleText(
      "Haste\nThis creature enters prepared.",
    );
    expect(r.kind).toBe('Unparsed');
    // The result must carry absorbedKeywords or have a descriptive reason.
    const isAbsorbedOnly =
      ((r.absorbedKeywords ?? []).length > 0) ||
      /absorbed.only/i.test(r.reason ?? '');
    expect(isAbsorbedOnly).toBe(true);
  });

  it('EXECUTION: multi-line absorbed-only faces have no effects — executor succeeds', () => {
    // Verify that when a prepared-only face is credited, there are no effects
    // that would cause issues in the executor. The executor must handle this
    // gracefully (empty effect list = no-op).
    const state = makeMinimalState();
    const newState = executeEffects(state, [], 'p1', [], [], 0, {});
    expect(newState).toBeDefined();
    expect(newState.players[1].life).toBe(40);
  });

});

// ===========================================================================
// (c) Honesty gates — companion-bearing faces must NOT be absorbed-only
// ===========================================================================

describe('Slice 2/12 gap-a — honesty: prepared faces WITH companion still parse via companion', () => {

  it('prepared + ETB companion: kind = ETB (not absorbed-only)', () => {
    // The companion ETB clause MUST carry the face — only the prepared line is absorbed.
    const r = parseOracleText(
      "This creature enters prepared.\nWhen ~ enters, draw a card.",
    );
    // Should be ETB, not absorbed-only.
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
  });

  it('prepared + static companion: kind = StaticAbility (not absorbed-only)', () => {
    const r = parseOracleText(
      "This creature enters prepared.\nCreatures you control get +1/+1.",
    );
    expect(r.kind).toBe('StaticAbility');
  });

  it('prepared + activated ability companion: kind = Activated (not absorbed-only)', () => {
    // Sanar, Unfinished Genius style: "Sanar enters prepared. ...\n{T}: Create a Treasure token. ..."
    const r = parseOracleText(
      "Sanar enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)\n{T}: Create a Treasure token.",
    );
    // The activated ability should parse.
    expect(r.kind).toBe('Activated');
    expect(r.absorbedKeywords).toBeDefined();
    expect((r.absorbedKeywords ?? []).join(' ')).toMatch(/prepared/i);
  });

});
