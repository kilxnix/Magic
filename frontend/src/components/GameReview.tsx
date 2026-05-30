/**
 * GameReview -- post-game analysis component.
 *
 * Shows a turn-by-turn timeline with move ratings, counter analysis,
 * and an overall review confidence grade.
 */

import { useState, useMemo } from 'react';
import { X, ChevronRight } from 'lucide-react';
import type { GameLogEntry, SimpleGameState } from '../hooks/useShelectorGame';
import { auditPlaySaveSnapshot } from '../lib/playSaveAudit';
import { ratingFromDecisionDelta } from '../lib/turnReview';
import type { EngineEventLogRecord, EngineStateUpdate, SerializedGameStateV1 } from 'commander-engine';

// ========== Rating Types ==========

type MoveRating = 'excellent' | 'good' | 'okay' | 'bad' | 'blunder';

interface RatedEntry extends GameLogEntry {
  rating: MoveRating;
  reasoning: string;
  counterAnalysis?: string;
}

function emptyReviewStats(finalState: SimpleGameState) {
  const human = finalState.humanPlayer;
  const ai = finalState.aiPlayer;
  return {
    manaAvailable: Object.values(finalState.manaPool).reduce((sum, value) => sum + value, 0),
    boardCreatureCount: {
      human: finalState.humanBattlefield.filter(card => card.cardTypes.includes('creature')).length,
      ai: finalState.aiBattlefield.filter(card => card.cardTypes.includes('creature')).length,
    },
    lifeTotals: { human: human.life, ai: ai.life },
    cardsInHand: { human: human.handCount, ai: ai.handCount },
  };
}

function authorityReviewEntries(
  authorityUpdates: EngineStateUpdate[],
  finalState: SimpleGameState,
): GameLogEntry[] {
  const stats = emptyReviewStats(finalState);
  const entries: GameLogEntry[] = [];

  authorityUpdates.forEach((update, updateIndex) => {
    update.rulesEvents.forEach((event, eventIndex) => {
      if (event.kind !== 'ActionRejected' && event.kind !== 'PromptResponseRejected' && event.kind !== 'PromptResponseAccepted') {
        return;
      }

      const isRejected = event.kind === 'ActionRejected' || event.kind === 'PromptResponseRejected';
      const action = event.kind === 'ActionRejected'
        ? `Rejected ${event.actionKind}`
        : event.kind === 'PromptResponseRejected'
          ? `Rejected ${event.promptKind} response`
          : `${event.promptKind} response accepted`;
      const reason = event.kind === 'PromptResponseAccepted'
        ? `${event.promptKind} response was accepted by the engine authority.`
        : event.message;

      entries.push({
        turnNumber: update.turnNumber,
        player: event.playerId === 'human' ? 'human' : 'ai',
        playerId: event.playerId,
        action,
        phase: update.phase,
        manaSpent: 0,
        timestamp: updateIndex * 1000 + eventIndex,
        playByPlay: reason,
        rulesAudit: {
          severity: isRejected ? 'error' : 'info',
          reason,
        },
        ...stats,
      });
    });
  });

  return entries;
}

function replayAuditReviewEntry(
  eventLog: EngineEventLogRecord[] | undefined,
  eventLogSeeds: Record<number, SerializedGameStateV1> | undefined,
  eventLogInitialState: SerializedGameStateV1 | null | undefined,
  finalState: SimpleGameState,
): GameLogEntry[] {
  if (!eventLogInitialState && (!eventLog || eventLog.length === 0)) return [];

  const audit = auditPlaySaveSnapshot({
    engineEventLog: eventLog || [],
    engineEventLogSeeds: eventLogSeeds,
    engineEventLogInitialState: eventLogInitialState,
  });
  const stats = emptyReviewStats(finalState);

  return [{
    turnNumber: finalState.turnNumber,
    player: 'human',
    playerId: finalState.humanPlayer.id,
    action: audit.ok
      ? `Replay audit passed (${audit.recordCount} records)`
      : 'Replay audit failed',
    phase: finalState.phase,
    manaSpent: 0,
    timestamp: Number.MAX_SAFE_INTEGER - 1,
    playByPlay: audit.message,
    rulesAudit: {
      severity: audit.ok ? 'info' : 'error',
      reason: audit.message,
    },
    ...stats,
  }];
}

// ========== Rating Config ==========

const RATING_DISPLAY: Record<MoveRating, { symbol: string; color: string; bgColor: string; label: string }> = {
  excellent: { symbol: '\u2605', color: 'text-green-400', bgColor: 'bg-green-900/30 border-green-700/50', label: 'Excellent' },
  good:      { symbol: '\u25CF', color: 'text-blue-400', bgColor: 'bg-blue-900/30 border-blue-700/50', label: 'Good' },
  okay:      { symbol: '\u25CB', color: 'text-stone-400', bgColor: 'bg-stone-800 border-stone-700', label: 'Okay' },
  bad:       { symbol: '\u2717', color: 'text-red-400', bgColor: 'bg-red-900/20 border-red-700/50', label: 'Bad' },
  blunder:   { symbol: '\u2717\u2717', color: 'text-red-500', bgColor: 'bg-red-900/40 border-red-600/50', label: 'Blunder' },
};

const REVIEW_PHASE_DISPLAY: Record<string, string> = {
  beginning: 'Beginning',
  precombat_main: 'Main Phase 1',
  combat: 'Combat',
  postcombat_main: 'Main Phase 2',
  ending: 'Ending',
};

function reviewPhaseLabel(phase: string): string {
  return REVIEW_PHASE_DISPLAY[phase] || phase;
}

// ========== Rating Heuristics ==========

function rateMove(entry: GameLogEntry, allEntries: GameLogEntry[], index: number): { rating: MoveRating; reasoning: string } {
  const action = entry.action.toLowerCase();
  const { player, manaAvailable, manaSpent, boardCreatureCount, lifeTotals, cardsInHand } = entry;

  if (entry.rulesAudit) {
    if (entry.rulesAudit.severity === 'error') {
      return { rating: 'blunder', reasoning: `Rules audit failed: ${entry.rulesAudit.reason}` };
    }
    if (entry.rulesAudit.severity === 'warning') {
      return { rating: 'bad', reasoning: `Rules audit warning: ${entry.rulesAudit.reason}` };
    }
    return { rating: 'okay', reasoning: `Rules audit: ${entry.rulesAudit.reason}` };
  }

  // Only rate human moves
  if (player !== 'human') {
    return { rating: 'okay', reasoning: 'AI action.' };
  }

  if (entry.decision) {
    const selectedIsBest = entry.decision.best?.label === entry.decision.selected.label && entry.decision.scoreDelta <= 0.5;
    const rating = ratingFromDecisionDelta(entry.decision.scoreDelta, selectedIsBest);
    const confidence = entry.decision.confidence;
    if (selectedIsBest) {
      return {
        rating,
        reasoning: `Best line found by ${entry.decision.evaluator}. Confidence: ${confidence}.`,
      };
    }
    if (entry.decision.best) {
      return {
        rating,
        reasoning: `${entry.decision.evaluator} preferred ${entry.decision.best.label} by ${entry.decision.scoreDelta.toFixed(1)} points. Confidence: ${confidence}.`,
      };
    }
  }

  // === PASS PRIORITY ===
  if (action === 'passed priority') {
    // Check if player had cards in hand and mana available
    if (cardsInHand.human > 1 && manaAvailable >= 2) {
      // Might be holding interaction -- check if there were threats
      if (boardCreatureCount.ai > boardCreatureCount.human) {
        return { rating: 'bad', reasoning: 'Passed with mana open and castable spells while behind on board -- missed tempo.' };
      }
      // Could be holding removal/counterspells -- okay play
      return { rating: 'okay', reasoning: 'Passed priority with cards in hand -- possibly holding interaction.' };
    }
    return { rating: 'okay', reasoning: 'Passed priority.' };
  }

  // === PLAY LAND ===
  if (action.startsWith('played ')) {
    const isLand = action.includes('plains') || action.includes('island') || action.includes('swamp') ||
      action.includes('mountain') || action.includes('forest') || action.includes('land');
    if (isLand || !action.includes('cast')) {
      // Check if on curve (turn number roughly matches available mana)
      if (entry.turnNumber <= 4) {
        return { rating: 'good', reasoning: 'Played a land on curve -- good tempo.' };
      }
      return { rating: 'good', reasoning: 'Land drop -- maintaining mana development.' };
    }
  }

  // === CAST SPELL ===
  if (action.startsWith('cast ')) {
    const spellName = action.replace('cast ', '');

    // Check if on curve (mana spent roughly matches available mana)
    const onCurve = manaSpent > 0 && manaSpent >= manaAvailable * 0.5;

    // Check if it's a removal spell that removes a bigger threat
    const isRemoval = spellName.includes('bolt') || spellName.includes('path') ||
      spellName.includes('swords') || spellName.includes('murder') ||
      spellName.includes('destroy') || spellName.includes('exile') ||
      spellName.includes('wrath') || spellName.includes('damnation');

    if (isRemoval && boardCreatureCount.ai > 0) {
      // Look ahead: did AI lose a creature?
      const nextEntries = allEntries.slice(index + 1, index + 5);
      const aiLostCreature = nextEntries.some(e =>
        e.boardCreatureCount.ai < boardCreatureCount.ai
      );
      if (aiLostCreature) {
        return { rating: 'excellent', reasoning: `Removed a threat with ${spellName} -- efficient answer.` };
      }
    }

    // Check if the spell was immediately countered or removed
    const nextEntry = allEntries[index + 1];
    if (nextEntry && nextEntry.player === 'ai') {
      const nextAction = nextEntry.action.toLowerCase();
      if (nextAction.includes('counter') || nextAction.includes('negate') ||
          nextAction.includes('cancel') || nextAction.includes('spell pierce')) {
        // Check if there was open blue mana we should have noticed
        return { rating: 'bad', reasoning: `Cast ${spellName} but it was immediately countered -- consider waiting for a safer window.` };
      }
    }

    // On curve cast
    if (onCurve && manaSpent >= 2) {
      return { rating: 'good', reasoning: `Cast ${spellName} on curve -- good mana utilization.` };
    }

    if (manaSpent > 0) {
      return { rating: 'good', reasoning: `Cast ${spellName} -- developing the board.` };
    }

    return { rating: 'okay', reasoning: `Cast ${spellName}.` };
  }

  // === ATTACK ===
  if (action.startsWith('attack')) {
    // Check if opponent had potential blockers
    if (boardCreatureCount.ai === 0) {
      return { rating: 'good', reasoning: 'Attacked into an open board -- free damage.' };
    }

    // Check if opponent lost life after this attack
    const nextEntries = allEntries.slice(index + 1, index + 4);
    const opponentTookDamage = nextEntries.some(e => e.lifeTotals.ai < lifeTotals.ai);
    if (opponentTookDamage) {
      return { rating: 'good', reasoning: 'Attacked and dealt damage.' };
    }

    // Attacked into blockers -- might be a bad trade
    if (boardCreatureCount.ai >= boardCreatureCount.human) {
      const nextCreatureCount = nextEntries.find(e => e.player === 'human')?.boardCreatureCount.human;
      if (nextCreatureCount !== undefined && nextCreatureCount < boardCreatureCount.human) {
        return { rating: 'bad', reasoning: 'Attacked into blockers and lost creatures -- consider a safer attack.' };
      }
    }

    return { rating: 'okay', reasoning: 'Attacked.' };
  }

  // === BLOCK ===
  if (action.startsWith('block')) {
    return { rating: 'okay', reasoning: 'Blocked to protect life total.' };
  }

  // === ACTIVATE ABILITY ===
  if (action.startsWith('activated')) {
    return { rating: 'good', reasoning: `${entry.action} -- using available resources.` };
  }

  // Default
  return { rating: 'okay', reasoning: entry.action };
}

/** Generate counter analysis for spell-casting entries */
function analyzeCounterPlay(entry: GameLogEntry, allEntries: GameLogEntry[], index: number): string | undefined {
  const action = entry.action.toLowerCase();
  if (!action.startsWith('cast ')) return undefined;

  const spellName = entry.action.replace(/^Cast /i, '');

  // Look at AI board state for blue mana indicators
  // In a real engine we'd check actual mana, but we use heuristics here
  const aiHadCards = entry.cardsInHand.ai > 0;

  if (entry.player === 'human') {
    // Check if the spell was countered
    const nextEntries = allEntries.slice(index + 1, index + 3);
    const wasCountered = nextEntries.some(e =>
      e.player === 'ai' && e.action.toLowerCase().includes('counter')
    );

    if (wasCountered) {
      return `Was countered -- opponent had cards in hand (${entry.cardsInHand.ai}) with potential interaction.`;
    }

    if (aiHadCards && entry.manaSpent >= 3) {
      // Expensive spell with AI having cards -- risky
      return `Could have been countered -- opponent had ${entry.cardsInHand.ai} card(s) in hand. Consider baiting counters with cheaper spells first.`;
    }

    if (!aiHadCards) {
      return `Safe to cast -- opponent had no cards in hand (no counter threat).`;
    }
  }

  if (entry.player === 'ai') {
    // Could the human have countered?
    if (entry.cardsInHand.human > 0 && entry.manaAvailable >= 2) {
      return `${spellName} resolved -- you had ${entry.cardsInHand.human} cards and mana available. Could you have countered?`;
    }
    return `${spellName} resolved -- no counter opportunity available.`;
  }

  return undefined;
}

// ========== Grade Calculation ==========

function calculateGrade(ratedEntries: RatedEntry[]): { grade: string; accuracy: number; counts: Record<MoveRating, number> } {
  const humanEntries = ratedEntries.filter(e => e.player === 'human');
  if (humanEntries.length === 0) {
    return { grade: 'N/A', accuracy: 0, counts: { excellent: 0, good: 0, okay: 0, bad: 0, blunder: 0 } };
  }

  const counts: Record<MoveRating, number> = { excellent: 0, good: 0, okay: 0, bad: 0, blunder: 0 };
  const scores: Record<MoveRating, number> = { excellent: 100, good: 80, okay: 60, bad: 30, blunder: 0 };

  let totalScore = 0;
  for (const entry of humanEntries) {
    counts[entry.rating]++;
    totalScore += scores[entry.rating];
  }

  const accuracy = Math.round(totalScore / humanEntries.length);

  let grade: string;
  if (accuracy >= 90) grade = 'A';
  else if (accuracy >= 80) grade = 'B';
  else if (accuracy >= 65) grade = 'C';
  else if (accuracy >= 50) grade = 'D';
  else grade = 'F';

  return { grade, accuracy, counts };
}

// ========== Component Props ==========

export interface GameReviewProps {
  gameLog: GameLogEntry[];
  finalState: SimpleGameState;
  winner: string | null;
  onClose: () => void;
  embedded?: boolean;
  authorityUpdates?: EngineStateUpdate[];
  engineEventLog?: EngineEventLogRecord[];
  engineEventLogSeeds?: Record<number, SerializedGameStateV1>;
  engineEventLogInitialState?: SerializedGameStateV1 | null;
}

// ========== Component ==========

export function GameReview({
  gameLog,
  finalState,
  winner,
  onClose,
  embedded = false,
  authorityUpdates = [],
  engineEventLog,
  engineEventLogSeeds,
  engineEventLogInitialState,
}: GameReviewProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [filterPlayer, setFilterPlayer] = useState<'all' | 'human' | 'ai'>('human');

  const reviewLog = useMemo(() => {
    const authorityEntries = authorityReviewEntries(authorityUpdates, finalState);
    const replayEntries = replayAuditReviewEntry(engineEventLog, engineEventLogSeeds, engineEventLogInitialState, finalState);
    return [...gameLog, ...authorityEntries, ...replayEntries];
  }, [authorityUpdates, engineEventLog, engineEventLogInitialState, engineEventLogSeeds, finalState, gameLog]);

  // Rate all entries
  const ratedEntries = useMemo(() => {
    return reviewLog.map((entry, i) => {
      const { rating, reasoning } = rateMove(entry, reviewLog, i);
      const counterAnalysis = analyzeCounterPlay(entry, reviewLog, i);
      return { ...entry, rating, reasoning, counterAnalysis } as RatedEntry;
    });
  }, [reviewLog]);

  // Calculate summary
  const { grade, accuracy, counts } = useMemo(() => calculateGrade(ratedEntries), [ratedEntries]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    if (filterPlayer === 'all') return ratedEntries;
    return ratedEntries.filter(e => e.player === filterPlayer);
  }, [ratedEntries, filterPlayer]);

  // Group entries by turn
  const turnGroups = useMemo(() => {
    const groups = new Map<number, RatedEntry[]>();
    for (const entry of filteredEntries) {
      const existing = groups.get(entry.turnNumber) || [];
      existing.push(entry);
      groups.set(entry.turnNumber, existing);
    }
    return groups;
  }, [filteredEntries]);

  const selectedEntry = selectedIndex !== null ? ratedEntries[selectedIndex] : null;

  // Determine result text
  const isFinished = finalState.gameOver || winner !== null;
  const resultText = !isFinished
    ? 'In Progress'
    : winner === finalState.humanPlayer.id
    ? 'Victory'
    : winner === finalState.aiPlayer.id
    ? 'Defeat'
    : 'Draw';

  const resultColor = !isFinished
    ? 'text-amber-400'
    : winner === finalState.humanPlayer.id
    ? 'text-green-400'
    : winner === finalState.aiPlayer.id
    ? 'text-red-400'
    : 'text-stone-400';

  return (
    <div className={embedded
      ? 'h-full min-h-0 bg-stone-900 text-stone-100 flex flex-col overflow-hidden'
      : 'fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-4'
    }>
      <div className={embedded
        ? 'h-full min-h-0 w-full flex flex-col overflow-hidden'
        : 'bg-stone-900 border border-stone-700 rounded-2xl w-full max-w-5xl max-h-[95vh] flex flex-col overflow-hidden'
      }>
        {/* Header */}
        <div className="flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-stone-700">
          <div className="min-w-0 flex-1 mr-2">
            <h2 className="text-lg sm:text-xl font-serif font-semibold text-stone-100">Game Review</h2>
            <p className="text-xs sm:text-sm text-stone-400 mt-0.5 truncate">
              {finalState.humanCommander} vs {finalState.aiCommander}
            </p>
          </div>
          {!embedded && (
            <button
              onClick={onClose}
              className="p-2.5 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-700 transition-colors shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Close review"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Summary Bar */}
        <div className="px-3 sm:px-6 py-3 sm:py-4 border-b border-stone-700 bg-stone-800/50">
          <div className="flex flex-wrap items-center gap-3 sm:gap-6">
            {/* Result */}
            <div className="text-center">
              <div className={`text-xl sm:text-2xl font-bold ${resultColor}`}>{resultText}</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">Result</div>
            </div>

            {/* Grade */}
            <div className="text-center">
              <div className={`text-2xl sm:text-3xl font-bold ${
                grade === 'A' ? 'text-green-400' :
                grade === 'B' ? 'text-blue-400' :
                grade === 'C' ? 'text-yellow-400' :
                grade === 'D' ? 'text-orange-400' :
                'text-red-400'
              }`}>
                {grade}
              </div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">Grade</div>
            </div>

            {/* Review confidence */}
            <div className="text-center">
              <div className="text-xl sm:text-2xl font-bold text-stone-200">{accuracy}%</div>
              <div className="text-[10px] text-stone-500 uppercase tracking-wider">Review Confidence</div>
            </div>

            {/* Move counts */}
            <div className="flex gap-2 sm:gap-3 sm:ml-auto w-full sm:w-auto justify-between sm:justify-end mt-1 sm:mt-0">
              {(['excellent', 'good', 'okay', 'bad', 'blunder'] as MoveRating[]).map(r => (
                <div key={r} className="text-center min-w-[36px] sm:min-w-[48px]">
                  <div className={`text-base sm:text-lg font-bold ${RATING_DISPLAY[r].color}`}>
                    {counts[r]}
                  </div>
                  <div className="text-[8px] sm:text-[9px] text-stone-500 uppercase">{RATING_DISPLAY[r].label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Life total summary */}
          <div className="flex flex-wrap gap-2 sm:gap-4 mt-3 text-[10px] sm:text-xs text-stone-400">
            <span>{isFinished ? 'Final' : 'Current'} Life: You {finalState.humanPlayer.life} | AI {finalState.aiPlayer.life}</span>
            <span>Turns: {finalState.turnNumber}</span>
            <span>Moves: {ratedEntries.filter(e => e.player === 'human').length}h / {ratedEntries.filter(e => e.player === 'ai').length}ai</span>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex px-3 sm:px-6 py-2 border-b border-stone-700 gap-2">
          {(['human', 'ai', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilterPlayer(f)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors min-h-[40px] ${
                filterPlayer === f
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
              }`}
            >
              {f === 'human' ? 'Your Moves' : f === 'ai' ? 'AI Moves' : 'All Moves'}
            </button>
          ))}
        </div>

        {/* Main Content: Timeline + Detail */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* Timeline (left on desktop, full-width on mobile) */}
          <div className="flex-1 md:flex-[3] overflow-y-auto md:border-r border-stone-700">
            {filteredEntries.length === 0 ? (
              <div className="flex items-center justify-center h-32 md:h-full text-stone-500 text-sm">
                No moves to review.
              </div>
            ) : (
              <div className="divide-y divide-stone-800">
                {[...turnGroups.entries()].map(([turnNum, entries]) => (
                  <div key={turnNum}>
                    {/* Turn header */}
                    <div className="px-3 sm:px-4 py-1.5 bg-stone-800/50 text-[10px] font-semibold text-stone-500 uppercase tracking-wider">
                      Turn {turnNum}
                    </div>
                    {entries.map((entry) => {
                      const globalIndex = ratedEntries.indexOf(entry);
                      const display = RATING_DISPLAY[entry.rating];
                      const isSelected = selectedIndex === globalIndex;
                      return (
                        <div key={`${entry.turnNumber}-${entry.timestamp}-${globalIndex}`}>
                          <button
                            onClick={() => setSelectedIndex(isSelected ? null : globalIndex)}
                            className={`w-full text-left px-3 sm:px-4 py-2.5 flex items-center gap-2 sm:gap-3 transition-colors min-h-[44px]
                              ${isSelected ? 'bg-stone-700/60' : 'hover:bg-stone-800/60'}
                            `}
                          >
                            {/* Rating symbol */}
                            <span className={`text-lg font-bold w-7 text-center shrink-0 ${display.color}`}>
                              {display.symbol}
                            </span>

                            {/* Action */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase shrink-0 ${
                                  entry.player === 'human'
                                    ? 'bg-blue-900/40 text-blue-300'
                                    : 'bg-red-900/40 text-red-300'
                                }`}>
                                  {entry.player === 'human' ? 'You' : 'AI'}
                                </span>
                                {entry.rulesAudit && (
                                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                    entry.rulesAudit.severity === 'error'
                                      ? 'bg-red-900/50 text-red-200'
                                      : entry.rulesAudit.severity === 'warning'
                                        ? 'bg-amber-900/50 text-amber-200'
                                        : 'bg-sky-900/40 text-sky-200'
                                  }`}>
                                    Rules
                                  </span>
                                )}
                                <span className="text-xs sm:text-sm text-stone-200 truncate">
                                  {entry.action}
                                </span>
                              </div>
                              <div className="text-[10px] text-stone-500 mt-0.5">
                                Life: {entry.lifeTotals.human}/{entry.lifeTotals.ai}
                                {entry.manaSpent > 0 && ` | Mana: ${entry.manaSpent}`}
                                {' | '}Board: {entry.boardCreatureCount.human}v{entry.boardCreatureCount.ai}
                              </div>
                              {entry.playByPlay && (
                                <div className="mt-1 truncate text-[10px] text-stone-400">
                                  {entry.playByPlay}
                                </div>
                              )}
                            </div>

                            {/* Chevron */}
                            <ChevronRight className={`w-4 h-4 text-stone-600 shrink-0 transition-transform ${
                              isSelected ? 'rotate-90' : ''
                            }`} />
                          </button>

                          {/* Inline detail on mobile (shown below the selected entry) */}
                          {isSelected && selectedEntry && (
                            <div className="md:hidden px-3 py-3 bg-stone-800/50 border-t border-stone-700/50 space-y-3">
                              {/* Rating reasoning */}
                              <div className={`rounded-lg border px-3 py-2 ${RATING_DISPLAY[selectedEntry.rating].bgColor}`}>
                                <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-1">
                                  Analysis
                                </div>
                                <p className="text-xs text-stone-200 leading-relaxed">
                                  {selectedEntry.reasoning}
                                </p>
                              </div>

                              {selectedEntry.rulesAudit && (
                                <div className="rounded-lg border border-sky-700/50 bg-sky-950/20 px-3 py-2">
                                  <div className="text-[10px] font-semibold text-sky-300 uppercase tracking-wider mb-1">
                                    Rules Audit
                                  </div>
                                  <p className="text-xs text-stone-200 leading-relaxed">
                                    {selectedEntry.rulesAudit.reason}
                                  </p>
                                </div>
                              )}

                              {selectedEntry.decision && (
                                <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/20 px-3 py-2">
                                  <div className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider mb-1">
                                    Play-by-play
                                  </div>
                                  <p className="text-xs text-stone-200 leading-relaxed">
                                    {selectedEntry.playByPlay}
                                  </p>
                                  {selectedEntry.decision.best && (
                                    <div className="mt-2 text-[10px] text-stone-400">
                                      Best line: <span className="font-semibold text-stone-200">{selectedEntry.decision.best.label}</span>
                                      {' '}({selectedEntry.decision.best.score})
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Counter Analysis */}
                              {selectedEntry.counterAnalysis && (
                                <div className="rounded-lg border border-purple-700/50 bg-purple-900/20 px-3 py-2">
                                  <div className="text-[10px] font-semibold text-purple-300 uppercase tracking-wider mb-1">
                                    Counter Analysis
                                  </div>
                                  <p className="text-xs text-stone-200 leading-relaxed">
                                    {selectedEntry.counterAnalysis}
                                  </p>
                                </div>
                              )}

                              {/* Board snapshot (compact) */}
                              <div className="rounded-lg border border-stone-700 bg-stone-800 px-3 py-2">
                                <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mb-1">
                                  Board State
                                </div>
                                <div className="grid grid-cols-2 gap-1.5 text-xs">
                                  <div>
                                    <span className="text-stone-500">Life:</span>{' '}
                                    <span className="text-stone-200 font-semibold">{selectedEntry.lifeTotals.human}/{selectedEntry.lifeTotals.ai}</span>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Board:</span>{' '}
                                    <span className="text-stone-200 font-semibold">{selectedEntry.boardCreatureCount.human}v{selectedEntry.boardCreatureCount.ai}</span>
                                  </div>
                                  <div>
                                    <span className="text-stone-500">Hand:</span>{' '}
                                    <span className="text-stone-200 font-semibold">{selectedEntry.cardsInHand.human}/{selectedEntry.cardsInHand.ai}</span>
                                  </div>
                                  {(selectedEntry.manaAvailable > 0 || selectedEntry.manaSpent > 0) && (
                                    <div>
                                      <span className="text-stone-500">Mana:</span>{' '}
                                      <span className="text-stone-200 font-semibold">
                                        {selectedEntry.manaAvailable > 0 && `${selectedEntry.manaAvailable} avail`}
                                        {selectedEntry.manaAvailable > 0 && selectedEntry.manaSpent > 0 && ' / '}
                                        {selectedEntry.manaSpent > 0 && `${selectedEntry.manaSpent} spent`}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Detail Panel (right, hidden on mobile -- details shown inline above) */}
          <div className="hidden md:block flex-[2] overflow-y-auto bg-stone-800/30 p-6">
            {selectedEntry ? (
              <div className="space-y-4">
                {/* Move header */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-2xl font-bold ${RATING_DISPLAY[selectedEntry.rating].color}`}>
                      {RATING_DISPLAY[selectedEntry.rating].symbol}
                    </span>
                    <span className={`text-sm font-semibold ${RATING_DISPLAY[selectedEntry.rating].color}`}>
                      {RATING_DISPLAY[selectedEntry.rating].label}
                    </span>
                  </div>
                  <h3 className="text-lg font-semibold text-stone-100">{selectedEntry.action}</h3>
                  <p className="text-xs text-stone-500 mt-1">
                    Turn {selectedEntry.turnNumber} | {reviewPhaseLabel(selectedEntry.phase)} | {selectedEntry.player === 'human' ? 'Your move' : 'AI move'}
                  </p>
                </div>

                {/* Rating reasoning */}
                <div className={`rounded-lg border px-4 py-3 ${RATING_DISPLAY[selectedEntry.rating].bgColor}`}>
                  <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-1">
                    Analysis
                  </div>
                  <p className="text-sm text-stone-200 leading-relaxed">
                    {selectedEntry.reasoning}
                  </p>
                </div>

                {selectedEntry.rulesAudit && (
                  <div className="rounded-lg border border-sky-700/50 bg-sky-950/20 px-4 py-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-sky-300">
                      Rules Audit
                    </div>
                    <p className="text-sm leading-relaxed text-stone-200">
                      {selectedEntry.rulesAudit.reason}
                    </p>
                  </div>
                )}

                {selectedEntry.decision && (
                  <div className="rounded-lg border border-emerald-700/50 bg-emerald-950/20 px-4 py-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-300">
                      Play-by-play Review
                    </div>
                    <p className="text-sm leading-relaxed text-stone-200">
                      {selectedEntry.playByPlay}
                    </p>
                    <div className="mt-3 grid gap-2 text-xs">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-stone-500">Chosen</span>
                        <span className="text-right font-semibold text-stone-200">
                          {selectedEntry.decision.selected.label} ({selectedEntry.decision.selected.score})
                        </span>
                      </div>
                      {selectedEntry.decision.best && (
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-stone-500">Best line</span>
                          <span className="text-right font-semibold text-emerald-200">
                            {selectedEntry.decision.best.label} ({selectedEntry.decision.best.score})
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-stone-500">Confidence</span>
                        <span className="font-semibold text-stone-200">
                          {selectedEntry.decision.confidence}
                        </span>
                      </div>
                    </div>
                    {selectedEntry.decision.confidenceReasons.length > 0 && (
                      <p className="mt-2 text-xs leading-relaxed text-stone-400">
                        {selectedEntry.decision.confidenceReasons.join(' ')}
                      </p>
                    )}
                  </div>
                )}

                {/* Counter Analysis */}
                {selectedEntry.counterAnalysis && (
                  <div className="rounded-lg border border-purple-700/50 bg-purple-900/20 px-4 py-3">
                    <div className="text-xs font-semibold text-purple-300 uppercase tracking-wider mb-1">
                      Counter Analysis
                    </div>
                    <p className="text-sm text-stone-200 leading-relaxed">
                      {selectedEntry.counterAnalysis}
                    </p>
                  </div>
                )}

                {/* Board snapshot */}
                <div className="rounded-lg border border-stone-700 bg-stone-800 px-4 py-3">
                  <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
                    Board State at Time of Action
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <span className="text-stone-500">Your Life:</span>{' '}
                      <span className="text-stone-200 font-semibold">{selectedEntry.lifeTotals.human}</span>
                    </div>
                    <div>
                      <span className="text-stone-500">AI Life:</span>{' '}
                      <span className="text-stone-200 font-semibold">{selectedEntry.lifeTotals.ai}</span>
                    </div>
                    <div>
                      <span className="text-stone-500">Your Creatures:</span>{' '}
                      <span className="text-stone-200 font-semibold">{selectedEntry.boardCreatureCount.human}</span>
                    </div>
                    <div>
                      <span className="text-stone-500">AI Creatures:</span>{' '}
                      <span className="text-stone-200 font-semibold">{selectedEntry.boardCreatureCount.ai}</span>
                    </div>
                    <div>
                      <span className="text-stone-500">Your Hand:</span>{' '}
                      <span className="text-stone-200 font-semibold">{selectedEntry.cardsInHand.human} cards</span>
                    </div>
                    <div>
                      <span className="text-stone-500">AI Hand:</span>{' '}
                      <span className="text-stone-200 font-semibold">{selectedEntry.cardsInHand.ai} cards</span>
                    </div>
                    {selectedEntry.manaAvailable > 0 && (
                      <div>
                        <span className="text-stone-500">Mana Available:</span>{' '}
                        <span className="text-stone-200 font-semibold">{selectedEntry.manaAvailable}</span>
                      </div>
                    )}
                    {selectedEntry.manaSpent > 0 && (
                      <div>
                        <span className="text-stone-500">Mana Spent:</span>{' '}
                        <span className="text-stone-200 font-semibold">{selectedEntry.manaSpent}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-stone-500 text-sm">
                Select a move to view detailed analysis.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
