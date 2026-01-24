import { describe, it, expect } from 'vitest';
import { advanceStep, advanceToNextTurn, performUntapStep, STEP_ORDER } from './turn-manager';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';

function makeEmptyDecks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `Player ${i + 1}`,
    cards: [] as CardDefinition[],
    commanderId: `cmd${i + 1}`,
  }));
}

describe('Turn Manager', () => {
  describe('STEP_ORDER', () => {
    it('has 11 steps in correct MTG order', () => {
      expect(STEP_ORDER).toEqual([
        'untap', 'upkeep', 'draw',
        'begin_combat', 'declare_attackers', 'declare_blockers',
        'first_strike_damage', 'combat_damage', 'end_of_combat',
        'end', 'cleanup',
      ]);
    });
  });

  describe('advanceStep', () => {
    it('advances from untap to upkeep', () => {
      const state = initGameState(makeEmptyDecks(2));
      const next = advanceStep(state);
      expect(next.step).toBe('upkeep');
      expect(next.phase).toBe('beginning');
    });

    it('advances from draw to begin_combat (entering precombat_main then combat)', () => {
      let state = initGameState(makeEmptyDecks(2));
      state = { ...state, step: 'draw', phase: 'beginning' };
      const next = advanceStep(state);
      expect(next.step).toBe('begin_combat');
      expect(next.phase).toBe('precombat_main');
    });

    it('advances from end_of_combat to end (through postcombat_main)', () => {
      let state = initGameState(makeEmptyDecks(2));
      state = { ...state, step: 'end_of_combat', phase: 'combat' };
      const next = advanceStep(state);
      expect(next.step).toBe('end');
      expect(next.phase).toBe('postcombat_main');
    });

    it('cleanup wraps to untap of next turn', () => {
      let state = initGameState(makeEmptyDecks(2));
      state = { ...state, step: 'cleanup', phase: 'ending' };
      const next = advanceStep(state);
      expect(next.step).toBe('untap');
      expect(next.phase).toBe('beginning');
      expect(next.activePlayerIndex).toBe(1);
      expect(next.turnNumber).toBe(2);
    });

    it('resets hasPlayedLand on new turn', () => {
      let state = initGameState(makeEmptyDecks(2));
      state.players[0].hasPlayedLand = true;
      state = { ...state, step: 'cleanup', phase: 'ending' };
      const next = advanceStep(state);
      expect(next.players[1].hasPlayedLand).toBe(false);
    });

    it('resets priority passed flags on step advance', () => {
      let state = initGameState(makeEmptyDecks(2));
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      const next = advanceStep(state);
      expect(next.hasPriorityPassed.every(p => p === false)).toBe(true);
    });
  });

  describe('advanceToNextTurn', () => {
    it('wraps active player around (2 players)', () => {
      let state = initGameState(makeEmptyDecks(2));
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(1);
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(0);
      expect(state.turnNumber).toBe(3);
    });

    it('wraps active player around (4 players)', () => {
      let state = initGameState(makeEmptyDecks(4));
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(1);
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(2);
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(3);
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(0);
      expect(state.turnNumber).toBe(5);
    });

    it('skips players who have lost', () => {
      let state = initGameState(makeEmptyDecks(3));
      state.players[1].hasLost = true;
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(2);
    });
  });

  describe('performUntapStep', () => {
    it('untaps all permanents controlled by active player', () => {
      const forest: CardDefinition = {
        id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
        colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
      };
      const decks = [{
        playerId: 'p1', name: 'Alice', cards: [forest], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: true });

      const next = performUntapStep(state);
      expect(next.cards.get(card.instanceId)!.tapped).toBe(false);
    });

    it('removes summoning sickness from creatures', () => {
      const bear: CardDefinition = {
        id: 'bear-1', name: 'Bear', type_line: 'Creature — Bear',
        oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
        colors: ['G'], color_identity: ['G'], keywords: [],
        card_types: ['creature'], power: 2, toughness: 2,
      };
      const decks = [{
        playerId: 'p1', name: 'Alice', cards: [bear], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: true });

      const next = performUntapStep(state);
      expect(next.cards.get(card.instanceId)!.summoningSick).toBe(false);
    });

    it('does not untap other players permanents', () => {
      const forest: CardDefinition = {
        id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
        oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
        colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
      };
      const decks = [{
        playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob', cards: [forest], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p2', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: true });

      const next = performUntapStep(state);
      expect(next.cards.get(card.instanceId)!.tapped).toBe(true);
    });
  });

  describe('mana pool emptying', () => {
    it('empties mana pools when advancing steps', () => {
      let state = initGameState(makeEmptyDecks(2));
      state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 };
      state = { ...state, phase: 'precombat_main', step: 'begin_combat' };

      const next = advanceStep(state);
      expect(next.players[0].manaPool.G).toBe(0);
    });
  });
});
