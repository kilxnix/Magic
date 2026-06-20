import { OpponentChipV2 } from './OpponentChipV2';
import type { OpponentBoard } from '../../gameView.types';

export function OpponentRailV2({ opponents, onExplore }: { opponents: OpponentBoard[]; onExplore(id: string): void }) {
  return (
    <div className="flex gap-2 overflow-x-auto overscroll-contain">
      {opponents.map(o => (
        <div key={o.glance.playerId} className="w-[clamp(11rem,16vw,15rem)] shrink-0">
          <OpponentChipV2 board={o} onExplore={onExplore} />
        </div>
      ))}
    </div>
  );
}
