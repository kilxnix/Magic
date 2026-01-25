import { useState, useMemo } from 'react';
import { Deck } from '../types';
import { Copy, Check } from 'lucide-react';
import { cn } from '../lib/utils';

interface DeckDisplayProps {
  deck: Deck | null;
}

type CopyFormat = 'Plain' | 'Moxfield' | 'Archidekt' | 'MTGO';

// Category display order
const CATEGORY_ORDER = [
  'Commander',
  'Creatures',
  'Instants',
  'Sorceries',
  'Artifacts',
  'Enchantments',
  'Planeswalkers',
  'Lands',
  'Other'
];

export function DeckDisplay({ deck }: DeckDisplayProps) {
  const [format, setFormat] = useState<CopyFormat>('Plain');
  const [copied, setCopied] = useState(false);

  // Categorize cards logic (similar to DeckVisualView)
  const categorizedCards = useMemo(() => {
    if (!deck) return {};

    const categories: Record<string, string[]> = {
      'Commander': [],
      'Creatures': [],
      'Instants': [],
      'Sorceries': [],
      'Artifacts': [],
      'Enchantments': [],
      'Planeswalkers': [],
      'Lands': [],
      'Other': [],
    };

    // If deck has categories from backend, use those
    if (deck.categories && typeof deck.categories === 'object') {
      const categoryMap: Record<string, string> = {
        'commander': 'Commander',
        'creatures': 'Creatures',
        'instants': 'Instants',
        'sorceries': 'Sorceries',
        'artifacts': 'Artifacts',
        'enchantments': 'Enchantments',
        'planeswalkers': 'Planeswalkers',
        'lands': 'Lands',
        'other': 'Other',
      };

      for (const [backendCat, cards] of Object.entries(deck.categories)) {
        if (Array.isArray(cards)) {
          const targetCat = categoryMap[backendCat.toLowerCase()] || 'Other';
          if (categories[targetCat]) {
            categories[targetCat].push(...cards);
          } else {
            categories['Other'].push(...cards);
          }
        }
      }
    }

    // Fallback if empty
    const hasCategories = Object.values(categories).some(arr => arr.length > 0);
    if (!hasCategories && deck.list) {
      for (const card of deck.list) {
        if (card.includes('*CMDR*')) {
          categories['Commander'].push(card.replace(' *CMDR*', ''));
        } else if (card.toLowerCase().includes('land') || 
                   ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].some(l => card.includes(l))) {
          categories['Lands'].push(card);
        } else {
          categories['Other'].push(card);
        }
      }
    }

    return categories;
  }, [deck]);

  if (!deck) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-400 italic p-10">
        Select a deck from history or generate a new one.
      </div>
    );
  }

  const handleCopy = () => {
    const textToCopy = deck.list.join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const formattedList = deck.list.join('\n');

  return (
    <div className="flex-1 overflow-y-auto bg-white p-6 md:p-12 animate-in fade-in duration-500">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Header Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-stone-200 pb-6">
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500">Commander</div>
            <div className="text-sm font-medium text-stone-900 truncate" title={deck.commander}>{deck.commander}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500">Card Count</div>
            <div className="text-xl font-medium text-stone-900">{deck.card_count}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500">Est. Price</div>
            <div className="text-xl font-medium text-stone-900">{deck.estimated_price}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500">Colors</div>
            <div className="text-xl font-medium text-stone-900">{deck.colors.join('')}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-widest text-stone-500">Power Level</div>
            <div className="text-sm font-medium text-stone-900">
              Bracket {deck.bracket}: {deck.bracket_name}
            </div>
          </div>
        </div>

        {/* Structured List View */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {CATEGORY_ORDER.map(cat => {
            const cards = categorizedCards[cat];
            if (!cards || cards.length === 0) return null;

            return (
              <div key={cat} className="space-y-2">
                <h3 className="text-sm font-bold text-stone-400 uppercase tracking-wider border-b border-stone-100 pb-1">
                  {cat} ({cards.length})
                </h3>
                <ul className="space-y-1">
                  {cards.sort().map((card, idx) => (
                    <li key={idx} className="text-sm text-stone-700 flex justify-between items-center group hover:bg-stone-50 px-1 rounded">
                      <span>1 {card.replace(' *CMDR*', '')}</span>
                      <a 
                        href={`https://scryfall.com/search?q=!"${encodeURIComponent(card.replace(' *CMDR*', ''))}"}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="opacity-0 group-hover:opacity-100 text-stone-400 hover:text-stone-600 text-xs transition-opacity"
                      >
                        view
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* Export / Copy Controls */}
        <div className="pt-8 border-t-2 border-stone-100 mt-12">
          <h3 className="text-lg font-medium text-stone-900 mb-4">Export Deck List</h3>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex gap-1 bg-stone-100 p-1 rounded-lg">
                {(['Plain', 'Moxfield', 'Archidekt', 'MTGO'] as CopyFormat[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={cn(
                      "px-3 py-1 text-xs font-medium rounded-md transition-all",
                      format === f 
                        ? "bg-white text-stone-900 shadow-sm" 
                        : "text-stone-500 hover:text-stone-900"
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <button 
                onClick={handleCopy}
                className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-white text-sm font-medium rounded hover:bg-stone-700 transition-colors"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy List'}
              </button>
            </div>

            <div className="relative">
              <textarea 
                readOnly
                value={formattedList}
                className="w-full h-48 p-4 font-mono text-xs bg-stone-50 border border-stone-200 rounded focus:outline-none focus:ring-1 focus:ring-stone-400 resize-none text-stone-700 leading-relaxed"
              />
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
