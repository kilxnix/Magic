import { useState } from 'react';
import { DeckOptimizeResponse, SwapSuggestion, Deck } from '../types';
import { cn } from '../lib/utils';
import { ArrowRight, DollarSign, Loader2, TrendingDown, ExternalLink, Check } from 'lucide-react';

interface DeckOptimizerProps {
  deck?: Deck;
  onApplySwap?: (originalCard: string, newCard: string) => void;
}

async function optimizeDeck(
  cards: string[],
  targetSavings?: number,
  maxSwaps?: number,
  colorIdentity?: string[],
): Promise<DeckOptimizeResponse> {
  const res = await fetch('/api/deck/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cards,
      target_savings: targetSavings,
      max_swaps: maxSwaps,
      color_identity: colorIdentity,
    }),
  });
  if (!res.ok) {
    throw new Error('Failed to optimize deck');
  }
  return res.json();
}

function parseCardName(line: string): string {
  // Parse formats like "1x Sol Ring" or "1 Sol Ring" or "Sol Ring"
  const match = line.match(/^(?:\d+x?\s+)?(.+?)(?:\s*\*CMDR\*)?$/i);
  return match ? match[1].trim() : line.trim();
}

function SwapCard({
  suggestion,
  onApply,
  applied,
}: {
  suggestion: SwapSuggestion;
  onApply?: () => void;
  applied: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'border rounded-lg transition-all',
        applied
          ? 'border-green-700 bg-green-950/40'
          : 'border-stone-700 bg-stone-900 hover:shadow-md'
      )}
    >
      <div className="p-4">
        <div className="flex items-center gap-3">
          {/* Original card */}
          <div className="flex-1">
            <div className="text-sm font-medium text-stone-100">{suggestion.original_card}</div>
            <div className="text-xs text-stone-400">
              ${suggestion.original_price.toFixed(2)}
            </div>
          </div>

          <ArrowRight className="w-4 h-4 text-stone-500 shrink-0" />

          {/* Alternative card */}
          <div className="flex-1">
            <div className="text-sm font-medium text-stone-100">
              {suggestion.alternative.name}
            </div>
            <div className="text-xs text-stone-400">
              ${suggestion.alternative.price_usd?.toFixed(2) || '0.00'}
            </div>
          </div>

          {/* Savings */}
          <div className="text-right shrink-0">
            <div className="text-lg font-semibold text-green-400">
              -${suggestion.savings.toFixed(2)}
            </div>
            <div className="text-xs text-stone-400">savings</div>
          </div>
        </div>

        <p className="mt-3 text-sm text-stone-300 italic">
          {suggestion.alternative.tradeoff_explanation}
        </p>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {suggestion.alternative.functional_tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-xs bg-stone-700 text-stone-300 px-2 py-0.5 rounded-full"
            >
              {tag}
            </span>
          ))}

          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto text-xs text-stone-400 hover:text-stone-200"
          >
            {expanded ? 'Less' : 'More'}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-stone-700 space-y-2">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-stone-400">Type: </span>
                <span className="text-stone-200">{suggestion.alternative.type_line}</span>
              </div>
              <div>
                <span className="text-stone-400">Mana: </span>
                <span className="text-stone-200">{suggestion.alternative.mana_cost || 'N/A'}</span>
              </div>
              <div>
                <span className="text-stone-400">CMC: </span>
                <span className="text-stone-200">{suggestion.alternative.cmc}</span>
              </div>
              <div>
                <span className="text-stone-400">Match: </span>
                <span className="text-stone-200">
                  {(suggestion.alternative.final_score * 100).toFixed(0)}%
                </span>
              </div>
            </div>

            <p className="text-xs text-stone-300 line-clamp-2">
              {suggestion.alternative.oracle_text}
            </p>

            <div className="flex gap-2">
              {Object.entries(suggestion.alternative.purchase_links).map(([vendor, url]) => (
                url && (
                  <a
                    key={vendor}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                  >
                    {vendor} <ExternalLink className="w-3 h-3" />
                  </a>
                )
              ))}
            </div>
          </div>
        )}
      </div>

      {onApply && !applied && (
        <div className="border-t border-stone-700 p-2">
          <button
            onClick={onApply}
            className="w-full px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
          >
            Apply this swap
          </button>
        </div>
      )}

      {applied && (
        <div className="border-t border-green-800 p-2 flex items-center justify-center gap-2 text-green-400 text-xs">
          <Check className="w-4 h-4" />
          Swap applied
        </div>
      )}
    </div>
  );
}

export function DeckOptimizer({ deck, onApplySwap }: DeckOptimizerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<DeckOptimizeResponse | null>(null);
  const [targetSavings, setTargetSavings] = useState<string>('');
  const [maxSwaps, setMaxSwaps] = useState<string>('10');
  const [appliedSwaps, setAppliedSwaps] = useState<Set<string>>(new Set());
  const [manualCards, setManualCards] = useState<string>('');

  const handleOptimize = async () => {
    setLoading(true);
    setError(null);

    try {
      let cardNames: string[];
      let colors: string[] | undefined;

      if (deck) {
        cardNames = deck.list.map(parseCardName);
        colors = deck.colors;
      } else if (manualCards.trim()) {
        cardNames = manualCards
          .split('\n')
          .map((line) => parseCardName(line))
          .filter((name) => name.length > 0);
      } else {
        setError('Please provide a deck or paste card names');
        setLoading(false);
        return;
      }

      const data = await optimizeDeck(
        cardNames,
        targetSavings ? parseFloat(targetSavings) : undefined,
        maxSwaps ? parseInt(maxSwaps) : 10,
        colors,
      );
      setResponse(data);
      setAppliedSwaps(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to optimize deck');
    } finally {
      setLoading(false);
    }
  };

  const handleApplySwap = (original: string, newCard: string) => {
    setAppliedSwaps((prev) => new Set([...prev, original]));
    onApplySwap?.(original, newCard);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-green-400" />
          <h3 className="text-lg font-medium text-stone-100">Deck Optimizer</h3>
        </div>
        <p className="text-sm text-stone-300">
          Find cheaper alternatives for expensive cards in your deck.
        </p>
      </div>

      {!deck && (
        <div>
          <label className="block text-sm font-medium text-stone-200 mb-1">
            Paste your deck list (one card per line)
          </label>
          <textarea
            value={manualCards}
            onChange={(e) => setManualCards(e.target.value)}
            placeholder="1x Sol Ring&#10;1x Mana Crypt&#10;1x Cyclonic Rift&#10;..."
            className="w-full h-40 px-3 py-2 text-sm font-mono bg-stone-900 text-stone-100 placeholder-stone-500 border border-stone-600 rounded-lg focus:ring-1 focus:ring-amber-500 focus:border-amber-500 resize-none"
          />
        </div>
      )}

      {deck && (
        <div className="p-4 bg-stone-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-stone-100">{deck.commander}</div>
              <div className="text-sm text-stone-400">
                {deck.card_count} cards | {deck.estimated_price}
              </div>
            </div>
            <div className="flex gap-1">
              {deck.colors.map((color) => (
                <span
                  key={color}
                  className="w-6 h-6 rounded-full bg-stone-700 text-stone-200 text-xs flex items-center justify-center font-medium"
                >
                  {color}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex items-end gap-4 flex-wrap">
        <div className="w-40">
          <label className="block text-xs text-stone-400 mb-1">Target Savings</label>
          <div className="relative">
            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
            <input
              type="number"
              value={targetSavings}
              onChange={(e) => setTargetSavings(e.target.value)}
              placeholder="Any"
              className="w-full pl-7 pr-2 py-2 text-sm bg-stone-900 text-stone-100 placeholder-stone-500 border border-stone-600 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>
        </div>

        <div className="w-32">
          <label className="block text-xs text-stone-400 mb-1">Max Swaps</label>
          <input
            type="number"
            value={maxSwaps}
            onChange={(e) => setMaxSwaps(e.target.value)}
            min="1"
            max="20"
            className="w-full px-3 py-2 text-sm bg-stone-900 text-stone-100 placeholder-stone-500 border border-stone-600 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
          />
        </div>

        <button
          onClick={handleOptimize}
          disabled={loading}
          className={cn(
            'px-6 py-2 text-sm font-medium rounded transition-colors',
            loading
              ? 'bg-stone-700 text-stone-500 cursor-not-allowed'
              : 'bg-green-600 text-white hover:bg-green-700'
          )}
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Analyzing...
            </span>
          ) : (
            'Optimize Deck'
          )}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      {response && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 bg-green-950/40 border border-green-800 rounded-lg">
            <div>
              <div className="text-sm text-green-300">
                Found {response.swap_count} potential swap{response.swap_count !== 1 ? 's' : ''}
              </div>
              <div className="text-2xl font-bold text-green-400">
                Save up to ${response.total_savings.toFixed(2)}
              </div>
            </div>
            <TrendingDown className="w-8 h-8 text-green-400" />
          </div>

          {response.suggestions.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              No optimization opportunities found. Your deck is already budget-friendly!
            </div>
          ) : (
            <div className="grid gap-3">
              {response.suggestions.map((suggestion) => (
                <SwapCard
                  key={suggestion.original_card}
                  suggestion={suggestion}
                  onApply={
                    onApplySwap
                      ? () => handleApplySwap(suggestion.original_card, suggestion.alternative.name)
                      : undefined
                  }
                  applied={appliedSwaps.has(suggestion.original_card)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
