/**
 * Slice 6/12 oracle-parser coverage tests:
 * "Reveal/look at top N, put one/up-to-K into hand" family additions.
 *
 * New matchers:
 *   - matchRevealTopPutOneNoRest: "Reveal the top N cards of your library.
 *     Put one of them into your hand." (no explicit rest clause — the "reveal
 *     the top" form of the existing matchLookAtTopPutOneIntoHand which only
 *     handles "look at the top").
 *
 *   - matchLookAtTopRevealUpToKFilterToHand: "Look/reveal at the top N cards
 *     of your library. You may reveal up to K <type1> and/or <type2> cards
 *     from among them, then put them into your hand and the rest on the
 *     bottom/graveyard." (Zimone's Experiment style — "then put them" phrasing
 *     vs "put from among them into your hand" which matchRevealTopTakeExtended
 *     already handles).
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Shared card definitions
// ---------------------------------------------------------------------------
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};
const bear: CardDefinition = {
  id: 'bear', name: 'Bear', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};
const bolt: CardDefinition = {
  id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};
const sorcery: CardDefinition = {
  id: 'sorcery', name: 'Dark Ritual', type_line: 'Sorcery',
  oracle_text: '', mana_cost: '{B}', cmc: 1, colors: ['B'], color_identity: ['B'],
  keywords: [], card_types: ['sorcery'],
};

const ALL_DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['bear', bear], ['bolt', bolt], ['sorcery', sorcery],
]);

function makeInstance(
  instanceId: string,
  defId: string,
  zone: CardInstance['zone'],
  ownerId = 'p0',
): CardInstance {
  return {
    instanceId, definitionId: defId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeState(libraryDefs: string[]): GameState {
  const cards = new Map<string, CardInstance>();
  libraryDefs.forEach((defId, i) => {
    cards.set(`lib${i}`, makeInstance(`lib${i}`, defId, 'library'));
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards,
    cardDefinitions: ALL_DEFS,
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneIds(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId).sort();
}

// ---------------------------------------------------------------------------
// 1. matchRevealTopPutOneNoRest — "Reveal the top N cards ... Put one into hand"
//    without explicit rest clause (Memories Returning style)
// ---------------------------------------------------------------------------

describe('Slice 6/12 — matchRevealTopPutOneNoRest (Memories Returning family)', () => {
  // Memories Returning oracle text (first two sentences; the rest is opponent interaction)
  const MEMORIES_TEXT =
    'Reveal the top five cards of your library. Put one of them into your hand.';

  it('parses to Spell with SearchLibrary, topCount=5, destination=hand', () => {
    const p = parseOracleText(MEMORIES_TEXT, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('SearchLibrary');
    if (e.kind !== 'SearchLibrary') throw new Error('expected SearchLibrary');
    expect(e.topCount).toBe(5);
    expect(e.destination).toBe('hand');
    expect(e.putUnselectedTopCardsOnBottom).toBe(true);
  });

  it('execution: first revealed card goes to hand, rest stay in library (on bottom)', () => {
    const p = parseOracleText(MEMORIES_TEXT, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library has 7 cards; top 5 are revealed, first goes to hand
    const s0 = makeState(['bear', 'bolt', 'forest', 'sorcery', 'bear', 'bolt', 'forest']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // One card to hand
    expect(zoneIds(s1, 'hand')).toHaveLength(1);
    expect(zoneIds(s1, 'hand')).toContain('lib0');
    // 6 cards remain in library
    expect(zoneIds(s1, 'library')).toHaveLength(6);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('also handles "reveal the top three cards" variant', () => {
    const text = 'Reveal the top three cards of your library. Put one of them into your hand.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('SearchLibrary');
    if (e.kind !== 'SearchLibrary') throw new Error('expected SearchLibrary');
    expect(e.topCount).toBe(3);
  });

  it('does NOT grab "reveal top N put one ... put the rest" (delegated to matchDigTopTakeRest)', () => {
    // The rest-clause form is already handled by matchDigTopTakeRest; this matcher
    // returns null for it (decline gate).
    const textWithRest =
      'Reveal the top five cards of your library. Put one of them into your hand. Put the rest into your graveyard.';
    const p = parseOracleText(textWithRest, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // matchDigTopTakeRest handles this — the effect kind is ChooseFromTopOfLibrary
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
  });

  it('still handles "look at top N, put one into hand" via matchLookAtTopPutOneIntoHand', () => {
    const text = 'Look at the top five cards of your library. Put one of them into your hand.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.effects[0].kind).toBe('SearchLibrary');
  });
});

// ---------------------------------------------------------------------------
// 2. matchLookAtTopRevealUpToKFilterToHand — Zimone's Experiment style
//    "Look at top N. You may reveal up to K <type1> and/or <type2> cards
//     from among them, then put them into your hand and the rest on bottom."
// ---------------------------------------------------------------------------

describe("Slice 6/12 — matchLookAtTopRevealUpToKFilterToHand (Zimone's Experiment family)", () => {
  // Zimone's Experiment oracle text (simplified to the core dig clause)
  const ZIMONE_TEXT =
    'Look at the top five cards of your library. You may reveal up to two creature' +
    ' and/or land cards from among them, then put them into your hand and the rest' +
    ' on the bottom of your library in any order.';

  it('parses to Spell with ChooseFromTopOfLibrary, count=5, maxSelections=2, anyOf filter', () => {
    const p = parseOracleText(ZIMONE_TEXT, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(e.count).toBe(5);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.maxSelections).toBe(2);
    expect(e.minSelections).toBe(0);
    // Filter: anyOf creature OR land
    expect(e.filter).toBeDefined();
    expect(e.filter!.anyOf).toBeDefined();
    expect(e.filter!.anyOf).toHaveLength(2);
    expect(e.filter!.anyOf![0]).toEqual({ types: ['creature'] });
    expect(e.filter!.anyOf![1]).toEqual({ types: ['land'] });
  });

  it('execution: takes up to 2 creature/land cards from top 5, rests go to bottom', () => {
    const p = parseOracleText(ZIMONE_TEXT, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library top 5: bear (creature), bolt (instant), forest (land), sorcery (sorcery), bear (creature)
    // Then 2 more unrevealed cards
    const s0 = makeState(['bear', 'bolt', 'forest', 'sorcery', 'bear', 'bolt', 'forest']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // Auto-selection takes up to 2 matching (creature or land) from top 5
    // bear (creature) at lib0 → take, forest (land) at lib2 → take (or bear at lib4)
    // Up to 2 selected: lib0 and lib2 (first creature, first land)
    const hand = zoneIds(s1, 'hand');
    expect(hand).toHaveLength(2);
    // Both should be creature or land
    for (const id of hand) {
      const card = s1.cards.get(id)!;
      const def = s1.cardDefinitions.get(card.definitionId)!;
      const isCreatureOrLand = def.card_types.includes('creature') || def.card_types.includes('land');
      expect(isCreatureOrLand).toBe(true);
    }
    // Remaining cards in library = 5 (3 revealed non-matching + 2 unrevealed)
    expect(zoneIds(s1, 'library')).toHaveLength(5);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('execution: when no creature/land in top 5, all go to bottom', () => {
    const p = parseOracleText(ZIMONE_TEXT, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // All instants/sorceries in top 5
    const s0 = makeState(['bolt', 'sorcery', 'bolt', 'sorcery', 'bolt', 'bear', 'forest']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // No matches → nothing to hand, all cards stay in library
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
    expect(zoneIds(s1, 'library')).toHaveLength(7);
  });

  it('also handles "and put them" phrasing (alternative form)', () => {
    const altText =
      'Look at the top five cards of your library. You may reveal up to two creature' +
      ' and/or land cards from among them and put them into your hand. Put the rest' +
      ' on the bottom of your library in any order.';
    const p = parseOracleText(altText, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(e.count).toBe(5);
    expect(e.maxSelections).toBe(2);
    expect(e.filter!.anyOf).toHaveLength(2);
  });

  it('handles single-type variant: "up to two creature cards from among them, then put them"', () => {
    const text =
      'Look at the top six cards of your library. You may reveal up to two creature' +
      ' cards from among them, then put them into your hand. Put the rest on the' +
      ' bottom of your library in a random order.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(e.count).toBe(6);
    expect(e.maxSelections).toBe(2);
    // Single-type filter (no anyOf)
    expect(e.filter).toEqual({ types: ['creature'] });
    expect(e.restDestination).toBe('bottom');
  });

  it('handles "rest into your graveyard" destination', () => {
    const text =
      'Look at the top five cards of your library. You may reveal up to two' +
      ' instant or sorcery cards from among them, then put them into your hand.' +
      ' Put the rest into your graveyard.';
    const p = parseOracleText(text, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(e.restDestination).toBe('graveyard');
    // Filter: anyOf instant OR sorcery
    expect(e.filter!.anyOf).toBeDefined();
    expect(e.filter!.anyOf!.map(b => b.types?.[0]).sort()).toEqual(['instant', 'sorcery']);
  });

  it('execution with graveyard rest: matching cards to hand, rest to graveyard', () => {
    const text =
      'Look at the top five cards of your library. You may reveal up to two' +
      ' instant or sorcery cards from among them, then put them into your hand.' +
      ' Put the rest into your graveyard.';
    const p = parseOracleText(text, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Top 5: bolt, bear, sorcery, forest, bear
    const s0 = makeState(['bolt', 'bear', 'sorcery', 'forest', 'bear', 'bolt']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // Auto-selects up to 2 instant/sorcery: lib0 (bolt) and lib2 (sorcery)
    const hand = zoneIds(s1, 'hand');
    expect(hand).toHaveLength(2);
    for (const id of hand) {
      const def = s1.cardDefinitions.get(s1.cards.get(id)!.definitionId)!;
      const isInstSorc = def.card_types.includes('instant') || def.card_types.includes('sorcery');
      expect(isInstSorc).toBe(true);
    }
    // 3 non-matching revealed cards go to graveyard (bear, forest, bear)
    expect(zoneIds(s1, 'graveyard')).toHaveLength(3);
    // 1 unrevealed card stays in library
    expect(zoneIds(s1, 'library')).toHaveLength(1);
  });
});
