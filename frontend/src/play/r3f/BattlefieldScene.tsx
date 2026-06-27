import { useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
import type { GameView } from '../gameView.types';
import { buildPlacements } from './placements';
import { CardMesh } from './CardMesh';
import { SEAT_R } from './layout';

const CARD_BASE = 0.03;

/** Dark green felt playmat with a lit center + vignette. Null without a 2D context. */
function makePlaymatTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 40, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#1f3a2a'); // lit center
  g.addColorStop(0.6, '#15281d');
  g.addColorStop(1, '#0a140e'); // vignette
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function BattlefieldScene({ view, onSelect }: { view: GameView; onSelect(id: string): void }) {
  const placements = buildPlacements(view);
  const tableSize = SEAT_R * 2 + 4;
  const playmat = useMemo(() => makePlaymatTexture(), []);

  return (
    <>
      {/* 3-point cinematic lighting. */}
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#bcd2ff', '#1a1208', 0.5]} />
      <directionalLight
        position={[6, 13, 7]}
        intensity={1.5}
        color="#fff3df"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-8, 6, -6]} intensity={0.35} color="#9fc0ff" />

      {/* Table surface on the XZ plane (rotate the plane to lie flat). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -CARD_BASE, 0]} receiveShadow>
        <planeGeometry args={[tableSize, tableSize]} />
        {playmat ? (
          <meshStandardMaterial map={playmat} roughness={0.9} metalness={0} />
        ) : (
          <meshStandardMaterial color="#15281d" roughness={0.9} />
        )}
      </mesh>

      {placements.map((p) => (
        <CardMesh key={p.id} placement={p} onSelect={onSelect} />
      ))}
    </>
  );
}
