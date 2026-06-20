import { Panel, Pip, ZoneCounter } from '../primitives';
import type { YouView, ZoneKey } from '../../gameView.types';

export function YouHudV2({ you, onOpenZone }: { you: YouView; onOpenZone(zone: ZoneKey): void }) {
  return (
    <Panel className="flex items-center gap-3 px-3 py-2">
      <span className="font-display text-3xl font-bold text-ember">{you.life}</span>
      <span className="text-[11px] text-gold-muted">Hand {you.handCount} · Library {you.libraryCount}</span>
      <span className="flex gap-1">
        {(['W', 'U', 'B', 'R', 'G', 'C'] as const).filter(c => you.manaPool[c] > 0).map(c => <Pip key={c} color={c} />)}
      </span>
      <span className="ml-auto flex gap-1.5">
        <ZoneCounter icon="grave" label="Graveyard" count={you.graveyardCount} onClick={() => onOpenZone('graveyard')} />
        <ZoneCounter icon="exile" label="Exile" count={you.exile.length} onClick={() => onOpenZone('exile')} />
        <ZoneCounter icon="command" label="Command" count={you.commandZone.length} onClick={() => onOpenZone('command')} />
        <ZoneCounter icon="library" label="Library" count={you.libraryCount} />
      </span>
    </Panel>
  );
}
