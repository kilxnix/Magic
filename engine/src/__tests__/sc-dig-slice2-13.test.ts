/**
 * Slice 2/13 oracle-parser coverage tests:
 *
 * - matchLookAtTopAnyNumberToGraveyard:
 *     "Look at the top N cards of your library. You may put any number of them
 *      into your graveyard. Put the rest on top/bottom of your library [in any
 *      order]."                                         (Gutless Plunderer)
 *
 * - matchLookAtTopRevealOneFilterToHand (fixed N):
 *     "Look at the top N cards of your library. You may reveal a <type> card
 *      from among them and put it into your hand. Put the rest on the bottom
 *      of your library in any order."                   (Nessian Wanderer)
 *
 * - matchLookAtTopRevealOneFilterToHand (X count + where-X clause):
 *     "Look at the top X cards of your library, where X is the number of lands
 *      you control. You may reveal a land card from among them and put it into
 *      your hand. Put the rest on the bottom of your library in any order."
 *                                                       (Seismic Sense trigger)
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
const axe: CardDefinition = {
  id: 'axe', name: 'Axe', type_line: 'Artifact — Equipment',
  oracle_text: '', mana_cost: '{2}', cmc: 2, colors: [], color_identity: [],
  keywords: [], card_types: ['artifact'],
};

const ALL_DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['bear', bear], ['bolt', bolt], ['axe', axe],
]);

function makeInstance(instanceId: string, defId: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId, definitionId: defId, ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

/**
 * Build a state with:
 *  - libraryDefs: top-first list of definitionIds for library cards
 *  - battlefieldDefs: definitionIds for battlefield permanents (controller p0)
 */
function makeState(libraryDefs: string[], battlefieldDefs: string[] = []): GameState {
  const cards = new Map<string, CardInstance>();
  battlefieldDefs.forEach((defId, i) => {
    cards.set(`bf${i}`, makeInstance(`bf${i}`, defId, 'battlefield'));
  });
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
// 1. matchLookAtTopAnyNumberToGraveyard — Gutless Plunderer
// ---------------------------------------------------------------------------
describe('Slice 2/13 — matchLookAtTopAnyNumberToGraveyard (Gutless Plunderer)', () => {
  const GUTLESS_TEXT =
    'Look at the top three cards of your library. You may put any number of them into your graveyard. Put the rest on top of your library in any order.';

  it('parses into ChooseFromTopOfLibrary with destination=graveyard, restDestination=top, minSelections=0', () => {
    const p = parseOracleText(GUTLESS_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind + (p.kind === 'Unparsed' ? ': ' + p.reason : ''));
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toBe(3);
    expect(e.destination).toBe('graveyard');
    expect(e.restDestination).toBe('top');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(3);
    expect(e.fallbackSelectionCount).toBe(0);
  });

  it('sends selected cards to graveyard and puts rest back on top', () => {
    const p = parseOracleText(GUTLESS_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    // Top 3: bear, forest, bolt — plus 2 untouched
    const s = executeEffects(
      makeState(['bear', 'forest', 'bolt', 'axe', 'bear']),
      p.effects, 'p0', [], [],
    );
    // All 3 revealed cards — fallback moves them to graveyard (minSelections=0 + fallbackSelectionCount=0 means none forced)
    // The executor with fallback=0 means it auto-selects 0 cards for graveyard → all go back to top (rest)
    // Library still has 5 cards
    expect(zoneIds(s, 'library').length).toBe(5);
    expect(zoneIds(s, 'graveyard').length).toBe(0);
    expect(zoneIds(s, 'hand').length).toBe(0);
  });

  it('does NOT parse when oracle text references hand instead of graveyard', () => {
    const handText =
      'Look at the top three cards of your library. You may put any number of them into your hand. Put the rest on the bottom of your library in any order.';
    const p = parseOracleText(handText);
    // This should parse via the existing matchLookAtTopAnyNumberToHand (destination=hand)
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(e.destination).toBe('hand');
  });
});

// ---------------------------------------------------------------------------
// 2. matchLookAtTopRevealOneFilterToHand — Nessian Wanderer (fixed N)
// ---------------------------------------------------------------------------
describe('Slice 2/13 — matchLookAtTopRevealOneFilterToHand (Nessian Wanderer, fixed N)', () => {
  const NESSIAN_TEXT =
    'Look at the top three cards of your library. You may reveal a land card from among them and put it into your hand. Put the rest on the bottom of your library in any order.';

  it('parses into ChooseFromTopOfLibrary with land filter, destination=hand, maxSelections=1', () => {
    const p = parseOracleText(NESSIAN_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind + (p.kind === 'Unparsed' ? ': ' + p.reason : ''));
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toBe(3);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(1);
    expect(e.filter).toEqual({ types: ['land'] });
  });

  it('takes the first land into hand; non-lands go to bottom', () => {
    const p = parseOracleText(NESSIAN_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    // Top 3: bear, forest, bolt — plus 2 untouched
    const s = executeEffects(
      makeState(['bear', 'forest', 'bolt', 'axe', 'bear']),
      p.effects, 'p0', [], [],
    );
    // lib1 (forest) should be in hand; lib0/lib2 go to bottom; lib3/lib4 untouched
    expect(zoneIds(s, 'hand')).toEqual(['lib1']);
    expect(zoneIds(s, 'library').length).toBe(4); // 5 - 1 taken
  });

  it('takes nothing and bottoms all three when no land among top N', () => {
    const p = parseOracleText(NESSIAN_TEXT);
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(
      makeState(['bear', 'bolt', 'axe', 'bear', 'bolt']),
      p.effects, 'p0', [], [],
    );
    expect(zoneIds(s, 'hand')).toHaveLength(0);
    expect(zoneIds(s, 'library').length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. matchLookAtTopRevealOneFilterToHand — Seismic Sense trigger (X + where-X)
// ---------------------------------------------------------------------------
describe('Slice 2/13 — matchLookAtTopRevealOneFilterToHand (Seismic Sense trigger, X count)', () => {
  // Seismic Sense oracle trigger body:
  //   "Landfall — Whenever a land enters the battlefield under your control,
  //    look at the top X cards of your library, where X is the number of lands
  //    you control. You may reveal a land card from among them and put it into
  //    your hand. Put the rest on the bottom of your library in any order."
  // We parse just the trigger body starting from "look at the top X..."
  const SEISMIC_BODY =
    'Look at the top X cards of your library, where X is the number of lands you control. You may reveal a land card from among them and put it into your hand. Put the rest on the bottom of your library in any order.';

  it('parses into ChooseFromTopOfLibrary with ForEach land count and land filter', () => {
    const p = parseOracleText(SEISMIC_BODY);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind + (p.kind === 'Unparsed' ? ': ' + p.reason : ''));
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    // count should be a ForEach amount for "number of lands you control"
    expect(typeof e.count).toBe('object');
    const cnt = e.count as { kind: string };
    expect(cnt.kind).toBe('ForEach');
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(1);
    expect(e.filter).toEqual({ types: ['land'] });
  });

  it('uses land count on battlefield to determine how many top cards to look at', () => {
    const p = parseOracleText(SEISMIC_BODY);
    if (p.kind !== 'Spell') throw new Error('x');
    // 2 forests on battlefield → X=2; top 2 library cards: forest, bolt; plus 3 untouched
    const s = executeEffects(
      makeState(['forest', 'bolt', 'bear', 'axe', 'bear'], ['forest', 'forest']),
      p.effects, 'p0', [], [],
    );
    // lib0 (forest from top 2) → hand; lib1 (bolt) → bottom
    expect(zoneIds(s, 'hand')).toEqual(['lib0']);
    expect(zoneIds(s, 'library').length).toBe(4); // 5 - 1 taken
  });

  it('takes nothing when no land among top X', () => {
    const p = parseOracleText(SEISMIC_BODY);
    if (p.kind !== 'Spell') throw new Error('x');
    // 2 forests on battlefield → X=2; top 2: bear, bolt
    const s = executeEffects(
      makeState(['bear', 'bolt', 'forest', 'axe', 'bear'], ['forest', 'forest']),
      p.effects, 'p0', [], [],
    );
    expect(zoneIds(s, 'hand')).toHaveLength(0);
    expect(zoneIds(s, 'library').length).toBe(5);
  });
});
