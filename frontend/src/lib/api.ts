const SHELECTOR_API_BASE = import.meta.env.VITE_SHELECTOR_API_BASE || '/shelector-api';

export function shelectorApiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${SHELECTOR_API_BASE.replace(/\/$/, '')}${normalizedPath}`;
}
