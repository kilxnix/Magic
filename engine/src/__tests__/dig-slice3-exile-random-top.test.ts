/**
 * Tests for slice 3/12 dig additions:
 *
 *  1. matchLookAtTopExileNRestTop — Orcish Librarian family:
 *     "Look at the top N cards of your library. Exile M of them at random, then
 *      put the rest on top of your library in any order."
 *     Works as both a Spell effect AND as the body of an activated ability.
 *
 *  2. matchRevealTopTake extended restDestination='top':
 *     "Reveal the top N cards of your library. Put any number of <type> cards
 *      from among them into your hand. Put the rest on top of your library in
 *      any order."
 *
 *  3. matchDigTopTakeRest extended restDestination='top':
 *     "Look at the top N cards of your library. Put M of them into your hand
 *      and the rest on top of your library in any order."
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText, parseActivatedAbilities } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Card definitions
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
const shrine: CardDefinition = {
  id: 'shrine', name: 'Shrine', type_line: 'Enchantment',
  oracle_text: '', mana_cost: '{1}{W}', cmc: 2, colors: ['W'], color_identity: ['W'],
  keywords: [], card_types: ['enchantment'],
};
const island: CardDefinition = {
  id: 'island', name: 'Island', type_line: 'Basic Land — Island',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['U'],
  keywords: [], card_types: ['land'],
};

const DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['bear', bear], ['bolt', bolt], ['shrine', shrine], ['island', island],
]);

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

function makeInstance(instanceId: string, defId: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId, definitionId: defId, ownerId: 'p0', zone,
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
    cardDefinitions: DEFS,
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zoneIds(s: GameState, zone: CardInstance['zone']): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId);
}

// Helper that asserts the oracle text parses to a ChooseFromTopOfLibrary and
// returns that single effect.
function ctflEffect(oracle: string) {
  const p = parseOracleText(oracle);
  if (p.kind !== 'Spell') throw new Error(`expected Spell, got ${p.kind}`);
  if (p.effects.length !== 1) throw new Error(`expected 1 effect, got ${p.effects.length}`);
  const e = p.effects[0];
  if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error(`expected ChooseFromTopOfLibrary, got ${e.kind}`);
  return e;
}

// ===========================================================================
// 1. matchLookAtTopExileNRestTop — "exile N of them at random, rest on top"
// ===========================================================================

describe('matchLookAtTopExileNRestTop — exile N at random, rest on top', () => {
  // Orcish Librarian oracle text
  const ORCISH_LIBRARIAN_BODY =
    'Look at the top eight cards of your library. Exile four of them at random, then put the rest on top of your library in any order.';

  it('parses as Spell with ChooseFromTopOfLibrary (destination=exile, restDestination=top)', () => {
    const e = ctflEffect(ORCISH_LIBRARIAN_BODY);
    expect(e.count).toBe(8);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('top');
    expect(e.minSelections).toBe(4);
    expect(e.maxSelections).toBe(4);
    expect(e.fallbackSelectionCount).toBe(4);
  });

  it('exiles exactly 4 cards and puts the remaining 4 back on top (library)', () => {
    const p = parseOracleText(ORCISH_LIBRARIAN_BODY);
    if (p.kind !== 'Spell') throw new Error('not Spell');
    // Library: 8 cards. After effect: 4 exiled, 4 on top, rest unchanged.
    const s = executeEffects(
      makeState(['bear', 'bolt', 'forest', 'shrine', 'island', 'bear', 'bolt', 'forest', 'island']),
      p.effects, 'p0', [], [],
    );
    const exiled = zoneIds(s, 'exile');
    const inLib = zoneIds(s, 'library');
    // 4 exiled (the auto-fallback selects the first 4 revealed)
    expect(exiled).toHaveLength(4);
    // 4 of the top-8 go back on top; the 9th card (island) stays in library
    expect(inLib).toHaveLength(5);
    expect(zoneIds(s, 'hand')).toHaveLength(0);
    expect(zoneIds(s, 'graveyard')).toHaveLength(0);
  });

  it('parses correctly as an activated-ability body (parseActivatedAbilities)', () => {
    // Full Orcish Librarian oracle text as it would appear on a permanent
    const oracleText =
      '{R}, {T}: Look at the top eight cards of your library. Exile four of them at random, then put the rest on top of your library in any order.';
    const abilities = parseActivatedAbilities(oracleText);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effects).toHaveLength(1);
    const e = abilities[0].effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('wrong kind');
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('top');
    expect(e.minSelections).toBe(4);
    expect(e.maxSelections).toBe(4);
  });

  it('also handles "exile two of them at random, put the rest on top" (smaller counts)', () => {
    const oracle =
      'Look at the top four cards of your library. Exile two of them at random, then put the rest on top of your library in any order.';
    const e = ctflEffect(oracle);
    expect(e.count).toBe(4);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('top');
    expect(e.minSelections).toBe(2);
    expect(e.maxSelections).toBe(2);
  });
});

// ===========================================================================
// 2. matchRevealTopTake — restDestination='top' extension
// ===========================================================================

describe('matchRevealTopTake — any-number type filter with rest on top', () => {
  const TEXT =
    'Reveal the top six cards of your library. Put any number of creature cards from among them into your hand. Put the rest on top of your library in any order.';

  it('parses as ChooseFromTopOfLibrary with restDestination=top', () => {
    const e = ctflEffect(TEXT);
    expect(e.count).toBe(6);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('top');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(6);
    expect(e.filter).toEqual({ types: ['creature'] });
  });

  it('puts matching creatures into hand and non-matching cards back on top (library)', () => {
    const p = parseOracleText(TEXT);
    if (p.kind !== 'Spell') throw new Error('not Spell');
    // Top 6: bear, bolt, bear, forest, bolt, forest; plus 2 extras at bottom
    const s = executeEffects(
      makeState(['bear', 'bolt', 'bear', 'forest', 'bolt', 'forest', 'island', 'island']),
      p.effects, 'p0', [], [],
    );
    // 2 bears to hand
    expect(zoneIds(s, 'hand').sort()).toEqual(['lib0', 'lib2']);
    // 4 non-creatures back on top + 2 untouched = 6 in library
    expect(zoneIds(s, 'library')).toHaveLength(6);
    expect(zoneIds(s, 'graveyard')).toHaveLength(0);
    expect(zoneIds(s, 'exile')).toHaveLength(0);
  });
});

// ===========================================================================
// 3. matchDigTopTakeRest — restDestination='top' extension
// ===========================================================================

describe('matchDigTopTakeRest — put M into hand, rest on top', () => {
  const TEXT =
    'Look at the top five cards of your library. Put up to two of them into your hand and the rest on top of your library in any order.';

  it('parses as ChooseFromTopOfLibrary with restDestination=top', () => {
    const e = ctflEffect(TEXT);
    expect(e.count).toBe(5);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('top');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(2);
  });

  it('puts up to 2 cards into hand and returns the rest on top', () => {
    const p = parseOracleText(TEXT);
    if (p.kind !== 'Spell') throw new Error('not Spell');
    // Library top 5: bear, bolt, forest, shrine, island; 1 extra
    const s = executeEffects(
      makeState(['bear', 'bolt', 'forest', 'shrine', 'island', 'island']),
      p.effects, 'p0', [], [],
    );
    // fallback selects first 2 revealed
    expect(zoneIds(s, 'hand')).toHaveLength(2);
    // remaining 3 from top-5 go back on top of library + 1 untouched = 4 in library
    expect(zoneIds(s, 'library')).toHaveLength(4);
    expect(zoneIds(s, 'graveyard')).toHaveLength(0);
  });
});
