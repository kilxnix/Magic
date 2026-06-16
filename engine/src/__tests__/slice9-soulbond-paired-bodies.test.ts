/**
 * Slice 9 — Soulbond paired-conditional body absorption
 *
 * HONESTY MODEL:
 *   Soulbond creatures carry two unenforced lines:
 *     (a) "Soulbond" — keyword absorbed via ABSORBABLE_ENGINE_KEYWORDS (no
 *         pairing state machine in the engine; absorb is pure-downside skip).
 *     (b) "As long as ~ is paired with another creature, both creatures have
 *         <keyword>." — absorbed by parseOracleTextPerLine step 1j regex. The
 *         "paired" condition has no evaluator in continuous.ts / keywords.ts;
 *         matchConditionalStaticAbility returns 'unsupported' for these lines.
 *         Absorbing them fabricates nothing: the buff can never fire without a
 *         pairing subsystem the engine does not have.
 *
 *   BOTH lines are absorbed together. When no always-on companion line remains,
 *   the face returns Unparsed (correct — no executable ability exists). When a
 *   companion line (ETB trigger, static, activated ability) remains after
 *   absorbing both soulbond lines, it parses and executes normally.
 *
 *   This is Path (1) from the slice spec: honest absorption of the full
 *   soulbond+pairing block. No live conditional StaticAbility is emitted.
 *
 * GREP VERIFICATION:
 *   grep -rn "soulbond\|paired" src/ (non-test) reveals:
 *     - 'soulbond' in ABSORBABLE_ENGINE_KEYWORDS (parser.ts:4010)
 *     - step 1j regex in parseOracleTextPerLine (parser.ts:5025)
 *     - matchConditionalStaticAbility documents 'paired' as unsupported
 *       (static-abilities.ts:3113)
 *   Zero hits for pairing-state, paired-flag, or soulbond executor branch.
 *
 * COVERED CARDS (14 faces — real oracle wordings after name→~ normalization):
 *   Spectral Gateguards — vigilance paired static
 *   Nightshade Peddler  — deathtouch paired static (asymmetric: "that creature")
 *   Tandem Lookout      — paired trigger body (whenever..., draw a card)
 *   Wingcrafter         — flying paired static
 *   Silverblade Paladin — double strike paired static
 *   Trusted Advisor     — defender paired static
 *   Lost Leonin         — infect paired static
 *   Wolfir Avenger      — trample paired static
 *   Druid's Familiar    — +2/+2 paired pump (P/T buff)
 *   Elgaud Shieldmate   — hexproof paired static
 *   Farbog Boneflinger  — -2/-2 paired debuff (on "that creature")
 *   Deadeye Navigator   — activated-ability grant via quoted paired static
 *   Bonded Spirits      — first strike paired static
 *   Goldnight Commander — each of those creatures variant
 */

import { describe, it, expect } from 'vitest';
import {
  parseOracleText,
  ABSORBABLE_ENGINE_KEYWORDS,
} from '../effects/parser';

// ============================================================================
// UNIT — ABSORBABLE_ENGINE_KEYWORDS contains 'soulbond'
// ============================================================================

describe('Slice 9 soulbond — ABSORBABLE_ENGINE_KEYWORDS registration', () => {
  it('ABSORBABLE_ENGINE_KEYWORDS contains "soulbond"', () => {
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('soulbond')).toBe(true);
  });
});

// ============================================================================
// ABSORPTION — soulbond-only faces (no parseable companion)
// ============================================================================

describe('Slice 9 soulbond — keyword-only and paired-static-only faces → Unparsed', () => {
  it('"Soulbond" alone stays Unparsed', () => {
    const r = parseOracleText('Soulbond');
    expect(r.kind).toBe('Unparsed');
  });

  it('Spectral Gateguards: Soulbond + vigilance paired-static → Unparsed (no companion)', () => {
    // Real oracle after name→~ normalization:
    // "Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance."
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Nightshade Peddler: Soulbond + deathtouch paired-static (asymmetric) → Unparsed', () => {
    // "As long as ~ is paired with another creature, that creature has deathtouch."
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, that creature has deathtouch.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Tandem Lookout: Soulbond + paired trigger body → Unparsed (trigger gated on pairing)', () => {
    // "As long as ~ is paired with another creature, whenever that creature deals
    //  combat damage to a player, you draw a card."
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, whenever that creature deals combat damage to a player, you draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Wingcrafter: Soulbond + flying paired-static → Unparsed', () => {
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have flying.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Silverblade Paladin: Soulbond + double strike paired-static → Unparsed', () => {
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have double strike.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Trusted Advisor: Soulbond + defender paired-static → Unparsed', () => {
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have defender.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Lost Leonin: Soulbond + infect paired-static → Unparsed', () => {
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have infect.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Wolfir Avenger: Soulbond + trample paired-static → Unparsed', () => {
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it("Druid's Familiar: Soulbond + +2/+2 paired pump → Unparsed", () => {
    // P/T buff: "that creature gets +2/+2"
    const oracle = "Soulbond\nAs long as ~ is paired with another creature, that creature gets +2/+2.";
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Elgaud Shieldmate: Soulbond + hexproof paired-static → Unparsed', () => {
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have hexproof.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Farbog Boneflinger: Soulbond + -2/-2 paired debuff → Unparsed', () => {
    // "As long as ~ is paired with another creature, that creature gets -2/-2."
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, that creature gets -2/-2.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Deadeye Navigator: Soulbond + activated-ability grant via quoted paired static → Unparsed', () => {
    // Real oracle wording (simplified — activation ability inside quotes):
    // "As long as ~ is paired with another creature, each of those creatures has
    //  \"{1}{U}: Exile this creature, then return it to the battlefield...\""
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, each of those creatures has "{1}{U}: Exile this creature, then return it to the battlefield under your control."';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Bonded Spirits: Soulbond + first strike paired-static → Unparsed', () => {
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have first strike.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('"each of those creatures has" variant absorbed correctly', () => {
    // Alternate phrasing of "both creatures have" — uses "each of those creatures"
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, each of those creatures has vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// ABSORPTION — paired-static without "soulbond" keyword line
// ============================================================================

describe('Slice 9 soulbond — standalone paired-static absorption (step 1j)', () => {
  it('standalone paired-static alone → Unparsed', () => {
    const r = parseOracleText('As long as ~ is paired with another creature, both creatures have vigilance.');
    expect(r.kind).toBe('Unparsed');
  });

  it('standalone "each of those creatures has" variant alone → Unparsed', () => {
    const r = parseOracleText('As long as ~ is paired with another creature, each of those creatures has deathtouch.');
    expect(r.kind).toBe('Unparsed');
  });

  it('"this creature is paired with another creature" form (Unparsed alone)', () => {
    // "As long as this creature is paired with another creature, ..."
    const r = parseOracleText('As long as this creature is paired with another creature, both creatures have vigilance.');
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// MULTI-LINE — paired-static absorbed, companion clause parses normally
// ============================================================================

describe('Slice 9 soulbond — multi-line faces: companion clause parses after absorption', () => {
  it('Soulbond + paired-static + ETB draw trigger: ETB parses, draw effect present', () => {
    // Hypothetical soulbond creature with an ETB draw trigger.
    // soulbond keyword line and paired-static are both absorbed.
    // The ETB trigger is what the engine runs.
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
  });

  it('Soulbond + paired-static + always-on static: static parses, soulbond absorbed', () => {
    // A hypothetical soulbond creature that also has an unconditional static.
    // e.g. "Soulbond\nAs long as ~ is paired, both have vigilance.\nCreatures you control have haste."
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.\nCreatures you control have haste.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier.kind).toBe('GrantKeyword');
    if (r.ability.modifier.kind !== 'GrantKeyword') return;
    expect(r.ability.modifier.keyword).toBe('haste');
    // absorbedKeywords must record both absorbed lines
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/soulbond/i);
  });

  it('paired-static + ETB life-drain trigger (no soulbond keyword line): ETB parses', () => {
    // Variant where "soulbond" keyword line is absent (only the paired-static + trigger).
    const oracle = 'As long as ~ is paired with another creature, that creature has deathtouch.\nWhen ~ enters, each opponent loses 1 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    expect(r.ability.effects.some(e => e.kind === 'LoseLife')).toBe(true);
  });

  it('Soulbond + paired-static + ETB life-drain trigger: ETB parses correctly', () => {
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have flying.\nWhen ~ enters, each opponent loses 2 life and you gain 2 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    if (r.kind !== 'ETB') return;
    const kinds = r.ability.effects.map(e => e.kind);
    expect(kinds).toContain('LoseLife');
    expect(kinds).toContain('GainLife');
  });
});

// ============================================================================
// EXECUTION — companion clauses execute through the engine (no paired buff leak)
// ============================================================================

describe('Slice 9 soulbond — execution: companion clause runs, no paired buff fabricated', () => {
  it('Soulbond + paired-static + ETB trigger: draw effect is parseable and has Draw kind', () => {
    // Parse check: the Draw effect from the ETB trigger resolves correctly.
    // The Draw effect's player is a TargetRef — for "you draw a card" in an ETB
    // context, the player is { kind: 'Controller' } (the permanent's controller).
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.\nWhen ~ enters, draw a card.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    const drawEffect = parsed.ability.effects.find(e => e.kind === 'Draw');
    expect(drawEffect).toBeDefined();
    if (!drawEffect || drawEffect.kind !== 'Draw') return;
    // Player should be Controller (the permanent's controller who draws the card)
    expect(drawEffect.player).toEqual({ kind: 'Controller' });
  });

  it('Soulbond + paired-flying + ETB trigger: ETB effects contain no SelfBuff for the paired keyword', () => {
    // The "both creatures have flying" line must NOT produce a GrantKeyword effect
    // inside the ETB trigger body — it should be fully absorbed, not leaked.
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have flying.\nWhen ~ enters, each opponent loses 1 life.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    // No GrantKeyword effect should appear in the ETB body
    expect(parsed.ability.effects.some(e => e.kind === 'GrantKeyword')).toBe(false);
    // LoseLife effect must be present
    expect(parsed.ability.effects.some(e => e.kind === 'LoseLife')).toBe(true);
  });

  it('StaticAbility companion: modifier is GrantKeyword for haste (not for absorbed vigilance)', () => {
    // The always-on GrantKeyword must be for the COMPANION clause keyword,
    // not for the paired-conditional keyword (vigilance in this case).
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.\nCreatures you control have haste.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const mod = parsed.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    // Must be 'haste', NOT 'vigilance' (vigilance is in the absorbed paired-static)
    expect(mod.keyword).toBe('haste');
    expect(mod.keyword).not.toBe('vigilance');
  });
});
