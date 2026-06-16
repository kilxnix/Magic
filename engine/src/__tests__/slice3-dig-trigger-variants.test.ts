/**
 * Slice 3 (trigger-tail dig family) — parser + executor tests for three new matchers:
 *
 *   1. matchRevealTopIfMatchWithElse — "if it's a <type>, put it in hand; if you
 *      don't, put it on the bottom" (Traveling Botanist / Gate to the Aether)
 *
 *   2. matchLookAtTopGreatestPower — "look at top X where X is the greatest power
 *      among creatures you control" (Keldon Flamesage)
 *
 *   3. matchRevealTopAllTypesAndAll — "put all creature cards and all land cards
 *      revealed this way into your hand" (Lair Delve)
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ─── shared card definitions ────────────────────────────────────────────────

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

const wurm: CardDefinition = {
  id: 'wurm', name: 'Wurm', type_line: 'Creature — Wurm',
  oracle_text: '', mana_cost: '{5}{G}', cmc: 6, colors: ['G'], color_identity: ['G'],
  keywords: [], card_types: ['creature'], power: 5, toughness: 5,
};

/**
 * Build a GameState whose library is the given def-ids in top→bottom order.
 * Optional battlefield cards (creatures that can contribute to greatest-power).
 */
function makeState(
  libraryDefs: string[],
  battlefieldCreatureDefs: string[] = [],
): GameState {
  const cards = new Map<string, CardInstance>();
  libraryDefs.forEach((defId, i) => {
    cards.set(`lib${i}`, {
      instanceId: `lib${i}`, definitionId: defId, ownerId: 'p0',
      zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  });
  battlefieldCreatureDefs.forEach((defId, i) => {
    cards.set(`bf${i}`, {
      instanceId: `bf${i}`, definitionId: defId, ownerId: 'p0',
      zone: 'battlefield', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards,
    cardDefinitions: new Map<string, CardDefinition>([
      ['forest', forest], ['bear', bear], ['bolt', bolt], ['wurm', wurm],
    ]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function libIds(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'library').map(c => c.instanceId);
}

function handIds(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'hand').map(c => c.instanceId);
}

// ─── 1. matchRevealTopIfMatchWithElse ────────────────────────────────────────

describe('matchRevealTopIfMatchWithElse (Traveling Botanist / Gate to the Aether family)', () => {
  // Traveling Botanist oracle:
  const botanistText =
    "Reveal the top card of your library. If it's a land card, you may reveal it " +
    "and put it into your hand. If you don't, put it on the bottom of your library.";

  it('parses Traveling Botanist oracle to ChooseFromTopOfLibrary(count=1, land filter, destination=hand, restDestination=bottom)', () => {
    const p = parseOracleText(botanistText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect(e.count).toBe(1);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(1);
    expect(e.filter).toEqual({ types: ['land'] });
  });

  it('puts the top card into hand when it matches (land on top)', () => {
    const p = parseOracleText(botanistText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(['forest', 'bear']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect(handIds(s)).toContain('lib0');       // land went to hand
    expect(libIds(s)).toContain('lib1');        // second card still in library
    expect(libIds(s)).not.toContain('lib0');    // top card left library
  });

  it('puts the top card on the bottom when it does not match (creature on top)', () => {
    const p = parseOracleText(botanistText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s0 = makeState(['bear', 'forest']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    // No cards to hand
    expect(handIds(s)).toHaveLength(0);
    // Both cards still in library (bear went to bottom, forest untouched on top)
    expect(libIds(s)).toHaveLength(2);
  });

  // Gate to the Aether oracle (permanent → battlefield):
  const gateText =
    "Reveal the top card of your library. If it's a permanent card, you may put " +
    "it onto the battlefield. If you don't, put it on the bottom of your library.";

  it('parses Gate to the Aether oracle — permanent filter, battlefield destination', () => {
    const p = parseOracleText(gateText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect(e.destination).toBe('battlefield');
    expect(e.restDestination).toBe('bottom');
    expect(e.filter).toEqual({ permanent: true });
  });

  it('parses "otherwise" phrasing as an equivalent else clause', () => {
    const text =
      "Reveal the top card of your library. If it's a creature card, put it into " +
      "your hand. Otherwise, put it into your graveyard.";
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
    expect(e.filter).toEqual({ types: ['creature'] });
  });

  it('does NOT match when there is no else clause (falls through to matchRevealTopIfMatch)', () => {
    // matchRevealTopIfMatch should claim this — not matchRevealTopIfMatchWithElse
    const text = "Reveal the top card of your library. If it's a land card, put it into your hand.";
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    // Both matchers produce an effect; ensure something parses (not Unparsed)
    expect(p.effects).toHaveLength(1);
  });
});

// ─── 2. matchLookAtTopGreatestPower ──────────────────────────────────────────

describe('matchLookAtTopGreatestPower (Keldon Flamesage family)', () => {
  // Keldon Flamesage oracle:
  const flamesageText =
    'Look at the top X cards of your library, where X is the greatest power ' +
    'among creatures you control. You may reveal a land card from among them ' +
    'and put it into your hand. Put the rest on the bottom of your library in a random order.';

  it('parses Keldon Flamesage oracle to ChooseFromTopOfLibrary with GreatestPower count', () => {
    const p = parseOracleText(flamesageText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect(typeof e.count).toBe('object');
    if (typeof e.count !== 'object') return;
    expect((e.count as { kind: string }).kind).toBe('GreatestPower');
    const gp = e.count as { kind: 'GreatestPower'; zone: string; controller: string; filter?: { types?: string[] } };
    expect(gp.zone).toBe('battlefield');
    expect(gp.controller).toBe('you');
    expect(gp.filter?.types).toContain('creature');
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.maxSelections).toBe(1);
    expect(e.filter).toEqual({ types: ['land'] });
  });

  it('resolves GreatestPower from battlefield — reveals correct number of cards', () => {
    const p = parseOracleText(flamesageText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Battlefield: two creatures with power 2 and 5 → greatest = 5
    // Library: [land, creature, land, creature, land, creature] — top 5 revealed
    const s0 = makeState(['forest', 'bear', 'forest', 'bear', 'forest', 'bear'], ['bear', 'wurm']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    // One land card revealed and put into hand (the auto-resolve picks first matching)
    expect(handIds(s)).toHaveLength(1);
    const takenId = handIds(s)[0];
    expect(s.cardDefinitions.get(s.cards.get(takenId)!.definitionId)!.card_types).toContain('land');
  });

  it('resolves GreatestPower = 0 (no creatures) → looks at 0 cards → no change', () => {
    const p = parseOracleText(flamesageText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // No creatures on battlefield → greatest power = 0 → look at 0 cards
    const s0 = makeState(['forest', 'bear', 'forest']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect(handIds(s)).toHaveLength(0);
    expect(libIds(s)).toHaveLength(3); // no cards moved
  });

  it('parses the "any number" variant (no per-card filter)', () => {
    const text =
      'Look at the top X cards of your library, where X is the greatest power ' +
      'among creatures you control. Put any number of them into your hand. ' +
      'Put the rest on the bottom of your library in any order.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect((e.count as { kind: string }).kind).toBe('GreatestPower');
  });
});

// ─── 3. matchRevealTopAllTypesAndAll ─────────────────────────────────────────

describe('matchRevealTopAllTypesAndAll (Lair Delve family)', () => {
  // Lair Delve oracle:
  const lairDelveText =
    'Reveal the top two cards of your library. Put all creature cards and all ' +
    'land cards revealed this way into your hand and the rest on the bottom of ' +
    'your library in any order.';

  it('parses Lair Delve oracle to ChooseFromTopOfLibrary with anyOf filter', () => {
    const p = parseOracleText(lairDelveText);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    expect(e.count).toBe(2);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    const f = e.filter as { anyOf?: { types: string[] }[] };
    expect(Array.isArray(f?.anyOf)).toBe(true);
    expect(f.anyOf).toHaveLength(2);
    const typeArrays = f.anyOf!.map(b => b.types);
    expect(typeArrays).toContainEqual(['creature']);
    expect(typeArrays).toContainEqual(['land']);
  });

  it('takes creatures and lands from revealed top 2, leaves others on bottom', () => {
    const p = parseOracleText(lairDelveText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Library top 2: land, creature — both should go to hand
    const s0 = makeState(['forest', 'bear', 'bolt']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    const hand = handIds(s);
    expect(hand).toContain('lib0'); // forest → hand
    expect(hand).toContain('lib1'); // bear → hand
    expect(hand).toHaveLength(2);
    expect(libIds(s)).toContain('lib2'); // untouched
  });

  it('keeps instant on bottom when revealed — only lands and creatures go to hand', () => {
    const p = parseOracleText(lairDelveText);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    // Top 2: instant, land
    const s0 = makeState(['bolt', 'forest', 'bear']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    const hand = handIds(s);
    expect(hand).toContain('lib1'); // forest → hand
    expect(hand).not.toContain('lib0'); // bolt (instant) → bottom
    expect(libIds(s)).toContain('lib0'); // bolt bottomed
    expect(libIds(s)).toContain('lib2'); // untouched
  });

  it('parses a three-type variant (artifact/creature/land)', () => {
    const text =
      'Reveal the top four cards of your library. Put all artifact cards and all ' +
      'creature cards and all land cards revealed this way into your hand and the ' +
      'rest on the bottom of your library.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    const f = e.filter as { anyOf?: { types: string[] }[] };
    expect(Array.isArray(f?.anyOf)).toBe(true);
    expect(f.anyOf).toHaveLength(3);
  });

  it('does NOT match single-type "all creature cards" (falls through to matchRevealTopTake)', () => {
    const text =
      'Reveal the top three cards of your library. Put all creature cards revealed ' +
      'this way into your hand and the rest on the bottom of your library.';
    const p = parseOracleText(text);
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    // Should parse (via matchRevealTopTake), just not with an anyOf filter
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') return;
    // Single type — matchRevealTopTake claims it without anyOf
    expect((e.filter as { anyOf?: unknown }).anyOf).toBeUndefined();
  });
});
