export type Vec3 = [number, number, number];
export type ZoneRow = 'creatures' | 'artifacts' | 'lands' | 'command';

export const SEAT_R = 4.5;
export const CARD_SPACING_X = 1.6;

/**
 * Table radius (table center → a seat) grows with the player count. With 2 players
 * facing off, a tight radius lets each board reach toward the open center and fill
 * the table. With 3-4 players seated around the table, the same reach would pile
 * every board's center-facing rows on top of each other in the middle — so the
 * radius widens to give each seat its own wedge and keep the center open.
 */
export function seatRadius(total: number): number {
  if (total <= 2) return SEAT_R; // 4.5
  if (total === 3) return SEAT_R + 0.9; // 5.4
  return SEAT_R + 1.5; // 4p = 6.0 — wide enough that seats don't pile in the
  // center, tight enough that the table fills the frame instead of leaving a vast
  // empty middle (and so the near/front board doesn't clip off the bottom edge).
}

// local +Z points from table center toward the seated player. Rows are spread
// ACROSS the player's whole half so the table center becomes the battlefield
// instead of empty felt: the commander leads near center, creatures sit out in the
// open where combat reads, then artifacts and lands step back toward the player,
// and the hand (DOCK_Z, further still) stays in front. The ~1.5 row gaps roughly
// match a tilted card's depth so rows read as a packed, slightly-overlapping field
// rather than four sparse strips. Negative = toward table center.
export const ROW_Z: Record<ZoneRow, number> = {
  command: -3.3, // commander at the head of your field, near the open center
  creatures: -2.0, // out toward center — where attacks/blocks read
  artifacts: -0.9,
  lands: 0.2, // a clear row in front of your creatures, with room before the hand
};

export function seatTransform(index: number, total: number): { position: Vec3; rotationY: number } {
  const a = (index / total) * Math.PI * 2;
  const r = seatRadius(total);
  // rotationY = a maps local +Z (0,0,1) to world (sin a, 0, cos a).
  return {
    position: [r * Math.sin(a), 0, r * Math.cos(a)],
    rotationY: a,
  };
}

export function zoneSlotLocal(row: ZoneRow, idx: number, count: number): Vec3 {
  const x = (idx - (count - 1) / 2) * CARD_SPACING_X;
  return [x, 0, ROW_Z[row]];
}

export function worldSlot(
  seatIndex: number,
  total: number,
  row: ZoneRow,
  idx: number,
  count: number,
): Vec3 {
  const { position, rotationY } = seatTransform(seatIndex, total);
  const [lx, ly, lz] = zoneSlotLocal(row, idx, count);
  const sin = Math.sin(rotationY);
  const cos = Math.cos(rotationY);
  // rotate (lx, lz) around Y by rotationY, then translate by seat position.
  const wx = lx * cos + lz * sin;
  const wz = -lx * sin + lz * cos;
  return [position[0] + wx, ly, position[2] + wz];
}
