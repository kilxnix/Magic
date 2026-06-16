/**
 * Slice 5 — Play/cast from top of library: variant wording and multi-line absorption.
 *
 * Parser extensions in static-abilities.ts (matchTopLibraryPlayStatic):
 *
 *   1. PLAY_TOP_CARD_DIRECT_RE  — "You may play the top card of your library."
 *      (Lunar Whale wording variant: "play THE top card" without "from the top").
 *
 *   2. PLAY_TOP_CARD_CONDITIONAL_RE  — "As long as <cond>, you may play the top
 *      card of your library." (Lunar Whale combat-gated form). The condition is
 *      not enforced; absorbed as an honest skip so the sibling look-at-top line
 *      can carry the parse.
 *
 *   3. CAST_INSTANT_OR_SORCERY_FROM_TOP_RE  — "You may cast instant or sorcery
 *      spells from the top of your library." (with "or" instead of "and").
 *
 * Per-line absorber extension in parser.ts (parseOracleTextPerLine step 1l-ii):
 *
 *   4. isTopLibraryStaticSentence  — absorbs reveal/look/play-from-top lines in
 *      multi-line faces so a sibling trigger, activated ability, or static can
 *      carry the parse. Enables Lunar Whale (Flying + look-at-top + crew 1) to
 *      parse as StaticAbility (look-at-top).
 *
 * Executor route: PlayFromTopLibrary is already executed by canCastSpell (stack.ts)
 * and canPlayLandDetailed (actions.ts). No executor change required.
 *
 * Real oracle wordings tested:
 *   The Lunar Whale  — "Flying\nYou may look at the top card of your library any
 *                       time.\nAs long as ~ attacked this turn, you may play the
 *                       top card of your library.\nCrew 1"
 *   "play the top card" form  — "You may play the top card of your library."
 *   "or" sorcery form         — "You may cast instant or sorcery spells from the
 *                                top of your library."
 *   Look+PlayTop composition  — "You may look at the top card of your library any
 *                                time.\nYou may play the top card of your library."
 *   Play-permission absorption — trigger + look-at-top-line sibling
 */

import { describe, it, expect } from 'vitest';
import type { CardDefinition, GameState } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { isTopLibraryStaticSentence } from '../effects/matchers/static-abilities';
import { registerContinuousAbilitiesForPermanent, canCastSpell, canPlayCardFromTopOfLibrary } from '../stack';
import { canPlayLand } from '../actions';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeDef(
  id: string,
  overrides: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: overrides.name ?? id,
    type_line: overrides.type_line ?? 'Creature',
    oracle_text: overrides.oracle_text ?? '',
    mana_cost: overrides.mana_cost ?? '{2}{U}',
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? ['U'],
    color_identity: overrides.color_identity ?? ['U'],
    keywords: overrides.keywords ?? [],
    card_types: overrides.card_types ?? ['creature'],
    power: overrides.power ?? 2,
    toughness: overrides.toughness ?? 2,
  } as CardDefinition;
}

function makeState(
  defs: CardDefinition[],
  instancesSpec: Array<{ defId: string; zone: 'battlefield' | 'library' | 'hand'; ownerId?: string }>,
): GameState {
  const state: GameState = {
    players: [
      { ...createPlayer('p1', 'Alice'), life: 20, manaPool: { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 } },
      createPlayer('p2', 'Bob'),
    ],
    cards: new Map(),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: [],
  };
  let idx = 0;
  for (const spec of instancesSpec) {
    const instanceId = `inst_${spec.defId}_${idx++}`;
    state.cards.set(instanceId, {
      instanceId,
      definitionId: spec.defId,
      ownerId: spec.ownerId ?? 'p1',
      zone: spec.zone,
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
  }
  return state;
}

function bfCardId(state: GameState, defId: string): string {
  return [...state.cards.values()].find(c => c.definitionId === defId && c.zone === 'battlefield')?.instanceId ?? '';
}

function topCardId(state: GameState, ownerId = 'p1'): string {
  const lib = [...state.cards.values()].filter(c => c.ownerId === ownerId && c.zone === 'library');
  return lib[0]?.instanceId ?? '';
}

// ============================================================================
// 1. Parser: PLAY_TOP_CARD_DIRECT_RE — "play the top card" (no "from")
// ============================================================================

describe('Slice 5 — PLAY_TOP_CARD_DIRECT_RE: "You may play the top card of your library"', () => {
  it('single-line "play the top card" parses as StaticAbility with PlayFromTopLibrary', () => {
    const oracle = 'You may play the top card of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
    // No type filter — full permission
    const mod = parsed.ability.modifier as { kind: string; typeFilter?: unknown };
    expect(mod.typeFilter).toBeUndefined();
    expect(parsed.ability.selfOnly).toBe(true);
  });

  it('"You may look + play the top card" two-sentence composition', () => {
    const oracle = 'You may look at the top card of your library any time.\nYou may play the top card of your library.';
    const parsed = parseOracleText(oracle);
    // Should parse as PlayFromTopLibrary because matchTopLibraryPlayStatic handles
    // the combined look + play-top-card form.
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
    const mod = parsed.ability.modifier as { kind: string; typeFilter?: unknown };
    // Full play permission — no type restriction
    expect(mod.typeFilter).toBeUndefined();
  });

  it('"You may look + play the top card" single-line (period-separated)', () => {
    const oracle = 'You may look at the top card of your library any time. You may play the top card of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
  });
});

// ============================================================================
// 2. Parser: CAST_INSTANT_OR_SORCERY_FROM_TOP_RE — "or" variant
// ============================================================================

describe('Slice 5 — "instant or sorcery" (or) wording variant', () => {
  it('"You may cast instant or sorcery spells from the top" parses as StaticAbility', () => {
    const oracle = 'You may cast instant or sorcery spells from the top of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
    const mod = parsed.ability.modifier as { kind: string; typeFilter?: { anyOf?: Array<{ types?: string[] }> } };
    // Should have an instant/sorcery type filter
    expect(mod.typeFilter).toBeDefined();
    if (mod.typeFilter?.anyOf) {
      const types = mod.typeFilter.anyOf.flatMap(f => f.types ?? []);
      expect(types).toContain('instant');
      expect(types).toContain('sorcery');
    }
  });

  it('"look + cast instant or sorcery spells" (two-line)', () => {
    const oracle = 'You may look at the top card of your library any time.\nYou may cast instant or sorcery spells from the top of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
    const mod = parsed.ability.modifier as { kind: string; typeFilter?: { anyOf?: Array<{ types?: string[] }> } };
    expect(mod.typeFilter).toBeDefined();
    if (mod.typeFilter?.anyOf) {
      const types = mod.typeFilter.anyOf.flatMap(f => f.types ?? []);
      expect(types).toContain('instant');
      expect(types).toContain('sorcery');
    }
  });
});

// ============================================================================
// 3. Parser: Lunar Whale multi-line absorption
// ============================================================================

describe('Slice 5 — Lunar Whale multi-line absorption', () => {
  it('Flying + look-at-top + conditional-play + Crew 1 parses as StaticAbility', () => {
    // Lunar Whale oracle with newlines (per-line absorber path)
    const oracle =
      'Flying\n' +
      'You may look at the top card of your library any time.\n' +
      'As long as ~ attacked this turn, you may play the top card of your library.\n' +
      'Crew 1';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    // The primary parse is the PlayFromTopLibrary static (from the look-at-top or
    // the play-top-card-direct sentence); conditional combat-gated line is absorbed.
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
  });

  it('conditional play-from-top alone (honest skip — not a full play grant)', () => {
    // "As long as X, you may play the top card of your library" in isolation
    // parses as StaticAbility but with look-only (no permission granted by the engine
    // since the condition is unenforced). The face still CREDITS as StaticAbility.
    const oracle = 'You may look at the top card of your library any time.\nAs long as ~ attacked this turn, you may play the top card of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
  });
});

// ============================================================================
// 4. isTopLibraryStaticSentence: exported helper
// ============================================================================

describe('Slice 5 — isTopLibraryStaticSentence helper', () => {
  it('returns true for reveal-top sentence', () => {
    expect(isTopLibraryStaticSentence('Play with the top card of your library revealed.')).toBe(true);
  });

  it('returns true for look-at-top sentence', () => {
    expect(isTopLibraryStaticSentence('You may look at the top card of your library any time.')).toBe(true);
  });

  it('returns true for "play the top card" sentence (new variant)', () => {
    expect(isTopLibraryStaticSentence('You may play the top card of your library.')).toBe(true);
  });

  it('returns true for conditional play-top-card sentence (new variant)', () => {
    expect(isTopLibraryStaticSentence('As long as ~ attacked this turn, you may play the top card of your library.')).toBe(true);
  });

  it('returns true for "play lands and cast spells from the top" sentence', () => {
    expect(isTopLibraryStaticSentence('You may play lands and cast spells from the top of your library.')).toBe(true);
  });

  it('returns true for "cast instant and sorcery spells from the top" sentence', () => {
    expect(isTopLibraryStaticSentence('You may cast instant and sorcery spells from the top of your library.')).toBe(true);
  });

  it('returns true for "cast instant or sorcery spells from the top" sentence (new variant)', () => {
    expect(isTopLibraryStaticSentence('You may cast instant or sorcery spells from the top of your library.')).toBe(true);
  });

  it('returns false for unrelated sentences', () => {
    expect(isTopLibraryStaticSentence('Creatures you control get +1/+1.')).toBe(false);
    expect(isTopLibraryStaticSentence('Flying')).toBe(false);
    expect(isTopLibraryStaticSentence('Crew 1')).toBe(false);
    expect(isTopLibraryStaticSentence('When this creature enters, draw a card.')).toBe(false);
  });
});

// ============================================================================
// 5. Per-line absorber: top-library static sibling absorbed next to a trigger
// ============================================================================

describe('Slice 5 — per-line absorption: look-at-top sibling of a trigger', () => {
  it('look-at-top line absorbed; ETB trigger carries the parse', () => {
    // A permanent with a "When this creature enters" trigger and a look-at-top line.
    // Per-line absorber: look-at-top is absorbed (step 1l-ii), ETB trigger carries parse.
    const oracle =
      'You may look at the top card of your library any time.\n' +
      'When this creature enters, draw a card.';
    const parsed = parseOracleText(oracle);
    // The ETB trigger is the "richest" line; look-at-top is absorbed.
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind === 'ETB') {
      const effects = parsed.ability.effects;
      expect(effects.some(e => e.kind === 'Draw')).toBe(true);
    }
  });

  it('play-from-top line absorbed when ETB trigger is the primary ability', () => {
    const oracle =
      'Play with the top card of your library revealed.\n' +
      'When this creature enters, draw a card.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
    // ETB outranks StaticAbility in PER_LINE_KIND_RANK
    if (parsed.kind === 'ETB') {
      const effects = parsed.ability.effects;
      expect(effects.some(e => e.kind === 'Draw')).toBe(true);
    }
  });
});

// ============================================================================
// 6. Executor: PlayFromTopLibrary registered and enforced
// ============================================================================

describe('Slice 5 — executor: PlayFromTopLibrary granted by "play the top card" form', () => {
  it('canPlayCardFromTopOfLibrary returns true for top-card land when modifier active', () => {
    const landDef = makeDef('forest1', {
      card_types: ['land'],
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      mana_cost: '',
      cmc: 0,
      keywords: [],
    });
    // Permanent with "You may play the top card of your library."
    const permDef = makeDef('whale1', {
      card_types: ['creature'],
      oracle_text: 'You may play the top card of your library.',
    });
    const baseState = makeState([landDef, permDef], [
      { defId: 'whale1', zone: 'battlefield' },
      { defId: 'forest1', zone: 'library' },
    ]);
    const whaleId = bfCardId(baseState, 'whale1');
    const registeredState = registerContinuousAbilitiesForPermanent(baseState, whaleId);
    const landId = topCardId(registeredState);
    // Without registration, land at library top is not playable
    expect(canPlayLand(baseState, 'p1', landId)).toBe(false);
    // After registration, the land at the top of the library should be playable
    expect(canPlayLand(registeredState, 'p1', landId)).toBe(true);
  });

  it('canPlayCardFromTopOfLibrary returns true for top-card instant', () => {
    const spellDef = makeDef('bolt1', {
      card_types: ['instant'],
      oracle_text: '',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['R'],
    });
    const permDef = makeDef('whale1', {
      card_types: ['creature'],
      oracle_text: 'You may play the top card of your library.',
    });
    const baseState = makeState([spellDef, permDef], [
      { defId: 'whale1', zone: 'battlefield' },
      { defId: 'bolt1', zone: 'library' },
    ]);
    const whaleId = bfCardId(baseState, 'whale1');
    const registeredState = registerContinuousAbilitiesForPermanent(baseState, whaleId);
    const spellId = topCardId(registeredState);
    expect(canPlayCardFromTopOfLibrary(registeredState, 'p1', spellId, spellDef)).toBe(true);
  });

  it('canPlayCardFromTopOfLibrary uses "instant or sorcery" filter (OR variant)', () => {
    const instantDef = makeDef('bolt1', {
      card_types: ['instant'],
      oracle_text: '',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['R'],
    });
    const creatureDef = makeDef('bear1', {
      card_types: ['creature'],
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
    });
    // "or" variant of the instant/sorcery filter
    const permDef = makeDef('filterPerm', {
      card_types: ['creature'],
      oracle_text: 'You may cast instant or sorcery spells from the top of your library.',
    });
    // Test: instant should be castable from top
    const state1 = makeState([instantDef, permDef], [
      { defId: 'filterPerm', zone: 'battlefield' },
      { defId: 'bolt1', zone: 'library' },
    ]);
    const permId1 = bfCardId(state1, 'filterPerm');
    const reg1 = registerContinuousAbilitiesForPermanent(state1, permId1);
    const instantId = topCardId(reg1);
    expect(canPlayCardFromTopOfLibrary(reg1, 'p1', instantId, instantDef)).toBe(true);

    // Test: creature should NOT be castable from top (filtered out)
    const state2 = makeState([creatureDef, permDef], [
      { defId: 'filterPerm', zone: 'battlefield' },
      { defId: 'bear1', zone: 'library' },
    ]);
    const permId2 = bfCardId(state2, 'filterPerm');
    const reg2 = registerContinuousAbilitiesForPermanent(state2, permId2);
    const creaId = topCardId(reg2);
    expect(canPlayCardFromTopOfLibrary(reg2, 'p1', creaId, creatureDef)).toBe(false);
  });
});
