import { describe, it, expect } from 'vitest';
import { checkStateBasedActions, cleanupDamage } from './state-based';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';

function makeBear(id: string = 'bear-1'): CardDefinition {
  return {
    id,
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

describe('State-Based Actions', () => {
  it('creature with damage >= toughness moves to graveyard', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 2 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');
  });

  it('creature with damage > toughness also dies', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 5 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');
  });

  it('creature with damage < toughness survives', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 1 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('battlefield');
  });

  it('dead creatures have damage reset when moved to graveyard', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 3 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(0);
  });

  it('player with life <= 0 is marked as lost', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].life = 0;

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with negative life is marked as lost', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].life = -5;

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('handles multiple creatures dying at once', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear('b1'), makeBear('b2')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const cards = getCardsInZone(state, 'p1', 'library');
    state.cards.set(cards[0].instanceId, { ...cards[0], zone: 'battlefield', damage: 2 });
    state.cards.set(cards[1].instanceId, { ...cards[1], zone: 'battlefield', damage: 3 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(cards[0].instanceId)!.zone).toBe('graveyard');
    expect(next.cards.get(cards[1].instanceId)!.zone).toBe('graveyard');
  });
});

describe('cleanupDamage', () => {
  it('removes all damage from creatures on battlefield', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 1 });

    const next = cleanupDamage(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(0);
  });

  it('does not affect cards in other zones', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'graveyard', damage: 3 });

    const next = cleanupDamage(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(3);
  });
});
