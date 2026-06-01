import {
  BrowserLocalStorageAdapter,
  createSaveManager,
  deserializeGameState,
  serializeGameState,
  stateFingerprint,
  type SerializedGameStateV1,
} from 'commander-engine';
import type { PlayCanonicalEngineSave } from './playCanonicalSave';

export interface PlayPracticeMetadata {
  presetId?: string;
  archetype: string;
  commander?: string;
  focusTags: string[];
  keyCards: string[];
  coachingNotes?: string[];
}

export interface PlaySaveAuditMetadata {
  schema: 'engine-event-log-v1';
  engineEventCount: number;
  hasInitialState: boolean;
  seedCount: number;
  updatedAt: number;
}

export interface PlayDrillBookmark {
  id: string;
  label: string;
  savedAt: number;
  turnNumber: number;
  phase: string;
  step?: string;
  engine: SerializedGameStateV1;
  source?: 'manual' | 'checkpoint';
  focusTags?: string[];
  note?: string;
  attempts?: PlayDrillAttempt[];
}

export interface PlayDrillAttempt {
  id: string;
  label: string;
  startedAt: number;
  savedAt: number;
  turnNumber: number;
  phase: string;
  step?: string;
  summary: string;
  engine: SerializedGameStateV1;
}

export interface PlaySaveSlotRecord {
  slot: number;
  name: string;
  commander: string;
  turnNumber: number;
  phase: string;
  savedAt: number;
  autosaved: boolean;
  practice?: PlayPracticeMetadata;
  audit?: PlaySaveAuditMetadata;
  canonicalEngineSave?: PlayCanonicalEngineSave;
  canonicalManager?: {
    slotId: string;
    fingerprint: string;
    updatedAt: number;
    status?: 'ok' | 'missing' | 'mismatch';
    verifiedFingerprint?: string;
    verifiedAt?: number;
  };
  drillBookmarks?: PlayDrillBookmark[];
  snapshot: unknown;
  ui: {
    step: 'import' | 'opponent' | 'draft' | 'standard' | 'game';
    importTab: 'url' | 'text';
    deckUrl: string;
    deckText: string;
    importResult: unknown;
    standardDeckText: string;
    opponentCount: 1 | 2 | 3;
    spawnMode: 'random' | 'counter' | 'pool';
    spawnBracket: number;
    colorFilter: Record<string, boolean>;
    personality: string;
    spawnedOpponents: unknown[];
    selectedPracticePresetId?: string | null;
  };
}

const DB_NAME = 'deckreps_play_saves_v1';
const STORE_NAME = 'slots';
const LOCAL_FALLBACK_KEY = 'deckreps_play_save_slots_v1';
const SLOT_COUNT = 4;
const PLAY_SLOT_PREFIX = 'play_slot_';

type SnapshotLike = {
  engine?: SerializedGameStateV1;
  humanId?: string;
};

export function canonicalPlaySlotId(slot: number): string {
  return `${PLAY_SLOT_PREFIX}${slot}`;
}

function getBrowserSaveManager() {
  if (typeof window === 'undefined') return null;
  try {
    return createSaveManager(new BrowserLocalStorageAdapter());
  } catch {
    return null;
  }
}

function snapshotFromRecord(record: PlaySaveSlotRecord): SnapshotLike | null {
  if (!record.snapshot || typeof record.snapshot !== 'object') return null;
  return record.snapshot as SnapshotLike;
}

function engineStateFromRecord(record: PlaySaveSlotRecord): SerializedGameStateV1 | null {
  return snapshotFromRecord(record)?.engine || null;
}

function stripAuthoritativeEnginePayload(record: PlaySaveSlotRecord): PlaySaveSlotRecord {
  if (!record.canonicalManager && !record.canonicalEngineSave) return record;
  const snapshot = snapshotFromRecord(record);
  if (!snapshot?.engine && !record.canonicalEngineSave) return record;

  const snapshotCopy = { ...(record.snapshot as Record<string, unknown>) };
  delete snapshotCopy.engine;

  const next: PlaySaveSlotRecord = {
    ...record,
    snapshot: snapshotCopy,
  };
  if (record.canonicalManager) {
    delete next.canonicalEngineSave;
  }
  return next;
}

export async function persistCanonicalPlaySlot(record: PlaySaveSlotRecord): Promise<PlaySaveSlotRecord> {
  const serializedState = engineStateFromRecord(record);
  if (!serializedState) return record;

  const manager = getBrowserSaveManager();
  if (!manager) return record;

  const slotId = canonicalPlaySlotId(record.slot);
  const state = deserializeGameState(serializedState);
  await manager.saveGame(slotId, state, record.name || `${record.commander} - Slot ${record.slot}`, snapshotFromRecord(record)?.humanId || 'human');

  return {
    ...record,
    canonicalManager: {
      slotId,
      fingerprint: stateFingerprint(state),
      updatedAt: Date.now(),
    },
  };
}

export async function loadCanonicalPlaySlotState(slot: number): Promise<SerializedGameStateV1 | null> {
  const manager = getBrowserSaveManager();
  if (!manager) return null;
  const state = await manager.loadGame(canonicalPlaySlotId(slot));
  return state ? serializeGameState(state) : null;
}

async function verifyCanonicalManagerRecord(record: PlaySaveSlotRecord): Promise<PlaySaveSlotRecord> {
  if (!record.canonicalManager) return record;
  const manager = getBrowserSaveManager();
  if (!manager) {
    return {
      ...record,
      canonicalManager: {
        ...record.canonicalManager,
        status: 'missing',
        verifiedAt: Date.now(),
      },
    };
  }

  try {
    const state = await manager.loadGame(record.canonicalManager.slotId);
    if (!state) {
      return {
        ...record,
        canonicalManager: {
          ...record.canonicalManager,
          status: 'missing',
          verifiedAt: Date.now(),
        },
      };
    }
    const verifiedFingerprint = stateFingerprint(state);
    return {
      ...record,
      canonicalManager: {
        ...record.canonicalManager,
        status: verifiedFingerprint === record.canonicalManager.fingerprint ? 'ok' : 'mismatch',
        verifiedFingerprint,
        verifiedAt: Date.now(),
      },
    };
  } catch {
    return {
      ...record,
      canonicalManager: {
        ...record.canonicalManager,
        status: 'missing',
        verifiedAt: Date.now(),
      },
    };
  }
}

export async function deleteCanonicalPlaySlot(slot: number): Promise<void> {
  const manager = getBrowserSaveManager();
  if (!manager) return;
  await manager.deleteSave(canonicalPlaySlotId(slot));
}

function canUseIndexedDb(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = run(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB operation failed'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('IndexedDB transaction failed'));
    };
  });
}

function readFallback(): PlaySaveSlotRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(LOCAL_FALLBACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeFallback(records: PlaySaveSlotRecord[]): void {
  try {
    window.localStorage?.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(records));
  } catch {
    // Save slots require IndexedDB or localStorage; callers surface save errors.
  }
}

export async function getPlaySaveSlots(): Promise<(PlaySaveSlotRecord | null)[]> {
  let records: PlaySaveSlotRecord[] = [];
  if (canUseIndexedDb()) {
    try {
      records = await withStore('readonly', store => store.getAll() as IDBRequest<PlaySaveSlotRecord[]>);
    } catch {
      records = readFallback();
    }
  } else {
    records = readFallback();
  }
  const verifiedRecords = await Promise.all(records.map(record => verifyCanonicalManagerRecord(record)));
  const bySlot = new Map(verifiedRecords.map(record => [record.slot, record]));
  return Array.from({ length: SLOT_COUNT }, (_, index) => bySlot.get(index + 1) || null);
}

export async function putPlaySaveSlot(record: PlaySaveSlotRecord): Promise<void> {
  if (record.slot < 1 || record.slot > SLOT_COUNT) {
    throw new Error('Save slot must be between 1 and 4');
  }
  const canonicalRecord = stripAuthoritativeEnginePayload(await persistCanonicalPlaySlot(record));
  if (canUseIndexedDb()) {
    try {
      await withStore('readwrite', store => store.put(canonicalRecord) as IDBRequest<IDBValidKey>);
      return;
    } catch {
      // Fall back below.
    }
  }
  const records = readFallback().filter(existing => existing.slot !== canonicalRecord.slot);
  records.push(canonicalRecord);
  writeFallback(records);
}

export async function deletePlaySaveSlot(slot: number): Promise<void> {
  await deleteCanonicalPlaySlot(slot);
  if (canUseIndexedDb()) {
    try {
      await withStore('readwrite', store => store.delete(slot) as IDBRequest<undefined>);
      return;
    } catch {
      // Fall back below.
    }
  }
  writeFallback(readFallback().filter(record => record.slot !== slot));
}
