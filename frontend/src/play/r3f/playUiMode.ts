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

/**
 * Whether PlayPage should host the rebuilt PlayExperience shells (v2 + the 3d
 * battlefield) instead of the legacy <GameBoard>. The 3d shell lives *inside*
 * PlayExperience, so ?ui=3d must flip this gate — otherwise the shell selected
 * by getPlayUiMode is never mounted. The legacy ?newui=1 escape hatch is kept.
 */
export function usesPlayExperience(search?: string): boolean {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(query);
  if (params.get('newui') === '1') return true;
  const ui = params.get('ui');
  return ui === 'v2' || ui === '3d';
}
