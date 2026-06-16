import type { HandCardView } from '../gameView.types';
import { CardImage } from '../../components/CardImage';

export interface DiscardOverlayProps {
  hand: HandCardView[];
  count: number;
  /** Discard one card; the hook decrements and ends the phase at 0. */
  onDiscard(cardInstanceId: string): void;
}

/**
 * DiscardOverlay — cleanup-step discard-to-hand-size. Tap a hand card to discard
 * it; the engine decrements the required count and ends the phase when it hits 0.
 *
 * PURE / PRESENTATIONAL. Rendered as a high-z overlay above the board shells.
 */
export function DiscardOverlay({ hand, count, onDiscard }: DiscardOverlayProps) {
  return (
    <div
      data-testid="discard-overlay"
      role="dialog"
      aria-label="Discard to hand size"
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-neutral-950/92 px-4 py-6 backdrop-blur-sm"
    >
      <div className="text-center">
        <h2 className="text-lg font-black uppercase tracking-wide text-rose-300">
          Discard {count} card{count === 1 ? '' : 's'}
        </h2>
        <p className="mt-1 text-xs font-medium text-stone-300">
          You're over the maximum hand size — tap cards to discard.
        </p>
      </div>

      <div className="flex max-w-full flex-wrap items-end justify-center gap-2 overflow-y-auto">
        {hand.map((card) => (
          <button
            key={card.id}
            type="button"
            data-testid="discard-card"
            data-card-id={card.id}
            onClick={() => onDiscard(card.id)}
            title={card.name}
            className="w-20 shrink-0 overflow-hidden rounded-lg border-2 border-stone-600/70 transition-all hover:-translate-y-2 hover:border-rose-400 hover:ring-2 hover:ring-rose-400/40 sm:w-24"
          >
            <CardImage
              cardName={card.name}
              size="small"
              showHoverZoom={false}
              className="aspect-[5/7] w-full"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export default DiscardOverlay;
