import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
const TONE = {
  pt: 'bg-card-stock text-card-ink border-card-badge',
  count: 'bg-table-leather2 text-gold-bright border-table-border',
  brass: 'bg-brass text-brass-on border-brass-deep',
} as const;
export function Badge({ children, tone = 'count' }: { children: ReactNode; tone?: keyof typeof TONE }) {
  return <span className={cn('rounded border px-1.5 text-[11px] font-bold leading-tight', TONE[tone])}>{children}</span>;
}
