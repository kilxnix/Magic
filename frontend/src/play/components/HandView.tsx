import { useState } from 'react';
import type { HandCardView, LegalAction } from '../gameView.types';
import { CardImage } from '../../components/CardImage';
import { ActionMenu } from './ActionMenu';
import { cn } from '../../lib/utils';

export interface HandViewProps {
  hand: HandCardView[];
  /** Commit: the player picked a legal action for a hand card. */
  onAction(card: HandCardView, action: LegalAction): void;
  /** Look (free + reversible): zoom / inspect a hand card without committing. */
  onExamine(card: HandCardView): void;
}

/**
 * HandView — your hand row.
 *
 * PURE / PRESENTATIONAL: props in (`hand`), callbacks out (`onAction`,
 * `onExamine`). No engine/hook access, no legality logic — each card already
 * carries its `legalActions` from the view-model.
 *
 * Layout: a single horizontally-scrollable row of cards. On desktop the cards
 * overlap into a light fan (negative margin) and lift on hover; on mobile the
 * row is a thumb-friendly scroll strip (swipe sideways) with the cards spaced
 * out and larger tap targets. No gesture libraries — pure CSS/Tailwind.
 *
 * Interaction (one-gesture grammar): tap a card → its ActionMenu opens *inline*,
 * anchored directly above that card. The menu is a normal in-flow element (NOT
 * position:fixed) so it never floats over the board's interactive layer — it
 * pushes up from the hand rail itself. Tapping the same card again, or picking
 * an action, closes it. A small "examine" affordance per card is the free/
 * reversible "look" path and never opens the commit menu.
 */
export function HandView({ hand, onAction, onExamine }: HandViewProps) {
  // Which card's ActionMenu is currently open (by hand-card id), or null.
  const [openId, setOpenId] = useState<string | null>(null);

  if (hand.length === 0) {
    return (
      <div
        data-testid="hand-empty"
        className="flex h-24 items-center justify-center text-xs font-semibold uppercase tracking-wide text-stone-500"
      >
        Hand empty
      </div>
    );
  }

  return (
    <div
      data-testid="hand-view"
      role="list"
      aria-label="Your hand"
      // Horizontal scroll strip. overflow-x-auto = swipe-sideways on mobile;
      // items-end so the fan/lift grows upward off the bottom rail.
      className="flex w-full items-end gap-3 overflow-x-auto overflow-y-visible px-3 pb-2 pt-12 sm:gap-2 lg:-space-x-4 lg:gap-0 lg:px-6"
    >
      {hand.map((card) => {
        const isOpen = openId === card.id;

        return (
          <div
            key={card.id}
            role="listitem"
            data-testid="hand-card"
            data-card-id={card.id}
            className={cn(
              // Each card is its own positioning context so the inline
              // ActionMenu can anchor above it without leaving the flow.
              'relative shrink-0 transition-transform duration-150',
              // Desktop fan: rotate-less, lift on hover/open so the fanned
              // (overlapping) cards fan out and the active one comes forward.
              'lg:hover:z-20 lg:hover:-translate-y-4',
              isOpen ? 'z-30 -translate-y-4' : 'z-0',
            )}
          >
            {/* Inline ActionMenu — pushes UP from the card, in-flow (absolute
                within this card's box, anchored to its top). Never fixed. */}
            {isOpen && (
              <div
                data-testid="hand-action-menu"
                className="absolute bottom-full left-1/2 z-40 mb-2 -translate-x-1/2"
              >
                <ActionMenu
                  actions={card.legalActions}
                  guided={false}
                  onPick={(action) => {
                    onAction(card, action);
                    setOpenId(null);
                  }}
                />
              </div>
            )}

            <div
              className={cn(
                'overflow-hidden rounded-lg border bg-stone-900 shadow-lg shadow-black/40 transition-colors',
                isOpen
                  ? 'border-amber-400/80 ring-2 ring-amber-400/40'
                  : 'border-stone-600/70 hover:border-amber-400/50',
                // Tap-target sizing: larger on mobile for thumbs, tighter fan
                // on desktop.
                'w-24 sm:w-28 lg:w-24',
              )}
            >
              {/* Commit gesture: tap the card → toggle its action menu. */}
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : card.id)}
                aria-haspopup="menu"
                aria-expanded={isOpen}
                aria-label={`Actions for ${card.name}`}
                className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
              >
                <CardImage
                  cardName={card.name}
                  size="small"
                  showHoverZoom={false}
                  className="aspect-[5/7] w-full"
                />
              </button>

              {/* Footer: mana cost + free "examine" (look, not commit). */}
              <div className="flex items-center justify-between gap-1 border-t border-stone-700/70 bg-neutral-950/80 px-1.5 py-1">
                <span
                  data-testid="hand-card-mana"
                  className="truncate text-[10px] font-bold tabular-nums text-amber-200/90"
                >
                  {card.manaCost || '—'}
                </span>
                <button
                  type="button"
                  onClick={() => onExamine(card)}
                  aria-label={`Examine ${card.name}`}
                  title="Examine"
                  className="shrink-0 rounded px-1 text-[10px] font-bold uppercase tracking-wide text-stone-400 transition-colors hover:text-amber-300 focus:outline-none focus-visible:text-amber-300"
                >
                  &#128269;
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default HandView;
