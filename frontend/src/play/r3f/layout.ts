export type Vec3 = [number, number, number];
export type ZoneRow = 'creatures' | 'artifacts' | 'lands' | 'command';

export const SEAT_R = 6;
export const CARD_SPACING_X = 1.2;

// local +Z points from table center toward the seated player.
// creatures sit nearest center (smallest z), lands nearest the player (largest z).
export const ROW_Z: Record<ZoneRow, number> = {
  creatures: 1.0,
  artifacts: 2.0,
  lands: 3.0,
  command: 0.2,
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
