import { useState, useEffect } from 'react';
import { CardAlternative, AlternativesResponse } from '../types';
import { cn } from '../lib/utils';
import { Search, DollarSign, ExternalLink, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';

interface CardAlternativesProps {
  cardName: string;
  maxPrice?: number;
  colorIdentity?: string[];
  onSelectAlternative?: (alternative: CardAlternative) => void;
}

async function fetchAlternatives(
  cardName: string,
  maxPrice?: number,
  category?: string,
  colorIdentity?: string[],
): Promise<AlternativesResponse> {
  const params = new URLSearchParams();
  if (maxPrice !== undefined) params.set('max_price', maxPrice.toString());
  if (category) params.set('category', category);
  if (colorIdentity?.length) params.set('color_identity', colorIdentity.join(','));
  params.set('top_k', '5');
  params.set('use_models', 'true');

  const url = `/api/card/${encodeURIComponent(cardName)}/alternatives?${params}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch alternatives');
  }
  return res.json();
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'Any category' },
  { value: 'removal', label: 'Removal' },
  { value: 'ramp', label: 'Ramp' },
  { value: 'card-draw', label: 'Card Draw' },
  { value: 'tutor', label: 'Tutor' },
  { value: 'counter', label: 'Counter' },
  { value: 'board-wipe', label: 'Board Wipe' },
  { value: 'protection', label: 'Protection' },
  { value: 'recursion', label: 'Recursion' },
];

function ScoreBar({ score, label }: { score: number; label: string }) {
  const percentage = Math.min(score * 100, 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-stone-400">{label}</span>
      <div className="flex-1 h-1.5 bg-stone-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-500 rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-8 text-right text-stone-300">{(score * 100).toFixed(0)}%</span>
    </div>
  );
}

function AlternativeCard({
  alternative,
  onSelect,
}: {
  alternative: CardAlternative;
  onSelect?: (alt: CardAlternative) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-stone-700 rounded-lg bg-stone-900 shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="font-medium text-stone-100 truncate">{alternative.name}</h4>
              <span className="text-xs bg-stone-700 text-stone-300 px-1.5 py-0.5 rounded">
                {alternative.mana_cost || 'N/A'}
              </span>
            </div>
            <p className="text-xs text-stone-400 mt-0.5 truncate">{alternative.type_line}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-lg font-semibold text-green-400">
              ${alternative.price_usd?.toFixed(2) || '0.00'}
            </div>
            {alternative.price_savings > 0 && (
              <div className="text-xs text-green-400">
                Save ${alternative.price_savings.toFixed(2)}
              </div>
            )}
          </div>
        </div>

        <p className="mt-2 text-sm text-stone-200 italic">
          {alternative.tradeoff_explanation}
        </p>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {alternative.functional_tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="text-xs bg-stone-700 text-stone-300 px-2 py-0.5 rounded-full"
            >
              {tag}
            </span>
          ))}
          <span className="text-xs text-stone-500 ml-auto">
            Score: {(alternative.final_score * 100).toFixed(0)}%
          </span>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {expanded ? 'Less details' : 'More details'}
        </button>

        {expanded && (
          <div className="mt-3 pt-3 border-t border-stone-700 space-y-2">
            <ScoreBar score={alternative.faiss_score} label="Semantic" />
            <ScoreBar score={alternative.gpt2_score} label="GPT2" />
            <ScoreBar score={alternative.qwen_score} label="Qwen" />
            <ScoreBar score={alternative.category_score} label="Category" />

            <div className="pt-2 text-xs text-stone-300">
              <p className="line-clamp-3">{alternative.oracle_text}</p>
            </div>

            <div className="pt-2 flex gap-2">
              {Object.entries(alternative.purchase_links).map(([vendor, url]) => (
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

      {onSelect && (
        <div className="border-t border-stone-700 p-2">
          <button
            onClick={() => onSelect(alternative)}
            className="w-full px-3 py-1.5 text-xs font-medium text-stone-200 bg-stone-700 rounded hover:bg-stone-700 transition-colors"
          >
            Use this alternative
          </button>
        </div>
      )}
    </div>
  );
}

export function CardAlternatives({
  cardName,
  maxPrice,
  colorIdentity,
  onSelectAlternative,
}: CardAlternativesProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<AlternativesResponse | null>(null);
  const [category, setCategory] = useState('');
  const [priceLimit, setPriceLimit] = useState<string>(maxPrice?.toString() || '');

  const handleSearch = async () => {
    if (!cardName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const data = await fetchAlternatives(
        cardName,
        priceLimit ? parseFloat(priceLimit) : undefined,
        category || undefined,
        colorIdentity,
      );
      setResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch alternatives');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (cardName) {
      handleSearch();
    }
  }, [cardName]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <div className="text-sm font-medium text-stone-200 mb-1">Finding alternatives for:</div>
          <div className="flex items-center gap-2 px-3 py-2 bg-stone-700 rounded-lg">
            <Search className="w-4 h-4 text-stone-500" />
            <span className="font-medium text-stone-100">{cardName}</span>
            {response?.source_price && (
              <span className="ml-auto text-stone-300">
                ${response.source_price.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        <div className="w-32">
          <label className="block text-xs text-stone-400 mb-1">Max Price</label>
          <div className="relative">
            <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
            <input
              type="number"
              value={priceLimit}
              onChange={(e) => setPriceLimit(e.target.value)}
              placeholder="Any"
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-stone-900 text-stone-100 placeholder-stone-500 border border-stone-600 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
            />
          </div>
        </div>

        <div className="w-40">
          <label className="block text-xs text-stone-400 mb-1">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-stone-900 text-stone-100 border border-stone-600 rounded focus:ring-1 focus:ring-amber-500 focus:border-amber-500"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="self-end">
          <button
            onClick={handleSearch}
            disabled={loading}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded transition-colors',
              loading
                ? 'bg-stone-700 text-stone-500 cursor-not-allowed'
                : 'bg-amber-500 text-stone-950 hover:bg-amber-400'
            )}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Searching...
              </span>
            ) : (
              'Search'
            )}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-red-950/40 border border-red-800 rounded text-red-300 text-sm">
          {error}
        </div>
      )}

      {response && (
        <div className="space-y-3">
          {response.alternatives.length === 0 ? (
            <div className="text-center py-8 text-stone-400">
              No cheaper alternatives found for this card.
            </div>
          ) : (
            <>
              <div className="text-sm text-stone-300">
                Found {response.alternatives.length} alternative{response.alternatives.length !== 1 ? 's' : ''}
              </div>
              <div className="grid gap-3">
                {response.alternatives.map((alt) => (
                  <AlternativeCard
                    key={alt.name}
                    alternative={alt}
                    onSelect={onSelectAlternative}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
