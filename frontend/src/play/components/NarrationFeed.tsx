import { useEffect, useRef } from 'react';
import type { NarrationEntry, NarrationKind } from '../gameView.types';

// ============================================================================
// NarrationFeed — the calm, self-explaining game log.
//
// PURE / PRESENTATIONAL: props in, no callbacks, no engine/hook access, no game
// logic. It renders the plain-language narration the view-model already derived
// (triggers / resolutions / phase changes / plays) so users learn by playing.
//
// REGRESSION GUARD (the bug class this redesign kills): the feed must NEVER
// overlay the interactive board. So the root is a *bounded scrollable container
// in normal flow* — `relative` + `overflow-y-auto` + a max-height — with NO
// position:fixed and NO absolutely-positioned full-screen overlay. The desktop
// layout shell drops this into a persistent right rail; the mobile shell wraps
// it in a bounded pull-up (<details>) that also lives in flow and never sits
// over the board's interactive layer.
//
// Note on CardImage: narration entries are plain text (NarrationEntry has no
// card name in the contract), so no card art is shown here. If a future entry
// shape carries a card name, import { CardImage } from
// '../../components/CardImage' and render <CardImage cardName={...}/> inline.
// ============================================================================

export interface NarrationFeedProps {
  entries: NarrationEntry[];
  /** Optional extra classes for the layout shell to size the rail / pull-up. */
  className?: string;
}

// Icon + tone per narration kind. Glyphs are plain text (no icon dep) so the
// feed stays legible on both form factors and trivially testable.
const KIND_META: Record<NarrationKind, { icon: string; tone: string; label: string }> = {
  trigger: { icon: '✴', tone: 'text-violet-300', label: 'Trigger' }, // ✴ sparkle
  resolve: { icon: '✓', tone: 'text-emerald-300', label: 'Resolves' }, // ✓ check
  phase: { icon: '◆', tone: 'text-amber-300', label: 'Phase' }, // ◆ diamond
  action: { icon: '•', tone: 'text-stone-300', label: 'Action' }, // • bullet
};

function NarrationLine({ entry }: { entry: NarrationEntry }) {
  const meta = KIND_META[entry.kind] ?? KIND_META.action;
  return (
    <li
      data-kind={entry.kind}
      className="flex animate-fade-in items-start gap-2 px-3 py-1.5 text-[11px] leading-snug md:text-xs"
    >
      <span
        aria-hidden="true"
        title={meta.label}
        className={`mt-px shrink-0 font-black ${meta.tone}`}
      >
        {meta.icon}
      </span>
      <span className="min-w-0 flex-1 break-words text-stone-200">{entry.text}</span>
    </li>
  );
}

/**
 * The scrollable log body. Newest entry is last; the container scrolls so the
 * latest is reachable. This is the part both form factors share.
 */
function NarrationLog({ entries }: { entries: NarrationEntry[] }) {
  // Auto-follow the tail so the newest line always animates into view (otherwise
  // entries fade in below the fold and are missed). block:'nearest' keeps it gentle.
  const endRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    // Optional-chain the method too: jsdom (tests) has no scrollIntoView.
    if (entries.length > 0) endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [entries.length]);

  return (
    // NO scroll: a bottom-anchored window onto the log. The newest entries pin to
    // the bottom (always visible); older ones clip off the top as the log grows.
    // Full history lives in the after-game review. Not fixed/absolute — never covers
    // the board.
    <div
      data-testid="narration-log"
      role="log"
      aria-live="polite"
      aria-label="Game narration"
      className="relative flex max-h-[40svh] flex-col justify-end overflow-hidden md:max-h-full"
    >
      {entries.length === 0 ? (
        <p className="px-3 py-4 text-[11px] italic text-stone-400 md:text-xs">
          The log will narrate triggers, the stack, and phases as the game plays.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-stone-800/60">
          {entries.map((entry) => (
            <NarrationLine key={entry.id} entry={entry} />
          ))}
          {/* Tail sentinel the log scrolls to so the newest line is always visible. */}
          <li ref={endRef} aria-hidden="true" className="h-0" />
        </ul>
      )}
    </div>
  );
}

export function NarrationFeed({ entries, className = '' }: NarrationFeedProps) {
  return (
    // Root is a normal-flow flex column the shell sizes (desktop right rail /
    // mobile pull-up slot). No fixed/absolute positioning here.
    <section
      data-testid="narration-feed"
      aria-label="Narration feed"
      className={`flex min-h-0 flex-col rounded-xl border border-amber-900/25 bg-gradient-to-b from-stone-900/75 to-neutral-950/75 text-stone-200 shadow-lg shadow-black/30 ${className}`}
    >
      {/* Desktop (>=md): persistent labeled side-rail header, always-open log. */}
      <div className="hidden min-h-0 flex-1 flex-col md:flex">
        <h2 className="shrink-0 border-b border-stone-700/60 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-amber-200/90">
          Narration
        </h2>
        <div className="min-h-0 flex-1">
          <NarrationLog entries={entries} />
        </div>
      </div>

      {/* Mobile (<md): a bounded pull-up. <details> is in normal flow and only
          grows the feed's own box — it can never become a full-screen overlay
          on the board. COLLAPSED by default: open it would (with the hand pull-up)
          crowd the battlefield to 0px. The summary bar shows the entry count and
          taps open to read the log. Desktop uses the always-open rail above. */}
      <details
        data-testid="narration-pullup"
        className="flex min-h-0 flex-col md:hidden"
      >
        <summary className="flex shrink-0 cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-amber-200/90 [&::-webkit-details-marker]:hidden">
          {/* Ticker: show the newest event inline so phone players see "what just
              happened" without opening the log (truncated so it never grows the bar). */}
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0">Narration</span>
            {entries.length > 0 && (
              <span
                aria-hidden="true"
                className="min-w-0 flex-1 truncate text-[10px] font-normal normal-case tracking-normal text-stone-300"
              >
                {entries[entries.length - 1].text}
              </span>
            )}
          </span>
          <span aria-hidden="true" className="ml-2 shrink-0 text-stone-400">
            {entries.length > 0 ? `${entries.length}` : ''}
          </span>
        </summary>
        <NarrationLog entries={entries} />
      </details>
    </section>
  );
}

export default NarrationFeed;
