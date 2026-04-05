import { useState } from 'react';

interface CardPickerCard {
  instanceId: string;
  name: string;
  typeLine: string;
  manaCost: string;
}

interface CardPickerModalProps {
  title: string;
  cards: CardPickerCard[];
  filter?: string;
  onPick: (cardInstanceId: string) => void;
  onCancel?: () => void;
}

export function CardPickerModal({ title, cards, filter, onPick, onCancel }: CardPickerModalProps) {
  const [search, setSearch] = useState('');

  const filtered = cards.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter && !c.typeLine.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-stone-800 border border-stone-600 rounded-xl p-4 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="text-amber-400 font-semibold text-sm mb-2">{title}</div>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-stone-900 border border-stone-700 rounded text-stone-200 text-sm mb-3"
          autoFocus
        />
        <div className="flex-1 overflow-y-auto space-y-1">
          {filtered.map(card => (
            <button
              key={card.instanceId}
              onClick={() => onPick(card.instanceId)}
              className="w-full text-left px-3 py-2 rounded bg-stone-700 hover:bg-stone-600 transition-colors"
            >
              <div className="text-stone-200 text-sm font-medium">{card.name}</div>
              <div className="text-stone-400 text-xs">{card.typeLine} — {card.manaCost || 'no cost'}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="text-stone-500 text-sm text-center py-4">No matching cards found</div>
          )}
        </div>
        {onCancel && (
          <button onClick={onCancel} className="mt-3 text-stone-400 text-xs hover:text-stone-300">
            Cancel search
          </button>
        )}
      </div>
    </div>
  );
}
