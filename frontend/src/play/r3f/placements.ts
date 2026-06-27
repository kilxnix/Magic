import type { GameView, PermanentView } from '../gameView.types';
import { seatTransform, worldSlot, type Vec3, type ZoneRow } from './layout';

export type TypeKind = 'creature' | 'land' | 'other';

export interface Placement {
  /** Unique render id (React key + mesh userData). For an expanded land stack this
   *  is `${realId}#${i}`; otherwise it equals the card's real id. */
  id: string;
  /** Real card id to act on when clicked (an expanded copy points back at its card). */
  selectId?: string;
  name: string;
  seatIndex: number;
  row: ZoneRow;
  position: Vec3;
  tapped: boolean;
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  manaCost?: string;
  colorIdentity?: string[];
  typeKind: TypeKind;
  isCommander?: boolean;
  isToken?: boolean;
  isOwn: boolean;
  /** Extra Y-rotation (radians) added on top of tap — used to splay the hand fan. */
  yaw?: number;
  /** Seat-facing Y-rotation (radians): the card is oriented toward its own player,
   *  so each seat reads its own board upright. Equals the seat's table angle. */
  seatYaw?: number;
}

interface SeatRows {
  creatures: PermanentView[];
  artifacts: PermanentView[];
  lands: PermanentView[];
  command: PermanentView[];
}

/** The 2D view-model stacks identical lands into one tile (stackCount); the 3D board
 *  shows each as its own card so a real land row fills the table instead of one lonely
 *  tile. Every copy keeps the card's real id as selectId (so a click opens the right
 *  card) but gets a unique render id for its slot. Non-stacked cards pass through. */
function expandStacks(cards: PermanentView[]): { card: PermanentView; renderId: string }[] {
  const out: { card: PermanentView; renderId: string }[] = [];
  for (const c of cards) {
    const n = c.stackCount ?? 1;
    if (n > 1) {
      for (let i = 0; i < n; i++) out.push({ card: c, renderId: `${c.id}#${i}` });
    } else {
      out.push({ card: c, renderId: c.id });
    }
  }
  return out;
}

function placeSeat(rows: SeatRows, seatIndex: number, total: number, isOwn: boolean): Placement[] {
  const out: Placement[] = [];
  const seatYaw = seatTransform(seatIndex, total).rotationY;
  (Object.keys(rows) as (keyof SeatRows)[]).forEach((row) => {
    const expanded = expandStacks(rows[row]);
    expanded.forEach(({ card: c, renderId }, idx) => {
      out.push({
        id: renderId,
        selectId: c.id,
        name: c.name,
        seatIndex,
        seatYaw,
        row: row as ZoneRow,
        position: worldSlot(seatIndex, total, row as ZoneRow, idx, expanded.length),
        tapped: c.tapped,
        power: c.power,
        toughness: c.toughness,
        counters: c.counters,
        manaCost: c.manaCost,
        colorIdentity: c.colorIdentity,
        typeKind: c.isCreature ? 'creature' : c.isLand ? 'land' : 'other',
        isCommander: c.isCommander,
        isToken: c.isToken,
        isOwn,
      });
    });
  });
  return out;
}

export function buildPlacements(view: GameView): Placement[] {
  const total = 1 + view.opponents.length;
  const placements: Placement[] = [];

  placements.push(
    ...placeSeat(
      {
        creatures: view.you.creatures,
        artifacts: [...view.you.artifacts, ...view.you.enchantments],
        lands: view.you.lands,
        command: view.you.commandZone,
      },
      0,
      total,
      true,
    ),
  );

  view.opponents.forEach((opp, i) => {
    placements.push(
      ...placeSeat(
        {
          creatures: opp.creatures,
          artifacts: opp.other,
          lands: opp.lands,
          command: opp.commandZone,
        },
        i + 1,
        total,
        false,
      ),
    );
  });

  return placements;
}
