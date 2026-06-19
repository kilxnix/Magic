import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface FitToBoxProps {
  children: ReactNode;
  className?: string;
}

// ============================================================================
// FitToBox — "see the whole battlefield at once" primitive.
//
// Scales its children DOWN (never up past 1:1) so they fit ENTIRELY within this
// box on both axes, with NO scrolling and no clipping. A crowded board shrinks
// to fit instead of scrolling; a sparse board sits at 1:1, centered. This is the
// Hearthstone/Arena model — the deliberate trade is smaller tiles, mitigated by
// the existing tap-to-examine and desktop hover-to-enlarge card zoom.
//
// A ResizeObserver re-fits whenever the box OR the content changes size (a
// permanent enters/leaves, the viewport rotates, a rail resizes). The content is
// absolutely positioned + centered so its natural (unscaled) layout never drives
// the box height; only the visual transform changes. getBoundingClientRect on the
// scaled descendants reflects the transform, so AnchoredMenu / CardHoverPreview
// still anchor correctly to a scaled tile (the portaled menu itself is unscaled).
// ============================================================================
export function FitToBox({ children, className = '' }: FitToBoxProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const fit = () => {
      const bw = box.clientWidth;
      const bh = box.clientHeight;
      const cw = content.scrollWidth;
      const ch = content.scrollHeight;
      if (!bw || !bh || !cw || !ch) return;
      // Never scale up past 1:1; shrink to fit the tighter axis.
      const next = Math.min(1, bw / cw, bh / ch);
      setScale((prev) => (Math.abs(prev - next) > 0.005 ? next : prev));
    };
    fit();
    // jsdom (tests) has no ResizeObserver and no layout; fit() is a safe no-op
    // there (zero sizes), and we skip the observer rather than crash.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className={`relative overflow-hidden ${className}`}>
      <div
        ref={contentRef}
        className="absolute left-1/2 top-1/2"
        style={{ transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center' }}
      >
        {children}
      </div>
    </div>
  );
}

export default FitToBox;
