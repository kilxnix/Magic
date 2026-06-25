import { Skull, Flame, Layers, Crown } from 'lucide-react';
import { cn } from '../../../lib/utils';
const ICON = { grave: Skull, exile: Flame, library: Layers, command: Crown } as const;
export function ZoneCounter({
  icon, label, count, onClick,
}: { icon: keyof typeof ICON; label: string; count: number; onClick?(): void }) {
  const Icon = ICON[icon];
  return (
    <button
      type="button" onClick={onClick} aria-label={`${label} ${count}`}
      className={cn('flex items-center gap-1 rounded-md border border-table-border bg-table-leather2 px-2 py-1 text-gold-muted',
        onClick ? 'hover:text-gold-bright' : 'cursor-default')}
    >
      <Icon size={14} aria-hidden />
      <span className="hidden text-[11px] sm:inline">{label}</span>
      <span className="text-[12px] font-bold text-gold-bright">{count}</span>
    </button>
  );
}
