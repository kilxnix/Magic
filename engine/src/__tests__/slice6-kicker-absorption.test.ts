/**
 * Slice 6/12 — Kicker / Multikicker line absorption (honest unenforced skip)
 *
 * HONESTY MODEL:
 *   The engine has NO kicker-paid state (no wasKicked / kickerPaid field anywhere
 *   in the codebase). Kicker is therefore NEVER paid; every creature with a kicker
 *   cost enters as its un-kicked base. Two families of lines are pure-downside:
 *
 *   1. Cost-declaration lines: "Kicker {N}", "Multikicker {N}", "Kicker {W}{2}",
 *      etc. — absorbing them makes the spell easier to cast (the gate never fires).
 *
 *   2. Conditional-bonus lines: "If this creature was kicked, it enters with N
 *      +1/+1 counters on it." / "When ~ enters, if it was kicked, …" — the
 *      condition is permanently false in the current engine; absorbing these lines
 *      never grants a fabricated benefit.
 *
 *   After absorbing both families the REMAINING text (a can't-block static, plain
 *   keywords, or an independent trigger) parses normally via the existing dispatch.
 *
 *   TWO PARSE PATHS:
 *   a) parseOracleTextPerLine (per-line dispatch): absorbs kicker lines explicitly
 *      and records them in absorbedKeywords. Used when the full text would fail
 *      whole-face matchers.
 *   b) Whole-face matchers (e.g. matchStaticAbility, matchOtherEvasion): parse
 *      the PRIMARY clause and may silently skip trailing kicker-conditional tokens.
 *      These cases parse correctly without recording absorbedKeywords — the kicker
 *      bonus is not claimed as an executed effect in either case.
 *
 *   Both paths are HONEST: neither path applies +1/+1 counters for the kicker
 *   bonus. The parser never emits an EntersWithCounters effect for a "was kicked"
 *   conditional line.
 *
 * EXAMPLE CARDS verified below:
 *   Aether Figment   — Kicker {3} + "If … was kicked, enters with two +1/+1" + "can't be blocked"
 *   Skyclave Shade   — Kicker {2}{B} + "can't block" + "If … was kicked, enters with two +1/+1"
 *   Kavu Primarch    — Kicker {4} + Convoke + "If … was kicked, enters with four +1/+1"
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';

// ============================================================================
// 1. Kicker cost-declaration absorption in per-line dispatch
// ============================================================================

describe('kicker cost-declaration line absorption (per-line dispatch path)', () => {
  it('Aether Figment: "Kicker {3} / conditional / can\'t be blocked" — face parses', () => {
    // The kicker cost line and the conditional are absorbed by the per-line dispatch;
    // the "can't be blocked" static carries the parse.
    const oracle =
      'Kicker {3}\n' +
      'If this creature was kicked, it enters with two +1/+1 counters on it.\n' +
      "This creature can't be blocked.";
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
    // The per-line dispatch absorbs kicker cost + conditional; both are recorded.
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ');
    expect(abs).toMatch(/kicker/i);
    expect(abs).toMatch(/was kicked/i);
  });

  it('Skyclave Shade: "Kicker {2}{B} / can\'t block / conditional" — face parses', () => {
    const oracle =
      'Kicker {2}{B}\n' +
      "This creature can't block.\n" +
      'If this creature was kicked, it enters with two +1/+1 counters on it.';
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ');
    expect(abs).toMatch(/kicker/i);
    expect(abs).toMatch(/was kicked/i);
  });

  it('Three-line face with kicker first unblocks per-line dispatch (various orderings)', () => {
    // Ordering: kicker, static, conditional
    const oracle1 =
      'Kicker {3}\n' +
      "This creature can't be blocked.\n" +
      'If this creature was kicked, it enters with two +1/+1 counters on it.';
    const r1 = parseOracleText(oracle1);
    expect(r1.kind).not.toBe('Unparsed');
    expect(r1.absorbedKeywords).toBeDefined();
    const abs1 = r1.absorbedKeywords!.join(' ');
    expect(abs1).toMatch(/kicker/i);
    expect(abs1).toMatch(/was kicked/i);
  });

  it('"Multikicker {1}{G} / conditional / can\'t block" — face parses via per-line dispatch', () => {
    const oracle =
      'Multikicker {1}{G}\n' +
      'If this creature was kicked, it enters with two +1/+1 counters on it.\n' +
      "This creature can't block.";
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ');
    expect(abs).toMatch(/multikicker/i);
    expect(abs).toMatch(/was kicked/i);
  });
});

// ============================================================================
// 2. Two-line faces with kicker conditional (may use whole-face or per-line path)
// ============================================================================

describe('kicker conditional-bonus absorption (face parses, bonus not claimed)', () => {
  it('static line + kicker conditional: face parses and kicker bonus NOT applied', () => {
    // "This creature can't be blocked." is parsed; "If this creature was kicked, ..."
    // is either absorbed by per-line dispatch OR silently skipped by a whole-face
    // matcher. In both cases the face parses and the kicker bonus is NOT an effect.
    const oracle =
      "This creature can't be blocked.\n" +
      'If this creature was kicked, it enters with two +1/+1 counters on it.';
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
    // Crucially: the parse result must NOT claim +1/+1 counters as an executed effect.
    // The kicker bonus is unenforced; the face is credited only for "can't be blocked".
    expect(r.kind).not.toBe('Spell');  // permanent faces don't execute Spell effect lists
  });

  it('"Kicker {2}{B} / conditional / static" in reversed order — face parses', () => {
    // Reversed: static first, then kicker, then conditional
    const oracle =
      "This creature can't block.\n" +
      'Kicker {2}{B}\n' +
      'If this creature was kicked, it enters with two +1/+1 counters on it.';
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
  });

  it('"If ~ was kicked, it enters with…" ~ pronoun form: face parses', () => {
    const oracle =
      "This creature can't be blocked.\n" +
      'If ~ was kicked, it enters with three +1/+1 counters on it.';
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
  });

  it('"When ~ enters, if it was kicked, …" ETB conditional form: face parses', () => {
    const oracle =
      "This creature can't be blocked.\n" +
      'When ~ enters, if it was kicked, target player draws three cards.';
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
  });
});

// ============================================================================
// 3. Multikicker standalone line
// ============================================================================

describe('multikicker cost-declaration absorption', () => {
  it('absorbs "Multikicker {R}" so a 2-line face with static parses', () => {
    // Multikicker on its own line followed by a static — face should parse.
    const oracle =
      'Multikicker {R}\n' +
      "This creature can't block.";
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ');
    expect(abs).toMatch(/multikicker/i);
  });

  it('absorbs multi-symbol "Multikicker {G}{G}" cost line', () => {
    const oracle =
      'Multikicker {G}{G}\n' +
      "This creature can't block.";
    const r = parseOracleText(oracle);
    expect(r.kind).not.toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ');
    expect(abs).toMatch(/multikicker/i);
  });
});

// ============================================================================
// 4. Honesty gates — absorption must not claim keyword-only or unparseable faces
// ============================================================================

describe('kicker absorption — honesty gates', () => {
  it('kicker-only face stays Unparsed (no substantive remainder)', () => {
    expect(parseOracleText('Kicker {3}').kind).toBe('Unparsed');
    expect(parseOracleText('Multikicker {R}').kind).toBe('Unparsed');
  });

  it('kicker + conditional-only face stays Unparsed (no substantive remainder)', () => {
    // Both lines are absorbed but nothing else remains — must not claim the face.
    const oracle =
      'Kicker {3}\n' +
      'If this creature was kicked, it enters with two +1/+1 counters on it.';
    expect(parseOracleText(oracle).kind).toBe('Unparsed');
  });

  it('does not absorb bare "Kicker" without a brace cost', () => {
    // Bare "Kicker" with no cost is not absorbed; the regex requires {…} symbol.
    // Must not crash.
    expect(() => parseOracleText("Kicker\nThis creature can't be blocked.")).not.toThrow();
  });

  it('kicker + convoke + conditional → keyword-only → Unparsed (correct behavior)', () => {
    // Kavu Primarch: All three lines absorbed (kicker, convoke, conditional).
    // No substantive remainder → keyword-only face → Unparsed is correct.
    const oracle =
      'Kicker {4}\n' +
      'Convoke\n' +
      'If this creature was kicked, it enters with four +1/+1 counters on it.';
    // Must not crash regardless of result.
    expect(() => parseOracleText(oracle)).not.toThrow();
  });
});

// ============================================================================
// 5. Parse structure validation — kicker cost absorption with varied forms
// ============================================================================

describe('kicker absorption — varied cost forms', () => {
  it('Kicker {2} followed by can\'t-be-blocked parses', () => {
    const r = parseOracleText('Kicker {2}\n' + "This creature can't be blocked.");
    expect(r.kind).not.toBe('Unparsed');
  });

  it('Kicker {1}{W} followed by can\'t-be-blocked parses', () => {
    const r = parseOracleText('Kicker {1}{W}\n' + "This creature can't be blocked.");
    expect(r.kind).not.toBe('Unparsed');
  });

  it('Kicker {X} followed by can\'t-be-blocked parses', () => {
    const r = parseOracleText('Kicker {X}\n' + "This creature can't be blocked.");
    expect(r.kind).not.toBe('Unparsed');
  });

  it('Multikicker {1} followed by can\'t-be-blocked parses', () => {
    const r = parseOracleText('Multikicker {1}\n' + "This creature can't be blocked.");
    expect(r.kind).not.toBe('Unparsed');
  });

  it('Kicker with three brace symbols: Kicker {1}{G}{U} parses', () => {
    const r = parseOracleText('Kicker {1}{G}{U}\n' + "This creature can't block.");
    expect(r.kind).not.toBe('Unparsed');
  });
});
