import { describe, it, expect } from 'vitest';
import {
  needsMigration,
  getSaveVersion,
  migrateSave,
  tryMigrateSave,
  isValidSave,
  parseAndMigrateSave,
} from './migrate';
import { SAVE_VERSION, SaveGameV1 } from './schema';
import { createSaveGame } from './serialize';
import { GameState, createPlayer, Phase, Step } from '../types';

// Helper to create minimal game state
function createTestState(): GameState {
  return {
    players: [
      { ...createPlayer('p1', 'Player 1'), hasPriority: true },
      { ...createPlayer('p2', 'Player 2'), hasPriority: false },
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'upkeep' as Step,
    turnNumber: 5,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

describe('getSaveVersion', () => {
  it('returns version from valid save', () => {
    const state = createTestState();
    const save = createSaveGame(state, 'Test', 'p1');

    expect(getSaveVersion(save)).toBe(SAVE_VERSION);
  });

  it('returns null for invalid data', () => {
    expect(getSaveVersion(null)).toBeNull();
    expect(getSaveVersion(undefined)).toBeNull();
    expect(getSaveVersion('string')).toBeNull();
    expect(getSaveVersion(123)).toBeNull();
    expect(getSaveVersion({})).toBeNull();
    expect(getSaveVersion({ version: 'string' })).toBeNull();
  });
});

describe('needsMigration', () => {
  it('returns false for current version', () => {
    const state = createTestState();
    const save = createSaveGame(state, 'Test', 'p1');

    expect(needsMigration(save)).toBe(false);
  });

  it('returns true for old version', () => {
    const state = createTestState();
    const save = createSaveGame(state, 'Test', 'p1');
    // Simulate old version
    (save as any).version = SAVE_VERSION - 1;

    expect(needsMigration(save)).toBe(true);
  });
});

describe('isValidSave', () => {
  it('returns true for valid save', () => {
    const state = createTestState();
    const save = createSaveGame(state, 'Test', 'p1');

    expect(isValidSave(save)).toBe(true);
  });

  it('returns false for invalid data', () => {
    expect(isValidSave(null)).toBe(false);
    expect(isValidSave({})).toBe(false);
    expect(isValidSave({ version: 1 })).toBe(false);
    expect(isValidSave({ version: 1, metadata: null })).toBe(false);
    expect(isValidSave({ version: 1, metadata: {}, state: null })).toBe(false);
  });

  it('returns false for invalid version', () => {
    expect(isValidSave({ version: 0, metadata: {}, state: {} })).toBe(false);
    expect(isValidSave({ version: 999, metadata: {}, state: {} })).toBe(false);
  });
});

describe('migrateSave', () => {
  it('returns same save for current version', () => {
    const state = createTestState();
    const save = createSaveGame(state, 'Test', 'p1');

    const migrated = migrateSave(save);

    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.metadata.name).toBe('Test');
  });

  it('throws for invalid save', () => {
    expect(() => migrateSave({} as any)).toThrow('invalid save format');
  });

  it('throws for future version', () => {
    const futureSave = { version: SAVE_VERSION + 1, metadata: {}, state: {} };
    expect(() => migrateSave(futureSave as any)).toThrow('newer than supported');
  });
});

describe('tryMigrateSave', () => {
  it('returns migrated save on success', () => {
    const state = createTestState();
    const save = createSaveGame(state, 'Test', 'p1');

    const result = tryMigrateSave(save);

    expect(result).not.toBeNull();
    expect(result!.version).toBe(SAVE_VERSION);
  });

  it('returns null for invalid data', () => {
    expect(tryMigrateSave(null)).toBeNull();
    expect(tryMigrateSave({})).toBeNull();
    expect(tryMigrateSave('not an object')).toBeNull();
  });
});

describe('parseAndMigrateSave', () => {
  it('parses and returns valid save', () => {
    const state = createTestState();
    const save = createSaveGame(state, 'Parse Test', 'p1');
    const json = JSON.stringify(save);

    const parsed = parseAndMigrateSave(json);

    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.metadata.name).toBe('Parse Test');
  });

  it('throws for invalid JSON', () => {
    expect(() => parseAndMigrateSave('not json')).toThrow();
  });

  it('throws for invalid save format', () => {
    const invalid = JSON.stringify({ notASave: true });
    expect(() => parseAndMigrateSave(invalid)).toThrow('Invalid save game format');
  });
});
