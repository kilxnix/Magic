export type Vec3 = [number, number, number];
export type ZoneRow = 'creatures' | 'artifacts' | 'lands' | 'command';

export const SEAT_R = 4.5;
export const CARD_SPACING_X = 1.2;

// local +Z points from table center toward the seated player. Rows are spread
// ACROSS the player's half (not bunched at their edge) so the previously-empty
// table center becomes the battlefield: the commander leads, creatures sit out in
// the open where combat reads, artifacts/lands step back toward the player, and the
// hand (DOCK_Z, further still) stays in front. Negative = toward table center.
export const ROW_Z: Record<ZoneRow, number> = {
  command: -2.6, // commander at the head of your field, fully in the open
  creatures: -2.0, // out toward center — where attacks/blocks read
  artifacts: -0.6,
  lands: 0.8, // your edge, just behind the hand
};

export function seatTransform(index: number, total: number): { position: Vec3; rotationY: number } {
  const a = (index / total) * Math.PI * 2;
  // rotationY = a maps local +Z (0,0,1) to world (sin a, 0, cos a).
  return {
    position: [SEAT_R * Math.sin(a), 0, SEAT_R * Math.cos(a)],
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
