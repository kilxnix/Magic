import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

export interface AnchoredMenuProps {
  /** The element the menu anchors to (the tapped card / tile trigger). */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose(): void;
  /** Preferred side. Flips to the other side automatically when there's no room. */
  placement?: 'top' | 'bottom';
  children: ReactNode;
}

// Fallback width before the menu has measured (Tailwind min-w-44 = 11rem).
const FALLBACK_WIDTH = 176;
const GAP = 8;
const EDGE = 8;

/**
 * AnchoredMenu — renders its children in a fixed-position portal at document.body,
 * anchored to `anchorRef`.
 *
 * WHY A PORTAL: the play surface nests the hand and battlefield inside
 * `overflow:hidden`/`overflow:auto` containers (the hand strip scrolls
 * horizontally, which forces vertical clipping via CSS's mixed-overflow rule).
 * An inline `absolute` menu that popped out of those boxes was visually clipped
 * AND non-hittable — pointer events at the menu's coordinates landed on the
 * battlefield behind it, so picking an action silently did nothing. Portaling to
 * the body escapes every clipping ancestor, so the menu is always visible and
 * clickable. It closes on outside-click, scroll, resize, and Escape.
 */
export function AnchoredMenu({
  anchorRef,
  open,
  onClose,
  placement = 'top',
  children,
}: AnchoredMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const a = anchor.getBoundingClientRect();
    const menu = menuRef.current;
    const mw = menu?.offsetWidth || FALLBACK_WIDTH;
    const mh = menu?.offsetHeight || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Horizontal: center on the anchor, clamped to the viewport.
    let left = a.left + a.width / 2 - mw / 2;
    left = Math.max(EDGE, Math.min(left, vw - mw - EDGE));

    // Vertical: honor `placement`, but flip when the preferred side lacks room.
    const fitsTop = a.top >= mh + GAP;
    const fitsBottom = vh - a.bottom >= mh + GAP;
    const useTop = placement === 'top' ? fitsTop || !fitsBottom : !(fitsBottom || !fitsTop);
    let top = useTop ? a.top - mh - GAP : a.bottom + GAP;
    top = Math.max(EDGE, Math.min(top, vh - mh - EDGE));

    setPos({ left, top });
  }, [anchorRef, placement]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    // First pass positions with the fallback size; the rAF pass corrects once the
    // menu has measured its real height/width.
    place();
    const raf = requestAnimationFrame(place);

    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDocPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return; // let the trigger toggle itself
      onClose();
    };

    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDocPointerDown, true);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
    };
  }, [open, place, onClose, anchorRef]);

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      data-testid="anchored-menu"
      style={{
        position: 'fixed',
        left: pos ? `${pos.left}px` : '-9999px',
        top: pos ? `${pos.top}px` : '-9999px',
        zIndex: 1000,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export default AnchoredMenu;
