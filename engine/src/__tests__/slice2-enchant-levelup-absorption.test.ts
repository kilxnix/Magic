import { describe, it, expect } from 'vitest';
import { parseOracleText, LEVEL_BAND_LINE_RE } from '../effects/parser';
import { registerContinuousEffect } from '../effects/continuous';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 2: Enchant non-creature preamble + level-up band absorption in
 * parseOracleTextPerLine (step 1b and step 1i-ii).
 *
 * PART A — Enchant preamble (step 1b extension):
 *   The step-1b regex now accepts an optional trailing period ("Enchant nonland
 *   permanent." etc.) in addition to the multi-word forms already covered.
 *   All "Enchant <qualifier>" forms are absorbed; the body carries the parse.
 *   Whole-face matchers (matchAttachedStaticBuff, trigger prefix matchers) are
 *   the PRIMARY parse path for most Auras; step 1b is the BACKUP for complex
 *   bodies / long preambles that exceed those matchers' scan windows.
 *
 * PART B — Level-up band lines (LEVEL_BAND_LINE_RE + step 1i-ii):
 *   "LEVEL N-N" band-range markers, "LEVEL N+" terminal markers, and bare "N/N"
 *   stat lines are absorbed by BOTH the early absorbParametricKeywordLines path
 *   AND the per-line step 1i-ii. After absorbing all band lines (plus the
 *   already-absorbed "Level up {N}" and keyword lines within bands), any
 *   remaining substantive line carries the parse.
 *   HONESTY: zero level-counter / level-band executor in the engine (grep
 *   confirmed). Pure honest skip — no engine benefit fabricated.
 */

// ============================================================================
// Helpers
// ============================================================================

function makePlayer(id: string, life = 40): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
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
  };
}

// ============================================================================
// PART A — Enchant preamble recognition
// ============================================================================

describe('Slice 2 — Enchant non-creature preamble absorption (step 1b)', () => {
  // ── Single-word non-creature forms ──────────────────────────────────────────
  // Most simple "Enchant X\nbody" forms parse via the whole-face path
  // (matchAttachedStaticBuff), not via step 1b. These tests verify the face
  // parses correctly regardless of which path is taken.

  it('absorbs "Enchant permanent" and parses body as StaticAbility', () => {
    const r = parseOracleText('Enchant permanent\nEnchanted permanent gets +2/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.attachedOnly).toBe(true);
  });

  it('"Enchant player" + trigger body: face parses (preamble stripped by whole-face path)', () => {
    // trimLeadingKeywordOrEnchantPreamble strips "Enchant player" when a trigger follows.
    const r = parseOracleText(
      "Enchant player\nAt the beginning of enchanted player's upkeep, that player draws a card.",
    );
    expect(r.kind).not.toBe('Unparsed');
  });

  it('"Enchant planeswalker" + trigger body: face parses', () => {
    const r = parseOracleText(
      'Enchant planeswalker\nWhenever enchanted planeswalker is dealt damage, draw a card.',
    );
    expect(r.kind).not.toBe('Unparsed');
  });

  it('absorbs "Enchant artifact" and parses buff body', () => {
    const r = parseOracleText('Enchant artifact\nEnchanted artifact gets +2/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.attachedOnly).toBe(true);
  });

  // ── Multi-word non-creature forms ────────────────────────────────────────────
  // These are absorbed by the current step-1b regex. For simple bodies the
  // whole-face path may handle them directly; the key is they don't fail.

  it('absorbs "Enchant creature or enchantment" and parses buff body', () => {
    const r = parseOracleText('Enchant creature or enchantment\nEnchanted creature gets +2/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.attachedOnly).toBe(true);
  });

  it('absorbs "Enchant creature or Vehicle" (capital V) and parses buff body', () => {
    const r = parseOracleText('Enchant creature or Vehicle\nEnchanted permanent gets +1/+1.');
    expect(r.kind).toBe('StaticAbility');
  });

  it('absorbs "Enchant artifact or creature" and parses buff body', () => {
    const r = parseOracleText('Enchant artifact or creature\nEnchanted permanent gets +2/+2.');
    expect(r.kind).toBe('StaticAbility');
  });

  it('absorbs "Enchant creature you control" and parses buff body', () => {
    const r = parseOracleText('Enchant creature you control\nEnchanted creature gets +2/+0.');
    expect(r.kind).toBe('StaticAbility');
  });

  // ── Trailing-period variant (Slice 2 fix) ────────────────────────────────────
  // "Enchant nonland permanent." has a trailing period that the old regex
  // (^enchant\s+[a-z][^.!]*$) rejected. The fixed regex allows it.

  it('absorbs "Enchant nonland permanent." (with trailing period) and parses body', () => {
    // Old regex: ^enchant\s+[a-z][^.!]*$ → [^.!] rejects "." → preamble NOT absorbed.
    // New regex: ^enchant\s+[a-z][^.!]*\.?\s*$ → allows optional trailing period.
    const r = parseOracleText('Enchant nonland permanent.\nEnchanted permanent gets +2/+2.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.attachedOnly).toBe(true);
  });

  it('absorbs "Enchant land you control." (with trailing period)', () => {
    const r = parseOracleText("Enchant land you control.\nEnchanted land has \"{T}: Add one mana of any color.\"");
    expect(r.kind).toBe('StaticAbility');
  });

  // ── Per-line path verified via long preambles ────────────────────────────────
  // matchAttachedStaticBuff scans only the first 8 tokens. Long preambles that
  // push "enchanted creature gets" past position 7 force the per-line path, where
  // step 1b absorption is the critical fix. absorbedKeywords is set only on this path.

  it('"Enchant creature with another Aura attached to it" (9-token): per-line path, absorbedKeywords set', () => {
    // Daybreak Coronet: confirmed in enchant-preamble-absorption.test.ts.
    const r = parseOracleText(
      'Enchant creature with another Aura attached to it\nEnchanted creature gets +3/+3 and has first strike, vigilance, and lifelink.',
    );
    expect(r.kind).toBe('StaticAbility');
    // absorbedKeywords is set because the per-line path was used.
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /^enchant\s+creature\s+with/i.test(k))).toBe(true);
  });

  it('"Enchant artifact with another Aura attached to it" (9+ tokens): per-line path absorbs', () => {
    // Same long-preamble pattern but for artifact — forces per-line path.
    const r = parseOracleText(
      'Enchant artifact with a +1/+1 counter on it\nEnchanted artifact gets +2/+2.',
    );
    expect(r.kind).not.toBe('Unparsed');
    // Per-line path sets absorbedKeywords.
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /^enchant\s+artifact\s+with/i.test(k))).toBe(true);
  });

  // ── Honesty gate ─────────────────────────────────────────────────────────────

  it('honesty gate: still Unparsed if body also cannot parse', () => {
    // "Enchanted player's opponents can't draw cards." has no engine modeler.
    const r = parseOracleText("Enchant player\nEnchanted player's opponents can't draw cards.");
    expect(r.kind).toBe('Unparsed');
  });

  it('honesty gate: "Enchanted permanent is a Sol Ring." (type-change, no base P/T) stays Unparsed', () => {
    // matchAttachedStaticBuff requires base P/T for "is" verb; this stays Unparsed.
    const r = parseOracleText('Enchant nonland permanent.\nEnchanted permanent is a Sol Ring.');
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// PART A — Enchant preamble execution
// ============================================================================

describe('Slice 2 — Enchant non-creature preamble execution', () => {
  it('"Enchant creature you control" + buff: parsed StaticAbility registered correctly', () => {
    const oracle = 'Enchant creature you control\nEnchanted creature gets +2/+0.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.attachedOnly).toBe(true);
    expect(parsed.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 2, toughness: 0 });

    const cards = new Map<string, CardInstance>();
    cards.set('aura_1', makeCard('aura_1', 'fist_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('fist_def', makeDef('fist_def', {
      name: 'Inferno Fist',
      type_line: 'Enchantment — Aura',
      card_types: ['enchantment'],
      oracle_text: oracle,
    }));
    const state = makeState({ cards, cardDefinitions: defs });
    // Registering an attachedOnly static must not throw.
    expect(() => registerContinuousEffect(state, 'aura_1', 'p1', parsed.ability)).not.toThrow();
  });

  it('"Enchant artifact" + buff: parsed StaticAbility registered correctly', () => {
    const oracle = 'Enchant artifact\nEnchanted artifact gets +2/+2.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    const cards = new Map<string, CardInstance>();
    cards.set('aura_2', makeCard('aura_2', 'ensoul_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('ensoul_def', makeDef('ensoul_def', {
      name: 'Ensoul Artifact',
      type_line: 'Enchantment — Aura',
      card_types: ['enchantment'],
      oracle_text: oracle,
    }));
    const state = makeState({ cards, cardDefinitions: defs });
    expect(() => registerContinuousEffect(state, 'aura_2', 'p1', parsed.ability)).not.toThrow();
  });
});

// ============================================================================
// PART B — Level-up band absorption recognition
// ============================================================================

describe('Slice 2 — Level-up band line absorption (LEVEL_BAND_LINE_RE)', () => {
  // ── Zulaport Enforcer: evasion body carries the parse ───────────────────────

  it('Zulaport Enforcer: LEVEL band lines + stat lines absorbed; evasion body parses', () => {
    // Real oracle text from Zulaport Enforcer (ROE):
    // "Level up {4}\nLEVEL 1-2\n3/3\nLEVEL 3+\n5/5\nThis creature can't be blocked except by black creatures."
    // LEVEL_BAND_LINE_RE absorbs "LEVEL 1-2", "3/3", "LEVEL 3+", "5/5".
    // ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE absorbs "Level up {4}".
    // Remaining: "This creature can't be blocked except by black creatures." → ConditionalEvasion.
    const r = parseOracleText(
      "Level up {4}\nLEVEL 1-2\n3/3\nLEVEL 3+\n5/5\nThis creature can't be blocked except by black creatures.",
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    // ConditionalEvasion is a selfOnly GrantKeyword static.
    expect(r.ability.selfOnly).toBe(true);
    expect(r.ability.modifier.kind).toBe('GrantKeyword');
    // absorbedKeywords includes Level up, LEVEL band lines, and stat lines.
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /^level\s+up/i.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /^level\s+\d+-\d+/i.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /^\d+\/\d+$/.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /^level\s+\d+\+/i.test(k))).toBe(true);
  });

  // ── Coralhelm Commander: anthem body carries the parse ─────────────────────

  it('Coralhelm Commander: band + keyword lines absorbed; anthem body parses', () => {
    // Real oracle text from Coralhelm Commander (ROE).
    // "Flying" lines (within bands) are absorbed by step 1 (keyword absorber).
    // "LEVEL 2-3", "3/3", "LEVEL 4+", "4/4" → absorbed by LEVEL_BAND_LINE_RE.
    // "Other Merfolk creatures you control get +1/+1." → StaticAbility anthem.
    const r = parseOracleText(
      'Level up {1}\nLEVEL 2-3\n3/3\nFlying\nLEVEL 4+\n4/4\nFlying\nOther Merfolk creatures you control get +1/+1.',
    );
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    // "Other" Merfolk — excludeSelf = true.
    expect(r.ability.excludeSelf).toBe(true);
    expect(r.absorbedKeywords).toBeDefined();
    // "flying" appears twice (once per band).
    expect(r.absorbedKeywords!.filter(k => k === 'flying').length).toBe(2);
    expect(r.absorbedKeywords!.some(k => /^level\s+\d+-\d+/i.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /^\d+\/\d+$/.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /^level\s+\d+\+/i.test(k))).toBe(true);
  });

  // ── Halimar Wavewatch: LEVEL N+ terminal marker and 0/N stat lines ──────────

  it('Halimar Wavewatch (body parses): LEVEL N-N, 0/6, LEVEL N+, 0/9 all absorbed', () => {
    // Real oracle text from Halimar Wavewatch (ROE) plus a parseable evasion.
    // "Level up {2}", "LEVEL 1-4", "0/6", "LEVEL 5+", "0/9" absorbed.
    // "Islandwalk" → keyword, also absorbed. Body evasion carries the parse.
    const r = parseOracleText(
      "Level up {2}\nLEVEL 1-4\n0/6\nLEVEL 5+\n0/9\nThis creature can't be blocked.",
    );
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /^level\s+\d+-\d+/i.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /^level\s+\d+\+/i.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /^0\/\d+$/.test(k))).toBe(true);
  });

  // ── Student of Warfare: all lines absorbed, correctly stays Unparsed ─────────

  it('Student of Warfare: all lines absorbed, stays Unparsed (keyword-only, correct)', () => {
    // Real oracle text from Student of Warfare (ROE).
    // After absorbing all band lines and keyword-only lines, nothing remains.
    // The face correctly stays Unparsed — no executable ability, honest skip.
    const r = parseOracleText(
      'Level up {W}\nLEVEL 2-6\n3/3\nFirst strike\nLEVEL 7+\n4/4\nDouble strike',
    );
    expect(r.kind).toBe('Unparsed');
  });

  // ── Multi-band form: two LEVEL band ranges ───────────────────────────────────

  it('Transcendent Master: two-range band form absorbed; body parses', () => {
    // Transcendent Master (ROE) has two full bands.
    // Test with a parseable body that survives the absorption.
    const r = parseOracleText(
      "Level up {1}\nLEVEL 6-11\n6/6\nLifelink\nLEVEL 12+\n9/9\nLifelink\nThis creature can't be blocked.",
    );
    // Band lines absorbed, body ("can't be blocked") carries the parse.
    // Note: "Lifelink" is absorbed by the engine-keyword absorber in a nested
    // recursive call; its entry may or may not appear in the top-level
    // absorbedKeywords depending on recursion depth — don't assert the count.
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /^level\s+\d+-\d+/i.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /^level\s+\d+\+/i.test(k))).toBe(true);
  });

  // ── LEVEL_BAND_LINE_RE constant: pattern verification ───────────────────────

  it('LEVEL_BAND_LINE_RE matches the expected level-band forms', () => {
    // Verify the exported constant (imported at top of file) matches the patterns.
    const matching = ['LEVEL 1-2', 'LEVEL 3+', '3/3', '0/6', 'LEVEL 12+', 'level 2-3', 'LEVEL 7+', '4/4'];
    const nonMatching = ['Level up {4}', 'Flying', 'LEVEL UP', '3/3 creature', 'LEVEL 1'];
    for (const s of matching) {
      expect(LEVEL_BAND_LINE_RE.test(s)).toBe(true);
    }
    for (const s of nonMatching) {
      expect(LEVEL_BAND_LINE_RE.test(s)).toBe(false);
    }
  });
});

// ============================================================================
// PART B — Level-up band absorption execution
// ============================================================================

describe('Slice 2 — Level-up band absorption execution', () => {
  it('Zulaport Enforcer: parsed ConditionalEvasion can be registered without error', () => {
    const oracle = "Level up {4}\nLEVEL 1-2\n3/3\nLEVEL 3+\n5/5\nThis creature can't be blocked except by black creatures.";
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    const cards = new Map<string, CardInstance>();
    cards.set('enf_1', makeCard('enf_1', 'enforcer_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('enforcer_def', makeDef('enforcer_def', {
      name: 'Zulaport Enforcer',
      type_line: 'Creature — Human Warrior',
      oracle_text: oracle,
      card_types: ['creature'],
      power: 1, toughness: 1,
    }));
    const state = makeState({ cards, cardDefinitions: defs });
    // selfOnly ConditionalEvasion can be registered; no executor path needed.
    expect(() => registerContinuousEffect(state, 'enf_1', 'p1', parsed.ability)).not.toThrow();
  });

  it('Coralhelm Commander: parsed anthem registers and holds correct modifier', () => {
    const oracle = 'Level up {1}\nLEVEL 2-3\n3/3\nFlying\nLEVEL 4+\n4/4\nFlying\nOther Merfolk creatures you control get +1/+1.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    const cards = new Map<string, CardInstance>();
    cards.set('coral_1', makeCard('coral_1', 'coral_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('coral_def', makeDef('coral_def', {
      name: 'Coralhelm Commander',
      type_line: 'Creature — Merfolk Soldier',
      oracle_text: oracle,
      card_types: ['creature'],
      power: 2, toughness: 2,
    }));
    const state = makeState({ cards, cardDefinitions: defs });
    const newState = registerContinuousEffect(state, 'coral_1', 'p1', parsed.ability);

    const ce = newState.continuousEffects.find(e => e.sourceInstanceId === 'coral_1');
    expect(ce).toBeDefined();
    if (!ce) return;
    expect(ce.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(ce.ability.excludeSelf).toBe(true);
  });
});
