import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// Basic / snow lands used as library search targets.
const forest: CardDefinition = { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'] };
const snowForest: CardDefinition = { id: 'snow-forest', name: 'Snow-Covered Forest', type_line: 'Basic Snow Land — Forest', oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'] };
const snowDual: CardDefinition = { id: 'snow-dual', name: 'Highland Forest', type_line: 'Snow Land — Mountain Forest', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['R', 'G'], keywords: [], card_types: ['land'] };
const bear: CardDefinition = { id: 'bear', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };

function mk(id: string, defId: string, owner: string, zone: CardInstance['zone']): CardInstance {
  return { instanceId: id, definitionId: defId, ownerId: owner, zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false };
}

function libState(): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([
      ['lf', mk('lf', 'forest', 'p0', 'library')],         // basic Forest in library
      ['sf', mk('sf', 'snow-forest', 'p0', 'library')],     // basic snow Forest in library
      ['sd', mk('sd', 'snow-dual', 'p0', 'library')],       // non-basic snow land in library
      ['bz', mk('bz', 'bear', 'p0', 'library')],            // creature decoy (must NOT be fetched)
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      ['forest', forest], ['snow-forest', snowForest], ['snow-dual', snowDual], ['bear', bear],
    ]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function libZone(s: GameState, id: string): string { return s.cards.get(id)!.zone; }

describe('search-ramp: basic-land fetch onto battlefield tapped (Rampant Growth)', () => {
  it('moves exactly one basic land from library to battlefield tapped', () => {
    const p = parseOracleText('Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const s = executeEffects(libState(), p.effects, 'p0', [], []);

    // A basic land moved to the battlefield...
    const onBattlefield = ['lf', 'sf'].filter(id => libZone(s, id) === 'battlefield');
    expect(onBattlefield.length).toBe(1);
    expect(s.cards.get(onBattlefield[0])!.tapped).toBe(true); // entered tapped per the spell

    // ...the creature was never a candidate, and the non-basic land stayed put.
    expect(libZone(s, 'bz')).toBe('library');
    expect(libZone(s, 'sd')).toBe('library');
  });
});

describe('search-ramp: basic-land fetch to hand (Lay of the Land)', () => {
  it('moves one basic land from library to hand, untapped flag irrelevant', () => {
    const p = parseOracleText('Search your library for a basic land card, reveal it, put it into your hand, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const s = executeEffects(libState(), p.effects, 'p0', [], []);

    const inHand = ['lf', 'sf'].filter(id => libZone(s, id) === 'hand');
    expect(inHand.length).toBe(1);
    expect(libZone(s, 'bz')).toBe('library');
  });
});

describe('search-ramp: snow-land fetch (Into the North) — newly supported', () => {
  it('fetches a snow land (basic OR nonbasic) onto the battlefield tapped, not a non-snow basic', () => {
    const p = parseOracleText('Search your library for a snow land card, put it onto the battlefield tapped, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);

    // Verify the filter the parser emitted is the honest snow-supertype filter.
    const search = p.effects.find(e => e.kind === 'SearchLibrary') as any;
    expect(search.filter.supertypes).toContain('snow');
    expect(search.filter.types).toContain('land');

    const s = executeEffects(libState(), p.effects, 'p0', [], []);

    // A snow land moved to the battlefield, tapped. The plain Forest (no snow) must NOT.
    const snowOnBf = ['sf', 'sd'].filter(id => libZone(s, id) === 'battlefield');
    expect(snowOnBf.length).toBe(1);
    expect(s.cards.get(snowOnBf[0])!.tapped).toBe(true);
    expect(libZone(s, 'lf')).toBe('library'); // non-snow basic Forest untouched
    expect(libZone(s, 'bz')).toBe('library');
  });

  it('snow land fetch to hand also works (Into the North variant)', () => {
    const p = parseOracleText('Search your library for a snow land card, reveal it, put it into your hand, then shuffle.');
    if (p.kind !== 'Spell') throw new Error('expected Spell, got ' + p.kind);
    const s = executeEffects(libState(), p.effects, 'p0', [], []);
    const snowInHand = ['sf', 'sd'].filter(id => libZone(s, id) === 'hand');
    expect(snowInHand.length).toBe(1);
    expect(libZone(s, 'lf')).toBe('library'); // non-snow basic untouched
  });
});
