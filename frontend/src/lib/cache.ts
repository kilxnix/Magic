const CACHE_PREFIX = 'mtg_';

function safeLocalStorage(): Storage | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const probe = `${CACHE_PREFIX}probe`;
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function cacheSet(key: string, data: unknown, ttlMs: number = 24 * 60 * 60 * 1000) {
  const storage = safeLocalStorage();
  if (!storage) return;
  const entry = { data, expires: Date.now() + ttlMs };
  storage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
}

export function cacheGet<T>(key: string): T | null {
  const storage = safeLocalStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (Date.now() > entry.expires) {
      storage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.data as T;
  } catch {
    return null;
  }
}

export function cacheClear(key: string) {
  const storage = safeLocalStorage();
  if (!storage) return;
  storage.removeItem(CACHE_PREFIX + key);
}
