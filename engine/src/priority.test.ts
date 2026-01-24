import { describe, it, expect } from 'vitest';
import { passPriority, allPlayersPassed, resetPriority, getNextPriorityPlayer } from './priority';
import { initGameState } from './game-state';
import { CardDefinition } from './types';

function makeEmptyDecks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `Player ${i + 1}`,
    cards: [] as CardDefinition[],
    commanderId: `cmd${i + 1}`,
  }));
}

describe('Priority System', () => {
  describe('passPriority', () => {
    it('marks current player as passed and moves to next', () => {
      const state = initGameState(makeEmptyDecks(2));
      const next = passPriority(state);
      expect(next.hasPriorityPassed[0]).toBe(true);
      expect(next.priorityPlayerIndex).toBe(1);
    });

    it('skips players who have lost', () => {
      const state = initGameState(makeEmptyDecks(3));
      state.players[1].hasLost = true;
      const next = passPriority(state);
      expect(next.priorityPlayerIndex).toBe(2);
    });
  });

  describe('allPlayersPassed', () => {
    it('returns false when not all players passed', () => {
      const state = initGameState(makeEmptyDecks(2));
      expect(allPlayersPassed(state)).toBe(false);
    });

    it('returns true when all active players passed', () => {
      const state = initGameState(makeEmptyDecks(2));
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      expect(allPlayersPassed(state)).toBe(true);
    });

    it('ignores players who have lost', () => {
      const state = initGameState(makeEmptyDecks(3));
      state.players[2].hasLost = true;
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      expect(allPlayersPassed(state)).toBe(true);
    });
  });

  describe('resetPriority', () => {
    it('resets all passed flags and gives priority to active player', () => {
      const state = initGameState(makeEmptyDecks(2));
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      const next = resetPriority(state);
      expect(next.hasPriorityPassed.every(p => p === false)).toBe(true);
      expect(next.priorityPlayerIndex).toBe(state.activePlayerIndex);
    });
  });

  describe('getNextPriorityPlayer', () => {
    it('returns next player in turn order', () => {
      const state = initGameState(makeEmptyDecks(4));
      expect(getNextPriorityPlayer(state, 0)).toBe(1);
      expect(getNextPriorityPlayer(state, 3)).toBe(0);
    });

    it('skips eliminated players', () => {
      const state = initGameState(makeEmptyDecks(4));
      state.players[1].hasLost = true;
      expect(getNextPriorityPlayer(state, 0)).toBe(2);
    });
  });
});
