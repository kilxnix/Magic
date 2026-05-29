export interface PlaySaveSlotRecord {
  slot: number;
  name: string;
  commander: string;
  turnNumber: number;
  phase: string;
  savedAt: number;
  autosaved: boolean;
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
  };
}

const DB_NAME = 'deckreps_play_saves_v1';
const STORE_NAME = 'slots';
const LOCAL_FALLBACK_KEY = 'deckreps_play_save_slots_v1';
const SLOT_COUNT = 4;

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
  window.localStorage.setItem(LOCAL_FALLBACK_KEY, JSON.stringify(records));
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
  const bySlot = new Map(records.map(record => [record.slot, record]));
  return Array.from({ length: SLOT_COUNT }, (_, index) => bySlot.get(index + 1) || null);
}

export async function putPlaySaveSlot(record: PlaySaveSlotRecord): Promise<void> {
  if (record.slot < 1 || record.slot > SLOT_COUNT) {
    throw new Error('Save slot must be between 1 and 4');
  }
  if (canUseIndexedDb()) {
    try {
      await withStore('readwrite', store => store.put(record) as IDBRequest<IDBValidKey>);
      return;
    } catch {
      // Fall back below.
    }
  }
  const records = readFallback().filter(existing => existing.slot !== record.slot);
  records.push(record);
  writeFallback(records);
}

export async function deletePlaySaveSlot(slot: number): Promise<void> {
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
