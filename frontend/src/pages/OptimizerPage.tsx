import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CardAlternatives } from '../components/CardAlternatives';
import { DeckOptimizer } from '../components/DeckOptimizer';
import { Search, TrendingDown, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';

type TabType = 'alternatives' | 'optimizer';

export function OptimizerPage() {
  const [searchParams] = useSearchParams();
  const initialCard = searchParams.get('card') || '';

  const [activeTab, setActiveTab] = useState<TabType>('alternatives');
  const [cardName, setCardName] = useState(initialCard);
  const [searchedCard, setSearchedCard] = useState(initialCard);

  // Auto-search if card is provided in URL
  useEffect(() => {
    if (initialCard) {
      setCardName(initialCard);
      setSearchedCard(initialCard);
    }
  }, [initialCard]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (cardName.trim()) {
      setSearchedCard(cardName.trim());
    }
  };

  return (
    <div className="min-h-screen bg-stone-100">
      {/* Header */}
      <header className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                to="/"
                className="flex items-center gap-2 text-stone-600 hover:text-stone-900 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </Link>
              <h1 className="text-xl font-serif text-stone-900">Card Optimizer</h1>
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab('alternatives')}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'alternatives'
                  ? 'border-stone-900 text-stone-900'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              )}
            >
              <Search className="w-4 h-4" />
              Find Alternatives
            </button>
            <button
              onClick={() => setActiveTab('optimizer')}
              className={cn(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === 'optimizer'
                  ? 'border-stone-900 text-stone-900'
                  : 'border-transparent text-stone-500 hover:text-stone-700'
              )}
            >
              <TrendingDown className="w-4 h-4" />
              Optimize Deck
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {activeTab === 'alternatives' && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="text-lg font-medium text-stone-900 mb-2">Find Cheaper Alternatives</h2>
              <p className="text-sm text-stone-600 mb-4">
                Enter a card name to find cheaper alternatives with similar effects.
                Uses ensemble ranking (FAISS + GPT2 + Qwen + functional tags).
              </p>

              <form onSubmit={handleSearch} className="flex gap-3">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
                  <input
                    type="text"
                    value={cardName}
                    onChange={(e) => setCardName(e.target.value)}
                    placeholder="Enter card name (e.g., Swords to Plowshares)"
                    className="w-full pl-10 pr-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400"
                  />
                </div>
                <button
                  type="submit"
                  className="px-6 py-2 bg-stone-900 text-white font-medium rounded-lg hover:bg-stone-800 transition-colors"
                >
                  Search
                </button>
              </form>
            </div>

            {searchedCard && (
              <div className="bg-white rounded-lg shadow-sm p-6">
                <CardAlternatives cardName={searchedCard} />
              </div>
            )}
          </div>
        )}

        {activeTab === 'optimizer' && (
          <div className="bg-white rounded-lg shadow-sm p-6">
            <DeckOptimizer />
          </div>
        )}
      </main>
    </div>
  );
}
