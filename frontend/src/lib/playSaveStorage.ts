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

export interface PlayCanonicalStateRef {
  slotId: string;
  fingerprint: string;
  updatedAt: number;
  status?: 'ok' | 'missing' | 'mismatch';
  verifiedFingerprint?: string;
  verifiedAt?: number;
}

export interface PlayEngineAuthority {
  kind: 'save-manager' | 'canonical-json' | 'legacy-inline' | 'missing';
  slotId?: string;
  fingerprint?: string;
  status?: 'ok' | 'missing' | 'mismatch';
  verifiedFingerprint?: string;
  verifiedAt?: number;
  updatedAt?: number;
  message?: string;
}

export interface PlayDrillBookmark {
  id: string;
  label: string;
  savedAt: number;
  turnNumber: number;
  phase: string;
  step?: string;
  engine?: SerializedGameStateV1;
  canonicalState?: PlayCanonicalStateRef;
  source?: 'manual' | 'checkpoint' | 'branch-preview' | 'review';
  focusTags?: string[];
  note?: string;
  decisionContext?: PlayDrillDecisionContext;
  attempts?: PlayDrillAttempt[];
}

export interface PlayDrillDecisionContext {
  currentPrompt?: unknown;
  tutorPhase?: boolean;
  tutorCards?: unknown[];
  tutorTitle?: string;
  tutorPromptRequest?: unknown;
  tutorRemaining?: number;
  tutorFilter?: string;
  tutorFilterSpec?: unknown;
  tutorTapped?: boolean;
  tutorShuffle?: boolean;
  tutorDestination?: string;
  tutorSourceName?: string;
  tutorSourceInstanceId?: string;
  pendingSearchEntryChoice?: unknown;
  pendingTargetChoice?: unknown;
  libraryChoice?: unknown;
  libraryManipulationPromptRequest?: unknown;
  optionalTriggerChoice?: unknown;
  taxPaymentChoice?: unknown;
  wardPaymentChoice?: unknown;
  damageAssignmentChoice?: unknown;
  triggerOrderChoice?: unknown;
  discardPhase?: boolean;
  discardCount?: number;
  selectedMulliganCardIds?: string[];
  selectedMulliganBottomIds?: string[];
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
  engine?: SerializedGameStateV1;
  canonicalState?: PlayCanonicalStateRef;
  decisionContext?: PlayDrillDecisionContext;
}

export interface PlaySaveSlotRecord {
  schema?: 'deckreps-play-slot-v2';
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
  canonicalManager?: PlayCanonicalStateRef;
  engineAuthority?: PlayEngineAuthority;
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

function canonicalDrillBookmarkSlotId(slot: number, bookmarkId: string): string {
  return `${canonicalPlaySlotId(slot)}_drill_${bookmarkId}`;
}

function canonicalDrillAttemptSlotId(slot: number, bookmarkId: string, attemptId: string): string {
  return `${canonicalDrillBookmarkSlotId(slot, bookmarkId)}_attempt_${attemptId}`;
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

function stripCanonicalDrillPayloads(record: PlaySaveSlotRecord): PlaySaveSlotRecord {
  if (!record.drillBookmarks?.length) return record;
  return {
    ...record,
    drillBookmarks: record.drillBookmarks.map(bookmark => {
      const nextBookmark: PlayDrillBookmark = { ...bookmark };
      if (nextBookmark.canonicalState) {
        delete nextBookmark.engine;
      }
      if (nextBookmark.attempts?.length) {
        nextBookmark.attempts = nextBookmark.attempts.map(attempt => {
          const nextAttempt: PlayDrillAttempt = { ...attempt };
          if (nextAttempt.canonicalState) {
            delete nextAttempt.engine;
          }
          return nextAttempt;
        });
      }
      return nextBookmark;
    }),
  };
}

function stripAuthoritativeEnginePayload(record: PlaySaveSlotRecord): PlaySaveSlotRecord {
  const strippedDrills = stripCanonicalDrillPayloads(record);
  if (!strippedDrills.canonicalManager && !strippedDrills.canonicalEngineSave) return strippedDrills;
  const snapshot = snapshotFromRecord(strippedDrills);
  if (!snapshot?.engine && !strippedDrills.canonicalEngineSave) return strippedDrills;

  const snapshotCopy = { ...(strippedDrills.snapshot as Record<string, unknown>) };
  delete snapshotCopy.engine;

  const next: PlaySaveSlotRecord = {
    ...strippedDrills,
    snapshot: snapshotCopy,
  };
  if (strippedDrills.canonicalManager) {
    delete next.canonicalEngineSave;
  }
  return {
    ...next,
    schema: 'deckreps-play-slot-v2',
    engineAuthority: engineAuthorityForRecord(next),
  };
}

function engineAuthorityForRecord(record: PlaySaveSlotRecord): PlayEngineAuthority {
  if (record.canonicalManager) {
    return {
      kind: 'save-manager',
      slotId: record.canonicalManager.slotId,
      fingerprint: record.canonicalManager.fingerprint,
      status: record.canonicalManager.status,
      verifiedFingerprint: record.canonicalManager.verifiedFingerprint,
      verifiedAt: record.canonicalManager.verifiedAt,
      updatedAt: record.canonicalManager.updatedAt,
    };
  }
  if (record.canonicalEngineSave) {
    return {
      kind: 'canonical-json',
      slotId: record.canonicalEngineSave.slotId,
      fingerprint: record.canonicalEngineSave.fingerprint,
      updatedAt: record.canonicalEngineSave.createdAt,
      message: 'SaveManager was unavailable; using canonical JSON fallback.',
    };
  }
  if (engineStateFromRecord(record)) {
    return {
      kind: 'legacy-inline',
      message: 'Legacy inline engine state; resave this slot to migrate it.',
    };
  }
  return {
    kind: 'missing',
    message: 'No authoritative engine state is attached to this slot.',
  };
}

function normalizePlaySaveRecord(record: PlaySaveSlotRecord): PlaySaveSlotRecord {
  return {
    ...record,
    schema: 'deckreps-play-slot-v2',
    engineAuthority: engineAuthorityForRecord(record),
  };
}

async function persistCanonicalSerializedState(
  slotId: string,
  serializedState: SerializedGameStateV1,
  name: string,
  humanPlayerId: string = 'human',
): Promise<PlayCanonicalStateRef | null> {
  const manager = getBrowserSaveManager();
  if (!manager) return null;
  const state = deserializeGameState(serializedState);
  await manager.saveGame(slotId, state, name, humanPlayerId);
  return {
    slotId,
    fingerprint: stateFingerprint(state),
    updatedAt: Date.now(),
  };
}

export async function persistCanonicalPlaySlot(record: PlaySaveSlotRecord): Promise<PlaySaveSlotRecord> {
  const serializedState = engineStateFromRecord(record);
  if (!serializedState) return record;

  const slotId = canonicalPlaySlotId(record.slot);
  const canonicalManager = await persistCanonicalSerializedState(
    slotId,
    serializedState,
    record.name || `${record.commander} - Slot ${record.slot}`,
    snapshotFromRecord(record)?.humanId || 'human',
  );
  if (!canonicalManager) return record;

  return {
    ...record,
    schema: 'deckreps-play-slot-v2',
    canonicalManager,
    engineAuthority: {
      kind: 'save-manager',
      slotId: canonicalManager.slotId,
      fingerprint: canonicalManager.fingerprint,
      updatedAt: canonicalManager.updatedAt,
    },
  };
}

export async function loadCanonicalPlaySlotState(slot: number): Promise<SerializedGameStateV1 | null> {
  return loadCanonicalPlayStateRef({ slotId: canonicalPlaySlotId(slot), fingerprint: '', updatedAt: 0 });
}

export async function loadCanonicalPlayStateRef(ref: PlayCanonicalStateRef | null | undefined): Promise<SerializedGameStateV1 | null> {
  if (!ref?.slotId) return null;
  const manager = getBrowserSaveManager();
  if (!manager) return null;
  const state = await manager.loadGame(ref.slotId);
  return state ? serializeGameState(state) : null;
}

async function persistCanonicalDrillStates(record: PlaySaveSlotRecord): Promise<PlaySaveSlotRecord> {
  if (!record.drillBookmarks?.length) return record;
  const humanPlayerId = snapshotFromRecord(record)?.humanId || 'human';
  const drillBookmarks: PlayDrillBookmark[] = [];

  for (const bookmark of record.drillBookmarks) {
    const nextBookmark: PlayDrillBookmark = { ...bookmark };
    if (bookmark.engine) {
      try {
        const ref = await persistCanonicalSerializedState(
          canonicalDrillBookmarkSlotId(record.slot, bookmark.id),
          bookmark.engine,
          `${record.name || record.commander} - ${bookmark.label}`,
          humanPlayerId,
        );
        if (ref) nextBookmark.canonicalState = ref;
      } catch {
        // Keep the inline engine snapshot when canonical drill storage fails.
      }
    }

    if (bookmark.attempts?.length) {
      const attempts: PlayDrillAttempt[] = [];
      for (const attempt of bookmark.attempts) {
        const nextAttempt: PlayDrillAttempt = { ...attempt };
        if (attempt.engine) {
          try {
            const ref = await persistCanonicalSerializedState(
              canonicalDrillAttemptSlotId(record.slot, bookmark.id, attempt.id),
              attempt.engine,
              `${record.name || record.commander} - ${bookmark.label} - ${attempt.label}`,
              humanPlayerId,
            );
            if (ref) nextAttempt.canonicalState = ref;
          } catch {
            // Keep the inline engine snapshot when canonical attempt storage fails.
          }
        }
        attempts.push(nextAttempt);
      }
      nextBookmark.attempts = attempts;
    }

    drillBookmarks.push(nextBookmark);
  }

  return {
    ...record,
    drillBookmarks,
  };
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
      engineAuthority: engineAuthorityForRecord({
        ...record,
        canonicalManager: {
          ...record.canonicalManager,
          status: 'missing',
          verifiedAt: Date.now(),
        },
      }),
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
        engineAuthority: engineAuthorityForRecord({
          ...record,
          canonicalManager: {
            ...record.canonicalManager,
            status: 'missing',
            verifiedAt: Date.now(),
          },
        }),
      };
    }
    const verifiedFingerprint = stateFingerprint(state);
    const canonicalManager = {
      ...record.canonicalManager,
      status: verifiedFingerprint === record.canonicalManager.fingerprint ? 'ok' : 'mismatch',
      verifiedFingerprint,
      verifiedAt: Date.now(),
    } satisfies PlayCanonicalStateRef;
    return {
      ...record,
      canonicalManager,
      engineAuthority: engineAuthorityForRecord({ ...record, canonicalManager }),
    };
  } catch {
    const canonicalManager = {
      ...record.canonicalManager,
      status: 'missing',
      verifiedAt: Date.now(),
    } satisfies PlayCanonicalStateRef;
    return {
      ...record,
      canonicalManager,
      engineAuthority: engineAuthorityForRecord({ ...record, canonicalManager }),
    };
  }
}

export async function deleteCanonicalPlaySlot(slot: number): Promise<void> {
  const manager = getBrowserSaveManager();
  if (!manager) return;
  await manager.deleteSave(canonicalPlaySlotId(slot));
}

async function deleteCanonicalRecordStates(record: PlaySaveSlotRecord | null | undefined): Promise<void> {
  const manager = getBrowserSaveManager();
  if (!manager || !record) return;
  const slotIds = new Set<string>();
  if (record.canonicalManager?.slotId) slotIds.add(record.canonicalManager.slotId);
  for (const bookmark of record.drillBookmarks || []) {
    if (bookmark.canonicalState?.slotId) slotIds.add(bookmark.canonicalState.slotId);
    for (const attempt of bookmark.attempts || []) {
      if (attempt.canonicalState?.slotId) slotIds.add(attempt.canonicalState.slotId);
    }
  }
  for (const slotId of slotIds) {
    await manager.deleteSave(slotId);
  }
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
  const verifiedRecords = await Promise.all(records.map(record => verifyCanonicalManagerRecord(normalizePlaySaveRecord(record))));
  const bySlot = new Map(verifiedRecords.map(record => [record.slot, record]));
  return Array.from({ length: SLOT_COUNT }, (_, index) => bySlot.get(index + 1) || null);
}

export async function putPlaySaveSlot(record: PlaySaveSlotRecord): Promise<void> {
  if (record.slot < 1 || record.slot > SLOT_COUNT) {
    throw new Error('Save slot must be between 1 and 4');
  }
  const canonicalRecord = stripAuthoritativeEnginePayload(
    await persistCanonicalDrillStates(await persistCanonicalPlaySlot(record)),
  );
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
  let existingRecord: PlaySaveSlotRecord | null = null;
  try {
    existingRecord = (await getPlaySaveSlots())[slot - 1];
  } catch {
    existingRecord = null;
  }
  await deleteCanonicalRecordStates(existingRecord);
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
