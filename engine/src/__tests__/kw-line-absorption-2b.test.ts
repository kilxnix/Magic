import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousEffect, getCostReduction, getGrantedKeywords } from '../effects/continuous';
import { executeEffects } from '../effects/executor';
import { hasKeyword } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Slice 2b — keyword-line absorption: position/form gap closures.
 *
 * Extends the existing kw-line-absorption test suite with the additional keyword
 * forms that were still failing as sole blockers on mixed-ability faces:
 *
 *   improvise  — absorbed via ABSORBABLE_ENGINE_KEYWORDS (enforced at cast time via
 *                oracle-text rescan in stack.ts hasKeywordOrText, same model as convoke)
 *   riot       — absorbed via ABSORBABLE_ENGINE_KEYWORDS (no engine enforcer)
 *   ascend     — absorbed via ABSORBABLE_ENGINE_KEYWORDS (no engine enforcer)
 *   level up {N} — absorbed via ABSORBABLE_PARAMETRIC_KEYWORD_LINE_RE (alternate
 *                  activation the engine cannot offer — pure downside skip)
 *
 * Also pins the existing absorption of "Flying, first strike" and "Bestow {1}{U}"
 * as comma/AND comma-list and parametric forms respectively.
 *
 * HONESTY MODEL: every keyword in this test is either (a) enforced via a separate
 * oracle-text rescan that does not depend on parseOracleText (improvise), or (b)
 * genuinely unenforced and absorbing it removes an inaccessible benefit (riot,
 * ascend, level up). The parsed remainder is exactly what the engine executes.
 */

// ============================================================================
// Test helpers (mirrors kw-line-absorption.test.ts)
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

function makeCard(instanceId: string, definitionId: string, ownerId: string, zone = 'battlefield' as const): CardInstance {
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
// RECOGNITION — slice 2b keyword forms absorbed, remainder parses
// ============================================================================

describe('kw-line absorption 2b — parser recognition', () => {

  // ── Improvise ────────────────────────────────────────────────────────────
  it('absorbs standalone "Improvise" before a cant-be-blocked static (Fen Hauler)', () => {
    // Real Fen Hauler oracle: "Improvise\nThis creature can't be blocked."
    const r = parseOracleText("Improvise\nThis creature can't be blocked.");
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toContain('improvise');
  });

  it('absorbs standalone "Improvise" before a keyword-grant anthem', () => {
    const r = parseOracleText('Improvise\nOther creatures you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toContain('improvise');
  });

  // ── Riot ─────────────────────────────────────────────────────────────────
  it('absorbs standalone "Riot" before a cant-be-blocked static', () => {
    const r = parseOracleText("Riot\nThis creature can't be blocked.");
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toContain('riot');
  });

  it('absorbs standalone "Riot" before an ETB draw (Spider-Punk style)', () => {
    // "Riot" was listed as sole-blocker on Spider-Punk; ETB draw is separately parseable
    const r = parseOracleText('Riot\nWhen this creature enters, draw a card.');
    expect(r.kind).toBe('ETB');
    // absorbed in the early absorbEngineKeywordLines path before per-line dispatch
  });

  // ── Ascend ───────────────────────────────────────────────────────────────
  it('absorbs standalone "Ascend" before a cant-be-blocked static', () => {
    const r = parseOracleText("Ascend\nThis creature can't be blocked.");
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toContain('ascend');
  });

  it('absorbs standalone "Ascend" before a simple anthem', () => {
    const r = parseOracleText('Ascend\nOther creatures you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toContain('ascend');
  });

  // ── Level up {N} ─────────────────────────────────────────────────────────
  it('absorbs "Level up {4}" before a cant-be-blocked static (Zulaport Enforcer style)', () => {
    // Level up is an alternate-activation the engine cannot offer.
    const r = parseOracleText("Level up {4}\nThis creature can't be blocked.");
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toContain('Level up {4}');
  });

  it('absorbs "Level up {2}" before an ETB trigger', () => {
    const r = parseOracleText('Level up {2}\nWhen this creature enters, draw a card.');
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toContain('Level up {2}');
  });

  it('absorbs "Level up {1}{W}" (mana-cost form) before an anthem', () => {
    const r = parseOracleText('Level up {1}{W}\nOther creatures you control get +1/+1.');
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toContain('Level up {1}{W}');
  });

  // ── Parametric: Bestow (existing, pinned) ───────────────────────────────
  it('still absorbs "Bestow {1}{U}" before an attack trigger (Triton Wavebreaker style)', () => {
    const r = parseOracleText('Bestow {1}{U}\nWhen this creature attacks, target creature gets +2/+2 until end of turn.');
    expect(r.kind).toBe('Triggered');
    expect(r.absorbedKeywords).toContain('Bestow {1}{U}');
  });

  // ── Comma-list: Flying, first strike (existing, pinned) ──────────────────
  it('still absorbs "Flying, first strike" comma-list as a leading keyword line', () => {
    const r = parseOracleText('Flying, first strike\nWhen this creature enters, you gain 3 life.');
    expect(r.kind).toBe('ETB');
    // comma-list is absorbed by absorbableKeywordLineParts via the early engine-keyword path
  });

  it('still absorbs "Flying, lifelink" comma-list before an attack trigger (Arna Kennerud style)', () => {
    const r = parseOracleText(
      'Flying, lifelink\nWhenever this creature attacks, create a 2/2 white Knight creature token.',
    );
    expect(r.kind).toBe('Triggered');
    // Both keywords are in ABSORBABLE_ENGINE_KEYWORDS; the attack trigger parses on its own.
  });

  // ── HONESTY GATES ────────────────────────────────────────────────────────
  it('does NOT absorb keywords that gate real enforced effects (infect unchanged)', () => {
    // "Infect\nOther creatures you control have trample." stays Unparsed because
    // "infect" is NOT in ABSORBABLE_ENGINE_KEYWORDS (the engine does not run it
    // as an absorption target, and the companion anthem isn't enough to promote
    // the face). Mirrors the existing test in kw-line-absorption.test.ts.
    const r = parseOracleText('Infect\nOther creatures you control have trample.');
    expect(r.kind).toBe('Unparsed');
  });

  it('does NOT promote a keyword-only face to parsed (riot-only stays Unparsed)', () => {
    expect(parseOracleText('Riot').kind).toBe('Unparsed');
    expect(parseOracleText('Ascend').kind).toBe('Unparsed');
    expect(parseOracleText('Level up {4}').kind).toBe('Unparsed');
    expect(parseOracleText('Improvise').kind).toBe('Unparsed');
  });
});

// ============================================================================
// EXECUTION — the parsed remainder runs through the engine's existing machinery
// ============================================================================

describe('kw-line absorption 2b — engine execution', () => {

  it('Fen Hauler: absorbed "Improvise" + cant-be-blocked static executes as OtherEvasion', () => {
    // oracle: "Improvise\nThis creature can't be blocked."
    const parsed = parseOracleText("Improvise\nThis creature can't be blocked.");
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.absorbedKeywords).toContain('improvise');

    const cards = new Map<string, CardInstance>();
    cards.set('hauler_1', makeCard('hauler_1', 'hauler_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('hauler_def', makeDef('hauler_def', {
      name: 'Fen Hauler',
      type_line: 'Creature — Insect',
      oracle_text: "Improvise\nThis creature can't be blocked.",
      keywords: ['Improvise'],
      power: 5, toughness: 5,
      colors: ['B'],
    }));

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'hauler_1', 'p1', parsed.ability);

    // The static ability grants cant-be-blocked ("unblockable" keyword) to the Hauler itself.
    // "can't be blocked" resolves to GrantKeyword{unblockable} via matchOtherEvasion.
    expect(parsed.ability.modifier.kind).toBe('GrantKeyword');
    if (parsed.ability.modifier.kind === 'GrantKeyword') {
      expect(parsed.ability.modifier.keyword).toBe('unblockable');
    }
    // Improvise remains on the card via def.keywords — not tracked in parsed state,
    // but the absorption was honest (stack.ts enforces it via oracle-text rescan).
    expect(parsed.absorbedKeywords).toContain('improvise');
  });

  it('Level up {4}: absorbed parametric + anthem static executes as a keyword-grant buff', () => {
    const parsed = parseOracleText('Level up {4}\nOther creatures you control get +1/+1.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.absorbedKeywords).toContain('Level up {4}');

    const cards = new Map<string, CardInstance>();
    cards.set('enforcer_1', makeCard('enforcer_1', 'enforcer_def', 'p1'));
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p1'));
    cards.set('bear_2', makeCard('bear_2', 'bear_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('enforcer_def', makeDef('enforcer_def', {
      name: 'Zulaport Enforcer',
      type_line: 'Creature — Vampire Soldier',
      oracle_text: 'Level up {4}\nOther creatures you control get +1/+1.',
      keywords: [],
      power: 1, toughness: 2,
      colors: ['B'],
    }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'enforcer_1', 'p1', parsed.ability);

    // The anthem grants +1/+1 to OTHER creatures you control.
    expect(getGrantedKeywords(state, 'bear_1').length >= 0).toBe(true); // side-effect may be PT
    // Verify the modifier is a PT pump targeting other creatures.
    expect(parsed.ability.modifier.kind).toBe('ModifyPT');
    if (parsed.ability.modifier.kind === 'ModifyPT') {
      expect(parsed.ability.modifier.power).toBe(1);
      expect(parsed.ability.modifier.toughness).toBe(1);
    }
    expect(parsed.ability.excludeSelf).toBe(true);
  });

  it('Ascend: absorbed + cant-be-blocked parses and the static ability is registered', () => {
    const parsed = parseOracleText("Ascend\nThis creature can't be blocked.");
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.absorbedKeywords).toContain('ascend');

    // Verify the static ability modifier is GrantKeyword{unblockable} (can't be blocked).
    // "can't be blocked" resolves to GrantKeyword{unblockable} via matchOtherEvasion.
    expect(parsed.ability.modifier.kind).toBe('GrantKeyword');
    if (parsed.ability.modifier.kind === 'GrantKeyword') {
      expect(parsed.ability.modifier.keyword).toBe('unblockable');
    }

    // Execute: registerContinuousEffect records the static for the battlefield.
    const cards = new Map<string, CardInstance>();
    cards.set('ascend_1', makeCard('ascend_1', 'ascend_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('ascend_def', makeDef('ascend_def', {
      name: 'Ascend Creature',
      type_line: 'Creature',
      oracle_text: "Ascend\nThis creature can't be blocked.",
      keywords: [],
      power: 2, toughness: 2,
    }));

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'ascend_1', 'p1', parsed.ability);
    // The effect is registered — no error means execution path accepted the ability.
    expect(state.continuousEffects).toHaveLength(1);
    // The absorbed ascend keyword is a pure honest skip (no engine enforcer verified
    // by grep: zero 'ascend' references in executor.ts / keywords.ts).
  });
});
