import { ModalShell, Badge, BrassButton } from '../primitives';
import { CardImage } from '../../../components/CardImage';
import type { CardView, LegalAction } from '../../gameView.types';

export function CardViewerV2({
  card, onClose, onAction,
}: { card: CardView | null; onClose(): void; onAction(a: LegalAction): void }) {
  if (!card) return null;
  return (
    <ModalShell title={card.name} onClose={onClose}>
      <div className="flex gap-4">
        <div className="w-[230px] shrink-0 overflow-hidden rounded-lg border border-card-border">
          <CardImage cardName={card.name} size="normal" showHoverZoom={false} className="w-full" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {card.power != null ? <span className="font-display text-2xl text-gold-bright">{card.power} / {card.toughness}</span> : null}
          <div className="flex flex-wrap gap-1">
            {card.statuses.map(s => <Badge key={s} tone="count">{s}</Badge>)}
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            {card.legalActions.map((a, i) => <BrassButton key={i} tone="primary" onClick={() => onAction(a)}>{a.label}</BrassButton>)}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
