import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CardImage } from '../../components/CardImage';

// ============================================================================
// useCardHoverPreview — desktop "hover to enlarge" card zoom.
//
// On a real pointing device (mouse), hovering a card for a beat pops a large,
// fully-readable floating card image near the hovered element — the premium
// peek every good card game has (MTG Arena / Hearthstone). It is:
//  • PORTALED to document.body, so it escapes the battlefield / hand
//    `overflow:hidden` clipping (the same reason AnchoredMenu / CardDetailOverlay
//    portal). A board-anchored absolute preview would be cut off.
//  • Non-modal + pointer-events:none — purely a look; it never blocks the board
//    and never commits an action.
//  • Desktop-mouse only — gated on `pointerType === 'mouse'` AND `lg:block`, so
//    touch devices keep using the deliberate tap-examine zoom (CardDetailOverlay)
//    and the preview never fights a finger.
//
// Usage: spread the returned handlers on the card's root element and render
// `node` somewhere in that component (it portals, so placement is irrelevant):
//   const preview = useCardHoverPreview(name);
//   <div {...preview.bind}>…{preview.node}</div>
// ============================================================================

const PREVIEW_W = 240;
const OPEN_DELAY_MS = 350;

export function useCardHoverPreview(cardName: string) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  // Clean up a pending open timer on unmount.
  useEffect(() => clearTimer, []);

  // While the preview is up, any scroll/resize moves the anchor out from under
  // the fixed-position preview — just close it (the user can re-hover).
  useEffect(() => {
    if (!rect) return;
    const close = () => setRect(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [rect]);

  const onPointerEnter = (e: ReactPointerEvent) => {
    // Hover-to-zoom is a mouse affordance; touch uses deliberate tap-examine.
    if (e.pointerType !== 'mouse') return;
    const el = e.currentTarget as HTMLElement;
    clearTimer();
    timer.current = setTimeout(() => setRect(el.getBoundingClientRect()), OPEN_DELAY_MS);
  };
  const dismiss = () => {
    clearTimer();
    setRect(null);
  };

  let node: ReactNode = null;
  if (rect) {
    const previewH = (PREVIEW_W * 7) / 5;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = rect.left + rect.width / 2 - PREVIEW_W / 2;
    left = Math.max(8, Math.min(left, vw - PREVIEW_W - 8));
    // Prefer above the card; flip below if there's no room.
    let top = rect.top - previewH - 10;
    if (top < 8) top = Math.min(rect.bottom + 10, vh - previewH - 8);

    node = createPortal(
      <div
        data-testid="card-hover-preview"
        aria-hidden="true"
        style={{ position: 'fixed', left, top, width: PREVIEW_W, zIndex: 190, pointerEvents: 'none' }}
        className="hidden animate-fade-in lg:block"
      >
        <CardImage
          cardName={cardName}
          size="normal"
          showHoverZoom={false}
          className="aspect-[5/7] w-full overflow-hidden rounded-xl shadow-[0_18px_45px_rgba(0,0,0,0.75)] ring-1 ring-amber-300/25"
        />
      </div>,
      document.body,
    );
  }

  return {
    /** Spread on the card's root element. */
    bind: {
      onPointerEnter,
      onPointerLeave: dismiss,
      // Any press (opening the action menu, long-press examine) dismisses the peek.
      onPointerDown: dismiss,
    },
    /** Render this in the component (it portals to body). */
    node,
  };
}
