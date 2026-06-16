/**
 * Slice 12/12 oracle-parser coverage tests:
 *
 * New matchers:
 *   - matchLookAtTopExileFaceDown (extended): single-sentence "exile one face
 *     down and put the rest on the bottom in a random order" (Discover the
 *     Impossible). The previous form required separate sentences; this adds the
 *     "and" connector before "put the rest".
 *
 *   - matchLookAtTopOneOnTopRestGraveyard: "Look at the top N cards. You may put
 *     one back on top. Put the rest into your graveyard." (Sage of Days family).
 *     Graveyard-rest variant of matchLookAtTopOneOnTopRestBottom.
 *
 * Note: Murmurs from Beyond is now handled by matchRevealTopDistribute (Slice 9)
 * via the RevealTopDistribute effect type, which adds executor support for the
 * opponent-chooses-one single-pile family.
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
// 1. matchLookAtTopExileFaceDown — single-sentence "and put the rest" form
//    (Discover the Impossible wording)
// ---------------------------------------------------------------------------

describe('Slice 12 — Discover the Impossible: single-sentence exile-face-down-and-rest', () => {
  // Real Discover the Impossible oracle text — note "and put the rest" in one sentence.
  const DISCOVER_TEXT =
    'Look at the top five cards of your library. Exile one of them face down and put the rest on the bottom in a random order.';

  it('parses to Spell with ChooseFromTopOfLibrary, destination=exile, restDestination=bottom, maxSelections=1', () => {
    const p = parseOracleText(DISCOVER_TEXT);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toBe(5);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(1);
    expect(e.maxSelections).toBe(1);
    expect(e.fallbackSelectionCount).toBe(1);
  });

  it('execution: exactly one card goes to exile, four remain in library (bottom)', () => {
    const p = parseOracleText(DISCOVER_TEXT);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(['bear', 'bolt', 'forest', 'axe', 'bear', 'forest']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // 1 exiled (auto-selects first card)
    expect(zoneIds(s1, 'exile')).toHaveLength(1);
    expect(zoneIds(s1, 'exile')).toContain('lib0');
    // 4 remaining revealed cards go to bottom of library (still library zone)
    expect(zoneIds(s1, 'library').length).toBe(5); // 4 bottomed + 1 untouched
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
    expect(zoneIds(s1, 'graveyard')).toHaveLength(0);
  });

  it('also parses the three-card "any order" bottom variant', () => {
    const TEXT3 =
      'Look at the top three cards of your library. Exile one of them face down and put the rest on the bottom of your library in any order.';
    const p = parseOracleText(TEXT3);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(e.count).toBe(3);
    expect(e.destination).toBe('exile');
    expect(e.restDestination).toBe('bottom');
    expect(e.maxSelections).toBe(1);
  });

  it('execution with three-card variant: one exiled, two in library', () => {
    const TEXT3 =
      'Look at the top three cards of your library. Exile one of them face down and put the rest on the bottom of your library in any order.';
    const p = parseOracleText(TEXT3);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(['bear', 'bolt', 'forest', 'axe']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    expect(zoneIds(s1, 'exile')).toHaveLength(1);
    expect(zoneIds(s1, 'library').length).toBe(3); // 2 bottomed + 1 untouched
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. matchLookAtTopOneOnTopRestGraveyard — Sage of Days
// ---------------------------------------------------------------------------

describe('Slice 12 — Sage of Days: look at top N, optionally put one back on top, rest to graveyard', () => {
  // "When this creature enters" is a trigger prefix; test the body directly.
  const SAGE_BODY =
    'Look at the top three cards of your library. You may put one back on top. Put the rest into your graveyard.';

  it('parses to Spell with ChooseFromTopOfLibrary, destination=top, restDestination=graveyard', () => {
    const p = parseOracleText(SAGE_BODY);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary, got ' + e.kind);
    expect(e.count).toBe(3);
    expect(e.destination).toBe('top');
    expect(e.restDestination).toBe('graveyard');
    expect(e.minSelections).toBe(0); // "you may" — optional
    expect(e.maxSelections).toBe(1);
    expect(e.fallbackSelectionCount).toBe(1);
  });

  it('execution: one card goes back to top of library, two go to graveyard', () => {
    const p = parseOracleText(SAGE_BODY);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(['bear', 'bolt', 'forest', 'axe']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // Auto-selects first card (bear) back to top; bolt and forest → graveyard; axe untouched
    expect(zoneIds(s1, 'library')).toHaveLength(2); // bear (top) + axe (untouched)
    expect(zoneIds(s1, 'library')).toContain('lib0'); // bear kept on top
    expect(zoneIds(s1, 'library')).toContain('lib3'); // axe was never revealed
    expect(zoneIds(s1, 'graveyard')).toHaveLength(2); // bolt + forest
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
  });

  it('parses ETB form: "When this creature enters, look at the top three cards..."', () => {
    const ETB_TEXT =
      'When this creature enters, look at the top three cards of your library. You may put one back on top. Put the rest into your graveyard.';
    const p = parseOracleText(ETB_TEXT);
    expect(p.kind).toBe('ETB');
    if (p.kind !== 'ETB') throw new Error('expected ETB, got ' + p.kind);
    const eff = p.ability.effects[0];
    expect(eff.kind).toBe('ChooseFromTopOfLibrary');
    if (eff.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(eff.count).toBe(3);
    expect(eff.destination).toBe('top');
    expect(eff.restDestination).toBe('graveyard');
    expect(eff.maxSelections).toBe(1);
  });

  it('parses four-card variant with optional "one of them" phrasing', () => {
    const TEXT4 =
      'Look at the top four cards of your library. You may put one of them back on top. Put the rest into your graveyard.';
    const p = parseOracleText(TEXT4);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(e.count).toBe(4);
    expect(e.destination).toBe('top');
    expect(e.restDestination).toBe('graveyard');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(1);
  });

  it('execution four-card: one on top, three in graveyard', () => {
    const TEXT4 =
      'Look at the top four cards of your library. You may put one of them back on top. Put the rest into your graveyard.';
    const p = parseOracleText(TEXT4);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(['bear', 'bolt', 'forest', 'axe', 'forest']);
    const s1 = executeEffects(s0, p.effects, 'p0', [], []);
    // bear → top; bolt, forest, axe → graveyard; last forest untouched
    expect(zoneIds(s1, 'library')).toHaveLength(2); // bear + untouched forest
    expect(zoneIds(s1, 'graveyard')).toHaveLength(3);
    expect(zoneIds(s1, 'hand')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Murmurs from Beyond — now handled by matchRevealTopDistribute (Slice 9)
//    The RevealTopDistribute effect type was added in Slice 9 with full executor
//    support; this describe-block is updated to confirm the parse succeeds.
// ---------------------------------------------------------------------------

describe('Slice 12 (updated) — Murmurs from Beyond: now parsed by matchRevealTopDistribute', () => {
  const MURMURS_TEXT =
    'Reveal the top three cards of your library. An opponent chooses one. Put that card into your graveyard and the rest into your hand.';

  it('parses to Spell with RevealTopDistribute effect (Slice 9 added executor support)', () => {
    const p = parseOracleText(MURMURS_TEXT);
    expect(p.kind).toBe('Spell');
    if (p.kind === 'Spell') {
      expect(p.effects).toHaveLength(1);
      expect(p.effects[0].kind).toBe('RevealTopDistribute');
    }
  });
});
