/**
 * GameBoard -- visual game board for the Shelector game.
 *
 * Shows phase bar, AI side, stack, human battlefield, and human hand.
 * Dark theme with stone color palette.
 * Mobile-responsive: compact cards, horizontal scroll hand, touch-friendly buttons.
 */

import { useEffect, useState } from 'react';
import type { SimpleGameState, SimpleLegalAction, SimpleCard, LastPlayedCard } from '../hooks/useShelectorGame';
import { Loader2, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { CardPickerModal } from './CardPickerModal';
import { CardImage } from './CardImage';

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

type BattlefieldRowKey = 'creatures' | 'artifacts' | 'enchantments' | 'lands' | 'other';

type BattlefieldGroup = {
  key: string;
  card: SimpleCard;
  cards: SimpleCard[];
};

const ROW_LABELS: Record<BattlefieldRowKey, string> = {
  creatures: 'Creatures',
  artifacts: 'Artifacts',
  enchantments: 'Enchantments',
  lands: 'Lands',
  other: 'Other',
};

const HUMAN_ROW_ORDER: BattlefieldRowKey[] = ['creatures', 'artifacts', 'enchantments', 'lands', 'other'];
const AI_ROW_ORDER: BattlefieldRowKey[] = ['lands', 'artifacts', 'enchantments', 'creatures', 'other'];

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
  onTutorCancel?: () => void;
  undosRemaining?: number;
  onUndo?: () => void;
  coachMode?: boolean;
  onToggleCoach?: (on: boolean) => void;
  onUntapMana?: (cardInstanceId: string) => void;
  untappableCardIds?: string[];
  lastPlayedCard?: LastPlayedCard | null;
}

/** Compute counter badge entries from a card's counters record */
function getCounterBadges(counters: Record<string, number>): { label: string; count: number }[] {
  return Object.entries(counters)
    .filter(([, v]) => v > 0)
    .map(([key, count]) => ({ label: key, count }));
}

function getBattlefieldRowKey(card: SimpleCard): BattlefieldRowKey {
  if (card.cardTypes.includes('creature')) return 'creatures';
  if (card.cardTypes.includes('land')) return 'lands';
  if (card.cardTypes.includes('artifact')) return 'artifacts';
  if (card.cardTypes.includes('enchantment')) return 'enchantments';
  return 'other';
}

function groupBattlefieldCards(cards: SimpleCard[], stackLands: boolean): Record<BattlefieldRowKey, BattlefieldGroup[]> {
  const rows: Record<BattlefieldRowKey, SimpleCard[]> = {
    creatures: [],
    artifacts: [],
    enchantments: [],
    lands: [],
    other: [],
  };

  for (const card of cards) {
    rows[getBattlefieldRowKey(card)].push(card);
  }

  const groups: Record<BattlefieldRowKey, BattlefieldGroup[]> = {
    creatures: rows.creatures.map(card => ({ key: card.instanceId, card, cards: [card] })),
    artifacts: rows.artifacts.map(card => ({ key: card.instanceId, card, cards: [card] })),
    enchantments: rows.enchantments.map(card => ({ key: card.instanceId, card, cards: [card] })),
    lands: [],
    other: rows.other.map(card => ({ key: card.instanceId, card, cards: [card] })),
  };

  if (!stackLands) {
    groups.lands = rows.lands.map(card => ({ key: card.instanceId, card, cards: [card] }));
    return groups;
  }

  const landStacks = new Map<string, SimpleCard[]>();
  for (const land of rows.lands) {
    const stackKey = `${land.name}|${land.tapped ? 'tapped' : 'untapped'}`;
    landStacks.set(stackKey, [...(landStacks.get(stackKey) || []), land]);
  }

  groups.lands = [...landStacks.entries()].flatMap(([key, lands]) => {
    if (lands.length >= 3) {
      return [{ key, card: lands[0], cards: lands }];
    }
    return lands.map(card => ({ key: card.instanceId, card, cards: [card] }));
  });

  return groups;
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
  const allAiBattlefields = Object.values(gameState.aiBattlefields);
  const allAiPermanents = allAiBattlefields.length > 0
    ? allAiBattlefields.flat()
    : gameState.aiBattlefield;
  const aiUntappedLands = allAiPermanents.filter(
    c => c.cardTypes.includes('land') && !c.tapped,
  );
  const untappedCount = aiUntappedLands.length;
  const handCount = gameState.aiPlayers.length > 0
    ? gameState.aiPlayers.reduce((sum, player) => sum + player.handCount, 0)
    : gameState.aiPlayer.handCount;

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
  onInspect,
  compact,
  inspectable,
  stackCount = 1,
}: {
  card: SimpleCard;
  playable: boolean;
  onClick?: () => void;
  onInspect?: () => void;
  compact?: boolean;
  inspectable?: boolean;
  stackCount?: number;
}) {
  const isCreature = card.cardTypes.includes('creature');
  const isLand = card.cardTypes.includes('land');
  const counterBadges = getCounterBadges(card.counters);
  const interactive = playable || !!onClick;
  // Mobile: even smaller cards; desktop: normal sizes
  const w = compact
    ? 'w-[4.5rem] h-24 md:w-24 md:h-32'
    : 'w-20 h-28 md:w-28 md:h-40';

  // Border color: playable > token > default
  const borderClass = playable
    ? 'border-green-500 bg-stone-700 hover:bg-stone-600 cursor-pointer ring-1 ring-green-500/50 shadow-lg shadow-green-900/20'
    : card.isToken
      ? `border-violet-500 bg-stone-800 ring-1 ring-violet-500/30 ${interactive ? 'cursor-pointer hover:bg-stone-700' : 'cursor-default'}`
      : `border-stone-600 bg-stone-800 ${interactive ? 'cursor-pointer hover:bg-stone-700' : 'cursor-default'}`;

  return (
    <div className={`relative shrink-0 ${w}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={!playable && !onClick}
        title={playable ? 'Use card' : inspectable ? 'Inspect card' : card.name}
        className={`
          absolute inset-0 flex h-full w-full flex-col justify-between
          rounded-lg border p-1.5 md:p-2 text-left text-[10px] md:text-xs transition-all
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

        {/* Stack count */}
        {stackCount > 1 && (
          <div className="absolute top-1 left-1 rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-black leading-none text-neutral-950 shadow">
            x{stackCount}
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

      {/* Inspect badge */}
      {inspectable && onInspect && (
        <button
          type="button"
          aria-label={`Inspect ${card.name}`}
          title="Inspect card"
          onClick={event => {
            event.stopPropagation();
            onInspect();
          }}
          className="absolute bottom-1 left-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-stone-500/70 bg-neutral-950/90 text-stone-300 transition-colors hover:border-amber-400 hover:text-amber-200"
        >
          <Search className="h-2.5 w-2.5" />
        </button>
      )}
    </div>
  );
}

function ManaCostText({ manaCost }: { manaCost: string }) {
  const symbols = manaCost.match(/\{[^}]+\}/g) || [];
  if (symbols.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {symbols.map((symbol, i) => (
        <span
          key={`${symbol}-${i}`}
          className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-stone-500 bg-stone-200 px-1.5 text-xs font-black text-stone-900"
        >
          {symbol.slice(1, -1)}
        </span>
      ))}
    </div>
  );
}

function CardInspectorModal({
  card,
  actionLabel,
  onPrimaryAction,
  onClose,
}: {
  card: SimpleCard;
  actionLabel?: string;
  onPrimaryAction?: () => void;
  onClose: () => void;
}) {
  const isCreature = card.cardTypes.includes('creature');
  const counters = getCounterBadges(card.counters);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 md:p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-amber-500/40 bg-neutral-950 shadow-2xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Inspect</div>
            <h2 className="truncate text-lg font-black text-stone-100 md:text-xl">{card.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-stone-300 transition-colors hover:bg-neutral-800 hover:text-white"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 md:grid-cols-[minmax(15rem,22rem)_1fr] md:p-5">
          <div className="flex justify-center md:justify-start">
            <CardImage
              cardName={card.name}
              size="normal"
              showHoverZoom={false}
              className="aspect-[5/7] w-[min(68vw,18rem)] overflow-hidden rounded-lg bg-stone-200 shadow-2xl md:w-full"
            />
          </div>

          <div className="min-w-0 space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xl font-black leading-tight text-stone-100">{card.name}</div>
                  {card.manaCost && <div className="mt-2"><ManaCostText manaCost={card.manaCost} /></div>}
                </div>
                {isCreature && card.power != null && card.toughness != null && (
                  <div className="rounded border border-stone-600 bg-neutral-900 px-3 py-2 text-2xl font-black text-stone-100">
                    {card.power}/{card.toughness}
                  </div>
                )}
              </div>

              <div className="rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-stone-300">
                {card.typeLine || 'Card'}
              </div>
            </div>

            {card.oracleText ? (
              <div className="whitespace-pre-line rounded border border-neutral-800 bg-neutral-900 p-4 text-sm leading-relaxed text-stone-100 md:text-base">
                {card.oracleText}
              </div>
            ) : (
              <div className="rounded border border-neutral-800 bg-neutral-900 p-4 text-sm text-stone-500">
                No rules text.
              </div>
            )}

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-stone-300">
                {card.zone}
              </span>
              {card.tapped && (
                <span className="rounded border border-orange-700/60 bg-orange-950/60 px-2 py-1 text-orange-200">
                  tapped
                </span>
              )}
              {card.isCommander && (
                <span className="rounded border border-amber-600/60 bg-amber-950/60 px-2 py-1 text-amber-200">
                  commander
                </span>
              )}
              {card.isToken && (
                <span className="rounded border border-violet-600/60 bg-violet-950/60 px-2 py-1 text-violet-200">
                  token
                </span>
              )}
              {counters.map(({ label, count }) => (
                <span key={label} className="rounded border border-green-700/60 bg-green-950/60 px-2 py-1 text-green-200">
                  {label}: {count}
                </span>
              ))}
            </div>

            {onPrimaryAction && actionLabel && (
              <button
                type="button"
                onClick={() => {
                  onPrimaryAction();
                  onClose();
                }}
                className="min-h-[44px] rounded bg-green-700 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-green-600"
              >
                {actionLabel}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
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

function FeaturedCard({
  card,
  label,
  meta,
  emptyText,
  compact = false,
  playable = false,
  onClick,
}: {
  card?: SimpleCard | null;
  label: string;
  meta?: string;
  emptyText: string;
  compact?: boolean;
  playable?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className={`rounded-lg border bg-neutral-950/80 p-2 ${playable ? 'border-green-500/70' : 'border-neutral-700'}`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[9px] font-bold uppercase tracking-wider text-stone-500">{label}</div>
        {meta && <div className="truncate text-[9px] text-stone-500">{meta}</div>}
      </div>
      {card ? (
        <button
          type="button"
          onClick={onClick}
          disabled={!onClick}
          className={`group w-full text-left ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <CardImage
            cardName={card.name}
            size="small"
            showHoverZoom={false}
            className={`mx-auto aspect-[5/7] ${compact ? 'w-24' : 'w-32'} overflow-hidden rounded-lg bg-stone-200`}
          />
          <div className="mt-1 truncate text-xs font-semibold text-stone-100 group-hover:text-amber-200">
            {card.name}
          </div>
          <div className="truncate text-[10px] text-stone-500">{card.typeLine}</div>
        </button>
      ) : (
        <div className={`flex ${compact ? 'h-32' : 'h-44'} items-center justify-center rounded-lg border border-dashed border-neutral-700 px-3 text-center text-xs text-stone-600`}>
          {emptyText}
        </div>
      )}
    </div>
  );
}

function CommanderPanel({
  card,
  commanderName,
  life,
  handCount,
  libraryCount,
  label,
  tone,
  playable,
  onClick,
}: {
  card?: SimpleCard | null;
  commanderName: string;
  life: number;
  handCount: number;
  libraryCount: number;
  label: string;
  tone: 'human' | 'ai';
  playable?: boolean;
  onClick?: () => void;
}) {
  const lifeClass = tone === 'human'
    ? 'border-green-600/50 bg-green-950/60 text-green-200'
    : 'border-red-600/50 bg-red-950/60 text-red-200';

  return (
    <section className="border-b border-neutral-800 pb-3 last:border-b-0">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-wider text-stone-500">{label}</div>
          <div className="truncate text-xs font-semibold text-stone-100">{commanderName}</div>
        </div>
        <div className={`rounded-lg border px-2 py-1 text-center ${lifeClass}`}>
          <div className="text-[8px] font-bold uppercase tracking-wider opacity-70">Life</div>
          <div className="text-2xl font-black tabular-nums leading-none">{life}</div>
        </div>
      </div>
      <FeaturedCard
        card={card}
        label="Commander"
        emptyText={commanderName}
        compact
        playable={playable}
        onClick={playable ? onClick : undefined}
      />
      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-stone-400">
        <div className="rounded border border-neutral-700 bg-neutral-950/80 px-2 py-1">
          Hand <span className="font-bold text-stone-200">{handCount}</span>
        </div>
        <div className="rounded border border-neutral-700 bg-neutral-950/80 px-2 py-1">
          Lib <span className="font-bold text-stone-200">{libraryCount}</span>
        </div>
      </div>
    </section>
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
  onTutorCancel,
  undosRemaining,
  onUndo,
  coachMode,
  onToggleCoach,
  onUntapMana,
  untappableCardIds,
  lastPlayedCard,
}: GameBoardProps) {
  const [inspectedCard, setInspectedCard] = useState<SimpleCard | null>(null);
  const [stackLands, setStackLands] = useState(true);
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null);

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

  const getInspectAction = (card: SimpleCard) => {
    const isHumanHandCard = card.zone === 'hand' && card.ownerId === gameState.humanPlayer.id;

    if (discardPhase && isHumanHandCard && onDiscardCard) {
      return {
        label: `Discard ${card.name}`,
        run: () => onDiscardCard(card.instanceId),
      };
    }

    if (mulliganPhase) return null;
    if (card.ownerId !== gameState.humanPlayer.id) return null;

    const action = legalActions.find(a => a.cardInstanceId === card.instanceId);
    if (!action) return null;

    const label = action.kind === 'CastSpell'
      ? `Cast ${card.name}`
      : action.kind === 'PlayLand'
      ? `Play ${card.name}`
      : action.label;

    return {
      label,
      run: () => onAction(action),
    };
  };

  const inspectedAction = inspectedCard ? getInspectAction(inspectedCard) : null;

  const renderBattlefieldRows = (
    cards: SimpleCard[],
    owner: 'human' | 'ai',
  ) => {
    const rowGroups = groupBattlefieldCards(cards, stackLands);
    const order = owner === 'ai' ? AI_ROW_ORDER : HUMAN_ROW_ORDER;
    const hasPermanents = order.some(row => rowGroups[row].length > 0);

    if (!hasPermanents) {
      return (
        <div className="text-stone-600 text-xs italic flex items-center">
          No permanents
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        {order.map(row => {
          const groups = rowGroups[row];
          if (groups.length === 0) return null;

          return (
            <div key={row} className="min-w-0">
              <div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-wider text-stone-500">
                <span>{ROW_LABELS[row]}</span>
                <span className="text-stone-700">{groups.reduce((sum, group) => sum + group.cards.length, 0)}</span>
              </div>
              <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-1">
                {groups.map(group => {
                  const playableCard = owner === 'human'
                    ? group.cards.find(card => playableIds.has(card.instanceId))
                    : undefined;
                  const untappableCard = owner === 'human' && onUntapMana
                    ? group.cards.find(card => untappableCardIds?.includes(card.instanceId))
                    : undefined;
                  const canUse = !!playableCard || !!untappableCard;
                  return (
                    <CardTile
                      key={group.key}
                      card={playableCard || untappableCard || group.card}
                      playable={canUse}
                      stackCount={group.cards.length}
                      onClick={
                        playableCard
                          ? () => handleCardClick(playableCard)
                          : untappableCard && onUntapMana
                          ? () => onUntapMana(untappableCard.instanceId)
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Mana pool display
  const totalMana = Object.values(gameState.manaPool).reduce((a, b) => a + b, 0);
  const opponentPlayers = gameState.aiPlayers.length > 0 ? gameState.aiPlayers : [gameState.aiPlayer];
  const selectedOpponent = opponentPlayers.find(player => player.id === selectedOpponentId)
    || opponentPlayers[0]
    || gameState.aiPlayer;
  const selectedOpponentIndex = Math.max(
    0,
    opponentPlayers.findIndex(player => player.id === selectedOpponent.id),
  );
  const selectedOpponentCommander =
    gameState.aiCommanderNames[selectedOpponent.id] || selectedOpponent.name || gameState.aiCommander;
  const selectedAiHand = gameState.aiHands[selectedOpponent.id] || gameState.aiHand;
  const selectedAiBattlefield = gameState.aiBattlefields[selectedOpponent.id] || gameState.aiBattlefield;
  const selectedAiGraveyard = gameState.aiGraveyards[selectedOpponent.id] || gameState.aiGraveyard;
  const selectedAiCommandZone = gameState.aiCommandZones[selectedOpponent.id] || gameState.aiCommandZone;
  const selectedOpponentLabel = opponentPlayers.length > 1
    ? `Opponent ${selectedOpponentIndex + 1}`
    : 'Opponent';
  const winnerName = gameState.winnerId && gameState.winnerId !== gameState.humanPlayer.id
    ? gameState.aiCommanderNames[gameState.winnerId] || gameState.aiCommander
    : gameState.aiCommander;
  const humanCommanderCard =
    gameState.humanCommandZone[0] || gameState.humanBattlefield.find(c => c.isCommander);
  const aiCommanderCard =
    selectedAiCommandZone[0] || selectedAiBattlefield.find(c => c.isCommander);
  const humanCommanderPlayable = !!humanCommanderCard && playableIds.has(humanCommanderCard.instanceId);
  const humanNonCommanderCommandZone = gameState.humanCommandZone.filter(
    c => c.instanceId !== humanCommanderCard?.instanceId,
  );
  const aiNonCommanderCommandZone = selectedAiCommandZone.filter(
    c => c.instanceId !== aiCommanderCard?.instanceId,
  );

  return (
    <div className="flex h-full min-h-0 bg-neutral-950 text-stone-200 overflow-hidden relative">
      {/* Tutor card picker overlay */}
      {tutorPhase && tutorCards && onTutorPick && (
        <CardPickerModal
          title={tutorTitle || 'Search your library'}
          cards={tutorCards}
          onPick={onTutorPick}
          onCancel={onTutorCancel}
        />
      )}
      {inspectedCard && (
        <CardInspectorModal
          card={inspectedCard}
          actionLabel={inspectedAction?.label}
          onPrimaryAction={inspectedAction?.run}
          onClose={() => setInspectedCard(null)}
        />
      )}
      <aside className="hidden xl:flex w-52 shrink-0 flex-col gap-3 border-r border-neutral-800 bg-neutral-950 p-3">
        <CommanderPanel
          card={aiCommanderCard}
          commanderName={selectedOpponentCommander}
          life={selectedOpponent.life}
          handCount={selectedOpponent.handCount}
          libraryCount={selectedOpponent.libraryCount}
          label={selectedOpponentLabel}
          tone="ai"
        />
        <div className="flex-1 flex items-center">
          <FeaturedCard
            card={lastPlayedCard?.card}
            label="Last Played"
            meta={lastPlayedCard ? `${lastPlayedCard.action} by ${lastPlayedCard.playerName}` : undefined}
            emptyText="No card played yet"
          />
        </div>
        <CommanderPanel
          card={humanCommanderCard}
          commanderName={gameState.humanCommander}
          life={gameState.humanPlayer.life}
          handCount={gameState.humanPlayer.handCount}
          libraryCount={gameState.humanPlayer.libraryCount}
          label="You"
          tone="human"
          playable={humanCommanderPlayable}
          onClick={
            humanCommanderPlayable && humanCommanderCard
              ? () => handleCardClick(humanCommanderCard)
              : undefined
          }
        />
      </aside>
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-neutral-900">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-0 hidden h-1 -translate-y-1/2 bg-red-500/70 xl:block" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 hidden h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-red-500/70 xl:flex items-center justify-center">
          <span className="text-3xl font-black text-red-500/60">M</span>
        </div>
      {/* Phase Bar -- compact on mobile */}
      <div className="relative z-10 flex items-center gap-1.5 md:gap-3 px-2 md:px-4 py-1.5 md:py-2 bg-neutral-950 border-b border-neutral-800 overflow-x-auto shrink-0">
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
          <label className="hidden sm:flex min-h-7 items-center gap-1.5 rounded border border-neutral-700 bg-neutral-900 px-2 text-[10px] font-semibold text-stone-300">
            <input
              type="checkbox"
              checked={stackLands}
              onChange={event => setStackLands(event.target.checked)}
              className="h-3.5 w-3.5 accent-amber-500"
            />
            <span className="whitespace-nowrap">Stack lands</span>
          </label>
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
      <div className="relative z-10 px-2 md:px-4 py-2 md:py-3 border-b border-neutral-800/80 bg-neutral-900/80 shrink-0">
        <div className="flex items-center gap-2 md:gap-4 mb-1.5 md:mb-2">
          <div className="flex items-center gap-2">
            <div className="xl:hidden w-12 h-16 overflow-hidden rounded border border-red-700/50 bg-stone-200">
              {aiCommanderCard ? (
                <CardImage cardName={aiCommanderCard.name} size="small" showHoverZoom={false} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center bg-red-950 text-red-300 text-xs font-bold">
                  {selectedOpponent.name.charAt(0)}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="text-xs md:text-sm font-semibold text-stone-200 truncate max-w-[120px] md:max-w-[200px]">
                {selectedOpponent.name}
              </div>
              <div className="text-[10px] md:text-xs text-stone-500">
                Hand: {selectedOpponent.handCount}
                {' / '}
                Lib: {selectedOpponent.libraryCount}
              </div>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2 bg-red-900/50 rounded-lg px-3 py-1 border border-red-800/50">
            <span className="text-red-400 text-xs font-semibold">LP</span>
            <span className="text-2xl md:text-3xl font-bold text-red-300 tabular-nums leading-none">
              {selectedOpponent.life}
            </span>
          </div>
        </div>

        {opponentPlayers.length > 1 && (
          <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
            {opponentPlayers.map((player, index) => {
              const selected = player.id === selectedOpponent.id;
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => setSelectedOpponentId(player.id)}
                  className={`min-w-[8.5rem] rounded border px-2 py-1.5 text-left transition-colors ${
                    selected
                      ? 'border-red-400 bg-red-950/60 text-red-100'
                      : 'border-neutral-700 bg-neutral-950/70 text-stone-400 hover:border-neutral-500 hover:text-stone-200'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[9px] font-bold uppercase tracking-wider">
                    <span>AI {index + 1}</span>
                    <span className="tabular-nums">LP {player.life}</span>
                  </div>
                  <div className="truncate text-xs font-semibold">{player.name}</div>
                  <div className="text-[10px] opacity-70">
                    Hand {player.handCount} / Lib {player.libraryCount}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* AI extra command zone cards, such as partners */}
        {aiNonCommanderCommandZone.length > 0 && (
          <div className="flex gap-1.5 md:gap-2 mb-1 overflow-x-auto">
            {aiNonCommanderCommandZone.map(card => (
              <CardTile key={card.instanceId} card={card} playable={false} compact />
            ))}
          </div>
        )}

        {/* AI Hand -- intentionally visible for solo learning mode */}
        <div className="mb-1">
          <div className="mb-1 text-[9px] md:text-[10px] font-semibold uppercase tracking-wider text-red-300/70">
            {selectedOpponentLabel} Hand ({selectedAiHand.length})
          </div>
          <div className="flex gap-1.5 md:gap-2 overflow-x-auto pb-1 min-h-[58px]">
            {selectedAiHand.length === 0 ? (
              <div className="text-stone-600 text-xs italic flex items-center">No cards in hand</div>
            ) : (
              selectedAiHand.map(card => (
                <CardTile
                  key={card.instanceId}
                  card={card}
                  playable={false}
                  compact
                  inspectable
                  onClick={() => setInspectedCard(card)}
                  onInspect={() => setInspectedCard(card)}
                />
              ))
            )}
          </div>
        </div>

        {/* AI Battlefield */}
        <div className="min-h-[70px] md:min-h-[100px] py-1">
          {renderBattlefieldRows(selectedAiBattlefield, 'ai')}
        </div>

        {/* AI Graveyard */}
        <GraveyardViewer cards={selectedAiGraveyard} label={selectedOpponentLabel} />
      </div>

      {/* Stack Area */}
      {gameState.stack.length > 0 && (
        <div className="relative z-10 px-2 md:px-4 py-1.5 md:py-2 bg-stone-800/50 border-b border-stone-700/50 shrink-0">
          <div className="text-amber-400 text-[10px] md:text-xs font-semibold mb-1">Stack</div>
          <div className="flex gap-1.5 md:gap-2 flex-wrap">
            {gameState.stack.map(item => (
              <div
                key={item.id}
                className="px-2 md:px-3 py-1 md:py-1.5 rounded bg-amber-900/40 border border-amber-600/30 text-amber-200 text-[10px] md:text-xs"
              >
                {item.name}
                <span className="text-amber-500 ml-1 text-[8px] md:text-[10px]">
                  ({item.casterId === 'human' ? 'You' : gameState.aiCommanderNames[item.casterId] || 'AI'})
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {gameState.stack.length === 0 && lastPlayedCard && (
        <div className="relative z-10 hidden md:flex justify-center border-b border-neutral-800/60 bg-neutral-900/50 px-4 py-2">
          <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-neutral-950/80 px-3 py-2">
            <CardImage
              cardName={lastPlayedCard.card.name}
              size="small"
              showHoverZoom={false}
              className="h-20 w-14 overflow-hidden rounded bg-stone-200"
            />
            <div className="min-w-0">
              <div className="text-[9px] font-bold uppercase tracking-wider text-red-300/80">Last Played</div>
              <div className="truncate text-sm font-semibold text-stone-100">{lastPlayedCard.card.name}</div>
              <div className="truncate text-xs text-stone-500">
                {lastPlayedCard.action} by {lastPlayedCard.playerName}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Human Battlefield */}
      <div className="relative z-10 flex-1 px-2 md:px-4 py-2 md:py-3 border-b border-neutral-800/80 bg-neutral-800/75 overflow-y-auto min-h-0">
        <div className="flex items-center gap-2 md:gap-4 mb-1.5 md:mb-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={humanCommanderPlayable && humanCommanderCard ? () => handleCardClick(humanCommanderCard) : undefined}
              disabled={!humanCommanderPlayable}
              className={`xl:hidden h-16 w-12 overflow-hidden rounded border bg-stone-200 ${
                humanCommanderPlayable ? 'border-green-400 ring-2 ring-green-400/40' : 'border-green-700/50'
              }`}
            >
              {humanCommanderCard ? (
                <CardImage cardName={humanCommanderCard.name} size="small" showHoverZoom={false} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center bg-green-950 text-green-300 text-xs font-bold">Y</div>
              )}
            </button>
            <div>
              <div className="text-xs md:text-sm font-semibold text-stone-200 truncate max-w-[150px] md:max-w-[250px]">You — {gameState.humanCommander}</div>
              <div className="text-[10px] md:text-xs text-stone-500">
                Hand: {gameState.humanHand.length} / Lib: {gameState.humanPlayer.libraryCount}
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

        {/* Human extra command zone cards, such as partners */}
        {humanNonCommanderCommandZone.length > 0 && (
          <div className="flex gap-1.5 md:gap-2 mb-2 overflow-x-auto">
            {humanNonCommanderCommandZone.map(card => (
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
        <div className="min-h-[80px] md:min-h-[120px] py-1">
          {renderBattlefieldRows(gameState.humanBattlefield, 'human')}
        </div>

        {/* Human Graveyard */}
        <GraveyardViewer cards={gameState.humanGraveyard} label="Your" />
      </div>

      {/* Unified Action Bar */}
      {hasAnyAction && (
        <div className="relative z-10 px-2 md:px-4 py-1.5 md:py-2 bg-stone-800/80 border-y border-stone-700/50 shrink-0">
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
                {/* Tap All button: pick one action per card, choosing the color that
                    diversifies the resulting pool (so a Taiga + Mountain produces R + G
                    instead of R + R). */}
                {(() => {
                  const tapAllPlan = (() => {
                    // Group manaActions by card id; each card produces one tap.
                    const byCard = new Map<string, SimpleLegalAction[]>();
                    for (const a of manaActions) {
                      const cardId = a.cardInstanceId;
                      if (!cardId) continue;
                      const arr = byCard.get(cardId) ?? [];
                      arr.push(a);
                      byCard.set(cardId, arr);
                    }
                    // Order: cards with the FEWEST color choices first (mono-color and
                    // colorless lock in their color before duals get to choose).
                    const ordered = [...byCard.entries()].sort(
                      ([, a], [, b]) => a.length - b.length,
                    );
                    const tally: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
                    const plan: SimpleLegalAction[] = [];
                    for (const [, options] of ordered) {
                      // Pick the option whose color is currently least represented.
                      const best = options.reduce((cur, opt) => {
                        const curColor = (cur._engineAction as { color?: string }).color ?? 'C';
                        const optColor = (opt._engineAction as { color?: string }).color ?? 'C';
                        return (tally[optColor] ?? 0) < (tally[curColor] ?? 0) ? opt : cur;
                      });
                      const chosenColor = (best._engineAction as { color?: string }).color ?? 'C';
                      tally[chosenColor] = (tally[chosenColor] ?? 0) + 1;
                      plan.push(best);
                    }
                    return plan;
                  })();
                  if (tapAllPlan.length <= 1) return null;
                  return (
                    <button
                      onClick={() => { for (const a of tapAllPlan) onAction(a); }}
                      className="px-3 py-1.5 rounded bg-amber-700/70 hover:bg-amber-600/80 border border-amber-500/40 text-amber-100 text-xs font-bold transition-colors min-h-[44px] whitespace-nowrap shrink-0"
                    >
                      Tap All ({tapAllPlan.length})
                    </button>
                  );
                })()}
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
      <div className="relative z-10 px-2 md:px-4 py-2 md:py-3 bg-neutral-950 border-t border-neutral-800 shrink-0">
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
            gameState.humanHand.map(card => {
              const cardAction = getInspectAction(card);
              return (
                <CardTile
                  key={card.instanceId}
                  card={card}
                  playable={discardPhase || (!mulliganPhase && playableIds.has(card.instanceId))}
                  inspectable
                  onClick={cardAction ? cardAction.run : () => setInspectedCard(card)}
                  onInspect={() => setInspectedCard(card)}
                />
              );
            })
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
                ? opponentPlayers.length > 1 ? 'You defeated all opponents!' : `You defeated ${gameState.aiCommander}!`
                : `${winnerName} has prevailed.`}
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
    </div>
  );
}
