import { manaHex } from '../theme';
export function Pip({ color, size = 14 }: { color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: manaHex(color) }}
      className="inline-block rounded-full border border-black/30"
    />
  );
}
