import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Deck } from '../types';
import { DeckDisplay } from '../components/DeckDisplay';
import { DeckVisualView } from '../components/DeckVisualView';
import { LiveRibbon } from '../components/LiveRibbon';
import { Grid3X3, List, Swords, RefreshCw, Lock } from 'lucide-react';

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

function countDeckLines(lines: string[] = []): number {
  return lines.reduce((total, line) => {
    const match = line.match(/^(\d+)x\s+/);
    return total + (match ? Number(match[1]) : line === 'Sideboard' ? 0 : 1);
  }, 0);
}

export function DeckViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('visual');
  const [lockedCards, setLockedCards] = useState<Set<string>>(new Set());
  const [regenerationsRemaining, setRegenerationsRemaining] = useState(5);
  const [newCards, setNewCards] = useState<Set<string>>(new Set());
  const [coreStaples, setCoreStaples] = useState<Set<string>>(new Set());
  const [useCheckboxFallback, setUseCheckboxFallback] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);

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

  const handleRegenerate = async () => {
    if (!deck || regenerationsRemaining <= 0) return;

    setIsRegenerating(true);
    setRegenerationError(null);

    try {
      const response = await fetch('/api/regenerate-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deck_id: deck.id,
          kept_card_names: Array.from(lockedCards),
          regeneration_number: 6 - regenerationsRemaining,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to regenerate deck');
      }

      const newDeck = await response.json();
      setDeck(newDeck);
      setNewCards(new Set(newDeck.new_card_names || []));
      setCoreStaples(new Set(newDeck.core_staples || []));
      setRegenerationsRemaining(newDeck.regenerations_remaining);

      // Clear new card highlights after 10 seconds
      setTimeout(() => setNewCards(new Set()), 10000);
    } catch (err) {
      setRegenerationError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleCardLockToggle = (cardName: string) => {
    if (coreStaples.has(cardName)) return;

    setLockedCards(prev => {
      const next = new Set(prev);
      if (next.has(cardName)) {
        next.delete(cardName);
      } else {
        next.add(cardName);
      }
      return next;
    });
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
                      {deck.format === 'standard'
                        ? deck.bracket_name || 'Standard'
                        : `Bracket ${deck.bracket}: ${deck.bracket_name}`
                      }
                    </span>
                    {deck.theme && (
                      <>
                        <span className="text-sm text-stone-500">|</span>
                        <span className="text-sm text-stone-600">Theme: {deck.theme}</span>
                      </>
                    )}
                  </div>
                  <div className="text-sm text-stone-500 mt-1">
                    {deck.card_count} cards
                    {deck.format === 'standard' && deck.sideboard?.length
                      ? ` | Sideboard ${countDeckLines(deck.sideboard)}`
                      : ''
                    } | {deck.estimated_price}
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
                    to="/play"
                    className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium flex items-center gap-2"
                  >
                    <Swords className="w-4 h-4" />
                    Play This Deck
                  </Link>
                  {/* Regeneration Controls */}
                  {deck.format !== 'standard' && (
                  <div className="flex items-center gap-2 border-l border-stone-300 pl-2">
                    <span className="text-xs text-stone-500 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      {lockedCards.size} locked
                    </span>
                    <button
                      onClick={handleRegenerate}
                      disabled={regenerationsRemaining <= 0 || isRegenerating}
                      className={`px-3 py-2 text-sm font-medium rounded transition-colors flex items-center gap-1.5 ${
                        regenerationsRemaining > 0 && !isRegenerating
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-stone-300 text-stone-500 cursor-not-allowed'
                      }`}
                    >
                      <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                      {isRegenerating ? 'Regenerating...' : `Regenerate (${regenerationsRemaining})`}
                    </button>
                    <button
                      onClick={() => setUseCheckboxFallback(!useCheckboxFallback)}
                      className="text-xs text-stone-400 hover:text-stone-600 underline"
                    >
                      {useCheckboxFallback ? 'Click mode' : 'Checkboxes'}
                    </button>
                  </div>
                  )}
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

          {/* Regeneration Error */}
          {deck.format !== 'standard' && regenerationError && (
            <div className="bg-red-50 border-b border-red-200 px-4 py-2">
              <div className="max-w-6xl mx-auto text-sm text-red-600">
                Regeneration failed: {regenerationError}
              </div>
            </div>
          )}

          {/* Deck Content */}
          <div className="flex-1 max-w-6xl mx-auto w-full overflow-y-auto">
            {viewMode === 'visual' ? (
              <DeckVisualView
                deck={deck}
                selectionMode={deck.format !== 'standard'}
                lockedCards={lockedCards}
                newCards={newCards}
                coreStaples={coreStaples}
                onCardLockToggle={handleCardLockToggle}
                useCheckboxFallback={useCheckboxFallback}
              />
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

        </main>
      </div>

    </div>
  );
}
