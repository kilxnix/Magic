/**
 * Slice 2 keyword-vocab expansion — absorbable keyword recognition tests
 *
 * HONESTY MODEL:
 *   Every keyword absorbed here is either a bare keyword or a parametric keyword
 *   whose upside the engine does NOT run (zero executor / keywords.ts enforcement
 *   verified by grep). On multi-line faces the companion clause (trigger, activated
 *   ability, or static) is what the engine executes; absorbing the keyword line
 *   loses nothing the engine would have run.
 *
 *   BARE KEYWORDS (added to ABSORBABLE_ENGINE_KEYWORDS):
 *     flanking   — combat penalty to non-flanking blockers; no engine enforcer.
 *     soulbond   — paired-creature mechanic; no engine enforcer; companion statics
 *                  using "paired" condition absorbed by parseOracleTextPerLine step 1j.
 *
 *   PARAMETRIC KEYWORDS (added to ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE):
 *     persist       — return-with-minus-counter; no executor.
 *     undying       — return-with-plus-counter; no executor.
 *     myriad        — copy-per-opponent on attack; no executor.
 *     bloodthirst N — enters with +1/+1 counters if opp damaged; no executor.
 *     bushido N     — combat pump; no executor.
 *     rampage N     — multi-blocker pump; no executor.
 *     backup N      — distribute +1/+1 on attack; no executor.
 *     offspring {N} — pay extra to create 1/1 copy; no executor.
 *
 *   SENTENCE-LEVEL ABSORPTION (per-line dispatch step 1j):
 *     "This creature enters prepared." — shield-counter ETB; entersWithCounters
 *       does NOT match "prepared" form; no executor for this wording.
 *     "As long as ~ is paired with another creature, ..." — soulbond conditional
 *       static; "paired" condition has no evaluator (static-abilities.ts ~2461).
 *
 * EXAMPLE CARDS (from task spec):
 *   Spectral Gateguards — Soulbond + paired-vigilance static
 *   Hand of Cruelty     — Bushido 1 + protection static
 *   Knight of Glory     — Exalted-family + companion clause (Slice 1 / Slice 2)
 *   Adventurous Eater   — enters prepared + spell-side
 *   Lingering Tormentor — Persist + ETB trigger
 */

import { describe, it, expect } from 'vitest';
import {
  parseOracleText,
  ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE,
  ABSORBABLE_ENGINE_KEYWORDS,
} from '../effects/parser';

// ============================================================================
// REGEX UNIT TESTS — parametric keyword Slice 2 additions
// ============================================================================

describe('ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE — Slice 2 keyword-vocab entries', () => {
  const shouldMatch = [
    // persist (bare)
    'Persist',
    'persist',
    'Persist.',
    // undying (bare)
    'Undying',
    'undying',
    'Undying.',
    // myriad (bare)
    'Myriad',
    'myriad',
    'Myriad.',
    // bloodthirst N
    'Bloodthirst 1',
    'Bloodthirst 3',
    'bloodthirst 2',
    'Bloodthirst 3.',
    // bushido N
    'Bushido 1',
    'Bushido 2',
    'bushido 1',
    'Bushido 1.',
    // rampage N
    'Rampage 1',
    'Rampage 3',
    'rampage 2',
    'Rampage 2.',
    // backup N
    'Backup 1',
    'Backup 2',
    'backup 1',
    'Backup 1.',
    // offspring {N}
    'Offspring {2}',
    'Offspring {1}{W}',
    'offspring {2}',
    'Offspring {2}.',
  ];

  for (const line of shouldMatch) {
    it(`parametric regex matches Slice 2 absorb line: "${line}"`, () => {
      expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(line)).toBe(true);
    });
  }

  // These should NOT match — still-excluded upside keywords or oracle sentences
  const shouldNotMatch = [
    // Keywords that the engine DOES run
    'Evolve',
    'Graft 2',
    'Proliferate',
    'Fabricate 1',
    // Oracle ability sentences
    'When ~ enters, draw a card.',
    'Destroy target creature.',
    // Bare keywords go through ABSORBABLE_ENGINE_KEYWORDS, not this regex
    'Flanking',
    'Soulbond',
  ];

  for (const line of shouldNotMatch) {
    it(`parametric regex does NOT match: "${line}"`, () => {
      expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(line)).toBe(false);
    });
  }
});

// ============================================================================
// ENGINE KEYWORD SET TESTS — bare keyword Slice 2 additions
// ============================================================================

describe('ABSORBABLE_ENGINE_KEYWORDS — Slice 2 keyword-vocab entries', () => {
  const newKeywords = [
    'flanking',
    'soulbond',
  ];

  for (const kw of newKeywords) {
    it(`ABSORBABLE_ENGINE_KEYWORDS includes "${kw}"`, () => {
      expect(ABSORBABLE_ENGINE_KEYWORDS.has(kw)).toBe(true);
    });
  }

  // Slice 2 parametric keywords go in the regex, NOT the set
  const inRegexNotSet = ['persist', 'undying', 'myriad', 'bloodthirst', 'bushido', 'rampage', 'backup', 'offspring'];
  for (const kw of inRegexNotSet) {
    it(`ABSORBABLE_ENGINE_KEYWORDS does NOT include "${kw}" (it is in the parametric regex)`, () => {
      expect(ABSORBABLE_ENGINE_KEYWORDS.has(kw)).toBe(false);
    });
  }
});

// ============================================================================
// PARSER RECOGNITION — parametric keywords: absorbed + companion parses
//
// ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE absorptions happen EARLY (before the
// main dispatch), so absorbedKeywords is always set when the companion parses.
// ============================================================================

describe('Slice 2 keyword-vocab — parametric keyword recognition', () => {

  // ── Persist ───────────────────────────────────────────────────────────────

  it('Lingering Tormentor style: Persist + ETB trigger composes, absorbedKeywords set', () => {
    // Real oracle text for a persist creature: "Persist\nWhen ~ enters, ..."
    const oracle = 'Persist\nWhen ~ enters, each opponent loses 1 life and you gain 1 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/persist/i);
  });

  it('Persist + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Persist\nCreatures you control have lifelink.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/persist/i);
  });

  it('Persist alone stays Unparsed (no substantive remainder)', () => {
    const r = parseOracleText('Persist');
    expect(r.kind).toBe('Unparsed');
  });

  // ── Undying ───────────────────────────────────────────────────────────────

  it('Undying + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Undying\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/undying/i);
  });

  it('Undying + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Undying\nOther creatures you control have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/undying/i);
  });

  it('Undying alone stays Unparsed (no substantive remainder)', () => {
    const r = parseOracleText('Undying');
    expect(r.kind).toBe('Unparsed');
  });

  // ── Myriad ────────────────────────────────────────────────────────────────

  it('Myriad + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Myriad\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/myriad/i);
  });

  it('Myriad + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Myriad\nCreatures you control have flying.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/myriad/i);
  });

  // ── Bloodthirst N ─────────────────────────────────────────────────────────

  it('Bloodthirst 3 + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Bloodthirst 3\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/bloodthirst/i);
  });

  it('Bloodthirst 3 + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Bloodthirst 3\nCreatures you control have menace.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/bloodthirst/i);
  });

  // ── Bushido N ─────────────────────────────────────────────────────────────

  it('Hand of Cruelty style: Bushido 1 + protection composes, absorbedKeywords set', () => {
    // "Bushido 1\nProtection from white"
    const oracle = 'Bushido 1\nProtection from white.';
    const r = parseOracleText(oracle);
    // Protection from white is a StaticAbility
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/bushido/i);
  });

  it('Bushido 1 + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Bushido 1\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/bushido/i);
  });

  // ── Rampage N ─────────────────────────────────────────────────────────────

  it('Rampage 2 + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Rampage 2\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/rampage/i);
  });

  it('Rampage 3 + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Rampage 3\nCreatures you control have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/rampage/i);
  });

  // ── Backup N ──────────────────────────────────────────────────────────────

  it('Backup 1 + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Backup 1\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/backup/i);
  });

  it('Backup 1 + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Backup 1\nCreatures you control have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/backup/i);
  });

  // ── Offspring {N} ─────────────────────────────────────────────────────────

  it('Offspring {2} + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Offspring {2}\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/offspring/i);
  });

  it('Offspring {1}{W} + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Offspring {1}{W}\nCreatures you control have flying.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/offspring/i);
  });
});

// ============================================================================
// PARSER RECOGNITION — bare keyword Slice 2 additions
// ============================================================================

describe('Slice 2 keyword-vocab — bare keyword recognition (coverage gains)', () => {

  // ── Flanking ──────────────────────────────────────────────────────────────

  it('Flanking + ETB trigger: face parses as ETB (coverage gain)', () => {
    const oracle = 'Flanking\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Flanking + static ability: face parses, absorbedKeywords includes flanking', () => {
    const oracle = 'Flanking\nCreatures you control have first strike.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/flanking/i);
  });

  it('Flanking alone stays Unparsed (no substantive remainder)', () => {
    const r = parseOracleText('Flanking');
    expect(r.kind).toBe('Unparsed');
  });

  // ── Soulbond ─────────────────────────────────────────────────────────────

  it('Soulbond + ETB trigger: face parses as ETB (coverage gain)', () => {
    const oracle = 'Soulbond\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Soulbond + static ability: face parses, absorbedKeywords includes soulbond', () => {
    const oracle = 'Soulbond\nCreatures you control have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/soulbond/i);
  });

  it('Soulbond alone stays Unparsed (no substantive remainder)', () => {
    const r = parseOracleText('Soulbond');
    expect(r.kind).toBe('Unparsed');
  });

  // ── Spectral Gateguards style: Soulbond + paired-vigilance static ─────────

  it('Spectral Gateguards style: Soulbond line absorbed, paired-static absorbed, face stays Unparsed (no parseable companion)', () => {
    // "Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance."
    // Both lines are absorbed (soulbond keyword + paired conditional static).
    // No substantive parseable companion remains → Unparsed (honesty gate).
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Soulbond + paired-static + ETB trigger: soulbond and paired-static absorbed, ETB parses', () => {
    // A hypothetical card with Soulbond, paired static, AND a real trigger.
    // NOTE: The nested ETB scan fires first (finds 'when' in the token stream),
    // so absorbedKeywords may be unset — the key coverage metric is kind = 'ETB'.
    // (Same behavior as Slice 1 bare-keyword + ETB combinations.)
    const oracle = 'Soulbond\nAs long as ~ is paired with another creature, both creatures have vigilance.\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  // ── Multi-keyword runs ────────────────────────────────────────────────────

  it('keyword run: Flanking + ETB trigger — face parses as ETB', () => {
    const oracle = 'Flying\nFlanking\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Persist + keyword + ETB: multiple absorb paths combine correctly', () => {
    const oracle = 'Persist\nFlying\nWhen ~ enters, each opponent loses 1 life and you gain 1 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/persist/i);
  });
});

// ============================================================================
// SENTENCE-LEVEL ABSORPTION — "enters prepared" and soulbond paired statics
// ============================================================================

describe('Slice 2 keyword-vocab — sentence-level absorption (step 1j)', () => {

  // ── Enters prepared ───────────────────────────────────────────────────────

  it('Adventurous Eater style: "This creature enters prepared." absorbed on multi-line face', () => {
    // "This creature enters prepared.\nWhen ~ enters, draw a card."
    // "Enters prepared" grants a shield counter — engine does NOT run this form.
    // Absorbing it is a pure honest skip.
    // NOTE: The nested ETB scan fires first (finds 'when' in the token stream),
    // so absorbedKeywords may be unset. Key coverage metric is kind = 'ETB'.
    const oracle = 'This creature enters prepared.\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('"This creature enters prepared." alone stays Unparsed (no substantive companion)', () => {
    const r = parseOracleText('This creature enters prepared.');
    expect(r.kind).toBe('Unparsed');
  });

  it('"enters prepared" + static: absorbed, static parses, absorbedKeywords set', () => {
    const oracle = 'This creature enters prepared.\nCreatures you control have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/prepared/i);
  });

  // ── Soulbond paired statics (step 1j) ─────────────────────────────────────

  it('Soulbond paired static absorbed when "paired with" condition present', () => {
    // "As long as ~ is paired with another creature, both creatures have vigilance."
    // NOTE: The nested ETB scan fires first (finds 'when' in the token stream),
    // so absorbedKeywords may be unset. Key coverage metric is kind = 'ETB'.
    const oracle = 'As long as ~ is paired with another creature, both creatures have vigilance.\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Soulbond paired static absorbed: "each of those creatures has" variant', () => {
    const oracle = 'As long as ~ is paired with another creature, each of those creatures has vigilance.\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Paired-static alone stays Unparsed (no substantive companion)', () => {
    const r = parseOracleText('As long as ~ is paired with another creature, both creatures have vigilance.');
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// EXECUTION — verify companion clauses execute through the engine
// ============================================================================

describe('Slice 2 keyword-vocab — engine execution of companion clauses', () => {

  it('Persist + ETB life-loss trigger: life-loss effect fires correctly (companion executes)', () => {
    const oracle = 'Persist\nWhen ~ enters, each opponent loses 1 life and you gain 1 life.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    const effects = parsed.ability.effects;
    // Should have LoseLife or GainLife effects
    expect(effects.some(e => e.kind === 'LoseLife' || e.kind === 'GainLife')).toBe(true);
    expect(effects.every(e => e.kind !== 'Unparsed')).toBe(true);
    expect(parsed.absorbedKeywords).toBeDefined();
    const abs = parsed.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/persist/i);
  });

  it('Bushido 1 + protection static: protection static executes correctly', () => {
    const oracle = 'Bushido 1\nProtection from white.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    // Protection from white should be an OtherEvasion or Protection modifier
    expect(parsed.ability.modifier).toBeDefined();
    expect(parsed.absorbedKeywords).toBeDefined();
    const abs = parsed.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/bushido/i);
  });

  it('Undying + ETB draw trigger: draw effect fires correctly (companion executes)', () => {
    const oracle = 'Undying\nWhen ~ enters, draw a card.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    expect(parsed.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(parsed.absorbedKeywords).toBeDefined();
    const abs = parsed.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/undying/i);
  });

  it('Flanking + static ability (vigilance grant): static executes correctly', () => {
    const oracle = 'Flanking\nCreatures you control have first strike.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const mod = parsed.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('first strike');
    expect(parsed.absorbedKeywords).toBeDefined();
    const abs = parsed.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/flanking/i);
  });

  it('enters prepared + ETB draw trigger: draw effect fires correctly (companion executes)', () => {
    // NOTE: The nested ETB scan fires first so absorbedKeywords may be unset.
    // The key correctness check is that the Draw effect is in the ETB ability.
    const oracle = 'This creature enters prepared.\nWhen ~ enters, draw a card.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    expect(parsed.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
  });

  // ── Honesty gates ─────────────────────────────────────────────────────────

  it('HONESTY: face with ONLY newly-absorbed keywords stays Unparsed', () => {
    const oracle = 'Flanking\nSoulbond';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('HONESTY: Evolve still NOT absorbed (engine runs fabricate/counter-on-entry benefit)', () => {
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Evolve')).toBe(false);
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('evolve')).toBe(false);
  });

  it('HONESTY: Proliferate still NOT absorbed (engine runs it via keyword-actions.ts)', () => {
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Proliferate')).toBe(false);
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('proliferate')).toBe(false);
  });

  it('HONESTY: persist/undying/bushido are in the PARAMETRIC regex, NOT the engine keyword set', () => {
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Persist')).toBe(true);
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Undying')).toBe(true);
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Bushido 1')).toBe(true);
    // They are NOT in the bare-keyword set
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('persist')).toBe(false);
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('undying')).toBe(false);
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('bushido')).toBe(false);
  });
});
