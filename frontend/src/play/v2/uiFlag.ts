const STORAGE_KEY = 'mb.play.ui';

export function isPlayUiV2(search?: string): boolean {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (new URLSearchParams(query).get('ui') === 'v2') return true;
  try {
    return typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'v2';
  } catch {
    return false;
  }
}

export function setPlayUiV2(on: boolean): void {
  try { localStorage?.setItem(STORAGE_KEY, on ? 'v2' : 'v1'); } catch { /* storage unavailable */ }
}
