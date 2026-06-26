const STORAGE_KEY = 'mb.play.ui';
export type PlayUiMode = 'v1' | 'v2' | '3d';

function isMode(v: string | null): v is PlayUiMode {
  return v === 'v1' || v === 'v2' || v === '3d';
}

export function getPlayUiMode(search?: string): PlayUiMode {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const q = new URLSearchParams(query).get('ui');
  if (isMode(q)) return q;
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (isMode(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return 'v1';
}
