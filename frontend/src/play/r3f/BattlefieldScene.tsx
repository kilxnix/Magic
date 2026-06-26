import type { GameView } from '../gameView.types';
import { buildPlacements } from './placements';
import { CardMesh } from './CardMesh';
import { SEAT_R } from './layout';

const CARD_BASE = 0.03;

export function BattlefieldScene({ view, onSelect }: { view: GameView; onSelect(id: string): void }) {
  const placements = buildPlacements(view);
  const tableSize = SEAT_R * 2 + 4;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 12, 8]} intensity={1.1} castShadow />

      {/* Table surface on the XZ plane (rotate the plane to lie flat). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -CARD_BASE, 0]} receiveShadow>
        <planeGeometry args={[tableSize, tableSize]} />
        <meshStandardMaterial color="#1c1917" />
      </mesh>

      {placements.map((p) => (
        <CardMesh key={p.id} placement={p} onSelect={onSelect} />
      ))}
    </>
  );
}
