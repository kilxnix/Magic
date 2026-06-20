import { BrassButton } from '../primitives';
import { cn } from '../../../lib/utils';
import type { PriorityContext } from '../../gameView.types';

export function PriorityControlsV2({
  priority, alwaysStop, onPass, onHold, onToggleAlwaysStop,
}: {
  priority: PriorityContext; alwaysStop: boolean;
  onPass(): void; onHold(): void; onToggleAlwaysStop(): void;
}) {
  return (
    <div className="flex items-center gap-2">
      <BrassButton tone="primary" onClick={onPass} disabled={!priority.canPass}>Pass</BrassButton>
      <BrassButton tone="neutral" onClick={onHold} disabled={!priority.canHold}>Hold</BrassButton>
      <button type="button" onClick={onToggleAlwaysStop}
        className={cn('rounded-md border px-2 py-1 text-[11px]', alwaysStop ? 'border-brass-deep bg-brass text-brass-on' : 'border-table-border text-gold-muted')}>
        Always stop
      </button>
    </div>
  );
}
