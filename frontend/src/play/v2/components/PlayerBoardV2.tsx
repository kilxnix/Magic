import { PermanentTileV2 } from './PermanentTileV2';
import { YouHudV2 } from './YouHudV2';
import { FitToBox } from '../../components/FitToBox';
import type { CardView, LegalAction, PermanentView, YouView, ZoneKey } from '../../gameView.types';

function BoardRow({
  label, items, onAction, onView,
}: { label: string; items: PermanentView[]; onAction(a: LegalAction): void; onView(cv: CardView): void }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={label} className="min-w-0">
      <div className="mb-1 flex items-baseline justify-center gap-2">
        <h3 className="font-display text-[12px] uppercase tracking-[0.15em] text-gold-muted">{label}</h3>
        <span className="text-[11px] font-semibold tabular-nums text-gold-muted/70">{items.length}</span>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        {items.map(p => <PermanentTileV2 key={p.id} permanent={p} onAction={onAction} onView={onView} />)}
      </div>
    </section>
  );
}

/**
 * PlayerBoardV2 — your half of the battlefield, on a recessed felt table.
 * Rows scale-to-fit (FitToBox) so the whole board is always visible — large
 * tiles when sparse, auto-shrinking as it fills, never scrolling.
 */
export function PlayerBoardV2({
  you, onAction, onView, onOpenZone,
}: { you: YouView; onAction(a: LegalAction): void; onView(cv: CardView): void; onOpenZone(zone: ZoneKey): void }) {
  const rows = [
    { label: 'Creatures', items: you.creatures },
    { label: 'Artifacts', items: you.artifacts },
    { label: 'Enchantments', items: you.enchantments },
    { label: 'Lands', items: you.lands },
    { label: 'Other', items: you.other },
  ];
  const empty = rows.every(r => r.items.length === 0);
  return (
    <div className="flex h-full flex-col gap-2">
      <YouHudV2 you={you} onOpenZone={onOpenZone} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-table-border bg-[#10201a] p-3 shadow-[inset_0_2px_28px_rgba(0,0,0,0.55),inset_0_0_60px_rgba(0,0,0,0.35)] ring-1 ring-inset ring-emerald-300/[0.05]">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
            <span className="font-display text-xl text-gold-label/80">Your battlefield is empty</span>
            <span className="text-[12px] text-gold-muted/80">Your cards are in your hand below — tap one to play a land or spell.</span>
          </div>
        ) : (
          <FitToBox className="min-h-0 flex-1">
            <div className="flex w-full flex-col gap-3">
              {rows.map(r => (
                <BoardRow key={r.label} label={r.label} items={r.items} onAction={onAction} onView={onView} />
              ))}
            </div>
          </FitToBox>
        )}
      </div>
    </div>
  );
}
