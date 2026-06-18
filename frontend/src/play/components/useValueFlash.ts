import { useEffect, useRef, useState } from 'react';

/**
 * useValueFlash — returns 'up' | 'down' for ~520ms whenever `v` changes, so a
 * displayed number (life total, etc.) can flash + tint on the change and then
 * settle. Returns null at rest. Pair with the `value-flash` keyframe and a
 * directional tint; reduced-motion users get an instant swap via the global
 * prefers-reduced-motion rule in index.css.
 */
export function useValueFlash(v: number): 'up' | 'down' | null {
  const prev = useRef(v);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (v !== prev.current) {
      setDir(v > prev.current ? 'up' : 'down');
      prev.current = v;
      const t = setTimeout(() => setDir(null), 520);
      return () => clearTimeout(t);
    }
  }, [v]);

  return dir;
}
