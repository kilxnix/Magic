import { SEAT_R, seatTransform, type Vec3 } from './layout';
import type { CameraPose } from './projection';

/**
 * Default "frame the whole table" pose. With more seats the pod is wider, so the
 * angled-overhead camera lifts + pulls back to keep every board in view (flat-ish
 * cards read best looked-down-upon). Mirrors the values the shell shipped with.
 */
export function defaultPose(seats: number): CameraPose {
  const camY = 9.0 + seats * 1.3; // 2p ≈ 11.6, 3p ≈ 12.9, 4p ≈ 14.2
  const camZ = SEAT_R + 5.2 + seats; // 2p ≈ 11.7, 3p ≈ 12.7, 4p ≈ 13.7
  // Lower fov than the original 50 zooms in so the boards fill the frame instead of
  // floating in felt, without ballooning the near hand the way a very tight fov did.
  return { position: [0, camY, camZ], target: [0, 0, 0], fov: 47 };
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
  const boardR = SEAT_R + 2; // mid-board radius (between creatures and lands)
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
