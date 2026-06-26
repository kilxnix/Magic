import type { Vec3 } from './layout';
import { lerpVec3 } from './sceneDiff';

const SNAP_EPS = 0.01;

export function stepToward(current: Vec3, target: Vec3, dt: number, speed = 5): Vec3 {
  const dist = Math.hypot(target[0] - current[0], target[1] - current[1], target[2] - current[2]);
  if (dist < SNAP_EPS) return target;
  const t = Math.min(1, speed * dt);
  return lerpVec3(current, target, t);
}
