import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Deck, Commander, Bracket, DeckRequest } from '../types';
import { DeckHistory } from '../components/DeckHistory';
import { DeckVisualView } from '../components/DeckVisualView';
import { LiveRibbon } from '../components/LiveRibbon';
import { AdPlaceholder } from '../components/AdPlaceholder';
import { Menu, X, TrendingDown, RefreshCw, Lock, Brain, ChevronDown, ChevronUp } from 'lucide-react';

// API functions
async function fetchCommanders(query: string = ''): Promise<Commander[]> {
  const url = query
    ? `/api/commanders?query=${encodeURIComponent(query)}&limit=20`
    : '/api/commanders?limit=20';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch commanders');
  return res.json();
}

async function fetchBrackets(): Promise<Bracket[]> {
  const res = await fetch('/api/brackets');
  if (!res.ok) throw new Error('Failed to fetch brackets');
  return res.json();
}

async function generateDeck(request: DeckRequest): Promise<Deck> {
  const res = await fetch('/api/generate-deck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || 'Failed to generate deck');
  }
  return res.json();
}

// localStorage helpers
const HISTORY_KEY = 'mtg_deck_history';

function loadHistory(): string[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      return parsed.deckIds || [];
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
  return [];
}

function saveHistory(deckIds: string[]) {
  const data = {
    deckIds: deckIds.slice(0, 50),
    lastUpdated: new Date().toISOString(),
  };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
}

async function hydrateHistory(deckIds: string[]): Promise<Deck[]> {
  if (deckIds.length === 0) return [];
  try {
    const res = await fetch('/api/decks/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: deckIds }),
    });
    if (!res.ok) return [];
    return res.json();
  } catch (e) {
    console.error('Failed to hydrate history:', e);
    return [];
  }
}

// Budget tier options
const BUDGET_TIERS = [
  { value: '', label: 'Any budget' },
  { value: 'budget', label: 'Budget (< $1 per card)' },
  { value: 'affordable', label: 'Affordable ($1-5 per card)' },
  { value: 'moderate', label: 'Moderate ($5-20 per card)' },
  { value: 'premium', label: 'Premium ($20-50 per card)' },
  { value: 'high_end', label: 'High-End (> $50 per card)' },
];

export function GeneratorPage() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Form state
  const [commanderSearch, setCommanderSearch] = useState('');
  const [commanders, setCommanders] = useState<Commander[]>([]);
  const [selectedCommander, setSelectedCommander] = useState<Commander | null>(null);
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [selectedBracket, setSelectedBracket] = useState(2);
  const [theme, setTheme] = useState('');
  const [budgetTier, setBudgetTier] = useState('');
  const [useAI, setUseAI] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [showAiReasoning, setShowAiReasoning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommanderDropdown, setShowCommanderDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Regeneration state
  const [lockedCards, setLockedCards] = useState<Set<string>>(new Set());
  const [regenerationsRemaining, setRegenerationsRemaining] = useState(5);
  const [newCards, setNewCards] = useState<Set<string>>(new Set());
  const [coreStaples, setCoreStaples] = useState<Set<string>>(new Set());
  const [useCheckboxFallback, setUseCheckboxFallback] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerationError, setRegenerationError] = useState<string | null>(null);

  // Load history from localStorage on mount
  useEffect(() => {
    const deckIds = loadHistory();
    if (deckIds.length > 0) {
      hydrateHistory(deckIds).then(setHistory);
    }
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCommanderDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load brackets on mount
  useEffect(() => {
    fetchBrackets()
      .then(setBrackets)
      .catch(err => console.error('Failed to load brackets:', err));
  }, []);

  // Search commanders when query changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (commanderSearch.length >= 1) {
        fetchCommanders(commanderSearch)
          .then((results) => {
            setCommanders(results);
            setShowCommanderDropdown(true);
          })
          .catch(err => console.error('Failed to search commanders:', err));
      } else {
        setCommanders([]);
        setShowCommanderDropdown(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [commanderSearch]);

  const handleGenerate = async () => {
    if (!selectedCommander) {
      setError('Please select a commander');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const deck = await generateDeck({
        commander: selectedCommander.name,
        bracket: selectedBracket,
        theme: theme || undefined,
        budget_tier: budgetTier || undefined,
        use_ai: useAI || undefined,
      });

      setHistory(prev => {
        const newHistory = [deck, ...prev.filter(d => d.id !== deck.id)];
        saveHistory(newHistory.map(d => d.id));
        return newHistory;
      });
      setSelectedDeckId(deck.id);

      // Reset regeneration state for new deck
      setLockedCards(new Set());
      setRegenerationsRemaining(5);
      setNewCards(new Set());
      setCoreStaples(new Set());
      setRegenerationError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate deck');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!selectedDeck || regenerationsRemaining <= 0) return;

    setIsRegenerating(true);
    setRegenerationError(null);

    try {
      const response = await fetch('/api/regenerate-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deck_id: selectedDeck.id,
          kept_card_names: Array.from(lockedCards),
          regeneration_number: 6 - regenerationsRemaining,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to regenerate deck');
      }

      const newDeck = await response.json();

      // Update deck in history
      setHistory(prev => {
        const newHistory = prev.map(d => d.id === newDeck.id ? newDeck : d);
        return newHistory;
      });

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

  const handleCommanderSelect = (commander: Commander) => {
    setSelectedCommander(commander);
    setCommanderSearch(commander.name);
    setShowCommanderDropdown(false);
  };

  const handleViewDeck = (deckId: string) => {
    navigate(`/deck/${deckId}`);
  };

  const handleSelectDeck = (deck: Deck) => {
    setSelectedDeckId(deck.id);
    // Reset regeneration state when switching decks
    setLockedCards(new Set());
    setRegenerationsRemaining(5);
    setNewCards(new Set());
    setCoreStaples(new Set());
    setRegenerationError(null);
  };

  const selectedDeck = history.find(d => d.id === selectedDeckId) || null;

  const colorSymbols: Record<string, string> = {
    W: 'text-amber-100 bg-amber-50',
    U: 'text-blue-500 bg-blue-100',
    B: 'text-gray-800 bg-gray-200',
    R: 'text-red-500 bg-red-100',
    G: 'text-green-600 bg-green-100',
  };

  return (
    <div className="flex flex-col min-h-screen bg-stone-50 text-stone-900 font-sans">
      {/* Marquee Ticker */}
      <LiveRibbon />

      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-3 border-b border-stone-200 bg-white">
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 text-stone-600 hover:text-stone-900"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <span className="font-serif text-stone-800">MTG Deck Generator</span>
        <div className="w-9" />
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - History (Desktop) */}
        <aside className="hidden md:block flex-shrink-0">
          <DeckHistory
            history={history}
            selectedId={selectedDeckId}
            onSelect={handleSelectDeck}
            onViewFull={handleViewDeck}
          />
        </aside>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <div
              className="fixed inset-0 bg-black/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <aside className="relative w-64 bg-white shadow-xl overflow-y-auto">
              <DeckHistory
                history={history}
                selectedId={selectedDeckId}
                onSelect={(deck) => {
                  handleSelectDeck(deck);
                  setMobileMenuOpen(false);
                }}
                onViewFull={(id) => {
                  handleViewDeck(id);
                  setMobileMenuOpen(false);
                }}
              />
            </aside>
          </div>
        )}

        {/* Center Content */}
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
          {!selectedDeck ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-stone-100">
              <div className="w-full max-w-md space-y-6">
                <div className="text-center space-y-2">
                  <h2 className="text-2xl font-serif text-stone-800">Commander Deck Generator</h2>
                  <p className="text-stone-500">Build decks following Command Zone rules</p>
                </div>

                {/* Commander Search */}
                <div className="relative" ref={dropdownRef}>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Commander
                  </label>
                  <input
                    type="text"
                    value={commanderSearch}
                    onChange={(e) => {
                      setCommanderSearch(e.target.value);
                      if (!e.target.value) setSelectedCommander(null);
                    }}
                    onFocus={() => commanderSearch.length >= 1 && setShowCommanderDropdown(true)}
                    placeholder="Start typing to search..."
                    className="w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-stone-500 focus:border-stone-500"
                  />
                  {showCommanderDropdown && commanders.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-stone-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                      {commanders.map((c) => (
                        <button
                          key={c.name}
                          onClick={() => handleCommanderSelect(c)}
                          className="w-full px-3 py-2 text-left hover:bg-stone-100 flex items-center gap-2"
                        >
                          <span className="flex gap-0.5">
                            {c.colors.map(color => (
                              <span
                                key={color}
                                className={`w-4 h-4 rounded-full text-xs flex items-center justify-center ${colorSymbols[color] || 'bg-gray-300'}`}
                              >
                                {color}
                              </span>
                            ))}
                          </span>
                          <span className="font-medium">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedCommander && (
                    <div className="mt-1 text-xs text-stone-500">
                      {selectedCommander.type_line}
                    </div>
                  )}
                </div>

                {/* Bracket Selection */}
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Power Level Bracket
                  </label>
                  <select
                    value={selectedBracket}
                    onChange={(e) => setSelectedBracket(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-stone-500 focus:border-stone-500"
                  >
                    {brackets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.id}. {b.name} (Power {b.power_level[0]}-{b.power_level[1]})
                      </option>
                    ))}
                  </select>
                  {brackets.find(b => b.id === selectedBracket) && (
                    <div className="mt-1 space-y-1">
                      <p className="text-xs text-stone-500">
                        {brackets.find(b => b.id === selectedBracket)?.description}
                      </p>
                      {brackets.find(b => b.id === selectedBracket)?.expected_turns && (
                        <p className="text-xs text-stone-600 font-medium">
                          Expected Game Length: ~{brackets.find(b => b.id === selectedBracket)?.expected_turns} turns
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Theme */}
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Theme / Strategy (optional)
                  </label>
                  <input
                    type="text"
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    placeholder="e.g., tokens, graveyard, +1/+1 counters..."
                    className="w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-stone-500 focus:border-stone-500"
                  />
                </div>

                {/* Budget Tier */}
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    Budget
                  </label>
                  <select
                    value={budgetTier}
                    onChange={(e) => setBudgetTier(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-stone-500 focus:border-stone-500"
                  >
                    {BUDGET_TIERS.map((tier) => (
                      <option key={tier.value} value={tier.value}>
                        {tier.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Shelector AI Toggle */}
                <div className="flex items-center gap-3 p-3 bg-violet-50 border border-violet-200 rounded-md">
                  <input
                    type="checkbox"
                    id="use-ai-toggle"
                    checked={useAI}
                    onChange={(e) => setUseAI(e.target.checked)}
                    className="w-4 h-4 text-violet-600 border-stone-300 rounded focus:ring-violet-500"
                  />
                  <label htmlFor="use-ai-toggle" className="flex items-center gap-2 text-sm text-stone-700 cursor-pointer select-none">
                    <Brain className="w-4 h-4 text-violet-500" />
                    <span>
                      <span className="font-medium">Use Shelector AI</span>
                      <span className="text-stone-500 ml-1">— LLM re-ranks cards for better synergy</span>
                    </span>
                  </label>
                </div>

                {/* Error */}
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                    {error}
                  </div>
                )}

                {/* Generate Button */}
                <button
                  onClick={handleGenerate}
                  disabled={loading || !selectedCommander}
                  className={`w-full px-6 py-3 text-sm font-medium rounded shadow-sm transition-colors
                    ${loading || !selectedCommander
                      ? 'bg-stone-400 text-stone-200 cursor-not-allowed'
                      : 'bg-stone-900 text-stone-50 hover:bg-stone-800'
                    }`}
                >
                  {loading
                    ? (useAI ? 'Shelector is thinking...' : 'Generating...')
                    : (useAI ? 'Generate with AI' : 'Generate Deck')
                  }
                </button>

                {/* Rules Info */}
                <div className="text-xs text-stone-400 space-y-1">
                  <p>Decks are built following Command Zone rules:</p>
                  <ul className="list-disc list-inside pl-2">
                    <li>Max 34 lands</li>
                    <li>10+ ramp cards</li>
                    <li>10+ card draw</li>
                    <li>8+ removal spells</li>
                    <li>2+ wincons</li>
                  </ul>
                </div>

                {/* Card Optimizer Link */}
                <Link
                  to="/optimizer"
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 text-sm font-medium text-stone-600 bg-stone-100 rounded hover:bg-stone-200 transition-colors"
                >
                  <TrendingDown className="w-4 h-4" />
                  Find Cheaper Card Alternatives
                </Link>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 p-4 border-b border-stone-200 bg-white">
                <div className="text-sm text-stone-500">
                  {selectedDeck.bracket_name && (
                    <span className="font-medium">
                      Bracket {selectedDeck.bracket}: {selectedDeck.bracket_name}
                    </span>
                  )}
                  {selectedDeck.theme && (
                    <span className="ml-2">| Theme: {selectedDeck.theme}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* Regeneration Controls */}
                  <div className="flex items-center gap-2 pr-2 border-r border-stone-300">
                    <span className="text-xs text-stone-500 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      {lockedCards.size} locked
                    </span>
                    <button
                      onClick={handleRegenerate}
                      disabled={regenerationsRemaining <= 0 || isRegenerating}
                      className={`px-3 py-2 text-xs font-medium rounded transition-colors flex items-center gap-1.5 ${
                        regenerationsRemaining > 0 && !isRegenerating
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'bg-stone-300 text-stone-500 cursor-not-allowed'
                      }`}
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRegenerating ? 'animate-spin' : ''}`} />
                      {isRegenerating ? 'Regenerating...' : `Regenerate (${regenerationsRemaining})`}
                    </button>
                    <button
                      onClick={() => setUseCheckboxFallback(!useCheckboxFallback)}
                      className="text-xs text-stone-400 hover:text-stone-600 underline"
                    >
                      {useCheckboxFallback ? 'Click mode' : 'Checkboxes'}
                    </button>
                  </div>
                  <button
                    onClick={() => handleViewDeck(selectedDeck.id)}
                    className="px-3 py-2 bg-stone-700 text-stone-50 text-xs font-medium rounded hover:bg-stone-600 transition-colors"
                  >
                    Full View
                  </button>
                  <button
                    onClick={() => {
                      setSelectedDeckId(null);
                      setLockedCards(new Set());
                      setRegenerationsRemaining(5);
                      setNewCards(new Set());
                      setCoreStaples(new Set());
                    }}
                    className="px-3 py-2 bg-stone-900 text-stone-50 text-xs font-medium rounded hover:bg-stone-800 transition-colors"
                  >
                    Generate Another
                  </button>
                </div>
              </div>

              {/* Regeneration Error */}
              {regenerationError && (
                <div className="bg-red-50 border-b border-red-200 px-4 py-2">
                  <div className="text-sm text-red-600">
                    Regeneration failed: {regenerationError}
                  </div>
                </div>
              )}

              {/* Shelector AI Reasoning */}
              {selectedDeck.ai_enhanced && selectedDeck.ai_reasoning && (
                <div className="bg-violet-50 border-b border-violet-200 px-4 py-2">
                  <button
                    onClick={() => setShowAiReasoning(!showAiReasoning)}
                    className="flex items-center gap-2 text-sm text-violet-700 font-medium w-full"
                  >
                    <Brain className="w-4 h-4 text-violet-500" />
                    Shelector AI enhanced this deck
                    {showAiReasoning
                      ? <ChevronUp className="w-4 h-4 ml-auto" />
                      : <ChevronDown className="w-4 h-4 ml-auto" />
                    }
                  </button>
                  {showAiReasoning && (
                    <p className="mt-2 text-xs text-violet-600 whitespace-pre-wrap">
                      {selectedDeck.ai_reasoning}
                    </p>
                  )}
                </div>
              )}

              {/* Lock/Regenerate Tip */}
              <div className="bg-blue-50 border-b border-blue-100 px-4 py-2">
                <div className="text-xs text-blue-700">
                  <strong>Tip:</strong> Click cards to lock them, then hit Regenerate to replace the unlocked cards with new options.
                </div>
              </div>

              {/* Deck Visual View with Locking */}
              <div className="flex-1 overflow-y-auto">
                <DeckVisualView
                  deck={selectedDeck}
                  selectionMode={true}
                  lockedCards={lockedCards}
                  newCards={newCards}
                  coreStaples={coreStaples}
                  onCardLockToggle={handleCardLockToggle}
                  useCheckboxFallback={useCheckboxFallback}
                />
              </div>

              {/* Bottom Ad below deck display */}
              <div className="flex justify-center p-4 border-t border-stone-200 bg-stone-100">
                <AdPlaceholder size="leaderboard" className="hidden md:flex" />
                <AdPlaceholder size="sidebar" className="md:hidden" />
              </div>
            </div>
          )}
        </main>

        {/* Right Sidebar - Ad (Desktop only) */}
        <aside className="hidden lg:flex flex-col items-center gap-4 p-4 w-[332px] flex-shrink-0 border-l border-stone-200 bg-stone-50">
          <AdPlaceholder size="sidebar" />
          <div className="text-xs text-stone-400 text-center mt-2">
            Support the site
          </div>
        </aside>
      </div>

      {/* Mobile Bottom Ad */}
      {!selectedDeck && (
        <div className="md:hidden flex justify-center p-4 border-t border-stone-200 bg-stone-100">
          <AdPlaceholder size="sidebar" />
        </div>
      )}
    </div>
  );
}
