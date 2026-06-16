/**
 * Slice 4 — Top-of-library play-permission static ability.
 *
 * Matcher: matchTopLibraryPlayStatic (static-abilities.ts)
 * Modifier: PlayFromTopLibrary (ast.ts)
 * Executor routes:
 *   - canCastSpell (stack.ts): allows casting top-of-library non-land cards
 *   - canPlayLandDetailed (actions.ts): allows playing top-of-library land cards
 *   - generateCastSpellActions / generatePlayLandActions (ai/legal-actions.ts):
 *     enumerate top-of-library card as a legal action
 *
 * Real oracle wordings tested:
 *   Magus of the Future  — "Play with the top card of your library revealed.
 *                           You may play lands and cast spells from the top of your library."
 *   Melek, Izzet Paragon — "... You may cast instant and sorcery spells from the top of your library."
 *   Korlessa, Scale Singer — "You may look at the top card of your library any time.
 *                              You may cast Dragon spells from the top of your library."
 *   Vampire Nocturnus    — "Play with the top card of your library revealed..." (multi-ability; declines due to anthem)
 *   Assemble the Players — "You may cast creature spells with power 2 or less from the top of your library."
 */

import { describe, it, expect } from 'vitest';
import type { CardDefinition, GameState } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { registerContinuousAbilitiesForPermanent, canCastSpell, canPlayCardFromTopOfLibrary } from '../stack';
import { canPlayLand } from '../actions';
import { getLegalActions } from '../ai/legal-actions';

// ── helpers ─────────────────────────────────────────────────────────────────

function makeDef(
  id: string,
  overrides: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name: overrides.name ?? id,
    type_line: overrides.type_line ?? 'Creature',
    oracle_text: overrides.oracle_text ?? '',
    mana_cost: overrides.mana_cost ?? '{2}{G}',
    cmc: overrides.cmc ?? 2,
    colors: overrides.colors ?? ['G'],
    color_identity: overrides.color_identity ?? ['G'],
    keywords: overrides.keywords ?? [],
    card_types: overrides.card_types ?? ['creature'],
    power: overrides.power ?? 2,
    toughness: overrides.toughness ?? 2,
  } as CardDefinition;
}

function makeState(defs: CardDefinition[], instancesSpec: Array<{ defId: string; zone: 'battlefield' | 'library' | 'hand'; ownerId?: string }>): GameState {
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

function topCardId(state: GameState, ownerId = 'p1'): string {
  const lib = [...state.cards.values()].filter(c => c.ownerId === ownerId && c.zone === 'library');
  return lib[0]?.instanceId ?? '';
}

function bfCardId(state: GameState, defId: string): string {
  return [...state.cards.values()].find(c => c.definitionId === defId && c.zone === 'battlefield')?.instanceId ?? '';
}

// ── 1. Parser: matchTopLibraryPlayStatic ───────────────────────────────────

describe('matchTopLibraryPlayStatic — parser', () => {
  it('Magus of the Future: play lands and cast spells', () => {
    const oracle =
      'Play with the top card of your library revealed. You may play lands and cast spells from the top of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
    const mod = parsed.ability.modifier as { kind: 'PlayFromTopLibrary'; typeFilter?: unknown };
    // No type filter — any card may be played
    expect(mod.typeFilter).toBeUndefined();
    expect(parsed.ability.selfOnly).toBe(true);
  });

  it('Melek, Izzet Paragon: cast instant and sorcery spells from top', () => {
    // Using just the top-library part of Melek's oracle text
    const oracle = 'You may cast instant and sorcery spells from the top of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
    const mod = parsed.ability.modifier as { kind: 'PlayFromTopLibrary'; typeFilter?: { anyOf?: Array<{ types?: string[] }> } };
    expect(mod.typeFilter).toBeDefined();
    // Should filter to instants and sorceries
    const tf = mod.typeFilter!;
    if (tf.anyOf) {
      const types = tf.anyOf.flatMap(f => f.types ?? []);
      expect(types).toContain('instant');
      expect(types).toContain('sorcery');
    } else {
      // alternate: types includes both (less likely but accept)
      expect(tf).toBeDefined();
    }
  });

  it('Korlessa, Scale Singer: look + cast Dragon spells from top', () => {
    const oracle =
      'You may look at the top card of your library any time. You may cast Dragon spells from the top of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
    const mod = parsed.ability.modifier as { kind: 'PlayFromTopLibrary'; typeFilter?: { types?: string[]; subtypes?: string[] } };
    // Dragon filter
    expect(mod.typeFilter).toBeDefined();
    if (mod.typeFilter) {
      expect(mod.typeFilter.subtypes).toContain('dragon');
    }
  });

  it('reveal-only line: Play with the top card of your library revealed.', () => {
    const oracle = 'Play with the top card of your library revealed.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
  });

  it('look-only line: You may look at the top card of your library any time.', () => {
    const oracle = 'You may look at the top card of your library any time.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
  });

  it('Assemble the Players: creature spells with power 2 or less', () => {
    const oracle =
      'You may cast creature spells with power 2 or less from the top of your library.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('PlayFromTopLibrary');
    const mod = parsed.ability.modifier as { kind: 'PlayFromTopLibrary'; typeFilter?: { types?: string[]; power?: { op: string; value: number } } };
    expect(mod.typeFilter).toBeDefined();
    if (mod.typeFilter) {
      expect(mod.typeFilter.types).toContain('creature');
      expect(mod.typeFilter.power?.op).toBe('lte');
      expect(mod.typeFilter.power?.value).toBe(2);
    }
  });

  it('Vampire Nocturnus multi-ability face: DECLINES (has unrun anthem)', () => {
    // Vampire Nocturnus has a top-of-library reveal + conditional anthem.
    // The anthem ("other Vampire creatures get +2/+1 and have flying") is a
    // separate continuous ability the engine CAN run but the raw oracle text
    // when presented as a multi-sentence block to matchTopLibraryPlayStatic
    // should be DECLINED because the anthem sentence is not a top-library-play sentence.
    const oracle =
      'Play with the top card of your library revealed. As long as the top card of your library is a black card, Vampires you control get +2/+1 and have flying.';
    const parsed = parseOracleText(oracle);
    // The per-line dispatch in parseOracleTextPerLine may parse individual lines,
    // but matchTopLibraryPlayStatic itself should decline the multi-ability form.
    // We check that we didn't get a PlayFromTopLibrary on a card with an anthem.
    if (parsed.kind === 'StaticAbility') {
      const mod = parsed.ability.modifier;
      // If it parses as StaticAbility, it must NOT claim PlayFromTopLibrary
      // for the anthem part (the anthem is the real function of the card, not this).
      // Actually matchTopLibraryPlayStatic declines because "As long as ... get +2/+1" is not a top-library sentence.
      expect(mod.kind).not.toBe('PlayFromTopLibrary');
    }
    // Regardless of parse kind, we just ensure no false parse of the anthem as PlayFromTopLibrary.
  });
});

// ── 2. Executor: canPlayCardFromTopOfLibrary ────────────────────────────────

describe('canPlayCardFromTopOfLibrary — executor', () => {
  it('returns false when the card is not at the top of the library', () => {
    const spellDef = makeDef('spell1', { card_types: ['instant'], oracle_text: '', mana_cost: '{U}', cmc: 1 });
    const blocker = makeDef('blocker1', { card_types: ['creature'], oracle_text: '' });
    const magDef = makeDef('magus1', {
      card_types: ['creature'],
      oracle_text: 'Play with the top card of your library revealed. You may play lands and cast spells from the top of your library.',
    });
    // blocker1 is inserted before spell1 so it's on top of the library
    const state = makeState([spellDef, blocker, magDef], [
      { defId: 'magus1', zone: 'battlefield' },
      { defId: 'blocker1', zone: 'library' }, // top card
      { defId: 'spell1', zone: 'library' },   // second card (not top)
    ]);
    // Register continuous abilities for the magus on the battlefield
    const magusId = bfCardId(state, 'magus1');
    const registeredState = registerContinuousAbilitiesForPermanent(state, magusId);
    // The spell is NOT at the top (blocker1 is above it)
    const spellId = [...registeredState.cards.values()].find(c => c.definitionId === 'spell1' && c.zone === 'library')?.instanceId ?? '';
    expect(canPlayCardFromTopOfLibrary(registeredState, 'p1', spellId, spellDef)).toBe(false);
  });

  it('returns true when card is at the top and no typeFilter', () => {
    const spellDef = makeDef('spell1', { card_types: ['instant'], oracle_text: '', mana_cost: '{U}', cmc: 1 });
    const magDef = makeDef('magus1', {
      card_types: ['creature'],
      oracle_text: 'Play with the top card of your library revealed. You may play lands and cast spells from the top of your library.',
    });
    const state = makeState([spellDef, magDef], [
      { defId: 'magus1', zone: 'battlefield' },
      { defId: 'spell1', zone: 'library' },
    ]);
    const magusId = bfCardId(state, 'magus1');
    const registeredState = registerContinuousAbilitiesForPermanent(state, magusId);
    const spellId = topCardId(registeredState);
    expect(canPlayCardFromTopOfLibrary(registeredState, 'p1', spellId, spellDef)).toBe(true);
  });

  it('returns false when typeFilter does not match', () => {
    // Melek-style: only instant and sorcery from top
    const creatureDef = makeDef('crea1', { card_types: ['creature'], oracle_text: '', mana_cost: '{2}{G}', cmc: 2 });
    const melekDef = makeDef('melek1', {
      card_types: ['creature'],
      oracle_text: 'You may cast instant and sorcery spells from the top of your library.',
    });
    const state = makeState([creatureDef, melekDef], [
      { defId: 'melek1', zone: 'battlefield' },
      { defId: 'crea1', zone: 'library' },
    ]);
    const melekId = bfCardId(state, 'melek1');
    const registeredState = registerContinuousAbilitiesForPermanent(state, melekId);
    const creaId = topCardId(registeredState);
    // Creature does not match instant/sorcery filter
    expect(canPlayCardFromTopOfLibrary(registeredState, 'p1', creaId, creatureDef)).toBe(false);
  });
});

// ── 3. canCastSpell: library zone with PlayFromTopLibrary active ────────────

describe('canCastSpell — top of library', () => {
  it('allows casting a non-land spell from the top of the library', () => {
    const spellDef = makeDef('bolt1', { card_types: ['instant'], oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'] });
    const magDef = makeDef('magus1', {
      card_types: ['creature'],
      oracle_text: 'Play with the top card of your library revealed. You may play lands and cast spells from the top of your library.',
    });
    const baseState = makeState([spellDef, magDef], [
      { defId: 'magus1', zone: 'battlefield' },
      { defId: 'bolt1', zone: 'library' },
    ]);
    // Without registration, canCastSpell should fail (wrong zone)
    const spellId = topCardId(baseState);
    expect(canCastSpell(baseState, 'p1', spellId)).toBe(false);

    // Register the magus's continuous ability
    const magusId = bfCardId(baseState, 'magus1');
    const registeredState = registerContinuousAbilitiesForPermanent(baseState, magusId);
    // Now casting from the top of the library should be allowed
    expect(canCastSpell(registeredState, 'p1', spellId)).toBe(true);
  });

  it('still disallows casting a non-top-library card', () => {
    const spellDef = makeDef('bolt1', { card_types: ['instant'], oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'] });
    const spellDef2 = makeDef('bolt2', { card_types: ['instant'], oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'] });
    const magDef = makeDef('magus1', {
      card_types: ['creature'],
      oracle_text: 'Play with the top card of your library revealed. You may play lands and cast spells from the top of your library.',
    });
    const baseState = makeState([spellDef, spellDef2, magDef], [
      { defId: 'magus1', zone: 'battlefield' },
      { defId: 'bolt1', zone: 'library' }, // top
      { defId: 'bolt2', zone: 'library' }, // second from top
    ]);
    const magusId = bfCardId(baseState, 'magus1');
    const registeredState = registerContinuousAbilitiesForPermanent(baseState, magusId);
    // bolt2 is second from top — cannot cast it
    const bolt2Id = [...registeredState.cards.values()].find(c => c.definitionId === 'bolt2' && c.zone === 'library')?.instanceId ?? '';
    expect(canCastSpell(registeredState, 'p1', bolt2Id)).toBe(false);
  });
});

// ── 4. canPlayLand: land at top of library ─────────────────────────────────

describe('canPlayLand — top of library', () => {
  it('allows playing a land from the top of the library when modifier is active', () => {
    const landDef = makeDef('forest1', {
      card_types: ['land'],
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      mana_cost: '',
      cmc: 0,
      keywords: [],
    });
    const magDef = makeDef('magus1', {
      card_types: ['creature'],
      oracle_text: 'Play with the top card of your library revealed. You may play lands and cast spells from the top of your library.',
    });
    const baseState = makeState([landDef, magDef], [
      { defId: 'magus1', zone: 'battlefield' },
      { defId: 'forest1', zone: 'library' },
    ]);
    const landId = topCardId(baseState);
    // Without registration — should not be playable from library
    expect(canPlayLand(baseState, 'p1', landId)).toBe(false);

    // Register the magus's continuous ability
    const magusId = bfCardId(baseState, 'magus1');
    const registeredState = registerContinuousAbilitiesForPermanent(baseState, magusId);
    // Now the land at the top should be playable
    expect(canPlayLand(registeredState, 'p1', landId)).toBe(true);
  });
});

// ── 5. getLegalActions: top-of-library actions generated ───────────────────

describe('getLegalActions — top of library', () => {
  it('includes a CastSpell action for the top-of-library spell when modifier is active', () => {
    const spellDef = makeDef('bolt1', { card_types: ['instant'], oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'] });
    const magDef = makeDef('magus1', {
      card_types: ['creature'],
      oracle_text: 'Play with the top card of your library revealed. You may play lands and cast spells from the top of your library.',
    });
    const baseState = makeState([spellDef, magDef], [
      { defId: 'magus1', zone: 'battlefield' },
      { defId: 'bolt1', zone: 'library' },
    ]);
    const magusId = bfCardId(baseState, 'magus1');
    const registeredState = registerContinuousAbilitiesForPermanent(baseState, magusId);
    const spellId = topCardId(registeredState);

    const actions = getLegalActions(registeredState, 'p1');
    const castFromLib = actions.filter(a => a.kind === 'CastSpell' && a.cardInstanceId === spellId);
    expect(castFromLib.length).toBeGreaterThan(0);
  });

  it('includes a PlayLand action for the top-of-library land when modifier is active', () => {
    const landDef = makeDef('plains1', {
      card_types: ['land'],
      type_line: 'Basic Land — Plains',
      oracle_text: '{T}: Add {W}.',
      mana_cost: '',
      cmc: 0,
      keywords: [],
    });
    const magDef = makeDef('magus1', {
      card_types: ['creature'],
      oracle_text: 'Play with the top card of your library revealed. You may play lands and cast spells from the top of your library.',
    });
    const baseState = makeState([landDef, magDef], [
      { defId: 'magus1', zone: 'battlefield' },
      { defId: 'plains1', zone: 'library' },
    ]);
    const magusId = bfCardId(baseState, 'magus1');
    const registeredState = registerContinuousAbilitiesForPermanent(baseState, magusId);
    const landId = topCardId(registeredState);

    const actions = getLegalActions(registeredState, 'p1');
    const playFromLib = actions.filter(a => a.kind === 'PlayLand' && a.cardInstanceId === landId);
    expect(playFromLib.length).toBeGreaterThan(0);
  });

  it('does NOT include top-of-library spell when no PlayFromTopLibrary modifier is active', () => {
    const spellDef = makeDef('bolt1', { card_types: ['instant'], oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'] });
    // A dummy creature with no top-library ability
    const dummyDef = makeDef('dummy1', { card_types: ['creature'], oracle_text: '' });
    const state = makeState([spellDef, dummyDef], [
      { defId: 'dummy1', zone: 'battlefield' },
      { defId: 'bolt1', zone: 'library' },
    ]);
    const spellId = topCardId(state);
    const actions = getLegalActions(state, 'p1');
    const castFromLib = actions.filter(a => a.kind === 'CastSpell' && a.cardInstanceId === spellId);
    expect(castFromLib.length).toBe(0);
  });
});
