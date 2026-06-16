/**
 * Slice 9/12: RevealTopDistribute — reveal-top-N, opponent chooses one
 *
 * New matcher: matchRevealTopDistribute
 * New AST type: RevealTopDistributeEffect
 * New executor case: 'RevealTopDistribute'
 *
 * Covered cards:
 *  - Murmurs from Beyond: "Reveal the top three cards of your library.
 *    An opponent chooses one. Put that card into your graveyard and the rest
 *    into your hand."
 *  - Inverse wording (chosen to hand, rest to graveyard)
 *  - "of them" variant: "An opponent chooses one of them."
 *
 * Declined (kept Unparsed):
 *  - Steam Augury / Fact-or-Fiction two-pile form ("separate them into two piles")
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { RevealTopDistributeEffect } from '../effects/ast';
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

describe('slice9-reveal-top-distribute: parser', () => {
  it('parses Murmurs from Beyond wording (graveyard/hand)', () => {
    const text =
      'Reveal the top three cards of your library. An opponent chooses one. Put that card into your graveyard and the rest into your hand.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0] as RevealTopDistributeEffect;
    expect(e.kind).toBe('RevealTopDistribute');
    expect(e.count).toBe(3);
    expect(e.chosenDestination).toBe('graveyard');
    expect(e.restDestination).toBe('hand');
  });

  it('parses inverse wording (chosen to hand, rest to graveyard)', () => {
    const text =
      'Reveal the top two cards of your library. An opponent chooses one. Put that card into your hand and the rest into your graveyard.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0] as RevealTopDistributeEffect;
    expect(e.kind).toBe('RevealTopDistribute');
    expect(e.count).toBe(2);
    expect(e.chosenDestination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
  });

  it('parses "An opponent chooses one of them." variant', () => {
    const text =
      'Reveal the top five cards of your library. An opponent chooses one of them. Put that card into your graveyard and the rest into your hand.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0] as RevealTopDistributeEffect;
    expect(e.kind).toBe('RevealTopDistribute');
    expect(e.count).toBe(5);
    expect(e.chosenDestination).toBe('graveyard');
    expect(e.restDestination).toBe('hand');
  });

  it('two-pile Steam Augury form now parses as RevealTopSplitTwoPiles (Slice 9 added two-pile support)', () => {
    const text =
      'Reveal the top five cards of your library and separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    // Now handled by matchRevealTopSplitTwoPiles — no longer Unparsed.
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0].kind).toBe('RevealTopSplitTwoPiles');
  });

  it('two-sentence Fact-or-Fiction form now parses as RevealTopSplitTwoPiles (Slice 9 added two-pile support)', () => {
    const text =
      'Reveal the top five cards of your library. Separate them into two piles. An opponent chooses one of those piles. Put that pile into your hand and the other into your graveyard.';
    const p = parseOracleText(text);
    // Now handled by matchRevealTopSplitTwoPiles — no longer Unparsed.
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects[0].kind).toBe('RevealTopSplitTwoPiles');
  });
});

// ─── executor tests ───────────────────────────────────────────────────────────

describe('slice9-reveal-top-distribute: executor', () => {
  it('AI fallback: puts highest-MV card into graveyard, rest into hand (Murmurs from Beyond)', () => {
    // Library: [card-1 (cmc=4), card-2 (cmc=2), card-3 (cmc=1), card-4 (cmc=3)]
    // Reveal top 3: card-1, card-2, card-3
    // AI picks highest-MV = card-1 (cmc=4) to graveyard; card-2 and card-3 to hand
    const state = makeState([
      { id: 'card-1', name: 'Expensive', cmc: 4 },
      { id: 'card-2', name: 'Medium', cmc: 2 },
      { id: 'card-3', name: 'Cheap', cmc: 1 },
      { id: 'card-4', name: 'Leftover', cmc: 3 },
    ]);

    const text =
      'Reveal the top three cards of your library. An opponent chooses one. Put that card into your graveyard and the rest into your hand.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    const result = executeEffects(state, p.effects, 'p1', [], [], 0);

    expect(zone(result, 'card-1')).toBe('graveyard');  // chosen (highest MV)
    expect(zone(result, 'card-2')).toBe('hand');        // rest
    expect(zone(result, 'card-3')).toBe('hand');        // rest
    expect(zone(result, 'card-4')).toBe('library');     // not revealed
  });

  it('explicit opponent choice: puts named card into graveyard, rest into hand', () => {
    const state = makeState([
      { id: 'c1', name: 'Alpha', cmc: 3 },
      { id: 'c2', name: 'Beta', cmc: 5 },
      { id: 'c3', name: 'Gamma', cmc: 1 },
    ]);

    const text =
      'Reveal the top three cards of your library. An opponent chooses one. Put that card into your graveyard and the rest into your hand.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    // Opponent explicitly picks c1 (not the highest-MV one)
    const result = executeEffects(state, p.effects, 'p1', [], [], 0, {
      namedCardChoices: { opponentChosenCardId: 'c1' },
    });

    expect(zone(result, 'c1')).toBe('graveyard');  // explicitly chosen
    expect(zone(result, 'c2')).toBe('hand');        // rest
    expect(zone(result, 'c3')).toBe('hand');        // rest
  });

  it('no-op when library is empty', () => {
    const state = makeState([]);
    const text =
      'Reveal the top three cards of your library. An opponent chooses one. Put that card into your graveyard and the rest into your hand.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');
    const result = executeEffects(state, p.effects, 'p1', [], [], 0);
    expect(result).toBe(state); // no change
  });

  it('inverse wording: AI puts highest-MV into hand, rest into graveyard', () => {
    const state = makeState([
      { id: 'x1', name: 'Costly', cmc: 6 },
      { id: 'x2', name: 'Cheap', cmc: 1 },
    ]);

    const text =
      'Reveal the top two cards of your library. An opponent chooses one. Put that card into your hand and the rest into your graveyard.';
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('not a spell');

    const result = executeEffects(state, p.effects, 'p1', [], [], 0);

    // AI picks highest-MV card (x1, cmc=6) to hand (beneficial for caster)
    expect(zone(result, 'x1')).toBe('hand');
    expect(zone(result, 'x2')).toBe('graveyard');
  });
});
