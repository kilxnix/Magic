// Raw hexes for places Tailwind classes can't reach (inline styles, canvas,
// dynamic mana colors). Tailwind class names are the primary styling path;
// these mirror the same values (see tailwind.config.js + Global Constraints).
export const TABLE = {
  felt: '#14251c', vignette: '#080b0a', frame: '#26190d',
  leather: '#281c10', leather2: '#32230f', border: '#5a4324', borderHi: '#7a5a2a',
} as const;
export const CARD = { stock: '#e3d2a6', border: '#9a824f', ink: '#2a1f10', badge: '#8a6f3f' } as const;
export const BRASS = { base: '#b8842c', deep: '#9a6c1f', on: '#241804' } as const;
export const GOLD = { label: '#d8b86a', bright: '#ead6a4', muted: '#a88c5e' } as const;
export const STATUS = { ember: '#cf6a52', oxblood: '#8a2a1e', ring: '#c79a45' } as const;
export const MANA = { W: '#ece0ba', U: '#2f5f86', B: '#241c14', R: '#9a3326', G: '#2f6b40' } as const;

export function manaHex(color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'): string {
  if (color === 'C') return '#bfb39a';
  return MANA[color];
}
