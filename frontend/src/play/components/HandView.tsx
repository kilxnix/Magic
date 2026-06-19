import { useCallback, useRef, useState } from 'react';
import type { HandCardView, LegalAction } from '../gameView.types';
import { CardImage } from '../../components/CardImage';
import { ActionMenu } from './ActionMenu';
import { AnchoredMenu } from './AnchoredMenu';
import { useCardHoverPreview } from './CardHoverPreview';
import { FitToBox } from './FitToBox';
import { cn } from '../../lib/utils';

export interface HandViewProps {
  hand: HandCardView[];
  /** Commit: the player picked a legal action for a hand card. */
  onAction(card: HandCardView, action: LegalAction): void;
  /** Look (free + reversible): zoom / inspect a hand card without committing. */
  onExamine(card: HandCardView): void;
}

interface HandCardProps {
  card: HandCardView;
  isOpen: boolean;
  /** Toggle this card's action menu; passes the trigger button to anchor against. */
  onToggle(card: HandCardView, trigger: HTMLButtonElement): void;
  onExamine(card: HandCardView): void;
}

/**
 * One hand card. Extracted as a component so each can own its desktop hover-zoom
 * (useCardHoverPreview — a hook, so it can't live in the parent's .map loop). The
 * ACTION MENU state stays lifted to HandView (single open menu, single anchorRef)
 * so the menu behavior — and the overflow-clip fix that made it hittable — is
 * exactly preserved.
 */
function HandCard({ card, isOpen, onToggle, onExamine }: HandCardProps) {
  const hoverPreview = useCardHoverPreview(card.name);

  return (
    <div
      role="listitem"
      data-testid="hand-card"
      data-card-id={card.id}
      onPointerEnter={hoverPreview.bind.onPointerEnter}
      onPointerLeave={hoverPreview.bind.onPointerLeave}
      onPointerDownCapture={hoverPreview.bind.onPointerDown}
      className={cn(
        // Each card is its own positioning context so the inline ActionMenu can
        // anchor above it without leaving the flow.
        'group relative shrink-0 transition-transform duration-200 will-change-transform',
        // Desktop fan: rotate-less, lift + zoom on hover/open so the fanned
        // (overlapping) cards fan out and the active one comes forward.
        'lg:hover:z-20 lg:hover:-translate-y-4 lg:hover:scale-[1.06]',
        // On mobile the rail is height-capped, so an upward open-lift would clip
        // the top card; neutralize it on mobile, reinstate the lift on desktop.
        isOpen ? 'z-30 translate-y-0 scale-[1.04] lg:-translate-y-4' : 'z-0',
      )}
    >
      {hoverPreview.node}
      <div
        className={cn(
          'overflow-hidden rounded-lg border bg-stone-900 shadow-lg shadow-black/40 transition-all duration-200 lg:group-hover:shadow-[0_16px_34px_rgba(0,0,0,0.6)]',
          isOpen
            ? 'border-amber-400/80 ring-2 ring-amber-400/40'
            : 'border-stone-600/70 hover:border-amber-400/50',
          // Tap-target sizing: larger on mobile for thumbs, tighter fan on desktop.
          'w-24 sm:w-28 lg:w-24',
        )}
      >
        {/* Commit gesture: tap the card → toggle its action menu. The menu itself
            is portaled (AnchoredMenu) so it can't be clipped by the hand's
            horizontal-scroll container. */}
        <button
          type="button"
          onClick={(e) => onToggle(card, e.currentTarget)}
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
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-[10px] font-bold uppercase tracking-wide text-stone-400 transition-colors hover:text-amber-300 focus:outline-none focus-visible:text-amber-300 focus-visible:ring-2 focus-visible:ring-amber-400/70"
          >
            &#128269;
          </button>
        </div>
      </div>
    </div>
  );
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
  // The trigger button of the open card — the AnchoredMenu (portaled to body)
  // positions itself against this so no overflow ancestor can clip it.
  const anchorRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setOpenId(null), []);
  const openCard = openId ? hand.find((c) => c.id === openId) ?? null : null;

  // Toggle a card's menu, capturing its trigger button for the portaled menu to
  // anchor against (preserves the exact anchorRef + openId behavior the inline
  // version had — the menu-clipping fix depends on it).
  const handleToggle = useCallback(
    (card: HandCardView, trigger: HTMLButtonElement) => {
      if (openId === card.id) {
        setOpenId(null);
      } else {
        anchorRef.current = trigger;
        setOpenId(card.id);
      }
    },
    [openId],
  );

  if (hand.length === 0) {
    return (
      <div
        data-testid="hand-empty"
        className="flex h-24 flex-col items-center justify-center gap-1 text-center"
      >
        <span aria-hidden className="text-lg opacity-30">🂠</span>
        <span className="text-xs font-medium text-stone-400/70">
          Your hand is empty — draw to refill it.
        </span>
      </div>
    );
  }

  return (
    <>
    {/* The hand NEVER scrolls: FitToBox scales the whole fan DOWN to fit the rail
        width so every card is visible at once (overflow-y-visible keeps the desktop
        hover-lift showing above the rail). Tap a card to zoom + act. */}
    <FitToBox
      overflowClass="overflow-x-hidden overflow-y-visible"
      className="h-full w-full"
    >
      <div
        data-testid="hand-view"
        role="list"
        aria-label="Your hand"
        // items-end so the fan/lift grows upward off the bottom rail. No scroll
        // here — FitToBox sizes this natural-width fan to fit.
        className="flex w-max items-end gap-3 px-3 pb-2 pt-2 sm:gap-2 lg:-space-x-4 lg:gap-0 lg:px-6 lg:pt-12"
      >
        {hand.map((card) => (
          <HandCard
            key={card.id}
            card={card}
            isOpen={openId === card.id}
            onToggle={handleToggle}
            onExamine={onExamine}
          />
        ))}
      </div>
    </FitToBox>

    {openCard && (
      <AnchoredMenu anchorRef={anchorRef} open onClose={close} placement="top">
        <ActionMenu
          actions={openCard.legalActions}
          guided={false}
          onPick={(action) => {
            onAction(openCard, action);
            setOpenId(null);
          }}
        />
      </AnchoredMenu>
    )}
    </>
  );
}

export default HandView;
