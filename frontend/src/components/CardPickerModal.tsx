import { useEffect, useMemo, useState } from 'react';

interface CardPickerCard {
  instanceId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  oracleText?: string;
  legal?: boolean;
  reason?: string;
  destination?: 'hand' | 'battlefield' | 'graveyard' | 'top' | 'bottom' | 'exile' | 'command' | 'choice';
  entersTapped?: boolean;
  mustReveal?: boolean;
}

interface CardPickerModalProps {
  title: string;
  cards: CardPickerCard[];
  filter?: string;
  onPick: (cardInstanceId: string) => void;
  onCancel?: () => void;
  cancelLabel?: string;
  allowCustomName?: boolean;
}

export function sortCardPickerCards<T extends Pick<CardPickerCard, 'legal' | 'name' | 'typeLine'>>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const aLegal = a.legal !== false;
    const bLegal = b.legal !== false;
    if (aLegal !== bLegal) return aLegal ? -1 : 1;
    const nameCompare = a.name.localeCompare(b.name);
    if (nameCompare !== 0) return nameCompare;
    return a.typeLine.localeCompare(b.typeLine);
  });
}

export function cardPickerAvailabilityLabel(card: Pick<CardPickerCard, 'legal'>): string {
  return card.legal === false ? 'Unavailable' : 'Selectable';
}

export function cardPickerDestinationLabel(card: Pick<CardPickerCard, 'destination'>): string | undefined {
  if (!card.destination) return undefined;
  const labels: Record<NonNullable<CardPickerCard['destination']>, string> = {
    hand: 'To hand',
    battlefield: 'To battlefield',
    graveyard: 'To graveyard',
    top: 'To top of library',
    bottom: 'To bottom of library',
    exile: 'To exile',
    command: 'To command zone',
    choice: 'Destination choice',
  };
  return labels[card.destination];
}

export function cardPickerRevealLabel(card: Pick<CardPickerCard, 'mustReveal'>): string | undefined {
  if (card.mustReveal === undefined) return undefined;
  return card.mustReveal ? 'Reveal pick' : 'Hidden pick';
}

export function CardPickerModal({ title, cards, filter, onPick, onCancel, cancelLabel = 'Cancel search', allowCustomName = false }: CardPickerModalProps) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const customName = search.trim().replace(/\s+/g, ' ');
  const customOptionId = customName ? `custom-name:${encodeURIComponent(customName)}` : '';

  const filtered = useMemo(() => sortCardPickerCards(cards.filter(card => {
    const haystack = [card.name, card.typeLine, card.manaCost, card.oracleText || ''].join(' ').toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (filter && !card.typeLine.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  })), [cards, filter, search]);
  const selected = filtered.find(card => card.instanceId === selectedId)
    || filtered.find(card => card.legal !== false)
    || filtered[0];

  useEffect(() => {
    if (selectedId && filtered.some(card => card.instanceId === selectedId)) return;
    setSelectedId((filtered.find(card => card.legal !== false) || filtered[0])?.instanceId ?? null);
  }, [filtered, selectedId]);

  function moveSelection(delta: number): void {
    if (filtered.length === 0) return;
    const selectable = filtered.filter(card => card.legal !== false);
    const candidates = selectable.length > 0 ? selectable : filtered;
    const currentIndex = Math.max(0, candidates.findIndex(card => card.instanceId === selected?.instanceId));
    const nextIndex = (currentIndex + delta + candidates.length) % candidates.length;
    setSelectedId(candidates[nextIndex].instanceId);
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70">
      <div className="mx-4 flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-stone-600 bg-stone-800 p-4">
        <div className="mb-2 text-sm font-semibold text-amber-400">{title}</div>
        <input
          type="text"
          placeholder="Search name, type, subtype, or text..."
          value={search}
          onChange={event => setSearch(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && selected && selected.legal !== false) {
              event.preventDefault();
              onPick(selected.instanceId);
            } else if (event.key === 'Enter' && allowCustomName && customOptionId) {
              event.preventDefault();
              onPick(customOptionId);
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              moveSelection(1);
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              moveSelection(-1);
            }
          }}
          className="mb-3 w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200"
          autoFocus
        />
        <div className="flex-1 space-y-1 overflow-y-auto">
          {filtered.map(card => (
            <button
              key={card.instanceId}
              type="button"
              disabled={card.legal === false}
              onClick={() => card.legal !== false && onPick(card.instanceId)}
              onMouseEnter={() => setSelectedId(card.instanceId)}
              onFocus={() => setSelectedId(card.instanceId)}
              className={`w-full rounded px-3 py-2 text-left transition-colors ${
                selected?.instanceId === card.instanceId
                  ? 'bg-amber-900/50 ring-1 ring-amber-500/40'
                  : card.legal === false
                    ? 'bg-stone-800/70 opacity-60'
                    : 'bg-stone-700 hover:bg-stone-600'
              }`}
            >
              <div className="text-sm font-medium text-stone-200">{card.name}</div>
              <div className="text-xs text-stone-400">{card.typeLine} - {card.manaCost || 'no cost'}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <span className={`rounded px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ${
                  card.legal === false
                    ? 'bg-red-400/15 text-red-100'
                    : 'bg-emerald-400/15 text-emerald-100'
                }`}>
                  {cardPickerAvailabilityLabel(card)}
                </span>
                {cardPickerDestinationLabel(card) && (
                  <span className="rounded bg-sky-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-sky-100">
                    {cardPickerDestinationLabel(card)}
                  </span>
                )}
                {card.entersTapped && (
                  <span className="rounded bg-amber-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-amber-100">
                    Tapped
                  </span>
                )}
                {cardPickerRevealLabel(card) && (
                  <span className="rounded bg-stone-600/50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-stone-200">
                    {cardPickerRevealLabel(card)}
                  </span>
                )}
              </div>
              {card.reason && (
                <div className={`mt-1 text-[11px] font-semibold leading-snug ${card.legal === false ? 'text-red-100/85' : 'text-emerald-100/80'}`}>
                  {card.reason}
                </div>
              )}
              {card.oracleText && (
                <div className="mt-1 line-clamp-2 text-[11px] leading-snug text-stone-500">
                  {card.oracleText}
                </div>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="rounded border border-stone-700 bg-stone-900 p-4 text-center text-sm text-stone-500">
              <div>No matching cards found</div>
              {allowCustomName && customName && (
                <button
                  type="button"
                  onClick={() => onPick(customOptionId)}
                  className="mt-3 min-h-10 rounded bg-amber-500 px-4 py-2 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-400"
                >
                  Name "{customName}"
                </button>
              )}
            </div>
          )}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {selected && selected.legal !== false ? (
            <button
              type="button"
              onClick={() => onPick(selected.instanceId)}
              className="min-h-10 rounded bg-amber-500 px-4 py-2 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-400"
            >
              Pick selected
            </button>
          ) : allowCustomName && customName ? (
            <button
              type="button"
              onClick={() => onPick(customOptionId)}
              className="min-h-10 rounded bg-amber-500 px-4 py-2 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-400"
            >
              Name "{customName}"
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="min-h-10 rounded bg-amber-500 px-4 py-2 text-sm font-black text-neutral-950 opacity-45"
            >
              Pick selected
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="min-h-10 rounded border border-stone-700 px-4 py-2 text-xs font-semibold text-stone-400 hover:border-stone-500 hover:text-stone-300"
            >
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
