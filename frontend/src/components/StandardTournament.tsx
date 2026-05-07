import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Clock, Loader2, Shuffle, Trophy, Users } from 'lucide-react';
import {
  calculateStandings,
  createTournamentPlayers,
  formatPct,
  pairSwissRound,
  recommendedSwissRounds,
  reportMatch,
  type Standing,
  type TournamentMatch,
  type TournamentPlayer,
} from '../lib/tournament';
import {
  countCardsByName,
  moveCardBetweenDeckAndSideboard,
  validateConstructedSideboardConfiguration,
  type SideboardValidation,
} from '../lib/sideboard';

interface StandardTournamentProps {
  onBack: () => void;
}

const PLAYER_COUNTS = [4, 6, 8, 10, 12, 16];

interface MatchResultOption {
  label: string;
  player1Wins: number;
  player2Wins: number;
  gameDraws?: number;
  tone: 'win' | 'loss' | 'draw';
}

interface RegisteredStandardDeck {
  mainDeck: string[];
  sideboard: string[];
  originalMainDeck: string[];
  originalSideboard: string[];
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function recordLabel(standing: Standing): string {
  return `${standing.matchWins}-${standing.matchLosses}-${standing.matchDraws}`;
}

function matchScore(match: TournamentMatch): string {
  if (match.isBye) return '2-0 bye';
  if (!match.player2Id || !match.reported) return '-';
  const p1 = match.gameWins[match.player1Id] || 0;
  const p2 = match.gameWins[match.player2Id] || 0;
  return match.gameDraws > 0 ? `${p1}-${p2}-${match.gameDraws}` : `${p1}-${p2}`;
}

function resultOptions(gamesToWin: number): MatchResultOption[] {
  if (gamesToWin <= 1) {
    return [
      { label: '1-0', player1Wins: 1, player2Wins: 0, tone: 'win' },
      { label: '0-1', player1Wins: 0, player2Wins: 1, tone: 'loss' },
      { label: '0-0-1', player1Wins: 0, player2Wins: 0, gameDraws: 1, tone: 'draw' },
    ];
  }

  if (gamesToWin >= 3) {
    return [
      { label: '3-0', player1Wins: 3, player2Wins: 0, tone: 'win' },
      { label: '3-1', player1Wins: 3, player2Wins: 1, tone: 'win' },
      { label: '3-2', player1Wins: 3, player2Wins: 2, tone: 'win' },
      { label: '2-3', player1Wins: 2, player2Wins: 3, tone: 'loss' },
      { label: '1-3', player1Wins: 1, player2Wins: 3, tone: 'loss' },
      { label: '0-3', player1Wins: 0, player2Wins: 3, tone: 'loss' },
      { label: '1-1', player1Wins: 1, player2Wins: 1, tone: 'draw' },
      { label: '0-0-3', player1Wins: 0, player2Wins: 0, gameDraws: 3, tone: 'draw' },
    ];
  }

  return [
    { label: '2-0', player1Wins: 2, player2Wins: 0, tone: 'win' },
    { label: '2-1', player1Wins: 2, player2Wins: 1, tone: 'win' },
    { label: '1-2', player1Wins: 1, player2Wins: 2, tone: 'loss' },
    { label: '0-2', player1Wins: 0, player2Wins: 2, tone: 'loss' },
    { label: '1-1', player1Wins: 1, player2Wins: 1, tone: 'draw' },
    { label: '0-0-3', player1Wins: 0, player2Wins: 0, gameDraws: 3, tone: 'draw' },
  ];
}

function resultButtonClass(tone: MatchResultOption['tone']): string {
  if (tone === 'win') return 'rounded bg-green-800 px-2 py-1 text-xs font-bold text-green-100';
  if (tone === 'loss') return 'rounded bg-red-900 px-2 py-1 text-xs font-bold text-red-100';
  return 'rounded bg-stone-700 px-2 py-1 text-xs font-bold text-stone-100';
}

function CardCountList({
  title,
  cards,
  actionLabel,
  onMove,
}: {
  title: string;
  cards: string[];
  actionLabel: string;
  onMove: (name: string) => void;
}) {
  const groupedCards = countCardsByName(cards);
  return (
    <div className="rounded border border-neutral-700 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 text-xs font-bold uppercase tracking-wider text-stone-400">
        <span>{title}</span>
        <span>{cards.length}</span>
      </div>
      <div className="max-h-56 overflow-y-auto divide-y divide-neutral-800">
        {groupedCards.length === 0 ? (
          <div className="px-3 py-3 text-sm text-stone-500">Empty</div>
        ) : groupedCards.map(card => (
          <div key={card.name} className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-semibold text-stone-100">{card.name}</div>
              <div className="text-xs text-stone-500">x{card.count}</div>
            </div>
            <button
              type="button"
              onClick={() => onMove(card.name)}
              className="min-h-[32px] rounded bg-stone-700 px-2 py-1 text-xs font-bold text-stone-100 hover:bg-stone-600"
            >
              {actionLabel}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function StandardTournament({ onBack }: StandardTournamentProps) {
  const [playerCount, setPlayerCount] = useState(8);
  const [roundCount, setRoundCount] = useState(recommendedSwissRounds(8));
  const [matchWinsRequired, setMatchWinsRequired] = useState(2);
  const [roundMinutes, setRoundMinutes] = useState(50);
  const [players, setPlayers] = useState<TournamentPlayer[]>([]);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);
  const [currentRound, setCurrentRound] = useState(0);
  const [roundStartedAt, setRoundStartedAt] = useState<number | null>(null);
  const [timeExtensionMinutes, setTimeExtensionMinutes] = useState(0);
  const [timeCalled, setTimeCalled] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [isImporting, setIsImporting] = useState(false);
  const [deckText, setDeckText] = useState('');
  const [deckStatus, setDeckStatus] = useState<{ valid: boolean; message: string } | null>(null);
  const [registeredDeck, setRegisteredDeck] = useState<RegisteredStandardDeck | null>(null);
  const [sideboardMessage, setSideboardMessage] = useState<string | null>(null);

  useEffect(() => {
    setRoundCount(recommendedSwissRounds(playerCount));
  }, [playerCount]);

  useEffect(() => {
    if (!roundStartedAt || timeCalled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [roundStartedAt, timeCalled]);

  const standings = useMemo(() => calculateStandings(players, matches), [players, matches]);
  const sideboardStatus: SideboardValidation | null = useMemo(
    () => registeredDeck
      ? validateConstructedSideboardConfiguration(registeredDeck.mainDeck, registeredDeck.sideboard)
      : null,
    [registeredDeck],
  );
  const currentMatches = matches.filter(match => match.round === currentRound).sort((a, b) => a.table - b.table);
  const allCurrentMatchesReported = currentMatches.length > 0 && currentMatches.every(match => match.reported);
  const phase = currentRound === 0 ? 'setup' : currentRound > roundCount ? 'complete' : 'running';
  const roundSeconds = (roundMinutes + timeExtensionMinutes) * 60;
  const elapsedSeconds = roundStartedAt ? Math.floor((now - roundStartedAt) / 1000) : 0;
  const secondsRemaining = Math.max(0, roundSeconds - elapsedSeconds);

  useEffect(() => {
    if (phase === 'running' && roundStartedAt && secondsRemaining <= 0 && !timeCalled) {
      setTimeCalled(true);
    }
  }, [phase, roundStartedAt, secondsRemaining, timeCalled]);

  const playerName = (id?: string) => players.find(player => player.id === id)?.name || 'Unknown';

  const startTournament = () => {
    if (!registeredDeck || !sideboardStatus?.valid) {
      setSideboardMessage('Register a legal Standard deck before pairing round 1.');
      return;
    }
    const createdPlayers = createTournamentPlayers(playerCount);
    const roundOne = pairSwissRound(createdPlayers, [], 1);
    setPlayers(createdPlayers);
    setMatches(roundOne);
    setCurrentRound(1);
    setRoundStartedAt(Date.now());
    setTimeExtensionMinutes(0);
    setTimeCalled(false);
    setSideboardMessage(null);
  };

  const moveSideboardCard = (cardName: string, direction: 'to-sideboard' | 'to-main') => {
    setRegisteredDeck(prev => {
      if (!prev) return prev;
      const moved = moveCardBetweenDeckAndSideboard(prev.mainDeck, prev.sideboard, cardName, direction);
      return {
        ...prev,
        mainDeck: moved.mainDeck,
        sideboard: moved.sideboard,
      };
    });
    setSideboardMessage(null);
  };

  const resetSideboarding = () => {
    setRegisteredDeck(prev => prev
      ? {
          ...prev,
          mainDeck: [...prev.originalMainDeck],
          sideboard: [...prev.originalSideboard],
        }
      : prev);
    setSideboardMessage(null);
  };

  const updateMatch = (matchId: string, p1Wins: number, p2Wins: number, gameDraws = 0) => {
    setMatches(prev => prev.map(match => (
      match.id === matchId ? reportMatch(match, p1Wins, p2Wins, gameDraws) : match
    )));
  };

  const autoReportAiMatches = () => {
    setMatches(prev => prev.map(match => {
      if (match.round !== currentRound || match.reported || !match.player2Id) return match;
      const hasHuman = match.player1Id === 'human' || match.player2Id === 'human';
      if (hasHuman) return match;
      const roll = Math.random();
      const loserWins = Math.floor(Math.random() * matchWinsRequired);
      const drawnGames = matchWinsRequired === 1 ? 1 : 0;
      if (roll < 0.08) return reportMatch(match, Math.max(0, matchWinsRequired - 1), Math.max(0, matchWinsRequired - 1), drawnGames);
      if (roll < 0.54) return reportMatch(match, matchWinsRequired, loserWins);
      return reportMatch(match, loserWins, matchWinsRequired);
    }));
  };

  const nextRound = () => {
    if (!allCurrentMatchesReported) return;
    if (currentRound >= roundCount) {
      setCurrentRound(roundCount + 1);
      setRoundStartedAt(null);
      return;
    }
    const next = currentRound + 1;
    setMatches(prev => [...prev, ...pairSwissRound(players, prev, next)]);
    setCurrentRound(next);
    setRoundStartedAt(Date.now());
    setTimeExtensionMinutes(0);
    setTimeCalled(false);
    setNow(Date.now());
  };

  const importStandardDeck = async () => {
    if (!deckText.trim()) return;
    setIsImporting(true);
    setDeckStatus(null);
    try {
      const res = await fetch('/shelector-api/import-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: deckText,
          format: 'standard',
          fill_missing: false,
        }),
      });
      if (!res.ok) throw new Error(`Import failed (${res.status})`);
      const data = await res.json();
      const detail = data.valid
        ? `${data.total} main / ${(data.sideboard || []).length} sideboard`
        : [...(data.errors || []), ...(data.warnings || [])].slice(0, 3).join(' ');
      setDeckStatus({ valid: Boolean(data.valid), message: detail || 'Deck checked' });
      if (data.valid) {
        const mainDeck = [...(data.cards || []), ...(data.lands || [])];
        const sideboard = [...(data.sideboard || [])];
        setRegisteredDeck({
          mainDeck,
          sideboard,
          originalMainDeck: [...mainDeck],
          originalSideboard: [...sideboard],
        });
        setSideboardMessage(null);
      } else {
        setRegisteredDeck(null);
      }
    } catch (err: any) {
      setDeckStatus({ valid: false, message: err.message || 'Failed to import deck' });
      setRegisteredDeck(null);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="rounded-xl border border-stone-700 bg-stone-800 p-4 md:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-bold text-stone-100">
            <Trophy className="h-5 w-5 text-amber-400" />
            Standard Tournament
          </h2>
          <div className="text-xs text-stone-500">Swiss constructed, best of three, match-point standings</div>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[40px] items-center gap-2 rounded-lg bg-stone-700 px-3 py-2 text-sm text-stone-200 hover:bg-stone-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
      </div>

      {phase === 'setup' && (
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm text-stone-400">Players</label>
            <div className="flex flex-wrap gap-2">
              {PLAYER_COUNTS.map(count => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setPlayerCount(count)}
                  className={`min-h-[42px] rounded-lg px-3 py-2 text-sm font-bold ${
                    playerCount === count
                      ? 'bg-amber-600 text-white'
                      : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                  }`}
                >
                  <Users className="mr-1 inline h-4 w-4" />
                  {count}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-2 block text-sm text-stone-400">Swiss Rounds</span>
              <input
                type="number"
                min={3}
                max={9}
                value={roundCount}
                onChange={event => setRoundCount(Math.max(3, Number(event.target.value) || 3))}
                className="min-h-[44px] w-full rounded-lg border border-stone-600 bg-stone-700 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-stone-400">Games To Win</span>
              <input
                type="number"
                min={1}
                max={3}
                value={matchWinsRequired}
                onChange={event => setMatchWinsRequired(Math.max(1, Number(event.target.value) || 2))}
                className="min-h-[44px] w-full rounded-lg border border-stone-600 bg-stone-700 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-stone-400">Round Minutes</span>
              <input
                type="number"
                min={40}
                max={120}
                value={roundMinutes}
                onChange={event => setRoundMinutes(Math.max(40, Number(event.target.value) || 50))}
                className="min-h-[44px] w-full rounded-lg border border-stone-600 bg-stone-700 px-3 py-2 text-sm text-stone-100 focus:border-amber-500 focus:outline-none"
              />
            </label>
          </div>

          <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-3">
            <div className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400">Deck Registration</div>
            <textarea
              value={deckText}
              onChange={event => setDeckText(event.target.value)}
              rows={6}
              placeholder={"4 Monastery Swiftspear\n4 Lightning Strike\n...\n\nSideboard\n3 Negate"}
              className="mb-2 w-full rounded-lg border border-stone-700 bg-stone-800 px-3 py-2 font-mono text-sm text-stone-100 placeholder-stone-500 focus:border-amber-500 focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={importStandardDeck}
                disabled={isImporting || !deckText.trim()}
                className="min-h-[40px] rounded-lg bg-stone-700 px-3 py-2 text-sm font-bold text-stone-100 hover:bg-stone-600 disabled:bg-stone-700/50 disabled:text-stone-500"
              >
                {isImporting ? <Loader2 className="mr-1 inline h-4 w-4 animate-spin" /> : null}
                Check Standard Deck
              </button>
              {deckStatus && (
                <span className={`text-sm ${deckStatus.valid ? 'text-green-300' : 'text-red-300'}`}>
                  {deckStatus.message}
                </span>
              )}
            </div>
          </div>

          {registeredDeck && sideboardStatus && (
            <div className="rounded-lg border border-neutral-700 bg-neutral-900 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-amber-400">Between-Game Sideboarding</div>
                  <div className="text-sm text-stone-400">
                    Main {sideboardStatus.mainCount} / Side {sideboardStatus.sideboardCount}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded border border-neutral-700 px-2 py-1 text-xs text-stone-300">Outside-game effects only</span>
                  <span className="rounded border border-neutral-700 px-2 py-1 text-xs text-stone-300">No one-for-one requirement</span>
                  <button
                    type="button"
                    onClick={resetSideboarding}
                    className="min-h-[32px] rounded bg-stone-700 px-2 py-1 text-xs font-bold text-stone-100 hover:bg-stone-600"
                  >
                    Reset
                  </button>
                </div>
              </div>

              {!sideboardStatus.valid && (
                <div className="mb-3 rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">
                  {sideboardStatus.errors.slice(0, 2).join(' ')}
                </div>
              )}
              {sideboardMessage && (
                <div className="mb-3 rounded border border-amber-800 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
                  {sideboardMessage}
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                <CardCountList
                  title="Main Deck"
                  cards={registeredDeck.mainDeck}
                  actionLabel="Side"
                  onMove={name => moveSideboardCard(name, 'to-sideboard')}
                />
                <CardCountList
                  title="Sideboard"
                  cards={registeredDeck.sideboard}
                  actionLabel="Main"
                  onMove={name => moveSideboardCard(name, 'to-main')}
                />
              </div>
            </div>
          )}

          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">Minimum players: 4</div>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">Minimum rounds: 3</div>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">Round time: {roundMinutes}m</div>
          </div>

          <button
            type="button"
            onClick={startTournament}
            disabled={!registeredDeck || !sideboardStatus?.valid}
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-lg font-bold text-white transition-colors hover:bg-red-500 disabled:bg-stone-600 disabled:text-stone-400"
          >
            <Shuffle className="h-5 w-5" />
            {registeredDeck ? 'Start Swiss Tournament' : 'Register Deck First'}
          </button>
        </div>
      )}

      {phase !== 'setup' && (
        <div className="space-y-5">
          <div className="grid gap-2 text-sm sm:grid-cols-5">
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              Round <span className="font-bold text-amber-300">{Math.min(currentRound, roundCount)}/{roundCount}</span>
            </div>
            <div className={`rounded border px-3 py-2 ${timeCalled ? 'border-red-700 bg-red-950/40 text-red-100' : 'border-neutral-700 bg-neutral-900'}`}>
              <Clock className="mr-1 inline h-4 w-4" />
              {phase === 'complete' ? 'Final' : timeCalled ? 'Time' : formatClock(secondsRemaining)}
            </div>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              Match <span className="font-bold text-amber-300">first to {matchWinsRequired}</span>
            </div>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              Result <span className="font-bold text-amber-300">{phase === 'complete' ? 'complete' : allCurrentMatchesReported ? 'ready' : 'open'}</span>
            </div>
            <div className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2">
              Deck <span className="font-bold text-amber-300">{registeredDeck ? `${registeredDeck.mainDeck.length}/${registeredDeck.sideboard.length}` : '-'}</span>
            </div>
          </div>

          {phase === 'running' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setTimeExtensionMinutes(prev => prev + 1)}
                className="min-h-[40px] rounded-lg bg-stone-700 px-3 py-2 text-sm font-bold text-stone-100 hover:bg-stone-600"
              >
                +1 Min Extension
              </button>
              <button
                type="button"
                onClick={() => setTimeCalled(true)}
                className="min-h-[40px] rounded-lg bg-red-900/70 px-3 py-2 text-sm font-bold text-red-100 hover:bg-red-800"
              >
                Call Time
              </button>
              <button
                type="button"
                onClick={autoReportAiMatches}
                className="min-h-[40px] rounded-lg bg-stone-700 px-3 py-2 text-sm font-bold text-stone-100 hover:bg-stone-600"
              >
                Auto AI Tables
              </button>
            </div>
          )}

          {phase === 'running' && (
            <div className="overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900">
              <div className="border-b border-neutral-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                Pairings
              </div>
              <div className="divide-y divide-neutral-800">
                {currentMatches.map(match => (
                  <div key={match.id} className="grid gap-2 p-3 text-sm lg:grid-cols-[80px_1fr_90px_420px] lg:items-center">
                    <div className="text-stone-500">Table {match.table}</div>
                    <div className="min-w-0">
                      <div className="font-bold text-stone-100">
                        {playerName(match.player1Id)} {match.player2Id ? `vs ${playerName(match.player2Id)}` : 'bye'}
                      </div>
                      {match.playDrawChooserId && (
                        <div className="text-xs text-stone-500">{playerName(match.playDrawChooserId)} chooses play/draw</div>
                      )}
                    </div>
                    <div className="font-mono text-amber-200">{matchScore(match)}</div>
                    <div className="flex flex-wrap gap-1">
                      {!match.isBye && match.player2Id && (
                        <>
                          {resultOptions(matchWinsRequired).map(option => (
                            <button
                              key={`${match.id}-${option.label}`}
                              type="button"
                              onClick={() => updateMatch(
                                match.id,
                                option.player1Wins,
                                option.player2Wins,
                                option.gameDraws || 0,
                              )}
                              className={resultButtonClass(option.tone)}
                            >
                              {option.label}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-neutral-700 bg-neutral-900">
            <div className="border-b border-neutral-700 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-400">
              Standings
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-stone-500">
                  <tr>
                    <th className="px-3 py-2">Rank</th>
                    <th className="px-3 py-2">Player</th>
                    <th className="px-3 py-2">Record</th>
                    <th className="px-3 py-2">MP</th>
                    <th className="px-3 py-2">OMW%</th>
                    <th className="px-3 py-2">GW%</th>
                    <th className="px-3 py-2">OGW%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800">
                  {standings.map(standing => (
                    <tr key={standing.player.id}>
                      <td className="px-3 py-2 font-bold text-stone-300">{standing.rank}</td>
                      <td className="px-3 py-2 font-bold text-stone-100">{standing.player.name}</td>
                      <td className="px-3 py-2 font-mono text-stone-300">{recordLabel(standing)}</td>
                      <td className="px-3 py-2 font-mono text-amber-200">{standing.matchPoints}</td>
                      <td className="px-3 py-2 font-mono text-stone-300">{formatPct(standing.omwp)}</td>
                      <td className="px-3 py-2 font-mono text-stone-300">{formatPct(standing.gwp)}</td>
                      <td className="px-3 py-2 font-mono text-stone-300">{formatPct(standing.ogwp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {phase === 'running' && (
            <button
              type="button"
              onClick={nextRound}
              disabled={!allCurrentMatchesReported}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-lg font-bold text-white transition-colors hover:bg-red-500 disabled:bg-stone-600 disabled:text-stone-400"
            >
              {currentRound >= roundCount ? 'Finish Tournament' : 'Pair Next Round'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
