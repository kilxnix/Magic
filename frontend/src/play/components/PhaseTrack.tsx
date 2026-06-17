import { cn } from '../../lib/utils';

export interface PhaseTrackProps {
  /** The view-model's current phase label (e.g. "Main Phase 1", "Declare Attackers"). */
  phaseLabel: string;
}

const PHASES = [
  { key: 'upkeep', label: 'Upkeep' },
  { key: 'draw', label: 'Draw' },
  { key: 'main1', label: 'Main 1' },
  { key: 'combat', label: 'Combat' },
  { key: 'main2', label: 'Main 2' },
  { key: 'end', label: 'End' },
] as const;

function activePhase(phaseLabel: string): string {
  const l = phaseLabel.toLowerCase();
  if (l.includes('upkeep')) return 'upkeep';
  if (l.includes('draw')) return 'draw';
  if (l.includes('main phase 1') || l.includes('precombat')) return 'main1';
  if (l.includes('main phase 2') || l.includes('postcombat')) return 'main2';
  if (l.includes('combat') || l.includes('attack') || l.includes('block') || l.includes('damage')) {
    return 'combat';
  }
  if (l.includes('end') || l.includes('cleanup')) return 'end';
  return '';
}

/**
 * PhaseTrack — a compact vertical map of the turn's phases with the current one
 * lit. Fills the left rail (so it doesn't read as dead space) and doubles as a
 * learning aid: you can see where you are in the turn at a glance.
 *
 * PURE / PRESENTATIONAL — derives the active phase from the label heuristically.
 */
export function PhaseTrack({ phaseLabel }: PhaseTrackProps) {
  const active = activePhase(phaseLabel);
  const activeIdx = PHASES.findIndex((p) => p.key === active);

  return (
    <section
      data-testid="phase-track"
      aria-label="Turn phases"
      className="rounded-xl border border-amber-900/25 bg-gradient-to-b from-stone-900/70 to-neutral-950/70 p-2.5"
    >
      <h3 className="mb-2 px-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
        This turn
      </h3>
      <ol className="flex flex-col gap-0.5">
        {PHASES.map((p, i) => {
          const isActive = p.key === active;
          const isPast = activeIdx >= 0 && i < activeIdx;
          return (
            <li
              key={p.key}
              data-active={isActive || undefined}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
                isActive
                  ? 'bg-amber-500/15 text-amber-100 ring-1 ring-amber-400/30'
                  : isPast
                    ? 'text-stone-600'
                    : 'text-stone-500',
              )}
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  isActive ? 'bg-amber-400 ring-2 ring-amber-400/30' : isPast ? 'bg-stone-600' : 'bg-stone-700',
                )}
              />
              {p.label}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default PhaseTrack;
