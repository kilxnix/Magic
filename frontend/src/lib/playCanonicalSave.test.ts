import { describe, expect, it } from 'vitest';
import { createPlayer, serializeGameState, type GameState } from 'commander-engine';
import { auditCanonicalPlayEngineSave, buildCanonicalPlayEngineSave, restoreCanonicalPlayEngineState } from './playCanonicalSave';

function minimalState(): GameState {
  return {
    players: [
      createPlayer('human', 'Pilot'),
      createPlayer('ai-1', 'Shelector'),
    ],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    turnNumber: 4,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

describe('play canonical saves', () => {
  it('wraps a play snapshot engine state in the canonical engine save schema', () => {
    const canonical = buildCanonicalPlayEngineSave({
      slot: 2,
      name: 'Sisay - Slot 2',
      humanPlayerId: 'human',
      serializedState: serializeGameState(minimalState()),
      createdAt: Date.UTC(2026, 4, 31, 20, 0, 0),
    });

    expect(canonical).toBeTruthy();
    expect(canonical?.schema).toBe('commander-engine-save-v1');
    expect(canonical?.slotId).toBe('play_slot_2');
    expect(canonical?.metadata.turnNumber).toBe(4);
    expect(canonical?.metadata.playerCount).toBe(2);
    expect(canonical?.metadata.humanPlayerName).toBe('Pilot');

    const audit = auditCanonicalPlayEngineSave(canonical);
    expect(audit.ok).toBe(true);
    expect(audit.fingerprint).toBe(canonical?.fingerprint);

    const restored = restoreCanonicalPlayEngineState(canonical);
    expect(restored?.turnNumber).toBe(4);
    expect(restored?.players).toHaveLength(2);
  });

  it('detects canonical save fingerprint drift', () => {
    const canonical = buildCanonicalPlayEngineSave({
      slot: 1,
      name: 'Drift Check',
      humanPlayerId: 'human',
      serializedState: serializeGameState(minimalState()),
    });

    expect(canonical).toBeTruthy();
    const audit = auditCanonicalPlayEngineSave({
      ...canonical!,
      fingerprint: 'wrong-fingerprint',
    });
    expect(audit.ok).toBe(false);
    expect(audit.message).toMatch(/fingerprint mismatch/i);
  });
});
