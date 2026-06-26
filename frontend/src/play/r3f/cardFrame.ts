import type { Placement } from './placements';

export function frameSignature(
  p: Pick<Placement, 'name' | 'power' | 'toughness' | 'tapped' | 'counters'>,
): string {
  const pt = p.power != null || p.toughness != null ? `${p.power ?? ''}/${p.toughness ?? ''}` : '';
  const counters = p.counters
    ? Object.keys(p.counters)
        .sort()
        .map((k) => `${k}:${p.counters![k]}`)
        .join(',')
    : '';
  // tapped does NOT change the drawn frame (tapping is a mesh rotation), so it is
  // intentionally excluded — identical cards share one texture whether tapped or not.
  return `${p.name}|${pt}|${counters}`;
}

export function createFrameCache<T>(make: (p: Placement) => T): { get(p: Placement): T; size(): number } {
  const store = new Map<string, T>();
  return {
    get(p: Placement): T {
      const sig = frameSignature(p);
      let v = store.get(sig);
      if (v === undefined) {
        v = make(p);
        store.set(sig, v);
      }
      return v;
    },
    size: () => store.size,
  };
}
