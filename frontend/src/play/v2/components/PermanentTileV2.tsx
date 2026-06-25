import { cn } from '../../../lib/utils';
import { CardFace, Badge } from '../primitives';
import { cardViewFromPermanent } from '../cardView';
import type { CardView, CardZone, LegalAction, PermanentView } from '../../gameView.types';

export function PermanentTileV2({
  permanent, zone = 'battlefield', onAction, onView,
}: {
  permanent: PermanentView; zone?: CardZone;
  onAction(a: LegalAction): void; onView(cv: CardView): void;
}) {
  const primary = permanent.legalActions[0];
  return (
    <div className={cn('relative h-[126px] w-[90px] animate-tile-in', permanent.tapped && 'rotate-[10deg] opacity-70',
      permanent.isAttacking && 'outline outline-2 outline-offset-1 outline-ring-combat')}>
      <CardFace cardName={permanent.name} onClick={() => (primary ? onAction(primary) : onView(cardViewFromPermanent(permanent, zone)))}>
        {permanent.stackCount && permanent.stackCount > 1 ? (
          <span className="absolute left-1 top-1"><Badge tone="count">×{permanent.stackCount}</Badge></span>
        ) : null}
        {permanent.isCreature && permanent.power != null ? (
          <span className="absolute bottom-1 right-1"><Badge tone="pt">{permanent.power}/{permanent.toughness}</Badge></span>
        ) : null}
      </CardFace>
      <button
        type="button" aria-label={`Examine ${permanent.name}`}
        onClick={() => onView(cardViewFromPermanent(permanent, zone))}
        className="absolute right-0.5 top-0.5 rounded bg-black/50 px-1 text-[10px] text-gold-bright"
      >i</button>
    </div>
  );
}
