import { useState } from 'react';
import { ModalShell, CardFace } from '../primitives';
import { cn } from '../../../lib/utils';
import { cardViewFromZone, cardViewFromPermanent } from '../cardView';
import type { CardView, CardZone, GameView, PermanentView, ZoneCardView, ZoneKey } from '../../gameView.types';

export type { ZoneKey }; // re-exported for the shells; defined once in gameView.types
const TABS: { key: ZoneKey; label: string }[] = [
  { key: 'graveyard', label: 'Graveyard' }, { key: 'exile', label: 'Exile' }, { key: 'command', label: 'Command' },
];

// Returns thumbnails for a player+zone. Command zone holds PermanentViews; others ZoneCardViews.
function entries(view: GameView, playerId: string, zone: ZoneKey): { id: string; name: string; cv: CardView }[] {
  const isYou = playerId === 'you';
  if (zone === 'command') {
    const cz: PermanentView[] = isYou ? view.you.commandZone : (view.opponents.find(o => o.glance.playerId === playerId)?.commandZone ?? []);
    return cz.map(p => ({ id: p.id, name: p.name, cv: cardViewFromPermanent(p, 'command') }));
  }
  if (zone === 'library') return []; // hidden by default — count only
  const list: ZoneCardView[] = isYou
    ? (zone === 'graveyard' ? view.you.graveyard : view.you.exile)
    : (() => { const o = view.opponents.find(op => op.glance.playerId === playerId); return o ? (zone === 'graveyard' ? o.graveyard : o.exile) : []; })();
  return list.map(z => ({ id: z.id, name: z.name, cv: cardViewFromZone(z, zone as CardZone) }));
}

export function ZoneExplorerV2({
  view, target, onClose, onView,
}: { view: GameView; target: { playerId: string; zone: ZoneKey }; onClose(): void; onView(cv: CardView): void }) {
  const [zone, setZone] = useState<ZoneKey>(target.zone);
  const playerName = target.playerId === 'you' ? 'You' : (view.opponents.find(o => o.glance.playerId === target.playerId)?.glance.name ?? 'Opponent');
  const items = entries(view, target.playerId, zone);
  const tabs = (
    <span className="flex gap-1.5">
      {TABS.map(t => (
        <button key={t.key} type="button" onClick={() => setZone(t.key)}
          className={cn('rounded-full border px-2.5 py-0.5 text-[11px]', zone === t.key ? 'border-brass-deep bg-brass text-brass-on font-semibold' : 'border-table-border text-gold-muted')}>
          {t.label}
        </button>
      ))}
    </span>
  );
  return (
    <ModalShell title={`${playerName} · ${zone[0].toUpperCase()}${zone.slice(1)}`} onClose={onClose} side={tabs}>
      {items.length === 0 ? (
        <p className="py-8 text-center text-gold-muted">No cards here.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map(it => (
            <button key={it.id} type="button" aria-label={it.name} onClick={() => onView(it.cv)}>
              <CardFace cardName={it.name} className="h-[88px] w-[62px]" />
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
