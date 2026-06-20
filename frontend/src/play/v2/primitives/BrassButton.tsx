import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
const TONE = {
  primary: 'bg-brass border-brass-deep text-brass-on',
  neutral: 'bg-table-leather border-table-border text-gold-bright',
  danger: 'bg-oxblood border-oxblood text-[#f2d2c6]',
} as const;
export function BrassButton({
  children, onClick, tone = 'neutral', disabled,
}: { children: ReactNode; onClick(): void; tone?: keyof typeof TONE; disabled?: boolean }) {
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      className={cn('rounded-lg border px-3 py-2 font-display text-sm font-bold disabled:opacity-50', TONE[tone])}
    >
      {children}
    </button>
  );
}
