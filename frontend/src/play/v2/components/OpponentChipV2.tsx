import { Panel } from '../primitives';
import type { OpponentBoard } from '../../gameView.types';

export function OpponentChipV2({ board, onExplore }: { board: OpponentBoard; onExplore(id: string): void }) {
  const g = board.glance;
  return (
    <button type="button" aria-label={`Explore ${g.name}`} onClick={() => onExplore(g.playerId)} className="w-full text-left">
      <Panel className="flex items-center gap-2 px-2 py-1.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-table-frame font-display text-sm text-gold-bright">
          {g.name.charAt(0)}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-[15px] font-bold text-gold-bright">{g.name}</span>
          <span className="block truncate text-[11px] text-gold-muted">{g.creatureCount} creatures{g.contextNote ? ` · ${g.contextNote}` : ''}</span>
        </span>
        <span className="ml-auto font-bold text-ember">♥ {g.life}</span>
      </Panel>
    </button>
  );
}
