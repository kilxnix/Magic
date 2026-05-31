import type { StorageAdapter } from './manager';

export interface KeyValueStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/**
 * Browser localStorage adapter for SaveManager.
 *
 * The engine stays storage-agnostic, but browser practice flows need a durable
 * adapter that exercises the same SaveManager path as tests and future mobile
 * storage adapters.
 */
export class BrowserLocalStorageAdapter implements StorageAdapter {
  private storage: KeyValueStorageLike;

  constructor(storage?: KeyValueStorageLike) {
    const candidate = storage ?? globalThis.localStorage;
    if (!candidate) {
      throw new Error('BrowserLocalStorageAdapter requires localStorage or a storage-like object');
    }
    this.storage = candidate;
  }

  get(key: string): string | null {
    return this.storage.getItem(key);
  }

  set(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  remove(key: string): void {
    this.storage.removeItem(key);
  }

  keys(prefix: string): string[] {
    const result: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key && key.startsWith(prefix)) {
        result.push(key);
      }
    }
    return result;
  }
}
