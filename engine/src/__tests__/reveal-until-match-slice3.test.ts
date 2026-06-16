/**
 * reveal-until-match-slice3: parser + executor tests for Slice 3 extensions to
 * the RevealUntilMatch family:
 *   (a) count > 1  — "until they reveal four land cards" (Mirko Vosk, Mind Drinker)
 *   (b) other-player — "that player reveals cards from the top of their library"
 *       resolved via EventPlayer from the triggering combat-damage event
 *       (Bismuth Mindrender, Territorial Bruntar families)
 *
 * Parser tests verify the AST fields; executor tests verify zone movements using
 * a minimal GameState with p1 as caster and p2 as the EventPlayer whose library
 * is being looped.
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ── Card definitions ──────────────────────────────────────────────────────────

const forest: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest',
  oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'],
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a GameState where:
 *  - p1 is the active/caster player (e.g. controls Mirko Vosk)
 *  - p2 has the given cards in their library (top-first, as iteration order)
 */
function stateWithP2Library(p2LibDefs: string[]): GameState {
  const cards = new Map<string, CardInstance>();
  p2LibDefs.forEach((defId, i) => {
    cards.set(`p2lib${i}`, {
      instanceId: `p2lib${i}`, definitionId: defId, ownerId: 'p2',
      zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0,
      isCommander: false,
    });
  });
  return {
    players: [createPlayer('p1', 'Player 1'), createPlayer('p2', 'Player 2')],
    cards,
    cardDefinitions: new Map([['forest', forest], ['bear', bear], ['bolt', bolt]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false],
    stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

/** Cards in a given zone for a given player. */
function cardsInZone(s: GameState, ownerId: string, zone: string): CardInstance[] {
  return [...s.cards.values()].filter(c => c.ownerId === ownerId && c.zone === zone);
}

/** Library card instance-ids for a player (in iteration order = top-first). */
function libIds(s: GameState, ownerId: string): string[] {
  return cardsInZone(s, ownerId, 'library').map(c => c.instanceId);
}

// ── Oracle texts under test ───────────────────────────────────────────────────

// Mirko Vosk, Mind Drinker  (count=4, all to graveyard)
const MIRKO_TRIGGER_BODY =
  'that player reveals cards from the top of their library until they reveal four land cards, then puts those cards into their graveyard.';

// Bismuth Mindrender style  (count=1, nonland to hand, rest to graveyard)
const BISMUTH_TRIGGER_BODY =
  'that player reveals cards from the top of their library until they reveal a nonland card. ' +
  'that player puts that card into their hand and the rest into their graveyard.';

// Territorial Bruntar style (count=1, land onto battlefield tapped, rest to bottom)
const BRUNTAR_TRIGGER_BODY =
  'that player reveals cards from the top of their library until they reveal a land card. ' +
  'that player puts that card onto the battlefield tapped and the rest on the bottom of their library in any order.';

// ── Parser tests ──────────────────────────────────────────────────────────────

describe('matchRevealUntilMatchOtherPlayer — parser', () => {
  // ── Mirko Vosk (count=4) ─────────────────────────────────────────────────

  it('Mirko Vosk trigger: parses as Triggered with RevealUntilMatch effect', () => {
    const oracle =
      'Whenever ~ deals combat damage to a player, ' + MIRKO_TRIGGER_BODY;
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const e = result.ability.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
  });

  it('Mirko Vosk trigger: count=4, filter=land, both destinations=graveyard, player=EventPlayer', () => {
    const oracle =
      'Whenever ~ deals combat damage to a player, ' + MIRKO_TRIGGER_BODY;
    const result = parseOracleText(oracle);
    if (result.kind !== 'Triggered') throw new Error('expected Triggered');
    const e = result.ability.effects[0];
    if (e.kind !== 'RevealUntilMatch') throw new Error('expected RevealUntilMatch');
    expect(e.count).toBe(4);
    expect(e.filter).toEqual({ types: ['land'] });
    expect(e.matchedDestination).toBe('graveyard');
    expect(e.restDestination).toBe('graveyard');
    expect(e.player).toEqual({ kind: 'EventPlayer' });
  });

  // ── Bismuth Mindrender style (count=1, nonland→hand, rest→graveyard) ───────

  it('Bismuth-style trigger: parses as Triggered with RevealUntilMatch effect', () => {
    const oracle =
      'Whenever ~ deals combat damage to a player, ' + BISMUTH_TRIGGER_BODY;
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const e = result.ability.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
  });

  it('Bismuth-style trigger: count=1 (default), filter=nonland, matchedDest=hand, restDest=graveyard', () => {
    const oracle =
      'Whenever ~ deals combat damage to a player, ' + BISMUTH_TRIGGER_BODY;
    const result = parseOracleText(oracle);
    if (result.kind !== 'Triggered') throw new Error('expected Triggered');
    const e = result.ability.effects[0];
    if (e.kind !== 'RevealUntilMatch') throw new Error('expected RevealUntilMatch');
    // count defaults to 1 when absent
    expect(e.count ?? 1).toBe(1);
    expect(e.filter).toEqual({ excludeTypes: ['land'] });
    expect(e.matchedDestination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
    expect(e.player).toEqual({ kind: 'EventPlayer' });
  });

  // ── Territorial Bruntar style (count=1, land→battlefield-tapped, rest→bottom) ──

  it('Bruntar-style trigger: parses as Triggered with RevealUntilMatch effect', () => {
    const oracle =
      'Whenever ~ deals combat damage to a player, ' + BRUNTAR_TRIGGER_BODY;
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    const e = result.ability.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
  });

  it('Bruntar-style trigger: filter=land, matchedDest=battlefieldTapped, restDest=bottom, player=EventPlayer', () => {
    const oracle =
      'Whenever ~ deals combat damage to a player, ' + BRUNTAR_TRIGGER_BODY;
    const result = parseOracleText(oracle);
    if (result.kind !== 'Triggered') throw new Error('expected Triggered');
    const e = result.ability.effects[0];
    if (e.kind !== 'RevealUntilMatch') throw new Error('expected RevealUntilMatch');
    expect(e.filter).toEqual({ types: ['land'] });
    expect(e.matchedDestination).toBe('battlefieldTapped');
    expect(e.restDestination).toBe('bottom');
    expect(e.player).toEqual({ kind: 'EventPlayer' });
  });

  // ── Pre-existing shape still parses normally (backward-compat) ───────────

  it('Original self-reveal shape (Hermit Druid) still parses correctly', () => {
    const oracle =
      'Reveal cards from the top of your library until you reveal a basic land card. ' +
      'Put that card into your hand and all other cards revealed this way into your graveyard.';
    const result = parseOracleText(oracle);
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    const e = result.effects[0];
    expect(e.kind).toBe('RevealUntilMatch');
    if (e.kind !== 'RevealUntilMatch') return;
    expect(e.player).toBeUndefined();
    expect(e.count).toBeUndefined();
    expect(e.matchedDestination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
  });
});

// ── Executor tests ────────────────────────────────────────────────────────────

describe('RevealUntilMatch executor — other player and count extensions', () => {
  // ── Mirko Vosk: multi-count, all to graveyard ─────────────────────────────

  it('Mirko Vosk (count=4): stops after revealing four land cards; all revealed go to graveyard', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, ' + MIRKO_TRIGGER_BODY,
    );
    if (result.kind !== 'Triggered') throw new Error('expected Triggered');
    const effects = result.ability.effects;

    // p2 library: bolt, forest, bear, forest, bolt, forest, bear, forest, bear
    // Reveal: bolt (non-land → rest→graveyard), forest (match 1),
    //         bear (non-land → rest→graveyard), forest (match 2),
    //         bolt (non-land → rest→graveyard), forest (match 3),
    //         bear (non-land → rest→graveyard), forest (match 4) → STOP
    // lib9 bear stays unrevealed.
    const s0 = stateWithP2Library([
      'bolt',   // p2lib0 → rest (graveyard)
      'forest', // p2lib1 → match 1 (graveyard)
      'bear',   // p2lib2 → rest (graveyard)
      'forest', // p2lib3 → match 2 (graveyard)
      'bolt',   // p2lib4 → rest (graveyard)
      'forest', // p2lib5 → match 3 (graveyard)
      'bear',   // p2lib6 → rest (graveyard)
      'forest', // p2lib7 → match 4 (graveyard) — STOP
      'bear',   // p2lib8 → stays in library (never revealed)
    ]);

    const eventContext = { eventPlayerId: 'p2' };
    const s = executeEffects(s0, effects, 'p1', [], [], 0, { eventContext });

    // 8 cards go to graveyard (4 matches + 4 non-matches between them)
    const gy = cardsInZone(s, 'p2', 'graveyard');
    expect(gy.length).toBe(8);
    expect(gy.map(c => c.instanceId).sort()).toEqual(
      ['p2lib0', 'p2lib1', 'p2lib2', 'p2lib3', 'p2lib4', 'p2lib5', 'p2lib6', 'p2lib7'],
    );

    // Only the 9th card stays in library
    expect(libIds(s, 'p2')).toEqual(['p2lib8']);
  });

  it('Mirko Vosk (count=4): library exhausted before 4 lands — reveals everything available', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, ' + MIRKO_TRIGGER_BODY,
    );
    if (result.kind !== 'Triggered') throw new Error('expected Triggered');
    const effects = result.ability.effects;

    // Only 2 land cards in library; can't find 4.
    const s0 = stateWithP2Library(['bear', 'forest', 'bolt', 'forest', 'bear']);
    const eventContext = { eventPlayerId: 'p2' };
    const s = executeEffects(s0, effects, 'p1', [], [], 0, { eventContext });

    // All 5 cards go to graveyard (both matches + 3 non-matches)
    const gy = cardsInZone(s, 'p2', 'graveyard');
    expect(gy.length).toBe(5);
    expect(libIds(s, 'p2').length).toBe(0);
  });

  // ── Bismuth-style: single nonland → hand, rest → graveyard ───────────────

  it('Bismuth-style: first nonland goes to p2 hand; lands scanned before it go to graveyard', () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, ' + BISMUTH_TRIGGER_BODY,
    );
    if (result.kind !== 'Triggered') throw new Error('expected Triggered');
    const effects = result.ability.effects;

    // p2 library: forest, forest, bear, bolt, bear
    // Reveals: forest (land → rest→graveyard), forest (land → rest→graveyard),
    //          bear (nonland → match→hand) → STOP
    // bolt and final bear stay in library.
    const s0 = stateWithP2Library(['forest', 'forest', 'bear', 'bolt', 'bear']);
    const eventContext = { eventPlayerId: 'p2' };
    const s = executeEffects(s0, effects, 'p1', [], [], 0, { eventContext });

    // p2lib2 (first bear) → hand
    const hand = cardsInZone(s, 'p2', 'hand');
    expect(hand).toHaveLength(1);
    expect(hand[0].instanceId).toBe('p2lib2');

    // p2lib0, p2lib1 (forests) → graveyard
    const gy = cardsInZone(s, 'p2', 'graveyard');
    expect(gy.map(c => c.instanceId).sort()).toEqual(['p2lib0', 'p2lib1']);

    // p2lib3, p2lib4 stay in library
    expect(libIds(s, 'p2').length).toBe(2);
    expect(libIds(s, 'p2')).toContain('p2lib3');
    expect(libIds(s, 'p2')).toContain('p2lib4');
  });

  it("Bismuth-style: p1's library is not touched — effect acts on p2 only", () => {
    const result = parseOracleText(
      'Whenever ~ deals combat damage to a player, ' + BISMUTH_TRIGGER_BODY,
    );
    if (result.kind !== 'Triggered') throw new Error('expected Triggered');
    const effects = result.ability.effects;

    const s0 = stateWithP2Library(['bear']);
    // Add a p1 library card to make sure it isn't touched
    const s0WithP1Lib: GameState = {
      ...s0,
      cards: new Map([
        ...s0.cards,
        ['p1lib0', {
          instanceId: 'p1lib0', definitionId: 'forest', ownerId: 'p1',
          zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0,
          isCommander: false,
        }],
      ]),
    };

    const eventContext = { eventPlayerId: 'p2' };
    const s = executeEffects(s0WithP1Lib, effects, 'p1', [], [], 0, { eventContext });

    // p1's library card is untouched
    expect(s.cards.get('p1lib0')!.zone).toBe('library');
    // p2's library is looped: bear → hand (first nonland), nothing before it
    expect(s.cards.get('p2lib0')!.zone).toBe('hand');
  });

  // ── Backward-compat: original self-reveal (Hermit Druid) still executes ───

  it('Hermit Druid self-reveal (no player field): acts on caster library', () => {
    const oracle =
      'Reveal cards from the top of your library until you reveal a basic land card. ' +
      'Put that card into your hand and all other cards revealed this way into your graveyard.';
    const result = parseOracleText(oracle);
    if (result.kind !== 'Spell') throw new Error('expected Spell');
    const effects = result.effects;

    // p1 (caster) library: bolt, bear, forest (basic land)
    // bolt and bear → graveyard; forest → hand
    const cards = new Map<string, CardInstance>([
      ['lib0', { instanceId: 'lib0', definitionId: 'bolt', ownerId: 'p1', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false }],
      ['lib1', { instanceId: 'lib1', definitionId: 'bear', ownerId: 'p1', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false }],
      ['lib2', { instanceId: 'lib2', definitionId: 'forest', ownerId: 'p1', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false }],
    ]);
    const s0: GameState = {
      players: [createPlayer('p1', 'Player 1'), createPlayer('p2', 'Player 2')],
      cards,
      cardDefinitions: new Map([['forest', forest], ['bear', bear], ['bolt', bolt]]),
      activePlayerIndex: 0, priorityPlayerIndex: 0,
      phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
      hasPriorityPassed: [false, false],
      stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
    };

    const s = executeEffects(s0, effects, 'p1', [], []);

    expect(s.cards.get('lib2')!.zone).toBe('hand');
    expect(s.cards.get('lib0')!.zone).toBe('graveyard');
    expect(s.cards.get('lib1')!.zone).toBe('graveyard');
  });
});
