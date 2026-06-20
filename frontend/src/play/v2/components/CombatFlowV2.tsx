import { Panel, BrassButton } from '../primitives';
import { cn } from '../../../lib/utils';
import type { CombatContext } from '../../gameView.types';

export function CombatFlowV2({
  combat, selectedDefenderId, onAssign, onConfirm, onSkip, onSelectDefender,
}: {
  combat: CombatContext; selectedDefenderId: string | null;
  onAssign(a: string, b: string): void; onConfirm(): void; onSkip(): void; onSelectDefender(id: string): void;
}) {
  if (combat.step === 'none') return null;
  const title = combat.step === 'declare-attackers' ? 'Declare attackers' : combat.step === 'declare-blockers' ? 'Declare blockers' : 'Assign combat damage';
  return (
    <Panel className="flex flex-col gap-2 border-oxblood p-2">
      <span className="font-display text-[15px] text-gold-bright">{title}</span>
      {combat.step === 'declare-attackers' && combat.eligibleDefenders.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {combat.eligibleDefenders.map(d => (
            <button key={d.id} type="button" onClick={() => onSelectDefender(d.id)}
              className={cn('rounded-md border px-2 py-1 text-[12px]', selectedDefenderId === d.id ? 'border-brass-deep bg-brass text-brass-on' : 'border-table-border text-gold-bright')}>
              {d.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {combat.eligible.map(c => (
          <button key={c.id} type="button" aria-label={c.name} onClick={() => onAssign(c.id, selectedDefenderId ?? '')}
            className="rounded-md border border-table-border px-2 py-1 text-[12px] text-gold-bright">
            {c.name}{c.power != null ? ` ${c.power}/${c.toughness}` : ''}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <BrassButton tone="danger" onClick={onConfirm}>Confirm</BrassButton>
        <BrassButton tone="neutral" onClick={onSkip}>Skip</BrassButton>
      </div>
    </Panel>
  );
}
