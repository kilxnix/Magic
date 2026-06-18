import type { HandCardView } from '../gameView.types';
import { CardImage } from '../../components/CardImage';
import { cn } from '../../lib/utils';

export interface MulliganOverlayProps {
  /** The human's current hand (from the view-model). */
  hand: HandCardView[];
  count: number;
  /** > 0 only during the post-mulligan bottom-selection stage. */
  bottomCount: number;
  selectedCardIds: string[];
  selectedBottomIds: string[];
  onKeep: () => void;
  onMulligan: (cardInstanceIds?: string[]) => void;
  onToggleCard: (cardInstanceId: string) => void;
  onToggleBottom: (cardInstanceId: string) => void;
}

/**
 * MulliganOverlay — the London-mulligan opening-hand decision.
 *
 * Two stages, driven by the hook (mirrors GameBoard's hand-dock mulligan):
 *  1. Decide: keep this hand, or mulligan (optionally tap cards first — the
 *     engine treats the selection as a partial mulligan; empty = full redraw).
 *  2. Bottom (bottomCount > 0 after a mulligan): tap exactly `bottomCount` cards
 *     to put on the bottom, then Keep commits them.
 *
 * Presentational: props in, resolver callbacks out. Rendered as a high-z overlay
 * above the board shells so the board can't be acted on mid-mulligan.
 */
export function MulliganOverlay({
  hand,
  count,
  bottomCount,
  selectedCardIds,
  selectedBottomIds,
  onKeep,
  onMulligan,
  onToggleCard,
  onToggleBottom,
}: MulliganOverlayProps) {
  const bottoming = bottomCount > 0;
  const selected = bottoming ? selectedBottomIds : selectedCardIds;
  const onToggle = bottoming ? onToggleBottom : onToggleCard;
  const keepReady = !bottoming || selected.length === bottomCount;

  const heading = bottoming
    ? `Put ${bottomCount} card${bottomCount === 1 ? '' : 's'} on the bottom`
    : count > 0
      ? `Mulligan #${count} — keep or mulligan again`
      : 'Keep your opening hand?';

  const subline = bottoming
    ? `You mulliganed ${count} time${count === 1 ? '' : 's'}. Choose ${bottomCount} to bottom (${selected.length}/${bottomCount} selected).`
    : 'Tap cards to mulligan a partial hand, or mulligan everything for a fresh seven.';

  return (
    <div
      data-testid="mulligan-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Mulligan decision"
      className="absolute inset-0 z-40 flex animate-fade-in flex-col items-center justify-center gap-4 bg-neutral-950/92 px-4 py-6 backdrop-blur-sm"
    >
      <div className="text-center">
        <h2 className="font-serif text-lg font-bold tracking-tight text-amber-300">{heading}</h2>
        <p className="mx-auto mt-1 max-w-md text-xs font-medium text-stone-300">{subline}</p>
      </div>

      <div className="flex max-w-full flex-wrap items-end justify-center gap-2 overflow-y-auto">
        {hand.map((card) => {
          const isSel = selected.includes(card.id);
          return (
            <button
              key={card.id}
              type="button"
              data-testid="mulligan-card"
              data-card-id={card.id}
              aria-pressed={isSel}
              onClick={() => onToggle(card.id)}
              title={card.name}
              className={cn(
                'relative w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all sm:w-24',
                isSel
                  ? bottoming
                    ? '-translate-y-2 border-rose-400 ring-2 ring-rose-400/50'
                    : '-translate-y-2 border-amber-400 ring-2 ring-amber-400/50'
                  : 'border-stone-600/70 hover:border-amber-400/50',
              )}
            >
              <CardImage
                cardName={card.name}
                size="small"
                showHoverZoom={false}
                className="aspect-[5/7] w-full"
              />
              {isSel && (
                <span
                  className={cn(
                    'absolute right-1 top-1 rounded px-1 text-[9px] font-black uppercase text-neutral-950',
                    bottoming ? 'bg-rose-400' : 'bg-amber-400',
                  )}
                >
                  {bottoming ? 'Bottom' : 'Mull'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        {bottoming ? (
          <button
            type="button"
            data-testid="mulligan-keep"
            disabled={!keepReady}
            onClick={onKeep}
            className={cn(
              'min-h-11 rounded-lg px-5 py-2 text-sm font-bold transition-colors',
              keepReady
                ? 'bg-amber-400 text-neutral-950 hover:bg-amber-300'
                : 'cursor-not-allowed bg-stone-700 text-stone-500',
            )}
          >
            Bottom {bottomCount} &amp; keep
          </button>
        ) : (
          <>
            <button
              type="button"
              data-testid="mulligan-keep"
              onClick={onKeep}
              className="min-h-11 rounded-lg bg-amber-400 px-5 py-2 text-sm font-bold text-neutral-950 transition-colors hover:bg-amber-300"
            >
              Keep this hand
            </button>
            <button
              type="button"
              data-testid="mulligan-mull"
              onClick={() => onMulligan(selectedCardIds)}
              className="min-h-11 rounded-lg border border-stone-600 bg-stone-800 px-5 py-2 text-sm font-bold text-stone-100 transition-colors hover:bg-stone-700"
            >
              {selectedCardIds.length > 0 ? `Mulligan ${selectedCardIds.length}` : 'Mulligan'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default MulliganOverlay;
