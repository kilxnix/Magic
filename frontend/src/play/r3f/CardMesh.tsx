import { useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Placement } from './placements';

export const CARD_W = 1.0;
export const CARD_H = 1.4;
export const CARD_T = 0.04;
const HOVER_LIFT = 0.25;

// Color the frame by seat ownership; full per-type theming arrives in a later milestone.
function frameColor(isOwn: boolean, hovered: boolean): string {
  if (hovered) return '#facc15';
  return isOwn ? '#3f6212' : '#7f1d1d';
}

export function CardMesh({
  placement,
  onSelect,
  onHover,
}: {
  placement: Placement;
  onSelect(id: string): void;
  onHover?(id: string | null): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [x, y, z] = placement.position;
  const lift = hovered ? HOVER_LIFT : 0;

  return (
    <group position={[x, y + lift, z]} rotation={[0, placement.tapped ? Math.PI / 2 : 0, 0]}>
      {/* Lay the card flat: rotate the upright card -90deg about X so its face points up (+Y). */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        userData={{ id: placement.id }}
        castShadow
        receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(placement.id);
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
          onHover?.(placement.id);
        }}
        onPointerOut={() => {
          setHovered(false);
          onHover?.(null);
        }}
      >
        <boxGeometry args={[CARD_W, CARD_H, CARD_T]} />
        <meshStandardMaterial color={frameColor(placement.isOwn, hovered)} />
      </mesh>
    </group>
  );
}
