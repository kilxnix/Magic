import { useState } from 'react';
import type { TutorCardOption } from '../gameView.types';
import { CardImage } from '../../components/CardImage';
import { cn } from '../../lib/utils';

export interface CardPickerModalProps {
  title: string;
  cards: TutorCardOption[];
  /** Pick an option by its instanceId (or 'custom-name:<encoded>' for name-a-card). */
  onPick(idOrName: string): void;
  onCancel(): void;
}

/**
 * Mirror GameBoard's tutorTitle heuristics — the shared tutor channel disambiguates
 * by title text (the hook does not expose which pending ref is armed).
 */
function deriveCancelLabel(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('decline sacrifice') || t.includes('sacrifice')) return 'Decline sacrifice';
  if (t.includes('decline')) return 'Decline';
  return 'Cancel';
}

/**
 * CardPickerModal — the UI for the engine's shared tutor/search channel.
 *
 * This ONE modal serves every prompt the hook surfaces through
 * tutorPhase/tutorCards/tutorTitle + the resolveTutor dispatcher: library
 * search / fetch, put-cards-on-top, reveal-a-pile, sacrifice-a-permanent,
 * name-a-card, and cast/land additional-cost choices (incl. shock-land
 * "enter tapped or pay life"). Options that are real cards show art; plain
 * choices (e.g. "Pay 2 life") render as labeled buttons.
 *
 * PURE / PRESENTATIONAL: props in, picks out. Rendered above the board shells.
 */
export function CardPickerModal({ title, cards, onPick, onCancel }: CardPickerModalProps) {
  const allowCustomName = /name a card|choose a card name|name a/i.test(title);
  const [customName, setCustomName] = useState('');

  return (
    <div
      data-testid="card-picker-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="absolute inset-0 z-[46] flex items-center justify-center bg-neutral-950/85 px-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[88%] w-full max-w-2xl flex-col rounded-xl border border-amber-500/40 bg-neutral-950 p-4 shadow-2xl shadow-black/60">
        <h2 className="text-base font-black uppercase tracking-wide text-amber-200">{title}</h2>

        <div className="mt-3 grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
          {cards.length === 0 && (
            <p className="col-span-full py-6 text-center text-sm text-stone-500">No options.</p>
          )}
          {cards.map((card) => {
            const disabled = card.legal === false;
            const isCard = Boolean(card.typeLine || card.manaCost);
            return (
              <button
                key={card.instanceId}
                type="button"
                data-testid="card-picker-option"
                disabled={disabled}
                onClick={() => onPick(card.instanceId)}
                title={card.reason || card.name}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-2 text-left transition-colors',
                  disabled
                    ? 'cursor-not-allowed border-stone-700 bg-stone-900/50 opacity-50'
                    : 'border-stone-600 bg-stone-800/70 hover:border-amber-400/70 hover:bg-stone-700/70',
                )}
              >
                {isCard && (
                  <span className="mb-1 block h-24 w-full overflow-hidden rounded bg-stone-900">
                    <CardImage
                      cardName={card.name}
                      size="small"
                      showHoverZoom={false}
                      className="h-full w-full [&_img]:object-cover"
                    />
                  </span>
                )}
                <span className="flex items-baseline justify-between gap-1">
                  <span className="truncate text-sm font-bold text-stone-100">{card.name}</span>
                  {card.manaCost && (
                    <span className="shrink-0 text-[10px] font-bold text-amber-200/80">
                      {card.manaCost}
                    </span>
                  )}
                </span>
                {card.typeLine && (
                  <span className="truncate text-[10px] text-stone-400">{card.typeLine}</span>
                )}
                {disabled && card.reason && (
                  <span className="text-[10px] leading-tight text-rose-300">{card.reason}</span>
                )}
              </button>
            );
          })}
        </div>

        {allowCustomName && (
          <div className="mt-3 flex gap-2">
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Name a card…"
              data-testid="card-picker-custom-name"
              className="min-w-0 flex-1 rounded-lg border border-stone-600 bg-stone-900 px-3 py-2 text-sm text-stone-100 focus:border-amber-400/70 focus:outline-none"
            />
            <button
              type="button"
              disabled={!customName.trim()}
              onClick={() => onPick(`custom-name:${encodeURIComponent(customName.trim())}`)}
              className="shrink-0 rounded-lg bg-amber-400 px-3 py-2 text-sm font-bold text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Name it
            </button>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            data-testid="card-picker-cancel"
            onClick={onCancel}
            className="rounded-lg border border-stone-600 bg-stone-800 px-4 py-2 text-sm font-bold text-stone-200 transition-colors hover:bg-stone-700"
          >
            {deriveCancelLabel(title)}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CardPickerModal;
