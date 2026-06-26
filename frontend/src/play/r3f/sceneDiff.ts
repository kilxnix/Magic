import type { Vec3 } from './layout';
import type { Placement } from './placements';

export interface PlacementDiff {
  entered: string[];
  left: string[];
  moved: { id: string; from: Vec3; to: Vec3 }[];
  tapChanged: { id: string; tapped: boolean }[];
}

function near(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
}

export function diffPlacements(prev: Placement[], next: Placement[]): PlacementDiff {
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const nextById = new Map(next.map((p) => [p.id, p]));

  const entered = next.filter((p) => !prevById.has(p.id)).map((p) => p.id);
  const left = prev.filter((p) => !nextById.has(p.id)).map((p) => p.id);

  const moved: PlacementDiff['moved'] = [];
  const tapChanged: PlacementDiff['tapChanged'] = [];
  for (const n of next) {
    const o = prevById.get(n.id);
    if (!o) continue;
    if (!near(o.position, n.position)) moved.push({ id: n.id, from: o.position, to: n.position });
    if (o.tapped !== n.tapped) tapChanged.push({ id: n.id, tapped: n.tapped });
  }

  return { entered, left, moved, tapChanged };
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  const c = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * c, a[1] + (b[1] - a[1]) * c, a[2] + (b[2] - a[2]) * c];
}
