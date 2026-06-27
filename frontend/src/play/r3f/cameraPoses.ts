import { seatRadius, seatTransform, type Vec3 } from './layout';
import type { CameraPose } from './projection';

/**
 * Default "frame the whole table" pose. With more seats the pod is wider, so the
 * angled-overhead camera lifts + pulls back to keep every board in view (flat-ish
 * cards read best looked-down-upon). Mirrors the values the shell shipped with.
 */
export function defaultPose(seats: number): CameraPose {
  const r = seatRadius(seats);
  const camY = 9.5 + r * 1.0; // higher with a wider table so the whole pod stays in view
  const camZ = r + 8.5; // sit behind the near seat, scaled to the (larger) table
  // Aim a touch toward the near (+Z) half rather than dead center, so the near/front
  // board — its lands, zone-pile column, and the hand dock just behind them — lifts
  // up into frame instead of sliding off the bottom edge. The far board stays in
  // view (smaller) toward the top; spin-to-focus is how you read a specific board.
  return { position: [0, camY, camZ], target: [0, 0, 1.2], fov: 46 };
}

/**
 * Close-up pose facing one seat's board. Every card tilts toward global +Z, so
 * the readable vantage for ANY board is directly in front of it on the +Z side
 * and slightly above — regardless of where the seat sits around the table.
 */
export function focusPose(seatIndex: number, total: number): CameraPose {
  const { rotationY } = seatTransform(seatIndex, total);
  const ox = Math.sin(rotationY); // outward unit vector (table center → seat)
  const oz = Math.cos(rotationY);
  const boardR = seatRadius(total) + 2; // mid-board radius (between creatures and lands)
  const bx = ox * boardR;
  const bz = oz * boardR;
  return {
    position: [bx, 5.0, bz + 6.0], // in front of the board on +Z, raised
    target: [bx, 0.3, bz],
    fov: 50,
  };
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

/** Component-wise interpolation between two poses (t clamped to [0,1]). */
export function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  // Return the endpoints exactly at the clamp boundaries — component-wise mix
  // (a + (b - a) * u) reintroduces floating-point error at u===1, so this both
  // guarantees exact endpoints and is a hair cheaper for the common t≤0 / t≥1 case.
  if (u === 0) return a;
  if (u === 1) return b;
  return {
    position: mixVec(a.position, b.position, u),
    target: mixVec(a.target, b.target, u),
    fov: mix(a.fov, b.fov, u),
  };
}

/** Smoothstep ease for the swing animation. */
export function easeInOut(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t;
  return u * u * (3 - 2 * u);
}
