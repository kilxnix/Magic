import { Deck } from '../types';
import { cn } from '../lib/utils';
import { Clock, ExternalLink, ChevronRight } from 'lucide-react';

interface DeckHistoryProps {
  history: Deck[];
  selectedId: string | null;
  onSelect: (deck: Deck) => void;
  onViewFull?: (deckId: string) => void;
}

// Color dot component for compact display
function ColorDots({ colors }: { colors: string[] }) {
  const colorStyles: Record<string, string> = {
    W: 'bg-amber-100 border-amber-300',
    U: 'bg-blue-400 border-blue-500',
    B: 'bg-gray-700 border-gray-800',
    R: 'bg-red-500 border-red-600',
    G: 'bg-green-500 border-green-600',
  };

  return (
    <div className="flex -space-x-1">
      {colors.map((color, i) => (
        <div
          key={`${color}-${i}`}
          className={cn(
            'w-4 h-4 rounded-full border',
            colorStyles[color] || 'bg-gray-300 border-gray-400'
          )}
        />
      ))}
    </div>
  );
}

export function DeckHistory({ history, selectedId, onSelect, onViewFull }: DeckHistoryProps) {
  return (
    <div className="w-full md:w-64 flex-shrink-0 border-r border-stone-200 bg-stone-50 md:h-[calc(100vh-2.5rem)] overflow-y-auto">
      <div className="p-4 border-b border-stone-200 sticky top-0 bg-stone-50 z-10">
        <h2 className="text-sm font-semibold text-stone-900 uppercase tracking-wider flex items-center gap-2">
          <Clock className="w-4 h-4" /> History
        </h2>
        <p className="text-xs text-stone-400 mt-1">
          {history.length} deck{history.length !== 1 ? 's' : ''} generated
        </p>
      </div>
      <ul className="divide-y divide-stone-100">
        {history.map((deck) => (
          <li key={deck.id} className="group">
            <div
              className={cn(
                "w-full text-left transition-colors",
                selectedId === deck.id ? "bg-stone-100" : "hover:bg-stone-50"
              )}
            >
              {/* Main clickable area - larger touch target */}
              <button
                onClick={() => onSelect(deck)}
                className="w-full text-left p-4 pb-2 active:bg-stone-100"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className={cn(
                      "font-serif font-medium text-stone-800 truncate",
                      selectedId === deck.id ? "text-stone-900" : "group-hover:text-stone-900"
                    )}>
                      {deck.commander}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <ColorDots colors={deck.colors} />
                      <span className="text-xs text-stone-400">
                        {new Date(deck.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className={cn(
                    "w-4 h-4 text-stone-300 flex-shrink-0 mt-1 transition-colors",
                    selectedId === deck.id ? "text-stone-500" : "group-hover:text-stone-400"
                  )} />
                </div>
              </button>

              {/* Edit deck link - always visible on mobile, hover on desktop */}
              {onViewFull && (
                <div className="px-4 pb-3">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onViewFull(deck.id);
                    }}
                    className={cn(
                      "text-xs text-stone-500 hover:text-stone-700 active:text-stone-800",
                      "flex items-center gap-1 py-1 px-2 -ml-2 rounded",
                      "hover:bg-stone-100 active:bg-stone-200 transition-colors",
                      // Always visible on mobile, hover only on desktop
                      "md:opacity-0 md:group-hover:opacity-100"
                    )}
                  >
                    <ExternalLink className="w-3 h-3" /> Edit deck
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
        {history.length === 0 && (
          <li className="p-8 text-center">
            <div className="text-stone-400 text-sm">No decks generated yet.</div>
            <div className="text-stone-300 text-xs mt-2">
              Generate a deck to see it here
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
