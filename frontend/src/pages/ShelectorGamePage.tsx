/**
 * ShelectorGamePage -- split-panel page for playing against the Shelector AI.
 *
 * Pre-game: Spawn opponent, import deck, start game.
 * In-game: Board (70% left) + Chat (30% right).
 * Mobile: Full-width board with slide-up chat panel toggle.
 */

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardPaste, Loader2, Swords, Zap, MessageSquare, History, ChevronDown, Trash2, Shuffle, Shield, Archive, BarChart3 } from 'lucide-react';
import { useShelectorGame } from '../hooks/useShelectorGame';
import type { SpawnOptions } from '../hooks/useShelectorGame';
import { GameBoard } from '../components/GameBoard';
import { GameChat } from '../components/GameChat';
import { GameReview } from '../components/GameReview';
import { EndGameModal } from '../components/shelector/EndGameModal';
import { cacheSet, cacheGet } from '../lib/cache';
import { shelectorApiUrl } from '../lib/api';

// Types for deck import response
interface DeckImportResult {
  commander: string | null;
  cards: string[];
  lands: string[];
  card_data: Record<string, any>;
  total: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  filled_cards: string[];
}

interface DeckHistoryEntry {
  commander: string;
  text: string;
  timestamp: number;
}

const DECK_HISTORY_MAX = 5;

// Map color letters to display
const COLOR_NAMES: Record<string, string> = {
  W: 'White',
  U: 'Blue',
  B: 'Black',
  R: 'Red',
  G: 'Green',
};

const COLOR_BADGES: Record<string, string> = {
  W: 'bg-amber-100 text-amber-800',
  U: 'bg-blue-100 text-blue-800',
  B: 'bg-gray-300 text-gray-900',
  R: 'bg-red-100 text-red-800',
  G: 'bg-green-100 text-green-800',
};

export function ShelectorGamePage() {
  const {
    gameState,
    legalActions,
    chatMessages,
    isLoading,
    isHumanTurn,
    isGameOver,
    winner,
    opponentInfo,
    error,
    mulliganPhase,
    mulliganCount,
    mulliganBottomCount,
    selectedMulliganCardIds,
    selectedMulliganBottomIds,
    discardPhase,
    discardCount,
    tutorPhase,
    tutorCards,
    tutorTitle,
    libraryChoice,
    gameLog,
    authorityUpdates,
    lastStateUpdate,
    currentPrompt,
    lastPlayedCard,
    spawnOpponent,
    startGame,
    submitAction,
    keepHand,
    mulligan,
    toggleMulliganCard,
    toggleMulliganBottomCard,
    discardCard,
    resolveTutor,
    cancelTutor,
    resolveLibraryChoice,
    undosRemaining,
    undoAction,
    coachMode,
    setCoachMode,
    newPlayerMode,
    setNewPlayerMode,
    holdPriority,
    setHoldPriority,
    untapManaSource,
    adjustCounters,
    untappableCardIds,
    endGame,
    closeEndGame,
    newGame,
    declareDraw,
    concedeGame,
    playItOut,
    reviewLog,
  } = useShelectorGame();

  // Deck import state
  const [deckText, setDeckText] = useState('');
  const [importResult, setImportResult] = useState<DeckImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [isGeneratingAIDeck, setIsGeneratingAIDeck] = useState(false);

  // Mobile chat toggle
  const [showMobileChat, setShowMobileChat] = useState(false);

  // Game review modal
  const [showReview, setShowReview] = useState(false);

  // Spawn mode state
  const [spawnMode, setSpawnMode] = useState<'random' | 'counter' | 'pool'>('random');
  const [spawnBracket, setSpawnBracket] = useState(3);
  const [colorFilter, setColorFilter] = useState<Record<string, boolean>>({
    W: false, U: false, B: false, R: false, G: false,
  });

  // Deck history state
  const [deckHistory, setDeckHistory] = useState<DeckHistoryEntry[]>([]);
  const [showDeckHistory, setShowDeckHistory] = useState(false);

  // Load saved deck data on mount
  useEffect(() => {
    const savedText = cacheGet<string>('last_deck_text');
    if (savedText) setDeckText(savedText);

    const savedResult = cacheGet<DeckImportResult>('last_deck_result');
    if (savedResult) setImportResult(savedResult);

    const savedHistory = cacheGet<DeckHistoryEntry[]>('deck_history');
    if (savedHistory) setDeckHistory(savedHistory);
  }, []);

  useEffect(() => {
    document.body.dataset.deckrepsPlaySurface = gameState ? 'active' : 'setup';
    window.dispatchEvent(new CustomEvent('deckreps-play-surface-change'));
    return () => {
      delete document.body.dataset.deckrepsPlaySurface;
      window.dispatchEvent(new CustomEvent('deckreps-play-surface-change'));
    };
  }, [gameState]);

  // Helper to add a deck to history
  const addToDeckHistory = (commander: string, text: string) => {
    setDeckHistory(prev => {
      // Remove existing entry for same commander to avoid duplicates
      const filtered = prev.filter(e => e.commander !== commander);
      const entry: DeckHistoryEntry = { commander, text, timestamp: Date.now() };
      const updated = [entry, ...filtered].slice(0, DECK_HISTORY_MAX);
      cacheSet('deck_history', updated, 30 * 24 * 60 * 60 * 1000); // 30 days TTL
      return updated;
    });
  };

  // Load a deck from history
  const loadFromHistory = (entry: DeckHistoryEntry) => {
    setDeckText(entry.text);
    setImportResult(null);
    setImportError(null);
    setShowDeckHistory(false);
    cacheSet('last_deck_text', entry.text, 30 * 24 * 60 * 60 * 1000);
  };

  // Remove a single entry from history
  const removeFromHistory = (commander: string) => {
    setDeckHistory(prev => {
      const updated = prev.filter(e => e.commander !== commander);
      cacheSet('deck_history', updated, 30 * 24 * 60 * 60 * 1000);
      return updated;
    });
  };

  const handleImportDeck = async () => {
    if (!deckText.trim()) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch(shelectorApiUrl('/import-deck'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: deckText,
          bracket: 3,
          fill_missing: true,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data: DeckImportResult = await res.json();
      setImportResult(data);

      // Persist deck text and import result
      cacheSet('last_deck_text', deckText, 30 * 24 * 60 * 60 * 1000);
      cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);

      // Add to deck history if we have a commander name
      if (data.commander) {
        addToDeckHistory(data.commander, deckText);
      }
    } catch (e: unknown) {
      setImportError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  // Pre-game screen
  if (!gameState) {
    return (
      <div className="flex flex-col h-screen bg-stone-900 text-stone-200">
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-stone-700 bg-stone-800">
          <Link
            to="/shelector"
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-200 hover:bg-stone-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex-1">
            <h1 className="font-serif text-lg font-semibold text-stone-100">
              Shelector Arena
            </h1>
            <p className="text-xs text-stone-500">
              Test your deck against the Shelector AI
            </p>
          </div>
        </header>

        {/* Pre-game content */}
        <div className="flex-1 flex items-center justify-center overflow-y-auto py-6">
          <div className="max-w-lg w-full px-4 sm:px-6">
            {/* No opponent yet */}
            {!opponentInfo && (
              <div className="text-center space-y-6">
                <div className="space-y-2">
                  <Swords className="w-12 h-12 text-amber-400 mx-auto" />
                  <h2 className="text-xl font-serif font-semibold text-stone-100">
                    Challenge the Shelector
                  </h2>
                  <p className="text-sm text-stone-400">
                    Paste your decklist below, then start an experimental AI practice match.
                  </p>
                </div>

                {/* Deck import section */}
                <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 text-left space-y-3">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="decklist-input"
                      className="block text-xs font-semibold text-stone-400 uppercase tracking-wider"
                    >
                      Import Decklist
                    </label>
                    {deckHistory.length > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => setShowDeckHistory(prev => !prev)}
                          className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
                        >
                          <History className="w-3.5 h-3.5" />
                          Recent Decks
                          <ChevronDown className={`w-3 h-3 transition-transform ${showDeckHistory ? 'rotate-180' : ''}`} />
                        </button>
                        {showDeckHistory && (
                          <div className="absolute right-0 top-full mt-1 w-64 bg-stone-800 border border-stone-600
                                          rounded-lg shadow-xl z-20 overflow-hidden">
                            {deckHistory.map(entry => (
                              <div
                                key={entry.commander}
                                className="flex items-center justify-between px-3 py-2 hover:bg-stone-700
                                           cursor-pointer border-b border-stone-700 last:border-b-0 group"
                              >
                                <button
                                  onClick={() => loadFromHistory(entry)}
                                  className="flex-1 text-left"
                                >
                                  <div className="text-sm text-stone-200 font-medium truncate">
                                    {entry.commander}
                                  </div>
                                  <div className="text-[10px] text-stone-500">
                                    {new Date(entry.timestamp).toLocaleDateString()}
                                  </div>
                                </button>
                                <button
                                  onClick={e => {
                                    e.stopPropagation();
                                    removeFromHistory(entry.commander);
                                  }}
                                  className="p-1 text-stone-500 hover:text-red-400 opacity-0 group-hover:opacity-100
                                             transition-opacity"
                                  aria-label={`Remove ${entry.commander}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <textarea
                    id="decklist-input"
                    value={deckText}
                    onChange={e => setDeckText(e.target.value)}
                    placeholder={
                      "Commander: Atraxa, Praetors' Voice\n1 Sol Ring\n1 Arcane Signet\n10 Forest\n..."
                    }
                    rows={6}
                    className="w-full rounded-lg bg-stone-900 border border-stone-600 text-stone-200
                               placeholder-stone-600 text-sm font-mono px-3 py-2 resize-y
                               focus:outline-none focus:ring-2 focus:ring-amber-500/50 focus:border-amber-500"
                  />
                  <button
                    onClick={handleImportDeck}
                    disabled={isImporting || !deckText.trim()}
                    className="w-full py-2.5 px-4 rounded-lg bg-stone-700 hover:bg-stone-600
                               disabled:opacity-50 disabled:cursor-not-allowed
                               text-stone-200 font-semibold transition-colors text-sm
                               flex items-center justify-center gap-2 min-h-[44px]"
                  >
                    {isImporting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <ClipboardPaste className="w-4 h-4" />
                        Import Deck
                      </>
                    )}
                  </button>

                  {/* Import error */}
                  {importError && (
                    <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-xs">
                      {importError}
                    </div>
                  )}

                  {/* Import results */}
                  {importResult && (
                    <div className="space-y-2">
                      {importResult.commander && (
                        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg px-3 py-2">
                          <span className="text-amber-400 text-xs font-semibold uppercase tracking-wider">
                            Commander:{' '}
                          </span>
                          <span className="text-stone-200 text-sm font-semibold">
                            {importResult.commander}
                          </span>
                        </div>
                      )}

                      <div className="text-stone-400 text-xs">
                        {importResult.total} / 100 cards
                        {importResult.valid ? (
                          <span className="text-green-400 ml-2">Valid</span>
                        ) : (
                          <span className="text-red-400 ml-2">Invalid</span>
                        )}
                      </div>

                      {importResult.errors.length > 0 && (
                        <div className="bg-red-900/20 border border-red-700/50 rounded-lg px-3 py-2 space-y-1">
                          {importResult.errors.map((err, i) => (
                            <div key={i} className="text-red-300 text-xs">
                              {err}
                            </div>
                          ))}
                        </div>
                      )}

                      {importResult.warnings.length > 0 && (
                        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2 space-y-1">
                          {importResult.warnings.map((warn, i) => (
                            <div key={i} className="text-yellow-300 text-xs">
                              {warn}
                            </div>
                          ))}
                        </div>
                      )}

                      {importResult.filled_cards.length > 0 && (
                        <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg px-3 py-2">
                          <div className="text-blue-400 text-xs font-semibold mb-1">
                            Shelector added {importResult.filled_cards.length} cards:
                          </div>
                          <div className="text-stone-300 text-xs leading-relaxed">
                            {importResult.filled_cards.join(', ')}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Opponent Mode + Options */}
                <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 text-left space-y-4">
                  <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider">
                    Opponent Mode
                  </label>

                  {/* Mode selector buttons */}
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      onClick={() => setSpawnMode('random')}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 min-h-[44px] ${
                        spawnMode === 'random'
                          ? 'bg-amber-600 text-white'
                          : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                      }`}
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      Random
                    </button>
                    <button
                      onClick={() => setSpawnMode('counter')}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 min-h-[44px] ${
                        spawnMode === 'counter'
                          ? 'bg-amber-600 text-white'
                          : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                      }`}
                    >
                      <Shield className="w-3.5 h-3.5" />
                      Counter
                    </button>
                    <button
                      onClick={() => setSpawnMode('pool')}
                      className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 min-h-[44px] ${
                        spawnMode === 'pool'
                          ? 'bg-amber-600 text-white'
                          : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                      }`}
                    >
                      <Archive className="w-3.5 h-3.5" />
                      From Pool
                    </button>
                  </div>

                  {/* Mode description */}
                  <p className="text-xs text-stone-500">
                    {spawnMode === 'random' && 'Pick a random legendary creature from the full card database.'}
                    {spawnMode === 'counter' && 'Analyze your deck and pick a commander that counters your strategy.'}
                    {spawnMode === 'pool' && 'Pick from the curated deck pool (10 prebuilt decks).'}
                  </p>

                  {/* Bracket selector */}
                  <div>
                    <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
                      Bracket (Power Level)
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={1}
                        max={5}
                        value={spawnBracket}
                        onChange={e => setSpawnBracket(Number(e.target.value))}
                        className="flex-1 accent-amber-500 h-2 cursor-pointer"
                      />
                      <span className="text-sm font-mono text-amber-400 w-6 text-center">
                        {spawnBracket}
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] text-stone-600 mt-1 px-0.5">
                      <span>Casual</span>
                      <span>cEDH</span>
                    </div>
                  </div>

                  {/* Color filter (for random mode) */}
                  {spawnMode === 'random' && (
                    <div>
                      <label className="block text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
                        Exclude Colors
                      </label>
                      <div className="flex gap-2">
                        {(['W', 'U', 'B', 'R', 'G'] as const).map(color => (
                          <button
                            key={color}
                            onClick={() =>
                              setColorFilter(prev => ({ ...prev, [color]: !prev[color] }))
                            }
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors min-h-[36px] ${
                              colorFilter[color]
                                ? 'bg-red-900/50 text-red-300 border border-red-700 line-through'
                                : `${COLOR_BADGES[color]} border border-transparent`
                            }`}
                          >
                            {COLOR_NAMES[color]}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-stone-600 mt-1">
                        Click to exclude colors from opponent selection.
                      </p>
                    </div>
                  )}

                  {/* Counter mode hint */}
                  {spawnMode === 'counter' && !importResult?.commander && (
                    <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg px-3 py-2">
                      <p className="text-yellow-300 text-xs">
                        Import your deck above first so the AI can analyze your commander and colors.
                      </p>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => {
                    const avoidColors = Object.entries(colorFilter)
                      .filter(([, excluded]) => excluded)
                      .map(([c]) => c);

                    const opts: SpawnOptions = {
                      mode: spawnMode,
                      bracket: spawnBracket,
                      avoid_colors: avoidColors,
                    };

                    if (spawnMode === 'counter' && importResult?.commander) {
                      opts.human_commander = importResult.commander;
                      // Extract human colors from the imported commander's card data
                      const cmdData = importResult.card_data[importResult.commander];
                      opts.human_colors = cmdData?.color_identity ?? [];
                    }

                    spawnOpponent(opts);
                  }}
                  disabled={isLoading}
                  className="w-full py-3 px-6 rounded-xl bg-amber-600 hover:bg-amber-500
                             disabled:opacity-50 disabled:cursor-not-allowed
                             text-white font-semibold transition-colors
                             flex items-center justify-center gap-2 min-h-[44px]"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Spawning Opponent...
                    </>
                  ) : (
                    <>
                      <Zap className="w-5 h-5" />
                      Spawn Opponent
                    </>
                  )}
                </button>

                {error && (
                  <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* Opponent spawned -- show info + start */}
            {opponentInfo && (
              <div className="space-y-6">
                <div className="bg-stone-800 border border-stone-700 rounded-xl p-4 sm:p-6 space-y-4">
                  <div className="text-center">
                    <div className="text-amber-400 text-xs font-semibold tracking-wider uppercase mb-1">
                      Your Opponent
                    </div>
                    <h2 className="text-xl font-serif font-semibold text-stone-100">
                      {opponentInfo.commander}
                    </h2>
                  </div>

                  <div className="flex justify-center gap-2">
                    {opponentInfo.colors.map(c => (
                      <span
                        key={c}
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          COLOR_BADGES[c] || 'bg-stone-600 text-stone-300'
                        }`}
                      >
                        {COLOR_NAMES[c] || c}
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-stone-700/50 rounded-lg px-3 py-2">
                      <div className="text-stone-500 text-xs">Strategy</div>
                      <div className="text-stone-200 capitalize">
                        {opponentInfo.strategy}
                      </div>
                    </div>
                    <div className="bg-stone-700/50 rounded-lg px-3 py-2">
                      <div className="text-stone-500 text-xs">Personality</div>
                      <div className="text-stone-200">
                        {opponentInfo.personality}
                      </div>
                    </div>
                    <div className="bg-stone-700/50 rounded-lg px-3 py-2 col-span-2">
                      <div className="text-stone-500 text-xs">Deck Size</div>
                      <div className="text-stone-200">
                        {opponentInfo.deckSize} cards
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      const avoidColors = Object.entries(colorFilter)
                        .filter(([, excluded]) => excluded)
                        .map(([c]) => c);

                      const opts: SpawnOptions = {
                        mode: spawnMode,
                        bracket: spawnBracket,
                        avoid_colors: avoidColors,
                      };

                      if (spawnMode === 'counter' && importResult?.commander) {
                        opts.human_commander = importResult.commander;
                        const cmdData = importResult.card_data[importResult.commander];
                        opts.human_colors = cmdData?.color_identity ?? [];
                      }

                      spawnOpponent(opts);
                    }}
                    disabled={isLoading}
                    className="flex-1 py-3 px-4 rounded-xl bg-stone-700 hover:bg-stone-600
                               disabled:opacity-50 text-stone-200 font-semibold transition-colors text-sm min-h-[44px]"
                  >
                    Re-roll
                  </button>
                  <button
                    onClick={async () => {
                      setIsGeneratingAIDeck(true);
                      try {
                        // Fetch AI deck from the backend
                        const aiRes = await fetch(shelectorApiUrl('/generate-ai-deck'), {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            commander: opponentInfo?.commander || 'Unknown Commander',
                            bracket: 3,
                          }),
                        });

                        let aiDeckData = undefined;
                        if (aiRes.ok) {
                          const aiData = await aiRes.json();
                          aiDeckData = {
                            commander: aiData.commander,
                            cards: aiData.cards as string[],
                            lands: aiData.lands as string[],
                            cardData: aiData.card_data as Record<string, any>,
                          };
                        }

                        // Build human deck if available
                        const humanDeck = (importResult && importResult.valid && importResult.commander)
                          ? {
                              commander: importResult.commander,
                              cards: importResult.cards,
                              lands: importResult.lands,
                              cardData: importResult.card_data,
                            }
                          : undefined;

                        startGame(humanDeck, aiDeckData);
                      } catch {
                        // If AI deck generation fails, start without it
                        const humanDeck = (importResult && importResult.valid && importResult.commander)
                          ? {
                              commander: importResult.commander,
                              cards: importResult.cards,
                              lands: importResult.lands,
                              cardData: importResult.card_data,
                            }
                          : undefined;
                        startGame(humanDeck);
                      } finally {
                        setIsGeneratingAIDeck(false);
                      }
                    }}
                    disabled={isLoading || isGeneratingAIDeck}
                    className="flex-[2] py-3 px-6 rounded-xl bg-green-700 hover:bg-green-600
                               disabled:opacity-50 text-white font-semibold transition-colors
                               flex items-center justify-center gap-2 min-h-[44px]"
                  >
                    {isGeneratingAIDeck ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Generating AI Deck...
                      </>
                    ) : (
                      <>
                        <Swords className="w-5 h-5" />
                        Start Game
                      </>
                    )}
                  </button>
                </div>

                {error && (
                  <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-lg px-4 py-2 text-sm">
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // In-game screen: Board + Chat
  // Desktop: side-by-side (70/30). Mobile: full board + slide-up chat drawer.
  return (
    <div className="flex flex-col md:flex-row h-screen bg-stone-900 overflow-hidden relative">
      {/* Game Board -- full width on mobile, 70% on desktop */}
      <div className="flex-1 md:flex-[7] relative h-full">
        <GameBoard
          gameState={gameState}
          legalActions={legalActions}
          isHumanTurn={isHumanTurn}
          isLoading={isLoading}
          onAction={submitAction}
          mulliganPhase={mulliganPhase}
          mulliganCount={mulliganCount}
          mulliganBottomCount={mulliganBottomCount}
          selectedMulliganCardIds={selectedMulliganCardIds}
          selectedMulliganBottomIds={selectedMulliganBottomIds}
          onKeepHand={keepHand}
          onMulligan={mulligan}
          onToggleMulliganCard={toggleMulliganCard}
          onToggleMulliganBottom={toggleMulliganBottomCard}
          discardPhase={discardPhase}
          discardCount={discardCount}
          onDiscardCard={discardCard}
          tutorPhase={tutorPhase}
          tutorCards={tutorCards}
          tutorTitle={tutorTitle}
          onTutorPick={resolveTutor}
          onTutorCancel={cancelTutor}
          libraryChoice={libraryChoice}
          onResolveLibraryChoice={resolveLibraryChoice}
          undosRemaining={undosRemaining}
          onUndo={undoAction}
          coachMode={coachMode}
          onToggleCoach={setCoachMode}
          newPlayerMode={newPlayerMode}
          onToggleNewPlayerMode={setNewPlayerMode}
          holdPriority={holdPriority}
          onToggleHoldPriority={setHoldPriority}
          onUntapMana={untapManaSource}
          onAdjustCounters={adjustCounters}
          untappableCardIds={untappableCardIds}
          lastPlayedCard={lastPlayedCard}
          authorityUpdates={authorityUpdates}
          lastStateUpdate={lastStateUpdate}
          currentPrompt={currentPrompt}
        />
      </div>

      {/* Desktop Chat Panel -- hidden on mobile, shown on md+ */}
      <div className="hidden md:flex md:flex-[3] md:min-w-[280px] md:max-w-[400px]">
        <GameChat
          messages={chatMessages}
          isGameOver={isGameOver}
          winner={winner}
        />
      </div>

      {/* Mobile Chat Drawer -- slide-up panel from bottom */}
      {showMobileChat && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50"
          onClick={() => setShowMobileChat(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 max-h-[50vh] bg-stone-900 border-t border-stone-700 rounded-t-xl
                       animate-[slideUp_0.2s_ease-out]"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer handle */}
            <div className="flex items-center justify-center py-2">
              <div className="w-10 h-1 rounded-full bg-stone-600" />
            </div>
            <GameChat
              messages={chatMessages}
              isGameOver={isGameOver}
              winner={winner}
              onClose={() => setShowMobileChat(false)}
              isMobileDrawer
            />
          </div>
        </div>
      )}

      {/* Review Game button -- shown after game over (desktop, above chat panel) */}
      {isGameOver && gameLog.length > 0 && (
        <button
          onClick={() => setShowReview(true)}
          className="hidden md:flex fixed top-4 right-4 z-30 items-center gap-2 px-4 py-2.5 rounded-xl
                     bg-purple-700 hover:bg-purple-600 text-white font-semibold text-sm
                     shadow-lg shadow-black/40 transition-colors"
        >
          <BarChart3 className="w-4 h-4" />
          Review Game
        </button>
      )}

      {/* Review button during game (desktop) */}
      {!isGameOver && gameLog.length > 0 && (
        <button
          onClick={() => setShowReview(true)}
          className="hidden md:flex fixed top-4 right-4 z-30 items-center gap-2 px-3 py-2 rounded-lg
                     bg-stone-700 hover:bg-stone-600 text-stone-300 text-xs font-semibold
                     shadow-lg shadow-black/40 transition-colors"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          Review
        </button>
      )}

      {/* Mobile chat toggle FAB */}
      <button
        onClick={() => setShowMobileChat(prev => !prev)}
        className="md:hidden fixed right-3 top-[calc(env(safe-area-inset-top)+4.25rem)] z-50 h-11 w-11 rounded-full bg-amber-600 hover:bg-amber-500
                   text-white shadow-lg shadow-black/40 flex items-center justify-center
                   active:scale-95 transition-transform"
        aria-label="Toggle game chat"
      >
        <MessageSquare className="w-5 h-5" />
        {chatMessages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {chatMessages.length > 99 ? '99' : chatMessages.length}
          </span>
        )}
      </button>

      {/* Mobile review FAB */}
      {gameLog.length > 0 && (
        <button
          onClick={() => setShowReview(true)}
          className={`md:hidden fixed ${isGameOver ? 'left-3 top-[calc(env(safe-area-inset-top)+4.25rem)]' : 'right-3 top-[calc(env(safe-area-inset-top)+7.25rem)]'} z-50
                     ${isGameOver
                       ? 'h-11 w-11 rounded-full bg-purple-700 hover:bg-purple-600'
                       : 'h-11 w-11 rounded-full bg-stone-700 hover:bg-stone-600'
                     }
                     text-white shadow-lg shadow-black/40 flex items-center justify-center
                     active:scale-95 transition-transform`}
          aria-label="Review game"
        >
          <BarChart3 className={isGameOver ? 'w-5 h-5' : 'w-4 h-4'} />
        </button>
      )}

      {/* Game Review Modal */}
      {showReview && gameState && (
        <GameReview
          gameLog={gameLog}
          finalState={gameState}
          winner={winner}
          onClose={() => setShowReview(false)}
        />
      )}

      {/* End-Game Modal (Task 27 — game-reliability-refactor) */}
      <EndGameModal
        open={endGame.open}
        kind={endGame.kind}
        reason={endGame.reason}
        loopSources={endGame.loopSources}
        onPlayItOut={playItOut}
        onDeclareDraw={declareDraw}
        onConcede={concedeGame}
        onNewGame={newGame}
        onReviewLog={() => { reviewLog(); setShowReview(true); }}
        onClose={closeEndGame}
      />
    </div>
  );
}
