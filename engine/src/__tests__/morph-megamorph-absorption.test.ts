import { describe, it, expect } from 'vitest';
import { parseOracleText, TURNED_FACE_UP_TRIGGER_LINE_RE, MORPH_COST_LINE_RE, hasMorphLine } from '../effects/parser';
import { hasKeyword } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 10: Morph / Megamorph + "When this creature is turned face up" trigger
 * absorption.
 *
 * The engine has NO face-down / turn-face-up mechanic, so:
 *   (a) "Morph {cost}" / "Megamorph {cost}" lines are alternate-cast-mode
 *       declarations for a mode the engine cannot offer — pure-downside skip.
 *   (b) "When this creature is turned face up, <effect>." triggers can never
 *       fire — honest unenforced skip with no reachable effect dropped.
 *
 * On a multi-line morph face both lines are absorbed so the remaining
 * always-on abilities (Flying, statics, unconditional activated abilities,
 * ordinary triggers) can parse and execute normally.
 * Faces with NO substantive non-morph line stay Unparsed (keyword-only path).
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
// HELPER CHECKS: regex and hasMorphLine utility
// ============================================================================

describe('morph absorption helpers', () => {
  it('TURNED_FACE_UP_TRIGGER_LINE_RE matches standard face-up trigger lines', () => {
    expect(TURNED_FACE_UP_TRIGGER_LINE_RE.test(
      'When this creature is turned face up, draw a card.',
    )).toBe(true);
    expect(TURNED_FACE_UP_TRIGGER_LINE_RE.test(
      'When this creature is turned face up, creatures you control get +2/+2 until end of turn.',
    )).toBe(true);
    expect(TURNED_FACE_UP_TRIGGER_LINE_RE.test(
      'When this creature is turned face up, change the target of target spell or ability.',
    )).toBe(true);
    expect(TURNED_FACE_UP_TRIGGER_LINE_RE.test(
      'When this creature is turned face up, target creature gets +2/-2 or -2/+2 until end of turn.',
    )).toBe(true);
  });

  it('TURNED_FACE_UP_TRIGGER_LINE_RE does NOT match unrelated trigger lines', () => {
    expect(TURNED_FACE_UP_TRIGGER_LINE_RE.test('When ~ enters, draw a card.')).toBe(false);
    expect(TURNED_FACE_UP_TRIGGER_LINE_RE.test('Flying')).toBe(false);
    expect(TURNED_FACE_UP_TRIGGER_LINE_RE.test('Morph {1}{U}')).toBe(false);
  });

  it('MORPH_COST_LINE_RE matches morph and megamorph cost-declaration lines', () => {
    expect(MORPH_COST_LINE_RE.test('Morph {1}{U}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('Megamorph {2}{G}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('Morph {U}{U}')).toBe(true);
    expect(MORPH_COST_LINE_RE.test('When this creature is turned face up, draw a card.')).toBe(false);
    expect(MORPH_COST_LINE_RE.test('Flying')).toBe(false);
  });

  it('hasMorphLine detects morph and megamorph cost lines', () => {
    expect(hasMorphLine('Morph {1}{U}')).toBe(true);
    expect(hasMorphLine('Megamorph {2}{G}')).toBe(true);
    expect(hasMorphLine('Flying\nMorph {2}{U}{U}\nWhen ~ attacks, draw a card.')).toBe(true);
    expect(hasMorphLine('Flying\nWhen ~ attacks, draw a card.')).toBe(false);
    expect(hasMorphLine('When this creature is turned face up, draw a card.')).toBe(false);
  });
});

// ============================================================================
// PARSE RECOGNITION: morph/megamorph lines are absorbed, face-up triggers too
// ============================================================================

describe('morph / megamorph absorption — parser recognition', () => {
  // ── Case 1: morph-only face with face-up retarget trigger → Unparsed ──────
  it('Willbender (Morph + face-up retarget trigger): stays Unparsed; both lines absorbed', () => {
    // Real Willbender oracle text:
    // "Morph {1}{U}
    //  When this creature is turned face up, change the target of target spell or ability."
    const r = parseOracleText(
      'Morph {1}{U}\nWhen this creature is turned face up, change the target of target spell or ability.',
    );
    // No always-on ability remains → Unparsed is correct (keyword-only path)
    expect(r.kind).toBe('Unparsed');
    // Both lines recorded in absorbedKeywords (early morph absorption path)
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    expect(r.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBe(true);
  });

  // ── Case 2: morph + face-up anthem trigger → Triggered (Slice 1 Morph SUBSYSTEM) ─
  it('Tribal Forcemage (Morph + face-up anthem trigger): parses as Triggered TurnedFaceUp', () => {
    // Slice 1 (Morph SUBSYSTEM): the face-up trigger body "creatures you control get +2/+2
    // until end of turn" is parseable by the existing matchModifyPT/matchGrantKeyword dispatch.
    // The morph cost line is still absorbed (pure downside), but the face-up trigger now
    // registers as a real { kind: 'Triggered', trigger: { kind: 'TurnedFaceUp' } } result.
    const r = parseOracleText(
      'Morph {1}{G}\nWhen this creature is turned face up, creatures you control get +2/+2 until end of turn.',
    );
    // Face-up trigger body parses → result is now Triggered, not Unparsed
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
    // Morph cost line is still absorbed
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    // Face-up trigger line is NOT absorbed (it was parsed, not skipped)
    expect(r.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  // ── Case 3: morph + face-up pump trigger → Unparsed ───────────────────────
  it('Shaper Parasite (Morph + face-up pump trigger): stays Unparsed; both lines absorbed', () => {
    // Real Shaper Parasite oracle text:
    // "Morph {2}{U}
    //  When this creature is turned face up, target creature gets +2/-2 or -2/+2 until end of turn."
    const r = parseOracleText(
      'Morph {2}{U}\nWhen this creature is turned face up, target creature gets +2/-2 or -2/+2 until end of turn.',
    );
    // No always-on ability remains → Unparsed is correct
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    expect(r.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBe(true);
  });

  // ── Case 4: Flying + Morph + attack trigger → parses as Triggered ─────────
  it('Flying + Morph + attack trigger: morph absorbed, attack trigger parses as Triggered', () => {
    // Represents a morph card with Flying and an always-on attack trigger.
    // After absorbing the morph cost line, remaining text: "Flying\nWhenever ~ attacks, draw a card."
    // Flying is consumed by the preamble trimmer (not recorded in absorbedKeywords this path).
    const r = parseOracleText(
      'Flying\nMorph {1}{U}\nWhenever ~ attacks, draw a card.',
    );
    expect(r.kind).toBe('Triggered');
    // Morph line should be recorded in absorbedKeywords (from the early morph absorption)
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
  });

  // ── Case 5: Flying + Morph + face-up trigger + attack trigger → both triggers register ─
  it('Flying + Morph + face-up trigger + attack trigger: morph absorbed, both triggers parse', () => {
    // Slice 1 (Morph SUBSYSTEM): both the face-up trigger AND the always-on attack trigger
    // are parseable. Per-line dispatch picks the richest result (Triggered wins over Triggered
    // with the same rank — the per-line dispatch takes the first substantive non-Spell line,
    // which is whichever of the two triggers appears first in iteration order).
    // The morph cost line is still absorbed; the face-up trigger is now PARSED not absorbed.
    const r = parseOracleText(
      'Flying\nMorph {2}{U}\nWhen this creature is turned face up, draw a card.\nWhenever ~ attacks, you gain 2 life.',
    );
    expect(r.kind).toBe('Triggered');
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    // The face-up trigger line is now parsed (not absorbed), so it will NOT be in absorbedKeywords
    expect(r.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  // ── Case 6: Megamorph variant works the same way ──────────────────────────
  it('Megamorph cost line is also absorbed (megamorph is treated as pure-downside like morph)', () => {
    const r = parseOracleText(
      'Flying\nMegamorph {3}{G}\nWhenever ~ attacks, create a 1/1 green Saproling creature token.',
    );
    expect(r.kind).toBe('Triggered');
    expect(r.absorbedKeywords?.some(k => /mega.?morph/i.test(k))).toBe(true);
  });

  // ── Case 7: Morph + face-up trigger + ETB trigger → parses (TurnedFaceUp or ETB) ────
  it('Morph + face-up trigger + ETB trigger: both triggers parse; morph line absorbed', () => {
    // Slice 1 (Morph SUBSYSTEM): the face-up trigger body "target creature gets +2/-2 until
    // end of turn" is parseable (matchModifyPT), so it is no longer absorbed. Both the
    // TurnedFaceUp trigger and the ETB trigger are real parse results. Per-line dispatch
    // picks one (whichever first has a higher rank or appears first in the kept lines).
    // The morph cost line is still absorbed; the face-up trigger is now parsed not absorbed.
    const r = parseOracleText(
      'Morph {1}{G}\nWhen this creature is turned face up, target creature gets +2/-2 until end of turn.\nWhen ~ enters, you gain 2 life.',
    );
    // Either ETB or Triggered is acceptable (both are real parseable abilities)
    expect(['ETB', 'Triggered'].includes(r.kind)).toBe(true);
    expect(r.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
    // Face-up trigger line is NOT absorbed (it parsed as Triggered)
    expect(r.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  // ── Case 8: Morph-only single line stays Unparsed ─────────────────────────
  it('morph-only single-line text stays Unparsed (no multi-line context)', () => {
    // A bare "Morph {cost}" on its own is a keyword-only face and stays Unparsed.
    const r = parseOracleText('Morph {1}{U}');
    expect(r.kind).toBe('Unparsed');
  });
});

// ============================================================================
// HONESTY GATES: face-up trigger absorption is gated on morph presence
// ============================================================================

describe('morph absorption — honesty gates', () => {
  it('face-up trigger WITHOUT a morph line is NOT absorbed by the morph gate', () => {
    // Without a morph line, the face-up trigger morph gate (step 1k / absorbMorphFaceLines)
    // does not fire. The per-line dispatch therefore rejects the face-up trigger line and
    // the whole text stays Unparsed when no other parseable lines exist.
    // (A standalone face-up trigger has parseable body text but the multi-line dispatch
    // will reject it because it returns 'Spell' from the per-line parse.)
    const singleLineFaceUp = parseOracleText(
      'When this creature is turned face up, draw a card.\nFlying',
    );
    // Either Unparsed (per-line dispatch rejects it) or some other kind —
    // the key is that it did NOT go through the morph gate (which requires hasMorphLine).
    // We verify hasMorphLine is false for this text.
    expect(hasMorphLine('When this creature is turned face up, draw a card.\nFlying')).toBe(false);
    // The face-up trigger line should NOT be in absorbedKeywords (morph gate didn't fire)
    expect(singleLineFaceUp.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  it('morph absorption Unparsed result carries absorbedKeywords for audit visibility', () => {
    // Willbender: morph-only face returns Unparsed WITH absorbedKeywords so the
    // audit harness can classify it as morph-absorbed rather than a mystery Unparsed.
    const r = parseOracleText(
      'Morph {1}{U}\nWhen this creature is turned face up, change the target of target spell or ability.',
    );
    expect(r.kind).toBe('Unparsed');
    expect(r.absorbedKeywords).toBeDefined();
    expect(r.absorbedKeywords!.length).toBeGreaterThanOrEqual(2);
  });

  it('pure morph+face-up face does NOT mis-parse as Spell (honesty: no fabricated effect)', () => {
    // Slice 1 (Morph SUBSYSTEM): the face-up trigger body "creatures you control get +2/+2
    // until end of turn" now parses honestly as a TurnedFaceUp Triggered ability.
    // The critical invariant is that it does NOT mis-parse as a Spell (which would fabricate
    // the effect as though it were an unconditional immediate effect). Triggered is honest.
    const r = parseOracleText(
      'Morph {1}{G}\nWhen this creature is turned face up, creatures you control get +2/+2 until end of turn.',
    );
    // Must NOT be Spell — a Spell result would be a dishonest fabrication.
    expect(r.kind).not.toBe('Spell');
    // Now correctly parses as Triggered (TurnedFaceUp trigger)
    expect(r.kind).toBe('Triggered');
    if (r.kind !== 'Triggered') return;
    expect(r.ability.trigger.kind).toBe('TurnedFaceUp');
  });
});

// ============================================================================
// EXECUTION: the absorbed parse credits real abilities; Flying keyword functions
// via the keyword cache (def.keywords).
// ============================================================================

describe('morph absorption — engine execution', () => {
  it('Flying keyword still works via keyword cache on an absorbed-morph face', () => {
    // Oracle text: "Flying\nMorph {1}{U}\nWhenever ~ attacks, draw a card."
    // After absorbing morph line, parses as Triggered (attacks trigger). Flying is
    // enforced by the keyword cache from def.keywords — not from the parse result.
    const cards = new Map<string, CardInstance>();
    cards.set('morph_1', makeCard('morph_1', 'morph_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('morph_def', makeDef('morph_def', {
      name: 'Flying Morph Test',
      type_line: 'Creature — Beast Mutant',
      oracle_text: 'Flying\nMorph {1}{U}\nWhenever ~ attacks, draw a card.',
      keywords: ['Flying'],
      colors: ['U'],
    }));

    const state = makeState({ cards, cardDefinitions: defs });

    // Flying is in def.keywords → keyword cache returns it
    expect(hasKeyword(state, 'morph_1', 'flying')).toBe(true);
    // The absorbed parse must have credited the Triggered kind
    const parsed = parseOracleText('Flying\nMorph {1}{U}\nWhenever ~ attacks, draw a card.');
    expect(parsed.kind).toBe('Triggered');
    // Morph absorbed correctly
    expect(parsed.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
  });

  it('Megamorph face with ETB trigger: ETB trigger parses and absorbedKeywords records megamorph (face-up not absorbed)', () => {
    // Slice 1 (Morph SUBSYSTEM): both the face-up trigger (parseable body) and the ETB trigger
    // are real parse results. Per-line dispatch returns the richest result (ETB or Triggered).
    // The megamorph cost line is absorbed; the face-up trigger is now parsed (not absorbed).
    const oracle = 'Megamorph {4}{G}\nWhen this creature is turned face up, creatures you control get +1/+1 until end of turn.\nWhen ~ enters, draw a card.';
    const parsed = parseOracleText(oracle);
    // Both ETB and Triggered are valid (per-line dispatch picks the richest)
    expect(['ETB', 'Triggered'].includes(parsed.kind)).toBe(true);
    // Megamorph cost line is still absorbed
    expect(parsed.absorbedKeywords?.some(k => /mega.?morph/i.test(k))).toBe(true);
    // Face-up trigger line is NOT absorbed (it parsed as Triggered)
    expect(parsed.absorbedKeywords?.some(k => /turned face up/i.test(k))).toBeFalsy();
  });

  it('Morph + attack trigger: the attack trigger correctly produces a TriggeredAbility', () => {
    // Represents a morph card that always draws when attacking.
    const parsed = parseOracleText(
      'Morph {2}{U}\nWhenever ~ attacks, draw a card.',
    );
    expect(parsed.kind).toBe('Triggered');
    if (parsed.kind !== 'Triggered') return;
    expect(parsed.ability.trigger.kind).toBe('Attacks');
    expect(parsed.ability.effects.some(e => e.kind === 'Draw')).toBe(true);
    expect(parsed.absorbedKeywords?.some(k => /morph/i.test(k))).toBe(true);
  });
});
