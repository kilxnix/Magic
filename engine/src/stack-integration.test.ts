import { describe, it, expect } from 'vitest';
import { initGameState, getCardsInZone } from './game-state';
import { playLand, tapLandForMana } from './actions';
import { passPriority, allPlayersPassed } from './priority';
import { castSpell, resolveTopOfStack } from './stack';
import { CardDefinition } from './types';

function makeForest(id: string = 'forest-1'): CardDefinition {
  return {
    id, name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
  };
}

function makeMountain(id: string = 'mountain-1'): CardDefinition {
  return {
    id, name: 'Mountain', type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['R'], keywords: [], card_types: ['land'],
  };
}

function makeBear(): CardDefinition {
  return {
    id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  };
}

function makeBolt(): CardDefinition {
  return {
    id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    mana_cost: '{R}', cmc: 1,
    colors: ['R'], color_identity: ['R'], keywords: [],
    card_types: ['instant'],
  };
}

describe('Stack Integration: Cast and Resolve', () => {
  it('full turn: play lands, cast creature, resolve to battlefield', () => {
    const p1Cards = [makeForest('f1'), makeForest('f2'), makeBear()];
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: p1Cards, commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Put forests on battlefield, bear in hand
    for (const card of state.cards.values()) {
      if (card.ownerId === 'p1') {
        const def = state.cardDefinitions.get(card.definitionId)!;
        if (def.card_types.includes('land')) {
          state.cards.set(card.instanceId, { ...card, zone: 'battlefield' });
        } else {
          state.cards.set(card.instanceId, { ...card, zone: 'hand' });
        }
      }
    }
    state = { ...state, phase: 'precombat_main' as any };

    // Tap both forests for mana
    const lands = getCardsInZone(state, 'p1', 'battlefield');
    state = tapLandForMana(state, 'p1', lands[0].instanceId, 'G');
    state = tapLandForMana(state, 'p1', lands[1].instanceId, 'G');
    expect(state.players[0].manaPool.G).toBe(2);

    // Cast Grizzly Bears ({1}{G})
    const bear = getCardsInZone(state, 'p1', 'hand')[0];
    state = castSpell(state, 'p1', bear.instanceId);
    expect(state.stack).toHaveLength(1);
    expect(state.players[0].manaPool.G).toBe(0);

    // Both players pass priority
    state = passPriority(state);
    state = passPriority(state);
    expect(allPlayersPassed(state)).toBe(true);

    // Resolve
    state = resolveTopOfStack(state);
    expect(state.stack).toHaveLength(0);
    expect(state.cards.get(bear.instanceId)!.zone).toBe('battlefield');
    expect(state.cards.get(bear.instanceId)!.summoningSick).toBe(true);
  });

  it('lightning bolt kills creature after it resolves', () => {
    // Note: You cannot target a spell on the stack with "any target" in MTG
    // "Any target" means creatures, players, or planeswalkers on the battlefield
    const p1Cards = [makeForest('f1'), makeForest('f2'), makeBear()];
    const p2Cards = [makeMountain(), makeBolt()];
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: p1Cards, commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: p2Cards, commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Setup zones
    for (const card of state.cards.values()) {
      const def = state.cardDefinitions.get(card.definitionId)!;
      if (def.card_types.includes('land')) {
        state.cards.set(card.instanceId, { ...card, zone: 'battlefield' });
      } else {
        state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      }
    }
    state = { ...state, phase: 'precombat_main' as any };

    // P1 taps and casts bear
    const p1Lands = getCardsInZone(state, 'p1', 'battlefield');
    state = tapLandForMana(state, 'p1', p1Lands[0].instanceId, 'G');
    state = tapLandForMana(state, 'p1', p1Lands[1].instanceId, 'G');
    const bear = getCardsInZone(state, 'p1', 'hand')[0];
    state = castSpell(state, 'p1', bear.instanceId);
    expect(state.stack).toHaveLength(1);

    // Bear resolves to battlefield
    state = resolveTopOfStack(state);
    expect(state.cards.get(bear.instanceId)!.zone).toBe('battlefield');

    // Now P2 can bolt the bear (it's on the battlefield now)
    const p2Land = getCardsInZone(state, 'p2', 'battlefield')[0];
    state = tapLandForMana(state, 'p2', p2Land.instanceId, 'R');
    const bolt = getCardsInZone(state, 'p2', 'hand')[0];
    state = castSpell(state, 'p2', bolt.instanceId, [bear.instanceId]);
    expect(state.stack).toHaveLength(1);

    // Bolt resolves and kills the 2/2 bear
    state = resolveTopOfStack(state);
    expect(state.cards.get(bolt.instanceId)!.zone).toBe('graveyard');
    expect(state.cards.get(bear.instanceId)!.zone).toBe('graveyard');
    expect(state.stack).toHaveLength(0);
  });
});
