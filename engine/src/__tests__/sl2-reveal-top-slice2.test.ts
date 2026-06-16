/**
 * Slice 2 — Look/Reveal-top-N dig family: subtype filters, battlefield destination, value riders
 *
 * Tests:
 *  A. matchRevealTopSubtypeFilter — "Put all Goblin/Island cards revealed this way into your hand"
 *  B. matchLookAtTopPutOneToBattlefield — "you may put a land/creature card onto the battlefield [tapped]"
 *  C. matchRevealTopTakeExtended multi-type OR — "Put up to two instant and/or sorcery cards ... into your hand"
 */

import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// ─── Card definitions ────────────────────────────────────────────────────────

const goblin: CardDefinition = {
  id: 'goblin', name: 'Goblin Lackey',
  type_line: 'Creature — Goblin', oracle_text: '', mana_cost: '{R}', cmc: 1,
  colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['creature'],
  power: 1, toughness: 1,
};
const island: CardDefinition = {
  id: 'island', name: 'Island',
  type_line: 'Basic Land — Island', oracle_text: '', mana_cost: '', cmc: 0,
  colors: [], color_identity: ['U'], keywords: [], card_types: ['land'],
};
const forest: CardDefinition = {
  id: 'forest', name: 'Forest',
  type_line: 'Basic Land — Forest', oracle_text: '', mana_cost: '', cmc: 0,
  colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
};
const bear: CardDefinition = {
  id: 'bear', name: 'Grizzly Bears',
  type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
  colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 2, toughness: 2,
};
const lightning: CardDefinition = {
  id: 'lightning', name: 'Lightning Bolt',
  type_line: 'Instant', oracle_text: '', mana_cost: '{R}', cmc: 1,
  colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'],
};
const ponder: CardDefinition = {
  id: 'ponder', name: 'Ponder',
  type_line: 'Sorcery', oracle_text: '', mana_cost: '{U}', cmc: 1,
  colors: ['U'], color_identity: ['U'], keywords: [], card_types: ['sorcery'],
};
const smallCreature: CardDefinition = {
  id: 'small', name: 'Llanowar Elves',
  type_line: 'Creature — Elf Druid', oracle_text: '', mana_cost: '{G}', cmc: 1,
  colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 1, toughness: 1,
};
const bigCreature: CardDefinition = {
  id: 'big', name: 'Primeval Titan',
  type_line: 'Creature — Giant', oracle_text: '', mana_cost: '{4}{G}{G}', cmc: 6,
  colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'],
  power: 6, toughness: 6,
};

const ALL_DEFS = new Map<string, CardDefinition>([
  ['goblin', goblin], ['island', island], ['forest', forest], ['bear', bear],
  ['lightning', lightning], ['ponder', ponder], ['small', smallCreature], ['big', bigCreature],
]);

// ─── State builder ────────────────────────────────────────────────────────────

function mkState(libraryDefs: string[]): GameState {
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

function zone(s: GameState, id: string): string { return s.cards.get(id)!.zone; }
function hand(s: GameState): CardInstance[] { return [...s.cards.values()].filter(c => c.zone === 'hand'); }
function libIds(s: GameState): string[] { return [...s.cards.values()].filter(c => c.zone === 'library').map(c => c.instanceId); }
function bf(s: GameState): CardInstance[] { return [...s.cards.values()].filter(c => c.zone === 'battlefield'); }

// =============================================================================
// A. matchRevealTopSubtypeFilter
// =============================================================================

describe('Slice 2 — A: matchRevealTopSubtypeFilter (Goblin Ringleader / Merfolk Wayfinder)', () => {

  // Goblin Ringleader oracle wording
  const GOBLIN_RINGLEADER = 'When this creature enters, reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.';

  it('A1: parses Goblin Ringleader ETB oracle to ChooseFromTopOfLibrary with subtypes filter', () => {
    const p = parseOracleText(GOBLIN_RINGLEADER);
    // ETB trigger body
    const kind = p.kind;
    expect(['ETB', 'Triggered', 'Spell'].includes(kind)).toBe(true);
    let effects: import('../effects/ast').Effect[];
    if (p.kind === 'ETB' || p.kind === 'Triggered') {
      effects = p.ability.effects;
    } else if (p.kind === 'Spell') {
      effects = p.effects;
    } else {
      throw new Error('unexpected kind: ' + kind);
    }
    const e = effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.count).toBe(4);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.filter).toEqual({ subtypes: ['Goblin'] });
  });

  it('A2: executes — Goblin cards go to hand, others to bottom', () => {
    const pText = 'Reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.';
    const p = parseOracleText(pText);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    // Library: goblin, forest, goblin, bear + 1 deep card
    const s0 = mkState(['goblin', 'forest', 'goblin', 'bear', 'forest']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);

    const h = hand(s);
    expect(h.length).toBe(2); // lib0, lib2 are goblins
    expect(h.map(c => c.instanceId).sort()).toEqual(['lib0', 'lib2']);
    // Non-goblin revealed (lib1 forest, lib3 bear) went to bottom (still in library)
    const lib = libIds(s);
    expect(lib).toContain('lib1');
    expect(lib).toContain('lib3');
    expect(lib).toContain('lib4'); // deep card untouched
    expect(lib.length).toBe(3); // 5 - 2 goblins = 3
  });

  it('A3: Island filter (Merfolk Wayfinder wording) — Island cards go to hand', () => {
    const pText = 'Reveal the top three cards of your library. Put all Island cards revealed this way into your hand and the rest on the bottom.';
    const p = parseOracleText(pText);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.filter).toEqual({ subtypes: ['Island'] });
    expect(e.count).toBe(3);

    // Library: island, bear, island + deep card
    const s0 = mkState(['island', 'bear', 'island', 'forest']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    const h = hand(s);
    expect(h.length).toBe(2); // two Islands
    expect(h.every(c => c.definitionId === 'island')).toBe(true);
    expect(libIds(s).length).toBe(2); // bear + deep forest
  });

  it('A4: no matching cards — none taken, all go to bottom', () => {
    const pText = 'Reveal the top four cards of your library. Put all Goblin cards revealed this way into your hand and the rest on the bottom of your library in any order.';
    const p = parseOracleText(pText);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const s0 = mkState(['bear', 'forest', 'lightning', 'ponder']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect(hand(s).length).toBe(0);
    expect(libIds(s).length).toBe(4); // all stay in library
  });
});

// =============================================================================
// B. matchLookAtTopPutOneToBattlefield — Kaslem's Stonetree + Aang variants
// =============================================================================

describe('Slice 2 — B: matchLookAtTopPutOneToBattlefield (Kaslem / Aang)', () => {

  // Kaslem's Stonetree ETB (land → battlefield tapped)
  const KASLEM_BODY = 'Look at the top six cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom in a random order.';

  it('B1: parses Kaslem to ChooseFromTopOfLibrary with destination=battlefield, tapped=true', () => {
    const p = parseOracleText(KASLEM_BODY);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.count).toBe(6);
    expect(e.destination).toBe('battlefield');
    expect(e.restDestination).toBe('bottom');
    expect(e.maxSelections).toBe(1);
    expect(e.filter).toEqual({ types: ['land'] });
    expect(e.tapped).toBe(true);
  });

  it('B2: executes Kaslem — land enters battlefield tapped, rest on bottom', () => {
    const p = parseOracleText(KASLEM_BODY);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    // Top 6: bear, forest, goblin, island, ponder, lightning + 1 deep
    const s0 = mkState(['bear', 'forest', 'goblin', 'island', 'ponder', 'lightning', 'bear']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);

    // The first matching land in the revealed set (lib1 = Forest) should be on the battlefield, tapped.
    const bfCards = bf(s);
    expect(bfCards.length).toBe(1);
    const entered = bfCards[0];
    expect(entered.zone).toBe('battlefield');
    expect(entered.tapped).toBe(true); // entered tapped
    expect(['forest', 'island'].includes(entered.definitionId)).toBe(true);

    // The deep card (lib6) is untouched
    expect(zone(s, 'lib6')).toBe('library');
    // Total cards conserved
    expect(s.cards.size).toBe(7);
  });

  it('B3: parses Aang — creature card mv ≤ 4 onto battlefield (no rest tail)', () => {
    const AANG_BODY = 'Look at the top five cards of your library. You may put a creature card with mana value 4 or less from among them onto the battlefield.';
    const p = parseOracleText(AANG_BODY);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.count).toBe(5);
    expect(e.destination).toBe('battlefield');
    expect(e.maxSelections).toBe(1);
    expect(e.filter.types).toContain('creature');
    expect(e.filter.cmc).toEqual({ op: 'lte', value: 4 });
    expect(e.tapped).toBeFalsy(); // no tapped flag
  });

  it('B4: executes Aang — creature with mv ≤ 4 enters battlefield; big creature stays', () => {
    const AANG_BODY = 'Look at the top five cards of your library. You may put a creature card with mana value 4 or less from among them onto the battlefield.';
    const p = parseOracleText(AANG_BODY);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    // Library: big (cmc 6), small (cmc 1), forest, ponder, lightning + deep
    const s0 = mkState(['big', 'small', 'forest', 'ponder', 'lightning', 'goblin']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);

    const bfCards = bf(s);
    expect(bfCards.length).toBe(1);
    expect(bfCards[0].definitionId).toBe('small'); // cmc 1 matches mv ≤ 4
    expect(bfCards[0].tapped).toBe(false); // not tapped
    // lib0 (big, cmc 6) — NOT eligible, still in library
    expect(zone(s, 'lib0')).toBe('library');
    // deep card untouched
    expect(zone(s, 'lib5')).toBe('library');
  });
});

// =============================================================================
// C. matchRevealTopTakeExtended multi-type OR (Pieces of the Puzzle)
// =============================================================================

describe('Slice 2 — C: multi-type OR "up to N instant and/or sorcery cards" (Pieces of the Puzzle)', () => {

  const PIECES = 'Reveal the top five cards of your library. Put up to two instant and/or sorcery cards from among them into your hand and the rest into your graveyard.';

  it('C1: parses Pieces of the Puzzle to ChooseFromTopOfLibrary with anyOf filter, maxSelections=2', () => {
    const p = parseOracleText(PIECES);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const e = p.effects.find(ef => ef.kind === 'ChooseFromTopOfLibrary') as any;
    expect(e).toBeDefined();
    expect(e.count).toBe(5);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('graveyard');
    expect(e.maxSelections).toBe(2);
    expect(e.filter.anyOf).toBeDefined();
    const branches = e.filter.anyOf as Array<{ types: string[] }>;
    const allTypes = branches.flatMap(b => b.types);
    expect(allTypes).toContain('instant');
    expect(allTypes).toContain('sorcery');
  });

  it('C2: executes — up to two instant/sorcery cards go to hand; the rest to graveyard', () => {
    const p = parseOracleText(PIECES);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    // Library: lightning (instant), ponder (sorcery), bear (creature), forest (land), lightning + deep
    const s0 = mkState(['lightning', 'ponder', 'bear', 'forest', 'lightning', 'goblin']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);

    // Two instants/sorceries from top-5 should be in hand (maxSelections=2)
    const h = hand(s);
    expect(h.length).toBe(2);
    for (const c of h) {
      const def = s.cardDefinitions.get(c.definitionId)!;
      expect(def.card_types.some(t => t === 'instant' || t === 'sorcery')).toBe(true);
    }

    // Non-spell revealed cards (bear lib2, forest lib3) go to graveyard
    expect(zone(s, 'lib2')).toBe('graveyard');
    expect(zone(s, 'lib3')).toBe('graveyard');

    // Deep card (lib5) untouched in library
    expect(zone(s, 'lib5')).toBe('library');
    expect(s.cards.size).toBe(6);
  });

  it('C3: cap respected — only 2 taken even if 3 instants/sorceries are available', () => {
    const p = parseOracleText(PIECES);
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    // All 5 revealed are instants/sorceries
    const s0 = mkState(['lightning', 'ponder', 'lightning', 'ponder', 'lightning', 'bear']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);

    const h = hand(s);
    expect(h.length).toBe(2); // capped at maxSelections=2
    // The remaining 3 instants/sorceries revealed go to graveyard
    const gy = [...s.cards.values()].filter(c => c.zone === 'graveyard');
    expect(gy.length).toBe(3);
    // deep card stays in library
    expect(zone(s, 'lib5')).toBe('library');
  });
});
