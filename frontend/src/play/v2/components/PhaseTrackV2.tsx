import { Panel } from '../primitives';
import { cn } from '../../../lib/utils';
import type { PriorityContext } from '../../gameView.types';

const PHASES = ['Beginning', 'Main 1', 'Combat', 'Main 2', 'End'];

// phaseLabel emits values like "Upkeep", "Draw", "Main Phase 1", "Combat",
// "Declare Attackers", "Main Phase 2", "End Step", "Cleanup / Discard".
// Map to exactly one pip index, mirroring v1 PhaseTrack's ordered includes-check.
function activeIndex(label: string): number {
  const l = label.toLowerCase();
  if (l.includes('upkeep') || l.includes('draw') || l.includes('untap') || l.includes('beginning')) return 0;
  if (l.includes('main phase 1') || l.includes('precombat')) return 1;
  if (l.includes('main phase 2') || l.includes('postcombat')) return 3;
  if (l.includes('combat') || l.includes('attack') || l.includes('block') || l.includes('damage')) return 2;
  if (l.includes('end') || l.includes('cleanup')) return 4;
  return -1;
}

export function PhaseTrackV2({ priority }: { priority: PriorityContext }) {
  const active = activeIndex(priority.phaseLabel);
  return (
    <Panel className="flex items-center gap-2 px-3 py-2">
      <span className="font-display text-[15px] font-bold text-gold-bright">{priority.isYourTurn ? 'Your turn' : 'Their turn'}</span>
      <span className="flex gap-1">
        {PHASES.map((p, i) => (
          <span key={p} className={cn('rounded-full border px-2 py-0.5 text-[11px]',
            i === active
              ? 'border-brass-deep bg-brass text-brass-on font-semibold'
              : 'border-table-border text-gold-muted')}>{p}</span>
        ))}
      </span>
    </Panel>
  );
}
