/**
 * Slice 1 / Round-8 carryover: Old Stickfingers family
 *
 * Matcher: matchRevealUntilAllToGraveyard
 * Covers oracle texts where BOTH the matched card and all other cards revealed
 * during the dig go to the graveyard (not just the rest to bottom/hand).
 *
 * Representative cards:
 *   - Old Stickfingers ("reveal cards from the top of your library until you reveal
 *     a creature card. That card and all noncreature cards revealed this way go to
 *     your graveyard.")
 *   - Variants with "put ... into your graveyard" phrasing
 *   - Variants with "other" qualifier instead of "noncreature"
 *   - Variants with "land" as the trigger type
 *
 * AST: RevealUntilMatch { filter, matchedDestination: 'graveyard', restDestination: 'graveyard' }
 * Executor: fully handled by existing RevealUntilMatch case in executor.ts.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ---------------------------------------------------------------------------
// Card definitions
// ---------------------------------------------------------------------------

const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};
const island: CardDefinition = {
  id: 'island', name: 'Island', type_line: 'Basic Land — Island',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['U'],
  keywords: [], card_types: ['land'],
};
const bear: CardDefinition = {
  id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 2, toughness: 2,
};
const bolt: CardDefinition = {
  id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant',
  oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'],
  keywords: [], card_types: ['instant'],
};
const enchant: CardDefinition = {
  id: 'enchant', name: 'Rancor', type_line: 'Enchantment — Aura',
  oracle_text: '', mana_cost: '{G}', cmc: 1, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['enchantment'],
};

const ALL_DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['island', island], ['bear', bear], ['bolt', bolt], ['enchant', enchant],
]);

/**
 * Build a minimal GameState whose library (top-first) uses the given def ids.
 * All library cards belong to player 'p0'.
 */
function state(libraryDefs: string[]): GameState {
  const cards = new Map<string, CardInstance>();
  libraryDefs.forEach((defId, i) => {
    cards.set(`lib${i}`, {
      instanceId: `lib${i}`, definitionId: defId, ownerId: 'p0', zone: 'library',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
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

function zoneOf(s: GameState, id: string): string {
  return s.cards.get(id)!.zone;
}

function cardsInZone(s: GameState, zone: string): string[] {
  return [...s.cards.values()].filter(c => c.zone === zone).map(c => c.instanceId);
}

// ---------------------------------------------------------------------------
// Parse tests
// ---------------------------------------------------------------------------

describe('matchRevealUntilAllToGraveyard — parse', () => {

  it('parses Old Stickfingers exact oracle (noncreature qualifier, "go to your graveyard")', () => {
    const text =
      'Reveal cards from the top of your library until you reveal a creature card. ' +
      'That card and all noncreature cards revealed this way go to your graveyard.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['creature'] });
    expect(e.matchedDestination).toBe('graveyard');
    expect(e.restDestination).toBe('graveyard');
  });

  it('parses "other cards" qualifier with land filter ("go to your graveyard")', () => {
    const text =
      'Reveal cards from the top of your library until you reveal a land card. ' +
      'That card and all other cards revealed this way go to your graveyard.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['land'] });
    expect(e.matchedDestination).toBe('graveyard');
    expect(e.restDestination).toBe('graveyard');
  });

  it('parses "put ... into your graveyard" older phrasing with creature filter', () => {
    const text =
      'Reveal cards from the top of your library until you reveal a creature card. ' +
      'Put that card and all noncreature cards revealed this way into your graveyard.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['creature'] });
    expect(e.matchedDestination).toBe('graveyard');
    expect(e.restDestination).toBe('graveyard');
  });

  it('parses artifact filter with "other" qualifier and "put" phrasing', () => {
    const text =
      'Reveal cards from the top of your library until you reveal an artifact card. ' +
      'Put that card and all other cards revealed this way into your graveyard.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['artifact'] });
    expect(e.matchedDestination).toBe('graveyard');
    expect(e.restDestination).toBe('graveyard');
  });

  it('parses sorcery filter (no qualifier) with "go to your graveyard" phrasing', () => {
    const text =
      'Reveal cards from the top of your library until you reveal a sorcery card. ' +
      'That card and all other cards revealed this way go to your graveyard.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['sorcery'] });
    expect(e.matchedDestination).toBe('graveyard');
    expect(e.restDestination).toBe('graveyard');
  });

  it('does NOT parse standard Hermit Druid (matched→hand, rest→graveyard) as all-to-graveyard', () => {
    // Hermit Druid puts matched card into hand, not graveyard
    const text =
      'Reveal cards from the top of your library until you reveal a basic land card. ' +
      'Put that card into your hand and all other cards revealed this way into your graveyard.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    // Should still parse (via matchRevealUntilMatch), but matched → hand, not graveyard
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    // The matched card goes to hand (not graveyard) — Hermit Druid pattern
    expect(e.matchedDestination).toBe('hand');
  });

});

// ---------------------------------------------------------------------------
// Execution tests
// ---------------------------------------------------------------------------

describe('matchRevealUntilAllToGraveyard — execute', () => {

  it('moves matched creature card AND all prior revealed nonmatches to graveyard', () => {
    // Library (top): forest, island, bear (creature = match), bolt
    // Reveals forest, island, bear; stops. bolt stays in library.
    // All 3 revealed go to graveyard.
    const text =
      'Reveal cards from the top of your library until you reveal a creature card. ' +
      'That card and all noncreature cards revealed this way go to your graveyard.';
    const s0 = state(['forest', 'island', 'bear', 'bolt']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    // lib0 (forest), lib1 (island), lib2 (bear) → graveyard
    expect(zoneOf(s, 'lib0')).toBe('graveyard');
    expect(zoneOf(s, 'lib1')).toBe('graveyard');
    expect(zoneOf(s, 'lib2')).toBe('graveyard');
    // lib3 (bolt) never revealed → stays in library
    expect(zoneOf(s, 'lib3')).toBe('library');

    expect(cardsInZone(s, 'graveyard')).toHaveLength(3);
    expect(cardsInZone(s, 'library')).toHaveLength(1);
  });

  it('moves the single matched card when library leads immediately with the match', () => {
    // Library (top): bear, forest, bolt
    // First reveal = bear (creature match) → goes to graveyard immediately, no "rest"
    const text =
      'Reveal cards from the top of your library until you reveal a creature card. ' +
      'That card and all noncreature cards revealed this way go to your graveyard.';
    const s0 = state(['bear', 'forest', 'bolt']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    expect(zoneOf(s, 'lib0')).toBe('graveyard'); // bear
    expect(zoneOf(s, 'lib1')).toBe('library');   // forest — never revealed
    expect(zoneOf(s, 'lib2')).toBe('library');   // bolt — never revealed

    expect(cardsInZone(s, 'graveyard')).toHaveLength(1);
  });

  it('mills entire library to graveyard when no match exists', () => {
    // Library: only lands — no creature card, so reveals the whole library
    const text =
      'Reveal cards from the top of your library until you reveal a creature card. ' +
      'That card and all noncreature cards revealed this way go to your graveyard.';
    const s0 = state(['forest', 'island', 'forest']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    // All 3 cards in graveyard, library empty
    expect(cardsInZone(s, 'library')).toHaveLength(0);
    expect(cardsInZone(s, 'graveyard')).toHaveLength(3);
  });

  it('puts/go phrasing variant also executes correctly (enchantment filter)', () => {
    // "put ... into your graveyard" phrasing
    const text =
      'Reveal cards from the top of your library until you reveal an enchantment card. ' +
      'Put that card and all other cards revealed this way into your graveyard.';
    // Library: forest, bolt, enchant (match), bear
    const s0 = state(['forest', 'bolt', 'enchant', 'bear']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    // lib0 (forest), lib1 (bolt), lib2 (enchant) → graveyard
    expect(zoneOf(s, 'lib0')).toBe('graveyard');
    expect(zoneOf(s, 'lib1')).toBe('graveyard');
    expect(zoneOf(s, 'lib2')).toBe('graveyard');
    // lib3 (bear) never revealed
    expect(zoneOf(s, 'lib3')).toBe('library');
  });

});
