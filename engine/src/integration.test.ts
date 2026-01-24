import { describe, it, expect } from 'vitest';
import { initGameState, getCardsInZone } from './game-state';
import { advanceStep, performUntapStep } from './turn-manager';
import { playLand, tapLandForMana, drawCards } from './actions';
import { canPayCost, parseManaString } from './mana';
import { passPriority, allPlayersPassed } from './priority';
import { CardDefinition } from './types';

function makeForest(): CardDefinition {
  return {
    id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
  };
}

function makeMountain(): CardDefinition {
  return {
    id: 'mountain-1', name: 'Mountain', type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['R'], keywords: [], card_types: ['land'],
  };
}

describe('Integration: Full Turn Cycle', () => {
  it('player can untap, draw, play land, tap for mana in a single turn', () => {
    const p1Cards = [makeForest(), makeMountain()];
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: p1Cards, commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // --- Turn 1, P1 ---
    // Untap step: nothing to untap yet
    state = performUntapStep(state);

    // Advance through beginning phase to main
    state = advanceStep(state); // upkeep
    expect(state.step).toBe('upkeep');
    state = advanceStep(state); // draw
    expect(state.step).toBe('draw');

    // Draw a card
    state = drawCards(state, 'p1', 1);
    const hand = getCardsInZone(state, 'p1', 'hand');
    expect(hand).toHaveLength(1);

    // Advance to precombat main
    state = advanceStep(state); // begin_combat (phase = precombat_main)
    expect(state.phase).toBe('precombat_main');

    // Play a land from hand
    const landInHand = getCardsInZone(state, 'p1', 'hand')[0];
    state = playLand(state, 'p1', landInHand.instanceId);
    expect(state.players[0].hasPlayedLand).toBe(true);

    // Tap the land for mana
    state = tapLandForMana(state, 'p1', landInHand.instanceId, 'G');
    expect(state.players[0].manaPool.G).toBe(1);

    // Check we can pay {G}
    const cost = parseManaString('{G}');
    expect(canPayCost(state.players[0].manaPool, cost)).toBe(true);

    // Both players pass priority
    state = passPriority(state); // p1 passes
    state = passPriority(state); // p2 passes
    expect(allPlayersPassed(state)).toBe(true);

    // Advance through combat and ending
    state = advanceStep(state); // declare_attackers
    state = advanceStep(state); // declare_blockers
    state = advanceStep(state); // first_strike_damage
    state = advanceStep(state); // combat_damage
    state = advanceStep(state); // end_of_combat
    state = advanceStep(state); // end (phase = postcombat_main)
    state = advanceStep(state); // cleanup
    state = advanceStep(state); // cleanup -> next turn

    // Now it's P2's turn
    expect(state.activePlayerIndex).toBe(1);
    expect(state.turnNumber).toBe(2);
    expect(state.players[1].hasPlayedLand).toBe(false); // new active player starts fresh
  });

  it('played land untaps next turn', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeForest()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Move forest to hand, go to main phase
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'hand' });
    state = { ...state, phase: 'precombat_main' };

    // Play and tap
    state = playLand(state, 'p1', card.instanceId);
    state = tapLandForMana(state, 'p1', card.instanceId, 'G');
    expect(state.cards.get(card.instanceId)!.tapped).toBe(true);

    // Advance to P2's turn, then back to P1's turn
    state = { ...state, step: 'cleanup', phase: 'ending' };
    state = advanceStep(state); // P2's turn
    state = { ...state, step: 'cleanup', phase: 'ending' };
    state = advanceStep(state); // Back to P1

    // Untap step
    state = performUntapStep(state);
    expect(state.cards.get(card.instanceId)!.tapped).toBe(false);
  });
});
