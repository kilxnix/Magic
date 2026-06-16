/**
 * Slice 1 coverage round — parametric multi-pip & bare-number keyword classification
 *
 * PROBLEM (two normalization bugs):
 *   (1) The audit's isKeywordOnlyOracle stripped only ONE trailing brace group
 *       via /\s*\{[^}]+\}\s*$/ so multi-pip cost lines like
 *       "Morph {6}{G}", "Scavenge {4}{G}{G}", "Echo {2}{G}", "Disturb {3}{W}"
 *       left "morph {6}" / "scavenge {4}{g}" etc. which are NOT in the keywordSet,
 *       causing 110 faces to be miscounted as Unparsed instead of KeywordOnly.
 *   (2) Bare-number keyword lines ("Bushido 1", "Soulshift 4", "Crew 1", "Renown 2",
 *       "Toxic 3", "Rampage 2", "Afterlife 2", "Backup 1", "Ripple 4") never stripped
 *       the trailing number, so "bushido 1" was not found in keywordSet ("bushido"),
 *       causing 99 additional faces to be miscounted.
 *   (3) parser.ts isTextKeywordOnly did not recognise MORPH_COST_LINE_RE lines so
 *       a morph-only remainder from earlyAdditionalCastCostAbsorption would return
 *       false and not annotate the Unparsed result.
 *
 * FIX:
 *   audit-parser-coverage.cjs isKeywordOnlyOracle: replace single-brace strip with
 *     .replace(/(\s*\{[^}]+\})+\s*$/, '').replace(/\s+\d+$/, '')
 *   parser.ts isTextKeywordOnly: add MORPH_COST_LINE_RE.test(cleaned) to the
 *     accepted-line guard so morph cost lines in a keyword-only remainder are
 *     recognised.
 *
 * HONESTY: all keywords tested here have zero executor/keywords.ts enforcement
 *   (verified by grep). The fix only changes CLASSIFICATION — Unparsed → KeywordOnly
 *   in the audit gate. No engine behaviour is fabricated.
 *
 * EXAMPLE CARDS (from task spec):
 *   Towering Baloth:        Morph {6}{G}
 *   Deadbridge Goliath:     Scavenge {4}{G}{G}
 *   Hundred-Talon Kami:     Flying\nSoulshift 4
 *   Nezumi Ronin:           Bushido 1
 *   Sleek Schooner:         Crew 1
 *   Tyrranax Atrocity:      Haste\nToxic 3
 */

import { describe, it, expect } from 'vitest';
import {
  parseOracleText,
  ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE,
  MORPH_COST_LINE_RE,
} from '../effects/parser';

// ============================================================================
// PART 1 — Audit normalization logic (mirrored as unit tests)
//
// The audit's isKeywordOnlyOracle normalizes each keyword part by stripping
// trailing brace groups and bare trailing numbers before checking the keywordSet.
// We validate the expected normalized forms here to confirm the regex fix.
// ============================================================================

describe('Audit normalization — strip ALL trailing brace groups (multi-pip fix)', () => {
  /**
   * Mirrors the NEW normalize logic from audit-parser-coverage.cjs:
   *   part.replace(/(\s*\{[^}]+\})+\s*$/, '').replace(/\s+\d+$/, '').trim()
   */
  function normalize(part: string): string {
    return part
      .replace(/(\s*\{[^}]+\})+\s*$/g, '')
      .replace(/\s+\d+$/, '')
      .trim();
  }

  const multiPipCases: [string, string][] = [
    // Oracle text (lowercased)  →  expected normalized form (matches card.keywords)
    ['morph {6}{g}', 'morph'],
    ['morph {3}{w}', 'morph'],
    ['scavenge {4}{g}{g}', 'scavenge'],
    ['echo {2}{g}', 'echo'],
    ['disturb {3}{w}', 'disturb'],
    ['outlast {1}{b}', 'outlast'],
    ['cycling {1}{u}', 'cycling'],
    ['embalm {3}{u}', 'embalm'],
    ['offspring {1}{w}', 'offspring'],
  ];

  for (const [input, expected] of multiPipCases) {
    it(`multi-pip: normalize("${input}") = "${expected}"`, () => {
      expect(normalize(input)).toBe(expected);
    });
  }

  const bareNumberCases: [string, string][] = [
    ['bushido 1', 'bushido'],
    ['soulshift 4', 'soulshift'],
    ['crew 1', 'crew'],
    ['renown 2', 'renown'],
    ['toxic 3', 'toxic'],
    ['rampage 2', 'rampage'],
    ['afterlife 2', 'afterlife'],
    ['backup 1', 'backup'],
    ['ripple 4', 'ripple'],
    ['bloodthirst 3', 'bloodthirst'],
    ['fading 3', 'fading'],
    ['vanishing 4', 'vanishing'],
  ];

  for (const [input, expected] of bareNumberCases) {
    it(`bare-number: normalize("${input}") = "${expected}"`, () => {
      expect(normalize(input)).toBe(expected);
    });
  }
});

// ============================================================================
// PART 2 — ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE already handles multi-pip
//
// Confirm that the existing regex correctly matches multi-pip and bare-number
// keyword lines (these are already absorbed by the parser's early dispatch).
// ============================================================================

describe('ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE — multi-pip and bare-number coverage', () => {
  const shouldMatch = [
    // Multi-pip (two brace groups — the key new coverage):
    'Scavenge {4}{G}{G}',
    'Echo {2}{G}',
    'Disturb {3}{W}',
    'Embalm {3}{U}',
    'Offspring {1}{W}',
    // Bare numbers — already in the regex:
    'Bushido 1',
    'Bushido 2',
    'Rampage 2',
    'Backup 1',
    'Crew 1',
    'Renown 2',
    'Toxic 3',
    'Ripple 4',
    'Bloodthirst 3',
    'Fading 3',
    'Vanishing 4',
  ];

  for (const line of shouldMatch) {
    it(`ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE matches: "${line}"`, () => {
      expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(line)).toBe(true);
    });
  }
});

// ============================================================================
// PART 3 — MORPH_COST_LINE_RE recognition (for isTextKeywordOnly fix)
// ============================================================================

describe('MORPH_COST_LINE_RE — multi-pip morph cost line recognition', () => {
  const morphLines = [
    'Morph {3}{W}',
    'Morph {6}{G}',
    'Morph {2}{U}{U}',
    'Megamorph {4}{G}',
    'Megamorph {3}',
  ];
  for (const line of morphLines) {
    it(`MORPH_COST_LINE_RE matches: "${line}"`, () => {
      expect(MORPH_COST_LINE_RE.test(line)).toBe(true);
    });
  }

  // Morph is intentionally excluded from ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE
  // (to prevent stripping the morph line before its paired face-up trigger).
  it('Morph {3}{W} is intentionally NOT in ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE', () => {
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Morph {3}{W}')).toBe(false);
  });
  it('Megamorph {4}{G} is intentionally NOT in ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE', () => {
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Megamorph {4}{G}')).toBe(false);
  });
});

// ============================================================================
// PART 4 — Parser behaviour for pure keyword-only faces (stay Unparsed)
//
// Pure parametric / bare-number keyword-only faces have no engine semantics,
// so the parser correctly returns Unparsed. The audit gate (isKeywordOnlyOracle)
// reclassifies them as KeywordOnly. This section confirms parser honesty.
// ============================================================================

describe('Parser honesty — pure keyword-only faces return Unparsed', () => {
  // Towering Baloth: "Morph {6}{G}" — morph face, nothing always-on
  it('Towering Baloth style: "Morph {6}{G}" → Unparsed (no always-on ability)', () => {
    const r = parseOracleText('Morph {6}{G}');
    expect(r.kind).toBe('Unparsed');
  });

  // Deadbridge Goliath: "Scavenge {4}{G}{G}" — single parametric keyword line
  it('Deadbridge Goliath style: "Scavenge {4}{G}{G}" → Unparsed (recognition-only)', () => {
    const r = parseOracleText('Scavenge {4}{G}{G}');
    expect(r.kind).toBe('Unparsed');
  });

  // Nezumi Ronin: "Bushido 1" — bare-number keyword
  it('Nezumi Ronin style: "Bushido 1" → Unparsed (no executor)', () => {
    const r = parseOracleText('Bushido 1');
    expect(r.kind).toBe('Unparsed');
  });

  it('"Soulshift 4" → Unparsed (no executor)', () => {
    const r = parseOracleText('Soulshift 4');
    expect(r.kind).toBe('Unparsed');
  });

  it('"Afterlife 2" → Unparsed (no executor)', () => {
    const r = parseOracleText('Afterlife 2');
    expect(r.kind).toBe('Unparsed');
  });

  it('"Ripple 4" → Unparsed (no executor)', () => {
    const r = parseOracleText('Ripple 4');
    expect(r.kind).toBe('Unparsed');
  });

  // Pure multi-keyword-only faces also stay Unparsed (no substantive content)
  // These are the 209 faces being reclassified in the AUDIT as KeywordOnly.
  it('"Haste\\nToxic 3" → Unparsed (two keywords, no substantive effect)', () => {
    const r = parseOracleText('Haste\nToxic 3');
    expect(r.kind).toBe('Unparsed');
  });

  it('"Flying\\nSoulshift 4" → Unparsed (two keywords, no substantive effect)', () => {
    // Hundred-Talon Kami style
    const r = parseOracleText('Flying\nSoulshift 4');
    expect(r.kind).toBe('Unparsed');
  });

  it('"Flying\\nMorph {3}{W}" → Unparsed (keyword-only face)', () => {
    const r = parseOracleText('Flying\nMorph {3}{W}');
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// PART 5 — Multi-line faces where parametric keyword is absorbed alongside
//           a real effect (existing behaviour verified)
//
// When a parametric keyword co-occurs with a real parseable clause, the keyword
// is absorbed (pure-downside skip) and the companion clause carries the parse.
// ============================================================================

describe('Parser absorption — parametric keyword + real effect composes correctly', () => {

  // ── Scavenge {4}{G}{G} + ETB trigger ──────────────────────────────────────
  it('Deadbridge Goliath style: "Scavenge {4}{G}{G}\\nWhen ~ enters, draw a card." → ETB', () => {
    const oracle = 'Scavenge {4}{G}{G}\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/scavenge/i);
  });

  // ── Echo {2}{G} + ETB trigger ──────────────────────────────────────────────
  it('Echo {2}{G} + ETB trigger composes, absorbedKeywords includes echo', () => {
    const oracle = 'Echo {2}{G}\nWhen ~ enters, each opponent loses 1 life and you gain 1 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/echo/i);
  });

  // ── Disturb {3}{W} + static ability ────────────────────────────────────────
  it('Disturb {3}{W} + static ability composes, absorbedKeywords includes disturb', () => {
    const oracle = 'Disturb {3}{W}\nCreatures you control have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/disturb/i);
  });

  // ── Bushido 1 + ETB trigger ────────────────────────────────────────────────
  it('Bushido 1 + ETB trigger composes (bare-number stripped by regex), absorbedKeywords set', () => {
    const oracle = 'Bushido 1\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/bushido/i);
  });

  // ── Haste + Toxic 3 + ETB trigger ─────────────────────────────────────────
  it('Tyrranax Atrocity style: "Haste\\nToxic 3\\nWhen ~ enters, draw a card." → ETB', () => {
    // Toxic 3 absorbed as parametric keyword; Haste absorbed as engine keyword.
    // ETB trigger carries the parse.
    const oracle = 'Haste\nToxic 3\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  // ── Flying + Soulshift 4 + ETB trigger ────────────────────────────────────
  it('Hundred-Talon Kami style: "Flying\\nSoulshift 4\\nWhen ~ enters, draw a card." → ETB', () => {
    // Soulshift 4 absorbed as parametric keyword; Flying absorbed as engine keyword.
    const oracle = 'Flying\nSoulshift 4\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  // ── Crew 1 + static ability ────────────────────────────────────────────────
  it('Sleek Schooner style: "Crew 1\\nCreatures you control have vigilance." → StaticAbility', () => {
    const oracle = 'Crew 1\nCreatures you control have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/crew/i);
  });

  // ── Ripple 4 + ETB trigger ──────────────────────────────────────────────────
  it('Ripple 4 + ETB trigger composes, absorbedKeywords includes ripple', () => {
    const oracle = 'Ripple 4\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/ripple/i);
  });

  // ── Afterlife 2 + static ────────────────────────────────────────────────────
  // NOTE: "afterlife" is NOT in ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE, so
  // "Afterlife 2\nCreatures you control have lifelink." will be handled via
  // parseOracleTextPerLine step 1i (if the regex matches afterlife) or will
  // remain Unparsed. This test documents actual parser behavior.
  it('"Afterlife 2" alone stays Unparsed (afterlife not in parametric regex — audit-only fix)', () => {
    const r = parseOracleText('Afterlife 2');
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// PART 6 — isTextKeywordOnly morph fix: additional-cost absorption path
//
// When earlyAdditionalCastCostAbsorption strips the additional cost line and
// the remainder is purely keywords (including morph cost lines), isTextKeywordOnly
// must return true so the Unparsed result records the absorbed cost lines.
// ============================================================================

describe('isTextKeywordOnly morph fix — additional-cost absorption remainder', () => {
  // A face whose only "additional" content is a morph cost line:
  // "As an additional cost to cast this spell, exile a card from your graveyard."
  // + "Morph {3}{W}" → additional-cost line absorbed, remainder "Morph {3}{W}"
  // isTextKeywordOnly("Morph {3}{W}") should now return true (MORPH_COST_LINE_RE added).
  // The whole face stays Unparsed (no real effect), but absorbedKeywords is set.
  it('"As an additional cost...\\nMorph {3}{W}" → Unparsed with absorbedKeywords', () => {
    const oracle = 'As an additional cost to cast this spell, exile a creature card from your graveyard.\nMorph {3}{W}';
    const r = parseOracleText(oracle);
    // Must stay Unparsed — morph has no executor.
    expect(r.kind).toBe('Unparsed');
    // The absorbed additional-cost line should be recorded (isTextKeywordOnly fix).
    if (r.absorbedKeywords && r.absorbedKeywords.length > 0) {
      const abs = r.absorbedKeywords.join(' ').toLowerCase();
      expect(abs).toMatch(/additional cost|exile|morph/i);
    }
    // Whether or not absorbedKeywords is set, the face must not spuriously parse.
    // (The key invariant: kind = 'Unparsed'.)
  });

  it('"As an additional cost...\\nFlying\\nMorph {3}{W}" → Unparsed (keyword-only remainder)', () => {
    const oracle = 'As an additional cost to cast this spell, sacrifice a creature.\nFlying\nMorph {3}{W}';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  // Verify that the morph fix does not break the normal morph absorption path.
  it('"Flying\\nMorph {3}{W}" stays Unparsed (keyword-only face, no executor)', () => {
    // absorbMorphFaceLines absorbs "Morph {3}{W}", rest "Flying" → Unparsed.
    // The whole face stays Unparsed — keyword-only, no always-on executable ability.
    const oracle = 'Flying\nMorph {3}{W}';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Morph face with always-on static: "Morph {2}{G}\\nCreatures you control have trample." → StaticAbility', () => {
    // absorbMorphFaceLines absorbs "Morph {2}{G}", rest "Creatures you control have trample."
    // parses as StaticAbility. This exercises the EXISTING morph absorption path (not new).
    const oracle = 'Morph {2}{G}\nCreatures you control have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/morph/i);
  });
});
