import { useEffect, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';
export function ModalShell({
  title, onClose, children, side,
}: { title: string; onClose(): void; children: ReactNode; side?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-3">
      <div data-testid="modal-backdrop" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className={cn('relative max-h-full w-full max-w-3xl overflow-hidden rounded-xl border border-table-border-hi bg-table-leather2 p-4')}>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-display text-2xl font-bold text-gold-bright">{title}</h2>
          {side}
          <button type="button" aria-label="Close" onClick={onClose}
            className="ml-auto rounded-md border border-table-border px-2 py-1 text-gold-bright">✕</button>
        </div>
        <div className="max-h-[70svh] overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
