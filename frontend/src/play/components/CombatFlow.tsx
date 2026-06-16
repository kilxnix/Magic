import type { CombatContext, CombatStep } from '../gameView.types';

// ============================================================================
// CombatFlow — the guided combat banner.
//
// PURE / PRESENTATIONAL: props in, callbacks out. No engine/hook access, no game
// logic. The view-model (`useGameView`) has already derived the CombatContext
// (step / eligibleIds / assignments); this component only renders the current
// step and reports assignment + confirm clicks.
//
// Spec (interaction grammar → "Combat flow"): declare attackers (tap → choose
// defender) → assign blockers → order damage only if ambiguous → confirm. This
// banner walks the human through whichever step is live, labels it in plain
// language, and offers a single deliberate Confirm to commit it ("look vs.
// commit": committing an action is always deliberate).
//
// LAYOUT / BUG-CLASS GUARD: this is a normal-flow <section>, NEVER a
// position:fixed bar and NEVER an absolutely-positioned overlay. The layout
// shells dock it in flow so it can never sit over the board's interactive layer
// and swallow taps (the exact bug class this redesign fixes).
//
// Note on CardImage: the CombatContext carries object *ids* only (eligibleIds /
// assignments), not card names. With no name there is no art to resolve, so this
// view deliberately does NOT render <CardImage> (resolving art from an id would
// fabricate the wrong card — against the project's honesty bar). When the
// view-model later surfaces per-combatant names, the assignment row is where
// `import { CardImage } from '../../components/CardImage'` →
// <CardImage cardName={...}/> would slot in.
// ============================================================================

export interface CombatFlowProps {
  combat: CombatContext;
  /**
   * Pair two combat ids — in declare-attackers `a` is the attacker and `b` the
   * defender; in declare-blockers `a` is the blocker and `b` the attacker it
   * blocks; in order-damage `a` is the attacker and `b` the next blocker in the
   * damage order. The view-model interprets the pairing for the live step.
   */
  onAssign(a: string, b: string): void;
  /** Commit the current combat step (deliberate — this is the "commit" action). */
  onConfirm(): void;
}

/** Plain-language copy for each combat step (label + the action verb on Confirm). */
const STEP_COPY: Record<Exclude<CombatStep, 'none'>, { label: string; cta: string; hint: string }> = {
  'declare-attackers': {
    label: 'Declare attackers',
    cta: 'Confirm attackers',
    hint: 'Tap a creature to attack, then choose who it attacks.',
  },
  'declare-blockers': {
    label: 'Declare blockers',
    cta: 'Confirm blockers',
    hint: 'Assign your creatures to block incoming attackers.',
  },
  'order-damage': {
    label: 'Order combat damage',
    cta: 'Confirm damage order',
    hint: 'Order how lethal damage is dealt among multiple blockers.',
  },
};

/**
 * Guided combat banner. Renders nothing when `step` is `none`; otherwise shows
 * the current step label, a short hint, and a single Confirm button that commits
 * the step. Each eligible combatant is exposed as a small assignment control so
 * the shell can wire taps back through `onAssign`.
 */
export function CombatFlow({ combat, onAssign, onConfirm }: CombatFlowProps) {
  const { step, eligibleIds, assignments } = combat;

  // No combat in progress → render nothing (no banner, no layout footprint).
  if (step === 'none') {
    return null;
  }

  const copy = STEP_COPY[step];

  return (
    // Normal-flow banner — never fixed/absolute. The shell sizes it via className.
    <section
      data-testid="combat-flow"
      data-step={step}
      aria-label="Combat"
      className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-amber-500/45 bg-stone-900/90 p-3 text-stone-100 shadow-lg"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-amber-200/90">
          Combat
        </h2>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-stone-400">
          Step
        </span>
      </header>

      <div>
        <p data-testid="combat-step-label" className="text-sm font-black leading-tight text-stone-50">
          {copy.label}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-stone-400">{copy.hint}</p>
      </div>

      {eligibleIds.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Combatants">
          {eligibleIds.map((id) => {
            const assignedTo = assignments[id] ?? [];
            const isAssigned = assignedTo.length > 0;
            return (
              <li key={id}>
                <button
                  type="button"
                  data-testid="combat-combatant"
                  data-combatant-id={id}
                  aria-pressed={isAssigned}
                  // Pairing semantics are owned by the view-model; the banner
                  // reports the tapped combatant + its first current assignment
                  // (empty string when none yet) and lets the shell resolve it.
                  onClick={() => onAssign(id, assignedTo[0] ?? '')}
                  className={[
                    'min-h-10 rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60',
                    isAssigned
                      ? 'border-amber-400/70 bg-amber-500/20 text-amber-100 ring-1 ring-amber-400/40'
                      : 'border-stone-600/70 bg-stone-800/70 text-stone-200 hover:border-amber-400/50 hover:bg-stone-700/70',
                  ].join(' ')}
                >
                  {id}
                  {isAssigned && (
                    <span className="ml-1.5 text-[11px] font-bold text-amber-200/80">
                      → {assignedTo.join(', ')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <footer className="mt-1 flex border-t border-stone-700/50 pt-3">
        <button
          type="button"
          data-testid="combat-confirm"
          onClick={onConfirm}
          className="min-h-11 flex-1 rounded-lg bg-amber-400 px-3 py-2 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
        >
          {copy.cta}
        </button>
      </footer>
    </section>
  );
}

export default CombatFlow;
