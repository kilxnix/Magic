import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import type { Group } from 'three';
import type { Placement } from './placements';
import { stepToward } from './useGlide';
import { getFrameTexture } from './cardFrame';

export const CARD_W = 1.35;
export const CARD_H = 1.9;
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
  scaleOverride,
}: {
  placement: Placement;
  onSelect(id: string): void;
  onHover?(id: string | null): void;
  /** Override the default own/opponent scale (the hand uses this so its near-camera
   *  cards stay readable without ballooning over the board). */
  scaleOverride?: number;
}) {
  const [hovered, setHovered] = useState(false);
  const [x, y, z] = placement.position;
  const lift = hovered ? HOVER_LIFT : 0;
  const combatGlow = placement.isAttacking ? '#e11d48' : placement.isBlocking ? '#0ea5e9' : null;
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
    // Outer group: position (driven by the glide via groupRef) + scale.
    <group ref={groupRef} scale={scaleOverride ?? (placement.isOwn ? 1 : OPPONENT_SCALE)}>
      {/* Seat-facing yaw: orient the card toward its own player so each seat reads
          its board upright (rotating the table to a seat makes their cards face you). */}
      <group rotation={[0, placement.seatYaw ?? 0, 0]}>
        {/* Stand the card up toward the viewer (tilt) plus tap spin + hand-fan splay. */}
        <group rotation={[CARD_TILT, (placement.tapped ? Math.PI / 2 : 0) + (placement.yaw ?? 0), 0]}>
          {/* Lay the card flat: rotate the upright card -90deg about X so its face points up (+Y). */}
          <mesh
            rotation={[-Math.PI / 2, 0, 0]}
            userData={{ id: placement.id }}
            castShadow
            receiveShadow
            onClick={(e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              onSelect(placement.selectId ?? placement.id);
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
              // Hover wins; otherwise glow the card edges rose when attacking / sky when
              // blocking so combat reads on the board, not just in the DOM banner.
              emissive={hovered ? '#facc15' : combatGlow ?? '#000000'}
              // Combat glow is pushed above the Bloom threshold (0.55) so an attacking/
              // blocking card's edge visibly blooms instead of a faint hard-to-see line.
              emissiveIntensity={hovered ? 0.9 : combatGlow ? 1.3 : 0}
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
      </group>
    </group>
  );
}
