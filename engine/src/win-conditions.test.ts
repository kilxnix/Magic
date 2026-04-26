import { describe, it, expect } from 'vitest';
import { checkWinConditions, LoopDetector } from './win-conditions';
import { makeTestState } from './__tests__/test-helpers';

describe('checkWinConditions terminal reasons', () => {
  it('returns life loss for player who has lost with life <= 0', () => {
    const state = makeTestState({});
    state.players[0] = { ...state.players[0], hasLost: true, life: 0 };
    const result = checkWinConditions(state, new LoopDetector());
    expect(result.losers).toContainEqual({ playerId: state.players[0].id, reason: 'life' });
  });

  it('returns commander_damage when player has 21+ from a commander', () => {
    const state = makeTestState({});
    state.players[0] = { ...state.players[0], hasLost: true, commanderDamage: { cmdr1: 21 }, life: 40 };
    const result = checkWinConditions(state, new LoopDetector());
    expect(result.losers).toContainEqual({ playerId: state.players[0].id, reason: 'commander_damage' });
  });

  it('returns poison when player has 10+ poison counters', () => {
    const state = makeTestState({});
    state.players[0] = { ...state.players[0], hasLost: true, poisonCounters: 10, life: 40 };
    const result = checkWinConditions(state, new LoopDetector());
    expect(result.losers).toContainEqual({ playerId: state.players[0].id, reason: 'poison' });
  });

  it('does not list players who have not lost', () => {
    const state = makeTestState({});
    const result = checkWinConditions(state, new LoopDetector());
    expect(result.losers).toHaveLength(0);
  });
});

describe('checkWinConditions loop detection', () => {
  it('returns loop signature when LoopDetector flags a cyclic state repeat', () => {
    // Loop detector only flags genuine cycles (A → B → A → B → A → B), not static stalls.
    const detector = new LoopDetector();
    const stateA = makeTestState({});
    const stateB = makeTestState({});
    stateA.players[0] = { ...stateA.players[0], life: 40 };
    stateB.players[0] = { ...stateB.players[0], life: 41 };

    checkWinConditions(stateA, detector); // 1st A
    checkWinConditions(stateB, detector); // 1st B
    checkWinConditions(stateA, detector); // 2nd A
    checkWinConditions(stateB, detector); // 2nd B
    const result = checkWinConditions(stateA, detector); // 3rd A — flags
    expect(result.loop?.category).toBe('state_repeat');
  });
});
