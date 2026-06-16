import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects, executeSearchLibrary } from '../effects/executor';

// ---------------------------------------------------------------------------
// Family: multiselect-search
// executeSearchLibrary must move N cards (not just 1) for "up to N" ramp/fetch
// wordings (Cultivate / Explosive Vegetation), honoring count + destination,
// while leaving the single-card path byte-for-byte unchanged.
// ---------------------------------------------------------------------------

const forest: CardDefinition = { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'] };
const island: CardDefinition = { id: 'island', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['U'], keywords: [], card_types: ['land'] };
const mountain: CardDefinition = { id: 'mountain', name: 'Mountain', type_line: 'Basic Land — Mountain', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['R'], keywords: [], card_types: ['land'] };
const dual: CardDefinition = { id: 'dual', name: 'Stomping Ground', type_line: 'Land — Mountain Forest', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['R', 'G'], keywords: [], card_types: ['land'] };
const bear: CardDefinition = { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId: owner, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

function libState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map<string, CardInstance>([
      ['f1', mk('f1', 'forest', 'p0', 'library')],
      ['f2', mk('f2', 'forest', 'p0', 'library')],
      ['is', mk('is', 'island', 'p0', 'library')],
      ['mt', mk('mt', 'mountain', 'p0', 'library')],
      ['du', mk('du', 'dual', 'p0', 'library')],      // non-basic land (must NOT be fetched by "basic land")
      ['bz', mk('bz', 'bear', 'p0', 'library')],       // creature decoy (never a candidate)
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      ['forest', forest], ['island', island], ['mountain', mountain], ['dual', dual], ['bear', bear],
    ]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zone(s: GameState, id: string): string { return s.cards.get(id)!.zone; }
function onBf(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'battlefield').map(c => c.instanceId).sort();
}

describe('multiselect-search: parser emits maxSelections for "up to N"', () => {
  it('parses Cultivate-style "up to two basic land cards ... put them ... tapped"', () => {
    const p = parseOracleText('Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl).toBeDefined();
    expect(sl.maxSelections).toBe(2);
    expect(sl.destination).toBe('battlefield');
    expect(sl.tapped).toBe(true);
    expect(sl.shuffle).toBe(true);
    expect(sl.filter.supertypes).toContain('basic');
    expect(sl.filter.types).toContain('land');
  });

  it('parses "up to two Forest cards" (subtype-restricted ramp)', () => {
    const p = parseOracleText('Search your library for up to two Forest cards, put them onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.maxSelections).toBe(2);
    expect(sl.filter.subtypes).toContain('Forest');
    expect(sl.tapped).toBe(true);
  });

  it('parses "up to three basic land cards" (count = 3)', () => {
    const p = parseOracleText('Search your library for up to three basic land cards, put them onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.maxSelections).toBe(3);
    expect(sl.filter.supertypes).toContain('basic');
  });

  it('parses "up to two basic Plains cards" honestly (supertype AND subtype)', () => {
    const p = parseOracleText('Search your library for up to two basic Plains cards, put them onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.maxSelections).toBe(2);
    expect(sl.filter.supertypes).toContain('basic');
    expect(sl.filter.subtypes).toContain('Plains');
  });

  it('honesty guard: "up to two <unknown> cards" stays Unparsed (no trivial fetch)', () => {
    // No recognizable type/subtype restriction → must NOT emit a "fetch anything"
    // SearchLibrary. The clause should fail to parse rather than ship a trivial effect.
    const p = parseOracleText('Search your library for up to two qwerty cards, put them into your hand, then shuffle.');
    const sl = p.kind === 'Spell' ? p.effects.find(e => e.kind === 'SearchLibrary') : undefined;
    expect(sl).toBeUndefined();
  });
});

describe('multiselect-search: executeEffects honestly moves N cards', () => {
  it('Explosive Vegetation: two basic lands onto battlefield tapped, others stay', () => {
    const p = parseOracleText('Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(libState(), p.effects, 'p0', [], []);

    const bf = onBf(s);
    expect(bf.length).toBe(2); // genuinely TWO cards moved, not one

    // Every moved card is a BASIC land, entered TAPPED, and left the library.
    for (const id of bf) {
      const card = s.cards.get(id)!;
      expect(card.tapped).toBe(true);
      expect(card.zone).toBe('battlefield');
      expect(card.definitionId === 'forest' || card.definitionId === 'island' || card.definitionId === 'mountain').toBe(true);
    }
    // Color-fixing heuristic prefers DISTINCT basic subtypes, so it does not take
    // both Forests when other colors are available.
    const defs = bf.map(id => s.cards.get(id)!.definitionId);
    expect(new Set(defs).size).toBe(2);

    // Non-basic land and creature were never fetched.
    expect(zone(s, 'du')).toBe('library');
    expect(zone(s, 'bz')).toBe('library');
  });

  it('"up to two Forest cards": only cards with the Forest subtype are fetched', () => {
    const p = parseOracleText('Search your library for up to two Forest cards, put them onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(libState(), p.effects, 'p0', [], []);
    const bf = onBf(s);
    expect(bf.length).toBe(2);
    // Every fetched card has the Forest subtype (basic Forest OR the Mountain
    // Forest dual — both legally match "Forest cards"). Non-Forest lands stay.
    for (const id of bf) {
      const card = s.cards.get(id)!;
      expect(card.tapped).toBe(true);
      expect(['f1', 'f2', 'du']).toContain(id);
    }
    expect(zone(s, 'is')).toBe('library'); // Island never matches
    expect(zone(s, 'mt')).toBe('library'); // pure Mountain never matches
    expect(zone(s, 'bz')).toBe('library'); // creature never matches
  });

  it('takes only as many as exist when fewer than N match (up to N is a cap)', () => {
    // Library with a single matching basic land but a cap of two.
    const s0 = libState();
    s0.cards.delete('f2'); s0.cards.delete('is'); s0.cards.delete('mt');
    const p = parseOracleText('Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect(onBf(s)).toEqual(['f1']); // exactly one (only one basic existed)
  });
});

describe('multiselect-search: destination to hand', () => {
  it('"up to two basic land cards ... put them into your hand"', () => {
    const p = parseOracleText('Search your library for up to two basic land cards, put them into your hand, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.maxSelections).toBe(2);
    expect(sl.destination).toBe('hand');
    const s = executeEffects(libState(), p.effects, 'p0', [], []);
    const inHand = [...s.cards.values()].filter(c => c.zone === 'hand').map(c => c.instanceId);
    expect(inHand.length).toBe(2);
  });
});

describe('multiselect-search: single-card path is unchanged', () => {
  it('"a basic land card ... put it ... tapped" still moves exactly ONE', () => {
    const p = parseOracleText('Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const sl = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(sl.maxSelections).toBeUndefined(); // no multi flag on the single-card wording
    const s = executeEffects(libState(), p.effects, 'p0', [], []);
    expect(onBf(s).length).toBe(1);
    expect(s.cards.get(onBf(s)[0])!.tapped).toBe(true);
  });

  it('direct executeSearchLibrary call with no selection moves exactly one', () => {
    const s = executeSearchLibrary(libState(), 'p0', { supertypes: ['basic'], types: ['land'] }, 'battlefield', true, true);
    expect(onBf(s).length).toBe(1);
  });
});

describe('multiselect-search: deterministic (no unseeded randomness)', () => {
  it('repeated runs produce identical selections', () => {
    const p = parseOracleText('Search your library for up to two basic land cards, put them onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    const a = onBf(executeEffects(libState(), p.effects, 'p0', [], []));
    const b = onBf(executeEffects(libState(), p.effects, 'p0', [], []));
    expect(a).toEqual(b);
  });
});
