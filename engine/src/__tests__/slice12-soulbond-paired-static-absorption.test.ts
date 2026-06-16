/**
 * Round 12 / Slice 12 — Soulbond / paired-static absorption
 *
 * HONESTY MODEL:
 *   Soulbond creatures carry two unenforced lines:
 *     (a) "Soulbond" — bare keyword in ABSORBABLE_ENGINE_KEYWORDS; absorbed
 *         by the keyword-line detector in absorbEngineKeywordLines /
 *         parseOracleTextPerLine step 1 (loop). The engine has ZERO soulbond
 *         pairing state-machine: no pairing flag, no PairedWith field in
 *         CardInstance, no evaluator in continuous.ts or keywords.ts.
 *     (b) "As long as ~ is paired with another creature, <effect>." — the
 *         "paired" condition has no evaluator (static-abilities.ts documents
 *         paired as unsupported; matchConditionalStaticAbility returns
 *         'unsupported'). Absorbed by absorbSoulbondPairedLines (the
 *         parseOracleText EARLY path for multi-line faces) AND by step 1j
 *         in parseOracleTextPerLine for per-line dispatch faces.
 *
 *   When BOTH lines are absorbed and no always-on companion line remains
 *   (pure soulbond-only faces), the face returns Unparsed — correct, because
 *   no executable ability exists (honesty gate).
 *
 *   When BOTH lines are absorbed and an always-on companion line remains
 *   (sibling static, trigger, or activated ability), that sibling parses and
 *   executes normally. This is the coverage win: minority of soulbond faces
 *   that carry a real independent ability alongside the pairing block.
 *
 * EXECUTOR ROUTE:
 *   Pure parser-side absorption — no new effect is emitted for the soulbond
 *   or paired-conditional lines. The absorbed lines are recorded in
 *   absorbedKeywords for audit visibility. The always-on sibling is executed
 *   by the existing executor (StaticAbility, ETB trigger, etc.) exactly as if
 *   the soulbond block were not present.
 *
 * GREP VERIFICATION:
 *   grep -rn "soulbond\|pairedWith\|pairing" src/ (non-test) confirms:
 *     - 'soulbond' in ABSORBABLE_ENGINE_KEYWORDS (parser.ts ~line 4025)
 *     - SOULBOND_PAIRED_STATIC_LINE_RE absorber (parser.ts ~line 4798)
 *     - absorbSoulbondPairedLines called in parseOracleText EARLY path
 *     - step 1j regex in parseOracleTextPerLine (~line 5367)
 *     - matchConditionalStaticAbility returns 'unsupported' for paired lines
 *   Zero hits for pairing-state, paired flag, PairedWith field, or soulbond
 *   executor branch.
 *
 * COVERED CASES (real oracle wordings after name→~ normalization):
 *   (1) Pure soulbond + paired-static: Spectral Gateguards, Wingcrafter,
 *       Silverblade Paladin — correctly remain Unparsed (no sibling)
 *   (2) Soulbond + paired-static + always-on sibling keyword: hypothetical
 *       "Flying" or "Vigilance" standalone line after the paired block
 *   (3) Soulbond + paired-static + ETB trigger sibling: absorption allows
 *       the ETB trigger body to parse and execute normally
 *   (4) Soulbond + paired-static + static ability sibling: absorption allows
 *       the always-on static to parse, mod is correct (not the paired kw)
 */

import { describe, it, expect } from 'vitest';
import {
  parseOracleText,
  ABSORBABLE_ENGINE_KEYWORDS,
} from '../effects/parser';

// ============================================================================
// Unit: ABSORBABLE_ENGINE_KEYWORDS contains 'soulbond'
// ============================================================================

describe('Slice 12/12 soulbond — ABSORBABLE_ENGINE_KEYWORDS registration', () => {
  it('ABSORBABLE_ENGINE_KEYWORDS contains "soulbond"', () => {
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('soulbond')).toBe(true);
  });
});

// ============================================================================
// Pure soulbond faces (no parseable companion) — must remain Unparsed
// ============================================================================

describe('Slice 12/12 soulbond — pure paired-static faces stay Unparsed (honesty gate)', () => {
  it('Spectral Gateguards: Soulbond + paired-vigilance → Unparsed (no companion)', () => {
    // Real oracle (name→~ normalized):
    // "Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance."
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Wingcrafter: Soulbond + paired-flying → Unparsed (no companion)', () => {
    // Real oracle:
    // "Soulbond\nAs long as ~ is paired with another creature, both creatures have flying."
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have flying.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Silverblade Paladin: Soulbond + paired-double-strike → Unparsed (no companion)', () => {
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have double strike.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Trusted Advisor: Soulbond + paired-defender → Unparsed (no companion)', () => {
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have defender.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('standalone paired-static (no Soulbond keyword line) → Unparsed', () => {
    const oracle =
      'As long as ~ is paired with another creature, both creatures have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('"this creature is paired" variant → Unparsed', () => {
    const oracle =
      'As long as this creature is paired with another creature, both creatures have flying.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('"each of those creatures has" variant → Unparsed', () => {
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, each of those creatures has first strike.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// Soulbond + paired-static + always-on sibling: sibling parses correctly
// ============================================================================

describe('Slice 12/12 soulbond — soulbond+paired-static absorbed, always-on sibling parses', () => {
  it('Soulbond + paired-flying + ETB draw trigger: ETB parses, soulbond block absorbed', () => {
    // A soulbond creature that also has an ETB draw trigger.
    // After absorbing "Soulbond" + paired-flying block, the ETB trigger parses.
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have flying.\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
  });

  it('Soulbond + paired-vigilance + global-haste static: StaticAbility parses, keyword is haste (not vigilance)', () => {
    // A soulbond creature that also has an unconditional "Creatures you control have haste."
    // After absorbing soulbond block (vigilance is paired-conditional, NOT standalone),
    // the always-on haste static parses. The modifier must be haste, not vigilance.
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.\nCreatures you control have haste.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    const mod = r.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    // Must be haste (the always-on sibling), NOT vigilance (the absorbed paired-static keyword)
    expect(mod.keyword).toBe('haste');
    expect(mod.keyword).not.toBe('vigilance');
  });

  it('Soulbond + paired-flying + ETB life-loss trigger: ETB parses, no flying GrantKeyword leaked', () => {
    // The paired-flying block must NOT produce a GrantKeyword effect in the ETB body.
    // Only the life-loss effect should appear.
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have flying.\nWhen ~ enters, each opponent loses 2 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    // No GrantKeyword in ETB body (the paired-flying line must be absorbed, not emitted)
    expect(r.ability.effects.some(e => e.kind === 'GrantKeyword')).toBe(false);
    expect(r.ability.effects.some(e => e.kind === 'LoseLife')).toBe(true);
  });

  it('paired-static + ETB trigger (no "Soulbond" keyword line): ETB still parses', () => {
    // Edge case: paired-static line present without the "Soulbond" bare keyword.
    // (Some rules-text reconstructions omit the keyword line.) The per-line
    // absorber (step 1j) should still strip the paired-static so the ETB parses.
    const oracle =
      'As long as ~ is paired with another creature, that creature has deathtouch.\nWhen ~ enters, each opponent loses 1 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'LoseLife')).toBe(true);
  });

  it('absorbedKeywords records the soulbond block on a StaticAbility result', () => {
    // When absorption succeeds and a StaticAbility sibling parses, the
    // absorbedKeywords array must record the absorbed "Soulbond" keyword
    // so the audit layer can see what was skipped.
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.\nCreatures you control have haste.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/soulbond/i);
  });

  it('Soulbond + paired-static + ETB GainLife+LoseLife dual trigger: both effects present', () => {
    // Verifies that complex ETB bodies parse fully even after soulbond absorption.
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have trample.\nWhen ~ enters, each opponent loses 2 life and you gain 2 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    const kinds = r.ability.effects.map(e => e.kind);
    expect(kinds).toContain('LoseLife');
    expect(kinds).toContain('GainLife');
  });
});

// ============================================================================
// Execution: absorbed lines produce no fabricated effect
// ============================================================================

describe('Slice 12/12 soulbond — execution integrity: no fabricated paired buff', () => {
  it('ETB Draw effect player is Controller (not leaked from soulbond absorption)', () => {
    // Parse check: the Draw effect from an ETB trigger resolves to the correct
    // player reference (Controller of the permanent, not a fabricated reference
    // from the absorbed soulbond or paired-static lines).
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.\nWhen ~ enters, draw a card.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    const drawEffect = parsed.ability.effects.find(e => e.kind === 'Draw');
    expect(drawEffect).toBeDefined();
    if (!drawEffect || drawEffect.kind !== 'Draw') return;
    expect(drawEffect.player).toEqual({ kind: 'Controller' });
  });

  it('StaticAbility modifier is the sibling keyword, not the paired-conditional keyword', () => {
    // After absorption, the StaticAbility's modifier must reflect the COMPANION
    // (always-on) clause, not the absorbed paired-conditional clause.
    // Companion: "Creatures you control have first strike." (always-on)
    // Absorbed:  "As long as ~ is paired with another creature, both creatures have flying."
    const oracle =
      'Soulbond\nAs long as ~ is paired with another creature, both creatures have flying.\nCreatures you control have first strike.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const mod = parsed.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('first strike');
    expect(mod.keyword).not.toBe('flying');
  });

  it('"Soulbond" alone is Unparsed — no effect emitted', () => {
    // Bare "Soulbond" with no companion: must not produce any parseable effect
    // (the engine has zero soulbond executor support).
    const r = parseOracleText('Soulbond');
    expect(r.kind).toBe('Unparsed');
  });
});
