import { describe, it, expect } from 'vitest';
import {
  initGrudgeTracking,
  hasGrudgeTracking,
  recordDamage,
  getDamageDealt,
  getRecentDamageDealt,
  calculateGrudgeLevel,
  getMostRecentAttacker,
  getGrudgeRanking,
  shouldRetaliate,
  getGrudgeTargetingBonus,
  pruneOldRecords,
  GameStateWithGrudges,
} from './grudges';
import { GameState, createPlayer, Phase, Step } from '../types';

// Helper to create minimal game state
function createTestState(playerCount: number = 4): GameState {
  const players = [];
  for (let i = 1; i <= playerCount; i++) {
    players.push({ ...createPlayer(`p${i}`, `Player ${i}`), hasPriority: i === 1 });
  }

  return {
    players,
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'upkeep' as Step,
    turnNumber: 5,
    hasPriorityPassed: players.map(() => false),
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

describe('initGrudgeTracking', () => {
  it('adds damageHistory to state', () => {
    const state = createTestState();
    const tracked = initGrudgeTracking(state);

    expect(tracked.damageHistory).toBeDefined();
    expect(tracked.damageHistory).toEqual([]);
  });
});

describe('hasGrudgeTracking', () => {
  it('returns true for state with grudge tracking', () => {
    const state = createTestState();
    const tracked = initGrudgeTracking(state);

    expect(hasGrudgeTracking(tracked)).toBe(true);
  });

  it('returns false for regular state', () => {
    const state = createTestState();

    expect(hasGrudgeTracking(state)).toBe(false);
  });
});

describe('recordDamage', () => {
  it('adds damage record to history', () => {
    const state = initGrudgeTracking(createTestState());
    const newState = recordDamage(state, 'p2', 'p1', 5);

    expect(newState.damageHistory.length).toBe(1);
    expect(newState.damageHistory[0]).toEqual({
      sourcePlayerId: 'p2',
      targetPlayerId: 'p1',
      amount: 5,
      turnNumber: 5,
    });
  });

  it('ignores zero damage', () => {
    const state = initGrudgeTracking(createTestState());
    const newState = recordDamage(state, 'p2', 'p1', 0);

    expect(newState.damageHistory.length).toBe(0);
  });

  it('ignores self-damage', () => {
    const state = initGrudgeTracking(createTestState());
    const newState = recordDamage(state, 'p1', 'p1', 5);

    expect(newState.damageHistory.length).toBe(0);
  });

  it('accumulates multiple records', () => {
    let state = initGrudgeTracking(createTestState());
    state = recordDamage(state, 'p2', 'p1', 3);
    state = recordDamage(state, 'p3', 'p1', 5);
    state = recordDamage(state, 'p2', 'p1', 2);

    expect(state.damageHistory.length).toBe(3);
  });
});

describe('getDamageDealt', () => {
  it('returns total damage from source to target', () => {
    let state = initGrudgeTracking(createTestState());
    state = recordDamage(state, 'p2', 'p1', 3);
    state = recordDamage(state, 'p2', 'p1', 5);
    state = recordDamage(state, 'p3', 'p1', 10);

    expect(getDamageDealt(state, 'p2', 'p1')).toBe(8);
    expect(getDamageDealt(state, 'p3', 'p1')).toBe(10);
  });

  it('returns 0 for no damage', () => {
    const state = initGrudgeTracking(createTestState());

    expect(getDamageDealt(state, 'p2', 'p1')).toBe(0);
  });
});

describe('getRecentDamageDealt', () => {
  it('filters by turn number', () => {
    let state = initGrudgeTracking(createTestState());
    state.turnNumber = 10;

    // Old damage (turn 5)
    state = { ...state, turnNumber: 5 };
    state = recordDamage(state, 'p2', 'p1', 20);

    // Recent damage (turn 9)
    state = { ...state, turnNumber: 9 };
    state = recordDamage(state, 'p2', 'p1', 5);

    // Current turn (10)
    state = { ...state, turnNumber: 10 };
    state = recordDamage(state, 'p2', 'p1', 3);

    // Within 3 turns should include turn 7-10
    const recent = getRecentDamageDealt(state, 'p2', 'p1', 3);
    expect(recent).toBe(8); // 5 + 3, not the old 20
  });
});

describe('calculateGrudgeLevel', () => {
  it('returns 0 with no damage history', () => {
    const state = initGrudgeTracking(createTestState());

    expect(calculateGrudgeLevel(state, 'p1', 'p2')).toBe(0);
  });

  it('increases with damage taken', () => {
    let state = initGrudgeTracking(createTestState());
    state = recordDamage(state, 'p2', 'p1', 10);

    const grudge = calculateGrudgeLevel(state, 'p1', 'p2');
    expect(grudge).toBeGreaterThan(0);
  });

  it('caps at 1.0', () => {
    let state = initGrudgeTracking(createTestState());
    // Deal massive damage
    state = recordDamage(state, 'p2', 'p1', 100);

    const grudge = calculateGrudgeLevel(state, 'p1', 'p2');
    expect(grudge).toBe(1.0);
  });

  it('increases when at low life', () => {
    let state1 = initGrudgeTracking(createTestState());
    state1.players[0].life = 40;
    state1 = recordDamage(state1, 'p2', 'p1', 10);

    let state2 = initGrudgeTracking(createTestState());
    state2.players[0].life = 15;
    state2 = recordDamage(state2, 'p2', 'p1', 10);

    const grudgeHighLife = calculateGrudgeLevel(state1, 'p1', 'p2');
    const grudgeLowLife = calculateGrudgeLevel(state2, 'p1', 'p2');

    expect(grudgeLowLife).toBeGreaterThan(grudgeHighLife);
  });
});

describe('getMostRecentAttacker', () => {
  it('returns player who dealt most recent damage', () => {
    let state = initGrudgeTracking(createTestState());
    state.turnNumber = 10;

    state = recordDamage(state, 'p2', 'p1', 5);
    state = recordDamage(state, 'p3', 'p1', 15);
    state = recordDamage(state, 'p4', 'p1', 3);

    const attacker = getMostRecentAttacker(state, 'p1');
    expect(attacker).toBe('p3'); // Dealt the most
  });

  it('returns null with no attackers', () => {
    const state = initGrudgeTracking(createTestState());

    const attacker = getMostRecentAttacker(state, 'p1');
    expect(attacker).toBeNull();
  });

  it('ignores old attacks', () => {
    let state = initGrudgeTracking(createTestState());

    // Old attack (turn 1)
    state = { ...state, turnNumber: 1 };
    state = recordDamage(state, 'p2', 'p1', 100);

    // Recent attack (turn 10)
    state = { ...state, turnNumber: 10 };
    state = recordDamage(state, 'p3', 'p1', 5);

    const attacker = getMostRecentAttacker(state, 'p1');
    expect(attacker).toBe('p3'); // Recent attacker, not p2
  });
});

describe('getGrudgeRanking', () => {
  it('returns opponents sorted by grudge level', () => {
    let state = initGrudgeTracking(createTestState());

    state = recordDamage(state, 'p2', 'p1', 5);
    state = recordDamage(state, 'p3', 'p1', 20);
    state = recordDamage(state, 'p4', 'p1', 10);

    const ranking = getGrudgeRanking(state, 'p1');

    expect(ranking.length).toBe(3);
    expect(ranking[0].playerId).toBe('p3'); // Highest grudge
    expect(ranking[1].playerId).toBe('p4');
    expect(ranking[2].playerId).toBe('p2');
  });

  it('excludes self', () => {
    const state = initGrudgeTracking(createTestState());
    const ranking = getGrudgeRanking(state, 'p1');

    const ids = ranking.map(r => r.playerId);
    expect(ids).not.toContain('p1');
  });

  it('excludes eliminated players', () => {
    let state = initGrudgeTracking(createTestState());
    state.players[1].hasLost = true;

    const ranking = getGrudgeRanking(state, 'p1');

    const ids = ranking.map(r => r.playerId);
    expect(ids).not.toContain('p2');
  });
});

describe('shouldRetaliate', () => {
  it('returns true when grudge exceeds threshold', () => {
    let state = initGrudgeTracking(createTestState());
    state = recordDamage(state, 'p2', 'p1', 30);

    expect(shouldRetaliate(state, 'p1', 'p2', 0.3)).toBe(true);
  });

  it('returns false when grudge below threshold', () => {
    let state = initGrudgeTracking(createTestState());
    state = recordDamage(state, 'p2', 'p1', 2);

    expect(shouldRetaliate(state, 'p1', 'p2', 0.3)).toBe(false);
  });
});

describe('getGrudgeTargetingBonus', () => {
  it('returns 0 with no grudge', () => {
    const state = initGrudgeTracking(createTestState());

    expect(getGrudgeTargetingBonus(state, 'p1', 'p2')).toBe(0);
  });

  it('returns positive bonus with grudge', () => {
    let state = initGrudgeTracking(createTestState());
    state = recordDamage(state, 'p2', 'p1', 20);

    const bonus = getGrudgeTargetingBonus(state, 'p1', 'p2');
    expect(bonus).toBeGreaterThan(0);
    expect(bonus).toBeLessThanOrEqual(0.5);
  });
});

describe('pruneOldRecords', () => {
  it('removes records older than N turns', () => {
    let state = initGrudgeTracking(createTestState());

    // Old record
    state = { ...state, turnNumber: 1 };
    state = recordDamage(state, 'p2', 'p1', 10);

    // Recent record
    state = { ...state, turnNumber: 15 };
    state = recordDamage(state, 'p3', 'p1', 5);

    state = pruneOldRecords(state, 10);

    expect(state.damageHistory.length).toBe(1);
    expect(state.damageHistory[0].sourcePlayerId).toBe('p3');
  });

  it('keeps recent records', () => {
    let state = initGrudgeTracking(createTestState());
    state = { ...state, turnNumber: 10 };

    state = recordDamage(state, 'p2', 'p1', 5);
    state = recordDamage(state, 'p3', 'p1', 3);

    state = pruneOldRecords(state, 10);

    expect(state.damageHistory.length).toBe(2);
  });
});
