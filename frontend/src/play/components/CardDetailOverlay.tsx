import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CardImage } from '../../components/CardImage';

export interface CardDetailOverlayProps {
  /** Card to show at full size; null → render nothing. */
  cardName: string | null;
  onClose(): void;
}

// ============================================================================
// CardDetailOverlay — the look-only "examine" zoom.
//
// A large, fully-readable card image centered over a dimmed, blurred backdrop —
// the premium card-zoom every good card game has. PORTALED to document.body so
// it escapes the battlefield / hand `overflow:hidden` clipping (the same reason
// AnchoredMenu portals; a board-anchored absolute element would be cut off).
//
// PURE / PRESENTATIONAL + free + reversible: it never commits an engine action.
// This is the destination of every `onExamine` (the long-press / right-click /
// "i" look gesture on tiles and hand cards). Dismiss via backdrop click, the
// close button, or Escape.
// ============================================================================
export function CardDetailOverlay({ cardName, onClose }: CardDetailOverlayProps) {
  // Escape closes — only while open (cardName set).
  useEffect(() => {
    if (!cardName) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cardName, onClose]);

  if (!cardName) return null;

  return createPortal(
    <div
      data-testid="card-detail-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${cardName} — card detail`}
      onClick={onClose}
      className="fixed inset-0 z-[200] flex animate-fade-in items-center justify-center bg-black/75 p-6 backdrop-blur-sm"
    >
      {/* The card itself — stop propagation so clicking it doesn't dismiss. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-[min(86vw,360px)] animate-tile-in"
      >
        <CardImage
          cardName={cardName}
          size="normal"
          showHoverZoom={false}
          className="aspect-[5/7] w-full overflow-hidden rounded-xl shadow-[0_24px_60px_rgba(0,0,0,0.8)] ring-1 ring-amber-300/30"
        />
        <button
          type="button"
          data-testid="card-detail-close"
          onClick={onClose}
          aria-label="Close"
          className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full border border-stone-500 bg-stone-900 text-base font-black text-stone-200 shadow-lg transition hover:bg-stone-700 hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 md:h-9 md:w-9"
        >
          ✕
        </button>
        <div className="mt-2 text-center font-serif text-sm font-bold text-stone-100 drop-shadow">
          {cardName}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default CardDetailOverlay;
