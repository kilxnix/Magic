import type { HandCardView } from '../gameView.types';
import { CardMesh } from './CardMesh';
import type { Placement } from './placements';
import { SEAT_R } from './layout';
import { colorIdentityFromManaCost } from '../manaColors';

const DOCK_Z = SEAT_R + 2.0; // in front of your seat, toward the camera
const DOCK_Y = 1.7; // raised off the table so the whole fan clears the viewport edge

// Fan the hand like held cards: overlap slightly, splay each card out from center,
// lift the middle, and curl the ends toward the camera.
const HAND_SPACING = 0.9; // < CARD_W → cards overlap into a fan
const FAN_YAW = 0.1; // radians of splay per card-step from center
const FAN_LIFT = 0.06; // center cards raised this much per step
const FAN_DEPTH = 0.16; // end cards pulled toward the camera (+Z) this much per step

function handPlacement(card: HandCardView, idx: number, count: number): Placement {
  const c = (count - 1) / 2; // center index
  const d = idx - c; // signed offset from center
  const x = d * HAND_SPACING;
  const y = DOCK_Y + (c - Math.abs(d)) * FAN_LIFT; // peak in the middle
  const z = DOCK_Z + Math.abs(d) * FAN_DEPTH; // ends curl toward viewer
  return {
    id: card.id,
    name: card.name,
    seatIndex: 0,
    row: 'command',
    position: [x, y, z],
    tapped: false,
    isOwn: true,
    manaCost: card.manaCost,
    colorIdentity: card.manaCost ? colorIdentityFromManaCost(card.manaCost) : undefined,
    typeKind: 'other',
    yaw: -d * FAN_YAW,
  };
}

export function HandDock({ hand, onSelect }: { hand: HandCardView[]; onSelect(id: string): void }) {
  return (
    <>
      {hand.map((c, i) => (
        <CardMesh key={c.id} placement={handPlacement(c, i, hand.length)} onSelect={onSelect} />
      ))}
    </>
  );
}
