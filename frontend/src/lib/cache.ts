const CACHE_PREFIX = 'mtg_';

export function cacheSet(key: string, data: unknown, ttlMs: number = 24 * 60 * 60 * 1000) {
  const entry = { data, expires: Date.now() + ttlMs };
  localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
}

export function cacheGet<T>(key: string): T | null {
  const raw = localStorage.getItem(CACHE_PREFIX + key);
  if (!raw) return null;
  const entry = JSON.parse(raw);
  if (Date.now() > entry.expires) {
    localStorage.removeItem(CACHE_PREFIX + key);
    return null;
  }
  return entry.data as T;
}

export function cacheClear(key: string) {
  localStorage.removeItem(CACHE_PREFIX + key);
}
