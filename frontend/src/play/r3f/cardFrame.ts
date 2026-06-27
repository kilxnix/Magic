import type { Placement, TypeKind } from './placements';
import { parseManaPips } from '../manaColors';

export function frameSignature(
  p: Pick<Placement, 'name' | 'power' | 'toughness' | 'tapped' | 'counters' | 'manaCost' | 'typeKind' | 'isCommander'>,
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
  return `${p.name}|${pt}|${counters}|${p.manaCost ?? ''}|${p.typeKind ?? ''}|${p.isCommander ? 'c' : ''}`;
}

const TINT: Record<string, string> = { W: '#e9e3c0', U: '#1e5fb4', B: '#3b3b46', R: '#b1361e', G: '#1c6b3c' };
const TINT_MULTI = '#c9a227';
const TINT_LAND = '#6b4f2a';
const TINT_COLORLESS = '#7a7f87';

function tintFor(colorIdentity: string[] | undefined, typeKind: TypeKind): string {
  const ci = colorIdentity ?? [];
  if (ci.length >= 2) return TINT_MULTI;
  if (ci.length === 1) return TINT[ci[0]] ?? TINT_COLORLESS;
  return typeKind === 'land' ? TINT_LAND : TINT_COLORLESS;
}

export interface FrameSpec {
  name: string;
  tint: string;
  manaPips: string[];
  pt: string | null;
  typeKind: TypeKind;
  isCommander: boolean;
  isToken: boolean;
  counterText: string | null;
}

export function frameSpec(p: Placement): FrameSpec {
  const pt = p.typeKind === 'creature' ? `${p.power ?? 0}/${p.toughness ?? 0}` : null;
  const counterText = p.counters && Object.keys(p.counters).length > 0
    ? Object.entries(p.counters).map(([k, v]) => `${k}×${v}`).join(' ')
    : null;
  return {
    name: p.name,
    tint: tintFor(p.colorIdentity, p.typeKind),
    manaPips: parseManaPips(p.manaCost ?? ''),
    pt,
    typeKind: p.typeKind,
    isCommander: Boolean(p.isCommander),
    isToken: Boolean(p.isToken),
    counterText,
  };
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
