import { useMemo, useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { CARD_W, CARD_H, CARD_T, CARD_TILT, OPPONENT_SCALE } from './CardMesh';
import type { ZoneKind, ZonePile } from './zonePlacements';

const PILE_SCALE = 0.62; // piles are smaller than battlefield cards

const ZONE_STYLE: Record<ZoneKind, { label: string; tint: string; fill: string }> = {
  graveyard: { label: 'GRAVE', tint: '#9aa0aa', fill: '#23252b' },
  library: { label: 'DECK', tint: '#3a7bd5', fill: '#16213a' },
  exile: { label: 'EXILE', tint: '#b06bd6', fill: '#241430' },
};

const TEX_W = 128;
const TEX_H = 180;
const texCache = new Map<string, CanvasTexture | null>();

/** Label + count baked to a CanvasTexture (unlit, so it reads in any lighting). Null in headless. */
function zoneTexture(zone: ZoneKind, count: number | null): CanvasTexture | null {
  const key = `${zone}:${count ?? '?'}`;
  if (texCache.has(key)) return texCache.get(key) ?? null;
  let tex: CanvasTexture | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = TEX_W;
    canvas.height = TEX_H;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const s = ZONE_STYLE[zone];
      ctx.fillStyle = s.fill;
      ctx.fillRect(0, 0, TEX_W, TEX_H);
      ctx.lineWidth = 8;
      ctx.strokeStyle = s.tint;
      ctx.strokeRect(5, 5, TEX_W - 10, TEX_H - 10);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = s.tint;
      ctx.font = 'bold 22px system-ui, sans-serif';
      ctx.fillText(s.label, TEX_W / 2, 30);
      ctx.fillStyle = '#f4f1e6';
      ctx.font = 'bold 54px system-ui, sans-serif';
      ctx.fillText(count == null ? '—' : String(count), TEX_W / 2, TEX_H / 2 + 8);
      ctx.fillStyle = s.tint;
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText('cards', TEX_W / 2, TEX_H - 26);
      tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
    }
  }
  texCache.set(key, tex);
  return tex;
}

/** A graveyard / library / exile pile: a small stacked tile whose height hints at
 *  size, with a label + count on top. Click opens the DOM zone browser. */
export function ZonePileMesh({ pile, onBrowse }: { pile: ZonePile; onBrowse(playerId: string, zone: ZoneKind): void }) {
  const [hovered, setHovered] = useState(false);
  const [x, y, z] = pile.position;
  const texture = useMemo(() => zoneTexture(pile.zone, pile.count), [pile.zone, pile.count]);
  const n = pile.count ?? 30;
  const thickness = CARD_T * (2 + Math.min(n, 60) * 0.25); // taller pile = more cards
  const w = CARD_W * PILE_SCALE;
  const h = CARD_H * PILE_SCALE;
  const tint = ZONE_STYLE[pile.zone].tint;

  return (
    <group position={[x, y, z]} rotation={[CARD_TILT, 0, 0]} scale={pile.isOwn ? 1 : OPPONENT_SCALE}>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        userData={{ zoneId: pile.id }}
        castShadow
        receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onBrowse(pile.playerId, pile.zone);
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[w, h, thickness]} />
        <meshStandardMaterial
          color={ZONE_STYLE[pile.zone].fill}
          emissive={hovered ? '#facc15' : tint}
          emissiveIntensity={hovered ? 0.85 : 0.14}
        />
      </mesh>
      {texture ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, thickness / 2 + 0.001, 0]}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial map={texture} toneMapped={false} />
        </mesh>
      ) : null}
    </group>
  );
}

export default ZonePileMesh;
