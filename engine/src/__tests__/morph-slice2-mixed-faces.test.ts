import { describe, it, expect } from 'vitest';
import { parseOracleText, MORPH_COST_LINE_RE, hasMorphLine } from '../effects/parser';
import { hasKeyword } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 2: Morph / Megamorph absorption for MIXED faces — round 2.
 *
 * This slice targets faces whose real always-on ability is sunk by an
 * unrecognised morph block: keyword-only remainders (First strike, Flying)
 * and faces where the face-up trigger is on the same line as the morph cost.
 *
 * The fix (parseOracleText): after the early morph absorption strips
 * morph+trigger lines and the recursive parse of the remainder returns
 * Unparsed, check isTextKeywordOnly(rest).  If the rest is keyword-only
 * (or empty), return Unparsed immediately with the absorbed morph/trigger
 * lines recorded in absorbedKeywords.  This prevents fall-through to
 * parseMultipleEffects, which would otherwise mis-claim any face-up trigger
 * body in the FULL oracle text as a Spell.
 *
 * Shapes fixed:
 *   - "First strike\nMorph {2}{W}{W}"  (Daru Lancer)
 *   - "Flying\nMorph {3}{W}\nWhen … turned face up, …"  (Aven Liberator)
 *   - "Flying\nMorph {3}{W} When … turned face up, …"  (same-line variant)
 *   - "Megamorph {6}{G}"  (Segmented Krotiq — single-line, already Unparsed)
 *   - morph + always-on activated ability  (Mistform Seaswift family)
 *
 * HONESTY: the engine has no face-down / turn-face-up mechanic.  Morph cost
 * lines are alternate-cast-mode declarations the engine cannot offer (pure
 * downside).  "When this creature is turned face up, …" triggers can never
 * fire.  Absorbing both lines fabricates no benefit.
 */

// ============================================================================
// Test helpers
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
  zone = 'battlefield' as const,
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
    cmc: opts.cmc || 0,
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
// REGEX COVERAGE: verify MORPH_COST_LINE_RE handles all cost shapes
// ============================================================================

describe('morph slice 2 — MORPH_COST_LINE_RE covers all cost shapes', () => {
  it('matches three-brace morph cost {2}{W}{W} (Daru Lancer shape)', () => {
    // morph{M}{M} signature: 18 cards use this shape
    expect(MORPH_COST_LINE_RE.test('Morph {2}{W}{W}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('Morph {1}{G}{G}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('Morph {1}{U}{U}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('Morph {2}{B}{B}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('Morph {2}{R}{R}')).toBe(true);
  });

  it('matches four-brace morph cost {M}{M}{M}{M} (morph{M}{M}{M} group)', () => {
    // morph{M}{M}{M} signature: 5 cards
    expect(MORPH_COST_LINE_RE.test('Morph {2}{W}{W}{W}')).toBe(true);
  });

  it('matches megamorph cost lines', () => {
    // megamorph: 8 cards
    expect(MORPH_COST_LINE_RE.test('Megamorph {6}{G}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('Megamorph {4}{R}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('Mega-morph {3}{W}')).toBe(true);
  });

  it('matches morph cost that has face-up trigger on the SAME line', () => {
    // Same-line variant: "Morph {3}{W} When this creature is turned face up, ..."
    // MORPH_COST_LINE_RE has no $ anchor, so it matches the prefix.
    expect(MORPH_COST_LINE_RE.test(
      'Morph {3}{W} When this creature is turned face up, target creature gets +1/+1 until end of turn.',
    )).toBe(true);
  });

  it('hasMorphLine is true for any face containing a morph cost line', () => {
    expect(hasMorphLine('First strike\nMorph {2}{W}{W}')).toBe(true);
    expect(hasMorphLine('Flying\nMorph {3}{W}\nWhen this creature is turned face up, draw a card.')).toBe(true);
    expect(hasMorphLine('Megamorph {6}{G}')).toBe(true);
    expect(hasMorphLine('Flying\n{1}: This creature becomes the creature type of your choice until end of turn.\nMorph {1}{U}')).toBe(true);
  });
});

// ============================================================================
// PARSE RECOGNITION: keyword-only morph faces absorb correctly
// ============================================================================

describe('morph slice 2 — keyword-only morph remainder (Daru Lancer family)', () => {
  /**
   * Daru Lancer: "First strike\nMorph {2}{W}{W}"
   * After absorbing the morph line, the remainder is "First strike"
   * (keyword-only).  Result must be Unparsed with morph in absorbedKeywords.
   * Previously: Unparsed but absorbedKeywords was undefined (morph lost).
   */
  it('Daru Lancer (First strike + Morph {2}{W}{W}): stays Unparsed; morph recorded in absorbedKeywords', () => {
    const r = parseOracleText('First strike\nMorph {2}{W}{W}');
    // Correct kind: keyword-only face is always Unparsed
    expect(r.kind).toBe('Unparsed');
    // Morph line must be in absorbedKeywords (was undefined before the fix)
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /morph/i.test(k))).toBe(true);
    // Must NOT have claimed First strike as an effect
    expect(r.absorbedKeywords!.some(k => /first\s+strike/i.test(k) || k === 'first strike')).toBeFalsy();
  });

  it('Morph {2}{W} only variant: single morph keyword face stays Unparsed', () => {
    // Variant of the two-symbol morph cost; single-line stays Unparsed
    const r = parseOracleText('Morph {2}{W}');
    expect(r.kind).toBe('Unparsed');
  });

  it('Deathtouch + Morph {1}{G}{G}: keyword-only remainder records absorbed morph', () => {
    const r = parseOracleText('Deathtouch\nMorph {1}{G}{G}');
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /morph/i.test(k))).toBe(true);
  });

  it('Trample, first strike + Morph {3}{R}{R}: keyword-only remainder records absorbed morph', () => {
    const r = parseOracleText('Trample\nFirst strike\nMorph {3}{R}{R}');
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /morph/i.test(k))).toBe(true);
  });

  it('Megamorph {6}{G} single line: stays Unparsed (single-line, no multi-line absorption)', () => {
    // Segmented Krotiq: pure megamorph-only single line — stays Unparsed as before
    const r = parseOracleText('Megamorph {6}{G}');
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// PARSE RECOGNITION: face-up trigger mixed with keyword remainder
// ============================================================================

describe('morph slice 2 — morph + face-up trigger + keyword remainder (Aven Liberator family)', () => {
  /**
   * Aven Liberator: "Flying\nMorph {3}{W}\nWhen this creature is turned face up,
   * target creature gets +1/+1 until end of turn."
   *
   * Before fix: returned Spell (the face-up trigger body mis-parsed by
   * parseMultipleEffects after the morph absorption fell through).
   * After fix: returns Unparsed with both the morph cost and face-up trigger
   * lines recorded in absorbedKeywords.
   */
  it('Aven Liberator (Flying + Morph + face-up +1/+1 trigger): must NOT be Spell; now Triggered (TurnedFaceUp)', () => {
    // Slice 1 (Morph SUBSYSTEM): the face-up trigger body "target creature gets +1/+1 until
    // end of turn" is parseable (matchModifyPT), so it is no longer absorbed but parsed as a
    // real TurnedFaceUp Triggered ability. The morph cost line is still absorbed (pure downside).
    const r = parseOracleText(
      'Flying\nMorph {3}{W}\nWhen this creature is turned face up, target creature gets +1/+1 until end of turn.',
    );
    // Critical: must NOT be Spell (was Spell before the original fix — dishonest mis-parse)
    expect(r.kind).not.toBe('Spell');
    // Now Triggered (TurnedFaceUp) — previously Unparsed (honest skip), now real
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
    // Morph cost line is still absorbed
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.some(k => /morph/i.test(k))).toBe(true);
    // Face-up trigger line is NOT absorbed (it was parsed as Triggered, not skipped)
    expect(r.absorbedKeywords!.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  it('Flying + Morph + face-up draw trigger: now Triggered (TurnedFaceUp), morph absorbed', () => {
    // Slice 1 (Morph SUBSYSTEM): face-up draw trigger body parses → Triggered, not Unparsed.
    const r = parseOracleText(
      'Flying\nMorph {1}{U}\nWhen this creature is turned face up, draw a card.',
    );
    expect(r.kind).not.toBe('Spell');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
    expect(r.absorbedKeywords!.some(k => /morph/i.test(k))).toBe(true);
    // Face-up trigger line is NOT absorbed (parsed as Triggered)
    expect(r.absorbedKeywords!.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  it('Vigilance + Megamorph + face-up anthem trigger: now Triggered (TurnedFaceUp), megamorph absorbed', () => {
    // Slice 1 (Morph SUBSYSTEM): face-up anthem body parses → Triggered, not Unparsed.
    const r = parseOracleText(
      'Vigilance\nMegamorph {3}{G}\nWhen this creature is turned face up, creatures you control get +2/+2 until end of turn.',
    );
    expect(r.kind).not.toBe('Spell');
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
    expect(r.absorbedKeywords!.some(k => /mega.?morph/i.test(k))).toBe(true);
    expect(r.absorbedKeywords!.some(k => /turned face up/i.test(k))).toBeFalsy();
  });
});

// ============================================================================
// PARSE RECOGNITION: face-up trigger on the SAME LINE as morph cost
// ============================================================================

describe('morph slice 2 — same-line morph cost + face-up trigger', () => {
  /**
   * Some morph cards have the cost and face-up trigger on a SINGLE LINE:
   * "Morph {3}{W} When this creature is turned face up, target creature gets +1/+1."
   * MORPH_COST_LINE_RE (no $ anchor) matches this line; it is absorbed as a morph
   * cost line in absorbMorphFaceLines, and the keyword-only remainder check
   * prevents fall-through to parseMultipleEffects.
   */
  it('same-line morph cost + face-up trigger (Flying remainder): Unparsed with absorbed line', () => {
    const oracle =
      'Flying\nMorph {3}{W} When this creature is turned face up, target creature gets +1/+1 until end of turn.';
    const r = parseOracleText(oracle);
    // Must NOT be Spell — was Spell before the fix
    expect(r.kind).not.toBe('Spell');
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    // The whole combined line is absorbed (matched by MORPH_COST_LINE_RE prefix)
    expect(r.absorbedKeywords!.some(k => /morph/i.test(k))).toBe(true);
  });

  it('same-line morph cost + face-up draw trigger (First strike remainder): Unparsed', () => {
    const oracle =
      'First strike\nMorph {1}{U} When this creature is turned face up, draw a card.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords!.some(k => /morph/i.test(k))).toBe(true);
  });
});

// ============================================================================
// PARSE RECOGNITION: morph + always-on activated ability (Mistform family)
// ============================================================================

describe('morph slice 2 — morph + always-on activated ability', () => {
  /**
   * Mistform Seaswift: "Flying\n{1}: This creature becomes the creature type of
   * your choice until end of turn.\nMorph {1}{U}"
   *
   * The activated ability is unrunnable (no executor), so it is absorbed by
   * step 1m in parseOracleTextPerLine.  The result stays Unparsed.
   */
  it('Mistform Seaswift (Flying + unrunnable activated + Morph): stays Unparsed', () => {
    const r = parseOracleText(
      'Flying\n{1}: This creature becomes the creature type of your choice until end of turn.\nMorph {1}{U}',
    );
    expect(r.kind).toBe('Unparsed');
  });

  it('morph + runnable activated ability: morph absorbed, activated ability parses', () => {
    // A morph creature with a runnable activated ability ({T}: draw a card) as its
    // always-on ability.  After morph absorption, the activated ability should parse.
    const r = parseOracleText(
      '{T}: Draw a card.\nMorph {2}{U}',
    );
    // After morph absorption, "{T}: Draw a card." is the remainder — should parse as Activated
    expect(r.kind).toBe('Activated');
    // Morph line should appear in absorbedKeywords
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
  });

  it('morph + trigger: morph absorbed, attack trigger parses as Triggered (regression)', () => {
    // Regression: verify existing behavior from slice 10 still holds
    const r = parseOracleText('Morph {2}{U}\nWhenever ~ attacks, draw a card.');
    expect(r.kind).toBe('Triggered');
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
  });
});

// ============================================================================
// HONESTY: face-up trigger is never mis-parsed as Spell
// ============================================================================

describe('morph slice 2 — honesty: face-up trigger must not become Spell', () => {
  it('morph-only face with face-up pump trigger must never be Spell', () => {
    // Willbender variant — morph + face-up retarget trigger, no other lines.
    const r = parseOracleText(
      'Morph {1}{U}\nWhen this creature is turned face up, change the target of target spell or ability.',
    );
    expect(r.kind).not.toBe('Spell');
    expect(r.kind).toBe('Unparsed');
  });

  it('Flying + morph + face-up anthem trigger must never be Spell (now Triggered)', () => {
    // Slice 1 (Morph SUBSYSTEM): the face-up anthem body is parseable → Triggered.
    // Critical invariant: must NOT be Spell (dishonest fabrication).
    const r = parseOracleText(
      'Flying\nMorph {1}{G}\nWhen this creature is turned face up, creatures you control get +2/+2 until end of turn.',
    );
    expect(r.kind).not.toBe('Spell');
    // Now Triggered (TurnedFaceUp) — previously Unparsed (honest skip)
    expect(r.kind).toBe('Triggered');
  });

  it('keyword-only morph face must never be Spell', () => {
    // Any keyword + morph combination must stay Unparsed, never Spell
    const cases = [
      'Flying\nMorph {1}{U}',
      'First strike\nMorph {2}{W}{W}',
      'Deathtouch\nMorph {1}{G}{G}',
      'Vigilance\nMegamorph {6}{G}',
    ];
    for (const oracle of cases) {
      const r = parseOracleText(oracle);
      expect(r.kind).not.toBe('Spell');
    }
  });
});

// ============================================================================
// EXECUTION: keyword cache and absorbed-morph faces run correctly
// ============================================================================

describe('morph slice 2 — engine execution', () => {
  it('First strike keyword still works via keyword cache on Daru Lancer shape', () => {
    // The oracle text is absorbed (morph stripped, First strike keyword-only),
    // but First strike is enforced via def.keywords → keyword cache.
    const cards = new Map<string, CardInstance>();
    cards.set('daru_1', makeCard('daru_1', 'daru_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('daru_def', makeDef('daru_def', {
      name: 'Daru Lancer',
      type_line: 'Creature — Human Soldier',
      oracle_text: 'First strike\nMorph {2}{W}{W}',
      keywords: ['First Strike'],
      colors: ['W'],
    }));
    const state = makeState({ cards, cardDefinitions: defs });

    // Keyword cache provides First Strike
    expect(hasKeyword(state, 'daru_1', 'first strike')).toBe(true);

    // The parse result is correctly Unparsed with morph absorbed
    const parsed = parseOracleText('First strike\nMorph {2}{W}{W}');
    expect(parsed.kind).toBe('Unparsed');
    expect(parsed.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
  });

  it('Flying keyword still works on Aven Liberator shape (morph absorbed, face-up trigger parsed)', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('aven_1', makeCard('aven_1', 'aven_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('aven_def', makeDef('aven_def', {
      name: 'Aven Liberator',
      type_line: 'Creature — Bird Soldier',
      oracle_text: 'Flying\nMorph {3}{W}\nWhen this creature is turned face up, target creature gets +1/+1 until end of turn.',
      keywords: ['Flying'],
      colors: ['W'],
    }));
    const state = makeState({ cards, cardDefinitions: defs });

    // Flying is enforced via keyword cache
    expect(hasKeyword(state, 'aven_1', 'flying')).toBe(true);

    // Slice 1 (Morph SUBSYSTEM): face-up trigger body is parseable (matchModifyPT),
    // so it registers as TurnedFaceUp Triggered. Morph cost line is still absorbed.
    const parsed = parseOracleText(
      'Flying\nMorph {3}{W}\nWhen this creature is turned face up, target creature gets +1/+1 until end of turn.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('TurnedFaceUp');
    expect(parsed.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    // Face-up trigger line is NOT absorbed (parsed as Triggered, not skipped)
    expect(parsed.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  it('runnable Triggered ability on morph face produces correct TriggeredAbility', () => {
    // A morph face with Flying + morph + an always-on attack trigger.
    // After absorbing morph, the attack trigger parses and executes normally.
    const parsed = parseOracleText(
      'Flying\nMorph {2}{U}\nWhenever ~ attacks, draw a card.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Attacks');
    expect(parsed.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(parsed.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
  });

  it('runnable ETB + TurnedFaceUp on morph face: morph absorbed, both triggers parse', () => {
    // Slice 1 (Morph SUBSYSTEM): the face-up trigger body "+2/-2 until end of turn" is
    // parseable (matchModifyPT), so the face-up line is no longer absorbed. The morph cost
    // line is absorbed. Per-line dispatch selects one result (ETB or Triggered); either valid.
    const parsed = parseOracleText(
      'Morph {1}{G}\nWhen this creature is turned face up, target creature gets +2/-2 until end of turn.\nWhen ~ enters, you gain 2 life.',
    );
    // Either ETB or Triggered is valid; per-line dispatch picks the highest-priority match
    expect(['ETB', 'Triggered'].includes(parsed.kind)).toBe(true);
    expect(parsed.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    // Face-up trigger line is NOT absorbed (parsed as Triggered)
    expect(parsed.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });
});
