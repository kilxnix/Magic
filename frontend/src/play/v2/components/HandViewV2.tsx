import { CardFace } from '../primitives';
import { cardViewFromHand } from '../cardView';
import type { CardView, HandCardView, LegalAction } from '../../gameView.types';

export function HandViewV2({
  hand, onAction, onView,
}: { hand: HandCardView[]; onAction(a: LegalAction): void; onView(cv: CardView): void }) {
  const mid = (hand.length - 1) / 2;
  return (
    <div className="flex h-full items-end justify-center">
      {hand.map((c, i) => {
        const primary = c.legalActions[0];
        return (
          <button
            key={c.id} type="button" aria-label={c.name}
            onClick={() => (primary ? onAction(primary) : onView(cardViewFromHand(c)))}
            style={{ transform: `rotate(${(i - mid) * 5}deg) translateY(${Math.abs(i - mid) * 4}px)`, marginLeft: i === 0 ? 0 : -14 }}
            className="origin-bottom"
          >
            <CardFace cardName={c.name} className="h-[88px] w-[62px]" />
          </button>
        );
      })}
    </div>
  );
}
