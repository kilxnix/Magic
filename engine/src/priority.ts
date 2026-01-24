import { GameState } from './types';

export function getNextPriorityPlayer(state: GameState, currentIndex: number): number {
  const count = state.players.length;
  let next = (currentIndex + 1) % count;
  let attempts = 0;
  while (state.players[next].hasLost && attempts < count) {
    next = (next + 1) % count;
    attempts++;
  }
  return next;
}

export function passPriority(state: GameState): GameState {
  const newPassed = [...state.hasPriorityPassed];
  newPassed[state.priorityPlayerIndex] = true;

  const nextPlayer = getNextPriorityPlayer(state, state.priorityPlayerIndex);

  return {
    ...state,
    hasPriorityPassed: newPassed,
    priorityPlayerIndex: nextPlayer,
  };
}

export function allPlayersPassed(state: GameState): boolean {
  return state.players.every((player, i) =>
    player.hasLost || state.hasPriorityPassed[i]
  );
}

export function resetPriority(state: GameState): GameState {
  return {
    ...state,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
