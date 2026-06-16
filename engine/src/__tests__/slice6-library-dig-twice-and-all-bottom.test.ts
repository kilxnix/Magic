/**
 * Slice 6/12 oracle-parser coverage tests:
 * Library-dig leftovers — "Look at top N, put one into hand, rest on bottom"
 * sub-family.
 *
 * New matchers:
 *   - matchLookAtTopTwiceNumberOfToHand: "Look at the top X cards of your
 *     library, where X is twice the number of lands you control. Put one of
 *     them into your hand and the rest on the bottom of your library in any
 *     order." (Pillage the Bog family). Uses ForEachAmount.multiplier=2.
 *
 *   - matchLookAtTopAllOnBottom: "Look at the top N cards of your library.
 *     Put those cards / them / all of them on the bottom of your library in
 *     any order." (Lim-Dûl's Vault style — all revealed cards go on bottom).
 *
 * Also verifies that extending parseWordNumber to recognise number-words up
 * to "twenty" allows existing matchers (matchDigTopTakeRest, etc.) to handle
 * "Look at the top twenty cards of your library. Put one of them into your
 * hand and the rest on the bottom in a random order." (Thunderous Debut style).
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Shared card definitions
// ---------------------------------------------------------------------------
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
const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};
const axe: CardDefinition = {
  id: 'axe', name: 'Axe', type_line: 'Artifact — Equipment',
  oracle_text: '', mana_cost: '{2}', cmc: 2, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const ALL_DEFS = new Map<string, CardDefinition>([
  ['bear', bear], ['bolt', bolt], ['forest', forest], ['axe', axe],
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

function makeState(
  libraryDefs: string[],
  battlefieldLandCount = 0,
  libraryOwner = 'p0',
): GameState {
  const cards = new Map<string, CardInstance>();
  libraryDefs.forEach((defId, i) => {
    cards.set(`lib${i}`, makeInstance(`lib${i}`, defId, 'library', libraryOwner));
  });
  // Add battlefield lands for "twice the number of lands you control" tests
  for (let i = 0; i < battlefieldLandCount; i++) {
    cards.set(`bfLand${i}`, makeInstance(`bfLand${i}`, 'forest', 'battlefield'));
  }
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
// 1. matchLookAtTopTwiceNumberOfToHand — Pillage the Bog style
// ---------------------------------------------------------------------------

describe('Slice 6/12 — matchLookAtTopTwiceNumberOfToHand (Pillage the Bog family)', () => {
  // Pillage the Bog oracle text (representative wording):
  const PILLAGE_TEXT =
    'Look at the top X cards of your library, where X is twice the number of lands you control. ' +
    'Put one of them into your hand and the rest on the bottom of your library in any order.';

  it('parses to Spell with ChooseFromTopOfLibrary, ForEach multiplier=2, maxSelections=1', () => {
    const p = parseOracleText(PILLAGE_TEXT, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);

    // Count should be a ForEachAmount with multiplier=2
    expect(typeof e.count).toBe('object');
    const count = e.count as { kind: string; multiplier?: number };
    expect(count.kind).toBe('ForEach');
    expect(count.multiplier).toBe(2);

    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.maxSelections).toBe(1);
    expect(e.minSelections).toBe(1);
  });

  it('execution with 3 lands: looks at top 6, puts first into hand, rest on bottom', () => {
    // 3 lands on battlefield → X = twice 3 = 6 cards revealed
    // Library has 8 cards; top 6 are revealed, 1 goes to hand, 5 go to bottom
    const p = parseOracleText(PILLAGE_TEXT, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library: bear, bolt, forest, axe, bear, bolt, forest, axe (8 cards)
    const s0 = makeState(
      ['bear', 'bolt', 'forest', 'axe', 'bear', 'bolt', 'forest', 'axe'],
      3, // 3 battlefield lands → X = 6
    );
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // 1 card to hand (the first revealed card: lib0)
    expect(zoneIds(s1, 'hand')).toHaveLength(1);
    expect(zoneIds(s1, 'hand')).toContain('lib0');
    // 5 revealed cards go to bottom of library (still zone='library')
    // plus 2 unrevealed = 7 total in library
    expect(zoneIds(s1, 'library')).toHaveLength(7);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('execution with 0 lands: X=0, nothing revealed, state unchanged', () => {
    const p = parseOracleText(PILLAGE_TEXT, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // No battlefield lands → X = 0
    const s0 = makeState(['bear', 'bolt', 'forest'], 0);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // X=0 → reveals 0 cards → nothing moves
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
    expect(zoneIds(s1, 'library')).toHaveLength(3);
  });

  it('also handles "rest into your graveyard" variant', () => {
    const TEXT_GY =
      'Look at the top X cards of your library, where X is twice the number of lands you control. ' +
      'Put one of them into your hand and the rest into your graveyard.';
    const p = parseOracleText(TEXT_GY, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error();
    expect(e.restDestination).toBe('graveyard');
  });
});

// ---------------------------------------------------------------------------
// 2. matchLookAtTopAllOnBottom — Lim-Dûl's Vault style
// ---------------------------------------------------------------------------

describe('Slice 6/12 — matchLookAtTopAllOnBottom (Lim-Dûl\'s Vault style)', () => {
  // Lim-Dûl's Vault style: look at top five cards, put ALL of them on the bottom
  const LDV_TEXT =
    'Look at the top five cards of your library. Put those cards on the bottom of your library in any order.';

  it('parses to Spell with ChooseFromTopOfLibrary, count=5, maxSelections=0, restDestination=bottom', () => {
    const p = parseOracleText(LDV_TEXT, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toBe(5);
    expect(e.destination).toBe('hand');      // unused (maxSelections=0)
    expect(e.restDestination).toBe('bottom'); // all go to bottom
    expect(e.maxSelections).toBe(0);
    expect(e.minSelections).toBe(0);
    expect(e.fallbackSelectionCount).toBe(0);
  });

  it('execution: all five revealed cards go to bottom of library', () => {
    const p = parseOracleText(LDV_TEXT, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library: 7 cards; top 5 are looked at, all 5 go to bottom, 2 untouched
    const s0 = makeState(['bear', 'bolt', 'forest', 'axe', 'bear', 'bolt', 'forest']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // All 5 revealed cards stay in library (bottomed), 2 unrevealed remain
    expect(zoneIds(s1, 'library')).toHaveLength(7);
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('also parses "Put them on the bottom of your library in any order" phrasing', () => {
    const TEXT_THEM =
      'Look at the top three cards of your library. Put them on the bottom of your library in any order.';
    const p = parseOracleText(TEXT_THEM, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error();
    expect(e.count).toBe(3);
    expect(e.maxSelections).toBe(0);
    expect(e.restDestination).toBe('bottom');
  });

  it('also parses "Put all of them on the bottom of your library in any order" phrasing', () => {
    const TEXT_ALL =
      'Look at the top four cards of your library. Put all of them on the bottom of your library in any order.';
    const p = parseOracleText(TEXT_ALL, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error();
    expect(e.count).toBe(4);
    expect(e.maxSelections).toBe(0);
  });

  it('execution: "Put them on the bottom" with 3-card library subset', () => {
    const TEXT_THEM =
      'Look at the top three cards of your library. Put them on the bottom of your library in any order.';
    const p = parseOracleText(TEXT_THEM, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(['bear', 'bolt', 'forest', 'axe']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // All 3 revealed go to bottom; 1 untouched stays on top
    expect(zoneIds(s1, 'library')).toHaveLength(4);
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. parseWordNumber extended — "twenty" (Thunderous Debut style)
// ---------------------------------------------------------------------------

describe('Slice 6/12 — parseWordNumber extended to twenty (Thunderous Debut style)', () => {
  // Thunderous Debut style: "Look at the top twenty cards of your library.
  // Put one of them into your hand and the rest on the bottom in a random order."
  //
  // NOTE: The "look at top N (fixed), put one into hand, rest on bottom" family
  // is parsed by matchLookAtTopPutOneIntoHand → SearchLibrary effect (with
  // topCount=N), which is the existing correct behavior. The extend of
  // parseWordNumber to support "twelve"..."twenty" means that these higher-count
  // variants now parse successfully (previously Unparsed). The effect kind for
  // this exact shape is SearchLibrary with topCount set.
  const DEBUT_TEXT =
    'Look at the top twenty cards of your library. ' +
    'Put one of them into your hand and the rest on the bottom of your library in a random order.';

  it('parses "twenty" in "top twenty cards" to a Spell (not Unparsed)', () => {
    const p = parseOracleText(DEBUT_TEXT, false);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    // matchLookAtTopPutOneIntoHand claims this → SearchLibrary with topCount=20
    expect(e.kind).toBe('SearchLibrary');
    if (e.kind !== 'SearchLibrary') throw new Error('expected SearchLibrary, got ' + e.kind);
    expect(e.topCount).toBe(20);
    expect(e.destination).toBe('hand');
    expect(e.putUnselectedTopCardsOnBottom).toBe(true);
  });

  it('execution with 5-card library: reveals top 5 (min of 20 and 5), puts 1 in hand, 4 on bottom', () => {
    const p = parseOracleText(DEBUT_TEXT, false);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(['bear', 'bolt', 'forest', 'axe', 'bear']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // Executor searches top min(20,5)=5 cards; takes the best match (first), puts rest on bottom
    expect(zoneIds(s1, 'hand')).toHaveLength(1);
    expect(zoneIds(s1, 'library')).toHaveLength(4);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('parses "twelve" in "top twelve cards" with "put one into hand" to Spell', () => {
    const TEXT12 =
      'Look at the top twelve cards of your library. ' +
      'Put one of them into your hand and the rest on the bottom of your library in any order.';
    const p12 = parseOracleText(TEXT12, false);
    expect(p12.kind).toBe('Spell');
    if (p12.kind !== 'Spell') throw new Error('expected Spell');
    const e12 = p12.effects[0];
    // matchLookAtTopPutOneIntoHand handles this shape → SearchLibrary with topCount=12
    expect(e12.kind).toBe('SearchLibrary');
    if (e12.kind !== 'SearchLibrary') throw new Error();
    expect(e12.topCount).toBe(12);
    expect(e12.putUnselectedTopCardsOnBottom).toBe(true);
  });

  it('parses "fifteen" in "top fifteen cards" with "put any number" to ChooseFromTopOfLibrary', () => {
    // "put any number of them" → matchLookAtTopAnyNumberToHand → ChooseFromTopOfLibrary
    const TEXT15 =
      'Look at the top fifteen cards of your library. ' +
      'Put any number of them into your hand and the rest on the bottom of your library in any order.';
    const p15 = parseOracleText(TEXT15, false);
    expect(p15.kind).toBe('Spell');
    if (p15.kind !== 'Spell') throw new Error('expected Spell');
    const e15 = p15.effects[0];
    expect(e15.kind).toBe('ChooseFromTopOfLibrary');
    if (e15.kind !== 'ChooseFromTopOfLibrary') throw new Error();
    expect(e15.count).toBe(15);
    expect(e15.restDestination).toBe('bottom');
  });
});
