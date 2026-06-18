import { useEffect, useRef, useState } from 'react';
import type { LegalAction, PermanentView } from '../gameView.types';
import { CardImage } from '../../components/CardImage';
import { ActionMenu } from './ActionMenu';
import { AnchoredMenu } from './AnchoredMenu';
import { useCardHoverPreview } from './CardHoverPreview';
import { cn } from '../../lib/utils';

export interface PermanentTileProps {
  permanent: PermanentView;
  /** Committing a legal action (deliberate). */
  onAction(action: LegalAction): void;
  /** Look-only: examining never commits an action (free + reversible). */
  onExamine(): void;
}

const HIDDEN_COUNTER_KEYS = new Set(['_powerMod', '_toughnessMod']);

/** Visible counter badges (mirrors the old GameBoard's getCounterBadges). */
function counterBadges(counters?: Record<string, number>): { label: string; count: number }[] {
  if (!counters) return [];
  return Object.entries(counters)
    .filter(([key, v]) => v > 0 && !HIDDEN_COUNTER_KEYS.has(key))
    .map(([label, count]) => ({ label, count }));
}

const LONG_PRESS_MS = 450;

/**
 * PermanentTile — one battlefield permanent.
 *
 * PURE / PRESENTATIONAL: props in, callbacks out. No engine/hook access, no
 * legality logic — `permanent.legalActions` is already the exact set the engine
 * says is legal right now (the interaction-grammar invariant).
 *
 * Behavior:
 *  - Art fills the tile via <CardImage name=...> (art resolves by NAME).
 *  - Power/toughness shown when `isCreature`; counters as badges; tapped tiles
 *    rotate + dim; attacking/blocking add a colored accent ring.
 *  - COMMIT: tapping the tile opens an inline ActionMenu of its legal actions;
 *    picking one calls `onAction`.
 *  - LOOK: a dedicated examine affordance (the info button, right-click, or a
 *    long-press) calls `onExamine` and NEVER emits an action.
 *
 * Not a fixed overlay: the action menu renders inline directly beneath the tile
 * (absolute, but anchored to this in-flow tile — it never floats over the board's
 * interactive layer the way the old docks did).
 */
export function PermanentTile({ permanent, onAction, onExamine }: PermanentTileProps) {
  const {
    name,
    tapped,
    power,
    toughness,
    isCreature,
    isAttacking,
    isBlocking,
    legalActions,
  } = permanent;

  const [menuOpen, setMenuOpen] = useState(false);
  const hoverPreview = useCardHoverPreview(name);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // When a long-press fires, suppress the click that follows so it can't open
  // the action menu — long-press is a LOOK gesture, not a commit.
  const suppressNextClick = useRef(false);

  const badges = counterBadges(permanent.counters);

  // Outside-click / scroll / Escape dismissal is handled by AnchoredMenu (the
  // menu is portaled to the body, so a containerRef-based check would wrongly
  // treat clicks on the menu as "outside" and close it before onPick fires).

  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
    };
  }, []);

  const examine = () => {
    setMenuOpen(false);
    onExamine();
  };

  const startLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      suppressNextClick.current = true;
      examine();
    }, LONG_PRESS_MS);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTileClick = () => {
    // A long-press just fired examine — swallow the trailing click (no commit).
    if (suppressNextClick.current) {
      suppressNextClick.current = false;
      return;
    }
    setMenuOpen((open) => !open);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    // Right-click is a LOOK gesture — examine, never a commit, never the menu.
    event.preventDefault();
    examine();
  };

  // Accent ring: attacking (rose) takes precedence, then blocking (sky).
  const accentClass = isAttacking
    ? 'ring-2 ring-rose-400/70 shadow-lg shadow-rose-950/40'
    : isBlocking
      ? 'ring-2 ring-sky-400/70 shadow-lg shadow-sky-950/40'
      : 'ring-1 ring-stone-700/60';

  return (
    <div
      ref={containerRef}
      data-testid="permanent-tile"
      data-permanent-id={permanent.id}
      onPointerEnter={hoverPreview.bind.onPointerEnter}
      onPointerLeave={hoverPreview.bind.onPointerLeave}
      onPointerDownCapture={hoverPreview.bind.onPointerDown}
      className="group relative inline-block h-24 w-[4.5rem] shrink-0 select-none align-top animate-tile-in md:h-28 md:w-20"
    >
      {hoverPreview.node}
      <button
        type="button"
        onClick={handleTileClick}
        onContextMenu={handleContextMenu}
        onPointerDown={startLongPress}
        onPointerUp={cancelLongPress}
        onPointerLeave={cancelLongPress}
        onPointerCancel={cancelLongPress}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`${name}${tapped ? ' (tapped)' : ''} — show actions`}
        title={name}
        className={cn(
          'absolute inset-0 flex h-full w-full flex-col justify-end overflow-hidden rounded-lg border text-left transition-all duration-200 ease-out will-change-transform',
          'border-stone-600 bg-stone-800 hover:-translate-y-1 hover:bg-stone-700 hover:shadow-[0_12px_28px_rgba(0,0,0,0.6),0_0_0_2px_rgba(251,191,36,0.4)] active:scale-[0.97] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70',
          accentClass,
          tapped && 'rotate-6 opacity-70 saturate-50',
        )}
      >
        {/* Card art fills the tile (resolved by NAME). */}
        <CardImage
          cardName={name}
          size="normal"
          showHoverZoom={false}
          className="pointer-events-none absolute inset-0 h-full w-full [&_img]:rounded-none [&_img]:object-cover"
        />

        {/* Bottom legibility gradient behind the state badges. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/90 via-black/45 to-transparent" />

        {/* Always-legible name strip (top). */}
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 via-black/40 to-transparent px-1 pb-2 pt-0.5">
          <div className="line-clamp-1 break-words text-[8px] font-semibold leading-tight text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)] md:text-[10px]">
            {name}
          </div>
        </div>

        {/* Counter badges (bottom-left). */}
        {badges.length > 0 && (
          <div className="pointer-events-none absolute inset-x-1 bottom-5 flex flex-wrap gap-0.5">
            {badges.map(({ label, count }) => (
              <span
                key={label}
                data-testid={`counter-${label}`}
                className="rounded bg-emerald-900/90 px-1 text-[8px] font-bold leading-tight text-emerald-100 ring-1 ring-emerald-400/40"
              >
                {count} {label}
              </span>
            ))}
          </div>
        )}

        {/* Power/toughness (creatures only), bottom-right. */}
        {isCreature && (power !== undefined || toughness !== undefined) && (
          <span
            data-testid="power-toughness"
            className="pointer-events-none absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px] font-black tabular-nums leading-tight text-white ring-1 ring-white/20"
          >
            {power ?? '—'}/{toughness ?? '—'}
          </span>
        )}
      </button>

      {/* Stack count — when identical copies (e.g. lands) are collapsed into one tile. */}
      {(permanent.stackCount ?? 0) > 1 && (
        <span
          data-testid="stack-count"
          className="pointer-events-none absolute left-0.5 top-0.5 z-10 rounded bg-neutral-950/85 px-1 text-[10px] font-black tabular-nums text-amber-200 ring-1 ring-amber-400/40"
        >
          ×{permanent.stackCount}
        </span>
      )}

      {/* Examine affordance — a LOOK control. Calls onExamine, never onAction.
          Sits above the tile button so the tap-to-act gesture stays clean. */}
      <button
        type="button"
        data-testid="examine-button"
        aria-label={`Examine ${name}`}
        title={`Examine ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          examine();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className="absolute right-0.5 top-0.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-xs font-black leading-none text-stone-200 opacity-80 ring-1 ring-white/25 transition hover:bg-black/90 hover:text-amber-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80"
      >
        i
      </button>

      {/* Action menu — portaled (AnchoredMenu) so it escapes the battlefield's
          overflow:hidden clipping and stays click-hittable. Picking an action
          commits it (onAction) and closes the menu. */}
      <AnchoredMenu
        anchorRef={containerRef}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        placement="bottom"
      >
        <ActionMenu
          actions={legalActions}
          guided={false}
          onPick={(action) => {
            setMenuOpen(false);
            onAction(action);
          }}
        />
      </AnchoredMenu>
    </div>
  );
}

export default PermanentTile;
