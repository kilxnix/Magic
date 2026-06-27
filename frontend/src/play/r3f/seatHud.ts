import type { GameView, OpponentFlag, PermanentView } from '../gameView.types';
import { seatTransform, type Vec3 } from './layout';

export interface SeatHud {
  seatIndex: number;
  isOwn: boolean;
  name: string;
  life: number;
  handCount: number;
  /** Total power across the seat's creatures — a glanceable threat proxy. */
  threat: number;
  /** Untapped mana available (opponents) / floating mana (you). */
  openMana: number;
  /** Highest single-source commander damage this seat has dealt YOU (opponents). */
  commanderDamageToYou: number;
  flags: OpponentFlag[];
  /** World anchor: above the table, inboard of the seat's cards. */
  position: Vec3;
}

// Float each badge so it clears its seat's card rows on screen (the badge is a DOM
// overlay, so "clearing" means sitting higher in screen space, not depth).
// Opponents sit across the table, so lifting high puts their badge at the top, above
// their board. Your own seat is at the near edge, so the same lift would land ON your
// creatures — instead anchor your badge low and toward the camera, beside your hand.
const HUD_LIFT = 3.0;
const HUD_INSET = -0.3;
// Float your own badge ABOVE your board, clear of the hand fan. The hand dock sits
// at ~seatRadius+2.3 (nearest the camera); anchoring the badge out there lands it
// right on top of your fanned cards. Lift it high and keep it inboard (small inset)
// so it reads as a label hovering over your board, mirroring the opponent badges.
const OWN_HUD_LIFT = 3.2;
const OWN_HUD_INSET = 1.0;

function sumPower(creatures: PermanentView[]): number {
  return creatures.reduce((n, c) => n + (c.power ?? 0), 0);
}

/** World position for a seat's floating HUD: lifted above the table, inboard of its cards. */
export function seatAnchor(seatIndex: number, total: number): Vec3 {
  const { position, rotationY } = seatTransform(seatIndex, total);
  const sin = Math.sin(rotationY);
  const cos = Math.cos(rotationY);
  const inset = seatIndex === 0 ? OWN_HUD_INSET : HUD_INSET;
  const lift = seatIndex === 0 ? OWN_HUD_LIFT : HUD_LIFT;
  // local offset (lx=0, lz=inset) rotated into world by the seat's rotationY.
  return [position[0] + inset * sin, lift, position[2] + inset * cos];
}

/** One HUD entry per seat (you first), pulling life/hand/threat from the view-model. */
export function seatHuds(view: GameView): SeatHud[] {
  const total = 1 + view.opponents.length;
  const huds: SeatHud[] = [];

  const m = view.you.manaPool;
  huds.push({
    seatIndex: 0,
    isOwn: true,
    name: 'You',
    life: view.you.life,
    handCount: view.you.handCount,
    threat: sumPower(view.you.creatures),
    openMana: m.W + m.U + m.B + m.R + m.G + m.C,
    commanderDamageToYou: 0,
    flags: [],
    position: seatAnchor(0, total),
  });

  view.opponents.forEach((opp, i) => {
    const g = opp.glance;
    huds.push({
      seatIndex: i + 1,
      isOwn: false,
      name: g.name,
      life: g.life,
      handCount: g.handCount,
      threat: g.totalPower,
      openMana: g.openMana,
      commanderDamageToYou: g.commanderDamageToYou,
      flags: g.flags,
      position: seatAnchor(i + 1, total),
    });
  });

  return huds;
}
