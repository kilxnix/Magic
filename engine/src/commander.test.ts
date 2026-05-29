import { describe, it, expect } from 'vitest';
import {
  isOwnersCommander,
  getCommanderDestinationZone,
  moveCardWithCommanderReplacement,
  processZoneChangesWithCommanderReplacement,
} from './commander';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';

function makeCommander(): CardDefinition {
  return {
    id: 'cmd-1',
    name: 'Test Commander',
    type_line: 'Legendary Creature — Human',
    oracle_text: '',
    mana_cost: '{2}{W}{U}',
    cmc: 4,
    colors: ['W', 'U'],
    color_identity: ['W', 'U'],
    keywords: [],
    card_types: ['creature'],
    power: 3,
    toughness: 3,
  };
}

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

describe('Commander Replacement Rule', () => {
  describe('isOwnersCommander', () => {
    it('returns true for a player\'s commander', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander, makeBear()], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);

      // Find the commander instance
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];
      expect(isOwnersCommander(state, commanderInstance.instanceId)).toBe(true);
    });

    it('returns false for a non-commander card', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander, makeBear()], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);

      // Find the bear instance
      const bearInstance = getCardsInZone(state, 'p1', 'library')[0];
      expect(isOwnersCommander(state, bearInstance.instanceId)).toBe(false);
    });

    it('returns false for non-existent card', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);

      expect(isOwnersCommander(state, 'nonexistent')).toBe(false);
    });
  });

  describe('getCommanderDestinationZone', () => {
    it('returns command zone when commander would go to graveyard', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];

      const zone = getCommanderDestinationZone(state, commanderInstance.instanceId, 'graveyard');
      expect(zone).toBe('command');
    });

    it('returns command zone when commander would go to exile', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];

      const zone = getCommanderDestinationZone(state, commanderInstance.instanceId, 'exile');
      expect(zone).toBe('command');
    });

    it('returns graveyard for non-commander card going to graveyard', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeCommander(), makeBear()], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);
      const bearInstance = getCardsInZone(state, 'p1', 'library')[0];

      const zone = getCommanderDestinationZone(state, bearInstance.instanceId, 'graveyard');
      expect(zone).toBe('graveyard');
    });

    it('returns command zone when commander would go to hand by default', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];

      const zone = getCommanderDestinationZone(state, commanderInstance.instanceId, 'hand');
      expect(zone).toBe('command');
    });

    it('can still explicitly allow commander to go to hand for future choice prompts', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];

      const zone = getCommanderDestinationZone(state, commanderInstance.instanceId, 'hand', false);
      expect(zone).toBe('hand');
    });

    it('allows commander to go to battlefield (no replacement)', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      const state = initGameState(decks);
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];

      const zone = getCommanderDestinationZone(state, commanderInstance.instanceId, 'battlefield');
      expect(zone).toBe('battlefield');
    });
  });

  describe('moveCardWithCommanderReplacement', () => {
    it('moves commander to command zone instead of graveyard', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      let state = initGameState(decks);
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];

      // Move to battlefield first
      state.cards.set(commanderInstance.instanceId, {
        ...commanderInstance,
        zone: 'battlefield',
        damage: 3,
        tapped: true,
      });

      // Try to move to graveyard (should go to command zone)
      const newState = moveCardWithCommanderReplacement(state, commanderInstance.instanceId, 'graveyard');
      const movedCard = newState.cards.get(commanderInstance.instanceId)!;

      expect(movedCard.zone).toBe('command');
      expect(movedCard.damage).toBe(0);
      expect(movedCard.tapped).toBe(false);
    });

    it('moves commander to command zone instead of exile', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      let state = initGameState(decks);
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];

      // Move to battlefield first
      state.cards.set(commanderInstance.instanceId, {
        ...commanderInstance,
        zone: 'battlefield',
      });

      // Try to move to exile (should go to command zone)
      const newState = moveCardWithCommanderReplacement(state, commanderInstance.instanceId, 'exile');
      expect(newState.cards.get(commanderInstance.instanceId)!.zone).toBe('command');
    });

    it('moves non-commander to graveyard normally', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeCommander(), makeBear()], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      let state = initGameState(decks);
      const bearInstance = getCardsInZone(state, 'p1', 'library')[0];

      // Move to battlefield first
      state.cards.set(bearInstance.instanceId, {
        ...bearInstance,
        zone: 'battlefield',
        damage: 2,
      });

      // Move to graveyard (should actually go to graveyard)
      const newState = moveCardWithCommanderReplacement(state, bearInstance.instanceId, 'graveyard');
      const movedCard = newState.cards.get(bearInstance.instanceId)!;

      expect(movedCard.zone).toBe('graveyard');
      expect(movedCard.damage).toBe(0);
    });

    it('resets damage and tapped status when leaving battlefield', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      let state = initGameState(decks);
      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];

      // Put on battlefield with damage and tapped
      state.cards.set(commanderInstance.instanceId, {
        ...commanderInstance,
        zone: 'battlefield',
        damage: 2,
        tapped: true,
        summoningSick: false,
      });

      // Move to command zone (via graveyard replacement)
      const newState = moveCardWithCommanderReplacement(state, commanderInstance.instanceId, 'graveyard');
      const movedCard = newState.cards.get(commanderInstance.instanceId)!;

      expect(movedCard.damage).toBe(0);
      expect(movedCard.tapped).toBe(false);
      expect(movedCard.summoningSick).toBe(true);
    });
  });

  describe('processZoneChangesWithCommanderReplacement', () => {
    it('processes multiple zone changes with commander replacement', () => {
      const commander = makeCommander();
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [commander, makeBear('b1'), makeBear('b2')], commanderId: 'cmd-1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd-2' },
      ];
      let state = initGameState(decks);

      const commanderInstance = getCardsInZone(state, 'p1', 'command')[0];
      const bears = getCardsInZone(state, 'p1', 'library');

      // Put all on battlefield
      state.cards.set(commanderInstance.instanceId, { ...commanderInstance, zone: 'battlefield' });
      state.cards.set(bears[0].instanceId, { ...bears[0], zone: 'battlefield' });
      state.cards.set(bears[1].instanceId, { ...bears[1], zone: 'battlefield' });

      // Process zone changes - commander to graveyard (replacement), bears to graveyard
      const newState = processZoneChangesWithCommanderReplacement(state, [
        { cardInstanceId: commanderInstance.instanceId, intendedZone: 'graveyard' },
        { cardInstanceId: bears[0].instanceId, intendedZone: 'graveyard' },
        { cardInstanceId: bears[1].instanceId, intendedZone: 'exile' },
      ]);

      expect(newState.cards.get(commanderInstance.instanceId)!.zone).toBe('command');
      expect(newState.cards.get(bears[0].instanceId)!.zone).toBe('graveyard');
      expect(newState.cards.get(bears[1].instanceId)!.zone).toBe('exile');
    });
  });
});
