/**
 * Slice 9: RevealTopSplitTwoPiles — reveal-top-N, controller separates into two piles,
 * an opponent chooses one pile.
 *
 * New matcher: matchRevealTopSplitTwoPiles (in matchers/search-dig.ts)
 * New AST type: RevealTopSplitTwoPilesEffect
 * New executor case: 'RevealTopSplitTwoPiles'
 *
 * Covered oracle forms:
 *  - Steam Augury: inline "and separate them into two piles" form
 *  - Fact-or-Fiction: two-sentence "Separate them into two piles." form
 *  - Inverted destinations (opponent-chosen pile to graveyard, other to hand)
 *
 * Declined (kept Unparsed):
 *  - Truth or Tale: "Put a card from that pile into your hand and the rest into your graveyard."
 *    (only one card from chosen pile → hand requires nested card choice)
 *  - Portent of Calamity: "For each card type, you may exile a card of that type…"
 *    (per-type conditional exile with no pile split — different family entirely)
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealTopSplitTwoPilesEffect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ─── helpers ─────────────────────────────────────────────────────────────────

const BASE_DEF: Omit<CardDefinition, 'id' | 'name' | 'cmc'> = {
  type_line: 'Instant',
  oracle_text: '',
  mana_cost: '{U}',
  colors: ['U'],
  color_identity: ['U'],
  keywords: [],
  card_types: ['instant'],
};

function makeState(libraryCards: { id: string; name: string; cmc: number }[]): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  for (const { id, name, cmc } of libraryCards) {
    cardDefinitions.set(id, { ...BASE_DEF, id, name, cmc } as CardDefinition);
    cards.set(id, {
      instanceId: id,
      definitionId: id,
      ownerId: 'p1',
      zone: 'library',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    } as CardInstance);
  }

  const players = ['p1', 'p2'].map((pid, idx) => ({
    id: pid,
    name: pid,
    life: 20,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: idx === 0,
    hasLost: false,
  }));

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
  } as GameState;
}

function zone(state: GameState, id: string) {
  return state.cards.get(id)!.zone;
}

// ─── parser tests ─────────────────────────────────────────────────────────────

describe('slice9-reveal-top-split-two-piles: parser', () => {
  it('parses Steam Augury inline form (hand/graveyard)', () => {
    const text =
      'Reveal the top five cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0] as RevealTopSplitTwoPilesEffect;
    expect(e.kind).toBe('RevealTopSplitTwoPiles');
    expect(e.count).toBe(5);
    expect(e.pileChosenDestination).toBe('hand');
    expect(e.pileOtherDestination).toBe('graveyard');
  });

  it('parses Fact-or-Fiction two-sentence form (hand/graveyard)', () => {
    const text =
      'Reveal the top five cards of your library. ' +
      'Separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0] as RevealTopSplitTwoPilesEffect;
    expect(e.kind).toBe('RevealTopSplitTwoPiles');
    expect(e.count).toBe(5);
    expect(e.pileChosenDestination).toBe('hand');
    expect(e.pileOtherDestination).toBe('graveyard');
  });

  it('parses inverted destinations (opponent-chosen pile to graveyard, other to hand)', () => {
    const text =
      'Reveal the top four cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your graveyard and the other into your hand.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0] as RevealTopSplitTwoPilesEffect;
    expect(e.kind).toBe('RevealTopSplitTwoPiles');
    expect(e.count).toBe(4);
    expect(e.pileChosenDestination).toBe('graveyard');
    expect(e.pileOtherDestination).toBe('hand');
  });

  it('parses three-card variant', () => {
    const text =
      'Reveal the top three cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0] as RevealTopSplitTwoPilesEffect;
    expect(e.kind).toBe('RevealTopSplitTwoPiles');
    expect(e.count).toBe(3);
  });

  it('does NOT match single-card matchRevealTopDistribute wording ("one of them" not "those piles")', () => {
    // This is the Murmurs from Beyond wording — single-card form handled by matchRevealTopDistribute.
    const text =
      'Reveal the top three cards of your library. ' +
      'An opponent chooses one. ' +
      'Put that card into your graveyard and the rest into your hand.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    // Should parse as RevealTopDistribute, NOT RevealTopSplitTwoPiles.
    expect(p.effects[0].kind).toBe('RevealTopDistribute');
  });

  it('Truth or Tale "a card from that pile" variant remains Unparsed (nested card choice)', () => {
    // Truth or Tale: "Put a card from that pile into your hand and the rest into your graveyard."
    // The executor cannot run a nested card-choice-within-a-pile, so this is correctly declined.
    const text =
      'Reveal the top five cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put a card from that pile into your hand and the rest into your graveyard.';
    const p = parseOracleText(text);
    // "Put a card from that pile" does not match our "put that pile" gate — remains Unparsed.
    expect(p.kind).toBe('Unparsed');
  });
});

// ─── executor tests ───────────────────────────────────────────────────────────

describe('slice9-reveal-top-split-two-piles: executor', () => {
  it('AI fallback: lower-MV cards to pile A, opponent picks pile B (higher MV) → hand', () => {
    // Library top 5 (in order): cmc 1, 3, 5, 2, 4
    // Sorted ascending: 1,2,3,4,5 → lower half (indices 0..1) → pile A = cmc 1,2
    // Upper half = pile B = cmc 3,4,5
    // Opponent AI picks pile B → pileChosenDestination = 'hand'
    // Pile A (unchosen) → pileOtherDestination = 'graveyard'
    const state = makeState([
      { id: 'c1', name: 'Cheap1',    cmc: 1 },
      { id: 'c3', name: 'Moderate1', cmc: 3 },
      { id: 'c5', name: 'Costly1',   cmc: 5 },
      { id: 'c2', name: 'Cheap2',    cmc: 2 },
      { id: 'c4', name: 'Moderate2', cmc: 4 },
    ]);

    const text =
      'Reveal the top five cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    const result = executeEffects(state, p.effects, 'p1', [], [], 0);

    // Lower half (cmc 1,2) → pile A (unchosen) → graveyard
    expect(zone(result, 'c1')).toBe('graveyard');
    expect(zone(result, 'c2')).toBe('graveyard');
    // Upper half (cmc 3,4,5) → pile B (chosen by opponent) → hand
    expect(zone(result, 'c3')).toBe('hand');
    expect(zone(result, 'c4')).toBe('hand');
    expect(zone(result, 'c5')).toBe('hand');
  });

  it('explicit pile split + opponent chooses A → hand', () => {
    // Controller splits: pile A = [c1, c3], pile B = [c2, c4, c5]
    // Opponent explicitly picks pile A → hand; pile B → graveyard
    const state = makeState([
      { id: 'c1', name: 'Alpha',   cmc: 1 },
      { id: 'c2', name: 'Beta',    cmc: 2 },
      { id: 'c3', name: 'Gamma',   cmc: 3 },
      { id: 'c4', name: 'Delta',   cmc: 4 },
      { id: 'c5', name: 'Epsilon', cmc: 5 },
    ]);

    const text =
      'Reveal the top five cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    const result = executeEffects(state, p.effects, 'p1', [], [], 0, {
      namedCardChoices: {
        pileSplitIds: 'c1,c3',   // pile A = c1, c3
        opponentChosenPile: 'A', // opponent picks pile A
      },
    });

    // Pile A (chosen) → hand
    expect(zone(result, 'c1')).toBe('hand');
    expect(zone(result, 'c3')).toBe('hand');
    // Pile B (unchosen) → graveyard
    expect(zone(result, 'c2')).toBe('graveyard');
    expect(zone(result, 'c4')).toBe('graveyard');
    expect(zone(result, 'c5')).toBe('graveyard');
  });

  it('explicit pile split + opponent chooses B → hand', () => {
    const state = makeState([
      { id: 'c1', name: 'Alpha',   cmc: 1 },
      { id: 'c2', name: 'Beta',    cmc: 2 },
      { id: 'c3', name: 'Gamma',   cmc: 3 },
    ]);

    const text =
      'Reveal the top three cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    const result = executeEffects(state, p.effects, 'p1', [], [], 0, {
      namedCardChoices: {
        pileSplitIds: 'c1',       // pile A = c1
        opponentChosenPile: 'B',  // opponent picks pile B
      },
    });

    // Pile B (c2, c3) chosen → hand
    expect(zone(result, 'c2')).toBe('hand');
    expect(zone(result, 'c3')).toBe('hand');
    // Pile A (c1) unchosen → graveyard
    expect(zone(result, 'c1')).toBe('graveyard');
  });

  it('no-op when library is empty', () => {
    const state = makeState([]);
    const text =
      'Reveal the top five cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    const result = executeEffects(state, p.effects, 'p1', [], [], 0);
    expect(result).toBe(state);
  });

  it('partial reveal when library has fewer than N cards', () => {
    // Library only has 2 cards but N=5; reveals both, splits into empty+full piles.
    const state = makeState([
      { id: 'c1', name: 'Alpha', cmc: 1 },
      { id: 'c2', name: 'Beta',  cmc: 3 },
    ]);

    const text =
      'Reveal the top five cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    // AI split: sorted [c1(1), c2(3)] → lower half (1 card) = pile A = c1; pile B = c2
    // Opponent AI picks pile B → hand
    const result = executeEffects(state, p.effects, 'p1', [], [], 0);
    expect(zone(result, 'c1')).toBe('graveyard'); // pile A unchosen
    expect(zone(result, 'c2')).toBe('hand');       // pile B chosen
  });

  it('inverted destinations: opponent-chosen pile goes to graveyard', () => {
    const state = makeState([
      { id: 'c1', name: 'Alpha', cmc: 2 },
      { id: 'c2', name: 'Beta',  cmc: 4 },
    ]);

    const text =
      'Reveal the top two cards of your library and separate them into two piles. ' +
      'An opponent chooses one of those piles. ' +
      'Put that pile into your graveyard and the other into your hand.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    // AI split: pile A = [c1 cmc=2], pile B = [c2 cmc=4]
    // Opponent AI picks pile B → pileChosenDestination = 'graveyard'
    // Pile A → pileOtherDestination = 'hand'
    const result = executeEffects(state, p.effects, 'p1', [], [], 0);
    expect(zone(result, 'c1')).toBe('hand');      // pile A unchosen → hand
    expect(zone(result, 'c2')).toBe('graveyard'); // pile B chosen → graveyard
  });
});
