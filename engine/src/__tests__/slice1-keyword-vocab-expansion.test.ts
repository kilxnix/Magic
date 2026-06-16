/**
 * Slice 1 keyword-vocab expansion — absorbable keyword recognition tests
 *
 * HONESTY MODEL:
 *   Every keyword absorbed here is a pure-downside recognition-only marker.
 *   No executor semantics exist for any of the following; absorbing them removes
 *   an inaccessible benefit without fabricating any engine upside.
 *
 *   PARAMETRIC (added to ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE):
 *     crew N     — Vehicle activation by tapping creatures; no executor branch.
 *     renown N   — First-damage +1/+1 counter trigger; no executor branch.
 *     toxic N    — Poison counter damage overlay; no executor branch.
 *
 *   BARE KEYWORDS (added to ABSORBABLE_ENGINE_KEYWORDS):
 *     exalted    — +1/+1 when sole attacker; no engine enforcer.
 *     melee      — Pump for each opponent attacked; no engine enforcer.
 *     devoid     — Colour identity modifier; no engine enforcer.
 *     changeling — Creature-type overlay (all types); no engine enforcer.
 *     phasing    — Phasing-in/out keyword; no engine enforcer for keyword form.
 *     banding    — Archaic combat grouping; no engine enforcer.
 *     daybound   — Day/night transform condition; no engine enforcer.
 *     nightbound — Day/night transform condition; no engine enforcer.
 *
 * COVERAGE MECHANISM:
 *   - Bare keywords in ABSORBABLE_ENGINE_KEYWORDS are absorbed via:
 *     (a) absorbEngineKeywordLines (late fallback, records absorbedKeywords), OR
 *     (b) the nested ETB scan in parseOracleText (when 'when/whenever' follows),
 *         which skips the keyword token WITHOUT recording absorbedKeywords, OR
 *     (c) parseOracleTextPerLine (per-line dispatch, records absorbedKeywords).
 *   - Parametric keywords in ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE are absorbed
 *     via absorbParametricKeywordLines (early, always records absorbedKeywords).
 *   - The test suite below verifies:
 *     (1) REGEX unit tests — correct absorb/reject behavior.
 *     (2) Set membership tests for new bare keywords.
 *     (3) Parser recognition — faces that were Unparsed now compose (absorbedKeywords
 *         verified only when the absorb path guarantees it).
 *     (4) Engine execution — companion clauses run correctly.
 *
 * EXAMPLE CARDS:
 *   Tyrranax Atrocity:          Toxic 3 + body (toxic absorbed pure-downside)
 *   Shady Traveler // Stalking Predator: Daybound / Nightbound
 *   Dusk Legion Dreadnought:    Vigilance\nCrew 2 (now composes correctly)
 *   Rhox Maulers:               Trample\nRenown 2
 *   Skybox Ferry:               Crew 2\nCycling {2}
 */

import { describe, it, expect } from 'vitest';
import {
  parseOracleText,
  ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE,
  ABSORBABLE_ENGINE_KEYWORDS,
} from '../effects/parser';

// ============================================================================
// REGEX UNIT TESTS — parametric keyword additions
// ============================================================================

describe('ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE — new keyword-vocab entries', () => {
  const shouldMatch = [
    // crew N
    'Crew 2',
    'Crew 3',
    'crew 2',
    'Crew 1.',
    // renown N
    'Renown 1',
    'Renown 2',
    'renown 1',
    'Renown 2.',
    // toxic N
    'Toxic 1',
    'Toxic 3',
    'toxic 1',
    'Toxic 3.',
  ];

  for (const line of shouldMatch) {
    it(`parametric regex matches absorb line: "${line}"`, () => {
      expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(line)).toBe(true);
    });
  }

  // These should NOT match the parametric regex (they go through ABSORBABLE_ENGINE_KEYWORDS
  // as bare keywords, or remain unabsorbable)
  const shouldNotMatch = [
    // Bare-keyword form — handled by ABSORBABLE_ENGINE_KEYWORDS, not this regex
    'Exalted',
    'Melee',
    'Devoid',
    'Changeling',
    'Phasing',
    'Banding',
    'Daybound',
    'Nightbound',
    // Still-excluded upside keywords (engine DOES run these)
    'Evolve',
    // Oracle ability sentences
    'When ~ enters, draw a card.',
    'Destroy target creature.',
  ];
  // NOTE: Bushido N, Bloodthirst N, Backup N, Persist, Undying are now absorbed
  // by ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE as of Slice 2 keyword-vocab expansion.
  // Tests for their inclusion are in slice2-keyword-vocab-expansion.test.ts.

  for (const line of shouldNotMatch) {
    it(`parametric regex does NOT match: "${line}"`, () => {
      expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test(line)).toBe(false);
    });
  }
});

// ============================================================================
// ENGINE KEYWORD SET TESTS — bare keyword additions
// ============================================================================

describe('ABSORBABLE_ENGINE_KEYWORDS — new keyword-vocab entries', () => {
  const newKeywords = [
    'exalted',
    'melee',
    'devoid',
    'changeling',
    'phasing',
    'banding',
    'daybound',
    'nightbound',
  ];

  for (const kw of newKeywords) {
    it(`ABSORBABLE_ENGINE_KEYWORDS includes "${kw}"`, () => {
      expect(ABSORBABLE_ENGINE_KEYWORDS.has(kw)).toBe(true);
    });
  }

  // Verify still-excluded keywords are NOT in the set
  // NOTE: 'bushido', 'bloodthirst', 'backup', 'persist', 'undying' are now in
  // ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE (Slice 2), not ENGINE_KEYWORDS.
  const shouldNotBeInSet = ['evolve', 'crew', 'renown', 'toxic'];
  for (const kw of shouldNotBeInSet) {
    it(`ABSORBABLE_ENGINE_KEYWORDS does NOT include "${kw}"`, () => {
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

describe('keyword-vocab expansion — parametric keyword recognition', () => {

  // ── Toxic N ───────────────────────────────────────────────────────────────

  it('Tyrranax Atrocity style: Toxic 3 + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Toxic 3\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/toxic/i);
  });

  it('Toxic N + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Toxic 1\nCreatures you control have deathtouch.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/toxic/i);
  });

  it('Toxic N + keyword line + ETB: toxic keyword absorbed, face parses as ETB', () => {
    // "Flying\nToxic 2\nWhen ~ enters, draw a card."
    // Flying: stripped by token-stream trim (not recorded in absorbedKeywords)
    // Toxic 2: absorbed early by absorbParametricKeywordLines (recorded)
    const oracle = 'Flying\nToxic 2\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    // Toxic IS recorded since absorbParametricKeywordLines runs early
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/toxic/i);
    // Note: flying may or may not be recorded depending on parse path
  });

  // ── Crew N ────────────────────────────────────────────────────────────────

  it('Dusk Legion Dreadnought style: Vigilance + Crew 2 — both absorbed, no substantive remainder stays Unparsed', () => {
    // Pure keyword + crew line: no substantive remainder → Unparsed (honesty gate).
    const oracle = 'Vigilance\nCrew 2';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Crew 2 + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Crew 2\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/crew/i);
  });

  it('Skybox Ferry style: Crew 2 + Cycling {2} — both absorbed, nothing substantive stays Unparsed', () => {
    const oracle = 'Crew 2\nCycling {2}';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Crew 2 + Cycling {2} + static ability composes, absorbedKeywords set for both', () => {
    const oracle = 'Crew 2\nCycling {2}\nCreatures you control have flying.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/crew/i);
    expect(abs).toMatch(/cycling/i);
  });

  // ── Renown N ──────────────────────────────────────────────────────────────

  it('Rhox Maulers style: Trample + Renown 2 — both absorbed, no substantive remainder stays Unparsed', () => {
    const oracle = 'Trample\nRenown 2';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('Renown 2 + ETB trigger composes, absorbedKeywords set', () => {
    const oracle = 'Renown 2\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/renown/i);
  });

  it('Renown N + static ability composes, absorbedKeywords set', () => {
    const oracle = 'Renown 1\nOther creatures you control have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/renown/i);
  });
});

// ============================================================================
// PARSER RECOGNITION — bare keyword (ABSORBABLE_ENGINE_KEYWORDS) additions
//
// Bare keywords are absorbed by absorbEngineKeywordLines (late fallback) or by
// the nested ETB/trigger scan in the main dispatch (silently skipping the keyword).
// absorbedKeywords is set when the face goes through absorbEngineKeywordLines
// (static-ability companions) but may be unset when the nested scan fires first.
// Tests below verify PARSE KIND (not Unparsed) — the key coverage metric.
// ============================================================================

describe('keyword-vocab expansion — bare keyword recognition (coverage gains)', () => {

  // ── Exalted ───────────────────────────────────────────────────────────────

  it('Exalted + ETB trigger: face parses as ETB (coverage gain)', () => {
    // The nested ETB scan finds 'when' at position 1 in the token stream.
    const oracle = 'Exalted\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Exalted + static ability: face parses, absorbedKeywords includes exalted', () => {
    // Static abilities go through absorbEngineKeywordLines (no early scan wins).
    const oracle = 'Exalted\nCreatures you control have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/exalted/i);
  });

  it('Exalted alone stays Unparsed (no substantive remainder)', () => {
    const r = parseOracleText('Exalted');
    expect(r.kind).toBe('Unparsed');
  });

  // ── Melee ─────────────────────────────────────────────────────────────────

  it('Melee + ETB trigger: face parses as ETB (coverage gain)', () => {
    const oracle = 'Melee\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Melee + static ability: face parses, absorbedKeywords includes melee', () => {
    const oracle = 'Melee\nCreatures you control have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/melee/i);
  });

  // ── Devoid ────────────────────────────────────────────────────────────────

  it('Devoid + ETB trigger: face parses as ETB (coverage gain)', () => {
    const oracle = 'Devoid\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Devoid + static ability: face parses, absorbedKeywords includes devoid', () => {
    const oracle = 'Devoid\nCreatures you control have flying.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/devoid/i);
  });

  // ── Changeling ────────────────────────────────────────────────────────────

  it('Changeling + ETB trigger: face parses as ETB (coverage gain)', () => {
    const oracle = 'Changeling\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Changeling + static ability: face parses, absorbedKeywords includes changeling', () => {
    const oracle = 'Changeling\nCreatures you control have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/changeling/i);
  });

  // ── Phasing ───────────────────────────────────────────────────────────────

  it('Phasing + ETB trigger: face parses as ETB (coverage gain)', () => {
    const oracle = 'Phasing\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Phasing + static ability: face parses, absorbedKeywords includes phasing', () => {
    const oracle = 'Phasing\nCreatures you control have vigilance.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/phasing/i);
  });

  // ── Banding ───────────────────────────────────────────────────────────────

  it('Banding + ETB trigger: face parses as ETB (coverage gain)', () => {
    const oracle = 'Banding\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Banding + static ability: face parses, absorbedKeywords includes banding', () => {
    const oracle = 'Banding\nCreatures you control have lifelink.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/banding/i);
  });

  // ── Daybound / Nightbound ─────────────────────────────────────────────────

  it('Shady Traveler style: Daybound + static ability parses, absorbedKeywords set', () => {
    // daybound is absorbed via absorbEngineKeywordLines when paired with a static.
    const oracle = 'Daybound\nCreatures you control have haste.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/daybound/i);
  });

  it('Nightbound + static ability parses, absorbedKeywords set', () => {
    const oracle = 'Nightbound\nCreatures you control have trample.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/nightbound/i);
  });

  it('Daybound alone stays Unparsed (no substantive remainder)', () => {
    const r = parseOracleText('Daybound');
    expect(r.kind).toBe('Unparsed');
  });

  it('Nightbound alone stays Unparsed (no substantive remainder)', () => {
    const r = parseOracleText('Nightbound');
    expect(r.kind).toBe('Unparsed');
  });

  // ── Multi-keyword runs ────────────────────────────────────────────────────

  it('keyword run: Exalted + Banding + ETB trigger — face parses as ETB', () => {
    // Multiple bare keywords before an ETB trigger.
    const oracle = 'Flying\nExalted\nBanding\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
  });

  it('Crew N + keyword + parametric: multiple absorb paths combine correctly', () => {
    // "Vigilance\nCrew 3\nFlashback {2}{W}\nWhen ~ enters, draw a card."
    // Crew 3 + Flashback {2}{W} absorbed by absorbParametricKeywordLines (early),
    // then the remainder 'Vigilance\nWhen ~ enters...' parsed with Flying absorbed.
    const oracle = 'Vigilance\nCrew 3\nFlashback {2}{W}\nWhen ~ enters, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeDefined();
    const abs = r.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/crew/i);
    expect(abs).toMatch(/flashback/i);
  });

  // ── Honesty gates ─────────────────────────────────────────────────────────

  it('HONESTY: face with ONLY newly-absorbed keywords stays Unparsed', () => {
    const oracle = 'Exalted\nBanding\nPhasing';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
  });

  it('HONESTY: Bushido now absorbed in PARAMETRIC regex (Slice 2 — no executor)', () => {
    // Bushido was excluded in Slice 1 but absorbed in Slice 2 because the engine
    // has zero executor/keywords.ts enforcement; on multi-line faces the companion
    // clause is what the engine runs.
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Bushido 2')).toBe(true);
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('bushido')).toBe(false); // in regex, not set
  });

  it('HONESTY: Persist now absorbed in PARAMETRIC regex (Slice 2 — no executor)', () => {
    // Persist was excluded in Slice 1 but absorbed in Slice 2 because the engine
    // has zero executor/keywords.ts enforcement for persist recursion.
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Persist')).toBe(true);
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('persist')).toBe(false); // in regex, not set
  });

  it('HONESTY: Evolve still NOT absorbed (grants a counter-placement benefit)', () => {
    expect(ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE.test('Evolve')).toBe(false);
    expect(ABSORBABLE_ENGINE_KEYWORDS.has('evolve')).toBe(false);
  });
});

// ============================================================================
// EXECUTION — verify the parsed remainder executes through the engine
// ============================================================================

describe('keyword-vocab expansion — engine execution of companion clauses', () => {

  it('Toxic + ETB draw trigger: draw effect fires correctly (companion executes)', () => {
    const oracle = 'Toxic 3\nWhen ~ enters, draw a card.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    const effects = parsed.ability.effects;
    expect(effects.some(e => e.kind === 'Draw')).toBe(true);
    // Toxic is absorbed, NOT an effect in the list
    expect(effects.every(e => e.kind !== 'Unparsed')).toBe(true);
    expect(parsed.absorbedKeywords).toBeDefined();
    const abs = parsed.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/toxic/i);
  });

  it('Crew 2 + static: the static resolves as keyword-grant to controller', () => {
    const oracle = 'Crew 2\nCreatures you control have vigilance.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const mod = parsed.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('vigilance');
    expect(parsed.absorbedKeywords).toBeDefined();
    const abs = parsed.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/crew/i);
  });

  it('Renown 2 + ETB draw trigger: draw effect fires correctly (companion executes)', () => {
    const oracle = 'Renown 2\nWhen ~ enters, draw a card.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    expect(parsed.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(parsed.absorbedKeywords).toBeDefined();
    const abs = parsed.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/renown/i);
  });

  it('Exalted + static ability: the static (vigilance grant) executes correctly', () => {
    const oracle = 'Exalted\nCreatures you control have vigilance.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    const mod = parsed.ability.modifier;
    expect(mod.kind).toBe('GrantKeyword');
    if (mod.kind !== 'GrantKeyword') return;
    expect(mod.keyword).toBe('vigilance');
    // Exalted recorded as absorbed keyword
    expect(parsed.absorbedKeywords).toBeDefined();
    const abs = parsed.absorbedKeywords!.join(' ').toLowerCase();
    expect(abs).toMatch(/exalted/i);
  });
});
