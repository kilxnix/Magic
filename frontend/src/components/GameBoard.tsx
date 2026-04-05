/**
 * GameBoard -- visual game board for the Shelector game.
 *
 * Shows phase bar, AI side, stack, human battlefield, and human hand.
 * Dark theme with stone color palette.
 * Mobile-responsive: compact cards, horizontal scroll hand, touch-friendly buttons.
 */

import { useState } from 'react';
import type { SimpleGameState, SimpleLegalAction, SimpleCard } from '../hooks/useShelectorGame';
import { Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { CardPickerModal } from './CardPickerModal';

// Phase display names
const PHASE_DISPLAY: Record<string, string> = {
  beginning: 'Upkeep',
  precombat_main: 'Main Phase 1',
  combat: 'Combat',
  postcombat_main: 'Main Phase 2',
  ending: 'End / Discard',
};

const STEP_DISPLAY: Record<string, string> = {
  untap: 'Untap',
  upkeep: 'Upkeep',
  draw: 'Draw',
  main: 'Main Phase',
  begin_combat: 'Begin Combat',
  declare_attackers: 'Declare Attackers',
  declare_blockers: 'Declare Blockers',
  first_strike_damage: 'First Strike Damage',
  combat_damage: 'Combat Damage',
  end_of_combat: 'End of Combat',
  end: 'End Step',
  cleanup: 'Cleanup / Discard',
};

const MANA_COLORS: { key: string; label: string; color: string }[] = [
  { key: 'W', label: 'W', color: 'text-amber-100' },
  { key: 'U', label: 'U', color: 'text-blue-400' },
  { key: 'B', label: 'B', color: 'text-gray-400' },
  { key: 'R', label: 'R', color: 'text-red-400' },
  { key: 'G', label: 'G', color: 'text-green-400' },
  { key: 'C', label: 'C', color: 'text-stone-400' },
];

interface GameBoardProps {
  gameState: SimpleGameState;
  legalActions: SimpleLegalAction[];
  isHumanTurn: boolean;
  isLoading: boolean;
  onAction: (action: SimpleLegalAction) => void;
  mulliganPhase?: boolean;
  mulliganCount?: number;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  discardPhase?: boolean;
  discardCount?: number;
  onDiscardCard?: (cardInstanceId: string) => void;
  tutorPhase?: boolean;
  tutorCards?: { instanceId: string; name: string; typeLine: string; manaCost: string }[];
  tutorTitle?: string;
  onTutorPick?: (cardInstanceId: string) => void;
  undosRemaining?: number;
  onUndo?: () => void;
  coachMode?: boolean;
  onToggleCoach?: (on: boolean) => void;
  onUntapMana?: (cardInstanceId: string) => void;
  untappableCardIds?: string[];
}

/** Compute counter badge entries from a card's counters record */
function getCounterBadges(counters: Record<string, number>): { label: string; count: number }[] {
  return Object.entries(counters)
    .filter(([, v]) => v > 0)
    .map(([key, count]) => ({ label: key, count }));
}

// ========== Counter Probability System ==========

/** Parse a mana cost string like "{2}{U}{U}" into a CMC number */
function parseCmc(manaCost: string): number {
  if (!manaCost) return 0;
  let cmc = 0;
  const matches = manaCost.matchAll(/\{([^}]+)\}/g);
  for (const m of matches) {
    const val = m[1];
    const num = parseInt(val, 10);
    if (!isNaN(num)) {
      cmc += num;
    } else if (val === 'X') {
      // X doesn't add to CMC for probability purposes
    } else {
      // Color symbols ({W}, {U}, {B}, {R}, {G}), hybrid, etc. each count as 1
      cmc += 1;
    }
  }
  return cmc;
}

/** Check if a land card can produce blue mana based on its oracle text */
function canProduceBlue(card: SimpleCard): boolean {
  const text = card.oracleText.toLowerCase();
  // Check for explicit blue mana production
  if (text.includes('add {u}')) return true;
  if (text.includes('add one mana of any color')) return true;
  if (text.includes('add one mana of any type')) return true;
  // Dual-land patterns like "add {u} or {w}"
  if (/add \{[wubrg]\}[^.]*\{u\}/i.test(card.oracleText)) return true;
  if (/add \{u\}[^.]*\{[wubrg]\}/i.test(card.oracleText)) return true;
  return false;
}

/** Compute counter-spell probability from the current game state */
function getCounterProbability(
  gameState: SimpleGameState,
  spellCmc: number,
): { prob: number; risk: 'safe' | 'risky' | 'dangerous'; color: string } {
  // Find AI's untapped lands on the battlefield
  const aiUntappedLands = gameState.aiBattlefield.filter(
    c => c.cardTypes.includes('land') && !c.tapped,
  );
  const untappedCount = aiUntappedLands.length;
  const handCount = gameState.aiPlayer.handCount;

  // Check if AI has blue mana sources among untapped lands
  const blueSourceCount = aiUntappedLands.filter(c => canProduceBlue(c)).length;
  const hasBlue = blueSourceCount > 0;

  // If AI has no blue or no cards in hand, probability is 0
  if (!hasBlue || handCount === 0) {
    return { prob: 0, risk: 'safe', color: 'text-green-400' };
  }

  // Base probability by untapped land count (blue available)
  let baseProb = 0;
  if (hasBlue && untappedCount >= 1) {
    baseProb = 15; // Could have Swan Song ({U})
  }
  if (hasBlue && untappedCount >= 2) {
    baseProb = 30; // Could have Counterspell ({U}{U}) or Negate ({1}{U})
  }
  if (hasBlue && untappedCount >= 3) {
    baseProb = 35; // Could have Dissolve, Cancel, etc.
  }

  // Force of Will is always possible with blue cards in hand (free counter)
  // Add a small bump if AI has 2+ cards (needs to exile a blue card)
  if (hasBlue && handCount >= 2) {
    baseProb = Math.max(baseProb, 20);
  }

  // Adjust by hand size (more cards = more likely one is a counter)
  const handFactor = Math.min(handCount / 7, 1.5);
  baseProb *= handFactor;

  // Adjust by spell value (expensive spells get countered more aggressively)
  if (spellCmc >= 6) {
    baseProb *= 1.3;
  } else if (spellCmc >= 4) {
    baseProb *= 1.1;
  } else if (spellCmc <= 1) {
    baseProb *= 0.7;
  }

  // Cap at 75% (never certain)
  const probability = Math.round(Math.min(baseProb, 75));

  // Determine risk level and color
  let risk: 'safe' | 'risky' | 'dangerous';
  let color: string;
  if (probability < 20) {
    risk = 'safe';
    color = 'text-green-400';
  } else if (probability < 50) {
    risk = 'risky';
    color = 'text-yellow-400';
  } else {
    risk = 'dangerous';
    color = 'text-red-400';
  }

  return { prob: probability, risk, color };
}

function CardTile({
  card,
  playable,
  onClick,
  compact,
}: {
  card: SimpleCard;
  playable: boolean;
  onClick?: () => void;
  compact?: boolean;
}) {
  const isCreature = card.cardTypes.includes('creature');
  const isLand = card.cardTypes.includes('land');
  const counterBadges = getCounterBadges(card.counters);
  // Mobile: even smaller cards; desktop: normal sizes
  const w = compact
    ? 'w-[4.5rem] h-24 md:w-24 md:h-32'
    : 'w-20 h-28 md:w-28 md:h-40';

  // Border color: playable > token > default
  const borderClass = playable
    ? 'border-green-500 bg-stone-700 hover:bg-stone-600 cursor-pointer ring-1 ring-green-500/50 shadow-lg shadow-green-900/20'
    : card.isToken
      ? 'border-violet-500 bg-stone-800 cursor-default ring-1 ring-violet-500/30'
      : 'border-stone-600 bg-stone-800 cursor-default';

  return (
    <button
      onClick={onClick}
      disabled={!playable && !onClick}
      className={`
        relative flex flex-col justify-between
        ${w} rounded-lg border p-1.5 md:p-2 text-left text-[10px] md:text-xs transition-all shrink-0
        ${card.tapped ? 'rotate-6 opacity-60' : ''}
        ${borderClass}
      `}
    >
      {/* Card name */}
      <div className="font-semibold text-stone-100 leading-tight truncate text-[10px] md:text-xs">
        {card.name}
      </div>

      {/* Mana cost */}
      {card.manaCost && (
        <div className="text-stone-400 text-[8px] md:text-[10px] mt-0.5">
          {card.manaCost}
        </div>
      )}

      {/* Type line */}
      <div className="text-stone-400 text-[8px] md:text-[10px] mt-0.5 md:mt-1 truncate">
        {card.typeLine}
      </div>

      {/* Oracle text preview (hand cards only, not compact) */}
      {!compact && card.oracleText && (
        <div className="text-stone-400 text-[7px] md:text-[9px] mt-0.5 leading-tight line-clamp-2">
          {card.oracleText}
        </div>
      )}

      {/* Power/Toughness or Land indicator */}
      <div className="mt-auto pt-0.5 md:pt-1">
        {isCreature && card.power != null && card.toughness != null && (
          <div className="text-right text-stone-200 font-bold text-xs md:text-sm">
            {card.power}/{card.toughness}
          </div>
        )}
        {isLand && (
          <div className="text-right text-stone-500 text-[8px] md:text-[10px] italic">
            Land
          </div>
        )}
      </div>

      {/* Tapped indicator */}
      {card.tapped && (
        <div className="absolute top-1 right-1 text-[7px] md:text-[8px] text-stone-500 italic">
          tapped
        </div>
      )}

      {/* Counter badges (top-right, stacked below tapped indicator) */}
      {counterBadges.length > 0 && (
        <div className={`absolute ${card.tapped ? 'top-4' : 'top-1'} right-1 flex flex-col gap-0.5`}>
          {counterBadges.map(({ label, count }) => (
            <div
              key={label}
              className="bg-green-700 text-green-100 text-[7px] md:text-[8px] font-bold px-1 py-px rounded leading-tight whitespace-nowrap"
            >
              {label === '+1/+1' || label === '-1/-1' ? `${label}: ${count}` : `${label}: ${count}`}
            </div>
          ))}
        </div>
      )}

      {/* Token badge */}
      {card.isToken && (
        <div className="absolute top-1 left-1 text-[7px] md:text-[8px] text-violet-300 font-bold bg-violet-900/70 px-1 rounded">
          TOKEN
        </div>
      )}

      {/* Commander badge */}
      {card.isCommander && (
        <div className="absolute bottom-1 right-1 text-[7px] md:text-[8px] text-amber-400 font-bold">
          CMD
        </div>
      )}

      {/* Playable glow */}
      {playable && (
        <div className="absolute inset-0 rounded-lg border-2 border-green-400/40 pointer-events-none" />
      )}

      {/* Attachments (equipment/auras) */}
      {card.attachments && card.attachments.length > 0 && (
        <div className="absolute -bottom-1 left-0 right-0 flex flex-col items-center gap-px">
          {card.attachments.map(att => (
            <div
              key={att.instanceId}
              className="bg-amber-800/90 border border-amber-600/50 text-amber-200 text-[6px] md:text-[7px] font-bold px-1 py-px rounded-sm leading-tight truncate max-w-full"
              title={att.oracleText}
            >
              {att.name}
            </div>
          ))}
        </div>
      )}
    </button>
  );
}

/** Expandable graveyard viewer */
function GraveyardViewer({ cards, label }: { cards: SimpleCard[]; label: string }) {
  const [expanded, setExpanded] = useState(false);

  if (cards.length === 0) return null;

  return (
    <div className="mt-1 relative">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-1 text-stone-500 hover:text-stone-300 text-[10px] md:text-xs transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronRight className="w-3 h-3" />}
        <span>{label} Graveyard: {cards.length}</span>
      </button>
      {expanded && (
        <div className="mt-1 bg-stone-800 border border-stone-700 rounded-lg p-2 max-h-32 overflow-y-auto z-10 relative">
          {cards.map((card, i) => (
            <div
              key={card.instanceId}
              className="text-stone-300 text-[10px] md:text-xs py-0.5 border-b border-stone-700/50 last:border-0 flex items-center justify-between gap-2"
            >
              <span className="truncate">{i + 1}. {card.name}</span>
              {card.typeLine && (
                <span className="text-stone-500 text-[8px] md:text-[10px] shrink-0 truncate max-w-[80px]">
                  {card.typeLine}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GameBoard({
  gameState,
  legalActions,
  isHumanTurn,
  isLoading,
  onAction,
  mulliganPhase,
  mulliganCount,
  onKeepHand,
  onMulligan,
  discardPhase,
  discardCount,
  onDiscardCard,
  tutorPhase,
  tutorCards,
  tutorTitle,
  onTutorPick,
  undosRemaining,
  onUndo,
  coachMode,
  onToggleCoach,
  onUntapMana,
  untappableCardIds,
}: GameBoardProps) {
  // Build set of playable card instance IDs
  const playableIds = new Set(
    legalActions
      .filter(a => a.cardInstanceId)
      .map(a => a.cardInstanceId!)
  );

  const passAction = legalActions.find(a => a.kind === 'PassPriority');

  // Find non-card actions (declare attackers/blockers without a specific card)
  const combatActions = legalActions.filter(
    a => a.kind === 'DeclareAttackers' || a.kind === 'DeclareBlockers'
  );

  // Categorize actions for the unified action bar
  const castActions = legalActions.filter(a => a.kind === 'CastSpell');
  const playLandActions = legalActions.filter(a => a.kind === 'PlayLand');
  const manaActions = legalActions.filter(a => a.kind === 'ActivateManaAbility');
  const otherCardActions = legalActions.filter(
    a => a.cardInstanceId && !['CastSpell', 'PlayLand', 'ActivateManaAbility', 'PassPriority', 'DeclareAttackers', 'DeclareBlockers'].includes(a.kind)
  );
  const hasAnyAction = isHumanTurn && !gameState.gameOver && !mulliganPhase && (
    passAction || combatActions.length > 0 || castActions.length > 0 ||
    playLandActions.length > 0 || manaActions.length > 0 || otherCardActions.length > 0
  );

  const handleCardClick = (card: SimpleCard) => {
    // Find the first matching action for this card
    const action = legalActions.find(a => a.cardInstanceId === card.instanceId);
    if (action) {
      onAction(action);
    }
  };

  // Mana pool display
  const totalMana = Object.values(gameState.manaPool).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col h-full bg-stone-900 text-stone-200 overflow-hidden relative">
      {/* Tutor card picker overlay */}
      {tutorPhase && tutorCards && onTutorPick && (
        <CardPickerModal
          title={tutorTitle || 'Search your library'}
          cards={tutorCards}
          onPick={onTutorPick}
        />
      )}
      {/* Phase Bar -- compact on mobile */}
      <div className="flex items-center gap-1.5 md:gap-3 px-2 md:px-4 py-1.5 md:py-2 bg-stone-800 border-b border-stone-700 overflow-x-auto shrink-0">
        <span className="text-amber-400 font-semibold text-xs md:text-sm whitespace-nowrap">
          T{gameState.turnNumber}
        </span>
        <span className="text-stone-500 hidden md:inline">|</span>
        <div className="flex gap-0.5 md:gap-1">
          {Object.entries(PHASE_DISPLAY).map(([key, label]) => (
            <span
              key={key}
              className={`px-1.5 md:px-2 py-0.5 rounded text-[10px] md:text-xs whitespace-nowrap ${
                gameState.phase === key
                  ? 'bg-amber-600 text-white font-semibold'
                  : 'bg-stone-700 text-stone-400'
              }`}
            >
              {label}
            </span>
          ))}
        </div>
        <span className="text-stone-500 hidden md:inline">|</span>
        <span className="text-stone-400 text-[10px] md:text-xs whitespace-nowrap hidden sm:inline">
          {STEP_DISPLAY[gameState.step] || gameState.step}
        </span>
        <div className="ml-auto flex items-center gap-1.5 md:gap-2 shrink-0">
          {isLoading && <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin text-amber-400" />}
          <span className={`text-[10px] md:text-xs font-semibold px-1.5 md:px-2 py-0.5 rounded whitespace-nowrap ${
            isHumanTurn
              ? 'bg-green-800 text-green-200'
              : 'bg-red-900 text-red-300'
          }`}>
            {isHumanTurn ? 'Your Priority' : "AI's Turn"}
          </span>
          {onToggleCoach && (
            <button
              onClick={() => onToggleCoach(!coachMode)}
              className={`text-[10px] md:text-xs font-semibold px-1.5 md:px-2 py-0.5 rounded whitespace-nowrap transition-colors ${
                coachMode
                  ? 'bg-blue-800 text-blue-200'
                  : 'bg-stone-700 text-stone-500'
              }`}
              title="Coach mode: evaluates your plays and suggests better options"
            >
              Coach {coachMode ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
      </div>

      {/* AI Side */}
      <div className="px-2 md:px-4 py-2 md:py-3 border-b border-stone-700/50 shrink-0">
        <div className="flex items-center gap-2 md:gap-4 mb-1.5 md:mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-red-900 flex items-center justify-center text-red-300 font-bold text-xs md:text-sm">
              {gameState.aiPlayer.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="text-xs md:text-sm font-semibold text-stone-200 truncate max-w-[120px] md:max-w-[200px]">
                {gameState.aiPlayer.name}
              </div>
              <div className="text-[10px] md:text-xs text-stone-500">
                Hand: {gameState.aiPlayer.handCount}
                {' / '}
                Lib: {gameState.aiPlayer.libraryCount}
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 bg-red-900/50 rounded-lg px-3 py-1 border border-red-800/50">
            <span className="text-red-400 text-xs font-semibold">LP</span>
            <span className="text-2xl md:text-3xl font-bold text-red-300 tabular-nums leading-none">
              {gameState.aiPlayer.life}
            </span>
          </div>
        </div>

        {/* AI Command Zone */}
        {gameState.aiCommandZone.length > 0 && (
          <div className="flex gap-1.5 md:gap-2 mb-1 overflow-x-auto">
            {gameState.aiCommandZone.map(card => (
              <CardTile key={card.instanceId} card={card} playable={false} compact />
            ))}
          </div>
        )}

        {/* AI Battlefield */}
        <div className="flex gap-1.5 md:gap-2 overflow-x-auto py-1 min-h-[70px] md:min-h-[100px]">
          {gameState.aiBattlefield.length === 0 && gameState.aiCommandZone.length === 0 ? (
            <div className="text-stone-600 text-xs italic flex items-center">
              No permanents
            </div>
          ) : (
            gameState.aiBattlefield.map(card => (
              <CardTile key={card.instanceId} card={card} playable={false} compact />
            ))
          )}
        </div>

        {/* AI Graveyard */}
        <GraveyardViewer cards={gameState.aiGraveyard} label="AI" />
      </div>

      {/* Stack Area */}
      {gameState.stack.length > 0 && (
        <div className="px-2 md:px-4 py-1.5 md:py-2 bg-stone-800/50 border-b border-stone-700/50 shrink-0">
          <div className="text-amber-400 text-[10px] md:text-xs font-semibold mb-1">Stack</div>
          <div className="flex gap-1.5 md:gap-2 flex-wrap">
            {gameState.stack.map(item => (
              <div
                key={item.id}
                className="px-2 md:px-3 py-1 md:py-1.5 rounded bg-amber-900/40 border border-amber-600/30 text-amber-200 text-[10px] md:text-xs"
              >
                {item.name}
                <span className="text-amber-500 ml-1 text-[8px] md:text-[10px]">
                  ({item.casterId === 'human' ? 'You' : 'AI'})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Human Battlefield */}
      <div className="flex-1 px-2 md:px-4 py-2 md:py-3 border-b border-stone-700/50 overflow-y-auto min-h-0">
        <div className="flex items-center gap-2 md:gap-4 mb-1.5 md:mb-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-900 flex items-center justify-center text-green-300 font-bold text-xs md:text-sm">
              Y
            </div>
            <div>
              <div className="text-xs md:text-sm font-semibold text-stone-200 truncate max-w-[150px] md:max-w-[250px]">You — {gameState.humanCommander}</div>
              <div className="text-[10px] md:text-xs text-stone-500">
                Lib: {gameState.humanPlayer.libraryCount}
              </div>
            </div>
          </div>

          {/* Mana Pool — always visible */}
          <div className={`flex items-center gap-0.5 md:gap-1 rounded-lg px-1.5 md:px-2 py-0.5 md:py-1 border ${
            totalMana > 0
              ? 'bg-amber-900/40 border-amber-700/50'
              : 'bg-stone-800/50 border-stone-700/30'
          }`}>
            <span className="text-stone-500 text-[9px] md:text-[10px] font-semibold uppercase tracking-wide mr-0.5">Mana</span>
            {totalMana === 0 ? (
              <span className="text-stone-600 text-xs italic">empty</span>
            ) : (
              MANA_COLORS.map(({ key, label, color }) => {
                const val = gameState.manaPool[key as keyof typeof gameState.manaPool];
                if (val === 0) return null;
                return (
                  <span key={key} className={`${color} font-bold text-xs md:text-sm`}>
                    {val}{label}
                  </span>
                );
              })
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 bg-green-900/50 rounded-lg px-3 py-1 border border-green-800/50">
            <span className="text-green-400 text-xs font-semibold">LP</span>
            <span className="text-2xl md:text-3xl font-bold text-green-300 tabular-nums leading-none">
              {gameState.humanPlayer.life}
            </span>
          </div>
        </div>

        {/* Human Command Zone */}
        {gameState.humanCommandZone.length > 0 && (
          <div className="flex gap-1.5 md:gap-2 mb-2 overflow-x-auto">
            {gameState.humanCommandZone.map(card => (
              <CardTile
                key={card.instanceId}
                card={card}
                playable={playableIds.has(card.instanceId)}
                onClick={
                  playableIds.has(card.instanceId)
                    ? () => handleCardClick(card)
                    : undefined
                }
              />
            ))}
          </div>
        )}

        {/* Human Battlefield */}
        <div className="flex gap-1.5 md:gap-2 overflow-x-auto py-1 min-h-[80px] md:min-h-[120px]">
          {gameState.humanBattlefield.length === 0 && gameState.humanCommandZone.length === 0 ? (
            <div className="text-stone-600 text-xs italic flex items-center">
              No permanents
            </div>
          ) : (
            gameState.humanBattlefield.map(card => {
              const canUntap = onUntapMana && untappableCardIds?.includes(card.instanceId);
              return (
                <CardTile
                  key={card.instanceId}
                  card={card}
                  playable={playableIds.has(card.instanceId) || !!canUntap}
                  onClick={
                    playableIds.has(card.instanceId)
                      ? () => handleCardClick(card)
                      : canUntap
                      ? () => onUntapMana(card.instanceId)
                      : undefined
                  }
                />
              );
            })
          )}
        </div>

        {/* Human Graveyard */}
        <GraveyardViewer cards={gameState.humanGraveyard} label="Your" />
      </div>

      {/* Unified Action Bar */}
      {hasAnyAction && (
        <div className="px-2 md:px-4 py-1.5 md:py-2 bg-stone-800/80 border-y border-stone-700/50 shrink-0">
          <div className="text-amber-400 text-[10px] md:text-xs font-semibold tracking-wider uppercase mb-1">
            Actions
          </div>
          <div className="flex gap-1.5 md:gap-2 overflow-x-auto py-0.5 min-h-[44px] items-center">
            {/* Pass / Don't Respond / End Phase */}
            {passAction && (
              <button
                onClick={() => onAction(passAction)}
                className="px-3 py-1.5 rounded bg-stone-600 hover:bg-stone-500 text-stone-200 text-xs font-semibold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
              >
                {passAction.label}
              </button>
            )}
            {/* Combat: Skip Attacks / Declare Blockers */}
            {combatActions.map((action, i) => (
              <button
                key={`combat-${i}`}
                onClick={() => onAction(action)}
                className="px-3 py-1.5 rounded bg-red-900/60 hover:bg-red-800/70 border border-red-600/30 text-red-200 text-xs font-semibold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
              >
                {action.label}
              </button>
            ))}
            {/* Cast Spells */}
            {castActions.map((action, i) => {
              // Look up the card to compute CMC for counter probability
              const spellCard = action.cardInstanceId
                ? [...gameState.humanHand, ...gameState.humanCommandZone].find(
                    c => c.instanceId === action.cardInstanceId,
                  )
                : undefined;
              const spellCmc = spellCard ? parseCmc(spellCard.manaCost) : 3;
              const counter = getCounterProbability(gameState, spellCmc);
              return (
                <button
                  key={`cast-${i}`}
                  onClick={() => onAction(action)}
                  className="px-3 py-1.5 rounded bg-green-900/60 hover:bg-green-800/70 border border-green-600/30 text-green-200 text-xs font-semibold transition-colors min-h-[44px] whitespace-nowrap shrink-0 flex items-center gap-1.5"
                >
                  <span>
                    <span className="text-green-400 text-[10px] mr-1">Cast</span>
                    {action.cardName || action.label}
                  </span>
                  {counter.prob > 0 && (
                    <span className={`${counter.color} text-[10px] font-bold ml-1`}>
                      {'\u26A1'} {counter.prob}%
                    </span>
                  )}
                </button>
              );
            })}
            {/* Play Lands */}
            {playLandActions.map((action, i) => (
              <button
                key={`land-${i}`}
                onClick={() => onAction(action)}
                className="px-3 py-1.5 rounded bg-green-900/60 hover:bg-green-800/70 border border-green-600/30 text-green-200 text-xs font-semibold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
              >
                <span className="text-green-400 text-[10px] mr-1">Play</span>
                {action.cardName || action.label}
              </button>
            ))}
            {/* Other card actions */}
            {otherCardActions.map((action, i) => (
              <button
                key={`other-${i}`}
                onClick={() => onAction(action)}
                className="px-3 py-1.5 rounded bg-green-900/60 hover:bg-green-800/70 border border-green-600/30 text-green-200 text-xs font-semibold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
              >
                {action.label}
              </button>
            ))}
            {/* Mana Abilities */}
            {manaActions.length > 0 && (
              <>
                <div className="w-px h-6 bg-stone-600 shrink-0 mx-0.5" />
                {/* Tap All button */}
                {manaActions.length > 1 && (
                  <button
                    onClick={() => { for (const a of manaActions) onAction(a); }}
                    className="px-3 py-1.5 rounded bg-amber-700/70 hover:bg-amber-600/80 border border-amber-500/40 text-amber-100 text-xs font-bold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
                  >
                    Tap All ({manaActions.length})
                  </button>
                )}
                {/* Individual taps — only show when 3 or fewer, otherwise too long */}
                {manaActions.length <= 3 && manaActions.map((action, i) => (
                  <button
                    key={`mana-${i}`}
                    onClick={() => onAction(action)}
                    className="px-2 py-1 rounded bg-amber-900/50 hover:bg-amber-800/60 border border-amber-600/30 text-amber-200 text-[10px] md:text-xs font-semibold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
                  >
                    <span className="text-amber-400 text-[9px] mr-0.5">Tap</span>
                    {action.cardName || action.label}
                  </button>
                ))}
              </>
            )}
            {/* Undo button */}
            {onUndo && (undosRemaining ?? 0) > 0 && (
              <>
                <div className="w-px h-6 bg-stone-600 shrink-0 mx-0.5" />
                <button
                  onClick={onUndo}
                  className="px-3 py-1.5 rounded bg-red-900/50 hover:bg-red-800/60 border border-red-600/30 text-red-300 text-xs font-semibold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
                >
                  Undo ({undosRemaining})
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Human Hand + Actions */}
      <div className="px-2 md:px-4 py-2 md:py-3 bg-stone-800 border-t border-stone-700 shrink-0">
        <div className="flex items-center justify-between mb-1.5 md:mb-2 gap-2">
          <div className="text-amber-400 text-[10px] md:text-xs font-semibold tracking-wider uppercase whitespace-nowrap">
            {discardPhase
              ? `Hand (${gameState.humanHand.length}) — Discard ${discardCount} card${(discardCount ?? 0) > 1 ? 's' : ''}`
              : mulliganPhase
              ? `Hand (${gameState.humanHand.length})${mulliganCount ? ` - Mull #${mulliganCount}` : ''}`
              : `Hand (${gameState.humanHand.length})`}
          </div>
          {mulliganPhase && (
            <div className="flex gap-2">
              <button
                onClick={onKeepHand}
                className="px-3 md:px-4 py-1.5 rounded bg-green-700 hover:bg-green-600 text-white text-xs font-semibold transition-colors min-h-[44px]"
              >
                Keep
              </button>
              <button
                onClick={onMulligan}
                className="px-3 md:px-4 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold transition-colors min-h-[44px]"
              >
                Mulligan
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-1.5 md:gap-2 overflow-x-auto py-1 -mx-2 px-2 md:-mx-0 md:px-0">
          {gameState.humanHand.length === 0 ? (
            <div className="text-stone-600 text-xs italic">
              Hand is empty
            </div>
          ) : (
            gameState.humanHand.map(card => (
              <CardTile
                key={card.instanceId}
                card={card}
                playable={discardPhase || (!mulliganPhase && playableIds.has(card.instanceId))}
                onClick={
                  discardPhase
                    ? () => onDiscardCard?.(card.instanceId)
                    : !mulliganPhase && playableIds.has(card.instanceId)
                    ? () => handleCardClick(card)
                    : undefined
                }
              />
            ))
          )}
        </div>
      </div>

      {/* Game Over Overlay */}
      {gameState.gameOver && (
        <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
          <div className="bg-stone-800 border-2 border-amber-500/50 rounded-2xl p-8 md:p-12 text-center max-w-md mx-4 shadow-2xl">
            <div className={`text-4xl font-bold mb-3 ${
              gameState.winnerId === 'human' ? 'text-amber-400' : 'text-red-400'
            }`}>
              {gameState.winnerId === 'human' ? 'Victory!' : 'Defeat'}
            </div>
            <div className="text-stone-300 text-sm mb-4">
              {gameState.winnerId === 'human'
                ? `You defeated ${gameState.aiCommander}!`
                : `${gameState.aiCommander} has prevailed.`}
            </div>
            <div className="text-stone-500 text-xs mb-6">
              Turn {gameState.turnNumber} — Your life: {gameState.humanPlayer.life}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg transition-colors"
            >
              Play Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
