import type { TargetingContext } from '../gameView.types';

export interface TargetingLayerProps {
  targeting: TargetingContext;
  /** Toggle a legal target id in/out of the current selection. */
  onToggleTarget(id: string): void;
  /** Commit the chosen targets. Only meaningful when the count is in range. */
  onConfirm(): void;
  /** Abandon targeting without committing. */
  onCancel(): void;
}

/**
 * Returns whether the current selection satisfies the prompt's target count,
 * i.e. `minTargets <= selected <= maxTargets`. Exported so the enable rule is
 * unit-testable in isolation from the DOM (matches the repo's pure-helper test
 * convention) and so callers can reuse the exact gate the UI applies.
 */
export function canConfirmTargets(targeting: Pick<
  TargetingContext,
  'minTargets' | 'maxTargets' | 'selectedTargetIds'
>): boolean {
  const count = targeting.selectedTargetIds.length;
  return count >= targeting.minTargets && count <= targeting.maxTargets;
}

/**
 * Targeting overlay (spec: "legal targets highlight, illegal dim, pick the
 * required count, confirm/cancel — one flow for spells, abilities and combat").
 *
 * Pure / presentational: it renders exactly the `TargetingContext` the
 * view-model hands it and dispatches selection + confirm/cancel back out as
 * callbacks. NO engine/hook/game-logic access — legality (which ids are even
 * here) was decided upstream; this component only enforces the count gate on
 * the Confirm button.
 *
 * Layout note (this is the bug class the redesign fixes): this is a normal
 * in-flow panel — NO position:fixed. It is meant to mount in a side rail /
 * bottom sheet next to the board, never floating over the board's interactive
 * layer where it could swallow taps.
 *
 * Naming note: `TargetingContext.legalTargets` carries each target's human label
 * (e.g. "Llanowar Elves"), resolved upstream by the hook's targetPickerLabel — so
 * the chips show readable names, not raw engine instance ids. Card ART is still
 * not rendered here: a label is not guaranteed to be a unique printable card name
 * (it can read "Goblin (opponent)" / a player name), and fabricating art from an
 * ambiguous label would be against the project's honesty bar.
 */
export function TargetingLayer({
  targeting,
  onToggleTarget,
  onConfirm,
  onCancel,
}: TargetingLayerProps) {
  if (!targeting.active) {
    return null;
  }

  const { prompt, minTargets, maxTargets, legalTargetIds, legalTargets, selectedTargetIds } = targeting;
  const selectedCount = selectedTargetIds.length;
  const confirmEnabled = canConfirmTargets(targeting);
  const selectedSet = new Set(selectedTargetIds);

  // Plain-language count hint, e.g. "Choose 1" / "Choose 1–2" / "Choose up to 2".
  const countHint =
    minTargets === maxTargets
      ? `Choose ${minTargets}`
      : minTargets === 0
        ? `Choose up to ${maxTargets}`
        : `Choose ${minTargets}–${maxTargets}`;

  return (
    <section
      aria-label="Choose targets"
      data-testid="targeting-layer"
      className="flex w-full flex-col gap-3 rounded-xl border border-amber-500/40 bg-gradient-to-b from-stone-900/90 to-neutral-950/90 p-3 text-stone-100 shadow-lg shadow-black/40 ring-1 ring-amber-500/10"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
          Targeting
        </h2>
        <span
          data-testid="targeting-progress"
          className="shrink-0 text-[11px] font-semibold tabular-nums text-stone-300"
        >
          {selectedCount}/{maxTargets} selected
        </span>
      </header>

      <p className="text-sm font-medium leading-snug text-stone-100">{prompt}</p>
      <p className="text-[11px] uppercase tracking-wide text-stone-400">{countHint}</p>

      {legalTargetIds.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-700/60 bg-stone-950/40 px-3 py-4 text-center text-sm text-stone-400">
          No legal targets are available.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Legal targets">
          {legalTargets.map((t) => {
            const selected = selectedSet.has(t.id);
            // At max with this one unselected → picking it would overflow; dim it.
            const atMax = selectedCount >= maxTargets;
            const disabled = !selected && atMax && maxTargets > 0;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  data-testid="target-option"
                  data-target-id={t.id}
                  aria-pressed={selected}
                  disabled={disabled}
                  onClick={() => onToggleTarget(t.id)}
                  className={[
                    'min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60',
                    selected
                      ? 'border-amber-400/70 bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/40'
                      : 'border-stone-600/70 bg-stone-800/70 text-stone-200 hover:border-amber-400/50 hover:bg-stone-700/70',
                    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-stone-600/70 disabled:hover:bg-stone-800/70',
                  ].join(' ')}
                >
                  {t.name}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="mt-1 flex gap-2 border-t border-stone-700/50 pt-3">
        <button
          type="button"
          data-testid="targeting-cancel"
          onClick={onCancel}
          className="min-h-11 flex-1 rounded-lg border border-stone-600/60 bg-stone-800/70 px-3 py-2 text-sm font-bold text-stone-200 transition-colors hover:bg-stone-700/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-stone-400/50"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="targeting-confirm"
          onClick={onConfirm}
          disabled={!confirmEnabled}
          className="min-h-11 flex-1 rounded-lg bg-amber-400 px-3 py-2 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-amber-400"
        >
          Confirm
        </button>
      </footer>
    </section>
  );
}

export default TargetingLayer;
