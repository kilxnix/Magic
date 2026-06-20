import { Panel, BrassButton } from '../primitives';
import { cn } from '../../../lib/utils';
import type { TargetingContext } from '../../gameView.types';

export function TargetingLayerV2({
  targeting, onToggleTarget, onConfirm, onCancel,
}: { targeting: TargetingContext; onToggleTarget(id: string): void; onConfirm(): void; onCancel(): void }) {
  if (!targeting.active) return null;
  const n = targeting.selectedTargetIds.length;
  const ready = n >= targeting.minTargets && n <= targeting.maxTargets;
  return (
    <Panel className="flex flex-col gap-2 border-brass-deep p-2">
      <span className="font-display text-[15px] text-gold-bright">{targeting.prompt}</span>
      <div className="flex flex-wrap gap-1.5">
        {targeting.legalTargets.map(t => (
          <button key={t.id} type="button" aria-label={t.name} onClick={() => onToggleTarget(t.id)}
            className={cn('rounded-md border px-2 py-1 text-[12px]',
              targeting.selectedTargetIds.includes(t.id) ? 'border-brass-deep bg-brass text-brass-on' : 'border-table-border text-gold-bright')}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <BrassButton tone="primary" onClick={onConfirm} disabled={!ready}>Confirm</BrassButton>
        <BrassButton tone="neutral" onClick={onCancel}>Cancel</BrassButton>
      </div>
    </Panel>
  );
}
