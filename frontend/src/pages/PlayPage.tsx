import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardPaste, Loader2, Swords, Link as LinkIcon, History, Trash2, Shield, Trophy, Users } from 'lucide-react';
import { useShelectorGame, type ImportedCards } from '../hooks/useShelectorGame';
import { GameBoard } from '../components/GameBoard';
import { GameReview } from '../components/GameReview';
import { EndGameModal } from '../components/shelector/EndGameModal';
import { DraftTournament } from '../components/DraftTournament';
import { StandardTournament } from '../components/StandardTournament';
import { cacheSet, cacheGet } from '../lib/cache';

interface DeckImportResult {
  commander: string | null;
  cards: string[];
  lands: string[];
  sideboard?: string[];
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

interface SpawnedOpponent {
  commander: string;
  deck_name?: string;
  personality: string;
  colors?: string[];
  deck_id?: string;
  strategy?: string;
}

interface AIDeckResponse {
  commander: string;
  cards: string[];
  lands: string[];
  card_data: DeckImportResult['card_data'];
}

const DECK_HISTORY_MAX = 5;

const COLOR_BADGES: Record<string, string> = {
  W: 'bg-amber-100 text-amber-800',
  U: 'bg-blue-100 text-blue-800',
  B: 'bg-gray-300 text-gray-900',
  R: 'bg-red-100 text-red-800',
  G: 'bg-green-100 text-green-800',
};

const PERSONALITIES = ['Balanced', 'Aggressive', 'Greedy', 'Political'] as const;

type OpponentCount = 1 | 2 | 3;

const MATCH_SIZES: { label: string; players: number; opponentCount: OpponentCount }[] = [
  { label: '1v1', players: 2, opponentCount: 1 },
  { label: '1v1v1', players: 3, opponentCount: 2 },
  { label: '1v1v1v1', players: 4, opponentCount: 3 },
];

export function PlayPage() {
  const {
    gameState,
    legalActions,
    isLoading,
    isHumanTurn,
    isGameOver,
    winner,
    error,
    mulliganPhase,
    mulliganCount,
    discardPhase,
    discardCount,
    tutorPhase,
    tutorCards,
    tutorTitle,
    gameLog,
    lastPlayedCard,
    startGame,
    submitAction,
    keepHand,
    mulligan,
    discardCard,
    resolveTutor,
    cancelTutor,
    undosRemaining,
    undoAction,
    coachMode,
    setCoachMode,
    untapManaSource,
    untappableCardIds,
    endGame,
    closeEndGame,
    newGame,
    declareDraw,
    concedeGame,
    playItOut,
    reviewLog,
  } = useShelectorGame();

  // Pre-game state
  const [step, setStep] = useState<'import' | 'opponent' | 'draft' | 'standard' | 'game'>('import');
  const [importTab, setImportTab] = useState<'url' | 'text'>('url');
  const [deckUrl, setDeckUrl] = useState('');
  const [deckText, setDeckText] = useState('');
  const [importResult, setImportResult] = useState<DeckImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Opponent config
  const [opponentCount, setOpponentCount] = useState<OpponentCount>(1);
  const [spawnMode, setSpawnMode] = useState<'random' | 'counter' | 'pool'>('random');
  const [spawnBracket, setSpawnBracket] = useState(3);
  const [colorFilter, setColorFilter] = useState<Record<string, boolean>>({
    W: false, U: false, B: false, R: false, G: false,
  });
  const [personality, setPersonality] = useState<string>('Balanced');
  const [spawnedOpponents, setSpawnedOpponents] = useState<SpawnedOpponent[]>([]);
  const [spawnProgress, setSpawnProgress] = useState('');
  const [isSpawning, setIsSpawning] = useState(false);
  const [isGeneratingAIDeck, setIsGeneratingAIDeck] = useState(false);

  // Deck history
  const [deckHistory, setDeckHistory] = useState<DeckHistoryEntry[]>([]);
  const [showDeckHistory, setShowDeckHistory] = useState(false);

  // Review modal
  const [showReview, setShowReview] = useState(false);

  // Load saved deck data
  useEffect(() => {
    const savedText = cacheGet<string>('last_deck_text');
    if (savedText) setDeckText(savedText);
    const savedResult = cacheGet<DeckImportResult>('last_deck_result');
    if (savedResult) setImportResult(savedResult);
    const savedHistory = cacheGet<DeckHistoryEntry[]>('deck_history');
    if (savedHistory) setDeckHistory(savedHistory);
  }, []);

  // Show review when game ends
  useEffect(() => {
    if (isGameOver) setShowReview(true);
  }, [isGameOver]);

  const addToDeckHistory = (commander: string, text: string) => {
    setDeckHistory(prev => {
      const filtered = prev.filter(e => e.commander !== commander);
      const entry: DeckHistoryEntry = { commander, text, timestamp: Date.now() };
      const updated = [entry, ...filtered].slice(0, DECK_HISTORY_MAX);
      cacheSet('deck_history', updated, 30 * 24 * 60 * 60 * 1000);
      return updated;
    });
  };

  const handleImportFromUrl = async () => {
    if (!deckUrl.trim()) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      // Step 1: Fetch card list from URL
      const parseRes = await fetch('/api/parse-deck-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: deckUrl }),
      });
      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to fetch deck (${parseRes.status})`);
      }
      const parsed = await parseRes.json();

      // Step 2: Build decklist text and run through import-deck for validation
      const lines: string[] = [];
      if (parsed.commander) {
        lines.push('Commander');
        lines.push(`1 ${parsed.commander}`);
        lines.push('Deck');
      }
      for (const card of parsed.cards) lines.push(`1 ${card}`);
      const listText = lines.join('\n');

      const importRes = await fetch('/shelector-api/import-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: listText,
          bracket: spawnBracket,
          fill_missing: true,
        }),
      });
      if (!importRes.ok) throw new Error(`Import validation failed (${importRes.status})`);
      const data: DeckImportResult = await importRes.json();
      setImportResult(data);
      setSpawnedOpponents([]);
      setSpawnProgress('');

      if (data.commander) {
        addToDeckHistory(data.commander, listText);
        cacheSet('last_deck_text', listText, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to import deck from URL');
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromText = async () => {
    if (!deckText.trim()) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch('/shelector-api/import-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: deckText,
          bracket: spawnBracket,
          fill_missing: true,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data: DeckImportResult = await res.json();
      setImportResult(data);
      setSpawnedOpponents([]);
      setSpawnProgress('');

      if (data.commander) {
        addToDeckHistory(data.commander, deckText);
        cacheSet('last_deck_text', deckText, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to import deck');
    } finally {
      setIsImporting(false);
    }
  };

  const handleSpawnAndStart = async () => {
    if (!importResult?.valid) return;
    setIsSpawning(true);
    setIsGeneratingAIDeck(false);
    setImportError(null);
    setSpawnedOpponents([]);
    setSpawnProgress('');
    try {
      const avoidColors = Object.entries(colorFilter)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const humanCommander = importResult.commander || '';
      const humanCommanderFace = humanCommander.split(' // ')[0]?.trim();
      const humanCommanderData = importResult.card_data[humanCommander]
        || (humanCommanderFace ? importResult.card_data[humanCommanderFace] : undefined);

      const opponents: SpawnedOpponent[] = [];
      const aiDecks: ImportedCards[] = [];
      const usedCommanders = new Set<string>();

      for (let i = 0; i < opponentCount; i++) {
        let opponent: SpawnedOpponent | null = null;
        let aiDeck: AIDeckResponse | null = null;

        for (let attempt = 0; attempt < 6; attempt++) {
          setSpawnProgress(`Picking opponent ${i + 1}/${opponentCount}...`);
          const spawnRes = await fetch('/shelector-api/spawn-opponent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              mode: spawnMode,
              bracket: spawnBracket,
              avoid_colors: avoidColors,
              human_commander: humanCommander || null,
              human_colors: humanCommanderData?.color_identity || [],
            }),
          });
          if (!spawnRes.ok) throw new Error(`Failed to spawn opponent (${spawnRes.status})`);
          const candidate: SpawnedOpponent = await spawnRes.json();
          const key = candidate.commander.toLowerCase();
          if (usedCommanders.has(key) && attempt < 5) {
            continue;
          }

          setIsGeneratingAIDeck(true);
          setSpawnProgress(`Building ${candidate.commander} (${i + 1}/${opponentCount})...`);
          const aiRes = await fetch('/shelector-api/generate-ai-deck', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              commander: candidate.commander,
              bracket: spawnBracket,
            }),
          });
          if (!aiRes.ok) {
            if (attempt === 5) {
              throw new Error(`Failed to generate AI deck (${aiRes.status})`);
            }
            continue;
          }

          opponent = candidate;
          aiDeck = await aiRes.json() as AIDeckResponse;
          usedCommanders.add(key);
          break;
        }

        if (!opponent || !aiDeck) throw new Error('Failed to prepare an opponent');
        opponents.push(opponent);
        setSpawnedOpponents([...opponents]);

        aiDecks.push({
          commander: aiDeck.commander,
          cards: aiDeck.cards,
          lands: aiDeck.lands,
          cardData: aiDeck.card_data,
        });
      }

      startGame(
        {
          commander: humanCommander,
          cards: importResult.cards,
          lands: importResult.lands,
          sideboard: importResult.sideboard || [],
          cardData: importResult.card_data,
        },
        aiDecks
      );
      setStep('game');
    } catch (err: any) {
      setImportError(err.message || 'Failed to start game');
    } finally {
      setIsSpawning(false);
      setIsGeneratingAIDeck(false);
      setSpawnProgress('');
    }
  };

  const handleStartDraftMatch = (humanDeck: ImportedCards, aiDecks: ImportedCards[]) => {
    startGame(humanDeck, aiDecks, {
      format: 'limited',
      startingLife: 20,
      startingHandSize: 7,
      aiDifficulty: 2,
    });
    setStep('game');
  };

  // ----- RENDER -----

  // Game view: board plus a live review rail.
  if (step === 'game' && gameState) {
    return (
      <div className="h-screen bg-stone-900 text-stone-100 flex flex-col overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-stone-800 border-b border-stone-700">
          <button
            onClick={() => setShowReview(true)}
            className="text-sm text-stone-400 hover:text-stone-200"
          >
            Review
          </button>
          <span className="text-sm text-stone-500">
            Turn {gameState.turnNumber} &middot; {gameState.phase}
          </span>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 min-w-0">
            <GameBoard
              gameState={gameState}
              legalActions={legalActions}
              isHumanTurn={isHumanTurn}
              isLoading={isLoading}
              onAction={submitAction}
              mulliganPhase={mulliganPhase}
              mulliganCount={mulliganCount}
              onKeepHand={keepHand}
              onMulligan={mulligan}
              discardPhase={discardPhase}
              discardCount={discardCount}
              onDiscardCard={discardCard}
              tutorPhase={tutorPhase}
              tutorCards={tutorCards}
              tutorTitle={tutorTitle}
              onTutorPick={resolveTutor}
              onTutorCancel={cancelTutor}
              undosRemaining={undosRemaining}
              onUndo={undoAction}
              coachMode={coachMode}
              onToggleCoach={setCoachMode}
              onUntapMana={untapManaSource}
              untappableCardIds={untappableCardIds}
              lastPlayedCard={lastPlayedCard}
            />
          </div>
          <aside className="hidden lg:block w-[360px] xl:w-[420px] shrink-0 border-l border-stone-700 bg-stone-900">
            <GameReview
              gameLog={gameLog}
              finalState={gameState}
              winner={winner}
              onClose={() => setShowReview(false)}
              embedded
            />
          </aside>
        </div>

        {/* Review modal */}
        {showReview && (
          <GameReview
            gameLog={gameLog}
            finalState={gameState}
            winner={winner}
            onClose={() => setShowReview(false)}
          />
        )}

        {/* End-game modal (win / loss / possible loop) */}
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

  if (step === 'draft') {
    return (
      <div className="min-h-screen bg-stone-900 p-4 text-stone-100">
        <div className="mx-auto max-w-5xl">
          <div className="mb-8 flex items-center gap-3">
            <Link to="/" className="text-stone-400 hover:text-stone-200">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold">Play a Game</h1>
          </div>
          <DraftTournament
            onBack={() => setStep(importResult?.valid ? 'opponent' : 'import')}
            onStartMatch={handleStartDraftMatch}
          />
        </div>
      </div>
    );
  }

  if (step === 'standard') {
    return (
      <div className="min-h-screen bg-stone-900 p-4 text-stone-100">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 flex items-center gap-3">
            <Link to="/" className="text-stone-400 hover:text-stone-200">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="text-2xl font-bold">Play a Game</h1>
          </div>
          <StandardTournament onBack={() => setStep(importResult?.valid ? 'opponent' : 'import')} />
        </div>
      </div>
    );
  }

  // Pre-game view
  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link to="/" className="text-stone-400 hover:text-stone-200">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold">Play a Game</h1>
        </div>

        {/* Step 1: Import */}
        <div className="bg-stone-800 rounded-xl border border-stone-700 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ClipboardPaste className="w-5 h-5 text-amber-400" />
            Import Your Deck
          </h2>

          {/* Tabs */}
          <div className="flex gap-2 mb-4 flex-wrap">
            <button
              onClick={() => setImportTab('url')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                importTab === 'url'
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
              }`}
            >
              <LinkIcon className="w-4 h-4 inline mr-1" />
              Paste URL
            </button>
            <button
              onClick={() => setImportTab('text')}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                importTab === 'text'
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
              }`}
            >
              <ClipboardPaste className="w-4 h-4 inline mr-1" />
              Paste Decklist
            </button>

            {/* Deck history */}
            {deckHistory.length > 0 && (
              <button
                onClick={() => setShowDeckHistory(!showDeckHistory)}
                className="ml-auto px-3 py-2.5 rounded-lg text-sm bg-stone-700 text-stone-300 hover:bg-stone-600 min-h-[44px]"
              >
                <History className="w-4 h-4 inline mr-1" />
                Recent
              </button>
            )}
          </div>

          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setStep('standard')}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-red-700/50 bg-red-950/30 px-4 py-2.5 text-sm font-bold text-red-100 transition-colors hover:bg-red-900/40"
            >
              <Trophy className="h-4 w-4" />
              Standard Tournament
            </button>
            <button
              type="button"
              onClick={() => setStep('draft')}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-4 py-2.5 text-sm font-bold text-amber-200 transition-colors hover:bg-amber-900/40"
            >
              <Users className="h-4 w-4" />
              Draft Tournament
            </button>
          </div>

          {/* History dropdown */}
          {showDeckHistory && (
            <div className="mb-4 bg-stone-700/50 rounded-lg p-3 space-y-2">
              {deckHistory.map(entry => (
                <div key={entry.commander} className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      setDeckText(entry.text);
                      setImportTab('text');
                      setShowDeckHistory(false);
                    }}
                    className="text-sm text-stone-200 hover:text-amber-300"
                  >
                    {entry.commander}
                  </button>
                  <button
                    onClick={() => {
                      setDeckHistory(prev => {
                        const updated = prev.filter(e => e.commander !== entry.commander);
                        cacheSet('deck_history', updated, 30 * 24 * 60 * 60 * 1000);
                        return updated;
                      });
                    }}
                    className="text-stone-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* URL input */}
          {importTab === 'url' && (
            <div>
              <input
                type="text"
                value={deckUrl}
                onChange={e => setDeckUrl(e.target.value)}
                placeholder="https://www.moxfield.com/decks/..."
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500 mb-3"
              />
              <p className="text-xs text-stone-500 mb-3">
                Supports Moxfield, Archidekt, TappedOut, and MTGGoldfish
              </p>
              <button
                onClick={handleImportFromUrl}
                disabled={isImporting || !deckUrl.trim()}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-medium transition-colors"
              >
                {isImporting ? (
                  <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Importing...</>
                ) : (
                  'Import Deck'
                )}
              </button>
            </div>
          )}

          {/* Text input */}
          {importTab === 'text' && (
            <div>
              <textarea
                value={deckText}
                onChange={e => setDeckText(e.target.value)}
                placeholder={"1 Atraxa, Praetors' Voice\n1 Sol Ring\n1 Command Tower\n..."}
                rows={8}
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500 mb-3 font-mono text-sm"
              />
              <button
                onClick={handleImportFromText}
                disabled={isImporting || !deckText.trim()}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-medium transition-colors"
              >
                {isImporting ? (
                  <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Importing...</>
                ) : (
                  'Import Deck'
                )}
              </button>
            </div>
          )}

          {/* Import errors */}
          {importError && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
              {importError}
            </div>
          )}

          {/* Import results */}
          {importResult && (
            <div className="mt-4 p-4 bg-stone-700/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-amber-200">
                  {importResult.commander || 'Unknown Commander'}
                </span>
                <span className="text-sm text-stone-400">{importResult.total} cards</span>
              </div>
              {importResult.warnings.length > 0 && (
                <div className="text-xs text-amber-400 space-y-1">
                  {importResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="text-xs text-red-400 space-y-1 mt-1">
                  {importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              {importResult.valid && (
                <button
                  onClick={() => setStep('opponent')}
                  className="mt-3 px-6 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Swords className="w-4 h-4" />
                  Choose Opponent
                </button>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Opponent Setup */}
        {step === 'opponent' && importResult?.valid && (
          <div className="bg-stone-800 rounded-xl border border-stone-700 p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-400" />
              Opponent Setup
            </h2>

            {/* Match size */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Number of Players</label>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                {MATCH_SIZES.map(size => (
                  <button
                    key={size.label}
                    onClick={() => setOpponentCount(size.opponentCount)}
                    className={`min-h-[48px] rounded-lg px-4 py-2.5 text-left transition-colors ${
                      opponentCount === size.opponentCount
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    <span className="flex items-center gap-2 font-bold">
                      <Users className="h-4 w-4" />
                      {size.label}
                    </span>
                    <span className="block text-xs opacity-75">{size.players} players</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setStep('standard')}
                  className="min-h-[48px] rounded-lg bg-stone-700 px-4 py-2.5 text-left text-stone-300 transition-colors hover:bg-stone-600"
                >
                  <span className="flex items-center gap-2 font-bold">
                    <Trophy className="h-4 w-4" />
                    Standard Tournament
                  </span>
                  <span className="block text-xs opacity-75">Swiss, 4+ players</span>
                </button>
                <button
                  type="button"
                  onClick={() => setStep('draft')}
                  className="min-h-[48px] rounded-lg bg-stone-700 px-4 py-2.5 text-left text-stone-300 transition-colors hover:bg-stone-600"
                >
                  <span className="flex items-center gap-2 font-bold">
                    <Trophy className="h-4 w-4" />
                    Draft Tournament
                  </span>
                  <span className="block text-xs opacity-75">2-8 players</span>
                </button>
              </div>
            </div>

            {/* Bracket */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Power Level (Bracket)</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(b => (
                  <button
                    key={b}
                    onClick={() => setSpawnBracket(b)}
                    className={`w-11 h-11 sm:w-10 sm:h-10 rounded-lg font-bold transition-colors ${
                      spawnBracket === b
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Spawn mode */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Opponent Selection</label>
              <div className="flex gap-2 flex-wrap">
                {(['random', 'counter', 'pool'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setSpawnMode(mode)}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium capitalize transition-colors min-h-[44px] ${
                      spawnMode === mode
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Color filter */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Exclude Colors</label>
              <div className="flex gap-2 flex-wrap">
                {Object.entries(COLOR_BADGES).map(([color, badge]) => (
                  <button
                    key={color}
                    onClick={() => setColorFilter(prev => ({ ...prev, [color]: !prev[color] }))}
                    className={`w-11 h-11 sm:w-9 sm:h-9 rounded-full text-sm font-bold transition-all ${
                      colorFilter[color]
                        ? `${badge} ring-2 ring-offset-2 ring-offset-stone-800 ring-amber-500`
                        : 'bg-stone-700 text-stone-400'
                    }`}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>

            {/* Personality */}
            <div className="mb-6">
              <label className="text-sm text-stone-400 block mb-2">AI Personality</label>
              <div className="flex gap-2 flex-wrap">
                {PERSONALITIES.map(p => (
                  <button
                    key={p}
                    onClick={() => setPersonality(p)}
                    className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] ${
                      personality === p
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Opponent info (during spawn) */}
            {(spawnedOpponents.length > 0 || spawnProgress) && (
              <div className="mb-4 space-y-2 rounded-lg bg-stone-700/50 p-3">
                {spawnProgress && (
                  <div className="flex items-center gap-2 text-sm text-amber-200">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {spawnProgress}
                  </div>
                )}
                {spawnedOpponents.map((opponent, index) => (
                  <div key={`${opponent.commander}-${index}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                    <span className="text-stone-500">AI {index + 1}</span>
                    <span className="font-semibold text-amber-200">{opponent.commander}</span>
                    <span className="text-stone-400">
                      ({opponent.personality} &middot; {opponent.colors?.join('') || 'colorless'})
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Start button */}
            <button
              onClick={handleSpawnAndStart}
              disabled={isSpawning || isGeneratingAIDeck}
              className="w-full py-3 bg-red-600 hover:bg-red-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-bold text-lg transition-colors flex items-center justify-center gap-2"
            >
              {isSpawning || isGeneratingAIDeck ? (
                <><Loader2 className="w-5 h-5 animate-spin" />Setting up game...</>
              ) : (
                <><Swords className="w-5 h-5" />Start {MATCH_SIZES.find(size => size.opponentCount === opponentCount)?.label || 'Game'}</>
              )}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
