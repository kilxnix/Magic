import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

const forest: CardDefinition = { id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'] };
const bear: CardDefinition = { id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{1}{G}', cmc: 2, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };
const bolt: CardDefinition = { id: 'bolt', name: 'Bolt', type_line: 'Instant', oracle_text: '', mana_cost: '{R}', cmc: 1, colors: ['R'], color_identity: ['R'], keywords: [], card_types: ['instant'] };

/**
 * Build a state whose library (in iteration order = top-first) is the given def ids.
 * The library cards belong to p0.
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
    cardDefinitions: new Map<string, CardDefinition>([['forest', forest], ['bear', bear], ['bolt', bolt]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function libIds(s: GameState): string[] {
  return [...s.cards.values()].filter(c => c.zone === 'library').map(c => c.instanceId);
}

describe('reveal-top-take family (ChooseFromTopOfLibrary with type filter)', () => {
  const text = 'Reveal the top five cards of your library. Put any number of land cards from among them into your hand. Put the rest on the bottom of your library in a random order.';

  it('parses to a filtered ChooseFromTopOfLibrary effect (honest mechanism)', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('expected Spell');
    expect(p.effects).toHaveLength(1);
    const e = p.effects[0];
    expect(e.kind).toBe('ChooseFromTopOfLibrary');
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('x');
    expect(e.count).toBe(5);
    expect(e.destination).toBe('hand');
    expect(e.restDestination).toBe('bottom');
    expect(e.minSelections).toBe(0);
    expect(e.filter).toEqual({ types: ['land'] });
  });

  it('takes the matching (land) cards from the revealed top N into hand and bottoms the rest', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('x');
    // Top 5: forest, bear, forest, bolt, bear ; plus a 6th card untouched.
    const s0 = state(['forest', 'bear', 'forest', 'bolt', 'bear', 'forest']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);

    // The two lands among the revealed top 5 went to hand.
    const hand = [...s.cards.values()].filter(c => c.zone === 'hand');
    expect(hand.map(c => c.instanceId).sort()).toEqual(['lib0', 'lib2']);
    expect(hand.every(c => s.cardDefinitions.get(c.definitionId)!.card_types.includes('land'))).toBe(true);

    // The 6th (untouched) card stays on top; the 3 non-land revealed cards went to bottom.
    const lib = libIds(s);
    expect(lib).toContain('lib5'); // never revealed, stays
    expect(lib).toEqual(expect.arrayContaining(['lib1', 'lib3', 'lib4'])); // bear, bolt, bear bottomed
    // No revealed land left in the library.
    for (const id of lib) {
      const def = s.cardDefinitions.get(s.cards.get(id)!.definitionId)!;
      if (['lib0', 'lib2'].includes(id)) throw new Error('land should have left library');
      expect(def).toBeDefined();
    }
    // Total library count = original 6 minus 2 taken = 4.
    expect(lib.length).toBe(4);
  });

  it('takes nothing when no revealed card matches the filter; all go to bottom', () => {
    const p = parseOracleText(text);
    if (p.kind !== 'Spell') throw new Error('x');
    const s0 = state(['bear', 'bolt', 'bear', 'bolt', 'bear', 'forest']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    expect([...s.cards.values()].filter(c => c.zone === 'hand')).toHaveLength(0);
    // Library unchanged in membership (6 cards), still all in library.
    expect(libIds(s).length).toBe(6);
  });

  it('supports the creature variant', () => {
    const ctext = 'Reveal the top three cards of your library. Put any number of creature cards from among them into your hand. Put the rest on the bottom of your library.';
    const p = parseOracleText(ctext);
    if (p.kind !== 'Spell') throw new Error('x');
    const e = p.effects[0];
    if (e.kind !== 'ChooseFromTopOfLibrary') throw new Error('expected ChooseFromTopOfLibrary');
    expect(e.count).toBe(3);
    expect(e.filter).toEqual({ types: ['creature'] });

    const s0 = state(['forest', 'bear', 'bolt', 'bear']);
    const s = executeEffects(s0, p.effects, 'p0', [], []);
    const hand = [...s.cards.values()].filter(c => c.zone === 'hand');
    // Only lib1 (bear) is a creature in the top 3.
    expect(hand.map(c => c.instanceId)).toEqual(['lib1']);
    expect(libIds(s).length).toBe(3); // 4 - 1 taken
  });
});
