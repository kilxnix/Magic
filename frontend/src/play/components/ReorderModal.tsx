import { useState } from 'react';
import { cn } from '../../lib/utils';
import type { DecisionAccent } from './DecisionModal';

export interface ReorderItem {
  id: string;
  primary: string;
  secondary?: string;
}
export interface ReorderSection {
  key: string;
  heading?: string;
  items: ReorderItem[];
}

export interface ReorderModalProps {
  title: string;
  /** Optional explainer under the title. */
  hint?: string;
  sections: ReorderSection[];
  confirmLabel: string;
  accent?: DecisionAccent;
  onConfirm(orderedBySection: Record<string, string[]>): void;
}

const ACCENT_BTN: Record<DecisionAccent, string> = {
  amber: 'bg-amber-400 text-neutral-950 hover:bg-amber-300',
  sky: 'bg-sky-400 text-neutral-950 hover:bg-sky-300',
  rose: 'bg-rose-400 text-neutral-950 hover:bg-rose-300',
};

/**
 * ReorderModal — an ordered up/down list, one or more sections.
 *
 * Serves the engine's two "put these in an order" prompts: combat damage
 * assignment (one section per attacker, order its blockers) and trigger ordering
 * (one section, order simultaneous triggers). Local order seeds from the incoming
 * items; remount (via a `key` on the choice id at the call site) re-seeds it.
 *
 * PURE / PRESENTATIONAL. Rendered above the board shells.
 */
export function ReorderModal({
  title,
  hint,
  sections,
  confirmLabel,
  accent = 'amber',
  onConfirm,
}: ReorderModalProps) {
  const [orders, setOrders] = useState<Record<string, string[]>>(() => {
    const o: Record<string, string[]> = {};
    for (const s of sections) o[s.key] = s.items.map((i) => i.id);
    return o;
  });

  const move = (sectionKey: string, id: string, dir: -1 | 1) => {
    setOrders((prev) => {
      const arr = [...(prev[sectionKey] ?? [])];
      const i = arr.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return { ...prev, [sectionKey]: arr };
    });
  };

  return (
    <div
      data-testid="reorder-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-0 z-[46] flex items-center justify-center bg-neutral-950/85 px-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[88%] w-full max-w-md flex-col rounded-xl border border-amber-500/40 bg-neutral-950 p-4 shadow-2xl shadow-black/60">
        <h2 className="text-base font-black uppercase tracking-wide text-amber-200">{title}</h2>
        {hint && <p className="mt-1 text-xs text-stone-400">{hint}</p>}

        <div className="mt-3 flex flex-col gap-3 overflow-y-auto">
          {sections.map((section) => (
            <div key={section.key}>
              {section.heading && (
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-stone-400">
                  {section.heading}
                </div>
              )}
              <ol className="flex flex-col gap-1">
                {(orders[section.key] ?? []).map((id, idx) => {
                  const item = section.items.find((i) => i.id === id);
                  if (!item) return null;
                  const list = orders[section.key] ?? [];
                  return (
                    <li
                      key={id}
                      data-testid="reorder-item"
                      className="flex items-center gap-2 rounded-lg border border-stone-700 bg-stone-800/70 px-2.5 py-1.5"
                    >
                      <span className="w-4 shrink-0 text-center text-xs font-black tabular-nums text-amber-300">
                        {idx + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-stone-100">
                          {item.primary}
                        </span>
                        {item.secondary && (
                          <span className="block truncate text-[10px] text-stone-400">
                            {item.secondary}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 flex-col">
                        <button
                          type="button"
                          aria-label="Move up"
                          disabled={idx === 0}
                          onClick={() => move(section.key, id, -1)}
                          className="px-1.5 text-stone-300 hover:text-amber-300 disabled:opacity-30"
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          disabled={idx === list.length - 1}
                          onClick={() => move(section.key, id, 1)}
                          className="px-1.5 text-stone-300 hover:text-amber-300 disabled:opacity-30"
                        >
                          ▼
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            data-testid="reorder-confirm"
            onClick={() => onConfirm(orders)}
            className={cn('min-h-10 rounded-lg px-4 py-2 text-sm font-bold', ACCENT_BTN[accent])}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ReorderModal;
