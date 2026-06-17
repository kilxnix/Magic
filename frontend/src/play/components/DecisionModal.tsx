import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export type DecisionAccent = 'amber' | 'sky' | 'rose';

export interface DecisionModalProps {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  declineLabel: string;
  /** Disable confirm (e.g. tax/ward "Pay" when the player can't afford it). */
  confirmDisabled?: boolean;
  accent?: DecisionAccent;
  onConfirm(): void;
  onDecline(): void;
}

const ACCENT: Record<DecisionAccent, { ring: string; confirm: string }> = {
  amber: {
    ring: 'border-amber-500/40',
    confirm: 'bg-amber-400 text-neutral-950 hover:bg-amber-300',
  },
  sky: {
    ring: 'border-sky-500/40',
    confirm: 'bg-sky-400 text-neutral-950 hover:bg-sky-300',
  },
  rose: {
    ring: 'border-rose-500/40',
    confirm: 'bg-rose-400 text-neutral-950 hover:bg-rose-300',
  },
};

/**
 * DecisionModal — a centered yes/no decision overlay.
 *
 * PURE / PRESENTATIONAL: the caller supplies the copy + the two outcomes. Used
 * for the engine's blocking yes/no pauses (optional "you may" triggers, tax
 * "unless you pay", ward "pay or be countered"). Rendered above the board shells
 * so the board can't be acted on while the engine waits on the answer.
 */
export function DecisionModal({
  title,
  body,
  confirmLabel,
  declineLabel,
  confirmDisabled = false,
  accent = 'amber',
  onConfirm,
  onDecline,
}: DecisionModalProps) {
  const theme = ACCENT[accent];
  return (
    <div
      data-testid="decision-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-0 z-[45] flex animate-fade-in items-center justify-center bg-neutral-950/80 px-4 backdrop-blur-sm"
    >
      <div
        className={cn(
          'w-full max-w-sm animate-tile-in rounded-xl border bg-gradient-to-b from-stone-900 to-neutral-950 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.6)]',
          theme.ring,
        )}
      >
        <h2 className="font-serif text-base font-bold tracking-tight text-stone-100">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-stone-300">{body}</div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            data-testid="decision-decline"
            onClick={onDecline}
            className="min-h-10 rounded-lg border border-stone-600 bg-stone-800 px-4 py-1.5 text-sm font-bold text-stone-100 transition-colors hover:bg-stone-700"
          >
            {declineLabel}
          </button>
          <button
            type="button"
            data-testid="decision-confirm"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className={cn(
              'min-h-10 rounded-lg px-4 py-1.5 text-sm font-bold transition-colors',
              confirmDisabled ? 'cursor-not-allowed bg-stone-700 text-stone-500' : theme.confirm,
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DecisionModal;
