import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { Group } from 'three';
import type { Placement } from './placements';
import { stepToward } from './useGlide';
import { getFrameTexture } from './cardFrame';

export const CARD_W = 1.0;
export const CARD_H = 1.4;
export const CARD_T = 0.04;
const HOVER_LIFT = 0.25;

// Every card shares one world orientation (only tap spins Y), so a single +X tilt
// stands them all up toward the angled-overhead camera: the name edge rises to the
// top and the face turns toward the viewer, so every seat's cards read at a glance
// instead of lying edge-on flat. ~31deg props them up Arena-style without occluding
// the rows behind.
export const CARD_TILT = 0.55;

// Opponent seats sit farther from the camera, so perspective shrinks their cards.
// Scale them up to partially equalize apparent size (full detail is reachable via
// tap-to-focus). Kept under CARD_SPACING_X / CARD_W to avoid heavy in-row overlap.
export const OPPONENT_SCALE = 1.25;

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
  const groupRef = useRef<Group>(null);
  const texture = useMemo(() => getFrameTexture(placement), [placement]);

  useEffect(() => {
    groupRef.current?.position.set(x, y + lift, z);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((state, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const target: [number, number, number] = [x, y + lift, z];
    const cur: [number, number, number] = [g.position.x, g.position.y, g.position.z];
    const [nx, ny, nz] = stepToward(cur, target, dt);
    g.position.set(nx, ny, nz);
    if (nx !== target[0] || ny !== target[1] || nz !== target[2]) state.invalidate();
  });

  return (
    <group
      ref={groupRef}
      rotation={[CARD_TILT, (placement.tapped ? Math.PI / 2 : 0) + (placement.yaw ?? 0), 0]}
      scale={placement.isOwn ? 1 : OPPONENT_SCALE}
    >
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
        <meshStandardMaterial
          color={texture ? '#0b0b0c' : frameColor(placement.isOwn, hovered)}
          emissive={hovered ? '#facc15' : '#000000'}
          emissiveIntensity={hovered ? 0.9 : 0}
        />
      </mesh>

      {/* Unlit frame face so the card stays legible regardless of scene lighting. */}
      {texture ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, CARD_T / 2 + 0.001, 0]}>
          <planeGeometry args={[CARD_W, CARD_H]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      ) : null}
    </group>
  );
}
