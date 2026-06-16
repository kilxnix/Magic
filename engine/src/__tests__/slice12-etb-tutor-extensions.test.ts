import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Slice 12: ETB tutor filter extensions
// Three new filter/zone variants beyond matchSearchLibraryGeneric:
//   (A) "nonlegendary" exclusion prefix          (Woodland Bellower)
//   (B) Hyphenated subtype (tokenised word-word) (Self-Assembler)
//   (C) "library and/or graveyard" dual-zone     (Sun-Blessed Mount)
//
// Parse AND execution are asserted for all three.
// ---------------------------------------------------------------------------

function def(partial: Partial<CardDefinition> & { id: string; name: string; type_line: string }): CardDefinition {
  return {
    oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: [], keywords: [], card_types: [],
    ...partial,
  } as CardDefinition;
}

// --- Fixtures for Woodland Bellower (nonlegendary green creature mv<=3) ---
const dLegendGreen = def({
  id: 'legendGreen', name: 'Omnath, Locus of Mana', type_line: 'Legendary Creature — Elemental',
  cmc: 3, card_types: ['creature'], colors: ['G'], power: 1, toughness: 1,
});
const dNonlegendGreenBig = def({
  id: 'greenBig', name: 'Leatherback Baloth', type_line: 'Creature — Beast',
  cmc: 4, card_types: ['creature'], colors: ['G'], power: 4, toughness: 5,
});
const dNonlegendGreenSmall = def({
  id: 'greenSmall', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
  cmc: 1, card_types: ['creature'], colors: ['G'], power: 1, toughness: 1,
});
const dNonlegendGreenMid = def({
  id: 'greenMid', name: 'Yavimaya Elder', type_line: 'Creature — Human Druid',
  cmc: 3, card_types: ['creature'], colors: ['G'], power: 2, toughness: 1,
});
const dRedCreature = def({
  id: 'redCreature', name: 'Goblin Guide', type_line: 'Creature — Goblin Scout',
  cmc: 1, card_types: ['creature'], colors: ['R'], power: 2, toughness: 2,
});

// --- Fixtures for Self-Assembler (Assembly-Worker subtype) ---
const dAssemblyWorker1 = def({
  id: 'aw1', name: "Ashnod's Transmogrant", type_line: 'Creature — Assembly-Worker',
  cmc: 1, card_types: ['creature'], colors: [], power: 1, toughness: 1,
});
const dAssemblyWorker2 = def({
  id: 'aw2', name: 'Phyrexian Marauder', type_line: 'Creature — Assembly-Worker',
  cmc: 2, card_types: ['creature'], colors: [], power: 2, toughness: 2,
});
const dNonWorker = def({
  id: 'nonWorker', name: 'Sol Ring', type_line: 'Artifact',
  cmc: 1, card_types: ['artifact'], colors: [],
});

// --- Fixtures for Sun-Blessed Mount (library and/or graveyard named card) ---
const dArcaneSignet = def({
  id: 'arcane', name: 'Arcane Signet', type_line: 'Artifact',
  cmc: 2, card_types: ['artifact'], colors: [],
});
const dOther = def({
  id: 'other', name: 'Lightning Bolt', type_line: 'Instant',
  cmc: 1, card_types: ['instant'], colors: ['R'],
});

const ALL_DEFS: CardDefinition[] = [
  dLegendGreen, dNonlegendGreenBig, dNonlegendGreenSmall, dNonlegendGreenMid,
  dRedCreature, dAssemblyWorker1, dAssemblyWorker2, dNonWorker, dArcaneSignet, dOther,
];

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId: owner, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

/** GameState with given def-ids in p0's library, plus optional graveyard cards. */
function libState(libDefIds: string[], graveyardDefIds: string[] = []): GameState {
  const allCards = [
    ...libDefIds.map((d, i) => [`lib_c${i}`, mk(`lib_c${i}`, d, 'p0', 'library')] as [string, CardInstance]),
    ...graveyardDefIds.map((d, i) => [`gy_c${i}`, mk(`gy_c${i}`, d, 'p0', 'graveyard')] as [string, CardInstance]),
  ];
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>(allCards),
    cardDefinitions: new Map<string, CardDefinition>(ALL_DEFS.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function inZone(s: GameState, zone: string): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.definitionId).sort();
}

// =============================================================================
// (A) "nonlegendary" exclusion prefix — Woodland Bellower
// =============================================================================

const BELLOWER_TEXT = 'When this creature enters, you may search your library for a nonlegendary green creature card with mana value 3 or less, reveal it, put it into your hand, then shuffle.';

describe('Slice 12 ETB tutor: nonlegendary green creature mv<=3 (Woodland Bellower)', () => {
  it('parses as ETB with excludeSupertypes Legendary, colors G, types creature, cmc lte 3', () => {
    const p = parseOracleText(BELLOWER_TEXT);
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    const sl = p.ability.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.filter.excludeSupertypes).toEqual(['Legendary']);
    expect(sl.filter.colors).toEqual(['G']);
    expect(sl.filter.types).toEqual(['creature']);
    expect(sl.filter.cmc).toMatchObject({ op: 'lte', value: 3 });
    expect(sl.destination).toBe('hand');
    expect(sl.shuffle).toBe(true);
  });

  it('emits a ShuffleLibrary effect after the SearchLibrary', () => {
    const p = parseOracleText(BELLOWER_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    expect(p.ability.effects.some(e => e.kind === 'ShuffleLibrary')).toBe(true);
  });

  it('executes: fetches only a nonlegendary green creature with mv<=3', () => {
    const p = parseOracleText(BELLOWER_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    // legendGreen (mv 3 but Legendary) must be skipped.
    // greenBig (mv 4) must be skipped.
    // redCreature (not green) must be skipped.
    // greenSmall (mv 1, green, nonlegendary creature) ← first valid match.
    const s = executeEffects(
      libState(['legendGreen', 'greenBig', 'redCreature', 'greenSmall', 'greenMid']),
      p.ability.effects,
      'p0', [], [],
    );
    expect(inZone(s, 'hand')).toContain('greenSmall');
    // Legendary green creature must NOT be in hand.
    expect(inZone(s, 'hand')).not.toContain('legendGreen');
    // mv-4 green creature must NOT be in hand.
    expect(inZone(s, 'hand')).not.toContain('greenBig');
  });

  it('executes: skips legendary creature even when listed first', () => {
    const p = parseOracleText(BELLOWER_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    // legendGreen listed first; greenMid is the valid pick.
    const s = executeEffects(
      libState(['legendGreen', 'greenMid']),
      p.ability.effects,
      'p0', [], [],
    );
    expect(inZone(s, 'hand')).toEqual(['greenMid']);
    expect(inZone(s, 'library')).toContain('legendGreen');
  });
});

// =============================================================================
// (B) Hyphenated subtype — Self-Assembler (Assembly-Worker)
// =============================================================================

const ASSEMBLER_TEXT = 'When this creature enters, you may search your library for an Assembly-Worker card, reveal it, put it into your hand, then shuffle.';

describe('Slice 12 ETB tutor: hyphenated subtype Assembly-Worker (Self-Assembler)', () => {
  it('parses as ETB with subtypes ["Assembly-Worker"]', () => {
    const p = parseOracleText(ASSEMBLER_TEXT);
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    const sl = p.ability.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.filter.subtypes).toEqual(['Assembly-Worker']);
    expect(sl.destination).toBe('hand');
    expect(sl.shuffle).toBe(true);
  });

  it('emits a ShuffleLibrary effect after the SearchLibrary', () => {
    const p = parseOracleText(ASSEMBLER_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    expect(p.ability.effects.some(e => e.kind === 'ShuffleLibrary')).toBe(true);
  });

  it('executes: fetches an Assembly-Worker card to hand, ignoring non-subtypes', () => {
    const p = parseOracleText(ASSEMBLER_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    // nonWorker listed first to prove subtype filtering is real.
    const s = executeEffects(
      libState(['nonWorker', 'redCreature', 'aw1', 'aw2']),
      p.ability.effects,
      'p0', [], [],
    );
    expect(inZone(s, 'hand')).toContain('aw1');
    // Non-assembly-worker cards must stay in library.
    expect(inZone(s, 'library')).toContain('nonWorker');
    expect(inZone(s, 'library')).toContain('redCreature');
  });

  it('executes: no match found leaves library unchanged', () => {
    const p = parseOracleText(ASSEMBLER_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    const s = executeEffects(
      libState(['nonWorker', 'redCreature']),
      p.ability.effects,
      'p0', [], [],
    );
    expect(inZone(s, 'hand')).toEqual([]);
    expect(inZone(s, 'library').sort()).toEqual(['nonWorker', 'redCreature'].sort());
  });
});

// =============================================================================
// (C) "library and/or graveyard" dual-zone named card — Sun-Blessed Mount style
// =============================================================================

const SUNBLESSED_TEXT = 'When this creature enters, you may search your library and/or graveyard for a card named Arcane Signet, reveal it, put it into your hand, then shuffle.';

describe('Slice 12 ETB tutor: library and/or graveyard named card (Sun-Blessed Mount)', () => {
  it('parses as ETB with names filter and searchGraveyard=true', () => {
    const p = parseOracleText(SUNBLESSED_TEXT);
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') return;
    const sl = p.ability.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.filter.names).toEqual(['Arcane Signet']);
    expect(sl.searchGraveyard).toBe(true);
    expect(sl.destination).toBe('hand');
    expect(sl.shuffle).toBe(true);
  });

  it('emits a ShuffleLibrary effect', () => {
    const p = parseOracleText(SUNBLESSED_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    expect(p.ability.effects.some(e => e.kind === 'ShuffleLibrary')).toBe(true);
  });

  it('executes: finds named card in the library', () => {
    const p = parseOracleText(SUNBLESSED_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    // Arcane Signet in library, other is not the target.
    const s = executeEffects(
      libState(['other', 'arcane']),
      p.ability.effects,
      'p0', [], [],
    );
    expect(inZone(s, 'hand')).toEqual(['arcane']);
    expect(inZone(s, 'library')).toEqual(['other']);
  });

  it('executes: finds named card in the graveyard when not in library', () => {
    const p = parseOracleText(SUNBLESSED_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    // Arcane Signet in graveyard only (library has unrelated card).
    const s = executeEffects(
      libState(['other'], ['arcane']),
      p.ability.effects,
      'p0', [], [],
    );
    expect(inZone(s, 'hand')).toEqual(['arcane']);
    // other (from library) stays in library.
    expect(inZone(s, 'library')).toEqual(['other']);
  });

  it('executes: finds named card in graveyard even when library has unrelated cards', () => {
    const p = parseOracleText(SUNBLESSED_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    // Library has unrelated cards, Arcane Signet only in graveyard.
    const s = executeEffects(
      libState(['redCreature', 'nonWorker'], ['arcane']),
      p.ability.effects,
      'p0', [], [],
    );
    expect(inZone(s, 'hand')).toEqual(['arcane']);
    // Library cards stay in library.
    expect(inZone(s, 'library')).toContain('redCreature');
    expect(inZone(s, 'library')).toContain('nonWorker');
  });

  it('executes: no named card anywhere leaves state unchanged', () => {
    const p = parseOracleText(SUNBLESSED_TEXT);
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    const s = executeEffects(
      libState(['other', 'redCreature']),
      p.ability.effects,
      'p0', [], [],
    );
    expect(inZone(s, 'hand')).toEqual([]);
  });
});

// =============================================================================
// Honesty: variants that should NOT parse via the new matcher
// =============================================================================

describe('Slice 12 ETB tutor: honesty and non-overlap guards', () => {
  it('legendary prefix still routes to matchSearchLibraryGeneric (not the new matcher)', () => {
    // matchETBTutorFilterExtensions explicitly returns null for "legendary" prefix,
    // so matchSearchLibraryGeneric handles "a legendary creature card".
    const p = parseOracleText('When this creature enters, search your library for a legendary creature card, put it onto the battlefield, then shuffle.');
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    const sl = p.ability.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.filter.supertypes).toEqual(['Legendary']);
    expect(sl.destination).toBe('battlefield');
  });

  it('plain green creature card without nonlegendary parses via matchSearchLibraryGeneric', () => {
    const p = parseOracleText('Search your library for a green creature card, put it onto the battlefield, then shuffle.');
    // Should parse via matchSearchLibraryGeneric or matchETBTutorFilterExtensions.
    // The important thing: it parses and has a green creature filter.
    const effects = p.kind === 'Spell' ? p.effects : (p.kind === 'ETB' ? p.ability.effects : []);
    const sl = effects.find((e: any) => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.filter.colors).toContain('G');
    expect(sl.filter.types).toContain('creature');
  });
});
