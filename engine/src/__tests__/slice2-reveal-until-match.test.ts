/**
 * Tests for the RevealUntilMatch effect family (Treasure Hunt / Hermit Druid /
 * Clifftop Lookout / Yuna's Whistle).
 *
 * Covers: parse, AST shape, and execution for all four shapes:
 *   A) rest-to-hand (Treasure Hunt)
 *   B) matched-to-hand / rest-to-graveyard (Hermit Druid)
 *   C) matched-to-battlefield-tapped / rest-to-bottom (Clifftop Lookout)
 *   D) matched-to-hand / rest-to-bottom (Yuna's Whistle)
 */
import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ─── Card definitions ─────────────────────────────────────────────────────────

const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
  keywords: [], card_types: ['land'],
};
const plains: CardDefinition = {
  id: 'plains', name: 'Plains', type_line: 'Basic Land — Plains',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['W'],
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

const ALL_DEFS = new Map<string, CardDefinition>([
  ['forest', forest], ['plains', plains], ['bear', bear], ['bolt', bolt],
]);

/**
 * Build a state whose library (Map insertion order = top-first) is the given
 * def ids.  All library cards belong to player 'p0'.
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

// ─── Parse-only checks ────────────────────────────────────────────────────────

describe('matchRevealUntilMatch — parse checks', () => {
  it('Treasure Hunt: parses to RevealUntilMatch with nonland filter / rest hand', () => {
    const text = 'Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ excludeTypes: ['land'] });
    expect(e.matchedDestination).toBe('hand');
    expect(e.restDestination).toBe('hand');
  });

  it('Hermit Druid: parses with basic-land filter / matched to hand / rest to graveyard', () => {
    const text = 'Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ supertypes: ['Basic'], types: ['land'] });
    expect(e.matchedDestination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
  });

  it('Clifftop Lookout body: parses with land filter / matched to battlefieldTapped / rest to bottom', () => {
    const text = 'Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['land'] });
    expect(e.matchedDestination).toBe('battlefieldTapped');
    expect(e.restDestination).toBe('bottom');
  });

  it("Yuna's Whistle body: parses with creature filter / matched to hand / rest to bottom", () => {
    const text = 'Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order.';
    const parsed = parseOracleText(text);
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') throw new Error('wrong kind');
    expect(e.filter).toEqual({ types: ['creature'] });
    expect(e.matchedDestination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
  });

  it('does NOT parse "reveal the top N cards ..." (different family)', () => {
    // matchRevealTopTake already handles this; matchRevealUntilMatch must not claim it.
    const text = 'Reveal the top five cards of your library. Put any number of land cards from among them into your hand. Put the rest on the bottom of your library in a random order.';
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('expected Spell');
    const e = parsed.effects[0];
    expect(e.kind).not.toBe('RevealUntilMatch');
  });
});

// ─── Execution tests ──────────────────────────────────────────────────────────

describe('RevealUntilMatch execution — Shape A (Treasure Hunt: rest to hand)', () => {
  const text = 'Reveal cards from the top of your library until you reveal a nonland card, then put all cards revealed this way into your hand.';

  it('puts lands (before the nonland match) AND the matched nonland card into hand', () => {
    // Library (top → bottom): forest, forest, bear (nonland), bolt
    const s0 = state(['forest', 'forest', 'bear', 'bolt']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    // lib0 (forest), lib1 (forest), lib2 (bear) all go to hand.
    expect(zoneOf(s, 'lib0')).toBe('hand'); // land before match
    expect(zoneOf(s, 'lib1')).toBe('hand'); // land before match
    expect(zoneOf(s, 'lib2')).toBe('hand'); // the matched nonland
    // lib3 (bolt) was never revealed — stays in library.
    expect(zoneOf(s, 'lib3')).toBe('library');
    expect(cardsInZone(s, 'hand')).toHaveLength(3);
    expect(cardsInZone(s, 'library')).toHaveLength(1);
  });

  it('puts only the matched nonland into hand when top card is already nonland', () => {
    // Library: bear (nonland), forest, bolt
    const s0 = state(['bear', 'forest', 'bolt']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    expect(zoneOf(s, 'lib0')).toBe('hand');   // the matched card (bear)
    expect(zoneOf(s, 'lib1')).toBe('library'); // never revealed
    expect(zoneOf(s, 'lib2')).toBe('library'); // never revealed
    expect(cardsInZone(s, 'hand')).toHaveLength(1);
  });

  it('sends all cards to hand (all lands) when no nonland card found', () => {
    // Library: forest, forest, plains — no nonland, reveals the whole library.
    const s0 = state(['forest', 'forest', 'plains']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    // All three lands go to hand (restDestination = 'hand').
    expect(cardsInZone(s, 'hand')).toHaveLength(3);
    expect(cardsInZone(s, 'library')).toHaveLength(0);
  });
});

describe('RevealUntilMatch execution — Shape B (Hermit Druid: matched to hand, rest to graveyard)', () => {
  const text = 'Reveal cards from the top of your library until you reveal a basic land card. Put that card into your hand and all other cards revealed this way into your graveyard.';

  it('matched basic land goes to hand; nonlands before it go to graveyard', () => {
    // Library (top → bottom): bear, bolt, forest (basic land), plains (basic land)
    const s0 = state(['bear', 'bolt', 'forest', 'plains']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    expect(zoneOf(s, 'lib0')).toBe('graveyard'); // bear — revealed, not matched
    expect(zoneOf(s, 'lib1')).toBe('graveyard'); // bolt — revealed, not matched
    expect(zoneOf(s, 'lib2')).toBe('hand');      // forest — the matched basic land
    expect(zoneOf(s, 'lib3')).toBe('library');   // plains — never revealed
    expect(cardsInZone(s, 'hand')).toHaveLength(1);
    expect(cardsInZone(s, 'graveyard')).toHaveLength(2);
  });

  it('no basic lands: all cards move to graveyard', () => {
    const s0 = state(['bear', 'bolt', 'bear']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    expect(cardsInZone(s, 'hand')).toHaveLength(0);
    expect(cardsInZone(s, 'graveyard')).toHaveLength(3);
    expect(cardsInZone(s, 'library')).toHaveLength(0);
  });
});

describe('RevealUntilMatch execution — Shape C (Clifftop Lookout: matched to battlefield tapped, rest to bottom)', () => {
  const text = 'Reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.';

  it('matched land enters battlefield tapped; non-lands before it go to bottom of library', () => {
    // Library: bear, bolt, forest (land), plains
    const s0 = state(['bear', 'bolt', 'forest', 'plains']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    // bear and bolt were revealed before match — go to bottom (still in library)
    expect(zoneOf(s, 'lib0')).toBe('library'); // bear — bottomed
    expect(zoneOf(s, 'lib1')).toBe('library'); // bolt — bottomed
    // forest — matched land enters the battlefield
    expect(zoneOf(s, 'lib2')).toBe('battlefield');
    expect(s.cards.get('lib2')!.tapped).toBe(true);
    // plains was never revealed
    expect(zoneOf(s, 'lib3')).toBe('library');
    expect(cardsInZone(s, 'battlefield')).toHaveLength(1);
    // library still has 3 cards (bear, bolt, plains)
    expect(cardsInZone(s, 'library')).toHaveLength(3);
  });

  it('when top card is already a land, no rest cards exist; land enters battlefield tapped', () => {
    const s0 = state(['forest', 'bear']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    expect(zoneOf(s, 'lib0')).toBe('battlefield');
    expect(s.cards.get('lib0')!.tapped).toBe(true);
    expect(zoneOf(s, 'lib1')).toBe('library'); // never revealed
    expect(cardsInZone(s, 'battlefield')).toHaveLength(1);
  });
});

describe('RevealUntilMatch execution — Shape D (Yuna\'s Whistle: matched to hand, rest to bottom)', () => {
  const text = "Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order.";

  it('matched creature goes to hand; non-creatures go to bottom of library', () => {
    // Library: forest, bolt, bear (creature), plains
    const s0 = state(['forest', 'bolt', 'bear', 'plains']);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);

    expect(zoneOf(s, 'lib0')).toBe('library'); // forest — bottomed
    expect(zoneOf(s, 'lib1')).toBe('library'); // bolt — bottomed
    expect(zoneOf(s, 'lib2')).toBe('hand');    // bear — matched creature → hand
    expect(zoneOf(s, 'lib3')).toBe('library'); // plains — never revealed
    expect(cardsInZone(s, 'hand')).toHaveLength(1);
    expect(cardsInZone(s, 'library')).toHaveLength(3);
  });

  it('empty library: no-op', () => {
    const s0 = state([]);
    const parsed = parseOracleText(text);
    if (parsed.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(s0, parsed.effects, 'p0', [], []);
    expect(cardsInZone(s, 'hand')).toHaveLength(0);
    expect(cardsInZone(s, 'library')).toHaveLength(0);
  });
});

describe('RevealUntilMatch — works inside ETB trigger context', () => {
  it('ETB oracle text containing reveal-until-match parses correctly', () => {
    // Simulating a card like Clifftop Lookout's ETB-triggered ability body.
    const text = 'When this creature enters, reveal cards from the top of your library until you reveal a land card. Put that card onto the battlefield tapped and the rest on the bottom of your library in a random order.';
    const parsed = parseOracleText(text);
    // Should parse as an ETB triggered ability.
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') throw new Error('expected ETB');
    // The body should contain exactly one RevealUntilMatch effect.
    const body = parsed.ability.effects;
    expect(body).toHaveLength(1);
    expect(body[0].kind).toBe('RevealUntilMatch');
    if (body[0].kind !== 'RevealUntilMatch') throw new Error('wrong kind in trigger body');
    expect(body[0].filter).toEqual({ types: ['land'] });
    expect(body[0].matchedDestination).toBe('battlefieldTapped');
    expect(body[0].restDestination).toBe('bottom');
  });
});
