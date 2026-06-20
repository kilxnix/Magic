import { Panel } from '../primitives';
import { cn } from '../../../lib/utils';
import type { PriorityContext } from '../../gameView.types';

const PHASES = ['Beginning', 'Main 1', 'Combat', 'Main 2', 'End'];

export function PhaseTrackV2({ priority }: { priority: PriorityContext }) {
  return (
    <Panel className="flex items-center gap-2 px-3 py-2">
      <span className="font-display text-[15px] font-bold text-gold-bright">{priority.isYourTurn ? 'Your turn' : 'Their turn'}</span>
      <span className="flex gap-1">
        {PHASES.map(p => (
          <span key={p} className={cn('rounded-full border px-2 py-0.5 text-[11px]',
            priority.phaseLabel.toLowerCase().startsWith(p.toLowerCase().slice(0, 4))
              ? 'border-brass-deep bg-brass text-brass-on font-semibold'
              : 'border-table-border text-gold-muted')}>{p}</span>
        ))}
      </span>
    </Panel>
  );
}
