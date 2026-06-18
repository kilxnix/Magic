import { useState } from 'react';
import type { TutorCardOption } from '../gameView.types';
import { CardImage } from '../../components/CardImage';
import { cn } from '../../lib/utils';

export interface LibraryChoiceModalProps {
  mode: 'scry' | 'surveil';
  title: string;
  cards: TutorCardOption[];
  /** topIds = stay on top (in order, drawn first); movedIds = to bottom / graveyard. */
  onResolve(topIds: string[], movedIds: string[]): void;
}

/**
 * LibraryChoiceModal — scry / surveil top-of-library ordering.
 *
 * One list in resolve order (index 0 = top, drawn next). Each card can be ordered
 * up/down and toggled to the away lane — the bottom of the library (scry) or the
 * graveyard (surveil). Confirm sends the kept cards (in order) + the away cards.
 *
 * PURE / PRESENTATIONAL. Rendered above the board shells.
 */
export function LibraryChoiceModal({ mode, title, cards, onResolve }: LibraryChoiceModalProps) {
  const [order, setOrder] = useState<string[]>(() => cards.map((c) => c.instanceId));
  const [moved, setMoved] = useState<Set<string>>(() => new Set());
  const awayLabel = mode === 'surveil' ? 'Graveyard' : 'Bottom';

  const toggleMoved = (id: string) =>
    setMoved((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const move = (id: string, dir: -1 | 1) =>
    setOrder((prev) => {
      const arr = [...prev];
      const i = arr.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });

  const cardById = (id: string) => cards.find((c) => c.instanceId === id);
  const confirm = () =>
    onResolve(
      order.filter((id) => !moved.has(id)),
      order.filter((id) => moved.has(id)),
    );

  return (
    <div
      data-testid="library-choice-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-0 z-[46] flex animate-fade-in items-center justify-center bg-neutral-950/85 px-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[88%] w-full max-w-md animate-tile-in flex-col rounded-xl border border-amber-500/40 bg-gradient-to-b from-stone-900 to-neutral-950 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.6)]">
        <h2 className="font-serif text-base font-bold tracking-tight text-amber-100">{title}</h2>
        <p className="mt-1 text-xs text-stone-400">
          Top of the list is drawn next. Reorder, or send cards to the {awayLabel.toLowerCase()}.
        </p>

        <ol className="mt-3 flex flex-col gap-1 overflow-y-auto">
          {order.map((id, idx) => {
            const card = cardById(id);
            if (!card) return null;
            const away = moved.has(id);
            return (
              <li
                key={id}
                data-testid="library-card"
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2 py-1.5',
                  away ? 'border-stone-700 bg-stone-900/40 opacity-70' : 'border-stone-600 bg-stone-800/70',
                )}
              >
                <span className="h-12 w-9 shrink-0 overflow-hidden rounded bg-stone-900">
                  <CardImage
                    cardName={card.name}
                    size="small"
                    showHoverZoom={false}
                    className="h-full w-full [&_img]:object-cover"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-stone-100">{card.name}</span>
                  <span
                    className={cn(
                      'text-[10px] font-bold uppercase tracking-wide',
                      away ? 'text-stone-500' : 'text-emerald-300',
                    )}
                  >
                    {away ? awayLabel : 'Top'}
                  </span>
                </span>
                {!away && (
                  <span className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={idx === 0}
                      onClick={() => move(id, -1)}
                      className="px-1 text-stone-200 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-stone-200"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={idx === order.length - 1}
                      onClick={() => move(id, 1)}
                      className="px-1 text-stone-200 hover:text-amber-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-stone-200"
                    >
                      ▼
                    </button>
                  </span>
                )}
                <button
                  type="button"
                  data-testid="library-toggle"
                  onClick={() => toggleMoved(id)}
                  className="shrink-0 rounded border border-stone-600 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-stone-200 hover:bg-stone-700"
                >
                  {away ? 'Keep' : `→ ${awayLabel}`}
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-testid="library-keep-all"
            onClick={() => onResolve(order, [])}
            className="rounded-lg border border-stone-600 bg-stone-800 px-3 py-2 text-sm font-bold text-stone-200 hover:bg-stone-700"
          >
            Keep all on top
          </button>
          <button
            type="button"
            data-testid="library-confirm"
            onClick={confirm}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-neutral-950 hover:bg-amber-300"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

export default LibraryChoiceModal;
