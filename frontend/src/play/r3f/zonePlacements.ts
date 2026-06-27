import { seatTransform, type Vec3 } from './layout';
import type { GameView } from '../gameView.types';

export type ZoneKind = 'graveyard' | 'library' | 'exile';

export interface ZonePile {
  /** Stable id, e.g. "you:graveyard". */
  id: string;
  /** 'you' for your seat, else the opponent's glance.playerId (ZoneExplorerV2 keys on this). */
  playerId: string;
  isOwn: boolean;
  zone: ZoneKind;
  /** Count to show, or null when the size is hidden (an opponent's library). */
  count: number | null;
  position: Vec3;
}

// +X is the seat's right; +Z points toward the seated player (the camera side).
//
// Every seat gets the SAME shape: a vertical column of the three piles at the
// seat's right edge, well outside the card rows (which span local x ~ ±3.2) and
// outside a fanned hand. A column (constant x, stepped in z) reads as a tidy
// "playmat sideboard" and — unlike a horizontal row tucked behind the cards —
// stays clear of the permanents so it's both legible and clickable. Deck sits
// nearest the seated player, graveyard next, exile farthest, like a real table.
//
// Your own seat sits slightly wider (4.4) to clear your fanned hand; opponents
// (no hand) sit at 3.8 so the column stays comfortably on the table after the
// seat rotation. ROW_Z.lands = 0.8 is the deepest card row; the column's z-band
// (-0.45 … 1.55) brackets it but at x ≥ 3.8 never overlaps it.
const OWN_COLUMN_X = 4.4;
const OPP_COLUMN_X = 3.8;
const COLUMN_Z: Record<ZoneKind, number> = {
  library: 1.55, // nearest the seated player
  graveyard: 0.55,
  exile: -0.45, // farthest from the seated player
};

function pileWorld(seatIndex: number, total: number, zone: ZoneKind, isOwn: boolean): Vec3 {
  const { position, rotationY } = seatTransform(seatIndex, total);
  const lx = isOwn ? OWN_COLUMN_X : OPP_COLUMN_X;
  const lz = COLUMN_Z[zone];
  const sin = Math.sin(rotationY);
  const cos = Math.cos(rotationY);
  // rotate (lx, lz) around Y by rotationY, then translate by the seat position
  // (same convention as worldSlot in layout.ts).
  const wx = lx * cos + lz * sin;
  const wz = -lx * sin + lz * cos;
  return [position[0] + wx, 0, position[2] + wz];
}

/** Graveyard / library / exile pile markers for every seat (you first). */
export function zonePilePlacements(view: GameView): ZonePile[] {
  const total = 1 + view.opponents.length;
  const piles: ZonePile[] = [];
  const push = (seatIndex: number, playerId: string, isOwn: boolean, zone: ZoneKind, count: number | null) => {
    piles.push({ id: `${playerId}:${zone}`, playerId, isOwn, zone, count, position: pileWorld(seatIndex, total, zone, isOwn) });
  };

  push(0, 'you', true, 'graveyard', view.you.graveyardCount);
  push(0, 'you', true, 'library', view.you.libraryCount);
  push(0, 'you', true, 'exile', view.you.exile.length);

  view.opponents.forEach((o, i) => {
    const pid = o.glance.playerId;
    push(i + 1, pid, false, 'graveyard', o.graveyardCount);
    push(i + 1, pid, false, 'library', null); // an opponent's deck size is hidden
    push(i + 1, pid, false, 'exile', o.exileCount);
  });

  return piles;
}
