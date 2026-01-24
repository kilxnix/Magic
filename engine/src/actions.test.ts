import { describe, it, expect } from 'vitest';
import { playLand, canPlayLand, tapLandForMana, drawCards } from './actions';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';

function makeForest(): CardDefinition {
  return {
    id: 'forest-1',
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeIsland(): CardDefinition {
  return {
    id: 'island-1',
    name: 'Island',
    type_line: 'Basic Land — Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeCreature(): CardDefinition {
  return {
    id: 'bear-1',
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

describe('Land Actions', () => {
  describe('canPlayLand', () => {
    it('returns true during main phase with land in hand', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main', step: 'begin_combat' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(true);
    });

    it('returns false if not active player', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      state = { ...state, activePlayerIndex: 1, phase: 'precombat_main' };
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false if already played a land this turn', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      state.players[0].hasPlayedLand = true;
      state = { ...state, phase: 'precombat_main' };
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false if not a main phase', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'combat' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false if card is not a land', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeCreature()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });
  });

  describe('playLand', () => {
    it('moves land from hand to battlefield and marks land played', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      const next = playLand(state, 'p1', card.instanceId);
      const played = next.cards.get(card.instanceId)!;
      expect(played.zone).toBe('battlefield');
      expect(next.players[0].hasPlayedLand).toBe(true);
    });
  });

  describe('tapLandForMana', () => {
    it('taps a land and adds mana to pool', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });

      const next = tapLandForMana(state, 'p1', card.instanceId, 'G');
      expect(next.cards.get(card.instanceId)!.tapped).toBe(true);
      expect(next.players[0].manaPool.G).toBe(1);
    });

    it('throws if land is already tapped', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: true });

      expect(() => tapLandForMana(state, 'p1', card.instanceId, 'G')).toThrow();
    });
  });

  describe('drawCards', () => {
    it('moves top card from library to hand', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      const state = initGameState(decks);

      const next = drawCards(state, 'p1', 1);
      const hand = getCardsInZone(next, 'p1', 'hand');
      const library = getCardsInZone(next, 'p1', 'library');
      expect(hand).toHaveLength(1);
      expect(library).toHaveLength(0);
    });

    it('draws multiple cards', () => {
      const cards = [makeForest(), makeIsland()];
      const decks = [{
        playerId: 'p1', name: 'Alice', cards, commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      const state = initGameState(decks);

      const next = drawCards(state, 'p1', 2);
      const hand = getCardsInZone(next, 'p1', 'hand');
      expect(hand).toHaveLength(2);
    });

    it('draws fewer if library is empty', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      const state = initGameState(decks);

      const next = drawCards(state, 'p1', 5);
      const hand = getCardsInZone(next, 'p1', 'hand');
      expect(hand).toHaveLength(1);
    });
  });
});
