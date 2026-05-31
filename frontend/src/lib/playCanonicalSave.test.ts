import { describe, expect, it } from 'vitest';
import { createPlayer, serializeGameState, type GameState } from 'commander-engine';
import { auditCanonicalPlayEngineSave, buildCanonicalPlayEngineSave, restoreCanonicalPlayEngineState } from './playCanonicalSave';
import { deletePlaySaveSlot, loadCanonicalPlaySlotState, putPlaySaveSlot, type PlaySaveSlotRecord } from './playSaveStorage';

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

  it('persists play slots through the browser SaveManager path', async () => {
    const store = new Map<string, string>();
    const fakeStorage = {
      get length() {
        return store.size;
      },
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    };
    const previousWindow = (globalThis as any).window;
    const previousLocalStorage = (globalThis as any).localStorage;
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: fakeStorage },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: fakeStorage,
      configurable: true,
    });

    try {
      const state = minimalState();
      state.turnNumber = 8;
      const record: PlaySaveSlotRecord = {
        slot: 3,
        name: 'Manager Slot',
        commander: 'Xenagos, God of Revels',
        turnNumber: 8,
        phase: 'combat',
        savedAt: Date.now(),
        autosaved: false,
        snapshot: {
          engine: serializeGameState(state),
          humanId: 'human',
        },
        ui: {
          step: 'game',
          importTab: 'text',
          deckUrl: '',
          deckText: '',
          importResult: null,
          standardDeckText: '',
          opponentCount: 1,
          spawnMode: 'counter',
          spawnBracket: 5,
          colorFilter: { W: false, U: false, B: false, R: false, G: false },
          personality: 'Aggressive',
          spawnedOpponents: [],
          selectedPracticePresetId: 'practice-xenagos-dragons',
        },
      };

      await putPlaySaveSlot(record);
      const restored = await loadCanonicalPlaySlotState(3);
      expect(restored?.turnNumber).toBe(8);
      expect(restored?.players[0].name).toBe('Pilot');

      await deletePlaySaveSlot(3);
      expect(await loadCanonicalPlaySlotState(3)).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'window', {
        value: previousWindow,
        configurable: true,
      });
      Object.defineProperty(globalThis, 'localStorage', {
        value: previousLocalStorage,
        configurable: true,
      });
    }
  });
});
