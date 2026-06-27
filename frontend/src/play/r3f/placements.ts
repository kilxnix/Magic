import type { GameView, PermanentView } from '../gameView.types';
import { worldSlot, type Vec3, type ZoneRow } from './layout';

export type TypeKind = 'creature' | 'land' | 'other';

export interface Placement {
  id: string;
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
}

interface SeatRows {
  creatures: PermanentView[];
  artifacts: PermanentView[];
  lands: PermanentView[];
  command: PermanentView[];
}

function placeSeat(rows: SeatRows, seatIndex: number, total: number, isOwn: boolean): Placement[] {
  const out: Placement[] = [];
  (Object.keys(rows) as (keyof SeatRows)[]).forEach((row) => {
    const cards = rows[row];
    cards.forEach((c, idx) => {
      out.push({
        id: c.id,
        name: c.name,
        seatIndex,
        row: row as ZoneRow,
        position: worldSlot(seatIndex, total, row as ZoneRow, idx, cards.length),
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
