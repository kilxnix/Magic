import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// Typed / supertyped tutor-to-hand: "Search your library for a <type> card,
// reveal it, put it into your hand, then shuffle." The executor's
// executeSearchLibrary + matchesCardFilter genuinely match types (OR via .some),
// subtypes, and supertypes to the hand zone, so these run honestly end-to-end.

const lightningBolt: CardDefinition = { id: 'bolt', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'] };
const divination: CardDefinition = { id: 'div', name: 'Divination', type_line: 'Sorcery', oracle_text: 'Draw two cards.', mana_cost: '{2}{U}', cmc: 3, colors: ['U'], color_identity: ['U'], keywords: [], card_types: ['sorcery'] };
const solRing: CardDefinition = { id: 'sol', name: 'Sol Ring', type_line: 'Artifact', oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['artifact'] };
const ench: CardDefinition = { id: 'ench', name: 'Pacifism', type_line: 'Enchantment — Aura', oracle_text: '', mana_cost: '{1}{W}', cmc: 2, colors: ['W'], color_identity: ['W'], keywords: [], card_types: ['enchantment'] };
const legend: CardDefinition = { id: 'gisela', name: 'Gisela, Blade of Goldnight', type_line: 'Legendary Creature — Angel', oracle_text: '', mana_cost: '{5}{R}{W}', cmc: 7, colors: ['R', 'W'], color_identity: ['R', 'W'], keywords: ['flying'], card_types: ['creature'], power: 5, toughness: 5 };
const plainCreature: CardDefinition = { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId: owner, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

function libState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([
      ['c_bolt', mk('c_bolt', 'bolt', 'p0', 'library')],
      ['c_div', mk('c_div', 'div', 'p0', 'library')],
      ['c_sol', mk('c_sol', 'sol', 'p0', 'library')],
      ['c_ench', mk('c_ench', 'ench', 'p0', 'library')],
      ['c_leg', mk('c_leg', 'gisela', 'p0', 'library')],
      ['c_bear', mk('c_bear', 'bear', 'p0', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      ['bolt', lightningBolt], ['div', divination], ['sol', solRing],
      ['ench', ench], ['gisela', legend], ['bear', plainCreature],
    ]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function zone(s: GameState, id: string): string { return s.cards.get(id)!.zone; }

describe('tutor-to-hand: "instant or sorcery" type-list (Mystical Tutor style)', () => {
  it('parses the OR type-list to a hand search and fetches an instant OR sorcery', () => {
    const p = parseOracleText('Search your library for an instant or sorcery card, reveal it, put it into your hand, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const search = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(search.filter.types).toEqual(['instant', 'sorcery']);
    expect(search.destination).toBe('hand');

    const s = executeEffects(libState(), p.effects, 'p0', [], []);
    // Exactly one instant-or-sorcery moved to hand; non-matching cards stayed.
    const moved = ['c_bolt', 'c_div'].filter(id => zone(s, id) === 'hand');
    expect(moved.length).toBe(1);
    expect(zone(s, 'c_sol')).toBe('library');
    expect(zone(s, 'c_ench')).toBe('library');
    expect(zone(s, 'c_bear')).toBe('library');
  });
});

describe('tutor-to-hand: "artifact or enchantment" type-list', () => {
  it('fetches an artifact OR enchantment to hand, not an instant/creature', () => {
    const p = parseOracleText('Search your library for an artifact or enchantment card, reveal it, put it into your hand, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const search = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(search.filter.types).toEqual(['artifact', 'enchantment']);

    const s = executeEffects(libState(), p.effects, 'p0', [], []);
    const moved = ['c_sol', 'c_ench'].filter(id => zone(s, id) === 'hand');
    expect(moved.length).toBe(1);
    expect(zone(s, 'c_bolt')).toBe('library');
    expect(zone(s, 'c_bear')).toBe('library');
  });
});

describe('tutor-to-hand: "legendary creature" supertype+type', () => {
  it('emits a Legendary+creature filter and fetches only the legendary creature', () => {
    const p = parseOracleText('Search your library for a legendary creature card, reveal it, put it into your hand, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const search = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(search.filter.types).toEqual(['creature']);
    expect(search.filter.supertypes).toEqual(['Legendary']);

    const s = executeEffects(libState(), p.effects, 'p0', [], []);
    // The legendary creature goes to hand; the plain (non-legendary) Bear does NOT.
    expect(zone(s, 'c_leg')).toBe('hand');
    expect(zone(s, 'c_bear')).toBe('library');
  });
});

describe('tutor-to-hand: single-type creature tutor still works (regression)', () => {
  it('fetches a creature card to hand', () => {
    const p = parseOracleText('Search your library for a creature card, reveal it, put it into your hand, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const s = executeEffects(libState(), p.effects, 'p0', [], []);
    const moved = ['c_leg', 'c_bear'].filter(id => zone(s, id) === 'hand');
    expect(moved.length).toBe(1);
    expect(zone(s, 'c_bolt')).toBe('library');
  });
});
