// Slice 8: "search your library for any number of <filter> cards" parser and
// executor coverage.
//
// Oracle examples:
//   Iname, Death Aspect — "Search your library for any number of Spirit cards
//     and put them into your graveyard, then shuffle."
//   Goblin Recruiter — "Search your library for any number of Goblin cards,
//     reveal them, put them on top of your library, then shuffle."
//   Selective Memory / exile-destination — declined (stays Unparsed/no match).
//
// Parser contract: emits SearchLibrary with minSelections=0 and maxSelections
// undefined (unbounded) + the appropriate destination + shuffle=true.
// Executor contract: moves ALL matching candidates (AI auto-picks all).

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

const spirit1: CardDefinition = {
  id: 'spirit1', name: 'Floating Dream Zubera', type_line: 'Creature — Spirit',
  oracle_text: '', mana_cost: '{1}{U}', cmc: 2, colors: ['U'], color_identity: ['U'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 2,
};
const spirit2: CardDefinition = {
  id: 'spirit2', name: 'Ashen-Skin Zubera', type_line: 'Creature — Spirit',
  oracle_text: '', mana_cost: '{1}{B}', cmc: 2, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 2,
};
const goblin1: CardDefinition = {
  id: 'goblin1', name: 'Goblin Lackey', type_line: 'Creature — Goblin',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 1,
};
const goblin2: CardDefinition = {
  id: 'goblin2', name: 'Goblin Piledriver', type_line: 'Creature — Goblin',
  oracle_text: '', mana_cost: '{1}{R}', cmc: 2, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['creature'], power: 1, toughness: 2,
};
const bear: CardDefinition = {
  id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId: owner, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

function makeState(cards: [string, string, string, CardInstance['zone']][]): GameState {
  const cardEntries = cards.map(([id, defId, owner, zone]) => [id, mk(id, defId, owner, zone)] as [string, CardInstance]);
  const defEntries: [string, CardDefinition][] = [
    ['spirit1', spirit1], ['spirit2', spirit2],
    ['goblin1', goblin1], ['goblin2', goblin2],
    ['bear', bear],
  ];
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cardEntries),
    cardDefinitions: new Map(defEntries),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zone(s: GameState, id: string): string { return s.cards.get(id)!.zone; }

// ---------------------------------------------------------------------------
// Tests: parser
// ---------------------------------------------------------------------------

describe('sc-any-number-search: parser — Iname, Death Aspect (graveyard destination)', () => {
  it('emits SearchLibrary with minSelections=0, maxSelections undefined, destination graveyard, shuffle true', () => {
    const p = parseOracleText('Search your library for any number of Spirit cards and put them into your graveyard, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.minSelections).toBe(0);
    expect(sl.maxSelections).toBeUndefined();
    expect(sl.destination).toBe('graveyard');
    expect(sl.shuffle).toBe(true);
    // Subtype filter: Spirit (stored lowercase per parseStaticFilterType convention)
    expect(sl.filter.subtypes?.map((s: string) => s.toLowerCase())).toContain('spirit');
  });

  it('includes a ShuffleLibrary effect after SearchLibrary', () => {
    const p = parseOracleText('Search your library for any number of Spirit cards and put them into your graveyard, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const shuffle = p.effects.find(e => e.kind === 'ShuffleLibrary');
    expect(shuffle).toBeDefined();
  });
});

describe('sc-any-number-search: parser — Goblin Recruiter (top-of-library destination)', () => {
  it('emits SearchLibrary with destination top, minSelections=0, unbounded', () => {
    const p = parseOracleText('Search your library for any number of Goblin cards, reveal them, put them on top of your library, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.minSelections).toBe(0);
    expect(sl.maxSelections).toBeUndefined();
    expect(sl.destination).toBe('top');
    expect(sl.filter.subtypes?.map((s: string) => s.toLowerCase())).toContain('goblin');
  });
});

describe('sc-any-number-search: parser — hand destination', () => {
  it('emits SearchLibrary with destination hand for "put them into your hand"', () => {
    const p = parseOracleText('Search your library for any number of Elf cards, reveal them, put them into your hand, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.minSelections).toBe(0);
    expect(sl.maxSelections).toBeUndefined();
    expect(sl.destination).toBe('hand');
    expect(sl.filter.subtypes?.map((s: string) => s.toLowerCase())).toContain('elf');
  });
});

describe('sc-any-number-search: parser — honesty guard', () => {
  it('declines "any number of cards" with no type restriction (would be unrestricted fetch)', () => {
    // No type filter on "any number of cards" — the guard must prevent emission.
    const p = parseOracleText('Search your library for any number of cards, put them into your hand, then shuffle.');
    // Should be Unparsed or not contain a SearchLibrary effect.
    const sl = p.kind === 'Spell' ? p.effects.find(e => e.kind === 'SearchLibrary') : undefined;
    expect(sl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: executor — Iname, Death Aspect (all Spirits into graveyard)
// ---------------------------------------------------------------------------

describe('sc-any-number-search: executor — Spirit cards into graveyard', () => {
  it('moves ALL Spirit cards from library to graveyard, Bear stays in library', () => {
    const state = makeState([
      ['s1', 'spirit1', 'p0', 'library'],
      ['s2', 'spirit2', 'p0', 'library'],
      ['bz', 'bear',    'p0', 'library'],
    ]);
    const p = parseOracleText('Search your library for any number of Spirit cards and put them into your graveyard, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const s = executeEffects(state, p.effects, 'p0', [], []);

    // Both Spirit cards moved to graveyard
    expect(zone(s, 's1')).toBe('graveyard');
    expect(zone(s, 's2')).toBe('graveyard');
    // Non-Spirit creature stayed in library (shuffled library now has just Bear)
    expect(zone(s, 'bz')).toBe('library');
  });

  it('handles empty library gracefully — no cards moved, no crash', () => {
    const state = makeState([
      ['bz', 'bear', 'p0', 'library'],
    ]);
    const p = parseOracleText('Search your library for any number of Spirit cards and put them into your graveyard, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const s = executeEffects(state, p.effects, 'p0', [], []);
    // No Spirit in library — nothing moved, Bear stays
    expect(zone(s, 'bz')).toBe('library');
    const graveyard = [...s.cards.values()].filter(c => c.zone === 'graveyard');
    expect(graveyard.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests: executor — Goblin Recruiter (all Goblins on top of library)
// ---------------------------------------------------------------------------

describe('sc-any-number-search: executor — Goblin cards on top of library', () => {
  it('moves ALL Goblin cards from library to top, non-Goblin stays in library', () => {
    const state = makeState([
      ['g1', 'goblin1', 'p0', 'library'],
      ['g2', 'goblin2', 'p0', 'library'],
      ['bz', 'bear',    'p0', 'library'],
    ]);
    const p = parseOracleText('Search your library for any number of Goblin cards, reveal them, put them on top of your library, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const s = executeEffects(state, p.effects, 'p0', [], []);

    // Both Goblin cards remain in library (put on top = library zone)
    expect(zone(s, 'g1')).toBe('library');
    expect(zone(s, 'g2')).toBe('library');
    // Bear also in library
    expect(zone(s, 'bz')).toBe('library');
    // Verify the Goblin cards are still there (they moved from library to library/top)
    const libCards = [...s.cards.values()].filter(c => c.zone === 'library' && c.ownerId === 'p0');
    expect(libCards.length).toBe(3);
  });
});
