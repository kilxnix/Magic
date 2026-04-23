import { describe, it, expect } from 'vitest';
import { checkStateBasedActions, cleanupDamage } from './state-based';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';
import { makeTestState } from './__tests__/test-helpers';

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

describe('Commander Damage Loss', () => {
  it('player with 21 commander damage from one commander loses', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].commanderDamage = { 'inst_cmd': 21 };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with more than 21 commander damage loses', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].commanderDamage = { 'inst_cmd': 25 };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with less than 21 commander damage survives', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].commanderDamage = { 'inst_cmd': 20 };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(false);
  });

  it('commander damage from different commanders does not stack for loss', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [], commanderId: 'cmd3' },
    ];
    const state = initGameState(decks);
    // 15 from one commander, 10 from another = 25 total, but neither is >= 21
    state.players[0].commanderDamage = {
      'inst_cmd_2': 15,
      'inst_cmd_3': 10,
    };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(false);
  });

  it('player loses if any single commander dealt 21+ damage', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [], commanderId: 'cmd3' },
    ];
    const state = initGameState(decks);
    // One commander dealt 21, another dealt less
    state.players[0].commanderDamage = {
      'inst_cmd_2': 21,
      'inst_cmd_3': 5,
    };

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('already lost player is not checked for commander damage', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    state.players[0].hasLost = true;
    state.players[0].commanderDamage = { 'inst_cmd': 21 };

    // Should not throw or change anything
    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
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

describe('Poison Counter Loss', () => {
  it('player with 10+ poison counters loses', () => {
    const state = makeTestState({});
    state.players[0] = { ...state.players[0], poisonCounters: 10 };
    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with 9 poison counters does not lose', () => {
    const state = makeTestState({});
    state.players[0] = { ...state.players[0], poisonCounters: 9 };
    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(false);
  });
});
