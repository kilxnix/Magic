/**
 * GameBoard -- visual game board for the Shelector game.
 *
 * Shows phase bar, AI side, stack, human battlefield, and human hand.
 * Dark theme with stone color palette.
 * Mobile-responsive: compact cards, horizontal scroll hand, touch-friendly buttons.
 */

import { useEffect, useState } from 'react';
import type { PointerEvent } from 'react';
import type { DamageAssignmentChoice, LibraryManipulationChoice, OptionalTriggerChoice, PriorityStopKey, PriorityStops, SimpleGameState, SimpleLegalAction, SimpleCard, LastPlayedCard, TaxPaymentChoice, TriggerOrderChoiceState, WardPaymentChoice } from '../hooks/useShelectorGame';
import type { DamageAssignmentOrder } from 'commander-engine';
import type { EnginePrompt, EngineStateUpdate } from 'commander-engine';
import { Loader2, ChevronDown, ChevronRight, Search, X, Lightbulb, Menu, Undo2, BookmarkPlus } from 'lucide-react';
import { CardPickerModal } from './CardPickerModal';
import { CardImage } from './CardImage';
import { CARD_TILE_LAYOUT, FLOATING_TABLE_LAYOUT } from '../lib/gameBoardLayout';
import { getNewPlayerSuggestion } from '../lib/newPlayerSuggestions';
import type { PracticeBranchPreview } from '../lib/practiceBranchPreview';
import { buildTapAllManaPlan } from '../lib/manaTapPlanner';

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

function displayStepForPhase(phase: string | undefined, step: string | undefined): string {
  if (phase === 'precombat_main' && (!step || step === 'main' || step === 'begin_combat')) {
    return 'Main Phase 1';
  }
  if (phase === 'postcombat_main' && (!step || step === 'main' || step === 'end_of_combat' || step === 'end')) {
    return 'Main Phase 2';
  }
  if (step) return STEP_DISPLAY[step] || PHASE_DISPLAY[phase || ''] || step;
  return PHASE_DISPLAY[phase || ''] || phase || 'Phase';
}

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

interface ManualTokenInput {
  name: string;
  count: number;
  power: number;
  toughness: number;
  colors: string[];
  types: string[];
  subtypes: string[];
  keywords?: string[];
}

type ManualMoveZone = 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';
type ManualPhase = 'beginning' | 'precombat_main' | 'combat' | 'postcombat_main' | 'ending';
type ManualStep =
  | 'untap'
  | 'upkeep'
  | 'draw'
  | 'begin_combat'
  | 'declare_attackers'
  | 'declare_blockers'
  | 'first_strike_damage'
  | 'combat_damage'
  | 'end_of_combat'
  | 'end'
  | 'cleanup';

interface GameBoardProps {
  gameState: SimpleGameState;
  legalActions: SimpleLegalAction[];
  isHumanTurn: boolean;
  isLoading: boolean;
  onAction: (action: SimpleLegalAction) => void;
  mulliganPhase?: boolean;
  mulliganCount?: number;
  mulliganBottomCount?: number;
  selectedMulliganCardIds?: string[];
  selectedMulliganBottomIds?: string[];
  onKeepHand?: () => void;
  onMulligan?: (cardInstanceIds?: string[]) => void;
  onToggleMulliganCard?: (cardInstanceId: string) => void;
  onToggleMulliganBottom?: (cardInstanceId: string) => void;
  discardPhase?: boolean;
  discardCount?: number;
  onDiscardCard?: (cardInstanceId: string) => void;
  tutorPhase?: boolean;
  tutorCards?: { instanceId: string; name: string; typeLine: string; manaCost: string; oracleText?: string }[];
  tutorTitle?: string;
  onTutorPick?: (cardInstanceId: string) => void;
  onTutorCancel?: () => void;
  libraryChoice?: LibraryManipulationChoice | null;
  onResolveLibraryChoice?: (topIds: string[], movedIds: string[]) => void;
  optionalTriggerChoice?: OptionalTriggerChoice | null;
  onResolveOptionalTrigger?: (use: boolean) => void;
  taxPaymentChoice?: TaxPaymentChoice | null;
  onResolveTaxPayment?: (pay: boolean) => void;
  wardPaymentChoice?: WardPaymentChoice | null;
  onResolveWardPayment?: (pay: boolean) => void;
  damageAssignmentChoice?: DamageAssignmentChoice | null;
  onResolveDamageAssignment?: (orders: DamageAssignmentOrder[]) => void;
  triggerOrderChoice?: TriggerOrderChoiceState | null;
  onResolveTriggerOrder?: (orderedTriggerIds: string[]) => void;
  undosRemaining?: number;
  onUndo?: () => void;
  coachMode?: boolean;
  onToggleCoach?: (on: boolean) => void;
  newPlayerMode?: boolean;
  onToggleNewPlayerMode?: (on: boolean) => void;
  holdPriority?: boolean;
  onToggleHoldPriority?: (on: boolean) => void;
  priorityStops?: PriorityStops;
  onTogglePriorityStop?: (key: PriorityStopKey, on: boolean) => void;
  onSetAllPriorityStops?: (on: boolean) => void;
  collapseModeControlsOnMobile?: boolean;
  onUntapMana?: (cardInstanceId: string) => void;
  onAdjustCounters?: (cardInstanceId: string, counterType: string, delta: number) => void;
  onAdjustPlayerCounter?: (playerId: string, counterType: string, delta: number) => void;
  onAdjustCommanderDamage?: (playerId: string, commanderInstanceId: string, delta: number) => void;
  onMoveCard?: (cardInstanceId: string, zone: ManualMoveZone) => void;
  onAdjustDamage?: (cardInstanceId: string, delta: number) => void;
  onCreateToken?: (token: ManualTokenInput) => void;
  onAttachCard?: (cardInstanceId: string, targetId?: string) => void;
  onSetPhaseStep?: (activePlayerId: string, phase: ManualPhase, step: ManualStep) => void;
  untappableCardIds?: string[];
  lastPlayedCard?: LastPlayedCard | null;
  authorityUpdates?: EngineStateUpdate[];
  lastStateUpdate?: EngineStateUpdate | null;
  currentPrompt?: EnginePrompt | null;
  actionError?: { reason: string; message: string } | null;
  onClearActionError?: () => void;
  onBookmarkDrill?: () => void;
  drillBookmarkLabel?: string;
  practiceFocusTags?: string[];
  branchPreviews?: PracticeBranchPreview[];
  onLoadBranchPreview?: (actionId: string) => void;
  activeDrillLabel?: string | null;
  onSaveDrillAttempt?: () => void;
  onExitDrillAttempt?: () => void;
  menuActions?: { id: string; label: string; detail?: string; onSelect: () => void }[];
}

/** Compute counter badge entries from a card's counters record */
const HIDDEN_COUNTER_KEYS = new Set(['_powerMod', '_toughnessMod']);

function getCounterBadges(counters: Record<string, number>): { label: string; count: number }[] {
  return Object.entries(counters)
    .filter(([key, v]) => v > 0 && !HIDDEN_COUNTER_KEYS.has(key))
    .map(([key, count]) => ({ label: key, count }));
}

function getPlayerCounterBadges(player: SimpleGameState['humanPlayer']): { label: string; count: number }[] {
  const counters = { ...(player.playerCounters || {}) };
  if (player.poisonCounters > 0) counters.poison = player.poisonCounters;
  return Object.entries(counters)
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({ label, count }));
}

function getBattlefieldRowKey(card: SimpleCard): BattlefieldRowKey {
  if (card.cardTypes.includes('creature')) return 'creatures';
  if (card.cardTypes.includes('land')) return 'lands';
  if (card.cardTypes.includes('artifact')) return 'artifacts';
  if (card.cardTypes.includes('enchantment')) return 'enchantments';
  return 'other';
}

type PlayerNameResolver = (playerId: string | undefined) => string;

export function summarizeStateUpdate(
  update: EngineStateUpdate | null | undefined,
  nameForPlayer: PlayerNameResolver = playerId => playerId || 'none',
): string {
  if (!update) return '';
  const accepted = update.rulesEvents.find(event => event.kind === 'ActionAccepted');
  const actionRejected = update.rulesEvents.find(event => event.kind === 'ActionRejected');
  const promptAccepted = update.rulesEvents.find(event => event.kind === 'PromptResponseAccepted');
  const promptRejected = update.rulesEvents.find(event => event.kind === 'PromptResponseRejected');
  const hasRulesEvent = accepted || actionRejected || promptAccepted || promptRejected;
  const hasVisibleDiff = update.visibleDiffs.length > 0;
  const label = accepted?.kind === 'ActionAccepted'
    ? accepted.label || accepted.actionKind
    : actionRejected?.kind === 'ActionRejected'
    ? `Rejected ${actionRejected.actionKind}`
    : promptRejected?.kind === 'PromptResponseRejected'
    ? `Rejected ${promptRejected.promptKind}`
    : promptAccepted?.kind === 'PromptResponseAccepted'
    ? `${promptAccepted.promptKind} choice accepted`
    : !hasRulesEvent && !hasVisibleDiff && update.prompt?.title
    ? 'Prompt updated'
    : 'Engine update';
  const dice = update.rulesEvents
    .filter(event => event.kind === 'DiceRolled')
    .map(event => event.kind === 'DiceRolled'
      ? `${event.roll.sourceName || 'd20'} rolled ${event.roll.result}`
      : '')
    .filter(Boolean)
    .join('; ');
  const rejection = actionRejected?.kind === 'ActionRejected'
    ? actionRejected.message
    : promptRejected?.kind === 'PromptResponseRejected'
    ? promptRejected.message
    : '';
  const diffs = summarizeVisibleDiffs(update.visibleDiffs, nameForPlayer);
  const prompt = update.prompt?.title;
  return [label, rejection, dice, diffs, prompt].filter(Boolean).join(' - ');
}

function stateUpdateActor(update: EngineStateUpdate, gameState: SimpleGameState): string {
  const accepted = update.rulesEvents.find(event => event.kind === 'ActionAccepted');
  if (accepted?.kind !== 'ActionAccepted') return 'Engine';
  if (accepted.playerId === gameState.humanPlayer.id) return 'You';
  return gameState.aiCommanderNames[accepted.playerId]
    || gameState.aiPlayers.find(player => player.id === accepted.playerId)?.name
    || accepted.playerId;
}

function summarizeVisibleDiffs(diffs: EngineStateUpdate['visibleDiffs'], nameForPlayer: PlayerNameResolver): string {
  if (diffs.length === 0) return '';
  const shown = diffs.slice(0, 2).map(diff => describeVisibleDiff(diff, nameForPlayer));
  const extra = diffs.length > shown.length ? ` +${diffs.length - shown.length} more` : '';
  return `${shown.join('; ')}${extra}`;
}

function describeVisibleDiff(diff: EngineStateUpdate['visibleDiffs'][number], nameForPlayer: PlayerNameResolver): string {
  switch (diff.kind) {
    case 'CardZoneChanged':
      return `${diff.cardName || 'Card'}: ${diff.from || 'new'} -> ${diff.to || 'gone'}`;
    case 'CardTappedChanged':
      return `${diff.cardName || 'Card'} ${diff.to ? 'tapped' : 'untapped'}`;
    case 'CounterChanged':
      return `${diff.cardName || 'Card'} ${diff.counterType} ${diff.from} -> ${diff.to}`;
    case 'CardDamageChanged':
      return `${diff.cardName || 'Card'} damage ${diff.from} -> ${diff.to}`;
    case 'CardSummoningSicknessChanged':
      return `${diff.cardName || 'Card'} ${diff.to ? 'is summoning sick' : 'can tap/attack'}`;
    case 'CardPhasedOutChanged':
      return `${diff.cardName || 'Card'} ${diff.to ? 'phased out' : 'phased in'}`;
    case 'AttachmentChanged':
      return `${diff.cardName || 'Card'} attachment changed`;
    case 'LifeChanged':
      return `${nameForPlayer(diff.playerId)} life ${diff.from} -> ${diff.to}`;
    case 'ManaPoolChanged':
      return `${nameForPlayer(diff.playerId)} ${diff.color} mana ${diff.from} -> ${diff.to}`;
    case 'PoisonChanged':
      return `${nameForPlayer(diff.playerId)} poison ${diff.from} -> ${diff.to}`;
    case 'PlayerCounterChanged':
      return `${nameForPlayer(diff.playerId)} ${diff.counterType} ${diff.from} -> ${diff.to}`;
    case 'PlayerLostChanged':
      return diff.to ? `${nameForPlayer(diff.playerId)} lost` : `${nameForPlayer(diff.playerId)} returned`;
    case 'CommanderDamageChanged':
      return `${nameForPlayer(diff.playerId)} commander damage ${diff.from} -> ${diff.to}`;
    case 'CommanderTaxChanged':
      return `${nameForPlayer(diff.playerId)} commander tax ${diff.from} -> ${diff.to}`;
    case 'CommanderCastCountChanged':
      return `${nameForPlayer(diff.playerId)} commander casts ${diff.from} -> ${diff.to}`;
    case 'PhaseChanged':
      return `T${diff.to.turnNumber} ${displayStepForPhase(diff.to.phase, diff.to.step)}`;
    case 'PriorityChanged':
      return `priority ${nameForPlayer(diff.from)} -> ${nameForPlayer(diff.to)}`;
    case 'StackChanged':
      return diff.toTop?.name
        ? `stack ${diff.fromCount} -> ${diff.toCount}: ${diff.toTop.name}`
        : `stack ${diff.fromCount} -> ${diff.toCount}`;
    case 'CombatChanged':
      return `combat ${diff.from?.attackers.length || 0}/${diff.from?.blockers.length || 0} -> ${diff.to?.attackers.length || 0}/${diff.to?.blockers.length || 0}`;
    default: {
      const _never: never = diff;
      return _never;
    }
  }
}

const PROMPT_TYPE_LABELS: Record<string, string> = {
  'main-action': 'Action',
  priority: 'Priority',
  'stack-response': 'Stack',
  'declare-attackers': 'Attackers',
  'declare-blockers': 'Blockers',
  'game-over': 'Complete',
};

function promptMeta(prompt: EnginePrompt | null | undefined): string {
  if (!prompt) return '';
  const choiceCount = prompt.legalChoices.length;
  const stackText = prompt.priority.stackSize > 0
    ? ` - stack ${prompt.priority.stackSize}${prompt.priority.stackTop?.name ? `: ${prompt.priority.stackTop.name}` : ''}`
    : '';
  const passText = prompt.priority.passedPriorityPlayerIds.length > 0
    ? ` - passed ${prompt.priority.passedPriorityPlayerIds.length}`
    : '';
  return `${choiceCount} option${choiceCount === 1 ? '' : 's'}${stackText}${passText}`;
}

function promptChoiceSummaryText(prompt: EnginePrompt | null | undefined): string {
  const summary = prompt?.legalChoiceSummary;
  if (!summary?.length) return '';
  return summary
    .map(group => `${group.label} ${group.count}`)
    .join(' / ');
}

type ComplexTurnSignal = {
  label: string;
  detail: string;
  tone: 'amber' | 'sky' | 'fuchsia' | 'emerald';
};

function buildComplexTurnSignals(input: {
  gameState: SimpleGameState;
  legalActions: SimpleLegalAction[];
  currentPrompt?: EnginePrompt | null;
  triggerOrderChoice?: TriggerOrderChoiceState | null;
  optionalTriggerChoice?: OptionalTriggerChoice | null;
  taxPaymentChoice?: TaxPaymentChoice | null;
  wardPaymentChoice?: WardPaymentChoice | null;
  damageAssignmentChoice?: DamageAssignmentChoice | null;
  libraryChoice?: LibraryManipulationChoice | null;
  lastStateUpdate?: EngineStateUpdate | null;
}): ComplexTurnSignal[] {
  const signals: ComplexTurnSignal[] = [];
  const stackSize = input.currentPrompt?.priority.stackSize ?? input.gameState.stack.length;
  const battlefieldCount = input.gameState.humanBattlefield.length
    + Object.values(input.gameState.aiBattlefields).reduce((total, cards) => total + cards.length, 0);
  const dragonLineActive = [...input.gameState.humanBattlefield, ...input.gameState.humanHand, ...input.gameState.humanCommandZone]
    .some(card => /xenagos|dracogenesis|terror of the peaks|twinflame tyrant|anzrag|hellkite|dragon/i.test(card.name));

  if (input.triggerOrderChoice?.triggers.length) {
    const sources = [...new Set(input.triggerOrderChoice.triggers.map(trigger => trigger.sourceName))].slice(0, 3);
    signals.push({
      label: `${input.triggerOrderChoice.triggers.length} triggers waiting`,
      detail: `Order ${sources.join(', ')}${input.triggerOrderChoice.triggers.length > sources.length ? ', ...' : ''}; earlier damage/draw triggers can change later targets.`,
      tone: 'fuchsia',
    });
  }

  if (stackSize > 0) {
    const top = input.currentPrompt?.priority.stackTop?.name || input.gameState.stack[input.gameState.stack.length - 1]?.name || 'top object';
    signals.push({
      label: `Stack: ${stackSize}`,
      detail: `${top} is the current pressure point; responses and tax/ward choices still affect resolution.`,
      tone: 'sky',
    });
  }

  if (input.damageAssignmentChoice) {
    signals.push({
      label: 'Combat damage branch',
      detail: `${input.damageAssignmentChoice.groups.length} attacker group${input.damageAssignmentChoice.groups.length === 1 ? '' : 's'} need assignment; trample/deathtouch ordering changes lethal and survival math.`,
      tone: 'amber',
    });
  }

  if (input.optionalTriggerChoice || input.taxPaymentChoice || input.wardPaymentChoice || input.libraryChoice) {
    const titles = [
      input.optionalTriggerChoice?.sourceName,
      input.taxPaymentChoice ? `${input.taxPaymentChoice.sourceName} tax` : '',
      input.wardPaymentChoice ? `${input.wardPaymentChoice.sourceName} ward` : '',
      input.libraryChoice?.mode,
    ].filter(Boolean);
    signals.push({
      label: 'Choice checkpoint',
      detail: `${titles.join(' / ')} asks for a decision now; bookmark before choosing if this is a line you want to drill.`,
      tone: 'emerald',
    });
  }

  if (dragonLineActive && (stackSize > 0 || input.triggerOrderChoice || input.damageAssignmentChoice || battlefieldCount >= 10)) {
    signals.push({
      label: 'Xenagos line map',
      detail: 'Check the damage engine, Xenagos target, extra-combat outlet, and held interaction before clicking through the next prompt.',
      tone: 'amber',
    });
  }

  if ((input.lastStateUpdate?.visibleDiffs.length || 0) >= 4) {
    signals.push({
      label: 'Large state swing',
      detail: summarizeVisibleDiffs(input.lastStateUpdate?.visibleDiffs || [], playerId => playerId || 'player'),
      tone: 'sky',
    });
  }

  if (signals.length === 0 && input.legalActions.length >= 12) {
    signals.push({
      label: `${input.legalActions.length} available actions`,
      detail: 'This is a broad branch. Use coaching and bookmarks to compare the best-looking lines.',
      tone: 'emerald',
    });
  }

  return signals.slice(0, 4);
}

function complexSignalClass(tone: ComplexTurnSignal['tone']): string {
  switch (tone) {
    case 'amber':
      return 'border-amber-500/30 bg-amber-950/35 text-amber-100';
    case 'sky':
      return 'border-sky-500/30 bg-sky-950/35 text-sky-100';
    case 'fuchsia':
      return 'border-fuchsia-500/30 bg-fuchsia-950/35 text-fuchsia-100';
    case 'emerald':
      return 'border-emerald-500/30 bg-emerald-950/35 text-emerald-100';
    default:
      return 'border-neutral-700 bg-neutral-900 text-stone-100';
  }
}

function sortedCounterKey(counters: Record<string, number>): string {
  return Object.entries(counters)
    .filter(([key, count]) => count > 0 && !HIDDEN_COUNTER_KEYS.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => `${label}:${count}`)
    .join(',');
}

function normalizedKeywordKey(keywords?: string[]): string {
  return (keywords || [])
    .map(keyword => keyword.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .join(',');
}

function normalizedTokenTypeLine(typeLine: string): string {
  return typeLine
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function battlefieldStackKey(card: SimpleCard, row: BattlefieldRowKey, stackLands: boolean): string | null {
  if (card.isToken && !card.attachedTo && (!card.attachments || card.attachments.length === 0)) {
    return [
      'token',
      card.name,
      normalizedTokenTypeLine(card.typeLine),
      card.tapped ? 'tapped' : 'untapped',
      card.power ?? '',
      card.toughness ?? '',
      normalizedKeywordKey(card.keywords),
      card.damage || 0,
      sortedCounterKey(card.counters),
    ].join('|');
  }

  if (row === 'lands' && stackLands) {
    return `land|${card.name}|${card.tapped ? 'tapped' : 'untapped'}`;
  }

  return null;
}

function groupRowCards(cards: SimpleCard[], row: BattlefieldRowKey, stackLands: boolean): BattlefieldGroup[] {
  const buckets = new Map<string, SimpleCard[]>();
  const order: string[] = [];

  for (const card of cards) {
    const stackKey = battlefieldStackKey(card, row, stackLands);
    const key = stackKey || `single|${card.instanceId}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(card);
  }

  return order.flatMap(key => {
    const bucket = buckets.get(key) || [];
    if (bucket.length === 0) return [];
    if (key.startsWith('token|')) {
      return bucket.length >= 2
        ? [{ key, card: bucket[0], cards: bucket }]
        : [{ key: bucket[0].instanceId, card: bucket[0], cards: [bucket[0]] }];
    }
    if (key.startsWith('land|')) {
      return bucket.length >= 3
        ? [{ key, card: bucket[0], cards: bucket }]
        : bucket.map(card => ({ key: card.instanceId, card, cards: [card] }));
    }
    return { key: bucket[0].instanceId, card: bucket[0], cards: [bucket[0]] };
  });
}

export function groupBattlefieldCards(cards: SimpleCard[], stackLands: boolean): Record<BattlefieldRowKey, BattlefieldGroup[]> {
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
    creatures: groupRowCards(rows.creatures, 'creatures', stackLands),
    artifacts: groupRowCards(rows.artifacts, 'artifacts', stackLands),
    enchantments: groupRowCards(rows.enchantments, 'enchantments', stackLands),
    lands: groupRowCards(rows.lands, 'lands', stackLands),
    other: groupRowCards(rows.other, 'other', stackLands),
  };

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
  targetable,
  targetLabel,
  onClick,
  onInspect,
  onHoverCard,
  compact,
  inspectable,
  inspectOnPointerDown,
  selected,
  selectedLabel,
  stackCount = 1,
  testId,
}: {
  card: SimpleCard;
  playable: boolean;
  targetable?: boolean;
  targetLabel?: string;
  onClick?: () => void;
  onInspect?: () => void;
  onHoverCard?: (card: SimpleCard | null) => void;
  compact?: boolean;
  inspectable?: boolean;
  inspectOnPointerDown?: boolean;
  selected?: boolean;
  selectedLabel?: string;
  stackCount?: number;
  testId?: string;
}) {
  const isCreature = card.cardTypes.includes('creature');
  const isLand = card.cardTypes.includes('land');
  const counterBadges = getCounterBadges(card.counters);
  const interactive = playable || !!onClick;
  // Floating table mode: compact enough to see both boards without losing click area.
  const w = compact ? CARD_TILE_LAYOUT.compactSize : CARD_TILE_LAYOUT.defaultSize;
  const buttonSpacing = compact ? CARD_TILE_LAYOUT.compactButton : CARD_TILE_LAYOUT.defaultButton;
  const titleClass = compact ? CARD_TILE_LAYOUT.compactTitle : CARD_TILE_LAYOUT.defaultTitle;
  const metaClass = compact ? CARD_TILE_LAYOUT.compactMeta : CARD_TILE_LAYOUT.defaultMeta;
  const keywordBadges = (card.keywords || []).filter(Boolean).slice(0, compact ? 2 : 4);
  const openInspectOnPointerDown = (event: PointerEvent) => {
    if (!inspectOnPointerDown || !onInspect) return;
    event.preventDefault();
    event.stopPropagation();
    onInspect();
  };

  // Border color: playable > token > default
  const borderClass = selected
    ? 'border-amber-400 bg-amber-950/60 cursor-pointer ring-2 ring-amber-400/50 shadow-lg shadow-amber-950/20'
    : playable
    ? 'border-green-500 bg-stone-700 hover:bg-stone-600 cursor-pointer ring-1 ring-green-500/50 shadow-lg shadow-green-900/20'
    : targetable
      ? 'border-sky-400 bg-sky-950/70 cursor-pointer ring-2 ring-sky-400/45 shadow-lg shadow-sky-950/30 hover:bg-sky-900/80'
    : card.isToken
      ? `border-violet-500 bg-stone-800 ring-1 ring-violet-500/30 ${interactive ? 'cursor-pointer hover:bg-stone-700' : 'cursor-default'}`
      : `border-stone-600 bg-stone-800 ${interactive ? 'cursor-pointer hover:bg-stone-700' : 'cursor-default'}`;

  return (
    <div
      data-testid={testId}
      data-card-name={card.name}
      data-card-type={card.typeLine}
      className={`group relative shrink-0 ${w}`}
      onPointerEnter={() => onHoverCard?.(card)}
      onPointerMove={() => onHoverCard?.(card)}
      onPointerLeave={() => onHoverCard?.(null)}
      onMouseEnter={() => onHoverCard?.(card)}
      onMouseLeave={() => onHoverCard?.(null)}
      onFocus={() => onHoverCard?.(card)}
      onBlur={() => onHoverCard?.(null)}
    >
      <button
        type="button"
        onClick={onClick}
        onPointerDown={openInspectOnPointerDown}
        disabled={!playable && !onClick}
        aria-pressed={selected ? true : undefined}
        title={
          selected
            ? selectedLabel
              ? `${card.name} selected for ${selectedLabel.toLowerCase()}`
              : `${card.name} selected`
            : targetable
            ? targetLabel || 'Choose as target'
            : playable
            ? 'Use card'
            : inspectable
            ? 'Inspect card'
            : card.name
        }
        className={`
          absolute inset-0 flex h-full w-full flex-col justify-between
          overflow-hidden rounded-lg border text-left transition-all
          ${buttonSpacing}
          ${card.tapped ? 'rotate-6 opacity-60' : ''}
          ${borderClass}
        `}
      >
        {/* Card name */}
        <div className={titleClass}>
          {card.name}
        </div>

        {/* Mana cost */}
        {card.manaCost && (
          <div className="mt-0.5 line-clamp-1 text-[8px] leading-tight text-stone-400 md:text-[10px]">
            {card.manaCost}
          </div>
        )}

        {/* Type line */}
        <div className={metaClass}>
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
          {keywordBadges.length > 0 && (
            <div className="mb-0.5 flex flex-wrap gap-0.5">
              {keywordBadges.map(keyword => (
                <span
                  key={keyword}
                  className="rounded bg-sky-950/80 px-1 text-[6px] font-bold uppercase leading-tight text-sky-200 md:text-[7px]"
                >
                  {keyword}
                </span>
              ))}
            </div>
          )}
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

        {targetable && (
          <div className="absolute left-1 top-1 rounded bg-sky-400 px-1 py-px text-[7px] font-black uppercase leading-none text-neutral-950 shadow">
            Target
          </div>
        )}

        {/* Stack count */}
        {stackCount > 1 && (
          <div className="absolute top-1 left-1 rounded bg-amber-500 px-1.5 py-0.5 text-[9px] font-black leading-none text-neutral-950 shadow">
            x{stackCount}
          </div>
        )}

        {selected && (
          <div className="absolute inset-x-1 top-1 rounded bg-amber-400 px-1 py-px text-center text-[7px] font-black uppercase leading-none text-neutral-950">
            {selectedLabel || 'Selected'}
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
          onPointerDown={event => {
            event.preventDefault();
            event.stopPropagation();
            onInspect();
          }}
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

function CommandZoneStrip({
  cards,
  label,
  testId,
  tone,
  getStatus,
  onCardAction,
  onInspect,
  onHoverCard,
}: {
  cards: SimpleCard[];
  label: string;
  testId: string;
  tone: 'human' | 'opponent';
  getStatus: (card: SimpleCard) => { label: string; title?: string; active?: boolean; targetable?: boolean };
  onCardAction: (card: SimpleCard) => void;
  onInspect: (card: SimpleCard) => void;
  onHoverCard?: (card: SimpleCard | null) => void;
}) {
  const isHuman = tone === 'human';
  const headerClass = isHuman ? 'text-emerald-200' : 'text-red-200';
  const borderClass = isHuman ? 'border-emerald-500/30 bg-emerald-950/20' : 'border-red-500/25 bg-red-950/15';
  const cardBaseClass = isHuman
    ? 'border-emerald-700/45 bg-neutral-950/75 hover:border-emerald-400/80'
    : 'border-red-800/45 bg-neutral-950/75 hover:border-red-400/70';

  return (
    <section
      data-testid={testId}
      aria-label={label}
      className={`mb-2 rounded-lg border px-2 py-1.5 ${borderClass}`}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className={`text-[10px] font-black uppercase tracking-[0.18em] ${headerClass}`}>
          Command Zone
        </div>
        <div className="rounded border border-amber-500/30 bg-amber-950/35 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-100">
          {cards.length} {cards.length === 1 ? 'Commander' : 'Commanders'}
        </div>
      </div>
      <div className={`grid gap-1.5 ${cards.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {cards.map(card => {
          const status = getStatus(card);
          const keywordBadges = (card.keywords || []).filter(Boolean).slice(0, 3);
          const isCreature = card.cardTypes.includes('creature');
          return (
            <div
              key={card.instanceId}
              data-testid="command-zone-card"
              className={`group relative min-w-0 rounded-lg border transition-colors ${cardBaseClass}`}
              onPointerEnter={() => onHoverCard?.(card)}
              onPointerMove={() => onHoverCard?.(card)}
              onPointerLeave={() => onHoverCard?.(null)}
              onMouseEnter={() => onHoverCard?.(card)}
              onMouseLeave={() => onHoverCard?.(null)}
            >
              <button
                type="button"
                onClick={() => onCardAction(card)}
                title={status.title || `Inspect ${card.name}`}
                className="flex min-h-[4.25rem] w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left"
              >
                <div
                  className={`h-14 w-10 shrink-0 overflow-hidden rounded border bg-stone-200 ${
                    status.active
                      ? 'border-green-400 ring-2 ring-green-400/35'
                      : status.targetable
                        ? 'border-sky-400 ring-2 ring-sky-400/35'
                        : 'border-amber-600/45'
                  }`}
                >
                  <CardImage cardName={card.name} size="small" showHoverZoom={false} className="h-full w-full" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-black leading-tight text-stone-100 md:text-sm">
                    {card.name}
                  </div>
                  <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                    {card.manaCost && (
                      <span className="rounded border border-stone-700 bg-neutral-900 px-1.5 py-0.5 text-[9px] font-bold text-stone-300">
                        {card.manaCost}
                      </span>
                    )}
                    <span className="rounded border border-amber-600/35 bg-amber-950/35 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-100">
                      CMD
                    </span>
                    {isCreature && card.power != null && card.toughness != null && (
                      <span className="rounded border border-stone-700 bg-neutral-900 px-1.5 py-0.5 text-[9px] font-black text-stone-200">
                        {card.power}/{card.toughness}
                      </span>
                    )}
                    {keywordBadges.map(keyword => (
                      <span
                        key={keyword}
                        className="rounded border border-sky-700/45 bg-sky-950/45 px-1.5 py-0.5 text-[8px] font-black uppercase text-sky-100"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 truncate text-[10px] font-semibold text-stone-400">
                    {card.typeLine || 'Commander'}
                  </div>
                </div>
                <div
                  className={`hidden shrink-0 rounded border px-2 py-1 text-[9px] font-black uppercase tracking-wide sm:block ${
                    status.active
                      ? 'border-green-400/50 bg-green-950/50 text-green-100'
                      : status.targetable
                        ? 'border-sky-400/50 bg-sky-950/55 text-sky-100'
                        : 'border-stone-700 bg-neutral-900 text-stone-300'
                  }`}
                >
                  {status.label}
                </div>
              </button>
              <button
                type="button"
                aria-label={`Inspect ${card.name}`}
                title={`Inspect ${card.name}`}
                onPointerDown={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  onInspect(card);
                }}
                onClick={event => {
                  event.stopPropagation();
                  onInspect(card);
                }}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-stone-500/70 bg-neutral-950/90 text-stone-300 transition-colors hover:border-amber-400 hover:text-amber-200"
              >
                <Search className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
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

function CardHoverPreview({
  card,
  actionLabel,
  actionPaymentPreview,
  unavailableHint,
}: {
  card: SimpleCard;
  actionLabel?: string;
  actionPaymentPreview?: string;
  unavailableHint?: string;
}) {
  const isCreature = card.cardTypes.includes('creature');
  const counters = getCounterBadges(card.counters);

  return (
    <div
      data-testid="card-hover-preview"
      className="pointer-events-none fixed left-1/2 top-1/2 z-[65] max-h-[min(82vh,44rem)] w-[min(26rem,86vw)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-lg border border-amber-500/35 bg-neutral-950 shadow-2xl shadow-black/45"
    >
      <div className="grid grid-cols-[7.5rem_1fr] gap-3 p-3">
        <CardImage
          cardName={card.name}
          size="normal"
          showHoverZoom={false}
          className="aspect-[5/7] w-full overflow-hidden rounded-md bg-stone-200"
        />
        <div className="min-w-0 space-y-2">
          <div>
            <div className="line-clamp-2 text-sm font-black leading-tight text-stone-100">{card.name}</div>
            {card.manaCost && (
              <div className="mt-1 scale-75 origin-left">
                <ManaCostText manaCost={card.manaCost} />
              </div>
            )}
          </div>
          <div className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-[11px] font-semibold leading-snug text-stone-300">
            {card.typeLine || 'Card'}
          </div>
          {isCreature && card.power != null && card.toughness != null && (
            <div className="inline-flex rounded border border-stone-600 bg-neutral-900 px-2 py-1 text-sm font-black text-stone-100">
              {card.power}/{card.toughness}
            </div>
          )}
          <div className="flex flex-wrap gap-1 text-[10px] font-bold uppercase tracking-wide">
            <span className="rounded bg-stone-800 px-1.5 py-0.5 text-stone-300">{card.zone}</span>
            {card.tapped && <span className="rounded bg-orange-950 px-1.5 py-0.5 text-orange-200">Tapped</span>}
            {card.isCommander && <span className="rounded bg-amber-950 px-1.5 py-0.5 text-amber-200">Commander</span>}
            {card.isToken && <span className="rounded bg-violet-950 px-1.5 py-0.5 text-violet-200">Token</span>}
            {(card.keywords || []).map(keyword => (
              <span key={keyword} className="rounded bg-sky-950 px-1.5 py-0.5 text-sky-200">
                {keyword}
              </span>
            ))}
            {counters.map(({ label, count }) => (
              <span key={label} className="rounded bg-green-950 px-1.5 py-0.5 text-green-200">
                {label}: {count}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="max-h-40 overflow-hidden border-t border-neutral-800 px-3 py-2">
        {card.oracleText ? (
          <div className="whitespace-pre-line text-xs leading-relaxed text-stone-200">{card.oracleText}</div>
        ) : (
          <div className="text-xs text-stone-500">No rules text.</div>
        )}
      </div>
      {(actionLabel || unavailableHint) && (
        <div className="border-t border-neutral-800 bg-neutral-900/85 px-3 py-2">
          {actionLabel ? (
            <div className="text-xs font-black text-green-200">{actionLabel}</div>
          ) : (
            <div className="text-xs font-semibold leading-snug text-stone-400">{unavailableHint}</div>
          )}
          {actionPaymentPreview && (
            <div className="mt-1 rounded border border-amber-500/25 bg-amber-950/35 px-2 py-1 text-[11px] font-semibold text-amber-100">
              {actionPaymentPreview}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CardInspectorModal({
  card,
  actionLabel,
  actionPaymentPreview,
  unavailableHint,
  secondaryActionLabel,
  onPrimaryAction,
  onSecondaryAction,
  onAdjustCounter,
  onMoveCard,
  onAdjustDamage,
  onAttachCard,
  onClose,
}: {
  card: SimpleCard;
  actionLabel?: string;
  actionPaymentPreview?: string;
  unavailableHint?: string;
  secondaryActionLabel?: string;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
  onAdjustCounter?: (counterType: string, delta: number) => void;
  onMoveCard?: (zone: ManualMoveZone) => void;
  onAdjustDamage?: (delta: number) => void;
  onAttachCard?: (cardInstanceId: string, targetId?: string) => void;
  onClose: () => void;
}) {
  const isCreature = card.cardTypes.includes('creature');
  const counters = getCounterBadges(card.counters);
  const [customCounter, setCustomCounter] = useState('');
  const canAdjustCounters = card.zone === 'battlefield' && !!onAdjustCounter;
  const canAdjustDamage = card.zone === 'battlefield' && !!onAdjustDamage;
  const canMoveCard = !!onMoveCard && card.zone !== 'stack' && card.zone !== 'library';
  const canAttachCard = card.zone === 'battlefield' && !!onAttachCard;
  const quickCounters = ['+1/+1', '-1/-1', 'loyalty', 'shield', 'stun'];
  const zoneChoices: { zone: ManualMoveZone; label: string; commanderOnly?: boolean }[] = [
    { zone: 'battlefield', label: 'Battlefield' },
    { zone: 'graveyard', label: 'Graveyard' },
    { zone: 'exile', label: 'Exile' },
    { zone: 'hand', label: 'Hand' },
    { zone: 'command', label: 'Command Zone', commanderOnly: true },
  ];
  const submitCustomCounter = (delta: number) => {
    const counter = customCounter.trim();
    if (!counter || !onAdjustCounter) return;
    onAdjustCounter(counter, delta);
  };

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
              {(card.keywords || []).map(keyword => (
                <span key={keyword} className="rounded border border-sky-700/60 bg-sky-950/60 px-2 py-1 text-sky-200">
                  {keyword}
                </span>
              ))}
              {counters.map(({ label, count }) => (
                <span key={label} className="rounded border border-green-700/60 bg-green-950/60 px-2 py-1 text-green-200">
                  {label}: {count}
                </span>
              ))}
            </div>

            {(onPrimaryAction && actionLabel) || (onSecondaryAction && secondaryActionLabel) ? (
              <div className="flex flex-wrap gap-2">
                {onPrimaryAction && actionLabel && (
                  <div className="max-w-full">
                    <button
                      type="button"
                      onClick={() => {
                        onPrimaryAction();
                        onClose();
                      }}
                      className="min-h-[44px] rounded bg-green-700 px-4 py-2 text-left text-sm font-bold text-white transition-colors hover:bg-green-600"
                    >
                      {actionLabel}
                    </button>
                    {actionPaymentPreview && (
                      <div className="mt-1 max-w-sm rounded border border-amber-500/25 bg-amber-950/35 px-2 py-1 text-[11px] font-semibold text-amber-100">
                        {actionPaymentPreview}
                      </div>
                    )}
                  </div>
                )}
                {onSecondaryAction && secondaryActionLabel && (
                  <button
                    type="button"
                    onClick={() => {
                      onSecondaryAction();
                      onClose();
                    }}
                    className="min-h-[44px] rounded border border-red-600/40 bg-red-950/70 px-4 py-2 text-sm font-bold text-red-100 transition-colors hover:bg-red-900"
                  >
                    {secondaryActionLabel}
                  </button>
                )}
              </div>
            ) : unavailableHint ? (
              <div className="rounded border border-sky-500/25 bg-sky-950/30 p-3 text-xs leading-relaxed text-sky-100">
                <div className="mb-1 font-black uppercase tracking-wider text-sky-300">No legal action now</div>
                {unavailableHint}
              </div>
            ) : null}

            {canAdjustCounters && (
              <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Manual Counters
                </div>
                <div className="flex flex-wrap gap-2">
                  {quickCounters.map(counter => (
                    <div key={counter} className="flex overflow-hidden rounded border border-neutral-700">
                      <button
                        type="button"
                        onClick={() => onAdjustCounter(counter, -1)}
                        className="min-h-9 min-w-9 bg-neutral-950 px-2 text-sm font-black text-stone-300 transition-colors hover:bg-neutral-800"
                        title={`Remove ${counter}`}
                      >
                        -
                      </button>
                      <button
                        type="button"
                        onClick={() => onAdjustCounter(counter, 1)}
                        className="min-h-9 bg-neutral-950 px-2 text-xs font-bold text-stone-100 transition-colors hover:bg-neutral-800"
                        title={`Add ${counter}`}
                      >
                        {counter}
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={customCounter}
                    onChange={event => setCustomCounter(event.target.value)}
                    placeholder="counter type"
                    className="min-h-10 min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-3 text-sm text-stone-100 placeholder:text-stone-600 focus:border-amber-400 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => submitCustomCounter(-1)}
                    disabled={!customCounter.trim()}
                    className="min-h-10 rounded border border-neutral-700 bg-neutral-950 px-3 text-sm font-bold text-stone-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    onClick={() => submitCustomCounter(1)}
                    disabled={!customCounter.trim()}
                    className="min-h-10 rounded bg-amber-400 px-3 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}

            {canAdjustDamage && (
              <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Manual Damage
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-red-800/60 bg-red-950/50 px-2 py-1 text-xs font-bold text-red-100">
                    Marked: {card.damage || 0}
                  </span>
                  {[-5, -1, 1, 5].map(delta => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => onAdjustDamage(delta)}
                      className="min-h-9 min-w-10 rounded border border-neutral-700 bg-neutral-950 px-2 text-sm font-black text-stone-200 transition-colors hover:bg-neutral-800"
                      title={`${delta > 0 ? 'Add' : 'Remove'} ${Math.abs(delta)} damage`}
                    >
                      {delta > 0 ? `+${delta}` : delta}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {canMoveCard && (
              <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Manual Zones
                </div>
                <div className="flex flex-wrap gap-2">
                  {zoneChoices
                    .filter(choice => !choice.commanderOnly || card.isCommander)
                    .map(choice => {
                      const isCurrent = card.zone === choice.zone;
                      return (
                        <button
                          key={choice.zone}
                          type="button"
                          disabled={isCurrent}
                          onClick={() => {
                            onMoveCard(choice.zone);
                            onClose();
                          }}
                          className="min-h-10 rounded border border-neutral-700 bg-neutral-950 px-3 text-sm font-bold text-stone-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:border-neutral-800 disabled:text-stone-600"
                        >
                          {choice.label}
                        </button>
                      );
                    })}
                </div>
                <div className="mt-2 text-[11px] leading-relaxed text-stone-500">
                  Manual correction for missed zone changes, commander replacement, exile, and graveyard movement.
                </div>
              </div>
            )}

            {canAttachCard && (
              <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  Manual Attachments
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onAttachCard(card.instanceId);
                      onClose();
                    }}
                    className="min-h-10 rounded border border-neutral-700 bg-neutral-950 px-3 text-sm font-bold text-stone-200 transition-colors hover:bg-neutral-800"
                  >
                    Attach to...
                  </button>
                  {card.attachedTo && (
                    <button
                      type="button"
                      onClick={() => {
                        onAttachCard(card.instanceId, '');
                        onClose();
                      }}
                      className="min-h-10 rounded border border-amber-700/60 bg-amber-950/50 px-3 text-sm font-bold text-amber-100 transition-colors hover:bg-amber-900"
                    >
                      Detach this card
                    </button>
                  )}
                </div>
                {card.attachments && card.attachments.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {card.attachments.map(attachment => (
                      <div
                        key={attachment.instanceId}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/25 bg-amber-950/20 px-2 py-1.5"
                      >
                        <span className="min-w-0 text-xs font-bold text-amber-100">{attachment.name}</span>
                        <button
                          type="button"
                          onClick={() => onAttachCard(attachment.instanceId, '')}
                          className="min-h-8 rounded border border-amber-700/60 bg-neutral-950 px-2 text-xs font-bold text-amber-100 transition-colors hover:bg-amber-900"
                        >
                          Detach
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-[11px] leading-relaxed text-stone-500">
                  Manual correction for equipment, Auras, and other attached permanents when automation misses a move.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const TOKEN_PRESETS: { label: string; token: ManualTokenInput }[] = [
  {
    label: 'Treasure',
    token: { name: 'Treasure', count: 1, power: 0, toughness: 0, colors: [], types: ['artifact'], subtypes: ['Treasure'], keywords: [] },
  },
  {
    label: 'Goblin',
    token: { name: 'Goblin', count: 1, power: 1, toughness: 1, colors: ['R'], types: ['creature'], subtypes: ['Goblin'], keywords: [] },
  },
  {
    label: 'Drake',
    token: { name: 'Drake', count: 1, power: 2, toughness: 2, colors: ['U'], types: ['creature'], subtypes: ['Drake'], keywords: ['flying'] },
  },
  {
    label: 'Beast',
    token: { name: 'Beast', count: 1, power: 3, toughness: 3, colors: ['G'], types: ['creature'], subtypes: ['Beast'], keywords: [] },
  },
];

const PRIORITY_STOP_OPTIONS: { key: PriorityStopKey; label: string; detail: string }[] = [
  { key: 'upkeep', label: 'Upkeep', detail: 'Pause on upkeep priority.' },
  { key: 'draw', label: 'Draw', detail: 'Pause after draws resolve.' },
  { key: 'main', label: 'Main', detail: 'Pause on main-phase priority.' },
  { key: 'beginCombat', label: 'Begin Combat', detail: 'Pause before attackers.' },
  { key: 'declareAttackers', label: 'Attackers', detail: 'Pause around attacker declarations.' },
  { key: 'declareBlockers', label: 'Blockers', detail: 'Pause around blockers.' },
  { key: 'combatDamage', label: 'Damage', detail: 'Pause around combat damage.' },
  { key: 'endStep', label: 'End Step', detail: 'Pause at end step priority.' },
];

const MANUAL_PHASE_CHOICES: { id: string; label: string; phase: ManualPhase; step: ManualStep }[] = [
  { id: 'untap', label: 'Untap', phase: 'beginning', step: 'untap' },
  { id: 'upkeep', label: 'Upkeep', phase: 'beginning', step: 'upkeep' },
  { id: 'draw', label: 'Draw', phase: 'beginning', step: 'draw' },
  { id: 'main1', label: 'Main 1', phase: 'precombat_main', step: 'begin_combat' },
  { id: 'begin-combat', label: 'Begin Combat', phase: 'combat', step: 'begin_combat' },
  { id: 'attackers', label: 'Attackers', phase: 'combat', step: 'declare_attackers' },
  { id: 'blockers', label: 'Blockers', phase: 'combat', step: 'declare_blockers' },
  { id: 'first-strike', label: 'First Strike Damage', phase: 'combat', step: 'first_strike_damage' },
  { id: 'damage', label: 'Combat Damage', phase: 'combat', step: 'combat_damage' },
  { id: 'end-combat', label: 'End Combat', phase: 'combat', step: 'end_of_combat' },
  { id: 'main2', label: 'Main 2', phase: 'postcombat_main', step: 'end' },
  { id: 'end', label: 'End Step', phase: 'ending', step: 'end' },
  { id: 'cleanup', label: 'Cleanup', phase: 'ending', step: 'cleanup' },
];

function splitTokenWords(value: string, fallback: string[]): string[] {
  const words = value
    .split(',')
    .map(part => part.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
  return words.length > 0 ? words : fallback;
}

function ManualTokenModal({
  onCreate,
  onCancel,
}: {
  onCreate: (token: ManualTokenInput) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('Goblin');
  const [count, setCount] = useState(1);
  const [power, setPower] = useState(1);
  const [toughness, setToughness] = useState(1);
  const [colors, setColors] = useState<string[]>(['R']);
  const [types, setTypes] = useState('creature');
  const [subtypes, setSubtypes] = useState('Goblin');
  const [keywords, setKeywords] = useState('');

  const applyPreset = (preset: ManualTokenInput) => {
    setName(preset.name);
    setCount(preset.count);
    setPower(preset.power);
    setToughness(preset.toughness);
    setColors(preset.colors);
    setTypes(preset.types.join(', '));
    setSubtypes(preset.subtypes.join(', '));
    setKeywords((preset.keywords || []).join(', '));
  };
  const toggleColor = (color: string) => {
    setColors(prev => prev.includes(color) ? prev.filter(value => value !== color) : [...prev, color]);
  };
  const createToken = () => {
    const cleanName = name.trim().replace(/\s+/g, ' ');
    if (!cleanName) return;
    onCreate({
      name: cleanName,
      count: Math.max(1, Math.min(99, Math.floor(count || 1))),
      power: Math.trunc(power || 0),
      toughness: Math.trunc(toughness || 0),
      colors,
      types: splitTokenWords(types, ['creature']),
      subtypes: splitTokenWords(subtypes, [cleanName]),
      keywords: splitTokenWords(keywords, []),
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[74] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create token"
        className="w-[min(34rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-amber-500/35 bg-neutral-950 shadow-2xl shadow-black/70"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Manual Correction</div>
            <div className="text-lg font-black text-stone-100">Create Token</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 w-9 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-stone-300 transition-colors hover:bg-neutral-800 hover:text-white"
            aria-label="Close token creator"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[76vh] space-y-4 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TOKEN_PRESETS.map(preset => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset.token)}
                className="min-h-10 rounded border border-neutral-700 bg-neutral-900 px-3 text-sm font-bold text-stone-100 transition-colors hover:border-amber-400/70 hover:bg-neutral-800"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Name</span>
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Count</span>
              <input
                type="number"
                min={1}
                max={99}
                value={count}
                onChange={event => setCount(Number(event.target.value))}
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Power</span>
              <input
                type="number"
                value={power}
                onChange={event => setPower(Number(event.target.value))}
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Toughness</span>
              <input
                type="number"
                value={toughness}
                onChange={event => setToughness(Number(event.target.value))}
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-bold uppercase tracking-wider text-stone-500">Colors</div>
            <div className="flex flex-wrap gap-2">
              {['W', 'U', 'B', 'R', 'G'].map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => toggleColor(color)}
                  className={`flex h-10 w-10 items-center justify-center rounded-full border text-sm font-black transition-colors ${
                    colors.includes(color)
                      ? 'border-amber-300 bg-amber-400 text-neutral-950'
                      : 'border-neutral-700 bg-neutral-900 text-stone-300 hover:border-neutral-500'
                  }`}
                >
                  {color}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setColors([])}
                className="min-h-10 rounded border border-neutral-700 bg-neutral-900 px-3 text-xs font-bold text-stone-300 transition-colors hover:border-neutral-500"
              >
                Colorless
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Types</span>
              <input
                value={types}
                onChange={event => setTypes(event.target.value)}
                placeholder="creature, artifact"
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 placeholder:text-stone-600 focus:border-amber-400 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Subtypes</span>
              <input
                value={subtypes}
                onChange={event => setSubtypes(event.target.value)}
                placeholder="Goblin"
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 placeholder:text-stone-600 focus:border-amber-400 focus:outline-none"
              />
            </label>
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Keywords</span>
              <input
                value={keywords}
                onChange={event => setKeywords(event.target.value)}
                placeholder="flying, haste"
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 placeholder:text-stone-600 focus:border-amber-400 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded border border-neutral-700 bg-neutral-950 px-4 text-sm font-bold text-stone-200 transition-colors hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={createToken}
              disabled={!name.trim()}
              className="min-h-11 rounded bg-amber-400 px-4 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Create Token
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualPlayerCounterModal({
  players,
  commanders = [],
  onAdjust,
  onAdjustCommanderDamage,
  onCancel,
}: {
  players: SimpleGameState['aiPlayers'];
  commanders?: { instanceId: string; name: string }[];
  onAdjust: (playerId: string, counterType: string, delta: number) => void;
  onAdjustCommanderDamage?: (playerId: string, commanderInstanceId: string, delta: number) => void;
  onCancel: () => void;
}) {
  const [playerId, setPlayerId] = useState(players[0]?.id || '');
  const [counterType, setCounterType] = useState('poison');
  const [commanderId, setCommanderId] = useState(commanders[0]?.instanceId || '');
  const selectedPlayer = players.find(player => player.id === playerId) || players[0];
  const selectedCommander = commanders.find(commander => commander.instanceId === commanderId) || commanders[0];
  const quickCounters = ['poison', 'energy', 'experience', 'the ring', 'rad', 'ticket'];

  useEffect(() => {
    if (!playerId && players[0]) setPlayerId(players[0].id);
  }, [playerId, players]);

  useEffect(() => {
    if (!commanderId && commanders[0]) setCommanderId(commanders[0].instanceId);
  }, [commanderId, commanders]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const adjust = (delta: number) => {
    const cleanCounter = counterType.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!selectedPlayer || !cleanCounter) return;
    onAdjust(selectedPlayer.id, cleanCounter, delta);
  };
  const adjustCommander = (delta: number) => {
    if (!selectedPlayer || !selectedCommander || !onAdjustCommanderDamage) return;
    onAdjustCommanderDamage(selectedPlayer.id, selectedCommander.instanceId, delta);
  };

  return (
    <div
      className="fixed inset-0 z-[74] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Adjust player counters"
        className="w-[min(30rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-amber-500/35 bg-neutral-950 shadow-2xl shadow-black/70"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Manual Correction</div>
            <div className="text-lg font-black text-stone-100">Player Counters</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 w-9 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-stone-300 transition-colors hover:bg-neutral-800 hover:text-white"
            aria-label="Close player counter editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Player</span>
              <select
                value={playerId}
                onChange={event => setPlayerId(event.target.value)}
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
              >
                {players.map(player => (
                  <option key={player.id} value={player.id}>{player.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Counter Type</span>
              <input
                value={counterType}
                onChange={event => setCounterType(event.target.value)}
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {quickCounters.map(counter => (
              <button
                key={counter}
                type="button"
                onClick={() => setCounterType(counter)}
                className={`min-h-9 rounded border px-3 text-xs font-bold transition-colors ${
                  counterType === counter
                    ? 'border-amber-300 bg-amber-400 text-neutral-950'
                    : 'border-neutral-700 bg-neutral-900 text-stone-300 hover:border-neutral-500'
                }`}
              >
                {counter}
              </button>
            ))}
          </div>

          {selectedPlayer && (
            <div className="rounded border border-neutral-800 bg-neutral-900 p-3 text-xs text-stone-300">
              <div className="mb-2 font-black uppercase tracking-wider text-stone-500">Current</div>
              <div className="flex flex-wrap gap-2">
                {getPlayerCounterBadges(selectedPlayer).length > 0 ? (
                  getPlayerCounterBadges(selectedPlayer).map(counter => (
                    <span key={counter.label} className="rounded border border-green-700/60 bg-green-950/60 px-2 py-1 text-green-200">
                      {counter.label}: {counter.count}
                    </span>
                  ))
                ) : (
                  <span className="text-stone-500">No player counters.</span>
                )}
              </div>
            </div>
          )}

          {onAdjustCommanderDamage && commanders.length > 0 && (
            <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                Commander Damage
              </div>
              <label className="mb-3 block space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
                <span>Source Commander</span>
                <select
                  value={commanderId}
                  onChange={event => setCommanderId(event.target.value)}
                  className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-950 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
                >
                  {commanders.map(commander => (
                    <option key={commander.instanceId} value={commander.instanceId}>{commander.name}</option>
                  ))}
                </select>
              </label>
              <div className="mb-3 flex flex-wrap gap-2 text-xs text-stone-300">
                {selectedPlayer && commanders.map(commander => {
                  const amount = selectedPlayer.commanderDamage[commander.instanceId] || 0;
                  if (amount <= 0) return null;
                  return (
                    <span key={commander.instanceId} className="rounded border border-red-700/60 bg-red-950/50 px-2 py-1 text-red-100">
                      {commander.name}: {amount}
                    </span>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => adjustCommander(-1)}
                  disabled={!selectedPlayer || !selectedCommander}
                  className="min-h-10 rounded border border-neutral-700 bg-neutral-950 px-3 text-sm font-bold text-stone-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Remove Damage
                </button>
                <button
                  type="button"
                  onClick={() => adjustCommander(1)}
                  disabled={!selectedPlayer || !selectedCommander}
                  className="min-h-10 rounded bg-red-500 px-3 text-sm font-black text-white transition-colors hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Add Damage
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => adjust(-1)}
              disabled={!selectedPlayer || !counterType.trim()}
              className="min-h-11 rounded border border-neutral-700 bg-neutral-950 px-4 text-sm font-bold text-stone-200 transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => adjust(1)}
              disabled={!selectedPlayer || !counterType.trim()}
              className="min-h-11 rounded bg-amber-400 px-4 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualPhaseStepModal({
  players,
  currentActivePlayerId,
  currentPhase,
  currentStep,
  onSet,
  onCancel,
}: {
  players: SimpleGameState['aiPlayers'];
  currentActivePlayerId: string;
  currentPhase: string;
  currentStep: string;
  onSet: (activePlayerId: string, phase: ManualPhase, step: ManualStep) => void;
  onCancel: () => void;
}) {
  const [activePlayerId, setActivePlayerId] = useState(currentActivePlayerId || players[0]?.id || '');
  const [choiceId, setChoiceId] = useState(
    MANUAL_PHASE_CHOICES.find(choice => choice.phase === currentPhase && choice.step === currentStep)?.id
      || MANUAL_PHASE_CHOICES[0].id,
  );
  const selectedChoice = MANUAL_PHASE_CHOICES.find(choice => choice.id === choiceId) || MANUAL_PHASE_CHOICES[0];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-[74] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Adjust turn phase"
        className="w-[min(34rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-amber-500/35 bg-neutral-950 shadow-2xl shadow-black/70"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Manual Correction</div>
            <div className="text-lg font-black text-stone-100">Turn And Phase</div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-9 w-9 items-center justify-center rounded border border-neutral-700 bg-neutral-900 text-stone-300 transition-colors hover:bg-neutral-800 hover:text-white"
            aria-label="Close phase editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Active Player</span>
              <select
                value={activePlayerId}
                onChange={event => setActivePlayerId(event.target.value)}
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
              >
                {players.map(player => (
                  <option key={player.id} value={player.id}>{player.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-bold uppercase tracking-wider text-stone-500">
              <span>Step</span>
              <select
                value={choiceId}
                onChange={event => setChoiceId(event.target.value)}
                className="min-h-11 w-full rounded border border-neutral-700 bg-neutral-900 px-3 text-sm normal-case tracking-normal text-stone-100 focus:border-amber-400 focus:outline-none"
              >
                {MANUAL_PHASE_CHOICES.map(choice => (
                  <option key={choice.id} value={choice.id}>{choice.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="rounded border border-neutral-800 bg-neutral-900 p-3 text-xs font-semibold text-stone-400">
            Current: {displayStepForPhase(currentPhase, currentStep)}
          </div>

          <div className="grid grid-cols-2 gap-2">
            {MANUAL_PHASE_CHOICES.map(choice => (
              <button
                key={choice.id}
                type="button"
                onClick={() => setChoiceId(choice.id)}
                className={`min-h-10 rounded border px-3 text-sm font-bold transition-colors ${
                  choice.id === choiceId
                    ? 'border-amber-300 bg-amber-400 text-neutral-950'
                    : 'border-neutral-700 bg-neutral-900 text-stone-300 hover:border-neutral-500'
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 rounded border border-neutral-700 bg-neutral-950 px-4 text-sm font-bold text-stone-200 transition-colors hover:bg-neutral-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!activePlayerId) return;
                onSet(activePlayerId, selectedChoice.phase, selectedChoice.step);
              }}
              disabled={!activePlayerId}
              className="min-h-11 rounded bg-amber-400 px-4 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Set Phase
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryChoiceModal({
  choice,
  onResolve,
}: {
  choice: LibraryManipulationChoice;
  onResolve: (topIds: string[], movedIds: string[]) => void;
}) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => choice.cards.map(card => card.instanceId));
  const [movedIds, setMovedIds] = useState<Set<string>>(() => new Set());
  const movedLabel = choice.mode === 'scry' ? 'Bottom' : 'Graveyard';
  const keepLabel = choice.mode === 'scry' ? 'Top' : 'Keep top';
  const movedDescription = choice.mode === 'scry'
    ? 'Cards in this lane go to the bottom of your library in the shown order.'
    : 'Cards in this lane go to your graveyard.';

  useEffect(() => {
    setOrderedIds(choice.cards.map(card => card.instanceId));
    setMovedIds(new Set());
  }, [choice.id, choice.cards]);

  const cardMap = new Map(choice.cards.map(card => [card.instanceId, card]));
  const topIds = orderedIds.filter(id => !movedIds.has(id));
  const destinationIds = orderedIds.filter(id => movedIds.has(id));
  const moveWithinLane = (cardId: string, delta: number) => {
    setOrderedIds(prev => {
      const moved = movedIds.has(cardId);
      const lane = prev.filter(id => movedIds.has(id) === moved);
      const index = lane.indexOf(cardId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= lane.length) return prev;
      const nextLane = [...lane];
      [nextLane[index], nextLane[target]] = [nextLane[target], nextLane[index]];
      let laneIndex = 0;
      return prev.map(id => (movedIds.has(id) === moved ? nextLane[laneIndex++] : id));
    });
  };
  const toggleMoved = (cardId: string) => {
    setMovedIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };
  const submit = () => {
    onResolve(topIds, destinationIds);
  };
  const renderLaneCard = (cardId: string, index: number, laneIds: string[]) => {
    const card = cardMap.get(cardId);
    if (!card) return null;
    const moved = movedIds.has(cardId);
    return (
      <div
        key={cardId}
        className={`grid grid-cols-[4.5rem_1fr] gap-3 rounded-lg border p-2 ${
          moved ? 'border-red-500/45 bg-red-950/25' : 'border-emerald-500/35 bg-emerald-950/15'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleMoved(cardId)}
          className="h-24 overflow-hidden rounded border border-stone-700 bg-stone-900 text-left"
          title={moved ? `Move ${card.name} back to top` : `Move ${card.name} to ${movedLabel}`}
        >
          <CardImage cardName={card.name} size="small" showHoverZoom={false} className="h-full w-full" />
        </button>
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-stone-100">{card.name}</div>
              <div className="truncate text-[11px] text-stone-500">{card.typeLine}</div>
            </div>
            <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-black uppercase ${
              moved ? 'bg-red-500 text-white' : 'bg-emerald-500 text-neutral-950'
            }`}>
              {moved ? movedLabel : `Top ${index + 1}`}
            </span>
          </div>
          {card.oracleText && (
            <div className="mt-1 line-clamp-3 text-[11px] leading-snug text-stone-400">{card.oracleText}</div>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => moveWithinLane(cardId, -1)}
              disabled={index === 0}
              className="min-h-9 rounded border border-stone-700 px-2 text-xs font-bold text-stone-200 disabled:opacity-35"
            >
              Up
            </button>
            <button
              type="button"
              onClick={() => moveWithinLane(cardId, 1)}
              disabled={index === laneIds.length - 1}
              className="min-h-9 rounded border border-stone-700 px-2 text-xs font-bold text-stone-200 disabled:opacity-35"
            >
              Down
            </button>
            <button
              type="button"
              onClick={() => toggleMoved(cardId)}
              className={`min-h-9 rounded px-3 text-xs font-black ${
                moved ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-red-700 text-white hover:bg-red-600'
              }`}
            >
              {moved ? 'Keep on Top' : `Move to ${movedLabel}`}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-amber-500/40 bg-neutral-950 shadow-2xl">
        <div className="border-b border-neutral-800 px-4 py-3">
          <div className="text-sm font-black uppercase tracking-wider text-amber-300">{choice.title}</div>
          <div className="mt-1 text-xs text-stone-400">
            Set the order, then choose which cards go to {choice.mode === 'scry' ? 'the bottom of your library' : 'your graveyard'}.
          </div>
        </div>
        <div className="grid min-h-0 gap-3 overflow-y-auto p-3 md:grid-cols-2">
          <section className="min-h-0 rounded-lg border border-emerald-500/25 bg-emerald-950/10 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-300">{keepLabel}</div>
                <div className="text-[11px] text-stone-400">Top 1 is your next draw.</div>
              </div>
              <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-100">
                {topIds.length}
              </span>
            </div>
            <div className="space-y-2">
              {topIds.length > 0 ? (
                topIds.map((cardId, index) => renderLaneCard(cardId, index, topIds))
              ) : (
                <div className="rounded border border-dashed border-emerald-500/20 p-4 text-center text-xs text-stone-500">
                  No cards kept on top.
                </div>
              )}
            </div>
          </section>
          <section className="min-h-0 rounded-lg border border-red-500/25 bg-red-950/10 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wider text-red-300">{movedLabel}</div>
                <div className="text-[11px] text-stone-400">{movedDescription}</div>
              </div>
              <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-100">
                {destinationIds.length}
              </span>
            </div>
            <div className="space-y-2">
              {destinationIds.length > 0 ? (
                destinationIds.map((cardId, index) => renderLaneCard(cardId, index, destinationIds))
              ) : (
                <div className="rounded border border-dashed border-red-500/20 p-4 text-center text-xs text-stone-500">
                  No cards moved to {movedLabel.toLowerCase()}.
                </div>
              )}
            </div>
          </section>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-800 px-4 py-3">
          <button
            type="button"
            onClick={() => onResolve(orderedIds, [])}
            className="min-h-11 rounded border border-stone-700 px-4 text-sm font-bold text-stone-200 hover:bg-stone-900"
          >
            Keep All Top
          </button>
          <button
            type="button"
            onClick={submit}
            className="min-h-11 rounded bg-amber-500 px-5 text-sm font-black text-neutral-950 hover:bg-amber-400"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionalTriggerModal({
  choice,
  onResolve,
}: {
  choice: OptionalTriggerChoice;
  onResolve: (use: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-amber-500/45 bg-neutral-950 shadow-2xl">
        <div className="border-b border-neutral-800 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wider text-amber-300">Optional Trigger</div>
          <div className="mt-1 text-lg font-black text-stone-100">{choice.title}</div>
          <div className="mt-1 text-xs text-stone-400">
            {choice.triggerKind} trigger from {choice.sourceName}. Choose whether to use it.
          </div>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onResolve(false)}
            className="min-h-12 rounded border border-stone-700 px-4 text-sm font-bold text-stone-200 transition-colors hover:bg-stone-900"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className="min-h-12 rounded bg-amber-500 px-4 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-400"
          >
            Use Trigger
          </button>
        </div>
      </div>
    </div>
  );
}

function TaxPaymentModal({
  choice,
  onResolve,
}: {
  choice: TaxPaymentChoice;
  onResolve: (pay: boolean) => void;
}) {
  const controllerVerb = choice.controllerName.toLowerCase() === 'you' ? '' : 's';
  const effectLabel = choice.effect === 'draw'
    ? `${choice.controllerName} draw${controllerVerb} ${choice.effectCount}`
    : choice.effect === 'treasure'
      ? `${choice.controllerName} create${controllerVerb} ${choice.effectCount} Treasure`
      : `${choice.controllerName} gets the trigger effect`;

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-sky-500/45 bg-neutral-950 shadow-2xl">
        <div className="border-b border-neutral-800 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wider text-sky-300">Tax Trigger</div>
          <div className="mt-1 text-lg font-black text-stone-100">{choice.sourceName}</div>
          <div className="mt-1 text-xs text-stone-400">
            {choice.casterName} may pay {'{'}{choice.taxAmount}{'}'}. If not, {effectLabel}.
          </div>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onResolve(false)}
            className="min-h-12 rounded border border-stone-700 px-4 text-sm font-bold text-stone-200 transition-colors hover:bg-stone-900"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            disabled={!choice.canPay}
            className="min-h-12 rounded bg-sky-400 px-4 text-sm font-black text-neutral-950 transition-colors hover:bg-sky-300 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
          >
            Pay {'{'}{choice.taxAmount}{'}'}
          </button>
        </div>
      </div>
    </div>
  );
}

function WardPaymentModal({
  choice,
  onResolve,
}: {
  choice: WardPaymentChoice;
  onResolve: (pay: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-[87] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-amber-500/45 bg-neutral-950 shadow-2xl">
        <div className="border-b border-neutral-800 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wider text-amber-300">Ward</div>
          <div className="mt-1 text-lg font-black text-stone-100">{choice.targetName}</div>
          <div className="mt-1 text-xs text-stone-400">
            {choice.sourceName} targets {choice.targetName}. Pay {choice.costLabel} or it will be countered by ward.
          </div>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onResolve(false)}
            className="min-h-12 rounded border border-stone-700 px-4 text-sm font-bold text-stone-200 transition-colors hover:bg-stone-900"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            disabled={!choice.canPay}
            className="min-h-12 rounded bg-amber-400 px-4 text-sm font-black text-neutral-950 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-stone-800 disabled:text-stone-500"
          >
            Pay {choice.costLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function DamageAssignmentModal({
  choice,
  onResolve,
}: {
  choice: DamageAssignmentChoice;
  onResolve: (orders: DamageAssignmentOrder[]) => void;
}) {
  const [orders, setOrders] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(choice.groups.map(group => [
      group.attackerId,
      group.blockers.map(blocker => blocker.blockerId),
    ])),
  );

  useEffect(() => {
    setOrders(Object.fromEntries(choice.groups.map(group => [
      group.attackerId,
      group.blockers.map(blocker => blocker.blockerId),
    ])));
  }, [choice.id, choice.groups]);

  const blockerById = new Map(choice.groups.flatMap(group => group.blockers.map(blocker => [blocker.blockerId, blocker])));
  const moveBlocker = (attackerId: string, blockerId: string, delta: number) => {
    setOrders(prev => {
      const current = prev[attackerId] || [];
      const index = current.indexOf(blockerId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= current.length) return prev;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...prev, [attackerId]: next };
    });
  };
  const submit = () => {
    onResolve(choice.groups.map(group => ({
      attackerId: group.attackerId,
      blockerIds: orders[group.attackerId] || group.blockers.map(blocker => blocker.blockerId),
    })));
  };

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-red-500/45 bg-neutral-950 shadow-2xl">
        <div className="border-b border-neutral-800 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wider text-red-300">Combat Damage</div>
          <div className="mt-1 text-lg font-black text-stone-100">{choice.title}</div>
          <div className="mt-1 text-xs text-stone-400">
            Order blockers from first to last. Damage is assigned in this order.
          </div>
        </div>
        <div className="min-h-0 space-y-3 overflow-y-auto p-3">
          {choice.groups.map(group => {
            const orderedBlockers = orders[group.attackerId] || group.blockers.map(blocker => blocker.blockerId);
            return (
              <section key={group.attackerId} className="rounded-lg border border-neutral-800 bg-neutral-900/70 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-black text-stone-100">{group.attackerName}</div>
                    <div className="text-[11px] text-stone-400">Power {group.attackerPower}</div>
                  </div>
                  <span className="rounded bg-red-500/20 px-2 py-0.5 text-[10px] font-black uppercase text-red-100">
                    {orderedBlockers.length} blockers
                  </span>
                </div>
                <div className="space-y-2">
                  {orderedBlockers.map((blockerId, index) => {
                    const blocker = blockerById.get(blockerId);
                    if (!blocker) return null;
                    return (
                      <div key={blockerId} className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-950 p-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-red-500 text-sm font-black text-white">
                          {index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-stone-100">{blocker.blockerName}</div>
                          <div className="text-[11px] text-stone-500">
                            lethal {blocker.lethalDamage} - marked {blocker.currentDamage}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => moveBlocker(group.attackerId, blockerId, -1)}
                          disabled={index === 0}
                          className="min-h-9 rounded border border-stone-700 px-2 text-xs font-bold text-stone-200 disabled:opacity-35"
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => moveBlocker(group.attackerId, blockerId, 1)}
                          disabled={index === orderedBlockers.length - 1}
                          className="min-h-9 rounded border border-stone-700 px-2 text-xs font-bold text-stone-200 disabled:opacity-35"
                        >
                          Down
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
        <div className="flex justify-end border-t border-neutral-800 px-4 py-3">
          <button
            type="button"
            onClick={submit}
            className="min-h-11 rounded bg-red-500 px-5 text-sm font-black text-white hover:bg-red-400"
          >
            Confirm Damage Order
          </button>
        </div>
      </div>
    </div>
  );
}

function TriggerOrderModal({
  choice,
  onResolve,
}: {
  choice: TriggerOrderChoiceState;
  onResolve: (orderedTriggerIds: string[]) => void;
}) {
  const [orderedIds, setOrderedIds] = useState<string[]>(() => choice.triggers.map(trigger => trigger.triggerId));

  useEffect(() => {
    setOrderedIds(choice.triggers.map(trigger => trigger.triggerId));
  }, [choice.id, choice.triggers]);

  const triggerById = new Map(choice.triggers.map(trigger => [trigger.triggerId, trigger]));
  const moveTrigger = (triggerId: string, delta: number) => {
    setOrderedIds(prev => {
      const index = prev.indexOf(triggerId);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[86] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-sky-500/45 bg-neutral-950 shadow-2xl">
        <div className="border-b border-neutral-800 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-wider text-sky-300">Trigger Order</div>
          <div className="mt-1 text-lg font-black text-stone-100">{choice.title}</div>
          <div className="mt-1 text-xs text-stone-400">Top trigger resolves first. Move your triggered abilities into the order you want.</div>
        </div>
        <div className="space-y-2 p-3">
          {orderedIds.map((triggerId, index) => {
            const trigger = triggerById.get(triggerId);
            if (!trigger) return null;
            return (
              <div key={triggerId} className="flex items-center gap-2 rounded border border-neutral-800 bg-neutral-900/70 p-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-sky-500 text-sm font-black text-neutral-950">
                  {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-stone-100">{trigger.sourceName}</div>
                  <div className="text-[11px] text-stone-500">{trigger.triggerKind}</div>
                </div>
                <button
                  type="button"
                  onClick={() => moveTrigger(triggerId, -1)}
                  disabled={index === 0}
                  className="min-h-9 rounded border border-stone-700 px-2 text-xs font-bold text-stone-200 disabled:opacity-35"
                >
                  Up
                </button>
                <button
                  type="button"
                  onClick={() => moveTrigger(triggerId, 1)}
                  disabled={index === orderedIds.length - 1}
                  className="min-h-9 rounded border border-stone-700 px-2 text-xs font-bold text-stone-200 disabled:opacity-35"
                >
                  Down
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex justify-end border-t border-neutral-800 px-4 py-3">
          <button
            type="button"
            onClick={() => onResolve(orderedIds)}
            className="min-h-11 rounded bg-sky-400 px-5 text-sm font-black text-neutral-950 hover:bg-sky-300"
          >
            Confirm Trigger Order
          </button>
        </div>
      </div>
    </div>
  );
}

/** Expandable graveyard viewer */
function GraveyardViewer({
  cards,
  label,
  onInspect,
  onHoverCard,
  placement = 'inline',
}: {
  cards: SimpleCard[];
  label: string;
  onInspect: (card: SimpleCard) => void;
  onHoverCard?: (card: SimpleCard | null) => void;
  placement?: 'inline' | 'above';
}) {
  const [expanded, setExpanded] = useState(false);

  if (cards.length === 0) return null;

  const panelClass = placement === 'above'
    ? 'fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+13.25rem)] z-[90] max-h-44 w-[min(17rem,86vw)] overflow-y-auto rounded-lg border border-stone-700 bg-stone-800 p-2 shadow-xl shadow-black/55'
    : 'relative z-50 mt-1 max-h-32 overflow-y-auto rounded-lg border border-stone-700 bg-stone-800 p-2 shadow-xl shadow-black/40';

  return (
    <div className="relative z-[80] mt-1">
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(prev => !prev);
        }}
        className="relative z-50 flex items-center gap-1 rounded px-1 py-0.5 text-stone-500 transition-colors hover:bg-stone-800/80 hover:text-stone-300 text-[10px] md:text-xs"
      >
        {expanded
          ? <ChevronDown className="w-3 h-3" />
          : <ChevronRight className="w-3 h-3" />}
        <span>{label} Graveyard: {cards.length}</span>
      </button>
      {expanded && (
        <div className={panelClass}>
          {cards.map((card, i) => (
            <button
              type="button"
              key={card.instanceId}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onInspect(card);
              }}
              onMouseEnter={() => onHoverCard?.(card)}
              onMouseLeave={() => onHoverCard?.(null)}
              onFocus={() => onHoverCard?.(card)}
              onBlur={() => onHoverCard?.(null)}
              className="flex w-full items-center justify-between gap-2 border-b border-stone-700/50 py-1 text-left text-[10px] text-stone-300 transition-colors last:border-0 hover:text-amber-200 md:text-xs"
            >
              <span className="truncate">{i + 1}. {card.name}</span>
              <span className="flex shrink-0 items-center gap-1 text-stone-500">
                {card.typeLine && (
                  <span className="hidden max-w-[80px] truncate text-[8px] md:inline md:text-[10px]">
                    {card.typeLine}
                  </span>
                )}
                <Search className="h-3 w-3" />
              </span>
            </button>
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
  mulliganBottomCount,
  selectedMulliganCardIds = [],
  selectedMulliganBottomIds = [],
  onKeepHand,
  onMulligan,
  onToggleMulliganCard,
  onToggleMulliganBottom,
  discardPhase,
  discardCount,
  onDiscardCard,
  tutorPhase,
  tutorCards,
  tutorTitle,
  onTutorPick,
  onTutorCancel,
  libraryChoice,
  onResolveLibraryChoice,
  optionalTriggerChoice,
  onResolveOptionalTrigger,
  taxPaymentChoice,
  onResolveTaxPayment,
  wardPaymentChoice,
  onResolveWardPayment,
  damageAssignmentChoice,
  onResolveDamageAssignment,
  triggerOrderChoice,
  onResolveTriggerOrder,
  undosRemaining,
  onUndo,
  coachMode,
  onToggleCoach,
  newPlayerMode,
  onToggleNewPlayerMode,
  holdPriority = false,
  onToggleHoldPriority,
  priorityStops,
  onTogglePriorityStop,
  onSetAllPriorityStops,
  onUntapMana,
  onAdjustCounters,
  onAdjustPlayerCounter,
  onAdjustCommanderDamage,
  onMoveCard,
  onAdjustDamage,
  onCreateToken,
  onAttachCard,
  onSetPhaseStep,
  untappableCardIds,
  lastPlayedCard,
  authorityUpdates = [],
  lastStateUpdate,
  currentPrompt,
  actionError,
  onClearActionError,
  onBookmarkDrill,
  drillBookmarkLabel = 'Bookmark This Moment',
  practiceFocusTags = [],
  branchPreviews = [],
  onLoadBranchPreview,
  activeDrillLabel,
  onSaveDrillAttempt,
  onExitDrillAttempt,
  menuActions = [],
}: GameBoardProps) {
  const [inspectedCard, setInspectedCard] = useState<SimpleCard | null>(null);
  const [hoveredCard, setHoveredCard] = useState<SimpleCard | null>(null);
  const [showLastPlayedToast, setShowLastPlayedToast] = useState(false);
  const [showEngineUpdateToast, setShowEngineUpdateToast] = useState(false);
  const [showDiceToast, setShowDiceToast] = useState(false);
  const [stackLands, setStackLands] = useState(true);
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null);
  const [showUtilityMenu, setShowUtilityMenu] = useState(false);
  const [actionsCollapsed, setActionsCollapsed] = useState(false);
  const [showDecisionMap, setShowDecisionMap] = useState(false);
  const [showTokenCreator, setShowTokenCreator] = useState(false);
  const [showPlayerCounters, setShowPlayerCounters] = useState(false);
  const [showPhaseCorrection, setShowPhaseCorrection] = useState(false);
  const [attachSourceCardId, setAttachSourceCardId] = useState<string | null>(null);
  const activeGameCoachingEnabled = false;

  const handleCardHover = (card: SimpleCard | null) => {
    setHoveredCard(card);
  };

  useEffect(() => {
    if (!lastPlayedCard) {
      setShowLastPlayedToast(false);
      return;
    }
    setShowLastPlayedToast(true);
    const timeout = window.setTimeout(() => setShowLastPlayedToast(false), 12000);
    return () => window.clearTimeout(timeout);
  }, [lastPlayedCard?.card.instanceId, lastPlayedCard?.turnNumber]);

  useEffect(() => {
    if (!lastStateUpdate) {
      setShowEngineUpdateToast(false);
      return;
    }
    setShowEngineUpdateToast(true);
    const timeout = window.setTimeout(() => setShowEngineUpdateToast(false), 3200);
    return () => window.clearTimeout(timeout);
  }, [lastStateUpdate?.newStateId, lastStateUpdate?.rulesEvents.length]);

  useEffect(() => {
    if (!gameState.lastDiceRoll) {
      setShowDiceToast(false);
      return;
    }
    setShowDiceToast(true);
    const timeout = window.setTimeout(() => setShowDiceToast(false), 4200);
    return () => window.clearTimeout(timeout);
  }, [gameState.lastDiceRoll?.id]);

  useEffect(() => {
    if (!inspectedCard) return;
    const visibleCards = [
      ...gameState.humanHand,
      ...flattenWithAttachments(gameState.humanBattlefield),
      ...gameState.humanGraveyard,
      ...gameState.humanCommandZone,
      ...Object.values(gameState.aiBattlefields).flatMap(flattenWithAttachments),
      ...Object.values(gameState.aiGraveyards).flat(),
      ...Object.values(gameState.aiCommandZones).flat(),
      ...gameState.stack.flatMap(item => item.card ? [item.card] : []),
      ...(lastPlayedCard ? [lastPlayedCard.card] : []),
    ];
    const freshCard = visibleCards.find(card => card.instanceId === inspectedCard.instanceId);
    if (freshCard && freshCard !== inspectedCard) {
      setInspectedCard(freshCard);
    }
  }, [gameState, inspectedCard, lastPlayedCard]);

  const flattenWithAttachments = (cards: SimpleCard[]): SimpleCard[] =>
    cards.flatMap(card => [card, ...(card.attachments || [])]);

  // Build set of playable card instance IDs
  const playableIds = new Set(
    legalActions
      .filter(a => a.cardInstanceId)
      .map(a => a.cardInstanceId!)
  );
  const targetActionById = new Map<string, SimpleLegalAction>();
  for (const action of legalActions) {
    if (action.targetChoices?.length) {
      for (const choice of action.targetChoices) {
        if (!targetActionById.has(choice.targetId)) {
          targetActionById.set(choice.targetId, choice.action);
        }
      }
      continue;
    }
    const rawTargets = (action._engineAction as { targets?: unknown }).targets;
    const targets = Array.isArray(rawTargets)
      ? rawTargets.filter((target): target is string => typeof target === 'string')
      : [];
    const equipTarget = (action._engineAction as { targetCreatureId?: unknown }).targetCreatureId;
    if (typeof equipTarget === 'string') targets.push(equipTarget);
    for (const targetId of targets) {
      if (!targetActionById.has(targetId)) {
        targetActionById.set(targetId, action);
      }
    }
  }
  const getTargetAction = (card: SimpleCard): SimpleLegalAction | undefined =>
    targetActionById.get(card.instanceId);

  const passAction = legalActions.find(a => a.kind === 'PassPriority');
  const skipRestAction = legalActions.find(a => a.kind === 'SkipRestOfTurn');
  const skipEmptyAction = legalActions.find(a => a.kind === 'SkipEmptyPhases');
  const selectedMulliganCardSet = new Set(selectedMulliganCardIds);
  const selectedMulliganBottomSet = new Set(selectedMulliganBottomIds);
  const requiredMulliganBottoms = mulliganBottomCount ?? 0;
  const needsMulliganBottomSelection = !!mulliganPhase && requiredMulliganBottoms > 0;
  const needsMulliganCardSelection = !!mulliganPhase && !needsMulliganBottomSelection;
  const selectedMulliganCount = selectedMulliganCardSet.size;
  const mulliganBottomReady = !needsMulliganBottomSelection || selectedMulliganBottomSet.size === requiredMulliganBottoms;

  // Find non-card actions (declare attackers/blockers without a specific card)
  const combatActions = legalActions.filter(
    a => a.kind === 'DeclareAttackers' || a.kind === 'DeclareBlockers'
  );

  // Categorize actions for the unified action bar
  const castActions = legalActions.filter(a => a.kind === 'CastSpell');
  const playLandActions = legalActions.filter(a => a.kind === 'PlayLand');
  const manaActions = legalActions.filter(a => a.kind === 'ActivateManaAbility');
  const showIndividualManaActions = manaActions.length > 0;
  const otherCardActions = legalActions.filter(
    a => a.cardInstanceId && !['CastSpell', 'PlayLand', 'ActivateManaAbility', 'PassPriority', 'DeclareAttackers', 'DeclareBlockers'].includes(a.kind)
  );
  const hasHumanCombatDecision = combatActions.length > 0;
  const hasHumanActionWindow = isHumanTurn || hasHumanCombatDecision || (
    currentPrompt?.playerId === gameState.humanPlayer.id && legalActions.length > 0
  );
  const hasHumanDeclareBlockersDecision = combatActions.some(action => action.kind === 'DeclareBlockers');
  const hasHumanDeclareAttackersDecision = combatActions.some(action => action.kind === 'DeclareAttackers');
  const hasPhaseMovement = hasHumanActionWindow && !gameState.gameOver && !mulliganPhase && (
    skipRestAction || skipEmptyAction || passAction || combatActions.length > 0
  );
  const canUndo = !!onUndo && (undosRemaining ?? 0) > 0;
  const hasTopActions = hasHumanActionWindow && !gameState.gameOver && !mulliganPhase && (
    currentPrompt || castActions.length > 0 || playLandActions.length > 0 ||
    manaActions.length > 0 || otherCardActions.length > 0 || canUndo
  );
  const hasAnyAction = hasTopActions || hasPhaseMovement;
  const guideSuggestion = activeGameCoachingEnabled && newPlayerMode && hasAnyAction
    ? getNewPlayerSuggestion(gameState, legalActions)
    : null;
  const visibleActionCount = castActions.length
    + playLandActions.length
    + otherCardActions.length
    + manaActions.length
    + combatActions.length
    + (passAction ? 1 : 0)
    + (skipRestAction ? 1 : 0)
    + (skipEmptyAction ? 1 : 0);
  const actionDockClass = `${FLOATING_TABLE_LAYOUT.actionsDock} ${actionsCollapsed ? 'max-h-[3.25rem] overflow-hidden' : ''}`;
  const recentAuthorityUpdates = authorityUpdates.slice(-4).reverse();
  const complexTurnSignals = buildComplexTurnSignals({
    gameState,
    legalActions,
    currentPrompt,
    triggerOrderChoice,
    optionalTriggerChoice,
    taxPaymentChoice,
    wardPaymentChoice,
    damageAssignmentChoice,
    libraryChoice,
    lastStateUpdate,
  });
  const complexDecisionCount = Math.max(1, complexTurnSignals.length + branchPreviews.length + (currentPrompt ? 1 : 0));
  const shouldShowComplexTurnOverview = activeGameCoachingEnabled && !gameState.gameOver && !mulliganPhase && (
    complexTurnSignals.length > 0 || branchPreviews.length > 0 || currentPrompt || activeDrillLabel
  );
  const hasDecisionMapContent = activeGameCoachingEnabled && (
    complexTurnSignals.length > 0
    || practiceFocusTags.length > 0
    || branchPreviews.length > 0
    || !!activeDrillLabel
  );
  const smartBookmarkReason = (() => {
    if (!activeGameCoachingEnabled || !onBookmarkDrill || gameState.gameOver) return '';
    if (mulliganPhase) return 'Opening hand mulligan decision';
    if (currentPrompt) return currentPrompt.title || PROMPT_TYPE_LABELS[currentPrompt.type] || 'Current prompt';
    if (triggerOrderChoice?.triggers.length) return `${triggerOrderChoice.triggers.length} triggers waiting`;
    if (damageAssignmentChoice) return 'Combat damage assignment';
    if (branchPreviews.length >= 3) return `${branchPreviews.length} branch previews available`;
    if (complexTurnSignals.length >= 2) return `${complexTurnSignals.length} complex turn signals`;
    if (gameState.stack.length > 0) return `${gameState.stack.length} stack object${gameState.stack.length === 1 ? '' : 's'}`;
    return '';
  })();

  const handleCardClick = (card: SimpleCard) => {
    setInspectedCard(card);
  };

  const getPrimaryHandAction = (card: SimpleCard): SimpleLegalAction | null => {
    if (mulliganPhase) return null;
    if (card.zone !== 'hand' || card.ownerId !== gameState.humanPlayer.id) return null;

    const cardActions = legalActions.filter(action => action.cardInstanceId === card.instanceId);
    if (cardActions.length === 0) return null;

    return cardActions.find(action => action.kind === 'PlayLand')
      || cardActions.find(action => action.kind === 'CastSpell')
      || (cardActions.length === 1 ? cardActions[0] : null);
  };

  const handleHumanHandCardClick = (card: SimpleCard) => {
    const action = getPrimaryHandAction(card);
    if (action) {
      setInspectedCard(null);
      onAction(action);
      return;
    }
    setInspectedCard(card);
  };

  const getInspectAction = (card: SimpleCard) => {
    const isHumanHandCard = card.zone === 'hand' && card.ownerId === gameState.humanPlayer.id;
    const targetAction = getTargetAction(card);
    if (targetAction) {
      return {
        label: targetAction.label,
        paymentPreview: targetAction.paymentPreview,
        run: () => onAction(targetAction),
      };
    }

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

    return {
      label: action.label,
      paymentPreview: action.paymentPreview,
      run: () => onAction(action),
    };
  };

  const getDiscardAction = (card: SimpleCard) => {
    const isHumanHandCard = card.zone === 'hand' && card.ownerId === gameState.humanPlayer.id;
    if (!isHumanHandCard || !onDiscardCard || mulliganPhase) return null;
    const label = `Discard ${card.name}`;
    return {
      label,
      run: () => onDiscardCard(card.instanceId),
    };
  };

  const inspectedAction = inspectedCard ? getInspectAction(inspectedCard) : null;
  const inspectedDiscardAction = inspectedCard ? getDiscardAction(inspectedCard) : null;
  const getCardUnavailableHint = (card: SimpleCard): string | undefined => {
    if (discardPhase || mulliganPhase) return undefined;
    if (gameState.gameOver) return 'The match is complete.';
    if (card.ownerId !== gameState.humanPlayer.id) {
      return 'Opponent cards are inspectable. You can interact with them only when the engine exposes a legal target or response action.';
    }
    if (
      currentPrompt?.type === 'declare-blockers'
      && currentPrompt.playerId === gameState.humanPlayer.id
    ) {
      return 'Blockers are being declared now. Use a legal block action, or use No blocks if this creature cannot block.';
    }
    if (!hasHumanActionWindow) {
      const priorityName = gameState.priorityPlayerId === gameState.humanPlayer.id ? 'you' : 'another player';
      return `This is not currently a legal action because ${priorityName} has priority.`;
    }
    if (card.zone === 'hand') {
      if (currentPrompt?.type === 'stack-response') {
        return 'The stack is waiting. This card is not available as a legal response right now; it may need instant timing, mana, targets, or more rules coverage.';
      }
      if (currentPrompt?.type === 'declare-attackers' || currentPrompt?.type === 'declare-blockers') {
        return 'Combat declaration is waiting. Finish attackers or blockers before casting normal spells.';
      }
      return 'The engine does not see a legal action for this card right now. Most often that means timing, mana, targets, summoning sickness, or current rules coverage.';
    }
    if (card.zone === 'battlefield') {
      if (card.tapped) {
        return 'This permanent is tapped. Tap abilities and combat actions usually need it to be untapped.';
      }
      return 'This permanent has no legal action in the current prompt. It may need a target, a payable cost, haste, or a supported activated/triggered ability.';
    }
    if (card.zone === 'command') {
      return 'The commander is not currently castable. Check commander tax, available mana, timing, and commander-specific restrictions.';
    }
    return 'This card is visible for review, but the current engine prompt does not expose an action for it.';
  };
  const inspectedUnavailableHint =
    inspectedCard && !inspectedAction ? getCardUnavailableHint(inspectedCard) : undefined;
  const inspectedSecondaryAction =
    inspectedDiscardAction && inspectedDiscardAction.label !== inspectedAction?.label
      ? inspectedDiscardAction
      : null;
  const hoveredAction = hoveredCard ? getInspectAction(hoveredCard) : null;
  const hoveredUnavailableHint =
    hoveredCard && !hoveredAction ? getCardUnavailableHint(hoveredCard) : undefined;

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
                  const targetableCard = group.cards.find(card => getTargetAction(card));
                  const targetAction = targetableCard ? getTargetAction(targetableCard) : undefined;
                  const displayCard = playableCard || untappableCard || targetableCard || group.card;
                  return (
                    <div key={group.key} className="flex shrink-0 flex-col gap-1">
                    <CardTile
                      key={group.key}
                      card={displayCard}
                      playable={!!playableCard || !!untappableCard}
                      targetable={!playableCard && !!targetAction}
                      targetLabel={targetAction?.label}
                      compact={owner === 'ai'}
                      inspectable
                      inspectOnPointerDown={!playableCard && !untappableCard && !targetAction}
                      stackCount={group.cards.length}
                      onHoverCard={handleCardHover}
                      onClick={
                        playableCard
                          ? () => handleCardClick(playableCard)
                          : untappableCard && onUntapMana
                          ? () => onUntapMana(untappableCard.instanceId)
                          : targetAction
                          ? () => onAction(targetAction)
                          : () => setInspectedCard(displayCard)
                      }
                      onInspect={() => setInspectedCard(displayCard)}
                    />
                    <button
                      type="button"
                      aria-label={`View ${displayCard.name}`}
                      onFocus={() => setInspectedCard(displayCard)}
                      onClick={() => setInspectedCard(displayCard)}
                      className="min-h-7 rounded border border-neutral-700 bg-neutral-900/90 px-1 text-[10px] font-bold text-stone-300 transition-colors hover:border-amber-400 hover:text-amber-200"
                    >
                      View
                    </button>
                    </div>
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
  const selectedAiBattlefield = gameState.aiBattlefields[selectedOpponent.id] || gameState.aiBattlefield;
  const selectedAiGraveyard = gameState.aiGraveyards[selectedOpponent.id] || gameState.aiGraveyard;
  const selectedAiCommandZone = gameState.aiCommandZones[selectedOpponent.id] || gameState.aiCommandZone;
  const selectedOpponentLabel = opponentPlayers.length > 1
    ? `Opponent ${selectedOpponentIndex + 1}`
    : 'Opponent';
  const selectedOpponentTargetAction = targetActionById.get(selectedOpponent.id);
  const humanPlayerTargetAction = targetActionById.get(gameState.humanPlayer.id);
  const winnerName = gameState.winnerId && gameState.winnerId !== gameState.humanPlayer.id
    ? gameState.aiCommanderNames[gameState.winnerId] || gameState.aiCommander
    : gameState.aiCommander;
  const humanCommanderCard =
    gameState.humanCommandZone[0] || gameState.humanBattlefield.find(c => c.isCommander);
  const aiCommanderCard =
    selectedAiCommandZone[0] || selectedAiBattlefield.find(c => c.isCommander);
  const humanCommanderPlayable = !!humanCommanderCard && playableIds.has(humanCommanderCard.instanceId);
  const humanCommanderTargetAction = humanCommanderCard ? getTargetAction(humanCommanderCard) : undefined;
  const aiCommanderTargetAction = aiCommanderCard ? getTargetAction(aiCommanderCard) : undefined;
  const humanCommandZoneCards = gameState.humanCommandZone;
  const aiCommandZoneCards = selectedAiCommandZone;
  const playerNameForId = (playerId: string | undefined): string => {
    if (!playerId) return 'Unknown';
    if (playerId === gameState.humanPlayer.id) return 'You';
    return gameState.aiCommanderNames[playerId]
      || gameState.aiPlayers.find(player => player.id === playerId)?.name
      || gameState.aiPlayer.name
      || playerId;
  };
  const activeOwnerName = playerNameForId(gameState.activePlayerId);
  const priorityOwnerName = playerNameForId(gameState.priorityPlayerId);
  const actionWindowLabel = discardPhase
    ? 'Your Discard Choice'
    : hasHumanDeclareBlockersDecision
    ? 'Your Blockers'
    : hasHumanDeclareAttackersDecision
    ? 'Your Attackers'
    : isHumanTurn
    ? 'Your Priority'
    : `${priorityOwnerName} Priority`;
  const actionWindowOwnerLabel = discardPhase
    ? 'You discard'
    : hasHumanDeclareBlockersDecision
    ? 'You block'
    : hasHumanDeclareAttackersDecision
    ? 'You attack'
    : isHumanTurn
    ? 'You'
    : priorityOwnerName;
  const prioritySnapshot = currentPrompt?.priority;
  const passedPriorityNames = prioritySnapshot?.passedPriorityPlayerIds.map(playerNameForId) ?? [];
  const stackTopId = prioritySnapshot?.stackTop?.id || gameState.stack[gameState.stack.length - 1]?.id;
  const stackItemsTopFirst = [...gameState.stack].reverse();
  const commanderDamageSources = [
    ...gameState.humanCommandZone,
    ...flattenWithAttachments(gameState.humanBattlefield),
    ...gameState.humanGraveyard,
    ...Object.values(gameState.aiCommandZones).flat(),
    ...Object.values(gameState.aiBattlefields).flatMap(flattenWithAttachments),
    ...Object.values(gameState.aiGraveyards).flat(),
  ]
    .filter(card => card.isCommander)
    .reduce<{ instanceId: string; name: string }[]>((sources, card) => {
      if (!sources.some(source => source.instanceId === card.instanceId)) {
        sources.push({ instanceId: card.instanceId, name: card.name });
      }
      return sources;
    }, []);
  const battlefieldAttachmentCandidates = [
    ...flattenWithAttachments(gameState.humanBattlefield),
    ...Object.values(gameState.aiBattlefields).flatMap(flattenWithAttachments),
  ];
  const attachSourceCard = attachSourceCardId
    ? battlefieldAttachmentCandidates.find(card => card.instanceId === attachSourceCardId)
    : null;
  const attachTargetOptions = attachSourceCard
    ? battlefieldAttachmentCandidates
        .filter(card => card.instanceId !== attachSourceCard.instanceId && card.zone === 'battlefield')
        .map(card => ({
          instanceId: card.instanceId,
          name: card.name,
          typeLine: card.typeLine,
          manaCost: card.manaCost,
          oracleText: card.oracleText,
          legal: true,
          reason: card.ownerId === gameState.humanPlayer.id ? 'Your battlefield permanent' : `${playerNameForId(card.ownerId)} battlefield permanent`,
          destination: 'choice' as const,
        }))
    : [];
  const tutorCancelLabel = (() => {
    const title = (tutorTitle || '').toLowerCase();
    if (title.includes('decline')) return 'Decline sacrifice';
    if (title.includes('up to') || title.includes('cancel to stop here')) return 'Done searching';
    return undefined;
  })();

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-neutral-950 text-stone-200">
      {/* Tutor card picker overlay */}
      {tutorPhase && tutorCards && onTutorPick && (
        <CardPickerModal
          title={tutorTitle || 'Search your library'}
          cards={tutorCards}
          onPick={onTutorPick}
          onCancel={onTutorCancel}
          cancelLabel={tutorCancelLabel}
          allowCustomName={(tutorTitle || '').toLowerCase().includes('name a card')}
        />
      )}
      {libraryChoice && onResolveLibraryChoice && (
        <LibraryChoiceModal
          choice={libraryChoice}
          onResolve={onResolveLibraryChoice}
        />
      )}
      {optionalTriggerChoice && onResolveOptionalTrigger && (
        <OptionalTriggerModal
          choice={optionalTriggerChoice}
          onResolve={onResolveOptionalTrigger}
        />
      )}
      {taxPaymentChoice && onResolveTaxPayment && (
        <TaxPaymentModal
          choice={taxPaymentChoice}
          onResolve={onResolveTaxPayment}
        />
      )}
      {wardPaymentChoice && onResolveWardPayment && (
        <WardPaymentModal
          choice={wardPaymentChoice}
          onResolve={onResolveWardPayment}
        />
      )}
      {damageAssignmentChoice && onResolveDamageAssignment && (
        <DamageAssignmentModal
          choice={damageAssignmentChoice}
          onResolve={onResolveDamageAssignment}
        />
      )}
      {triggerOrderChoice && onResolveTriggerOrder && (
        <TriggerOrderModal
          choice={triggerOrderChoice}
          onResolve={onResolveTriggerOrder}
        />
      )}
      {attachSourceCard && onAttachCard && (
        <CardPickerModal
          title={`Attach ${attachSourceCard.name} to...`}
          cards={attachTargetOptions}
          onPick={targetId => {
            onAttachCard(attachSourceCard.instanceId, targetId);
            setAttachSourceCardId(null);
          }}
          onCancel={() => setAttachSourceCardId(null)}
          cancelLabel="Cancel attachment"
        />
      )}
      {showTokenCreator && onCreateToken && (
        <ManualTokenModal
          onCreate={token => {
            onCreateToken(token);
            setShowTokenCreator(false);
          }}
          onCancel={() => setShowTokenCreator(false)}
        />
      )}
      {showPlayerCounters && onAdjustPlayerCounter && (
        <ManualPlayerCounterModal
          players={[gameState.humanPlayer, ...gameState.aiPlayers]}
          commanders={commanderDamageSources}
          onAdjust={(targetPlayerId, counterType, delta) => {
            onAdjustPlayerCounter(targetPlayerId, counterType, delta);
          }}
          onAdjustCommanderDamage={onAdjustCommanderDamage}
          onCancel={() => setShowPlayerCounters(false)}
        />
      )}
      {showPhaseCorrection && onSetPhaseStep && (
        <ManualPhaseStepModal
          players={[gameState.humanPlayer, ...gameState.aiPlayers]}
          currentActivePlayerId={gameState.activePlayerId}
          currentPhase={gameState.phase}
          currentStep={gameState.step}
          onSet={(activePlayerId, phase, step) => {
            onSetPhaseStep(activePlayerId, phase, step);
            setShowPhaseCorrection(false);
          }}
          onCancel={() => setShowPhaseCorrection(false)}
        />
      )}
      {inspectedCard && (
        <CardInspectorModal
          card={inspectedCard}
          actionLabel={inspectedAction?.label}
          actionPaymentPreview={inspectedAction?.paymentPreview}
          unavailableHint={inspectedUnavailableHint}
          secondaryActionLabel={inspectedSecondaryAction?.label}
          onPrimaryAction={inspectedAction?.run}
          onSecondaryAction={inspectedSecondaryAction?.run}
          onAdjustCounter={
            onAdjustCounters
              ? (counterType, delta) => onAdjustCounters(inspectedCard.instanceId, counterType, delta)
              : undefined
          }
          onMoveCard={
            onMoveCard
              ? zone => onMoveCard(inspectedCard.instanceId, zone)
              : undefined
          }
          onAdjustDamage={
            onAdjustDamage
              ? delta => onAdjustDamage(inspectedCard.instanceId, delta)
              : undefined
          }
          onAttachCard={
            onAttachCard
              ? (cardInstanceId, targetId) => {
                  if (targetId === '') {
                    onAttachCard(cardInstanceId, undefined);
                  } else if (targetId) {
                    onAttachCard(cardInstanceId, targetId);
                  } else {
                    setAttachSourceCardId(cardInstanceId);
                  }
                }
              : undefined
          }
          onClose={() => setInspectedCard(null)}
        />
      )}
      {hoveredCard && !inspectedCard && (
        <CardHoverPreview
          card={hoveredCard}
          actionLabel={hoveredAction?.label}
          actionPaymentPreview={hoveredAction?.paymentPreview}
          unavailableHint={hoveredUnavailableHint}
        />
      )}
      <div className={FLOATING_TABLE_LAYOUT.table}>
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-0 hidden h-1 -translate-y-1/2 bg-red-500/70 xl:block" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-0 hidden h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-red-500/70 xl:flex items-center justify-center">
          <span className="text-3xl font-black text-red-500/60">M</span>
        </div>
      {/* Phase Bar */}
      <div className="absolute left-2 right-2 top-2 z-40 flex min-h-10 items-center gap-1.5 overflow-x-auto rounded-lg border border-neutral-700/70 bg-neutral-950/90 px-2 py-1.5 shadow-xl shadow-black/30 backdrop-blur md:left-3 md:right-3 md:top-3 md:gap-3 md:px-3">
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
                  : 'hidden bg-stone-700 text-stone-400 sm:inline-flex'
              }`}
            >
              {gameState.phase === key ? (
                <>
                  <span className="sm:hidden">{STEP_DISPLAY[gameState.step] || label}</span>
                  <span className="hidden sm:inline">{label}</span>
                </>
              ) : label}
            </span>
          ))}
        </div>
        <span className="text-stone-500 hidden md:inline">|</span>
        <span className="text-stone-400 text-[10px] md:text-xs whitespace-nowrap hidden sm:inline">
          {STEP_DISPLAY[gameState.step] || gameState.step}
        </span>
        <div className="ml-auto flex items-center gap-1.5 md:gap-2 shrink-0">
          {isLoading && <Loader2 className="w-3.5 h-3.5 md:w-4 md:h-4 animate-spin text-amber-400" />}
          <span className={`max-w-[9rem] truncate text-[10px] md:text-xs font-semibold px-1.5 md:px-2 py-0.5 rounded whitespace-nowrap md:max-w-[12rem] ${
            hasHumanActionWindow
              ? 'bg-green-800 text-green-200'
              : 'bg-red-900 text-red-300'
          }`}>
            {actionWindowLabel}
          </span>
          {canUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-500/45 bg-red-950/80 text-red-200 transition-colors hover:border-red-300 hover:bg-red-900"
              aria-label={`Undo last action (${undosRemaining} remaining)`}
              title={`Undo (${undosRemaining})`}
            >
              <Undo2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowUtilityMenu(true)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-amber-500/40 bg-neutral-900 text-amber-200 transition-colors hover:border-amber-300 hover:bg-neutral-800"
            aria-label="Open game menu"
            aria-expanded={showUtilityMenu}
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showUtilityMenu && (
        <div
          className="absolute inset-0 z-[72] flex items-center justify-center bg-black/35 px-3 py-8 backdrop-blur-sm"
          role="presentation"
          onClick={() => setShowUtilityMenu(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Game menu"
            className="w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-950 shadow-2xl shadow-black/60"
            onClick={event => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
              <div>
                <div className="text-sm font-black uppercase tracking-wider text-stone-100">Game Menu</div>
                <div className="text-[11px] font-semibold text-stone-500">
                  Turn {gameState.turnNumber} - {STEP_DISPLAY[gameState.step] || gameState.step}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowUtilityMenu(false)}
                className="flex h-9 w-9 items-center justify-center rounded border border-neutral-700 text-stone-300 transition-colors hover:border-amber-400 hover:text-amber-200"
                aria-label="Close game menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                <div className="rounded border border-neutral-800 bg-neutral-900 px-3 py-2 text-stone-300">
                  <div className="text-[9px] uppercase tracking-wider text-stone-500">Active Turn</div>
                  <div className="truncate">{activeOwnerName}</div>
                </div>
                <div className={`rounded border px-3 py-2 ${
                  hasHumanActionWindow
                    ? 'border-green-600/40 bg-green-950/60 text-green-200'
                    : 'border-red-700/40 bg-red-950/60 text-red-200'
                }`}>
                  <div className="text-[9px] uppercase tracking-wider opacity-70">
                    {hasHumanCombatDecision ? 'Decision' : 'Priority'}
                  </div>
                  <div className="truncate">{actionWindowOwnerLabel}</div>
                </div>
              </div>

              <label className="flex min-h-11 items-center justify-between gap-3 rounded border border-neutral-800 bg-neutral-900 px-3 text-sm font-bold text-stone-200">
                <span>Stack lands</span>
                <input
                  type="checkbox"
                  checked={stackLands}
                  onChange={event => setStackLands(event.target.checked)}
                  className="h-4 w-4 accent-amber-500"
                />
              </label>

              {onToggleHoldPriority && (
                <button
                  type="button"
                  onClick={() => onToggleHoldPriority(!holdPriority)}
                  className={`flex min-h-11 w-full items-center justify-between rounded border px-3 text-left text-sm font-bold transition-colors ${
                    holdPriority
                      ? 'border-sky-400/50 bg-sky-500 text-neutral-950'
                      : 'border-neutral-800 bg-neutral-900 text-stone-200 hover:border-neutral-600'
                  }`}
                >
                  <span>Hold priority</span>
                  <span className="text-[10px] font-black uppercase tracking-wider">{holdPriority ? 'On' : 'Off'}</span>
                </button>
              )}

              {priorityStops && onTogglePriorityStop && (
                <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wider text-stone-100">
                        Priority Stops
                      </div>
                      <div className="text-[10px] font-semibold text-stone-500">
                        Pause instead of auto-passing empty windows.
                      </div>
                    </div>
                    {onSetAllPriorityStops && (
                      <div className="flex gap-1">
                        {onToggleHoldPriority && (
                          <button
                            type="button"
                            onClick={() => {
                              onSetAllPriorityStops(true);
                              onToggleHoldPriority(true);
                            }}
                            className="rounded border border-sky-500/50 px-2 py-1 text-[10px] font-black uppercase text-sky-100 hover:border-sky-300"
                          >
                            Full
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onSetAllPriorityStops(true)}
                          className="rounded border border-neutral-700 px-2 py-1 text-[10px] font-black uppercase text-stone-200 hover:border-amber-400/70"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => onSetAllPriorityStops(false)}
                          className="rounded border border-neutral-700 px-2 py-1 text-[10px] font-black uppercase text-stone-200 hover:border-amber-400/70"
                        >
                          Clear
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {PRIORITY_STOP_OPTIONS.map(stop => (
                      <label
                        key={stop.key}
                        className={`flex min-h-10 items-center justify-between gap-2 rounded border px-2 text-xs font-bold transition-colors ${
                          priorityStops[stop.key]
                            ? 'border-amber-400/60 bg-amber-500 text-neutral-950'
                            : 'border-neutral-800 bg-neutral-950 text-stone-300'
                        }`}
                        title={stop.detail}
                      >
                        <span>{stop.label}</span>
                        <input
                          type="checkbox"
                          checked={priorityStops[stop.key]}
                          onChange={event => onTogglePriorityStop(stop.key, event.target.checked)}
                          className="h-4 w-4 accent-amber-500"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {activeGameCoachingEnabled && onToggleCoach && (
                <button
                  type="button"
                  onClick={() => onToggleCoach(!coachMode)}
                  className={`flex min-h-11 w-full items-center justify-between rounded border px-3 text-left text-sm font-bold transition-colors ${
                    coachMode
                      ? 'border-blue-500/50 bg-blue-900 text-blue-100'
                      : 'border-neutral-800 bg-neutral-900 text-stone-200 hover:border-neutral-600'
                  }`}
                >
                  <span>Coach</span>
                  <span className="text-[10px] font-black uppercase tracking-wider">{coachMode ? 'On' : 'Off'}</span>
                </button>
              )}

              {activeGameCoachingEnabled && onToggleNewPlayerMode && (
                <button
                  type="button"
                  onClick={() => onToggleNewPlayerMode(!newPlayerMode)}
                  className={`flex min-h-11 w-full items-center justify-between rounded border px-3 text-left text-sm font-bold transition-colors ${
                    newPlayerMode
                      ? 'border-amber-400/60 bg-amber-500 text-neutral-950'
                      : 'border-neutral-800 bg-neutral-900 text-stone-200 hover:border-neutral-600'
                  }`}
                >
                  <span className="flex items-center gap-2"><Lightbulb className="h-4 w-4" /> Guide</span>
                  <span className="text-[10px] font-black uppercase tracking-wider">{newPlayerMode ? 'On' : 'Off'}</span>
                </button>
              )}

              {activeGameCoachingEnabled && onBookmarkDrill && (
                <button
                  type="button"
                  onClick={() => {
                    onBookmarkDrill();
                    setShowUtilityMenu(false);
                  }}
                  className="flex min-h-11 w-full items-center justify-between rounded border border-fuchsia-500/35 bg-fuchsia-950/40 px-3 text-left text-sm font-bold text-fuchsia-100 transition-colors hover:border-fuchsia-300/70 hover:bg-fuchsia-900/50"
                >
                  <span className="flex items-center gap-2"><BookmarkPlus className="h-4 w-4" /> {drillBookmarkLabel}</span>
                  <span className="rounded bg-fuchsia-900/70 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-fuchsia-100">
                    Drill
                  </span>
                </button>
              )}

              {onCreateToken && (
                <button
                  type="button"
                  onClick={() => {
                    setShowTokenCreator(true);
                    setShowUtilityMenu(false);
                  }}
                  className="flex min-h-11 w-full items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-3 text-left text-sm font-bold text-stone-100 transition-colors hover:border-amber-400/60 hover:bg-neutral-800"
                >
                  <span>Create token</span>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-stone-400">
                    Manual
                  </span>
                </button>
              )}

              {onAdjustPlayerCounter && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPlayerCounters(true);
                    setShowUtilityMenu(false);
                  }}
                  className="flex min-h-11 w-full items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-3 text-left text-sm font-bold text-stone-100 transition-colors hover:border-amber-400/60 hover:bg-neutral-800"
                >
                  <span>Player counters</span>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-stone-400">
                    Manual
                  </span>
                </button>
              )}

              {onSetPhaseStep && (
                <button
                  type="button"
                  onClick={() => {
                    setShowPhaseCorrection(true);
                    setShowUtilityMenu(false);
                  }}
                  className="flex min-h-11 w-full items-center justify-between rounded border border-neutral-800 bg-neutral-900 px-3 text-left text-sm font-bold text-stone-100 transition-colors hover:border-amber-400/60 hover:bg-neutral-800"
                >
                  <span>Turn and phase</span>
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-stone-400">
                    Manual
                  </span>
                </button>
              )}

              {menuActions.length > 0 && (
                <div className="space-y-2 border-t border-neutral-800 pt-3">
                  {menuActions.map(action => (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        action.onSelect();
                        setShowUtilityMenu(false);
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded border border-neutral-800 bg-neutral-900 px-3 text-left text-sm font-bold text-stone-100 transition-colors hover:border-amber-400/60 hover:bg-neutral-800"
                    >
                      <span>{action.label}</span>
                      {action.detail && (
                        <span className="rounded bg-neutral-800 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-stone-400">
                          {action.detail}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {recentAuthorityUpdates.length > 0 && (
        <div
          aria-label="Engine event feed"
          className="absolute right-2 top-14 z-30 hidden w-[22rem] max-w-[calc(100%-1rem)] rounded-lg border border-sky-500/20 bg-neutral-950/82 p-2 shadow-xl shadow-black/25 backdrop-blur lg:block"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[9px] font-black uppercase tracking-wider text-sky-300/80">
              Engine Feed
            </div>
            <div className="text-[9px] font-semibold text-stone-500">
              {authorityUpdates.length} update{authorityUpdates.length === 1 ? '' : 's'}
            </div>
          </div>
          <div className="space-y-1">
            {recentAuthorityUpdates.map(update => (
              <div
                key={`${update.oldStateId}:${update.newStateId}:${update.rulesEvents.length}`}
                className="rounded border border-neutral-800/90 bg-neutral-900/72 px-2 py-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] font-bold text-stone-200">
                    {stateUpdateActor(update, gameState)}
                  </span>
                  <span className="shrink-0 text-[9px] text-stone-500">
                    T{update.turnNumber} {displayStepForPhase(update.phase, update.step)}
                  </span>
                </div>
                <div className="truncate text-[10px] text-stone-400">
                  {summarizeStateUpdate(update, playerNameForId)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasDecisionMapContent && !showDecisionMap && (
        <button
          type="button"
          onClick={() => setShowDecisionMap(true)}
          className="absolute left-2 top-14 z-30 rounded-lg border border-amber-500/25 bg-neutral-950/88 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-amber-100 shadow-xl shadow-black/25 backdrop-blur transition-colors hover:bg-amber-950/35"
          aria-label="Open decision map"
        >
          Decision Map {complexDecisionCount}
        </button>
      )}

      {hasDecisionMapContent && showDecisionMap && (
        <div
          aria-label="Decision map"
          className="absolute left-2 top-14 z-30 hidden w-[22rem] max-w-[calc(100%-1rem)] rounded-lg border border-amber-500/20 bg-neutral-950/84 p-2 shadow-xl shadow-black/25 backdrop-blur lg:block"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[9px] font-black uppercase tracking-wider text-amber-300/85">
              Decision Map
            </div>
            <div className="flex items-center gap-1">
              {activeGameCoachingEnabled && onBookmarkDrill && (
                <button
                  type="button"
                  onClick={onBookmarkDrill}
                  className="rounded border border-fuchsia-500/35 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-fuchsia-100 hover:bg-fuchsia-950/50"
                >
                  Bookmark
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowDecisionMap(false)}
                className="rounded border border-neutral-700 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-stone-200 hover:bg-neutral-800"
              >
                Hide
              </button>
            </div>
          </div>
          <div className="space-y-1">
            {activeDrillLabel && (
              <div className="rounded border border-fuchsia-500/30 bg-fuchsia-950/35 px-2 py-1 text-fuchsia-100">
                <div className="text-[10px] font-black uppercase tracking-wider">Drill Run</div>
                <div className="text-[10px] leading-snug opacity-85">{activeDrillLabel}</div>
                <div className="mt-1 flex gap-1">
                  {onSaveDrillAttempt && (
                    <button
                      type="button"
                      onClick={onSaveDrillAttempt}
                      className="rounded bg-fuchsia-500 px-2 py-0.5 text-[9px] font-black uppercase text-neutral-950"
                    >
                      Save Attempt
                    </button>
                  )}
                  {onExitDrillAttempt && (
                    <button
                      type="button"
                      onClick={onExitDrillAttempt}
                      className="rounded border border-fuchsia-400/40 px-2 py-0.5 text-[9px] font-black uppercase text-fuchsia-100"
                    >
                      Exit
                    </button>
                  )}
                </div>
              </div>
            )}
            {smartBookmarkReason && (
              <div className="rounded border border-fuchsia-500/30 bg-fuchsia-950/25 px-2 py-1 text-fuchsia-100">
                <div className="text-[10px] font-black uppercase tracking-wider">Smart Checkpoint</div>
                <div className="text-[10px] leading-snug opacity-85">{smartBookmarkReason}</div>
                <button
                  type="button"
                  onClick={onBookmarkDrill}
                  className="mt-1 rounded bg-fuchsia-500 px-2 py-0.5 text-[9px] font-black uppercase text-neutral-950 transition-colors hover:bg-fuchsia-400"
                >
                  Bookmark This Decision
                </button>
              </div>
            )}
            {practiceFocusTags.length > 0 && (
              <div className="rounded border border-amber-500/25 bg-amber-950/25 px-2 py-1">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-amber-200">
                  Practice Focus
                </div>
                <div className="flex flex-wrap gap-1">
                  {practiceFocusTags.slice(0, 5).map(tag => (
                    <span key={tag} className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-100">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {complexTurnSignals.map(signal => (
              <div
                key={`${signal.label}:${signal.detail}`}
                className={`rounded border px-2 py-1 ${complexSignalClass(signal.tone)}`}
              >
                <div className="text-[10px] font-black uppercase tracking-wider">{signal.label}</div>
                <div className="text-[10px] leading-snug opacity-85">{signal.detail}</div>
              </div>
            ))}
            {branchPreviews.length > 0 && (
              <div className="rounded border border-sky-500/25 bg-sky-950/25 px-2 py-1">
                <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-sky-200">
                  Branch Preview
                </div>
                <div className="space-y-1">
                  {branchPreviews.slice(0, 3).map(preview => (
                    <div key={preview.actionId} className="rounded bg-neutral-950/70 px-2 py-1">
                      <div className="truncate text-[10px] font-bold text-stone-100">
                        {preview.label}
                        {typeof preview.score === 'number' ? ` (${preview.score.toFixed(1)})` : ''}
                      </div>
                      <div className="text-[10px] leading-snug text-sky-100/80">{preview.summary}</div>
                      {preview.forecast && (
                        <div className="mt-0.5 text-[9px] leading-snug text-emerald-100/85">{preview.forecast}</div>
                      )}
                      {preview.practiceRead && (
                        <div className="mt-0.5 text-[9px] leading-snug text-sky-100/85">{preview.practiceRead}</div>
                      )}
                      {preview.warnings[0] && (
                        <div className="mt-0.5 text-[9px] leading-snug text-amber-100/85">{preview.warnings[0]}</div>
                      )}
                      {onLoadBranchPreview && preview.resultEngine && (
                        <button
                          type="button"
                          onClick={() => onLoadBranchPreview(preview.actionId)}
                          className="mt-1 min-h-6 rounded border border-sky-400/35 px-2 text-[9px] font-black uppercase tracking-wider text-sky-100 hover:bg-sky-950/50"
                        >
                          Drill This Line
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {hasDecisionMapContent && showDecisionMap && !hasTopActions && (
        <div
          aria-label="Mobile decision map"
          className="absolute left-2 right-14 top-14 z-30 rounded-lg border border-amber-500/20 bg-neutral-950/88 p-2 shadow-xl shadow-black/25 backdrop-blur lg:hidden"
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[9px] font-black uppercase tracking-wider text-amber-300">
              Decision Map
            </div>
            <div className="flex items-center gap-1">
              {onBookmarkDrill && (
                <button
                  type="button"
                  onClick={onBookmarkDrill}
                  className="flex min-h-7 items-center gap-1 rounded border border-fuchsia-500/40 px-2 text-[10px] font-black text-fuchsia-100"
                >
                  <BookmarkPlus className="h-3 w-3" />
                  Drill
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowDecisionMap(false)}
                className="min-h-7 rounded border border-neutral-700 px-2 text-[10px] font-black text-stone-100"
              >
                Hide
              </button>
            </div>
          </div>
          {practiceFocusTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {practiceFocusTags.slice(0, 5).map(tag => (
                <span key={tag} className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-100">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {smartBookmarkReason && (
            <div className="mt-2 rounded border border-fuchsia-500/30 bg-fuchsia-950/35 px-2 py-1 text-[10px] text-fuchsia-100">
              <div className="font-black uppercase tracking-wider">Smart Checkpoint</div>
              <div>{smartBookmarkReason}</div>
              <button
                type="button"
                onClick={onBookmarkDrill}
                className="mt-1 min-h-7 rounded bg-fuchsia-500 px-2 text-[9px] font-black uppercase text-neutral-950"
              >
                Bookmark This Decision
              </button>
            </div>
          )}
          {complexTurnSignals.slice(0, 4).map(signal => (
            <div
              key={`floating-mobile-${signal.label}:${signal.detail}`}
              className={`mt-1 rounded border px-2 py-1 text-[10px] ${complexSignalClass(signal.tone)}`}
            >
              <div className="font-black uppercase tracking-wider">{signal.label}</div>
              <div className="leading-snug opacity-85">{signal.detail}</div>
            </div>
          ))}
          {branchPreviews.slice(0, 3).map(preview => (
            <div key={`floating-mobile-preview-${preview.actionId}`} className="mt-1 rounded border border-sky-500/25 bg-sky-950/25 px-2 py-1 text-[10px] text-sky-100">
              <div className="truncate font-black uppercase tracking-wider">
                {preview.label}
                {typeof preview.score === 'number' ? ` (${preview.score.toFixed(1)})` : ''}
              </div>
              <div className="leading-snug opacity-85">{preview.summary}</div>
              {preview.forecast && (
                <div className="mt-0.5 leading-snug text-emerald-100/85">{preview.forecast}</div>
              )}
              {preview.warnings[0] && (
                <div className="mt-0.5 leading-snug text-amber-100/85">{preview.warnings[0]}</div>
              )}
              {onLoadBranchPreview && preview.resultEngine && (
                <button
                  type="button"
                  onClick={() => onLoadBranchPreview(preview.actionId)}
                  className="mt-1 min-h-6 rounded border border-sky-400/35 px-2 text-[9px] font-black uppercase tracking-wider text-sky-100"
                >
                  Drill Line
                </button>
              )}
            </div>
          ))}
          {activeDrillLabel && (
            <div className="mt-2 rounded border border-fuchsia-500/30 bg-fuchsia-950/35 px-2 py-1 text-[10px] text-fuchsia-100">
              <div className="font-black uppercase tracking-wider">Drill Run</div>
              <div>{activeDrillLabel}</div>
              <div className="mt-1 flex gap-1">
                {onSaveDrillAttempt && (
                  <button type="button" onClick={onSaveDrillAttempt} className="rounded bg-fuchsia-500 px-2 py-0.5 font-black uppercase text-neutral-950">
                    Save
                  </button>
                )}
                {onExitDrillAttempt && (
                  <button type="button" onClick={onExitDrillAttempt} className="rounded border border-fuchsia-400/40 px-2 py-0.5 font-black uppercase">
                    Exit
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* AI Side */}
      <div className={FLOATING_TABLE_LAYOUT.opponentStrip}>
        <div className="mb-1 flex min-w-0 items-center gap-2 md:gap-3">
          <div className="flex min-w-0 items-center gap-2">
	            <button
              type="button"
              onClick={aiCommanderCard ? () => setInspectedCard(aiCommanderCard) : undefined}
              className={`h-12 w-9 overflow-hidden rounded border bg-stone-200 ${
                aiCommanderTargetAction ? 'border-sky-400 ring-2 ring-sky-400/45' : 'border-red-700/50'
              }`}
              title={aiCommanderTargetAction?.label || (aiCommanderCard ? `Inspect ${aiCommanderCard.name}` : selectedOpponentCommander)}
            >
              {aiCommanderCard ? (
                <CardImage cardName={aiCommanderCard.name} size="small" showHoverZoom={false} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center bg-red-950 text-red-300 text-xs font-bold">
                  {selectedOpponentCommander.charAt(0)}
                </div>
              )}
            </button>
            <div className="min-w-0">
	              <div className="max-w-[10rem] truncate text-xs font-semibold text-stone-200 md:max-w-[16rem]">
                {selectedOpponentCommander}
              </div>
	              <div className="text-[10px] text-stone-500">
                Hand: {selectedOpponent.handCount}
                {' / '}
                Lib: {selectedOpponent.libraryCount}
              </div>
              {getPlayerCounterBadges(selectedOpponent).length > 0 && (
                <div className="mt-1 flex max-w-[13rem] flex-wrap gap-1">
                  {getPlayerCounterBadges(selectedOpponent).map(counter => (
                    <span key={counter.label} className="rounded border border-green-700/50 bg-green-950/60 px-1.5 py-0.5 text-[9px] font-bold text-green-200">
                      {counter.label} {counter.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
	          <button
            type="button"
            disabled={!selectedOpponentTargetAction}
            onClick={selectedOpponentTargetAction ? () => onAction(selectedOpponentTargetAction) : undefined}
            title={selectedOpponentTargetAction?.label || `${selectedOpponent.name} life total`}
            className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition-colors disabled:cursor-default ${
              selectedOpponentTargetAction
                ? 'border-sky-400/70 bg-sky-950/70 ring-2 ring-sky-400/35 hover:bg-sky-900/70'
                : 'border-red-800/50 bg-red-950/70'
            }`}
          >
            <span className="text-red-400 text-xs font-semibold">LP</span>
	            <span className="text-xl font-bold tabular-nums leading-none text-red-300 md:text-2xl">
              {selectedOpponent.life}
            </span>
          </button>
        </div>

        {opponentPlayers.length > 1 && (
	          <div className="mb-1 flex gap-1.5 overflow-x-auto pb-1">
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

        {/* AI command zone cards, including partners/backgrounds. */}
        {aiCommandZoneCards.length > 0 && (
          <CommandZoneStrip
            cards={aiCommandZoneCards}
            label={`${selectedOpponentLabel} command zone`}
            testId="opponent-command-zone"
            tone="opponent"
            onHoverCard={handleCardHover}
            onInspect={setInspectedCard}
            getStatus={card => {
              const targetAction = getTargetAction(card);
              return targetAction
                ? { label: 'Target', title: targetAction.label, targetable: true }
                : { label: 'Inspect', title: `Inspect ${card.name}` };
            }}
            onCardAction={card => {
              const targetAction = getTargetAction(card);
              if (targetAction) onAction(targetAction);
              else setInspectedCard(card);
            }}
          />
        )}

        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
          {selectedOpponentLabel} hand hidden ({selectedOpponent.handCount})
        </div>

        {/* AI Battlefield */}
		        <div className="min-h-[4rem] py-0.5">
          {renderBattlefieldRows(selectedAiBattlefield, 'ai')}
        </div>

        {/* AI Graveyard */}
        <GraveyardViewer cards={selectedAiGraveyard} label={selectedOpponentLabel} onInspect={setInspectedCard} onHoverCard={handleCardHover} />
      </div>

      {/* Stack Area */}
      {gameState.stack.length > 0 && (
        <div className="relative z-10 px-2 md:px-4 py-1.5 md:py-2 bg-stone-800/50 border-b border-stone-700/50 shrink-0">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 md:gap-2">
            <div className="text-amber-400 text-[10px] md:text-xs font-semibold">Stack</div>
            <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400">
              {priorityOwnerName} priority
            </span>
            {prioritySnapshot?.canResolveTopOfStack && (
              <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-neutral-950">
                Ready to resolve
              </span>
            )}
            {passedPriorityNames.length > 0 && (
              <span
                className="max-w-full truncate rounded bg-sky-950/70 px-1.5 py-0.5 text-[9px] font-semibold text-sky-100"
                title={`Passed priority: ${passedPriorityNames.join(', ')}`}
              >
                Passed: {passedPriorityNames.join(', ')}
              </span>
            )}
          </div>
          <div className="flex gap-1.5 md:gap-2 flex-wrap">
            {stackItemsTopFirst.map(item => {
              const targetAction = item.card ? getTargetAction(item.card) : undefined;
              const isTop = item.id === stackTopId;
              const targetText = item.targetNames.length > 0 ? item.targetNames.join(', ') : '';
              const itemKindLabel =
                item.kind === 'TriggeredAbility'
                  ? 'Trigger'
                  : item.kind === 'ActivatedAbility'
                  ? 'Ability'
                  : 'Spell';
              const content = (
                <>
                  <span className="block">
                    {isTop && (
                      <span className="mr-1 rounded bg-amber-400 px-1 py-px text-[8px] font-black uppercase leading-none text-neutral-950">
                        Top
                      </span>
                    )}
                    <span className="mr-1 rounded bg-neutral-950/50 px-1 py-px text-[8px] font-black uppercase leading-none text-amber-100/75">
                      {itemKindLabel}
                    </span>
                    {item.name}
                    <span className="text-amber-500 ml-1 text-[8px] md:text-[10px]">
                      ({playerNameForId(item.casterId)})
                    </span>
                  </span>
                  {targetText && (
                    <span className="mt-0.5 block max-w-72 truncate text-[9px] font-semibold text-amber-100/70 md:text-[10px]">
                      -&gt; {targetText}
                    </span>
                  )}
                </>
              );
              const className = `px-2 md:px-3 py-1 md:py-1.5 rounded border text-[10px] md:text-xs ${
                isTop
                  ? 'bg-amber-800/55 border-amber-300/60 text-amber-100 ring-1 ring-amber-300/30'
                  : 'bg-amber-900/40 border-amber-600/30 text-amber-200'
              }`;
              return item.card ? (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setInspectedCard(item.card!)}
                  onMouseEnter={() => handleCardHover(item.card!)}
                  onMouseLeave={() => handleCardHover(null)}
                  onFocus={() => handleCardHover(item.card!)}
                  onBlur={() => handleCardHover(null)}
                  className={`${className} text-left ${
                    targetAction
                      ? 'border-sky-400/70 bg-sky-950/70 text-sky-100 ring-2 ring-sky-400/35 hover:border-sky-300 hover:bg-sky-900/70 focus:ring-sky-400/60'
                      : 'hover:border-amber-300 hover:bg-amber-800/50 focus:ring-amber-400/50'
                  } focus:outline-none focus:ring-2`}
                  title={targetAction?.label || `Inspect ${item.name}`}
                >
                  {content}
                </button>
              ) : (
                <div key={item.id} className={className}>
                  {content}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {gameState.stack.length === 0 && lastPlayedCard && showLastPlayedToast && (
        <div className="relative z-10 flex shrink-0 justify-end border-b border-neutral-800/70 bg-neutral-950/45 px-2 py-1 md:px-4">
          <button
            type="button"
            onClick={() => setInspectedCard(lastPlayedCard.card)}
            onMouseEnter={() => handleCardHover(lastPlayedCard.card)}
            onMouseLeave={() => handleCardHover(null)}
            onFocus={() => handleCardHover(lastPlayedCard.card)}
            onBlur={() => handleCardHover(null)}
            className="max-w-full rounded border border-red-500/40 bg-neutral-950/85 px-3 py-1.5 text-left shadow-lg shadow-black/25 backdrop-blur transition-colors hover:border-red-300/80 hover:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-red-400/60 sm:max-w-64"
            title={`Inspect ${lastPlayedCard.card.name}`}
            aria-label={`Inspect last played card: ${lastPlayedCard.card.name}`}
          >
            <div className="text-[9px] font-bold uppercase tracking-wider text-red-300/80">Last Played</div>
            <div className="max-w-64 truncate text-xs font-semibold text-stone-100">{lastPlayedCard.card.name}</div>
          </button>
        </div>
      )}
      {lastStateUpdate && showEngineUpdateToast && (
        <div className="relative z-10 flex shrink-0 justify-end border-b border-neutral-800/70 bg-neutral-950/45 px-2 py-1 md:px-4">
          <div className="max-w-full rounded border border-sky-500/30 bg-neutral-950/80 px-3 py-1.5 text-left shadow-lg shadow-black/20 backdrop-blur sm:max-w-md">
            <div className="text-[9px] font-bold uppercase tracking-wider text-sky-300/80">Engine Update</div>
            <div className="truncate text-xs font-semibold text-stone-100">
              {summarizeStateUpdate(lastStateUpdate, playerNameForId)}
            </div>
          </div>
        </div>
      )}
      {actionError && (
        <div className="relative z-10 flex shrink-0 justify-end border-b border-red-950/70 bg-red-950/35 px-2 py-1 md:px-4">
          <div className="flex max-w-full items-start gap-2 rounded border border-red-500/45 bg-neutral-950/90 px-3 py-2 text-left shadow-lg shadow-black/25 backdrop-blur sm:max-w-lg">
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-bold uppercase tracking-wider text-red-300/85">Action Rejected</div>
              <div className="text-xs font-semibold leading-snug text-stone-100">
                {actionError.message}
              </div>
              <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-200/60">
                {actionError.reason}
              </div>
            </div>
            {onClearActionError && (
              <button
                type="button"
                onClick={onClearActionError}
                className="rounded border border-red-500/30 bg-red-950/70 p-1 text-red-100 transition-colors hover:bg-red-900"
                aria-label="Dismiss action error"
                title="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
      {shouldShowComplexTurnOverview && showDecisionMap && (
        <div className="pointer-events-none relative z-50 block max-h-40 shrink-0 overflow-y-auto border-b border-amber-900/50 bg-neutral-950/88 px-2 py-2 md:px-4 lg:max-h-none lg:overflow-visible">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">
                  Complex Turn Overview
                </div>
                <span className="rounded border border-amber-500/30 bg-amber-950/35 px-2 py-0.5 text-[10px] font-bold text-amber-100">
                  {complexDecisionCount} decision point{complexDecisionCount === 1 ? '' : 's'}
                </span>
                {activeDrillLabel && (
                  <span className="rounded border border-fuchsia-500/35 bg-fuchsia-950/35 px-2 py-0.5 text-[10px] font-bold text-fuchsia-100">
                    Drill: {activeDrillLabel}
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs leading-snug text-stone-300">
                {complexTurnSignals[0]?.detail || currentPrompt?.guidance || 'Compare the visible branches before committing the next action.'}
              </div>
              {practiceFocusTags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <span className="rounded border border-amber-500/25 bg-amber-950/25 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-200">
                    Practice Focus
                  </span>
                  {practiceFocusTags.slice(0, 5).map(tag => (
                    <span key={`overview-focus-${tag}`} className="rounded border border-stone-700 bg-neutral-900 px-1.5 py-0.5 text-[9px] font-bold text-stone-200">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {onBookmarkDrill && (
                <button
                  type="button"
                  onClick={onBookmarkDrill}
                  className="pointer-events-auto mt-2 min-h-9 rounded bg-fuchsia-500 px-3 text-xs font-black text-neutral-950 transition-colors hover:bg-fuchsia-400"
                >
                  {drillBookmarkLabel}
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 lg:max-w-[46rem] lg:justify-end">
              {complexTurnSignals.slice(0, 3).map(signal => (
                <div
                  key={`overview-${signal.label}:${signal.detail}`}
                  className={`max-w-[18rem] rounded border px-2 py-1 ${complexSignalClass(signal.tone)}`}
                >
                  <div className="text-[10px] font-black uppercase tracking-wider">{signal.label}</div>
                  <div className="line-clamp-2 text-[10px] leading-snug opacity-85">{signal.detail}</div>
                </div>
              ))}
              {branchPreviews.slice(0, 2).map(preview => (
                <div key={`overview-preview-${preview.actionId}`} className="max-w-[18rem] rounded border border-sky-500/30 bg-sky-950/35 px-2 py-1 text-sky-100">
                  <div className="truncate text-[10px] font-black uppercase tracking-wider">
                    {preview.label}
                    {typeof preview.score === 'number' ? ` ${preview.score.toFixed(1)}` : ''}
                  </div>
                  <div className="line-clamp-2 text-[10px] leading-snug opacity-85">{preview.summary}</div>
                  {onLoadBranchPreview && preview.resultEngine && (
                    <button
                      type="button"
                      onClick={() => onLoadBranchPreview(preview.actionId)}
                      className="pointer-events-auto mt-1 min-h-6 rounded border border-sky-400/35 px-2 text-[9px] font-black uppercase tracking-wider text-sky-100 transition-colors hover:bg-sky-950/50"
                    >
                      Drill This Line
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {gameState.lastDiceRoll && showDiceToast && (
        <div className="relative z-10 flex shrink-0 justify-end border-b border-neutral-800/70 bg-neutral-950/45 px-2 py-1 md:px-4">
          <div className="max-w-full rounded border border-violet-400/40 bg-violet-950/80 px-3 py-1.5 text-left shadow-lg shadow-black/20 backdrop-blur sm:max-w-md">
            <div className="text-[9px] font-bold uppercase tracking-wider text-violet-200/85">D20 Roll</div>
            <div className="truncate text-xs font-semibold text-stone-100">
              {gameState.lastDiceRoll.sourceName || 'Effect'} rolled {gameState.lastDiceRoll.result}
              <span className="text-stone-400"> (range {gameState.lastDiceRoll.outcomeMin}-{gameState.lastDiceRoll.outcomeMax})</span>
            </div>
          </div>
        </div>
      )}

      {/* Human Battlefield */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto border-b border-neutral-800/80 bg-neutral-900/70 px-3 py-1.5 pb-3 md:px-4">
        <div className="mb-1 flex items-center gap-2 md:gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={
                humanCommanderPlayable && humanCommanderCard
                  ? () => handleCardClick(humanCommanderCard)
                  : humanCommanderTargetAction
                  ? () => onAction(humanCommanderTargetAction)
                  : humanCommanderCard
                  ? () => setInspectedCard(humanCommanderCard)
                  : undefined
              }
              className={`h-12 w-9 overflow-hidden rounded border bg-stone-200 ${
                humanCommanderPlayable
                  ? 'border-green-400 ring-2 ring-green-400/40'
                  : humanCommanderTargetAction
                  ? 'border-sky-400 ring-2 ring-sky-400/45'
                  : 'border-green-700/50'
              }`}
              title={humanCommanderTargetAction?.label || (humanCommanderCard ? `Inspect ${humanCommanderCard.name}` : gameState.humanCommander)}
              aria-label={humanCommanderTargetAction?.label || (humanCommanderCard ? `Inspect ${humanCommanderCard.name}` : gameState.humanCommander)}
            >
              {humanCommanderCard ? (
                <CardImage cardName={humanCommanderCard.name} size="small" showHoverZoom={false} className="h-full w-full" />
              ) : (
                <div className="flex h-full items-center justify-center bg-green-950 text-green-300 text-xs font-bold">Y</div>
              )}
            </button>
            <div className="min-w-0">
              <div className="text-xs md:text-sm font-semibold text-stone-200 truncate max-w-[150px] md:max-w-[250px]">You — {gameState.humanCommander}</div>
              <div className="text-[10px] md:text-xs text-stone-500">
                Hand: {gameState.humanHand.length} / Lib: {gameState.humanPlayer.libraryCount}
              </div>
            </div>
          </div>

          {/* Mana Pool — always visible */}
          <div className={`flex shrink-0 items-center gap-0.5 rounded-lg border px-1.5 py-0.5 md:gap-1 md:px-2 ${
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

          <button
            type="button"
            disabled={!humanPlayerTargetAction}
            onClick={humanPlayerTargetAction ? () => onAction(humanPlayerTargetAction) : undefined}
            title={humanPlayerTargetAction?.label || 'Your life total'}
            className={`ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-left transition-colors disabled:cursor-default ${
              humanPlayerTargetAction
                ? 'border-sky-400/70 bg-sky-950/70 ring-2 ring-sky-400/35 hover:bg-sky-900/70'
                : 'border-green-800/50 bg-green-950/70'
            }`}
          >
            <span className="text-green-400 text-xs font-semibold">LP</span>
            <span className="text-xl font-bold tabular-nums leading-none text-green-300 md:text-2xl">
              {gameState.humanPlayer.life}
            </span>
          </button>
        </div>
        {getPlayerCounterBadges(gameState.humanPlayer).length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {getPlayerCounterBadges(gameState.humanPlayer).map(counter => (
              <span key={counter.label} className="rounded border border-green-700/50 bg-green-950/60 px-2 py-0.5 text-[10px] font-bold text-green-200">
                {counter.label} {counter.count}
              </span>
            ))}
          </div>
        )}

        {/* Human command zone cards, including partners/backgrounds. */}
        {humanCommandZoneCards.length > 0 && (
          <CommandZoneStrip
            cards={humanCommandZoneCards}
            label="Your command zone"
            testId="human-command-zone"
            tone="human"
            onHoverCard={handleCardHover}
            onInspect={setInspectedCard}
            getStatus={card => {
              const targetAction = getTargetAction(card);
              const playable = playableIds.has(card.instanceId);
              if (playable) return { label: 'Cast', title: `Cast ${card.name}`, active: true };
              if (targetAction) return { label: 'Target', title: targetAction.label, targetable: true };
              return { label: 'Inspect', title: `Inspect ${card.name}` };
            }}
            onCardAction={card => {
              const targetAction = getTargetAction(card);
              const playable = playableIds.has(card.instanceId);
              if (playable) handleCardClick(card);
              else if (targetAction) onAction(targetAction);
              else setInspectedCard(card);
            }}
          />
        )}

        {/* Human Battlefield */}
        <div className="min-h-[7rem] py-0.5">
          {renderBattlefieldRows(gameState.humanBattlefield, 'human')}
        </div>

      </div>

      {/* Action chooser: roomy on desktop, capped near the hand on mobile. */}
      {hasTopActions && (
        <div className={actionDockClass} aria-label="Game actions">
          <div className="mb-2 flex min-h-8 items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-300">
                Actions
              </div>
              <div className="truncate text-[11px] font-semibold text-stone-300">
                {currentPrompt?.title || `${visibleActionCount} available`}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {onBookmarkDrill && (
                <button
                  type="button"
                  onClick={onBookmarkDrill}
                  className="flex min-h-8 items-center gap-1 rounded border border-fuchsia-500/40 bg-fuchsia-950/50 px-2 text-[11px] font-black text-fuchsia-100 transition-colors hover:bg-fuchsia-900/60"
                  title={drillBookmarkLabel}
                >
                  <BookmarkPlus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Bookmark</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setActionsCollapsed(value => !value)}
                className="flex min-h-8 items-center gap-1 rounded border border-neutral-700 bg-neutral-900 px-2 text-[11px] font-black text-stone-100 transition-colors hover:bg-neutral-800"
                aria-expanded={!actionsCollapsed}
                aria-label={actionsCollapsed ? 'Expand action menu' : 'Collapse action menu'}
                title={actionsCollapsed ? 'Expand action menu' : 'Collapse action menu'}
              >
                {actionsCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5 rotate-90" />}
                {actionsCollapsed ? 'Open' : 'Collapse'}
              </button>
            </div>
          </div>
          {!actionsCollapsed && currentPrompt && (
            <div className="mb-2 flex items-start gap-2 rounded border border-sky-500/25 bg-sky-950/30 px-2 py-1.5 text-xs text-stone-100">
              <div className="shrink-0 rounded bg-sky-400/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-sky-200">
                {PROMPT_TYPE_LABELS[currentPrompt.type] || 'Prompt'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                  <div className="font-semibold leading-snug">{currentPrompt.title}</div>
                  {promptChoiceSummaryText(currentPrompt) && (
                    <div className="text-[10px] font-semibold leading-snug text-amber-100/80">
                      {promptChoiceSummaryText(currentPrompt)}
                    </div>
                  )}
                </div>
                <div className="text-[10px] leading-snug text-sky-100/70">{promptMeta(currentPrompt)}</div>
                {currentPrompt.guidance && (
                  <div className="mt-0.5 hidden text-[10px] leading-snug text-sky-100/85 sm:block">
                    {currentPrompt.guidance}
                  </div>
                )}
              </div>
            </div>
          )}
          {!actionsCollapsed && showDecisionMap && (complexTurnSignals.length > 0 || practiceFocusTags.length > 0 || branchPreviews.length > 0 || activeDrillLabel) && (
            <div className="mb-2 grid gap-1.5 lg:hidden">
              {smartBookmarkReason && (
                <div className="rounded border border-fuchsia-500/30 bg-fuchsia-950/30 px-2 py-1.5 text-fuchsia-100">
                  <div className="text-[10px] font-black uppercase tracking-wider">Smart Checkpoint</div>
                  <div className="text-[10px] leading-snug opacity-85">{smartBookmarkReason}</div>
                  <button
                    type="button"
                    onClick={onBookmarkDrill}
                    className="mt-1 min-h-7 rounded bg-fuchsia-500 px-2 text-[9px] font-black uppercase text-neutral-950"
                  >
                    Bookmark Decision
                  </button>
                </div>
              )}
              {activeDrillLabel && (
                <div className="rounded border border-fuchsia-500/30 bg-fuchsia-950/35 px-2 py-1.5 text-fuchsia-100">
                  <div className="text-[10px] font-black uppercase tracking-wider">Drill Run</div>
                  <div className="text-[10px] leading-snug opacity-85">{activeDrillLabel}</div>
                  <div className="mt-1 flex gap-1">
                    {onSaveDrillAttempt && (
                      <button
                        type="button"
                        onClick={onSaveDrillAttempt}
                        className="rounded bg-fuchsia-500 px-2 py-0.5 text-[9px] font-black uppercase text-neutral-950"
                      >
                        Save Attempt
                      </button>
                    )}
                    {onExitDrillAttempt && (
                      <button
                        type="button"
                        onClick={onExitDrillAttempt}
                        className="rounded border border-fuchsia-400/40 px-2 py-0.5 text-[9px] font-black uppercase text-fuchsia-100"
                      >
                        Exit
                      </button>
                    )}
                  </div>
                </div>
              )}
              {practiceFocusTags.length > 0 && (
                <div className="rounded border border-amber-500/25 bg-amber-950/25 px-2 py-1.5">
                  <div className="mb-1 text-[10px] font-black uppercase tracking-wider text-amber-200">Practice Focus</div>
                  <div className="flex flex-wrap gap-1">
                    {practiceFocusTags.slice(0, 5).map(tag => (
                      <span key={tag} className="rounded border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-100">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {complexTurnSignals.slice(0, 4).map(signal => (
                <div
                  key={`mobile-${signal.label}:${signal.detail}`}
                  className={`rounded border px-2 py-1.5 ${complexSignalClass(signal.tone)}`}
                >
                  <div className="text-[10px] font-black uppercase tracking-wider">{signal.label}</div>
                  <div className="text-[10px] leading-snug opacity-85">{signal.detail}</div>
                </div>
              ))}
              {branchPreviews.length > 0 && (
                <div className="rounded border border-sky-500/25 bg-sky-950/25 px-2 py-1.5">
                  <div className="text-[10px] font-black uppercase tracking-wider text-sky-200">Branch Preview</div>
                  {branchPreviews.slice(0, 3).map(preview => (
                    <div key={`mobile-preview-${preview.actionId}`} className="mt-1 text-[10px] leading-snug text-sky-100/85">
                      <span className="font-bold text-stone-100">
                        {preview.label}{typeof preview.score === 'number' ? ` (${preview.score.toFixed(1)})` : ''}:
                      </span> {preview.summary}
                      {preview.forecast && (
                        <div className="mt-0.5 text-emerald-100/85">{preview.forecast}</div>
                      )}
                      {preview.practiceRead && (
                        <div className="mt-0.5 text-sky-100/85">{preview.practiceRead}</div>
                      )}
                      {preview.warnings[0] && (
                        <div className="mt-0.5 text-amber-100/85">{preview.warnings[0]}</div>
                      )}
                      {onLoadBranchPreview && preview.resultEngine && (
                        <button
                          type="button"
                          onClick={() => onLoadBranchPreview(preview.actionId)}
                          className="mt-1 min-h-7 rounded border border-sky-400/35 px-2 text-[9px] font-black uppercase tracking-wider text-sky-100"
                        >
                          Drill Line
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {!actionsCollapsed && (
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 md:gap-2">
          {guideSuggestion && (
            <>
              <div className="flex min-h-10 items-center gap-1.5 rounded-md border border-amber-400/25 bg-amber-950/70 px-2 py-1 text-[10px] text-stone-100 shadow-lg shadow-black/20 sm:col-span-2 md:text-xs">
                <Lightbulb className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                <div className="min-w-0">
                  <div className="font-semibold leading-snug text-stone-50">
                    <span className="font-bold uppercase tracking-wider text-amber-300">Guide</span>
                    <span className="mx-1 text-stone-500">/</span>
                    {guideSuggestion.actionLabel}
                  </div>
                  <div className="hidden leading-snug text-stone-300 sm:block">
                    {guideSuggestion.reason}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onAction(guideSuggestion.action)}
                  className="min-h-8 shrink-0 rounded bg-amber-400 px-3 py-1 text-xs font-black text-neutral-950 transition-colors hover:bg-amber-300"
                >
                  Do it
                </button>
              </div>
            </>
          )}
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
	                  className="flex min-h-10 w-full items-center gap-1.5 rounded border border-green-600/30 bg-green-900/60 px-3 py-1.5 text-left text-xs font-semibold leading-snug text-green-200 transition-colors hover:bg-green-800/70"
                  >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="break-words">{action.label}</span>
                      {counter.prob > 0 && (
                        <span className={`${counter.color} text-[10px] font-bold`}>
                          {'\u26A1'} {counter.prob}%
                        </span>
                      )}
                    </span>
                    {action.paymentPreview && (
                      <span className="block text-[10px] font-semibold leading-snug text-amber-100/80">
                        {action.paymentPreview}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
            {/* Play Lands */}
            {playLandActions.map((action, i) => (
              <button
                key={`land-${i}`}
                onClick={() => onAction(action)}
	                className="min-h-10 w-full rounded border border-green-600/30 bg-green-900/60 px-3 py-1.5 text-left text-xs font-semibold leading-snug text-green-200 transition-colors hover:bg-green-800/70"
              >
                {action.label}
              </button>
            ))}
            {/* Other card actions */}
            {otherCardActions.map((action, i) => (
              <button
                key={`other-${i}`}
                onClick={() => onAction(action)}
	                className="min-h-10 w-full rounded border border-green-600/30 bg-green-900/60 px-3 py-1.5 text-left text-xs font-semibold leading-snug text-green-200 transition-colors hover:bg-green-800/70"
              >
                <span className="block">{action.label}</span>
                {action.paymentPreview && (
                  <span className="block text-[10px] font-semibold leading-snug text-amber-100/80">
                    {action.paymentPreview}
                  </span>
                )}
              </button>
            ))}
            {/* Mana Abilities */}
            {manaActions.length > 0 && (
              <>
                <div className="h-px bg-stone-700/80 sm:col-span-2" />
                {/* Tap All button: pick one action per card, preferring a color spread
                    that can unlock WUBRG activations instead of duplicating one color. */}
                {(() => {
                  const tapAllPlan = buildTapAllManaPlan(manaActions);
                  if (tapAllPlan.length <= 1) return null;
                  return (
                    <button
                      onClick={() => { for (const a of tapAllPlan) onAction(a); }}
                      className="min-h-10 w-full rounded border border-amber-500/40 bg-amber-700/70 px-3 py-1.5 text-left text-xs font-bold leading-snug text-amber-100 transition-colors hover:bg-amber-600/80"
                    >
                      Tap All ({tapAllPlan.length})
                    </button>
                  );
                })()}
                {/* Individual taps — only show when 3 or fewer, otherwise too long */}
                {showIndividualManaActions && manaActions.map((action, i) => (
                  <button
                    key={`mana-${i}`}
                    onClick={() => onAction(action)}
	                    className="min-h-10 w-full rounded border border-amber-600/30 bg-amber-900/50 px-2 py-1.5 text-left text-[10px] font-semibold leading-snug text-amber-200 transition-colors hover:bg-amber-800/60 md:text-xs"
                  >
                    {action.label || action.cardName}
                  </button>
                ))}
              </>
            )}
          </div>
          )}
        </div>
      )}

      {/* Bottom phase controls: turn movement stays near the hand and play decisions. */}
      {hasPhaseMovement && (
        <div className={FLOATING_TABLE_LAYOUT.phaseDock} aria-label="Phase controls">
          <div className="flex min-h-10 items-center gap-1.5 overflow-x-auto py-0.5 md:gap-2">
            <div className="flex min-h-9 shrink-0 items-center rounded border border-neutral-700 bg-neutral-900 px-2 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              {STEP_DISPLAY[gameState.step] || PHASE_DISPLAY[gameState.phase] || gameState.phase}
            </div>
            {skipRestAction && (
              <button
                onClick={() => onAction(skipRestAction)}
                className="flex min-h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded bg-amber-500 px-3 py-1 text-xs font-black text-neutral-950 transition-colors hover:bg-amber-400 md:min-h-8"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                {skipRestAction.label}
              </button>
            )}
            {skipEmptyAction && (
              <button
                onClick={() => onAction(skipEmptyAction)}
                className="flex min-h-10 shrink-0 items-center gap-1 whitespace-nowrap rounded bg-emerald-700 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-emerald-600 md:min-h-8"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                {skipEmptyAction.label}
              </button>
            )}
            {passAction && (
              <button
                onClick={() => onAction(passAction)}
                className="min-h-10 shrink-0 whitespace-nowrap rounded bg-stone-600 px-3 py-1 text-xs font-semibold text-stone-200 transition-colors hover:bg-stone-500 md:min-h-8"
              >
                {passAction.label}
              </button>
            )}
            {combatActions.map((action, i) => (
              <button
                key={`combat-phase-${i}`}
                onClick={() => onAction(action)}
                className="min-h-10 shrink-0 whitespace-nowrap rounded border border-red-600/30 bg-red-900/60 px-3 py-1 text-xs font-semibold text-red-200 transition-colors hover:bg-red-800/70 md:min-h-8"
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Human Hand + Actions */}
      <div className={FLOATING_TABLE_LAYOUT.handDock}>
        <div className="mb-1 flex items-center justify-between gap-2">
          <div className="text-amber-400 text-[10px] md:text-xs font-semibold tracking-wider uppercase whitespace-nowrap">
            {discardPhase
              ? `Hand (${gameState.humanHand.length}) — Discard ${discardCount} card${(discardCount ?? 0) > 1 ? 's' : ''}`
              : mulliganPhase
              ? needsMulliganBottomSelection
                ? `Choose ${requiredMulliganBottoms} to bottom (${selectedMulliganBottomSet.size}/${requiredMulliganBottoms})`
                : `Select cards to mulligan (${selectedMulliganCount} selected)`
              : `Hand (${gameState.humanHand.length})`}
          </div>
          <div className="flex items-center gap-2">
          {mulliganPhase && (
            <div className="flex gap-2">
              <button
                onClick={onKeepHand}
                disabled={!mulliganBottomReady}
                className="px-3 md:px-4 py-1.5 rounded bg-green-700 hover:bg-green-600 text-white text-xs font-semibold transition-colors min-h-[44px] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {needsMulliganBottomSelection
                  ? 'Keep Selected'
                  : mulliganPhase && (mulliganCount || 0) > 0
                    ? `Keep, Bottom ${mulliganCount}`
                    : 'Keep'}
              </button>
              <button
                onClick={() => onMulligan?.(selectedMulliganCardIds)}
                disabled={!needsMulliganCardSelection || selectedMulliganCount === 0}
                className="px-3 md:px-4 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-semibold transition-colors min-h-[44px] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {selectedMulliganCount > 0 ? `Mulligan ${selectedMulliganCount}` : 'Pick Cards First'}
              </button>
            </div>
          )}
          </div>
        </div>
        {gameState.humanGraveyard.length > 0 && (
          <div className="-mt-0.5 mb-1 max-w-xs">
            <GraveyardViewer
              cards={gameState.humanGraveyard}
              label="Your"
              onInspect={setInspectedCard}
              onHoverCard={handleCardHover}
            />
          </div>
        )}
        {mulliganPhase && (
          <div className="-mt-0.5 mb-1 rounded border border-amber-500/20 bg-amber-950/25 px-2 py-1 text-[10px] font-semibold leading-snug text-amber-100/85">
            {needsMulliganBottomSelection
              ? 'Tap cards in your hand to choose what goes on the bottom, then keep selected.'
              : mulliganPhase && (mulliganCount || 0) > 0
                ? `Tap more cards to redraw again, or keep to choose ${mulliganCount} card${mulliganCount === 1 ? '' : 's'} for the bottom. Inspect stays on the small card button.`
                : 'Tap one or more cards in your hand to mark them for mulligan. Inspect stays on the small card button.'}
          </div>
        )}
        {discardPhase && (
          <div className="-mt-0.5 mb-1 rounded border border-red-500/20 bg-red-950/25 px-2 py-1 text-[10px] font-semibold leading-snug text-red-100/85">
            Click {discardCount === 1 ? 'a card' : `${discardCount} cards`} in your hand to discard to maximum hand size before the turn can finish.
          </div>
        )}

        <div data-testid="human-hand-zone" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 md:gap-2">
          {gameState.humanHand.length === 0 ? (
            <div className="text-stone-600 text-xs italic">
              Hand is empty
            </div>
          ) : (
            gameState.humanHand.map(card => {
              const cardAction = getInspectAction(card);
              const selectedForMulligan = selectedMulliganCardSet.has(card.instanceId);
              const selectedForBottom = selectedMulliganBottomSet.has(card.instanceId);
              const mulliganSelectable = needsMulliganCardSelection && !!onToggleMulliganCard;
              return (
                  <CardTile
                    key={card.instanceId}
                    card={card}
                    testId="human-hand-card"
                    playable={discardPhase || mulliganSelectable || needsMulliganBottomSelection || (!mulliganPhase && playableIds.has(card.instanceId))}
                    selected={discardPhase || selectedForBottom || selectedForMulligan}
                    selectedLabel={discardPhase ? 'Discard' : selectedForBottom ? 'Bottom' : selectedForMulligan ? 'Mulligan' : undefined}
                    compact
                    inspectable
                    onHoverCard={handleCardHover}
                  onClick={
                    mulliganSelectable && onToggleMulliganCard
                      ? () => onToggleMulliganCard(card.instanceId)
                      : needsMulliganBottomSelection && onToggleMulliganBottom
                      ? () => onToggleMulliganBottom(card.instanceId)
                      : discardPhase && cardAction
                      ? cardAction.run
                      : () => handleHumanHandCardClick(card)
                  }
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
