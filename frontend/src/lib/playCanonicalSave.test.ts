import { describe, expect, it } from 'vitest';
import { createPlayer, serializeGameState, type GameState } from 'commander-engine';
import { auditCanonicalPlayEngineSave, buildCanonicalPlayEngineSave, restoreCanonicalPlayEngineState } from './playCanonicalSave';
import { deletePlaySaveSlot, getPlaySaveSlots, loadCanonicalPlaySlotState, loadCanonicalPlayStateRef, putPlaySaveSlot, type PlaySaveSlotRecord } from './playSaveStorage';

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
      const rawEnvelope = JSON.parse(fakeStorage.getItem('deckreps_play_save_slots_v1') || '[]') as PlaySaveSlotRecord[];
      expect((rawEnvelope[0].snapshot as { engine?: unknown }).engine).toBeUndefined();
      expect(rawEnvelope[0].canonicalEngineSave).toBeUndefined();
      expect(rawEnvelope[0].canonicalManager?.slotId).toBe('play_slot_3');

      const slots = await getPlaySaveSlots();
      expect(slots[2]?.canonicalManager?.status).toBe('ok');
      expect(slots[2]?.canonicalManager?.verifiedFingerprint).toBe(slots[2]?.canonicalManager?.fingerprint);

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

  it('persists drill bookmarks and attempts through canonical SaveManager records', async () => {
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
      const mainState = minimalState();
      mainState.turnNumber = 12;
      const bookmarkState = minimalState();
      bookmarkState.turnNumber = 13;
      const attemptState = minimalState();
      attemptState.turnNumber = 14;
      const record: PlaySaveSlotRecord = {
        slot: 4,
        name: 'Drill Slot',
        commander: 'Xenagos, God of Revels',
        turnNumber: 12,
        phase: 'combat',
        savedAt: Date.now(),
        autosaved: false,
        snapshot: {
          engine: serializeGameState(mainState),
          humanId: 'human',
        },
        drillBookmarks: [{
          id: 'bookmark-a',
          label: 'T12 combat',
          savedAt: Date.now(),
          turnNumber: 13,
          phase: 'combat',
          step: 'declare_attackers',
          engine: serializeGameState(bookmarkState),
          source: 'manual',
          attempts: [{
            id: 'attempt-a',
            label: 'Attempt A',
            startedAt: Date.now(),
            savedAt: Date.now(),
            turnNumber: 14,
            phase: 'combat',
            step: 'combat_damage',
            summary: 'damage line',
            engine: serializeGameState(attemptState),
          }],
        }],
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
      const rawEnvelope = JSON.parse(fakeStorage.getItem('deckreps_play_save_slots_v1') || '[]') as PlaySaveSlotRecord[];
      expect((rawEnvelope[0].snapshot as { engine?: unknown }).engine).toBeUndefined();
      expect(rawEnvelope[0].drillBookmarks?.[0].engine).toBeUndefined();
      expect(rawEnvelope[0].drillBookmarks?.[0].canonicalState?.slotId).toBe('play_slot_4_drill_bookmark-a');
      expect(rawEnvelope[0].drillBookmarks?.[0].attempts?.[0].engine).toBeUndefined();
      expect(rawEnvelope[0].drillBookmarks?.[0].attempts?.[0].canonicalState?.slotId)
        .toBe('play_slot_4_drill_bookmark-a_attempt_attempt-a');

      const slots = await getPlaySaveSlots();
      const bookmark = slots[3]?.drillBookmarks?.[0];
      const attempt = bookmark?.attempts?.[0];
      const restoredBookmark = await loadCanonicalPlayStateRef(bookmark?.canonicalState);
      const restoredAttempt = await loadCanonicalPlayStateRef(attempt?.canonicalState);
      expect(restoredBookmark?.turnNumber).toBe(13);
      expect(restoredAttempt?.turnNumber).toBe(14);

      await deletePlaySaveSlot(4);
      expect(await loadCanonicalPlayStateRef(bookmark?.canonicalState)).toBeNull();
      expect(await loadCanonicalPlayStateRef(attempt?.canonicalState)).toBeNull();
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

  it('keeps a canonical engine save as fallback when SaveManager storage is unavailable', async () => {
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
      value: undefined,
      configurable: true,
    });

    try {
      const state = minimalState();
      state.turnNumber = 11;
      const serialized = serializeGameState(state);
      const canonicalEngineSave = buildCanonicalPlayEngineSave({
        slot: 2,
        name: 'Fallback Slot',
        humanPlayerId: 'human',
        serializedState: serialized,
      });
      expect(canonicalEngineSave).toBeTruthy();

      const record: PlaySaveSlotRecord = {
        slot: 2,
        name: 'Fallback Slot',
        commander: 'Talrand, Sky Summoner',
        turnNumber: 11,
        phase: 'precombat_main',
        savedAt: Date.now(),
        autosaved: false,
        canonicalEngineSave,
        snapshot: {
          engine: serialized,
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
          spawnBracket: 3,
          colorFilter: { W: false, U: false, B: false, R: false, G: false },
          personality: 'Balanced',
          spawnedOpponents: [],
          selectedPracticePresetId: 'beginner-talrand-spells',
        },
      };

      await putPlaySaveSlot(record);
      const rawEnvelope = JSON.parse(fakeStorage.getItem('deckreps_play_save_slots_v1') || '[]') as PlaySaveSlotRecord[];
      expect((rawEnvelope[0].snapshot as { engine?: unknown }).engine).toBeUndefined();
      expect(rawEnvelope[0].canonicalEngineSave?.schema).toBe('commander-engine-save-v1');
      expect(rawEnvelope[0].canonicalManager).toBeUndefined();

      const slots = await getPlaySaveSlots();
      const fallbackRecord = slots[1];
      expect(fallbackRecord?.canonicalEngineSave).toBeTruthy();
      const restored = restoreCanonicalPlayEngineState(fallbackRecord?.canonicalEngineSave);
      expect(restored?.turnNumber).toBe(11);
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
