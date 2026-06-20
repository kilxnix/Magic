import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-table-border bg-table-leather', className)}>{children}</div>;
}
