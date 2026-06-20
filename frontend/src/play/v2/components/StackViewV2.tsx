import { Panel } from '../primitives';
import { cn } from '../../../lib/utils';
import { cardViewFromStack } from '../cardView';
import type { CardView, StackItemView } from '../../gameView.types';

export function StackViewV2({ stack, onView }: { stack: StackItemView[]; onView(cv: CardView): void }) {
  if (stack.length === 0) return null;
  return (
    <Panel className="flex flex-col gap-1 p-2">
      {stack.map(s => (
        <button key={s.id} type="button" aria-label={s.title} onClick={() => onView(cardViewFromStack(s))}
          className={cn('rounded-md border px-2 py-1 text-left', s.resolvesNext ? 'border-brass-deep bg-table-leather2' : 'border-table-border')}>
          <span className="block font-display text-[14px] font-bold text-gold-bright">{s.title}</span>
          <span className="block text-[11px] text-gold-muted">{s.controllerName} · {s.description}</span>
        </button>
      ))}
    </Panel>
  );
}
