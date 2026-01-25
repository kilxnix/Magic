import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Deck } from '../types';
import { DeckDisplay } from '../components/DeckDisplay';
import { DeckVisualView } from '../components/DeckVisualView';
import { LiveRibbon } from '../components/LiveRibbon';
import { AdPlaceholder } from '../components/AdPlaceholder';
import { Grid3X3, List } from 'lucide-react';

async function fetchDeck(id: string): Promise<Deck> {
  const res = await fetch(`/api/deck/${id}`);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Deck not found');
    }
    throw new Error('Failed to fetch deck');
  }
  return res.json();
}

type ViewMode = 'visual' | 'list';

export function DeckViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('visual');

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    fetchDeck(id)
      .then(setDeck)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Color symbols for display
  const colorSymbols: Record<string, string> = {
    W: 'bg-amber-50 text-amber-800',
    U: 'bg-blue-100 text-blue-800',
    B: 'bg-gray-200 text-gray-800',
    R: 'bg-red-100 text-red-800',
    G: 'bg-green-100 text-green-800',
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col bg-stone-50">
        <LiveRibbon />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-stone-500">Loading deck...</div>
        </div>
      </div>
    );
  }

  if (error || !deck) {
    return (
      <div className="min-h-screen flex flex-col bg-stone-50">
        <LiveRibbon />
        <div className="flex-1 flex flex-col items-center justify-center gap-4">
          <div className="text-red-600 text-lg">{error || 'Deck not found'}</div>
          <Link
            to="/"
            className="px-4 py-2 bg-stone-900 text-stone-50 text-sm rounded hover:bg-stone-800"
          >
            Back to Generator
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-stone-50 text-stone-900 font-sans">
      {/* Marquee Ticker */}
      <LiveRibbon />

      <div className="flex flex-1">
        {/* Main Content */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <header className="border-b border-stone-200 bg-white p-4">
            <div className="max-w-6xl mx-auto">
              <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                <div>
                  <h1 className="text-2xl font-serif text-stone-800">{deck.commander}</h1>
                  <div className="flex flex-wrap items-center gap-3 mt-2">
                    <div className="flex gap-1">
                      {deck.colors.map(color => (
                        <span
                          key={color}
                          className={`w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center ${colorSymbols[color] || 'bg-gray-300'}`}
                        >
                          {color}
                        </span>
                      ))}
                    </div>
                    <span className="text-sm text-stone-500">|</span>
                    <span className="text-sm text-stone-600">
                      Bracket {deck.bracket}: {deck.bracket_name}
                    </span>
                    {deck.theme && (
                      <>
                        <span className="text-sm text-stone-500">|</span>
                        <span className="text-sm text-stone-600">Theme: {deck.theme}</span>
                      </>
                    )}
                  </div>
                  <div className="text-sm text-stone-500 mt-1">
                    {deck.card_count} cards | {deck.estimated_price}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* View Toggle */}
                  <div className="flex rounded-lg border border-stone-300 overflow-hidden">
                    <button
                      onClick={() => setViewMode('visual')}
                      className={`px-3 py-2 flex items-center gap-1 text-sm ${
                        viewMode === 'visual'
                          ? 'bg-stone-800 text-white'
                          : 'bg-white text-stone-600 hover:bg-stone-100'
                      }`}
                      title="Card View"
                    >
                      <Grid3X3 className="w-4 h-4" />
                      <span className="hidden sm:inline">Cards</span>
                    </button>
                    <button
                      onClick={() => setViewMode('list')}
                      className={`px-3 py-2 flex items-center gap-1 text-sm ${
                        viewMode === 'list'
                          ? 'bg-stone-800 text-white'
                          : 'bg-white text-stone-600 hover:bg-stone-100'
                      }`}
                      title="List View"
                    >
                      <List className="w-4 h-4" />
                      <span className="hidden sm:inline">List</span>
                    </button>
                  </div>
                  <Link
                    to="/"
                    className="px-4 py-2 bg-stone-900 text-stone-50 text-sm font-medium rounded hover:bg-stone-800 transition-colors"
                  >
                    Generate New
                  </Link>
                </div>
              </div>
            </div>
          </header>

          {/* Deck Content */}
          <div className="flex-1 max-w-6xl mx-auto w-full overflow-y-auto">
            {viewMode === 'visual' ? (
              <DeckVisualView deck={deck} />
            ) : (
              <DeckDisplay deck={deck} />
            )}
          </div>

          {/* Share URL Bar */}
          <div className="border-t border-stone-200 bg-white p-4">
            <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <span className="text-sm text-stone-500 whitespace-nowrap">Share this deck:</span>
              <div className="flex-1 flex gap-2 w-full sm:w-auto">
                <code className="flex-1 bg-stone-100 px-3 py-2 rounded text-stone-700 text-xs overflow-x-auto">
                  {window.location.href}
                </code>
                <button
                  onClick={handleCopyLink}
                  className={`px-4 py-2 text-xs font-medium rounded transition-colors ${
                    copied
                      ? 'bg-green-600 text-white'
                      : 'bg-stone-700 text-white hover:bg-stone-600'
                  }`}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          </div>

          {/* Bottom Ad */}
          <div className="flex justify-center p-4 border-t border-stone-200 bg-stone-100">
            <AdPlaceholder size="leaderboard" className="hidden md:flex" />
            <AdPlaceholder size="sidebar" className="md:hidden" />
          </div>
        </main>

        {/* Right Sidebar - Ad (Desktop only) */}
        <aside className="hidden lg:flex flex-col items-center gap-4 p-4 w-[332px] flex-shrink-0 border-l border-stone-200 bg-stone-50">
          <AdPlaceholder size="sidebar" />
          <div className="text-xs text-stone-400 text-center mt-2">
            Support the site
          </div>
        </aside>
      </div>
    </div>
  );
}
