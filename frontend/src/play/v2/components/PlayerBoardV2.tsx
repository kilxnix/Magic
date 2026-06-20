import { PermanentTileV2 } from './PermanentTileV2';
import { YouHudV2 } from './YouHudV2';
import type { CardView, LegalAction, PermanentView, YouView, ZoneKey } from '../../gameView.types';

function Row({ items, onAction, onView }: { items: PermanentView[]; onAction(a: LegalAction): void; onView(cv: CardView): void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(p => <PermanentTileV2 key={p.id} permanent={p} onAction={onAction} onView={onView} />)}
    </div>
  );
}

export function PlayerBoardV2({
  you, onAction, onView, onOpenZone,
}: { you: YouView; onAction(a: LegalAction): void; onView(cv: CardView): void; onOpenZone(zone: ZoneKey): void }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <YouHudV2 you={you} onOpenZone={onOpenZone} />
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden">
        <Row items={you.creatures} onAction={onAction} onView={onView} />
        <Row items={[...you.artifacts, ...you.enchantments, ...you.other]} onAction={onAction} onView={onView} />
        <Row items={you.lands} onAction={onAction} onView={onView} />
      </div>
    </div>
  );
}
