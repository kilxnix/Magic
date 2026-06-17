import type { PriorityContext } from '../gameView.types';

// ============================================================================
// PriorityStrip — "whose call is it, and what can you do?" at a glance.
//
// PURE / PRESENTATIONAL: props in, callbacks out. No engine/hook access, no game
// logic. The view-model (`useGameView`) has already derived the PriorityContext
// (phaseLabel / hasMeaningfulResponse / canPass / canHold); this component only
// renders it and reports button clicks.
//
// Spec (interaction grammar → "Priority strip"): always shows whose priority it
// is and your options. Real responses are offered clearly (pass + hold-priority);
// with nothing useful you auto-pass, with an "always stop" toggle for control
// players. Never click-spam, never skipped past a real decision. The no-dead-ends
// invariant: whenever the human has priority, `canPass` is true, so the strip
// always offers at least a way forward.
//
// LAYOUT / BUG-CLASS GUARD: this is a normal-flow horizontal strip (a <section>),
// NEVER a position:fixed bar and NEVER an absolutely-positioned overlay. The
// layout shells dock it in flow (desktop: left rail header / mobile: actions
// dock) so it can never sit over the board's interactive layer.
//
// Note on CardImage: the PriorityContext carries no card name (it's phase/priority
// state, not an object), so no card art is shown here. If a future priority shape
// references a specific card, import { CardImage } from '../../components/CardImage'
// and render <CardImage cardName={...}/> inline.
// ============================================================================

export interface PriorityStripProps {
  priority: PriorityContext;
  /** Control-player setting: stop at every priority window instead of auto-passing. */
  alwaysStop: boolean;
  onPass(): void;
  onHold(): void;
  onToggleAlwaysStop(): void;
}

/**
 * Horizontal priority strip: phase label, a "respond" chip when there's a real
 * decision, and pass / hold-priority controls. A hint line explains the auto-pass
 * behavior and carries the "always stop" toggle.
 */
export function PriorityStrip({
  priority,
  alwaysStop,
  onPass,
  onHold,
  onToggleAlwaysStop,
}: PriorityStripProps) {
  const { hasPriority, isYourTurn, phaseLabel, hasMeaningfulResponse, canPass, canHold } = priority;

  return (
    // Normal-flow strip — never fixed/absolute. The shell sizes it via className.
    <section
      data-testid="priority-strip"
      aria-label="Priority"
      className="flex w-full min-w-0 flex-col gap-2 rounded-xl border border-amber-900/25 bg-gradient-to-b from-stone-900/75 to-neutral-950/75 px-3 py-2.5 text-stone-200 shadow-lg shadow-black/30"
    >
      {/* Whose turn + phase + whose priority — on its own full-width block so it
          never gets squeezed to "M..." by the controls beside it. The turn badge
          fixes the old confusion where the opponent's turn read as yours. */}
      <div className="min-w-0">
        <div
          data-testid="turn-owner"
          className={`mb-0.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${
            isYourTurn ? 'bg-emerald-500/20 text-emerald-200' : 'bg-rose-500/20 text-rose-200'
          }`}
        >
          {isYourTurn ? 'Your turn' : "Opponent's turn"}
        </div>
        <div className="text-sm font-black leading-tight text-stone-100">
          {phaseLabel}
        </div>
        <div
          data-testid="priority-holder"
          className={`text-[10px] font-bold uppercase tracking-wider ${
            hasPriority ? 'text-amber-300' : 'text-stone-500'
          }`}
        >
          {hasPriority ? 'Your priority' : 'Waiting…'}
        </div>
      </div>

      {/* Controls row: respond chip + pass / hold. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* "respond" chip — surfaces that a real decision is available. */}
        {hasMeaningfulResponse && (
          <span
            data-testid="respond-chip"
            className="shrink-0 rounded-full border border-amber-500/45 bg-amber-950/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-100"
          >
            Respond
          </span>
        )}

        {/* Controls — only the legal ones render (engine is source of truth). */}
        {(canPass || canHold) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {canHold && (
              <button
                type="button"
                onClick={onHold}
                data-testid="priority-hold"
                className="rounded-md border border-stone-600 bg-stone-800 px-3 py-1 text-xs font-bold text-stone-100 transition-colors hover:border-amber-400/60 hover:bg-stone-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                Hold
              </button>
            )}
            {canPass && (
              <button
                type="button"
                onClick={onPass}
                data-testid="priority-pass"
                className="rounded-md border border-amber-500/40 bg-amber-950/40 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-100 transition-colors hover:border-amber-400/70 hover:bg-amber-900/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
              >
                Pass
              </button>
            )}
          </div>
        )}
      </div>

      {/* Hint line: auto-pass explainer + the always-stop toggle. */}
      <label
        data-testid="always-stop-toggle"
        className="flex cursor-pointer items-center justify-between gap-2 text-[10px] leading-snug text-stone-400"
      >
        <span className="min-w-0 flex-1 truncate">
          Nothing playable → auto-passes
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          <input
            type="checkbox"
            checked={alwaysStop}
            onChange={onToggleAlwaysStop}
            data-testid="always-stop-checkbox"
            className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-amber-500"
          />
          <span className="font-bold uppercase tracking-wider text-stone-300">
            Always stop
          </span>
        </span>
      </label>
    </section>
  );
}

export default PriorityStrip;
