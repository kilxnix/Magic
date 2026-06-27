import type { HandCardView } from '../gameView.types';
import { CardMesh } from './CardMesh';
import type { Placement } from './placements';
import { SEAT_R, CARD_SPACING_X } from './layout';
import { colorIdentityFromManaCost } from '../manaColors';

const DOCK_Z = SEAT_R + 2.5; // in front of your seat, toward the camera
const DOCK_Y = 1.2; // raised off the table so the fan is readable

function handPlacement(card: HandCardView, idx: number, count: number): Placement {
  const x = (idx - (count - 1) / 2) * CARD_SPACING_X;
  return {
    id: card.id,
    name: card.name,
    seatIndex: 0,
    row: 'command',
    position: [x, DOCK_Y, DOCK_Z],
    tapped: false,
    isOwn: true,
    manaCost: card.manaCost,
    colorIdentity: card.manaCost ? colorIdentityFromManaCost(card.manaCost) : undefined,
    typeKind: 'other',
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
