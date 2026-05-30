/**
 * useShelectorGame — manages a game between the human player and the Shelector AI.
 *
 * Uses the real commander-engine for game state, legal actions, mana payment,
 * combat, stack resolution, and AI decision-making.
 * The Shelector /decide API is called in the background purely for narration.
 */

import { useState, useCallback, useRef } from 'react';
import {
  initGameFromDecks,
  getCardsInZone,
  getCardDefinition,
  getPlayer,
  getLegalActions,
  getActivatedAbilities,
  getSpellTargetSpecs,
  getLegalTargets,
  makeDecision,
  createAIConfig,
  advanceStep,
  performUntapStep,
  drawCards,
  resolveTopOfStack,
  resolveCombatDamage,
  checkStateBasedActions,
  putTriggersOnStack,
  parseOracleText,
  parseManaString,
  canPayCost,
  isEffectiveCreature,
  isBlockedBySummoningSicknessForTap,
  type GameState,
  type GameStateWithAI,
  type CardInstance,
  type CardDefinition,
  type AIAction,
  type ScryfallCard,
  type GeneratedDeck,
  type Zone,
  isTriggeredAbilityStackItem,
  evaluateActions,
  type ManaColor,
  type ManaCost,
  type ManaPool,
  type TriggeredAbilityStackItem,
  tryAdjustCounters,
  tryUntapManaSource,
  getCostReduction,
  getOverride,
  getEffectivePower,
  resetLoopDetector,
  type Effect,
  type ActivatedAbility,
  type StackItem,
  type ActionGameEvent,
  createClientActionRequest,
  applyClientActionRequest,
  actionKey,
  buildActionPrompt,
  buildStateUpdate,
  resolveTopStackSearchPrompt,
  createSearchLibraryPromptRequest,
  applySearchLibraryPromptResponse,
  createSelectTargetPromptRequest,
  applySelectTargetPromptResponse,
  createBattlefieldEntryReplacementPromptRequest,
  applyChooseReplacementPromptResponse,
  createPayCostsPromptRequest,
  applyPayCostsPromptResponse,
  createSelectCardsPromptRequest,
  applySelectCardsPromptResponse,
  applyOpeningMulliganRedraw,
  redrawOpeningHandForMulligan,
  bottomOpeningHandCardsForMulligan,
  createLibraryManipulationPromptRequest,
  applyLibraryManipulationPromptResponse,
  createOptionalTriggerPromptRequest,
  applyOptionalTriggerPromptResponse,
  createDamageAssignmentPromptRequest,
  applyDamageAssignmentPromptResponse,
  createOrderTriggersPromptRequest,
  applyOrderTriggersPromptResponse,
  createChooseModePromptRequest,
  applyChooseModePromptResponse,
  type ActionPromptChoice,
  type ClientActionResponse,
  type EnginePrompt,
  type EngineStateUpdate,
  type SearchLibraryPromptRequest,
  type SelectCardsPromptRequest,
  type LibraryManipulationPromptRequest,
  type OptionalTriggerPromptRequest,
  type DamageAssignmentOrder,
  type DamageAssignmentPromptRequest,
  type OrderTriggersPromptRequest,
  type TargetSpec,
  summarizeActionPromptChoices,
  serializeGameState,
  deserializeGameState,
  type SerializedGameStateV1,
  type CardFilter,
} from 'commander-engine';
import {
  buildDecisionReview,
  coachMessageFromDecision,
  playByPlayFromDecision,
  type DecisionReview,
} from '../lib/turnReview';
import { shelectorApiUrl } from '../lib/api';

// ========== End-Game Modal State (Task 27 — game-reliability-refactor) ==========

export interface EndGameState {
  open: boolean;
  kind: 'win' | 'loss' | 'loop';
  reason?: 'life' | 'commander_damage' | 'empty_library' | 'poison' | 'concede';
  loopSources?: string[];
}

// ========== Simplified Game Types (consumed by GameBoard.tsx) ==========

export interface SimpleCard {
  instanceId: string;
  name: string;
  manaCost: string;
  typeLine: string;
  oracleText: string;
  power?: number;
  toughness?: number;
  tapped: boolean;
  zone: 'hand' | 'battlefield' | 'graveyard' | 'library' | 'command' | 'exile' | 'stack';
  ownerId: string;
  cardTypes: string[];
  isCommander: boolean;
  counters: Record<string, number>;
  isToken: boolean;
  attachedTo?: string;           // Instance ID of what this is attached to
  attachments?: SimpleCard[];    // Equipment/auras attached to this card
}

export interface SimplePlayer {
  id: string;
  name: string;
  life: number;
  handCount: number;
  libraryCount: number;
}

export interface SimpleGameState {
  turnNumber: number;
  phase: string;
  step: string;
  activePlayerId: string;
  priorityPlayerId: string;
  humanPlayer: SimplePlayer;
  humanCommander: string;
  humanHand: SimpleCard[];
  humanBattlefield: SimpleCard[];
  humanGraveyard: SimpleCard[];
  humanCommandZone: SimpleCard[];
  stack: { id: string; kind: StackItem['kind']; name: string; casterId: string; card?: SimpleCard; targetNames: string[] }[];
  gameOver: boolean;
  winnerId: string | null;
  manaPool: { W: number; U: number; B: number; R: number; G: number; C: number };

  // Multiplayer AI support: arrays/records keyed by AI player ID
  aiPlayers: SimplePlayer[];
  aiHands: Record<string, SimpleCard[]>;
  aiBattlefields: Record<string, SimpleCard[]>;
  aiGraveyards: Record<string, SimpleCard[]>;
  aiCommandZones: Record<string, SimpleCard[]>;
  aiCommanderNames: Record<string, string>;

  // Backward-compatible single-AI aliases (first AI)
  aiPlayer: SimplePlayer;
  aiCommander: string;
  aiHand: SimpleCard[];
  aiBattlefield: SimpleCard[];
  aiGraveyard: SimpleCard[];
  aiCommandZone: SimpleCard[];
}

export interface SimpleLegalAction {
  kind: string;
  cardInstanceId?: string;
  cardName?: string;
  label: string;
  paymentPreview?: string;
  targetChoices?: TargetActionChoice[];
  /** The raw engine action stored for applying back to the engine */
  _engineAction: AIAction;
}

interface TargetActionChoice {
  targetId: string;
  label: string;
  action: SimpleLegalAction;
}

function displayNameForTarget(engineState: GameState, targetId: string): string {
  const card = engineState.cards.get(targetId);
  if (card) {
    return engineState.cardDefinitions.get(card.definitionId)?.name || targetId;
  }
  return engineState.players.find(player => player.id === targetId)?.name || targetId;
}

function targetPickerLabel(engineState: GameState, targetId: string): string {
  const card = engineState.cards.get(targetId);
  if (card) {
    const name = displayNameForTarget(engineState, targetId);
    const owner = engineState.players.find(player => player.id === card.ownerId);
    return owner ? `${name} (${owner.name})` : name;
  }
  return displayNameForTarget(engineState, targetId);
}

function targetLabelSuffix(engineState: GameState, targets?: string[]): string {
  if (!targets?.length) return '';
  return ` targeting ${targets.map(targetId => displayNameForTarget(engineState, targetId)).join(', ')}`;
}

function simpleChoiceId(action: SimpleLegalAction, index: number): string {
  const cardPart = action.cardInstanceId || action.cardName || 'table';
  return `${action.kind}:${cardPart}:${actionKey(action._engineAction)}:${index}`;
}

function promptChoicesFromSimpleActions(actions: SimpleLegalAction[]): ActionPromptChoice[] {
  return actions.map((action, index) => ({
    id: simpleChoiceId(action, index),
    kind: action._engineAction.kind,
    label: action.label,
    action: action._engineAction,
  }));
}

function buildVisibleActionPrompt(
  engineState: GameState,
  playerId: string,
  actions: SimpleLegalAction[],
): EnginePrompt | null {
  const basePrompt = buildActionPrompt(engineState, playerId);
  if (!basePrompt) return null;
  const legalChoices = promptChoicesFromSimpleActions(actions);
  const defaultChoice = legalChoices.find(choice => choice.action.kind === 'PassPriority');
  return {
    ...basePrompt,
    legalChoices,
    legalChoiceSummary: summarizeActionPromptChoices(legalChoices),
    defaultActionId: defaultChoice?.id,
    canSubmit: legalChoices.length > 0,
  };
}

export interface LastPlayedCard {
  card: SimpleCard;
  playerId: string;
  playerName: string;
  action: 'Played' | 'Cast' | 'Activated';
  turnNumber: number;
}

function isMeaningfulAutoSkipAction(action: AIAction): boolean {
  switch (action.kind) {
    case 'PassPriority':
    case 'ActivateManaAbility':
    case 'ManualUntapManaSource':
      return false;
    case 'DeclareAttackers':
      return action.attacks.length > 0;
    case 'DeclareBlockers':
      return action.blocks.length > 0;
    default:
      return true;
  }
}

function isEmptyWindowSkippable(actions: SimpleLegalAction[]): boolean {
  if (actions.length === 0) return false;
  return !actions.some(action =>
    action.kind !== 'SkipEmptyPhases' && isMeaningfulAutoSkipAction(action._engineAction),
  );
}

export interface GameLogEntry {
  turnNumber: number;
  player: 'human' | 'ai';
  playerId?: string;     // specific player ID (e.g. 'ai1', 'ai2', 'human')
  action: string;
  phase: string;
  manaAvailable: number;
  manaSpent: number;
  boardCreatureCount: { human: number; ai: number };
  lifeTotals: { human: number; ai: number };
  cardsInHand: { human: number; ai: number };
  timestamp: number;
  playByPlay?: string;
  decision?: DecisionReview;
  rulesAudit?: {
    severity: 'info' | 'warning' | 'error';
    reason: string;
  };
}

export interface ChatMessage {
  role: 'shelector' | 'system' | 'player';
  text: string;
  timestamp: number;
}

export interface OpponentInfo {
  commander: string;
  colors: string[];
  strategy: string;
  personality: string;
  deckSize: number;
}

export interface SpawnOptions {
  mode: 'random' | 'counter' | 'pool';
  bracket: number;
  avoid_colors: string[];
  human_commander?: string;
  human_colors?: string[];
}

// ========== Types for deck import data ==========

export interface CardDataFromAPI {
  name: string;
  type_line: string;
  mana_cost: string;
  cmc: number;
  oracle_text: string;
  power: string | null;
  toughness: string | null;
  colors: string[];
  color_identity: string[];
  keywords: string[];
}

export interface ImportedCards {
  commander: string;
  cards: string[];
  lands: string[];
  sideboard?: string[];
  cardData?: Record<string, CardDataFromAPI>;
}

export interface StartGameOptions {
  format?: 'commander' | 'limited';
  startingLife?: number;
  startingHandSize?: number;
  aiDifficulty?: number;
}

export interface ShelectorGameSaveSnapshot {
  version: 1;
  savedAt: number;
  engine: SerializedGameStateV1;
  humanDeck: GeneratedDeck | null;
  aiDecks: GeneratedDeck[];
  humanCommander: string;
  aiCommanderNames: Record<string, string>;
  humanId: string;
  aiIds: string[];
  opponentInfo: OpponentInfo | null;
  chatMessages: ChatMessage[];
  gameLog: GameLogEntry[];
  authorityUpdates: EngineStateUpdate[];
  lastStateUpdate: EngineStateUpdate | null;
  currentPrompt: EnginePrompt | null;
  lastPlayedCard: LastPlayedCard | null;
  mulliganPhase: boolean;
  mulliganCount: number;
  selectedMulliganCardIds?: string[];
  selectedMulliganBottomIds?: string[];
  discardPhase: boolean;
  discardCount: number;
  tutorPhase: boolean;
  tutorCards: TutorCardOption[];
  tutorTitle: string;
  libraryChoice?: LibraryManipulationChoice | null;
  optionalTriggerChoice?: OptionalTriggerChoice | null;
  damageAssignmentChoice?: DamageAssignmentChoice | null;
  triggerOrderChoice?: TriggerOrderChoiceState | null;
  undosRemaining: number;
  coachMode: boolean;
  newPlayerMode: boolean;
  holdPriority: boolean;
  actionError: { reason: string; message: string } | null;
  lastEvents: ActionGameEvent[];
  endGame: EndGameState;
}

// ========== Helpers ==========

function normalizeLookupName(name: string | undefined | null): string {
  return (name || '')
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function lookupNameAliases(name: string | undefined | null): string[] {
  const trimmed = (name || '').trim();
  if (!trimmed) return [];

  const aliases = new Set<string>([trimmed]);
  if (trimmed.includes(' // ')) {
    for (const faceName of trimmed.split(' // ')) {
      const face = faceName.trim();
      if (face) aliases.add(face);
    }
  }
  return [...aliases];
}

function cardDataHasName(cardData: Record<string, CardDataFromAPI> | undefined, name: string): boolean {
  const wanted = normalizeLookupName(name);
  if (!wanted || !cardData) return false;

  for (const [key, data] of Object.entries(cardData)) {
    if (lookupNameAliases(key).some(alias => normalizeLookupName(alias) === wanted)) return true;
    if (lookupNameAliases(data.name).some(alias => normalizeLookupName(alias) === wanted)) return true;
  }
  return false;
}

function findCardDataByName(cardData: Record<string, CardDataFromAPI> | undefined, name: string): CardDataFromAPI | undefined {
  const wanted = normalizeLookupName(name);
  if (!wanted || !cardData) return undefined;

  for (const [key, data] of Object.entries(cardData)) {
    if (lookupNameAliases(key).some(alias => normalizeLookupName(alias) === wanted)) return data;
    if (lookupNameAliases(data.name).some(alias => normalizeLookupName(alias) === wanted)) return data;
  }
  return undefined;
}

function isCommanderEligibleData(data: CardDataFromAPI | undefined): boolean {
  if (!data) return false;
  const typeLine = (data.type_line || '').toLowerCase();
  const oracleText = (data.oracle_text || '').toLowerCase();
  return (
    typeLine.includes('legendary')
    && (typeLine.includes('creature') || typeLine.includes('planeswalker'))
  ) || oracleText.includes('can be your commander');
}

const BASIC_LANDS: Record<string, ScryfallCard> = {
  Plains: {
    id: 'basic-plains', name: 'Plains', type_line: 'Basic Land \u2014 Plains',
    oracle_text: '({T}: Add {W}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['W'], keywords: [],
  },
  Island: {
    id: 'basic-island', name: 'Island', type_line: 'Basic Land \u2014 Island',
    oracle_text: '({T}: Add {U}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['U'], keywords: [],
  },
  Swamp: {
    id: 'basic-swamp', name: 'Swamp', type_line: 'Basic Land \u2014 Swamp',
    oracle_text: '({T}: Add {B}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['B'], keywords: [],
  },
  Mountain: {
    id: 'basic-mountain', name: 'Mountain', type_line: 'Basic Land \u2014 Mountain',
    oracle_text: '({T}: Add {R}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['R'], keywords: [],
  },
  Forest: {
    id: 'basic-forest', name: 'Forest', type_line: 'Basic Land \u2014 Forest',
    oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [],
  },
  'Snow-Covered Plains': {
    id: 'basic-snow-covered-plains', name: 'Snow-Covered Plains', type_line: 'Basic Snow Land \u2014 Plains',
    oracle_text: '({T}: Add {W}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['W'], keywords: [],
  },
  'Snow-Covered Island': {
    id: 'basic-snow-covered-island', name: 'Snow-Covered Island', type_line: 'Basic Snow Land \u2014 Island',
    oracle_text: '({T}: Add {U}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['U'], keywords: [],
  },
  'Snow-Covered Swamp': {
    id: 'basic-snow-covered-swamp', name: 'Snow-Covered Swamp', type_line: 'Basic Snow Land \u2014 Swamp',
    oracle_text: '({T}: Add {B}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['B'], keywords: [],
  },
  'Snow-Covered Mountain': {
    id: 'basic-snow-covered-mountain', name: 'Snow-Covered Mountain', type_line: 'Basic Snow Land \u2014 Mountain',
    oracle_text: '({T}: Add {R}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['R'], keywords: [],
  },
  'Snow-Covered Forest': {
    id: 'basic-snow-covered-forest', name: 'Snow-Covered Forest', type_line: 'Basic Snow Land \u2014 Forest',
    oracle_text: '({T}: Add {G}.)', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [],
  },
};

/** Convert API card data to ScryfallCard for the engine lookup */
function apiCardToScryfall(name: string, data: CardDataFromAPI): ScryfallCard {
  return {
    id: `api-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    name: data.name || name,
    type_line: data.type_line || '',
    oracle_text: data.oracle_text || '',
    mana_cost: data.mana_cost || '',
    cmc: data.cmc ?? 0,
    colors: data.colors || [],
    color_identity: data.color_identity || [],
    keywords: data.keywords || [],
    power: data.power ?? undefined,
    toughness: data.toughness ?? undefined,
  };
}

/** Convert engine CardInstance + CardDefinition into a SimpleCard for the UI */
function toSimpleCard(inst: CardInstance, def: CardDefinition): SimpleCard {
  return {
    instanceId: inst.instanceId,
    name: def.name,
    manaCost: def.mana_cost,
    typeLine: def.type_line,
    oracleText: def.oracle_text,
    power: def.power,
    toughness: def.toughness,
    tapped: inst.tapped,
    zone: inst.zone as SimpleCard['zone'],
    ownerId: inst.ownerId,
    cardTypes: def.card_types as string[],
    isCommander: inst.isCommander,
    counters: inst.counters,
    isToken: inst.instanceId.startsWith('token_inst_'),
    attachedTo: inst.attachedTo,
  };
}

function resolveCommanderNamesForImport(commanderName: string, cardData?: Record<string, CardDataFromAPI>): string[] {
  if (!commanderName.trim()) return [];
  if (cardDataHasName(cardData, commanderName)) return [commanderName];
  if (!commanderName.includes(' // ')) return [commanderName];

  const parts = commanderName.split(' // ').map(name => name.trim()).filter(Boolean);
  if (parts.length <= 1) return parts.length === 1 ? parts : [commanderName];

  const front = findCardDataByName(cardData, parts[0]);
  const otherFaces = parts.slice(1).map(name => findCardDataByName(cardData, name));
  if (front && otherFaces.some(face => !face)) return [parts[0]];

  const commanderEligibleFaces = parts.filter(name => isCommanderEligibleData(findCardDataByName(cardData, name)));
  if (commanderEligibleFaces.length === 1 && normalizeLookupName(commanderEligibleFaces[0]) === normalizeLookupName(parts[0])) {
    return [parts[0]];
  }

  return parts;
}

function resolveCommanderNamesForLookup(
  commanderName: string,
  lookup: (name: string) => ScryfallCard | undefined,
): string[] {
  if (!commanderName.trim()) return [];
  if (lookup(commanderName)) return [commanderName];
  if (!commanderName.includes(' // ')) return [commanderName];

  const parts = commanderName.split(' // ').map(name => name.trim()).filter(Boolean);
  if (parts.length <= 1) return parts.length === 1 ? parts : [commanderName];

  const front = lookup(parts[0]);
  const otherFaces = parts.slice(1).map(name => lookup(name));
  if (front && otherFaces.some(face => !face)) return [parts[0]];

  const commanderEligibleFaces = parts.filter(name => {
    const card = lookup(name);
    if (!card) return false;
    const typeLine = card.type_line.toLowerCase();
    const oracleText = (card.oracle_text || '').toLowerCase();
    return (
      typeLine.includes('legendary')
      && (typeLine.includes('creature') || typeLine.includes('planeswalker'))
    ) || oracleText.includes('can be your commander');
  });
  if (commanderEligibleFaces.length === 1 && normalizeLookupName(commanderEligibleFaces[0]) === normalizeLookupName(parts[0])) {
    return [parts[0]];
  }

  return parts;
}

function getCommanderCastCount(player: { commanderCastCount: number; commanderCastCounts?: Record<string, number>; commanderInstanceId?: string | null }, cardInstanceId: string): number {
  return player.commanderCastCounts?.[cardInstanceId]
    ?? (player.commanderInstanceId === cardInstanceId ? player.commanderCastCount : 0);
}

type SearchFilterSpec = {
  types?: string[];
  subtypes?: string[];
  supertypes?: string[];
  colors?: string[];
  cmc?: { op: 'eq' | 'lte' | 'gte'; value: number };
  permanent?: boolean;
  manaValueLessThanSourcePower?: boolean;
  sourcePowerLimit?: number;
};

export type TutorCardOption = {
  instanceId: string;
  name: string;
  typeLine: string;
  manaCost: string;
  oracleText?: string;
  colors?: string[];
  cmc?: number;
  legal?: boolean;
  reason?: string;
  destination?: 'hand' | 'battlefield' | 'graveyard' | 'top' | 'bottom' | 'exile' | 'command' | 'choice';
  entersTapped?: boolean;
  mustReveal?: boolean;
};

type TutorDestination = NonNullable<TutorCardOption['destination']>;
type SearchDestination = Extract<TutorDestination, 'hand' | 'battlefield' | 'graveyard' | 'top'>;

export interface LibraryManipulationChoice {
  id: string;
  mode: 'scry' | 'surveil';
  title: string;
  cards: TutorCardOption[];
}

export interface OptionalTriggerChoice {
  id: string;
  triggerId: string;
  sourceName: string;
  triggerKind: string;
  title: string;
}

export interface DamageAssignmentChoice {
  id: string;
  title: string;
  groups: {
    attackerId: string;
    attackerName: string;
    attackerPower: number;
    blockers: {
      blockerId: string;
      blockerName: string;
      lethalDamage: number;
      currentDamage: number;
      legal: boolean;
      reason?: string;
    }[];
  }[];
}

export interface TriggerOrderChoiceState {
  id: string;
  title: string;
  triggers: {
    triggerId: string;
    sourceName: string;
    triggerKind: string;
  }[];
}

type PendingPlayLandChoice = {
  kind: 'creatureType' | 'payLife';
  action: SimpleLegalAction;
};

type PendingSearchEntryChoice = {
  cardInstanceId: string;
  optionalLifeCost: number;
};

type PendingTargetChoice = {
  label: string;
  choices: TargetActionChoice[];
};

type PendingCastChoiceMode = 'discardLand' | 'sacrificeCreature';

function toTutorCardOption(state: GameState, card: CardInstance): TutorCardOption | null {
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return null;
  return {
    instanceId: card.instanceId,
    name: def.name,
    typeLine: def.type_line,
    manaCost: def.mana_cost,
    oracleText: def.oracle_text,
    colors: def.colors,
    cmc: def.cmc,
  };
}

function isMoxDiamondLikeDefinition(def: CardDefinition): boolean {
  return /mox diamond/i.test(def.name)
    || /if .* would enter .* discard a land card/i.test(def.oracle_text);
}

function publicTurnNumber(engineTurnNumber: number, playerCount: number): number {
  return Math.ceil(engineTurnNumber / Math.max(1, playerCount));
}

function isCreatureTypeChoiceLand(def: CardDefinition): boolean {
  return /cavern of souls/i.test(def.name)
    || /as .* enters.*choose a creature type/i.test(def.oracle_text);
}

function getOptionalUntappedLifeCostFromText(text: string): number | undefined {
  const match = text.match(/\bpay\s+(\d+)\s+life\b/i);
  if (!match || !/enters? (?:the battlefield )?tapped/i.test(text)) return undefined;
  return Number(match[1]);
}

function needsMoxDiamondDiscardChoice(
  action: AIAction,
  state: GameState,
): action is Extract<AIAction, { kind: 'CastSpell' }> {
  if (action.kind !== 'CastSpell') return false;
  if (action.cardChoices?.discardedCardIds?.length) return false;

  const card = state.cards.get(action.cardInstanceId);
  const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
  return !!def && isMoxDiamondLikeDefinition(def);
}

function needsCastSacrificeCreatureChoice(
  action: AIAction,
  state: GameState,
): action is Extract<AIAction, { kind: 'CastSpell' }> {
  if (action.kind !== 'CastSpell') return false;
  if (action.namedCardChoices?.sacrificeCardId) return false;

  const card = state.cards.get(action.cardInstanceId);
  const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
  if (!def) return false;
  return /\bwhen you cast this spell,\s*any player may sacrifice a creature\b/i.test(def.oracle_text)
    && /\bif a player does,\s*counter\b/i.test(def.oracle_text);
}

function getCreatureTypeChoices(state: GameState, playerId: string): string[] {
  const counts = new Map<string, number>();
  const ignored = new Set([
    'artifact',
    'battle',
    'basic',
    'creature',
    'enchantment',
    'instant',
    'kindred',
    'land',
    'legendary',
    'planeswalker',
    'snow',
    'sorcery',
    'token',
  ]);

  for (const card of state.cards.values()) {
    if (card.ownerId !== playerId) continue;
    const def = state.cardDefinitions.get(card.definitionId);
    if (!def || !def.card_types.includes('creature')) continue;
    const subtypeText = def.type_line.split(/[—-]/).slice(1).join(' ');
    for (const rawType of subtypeText.split(/\s+/)) {
      const clean = rawType.replace(/[^A-Za-z]/g, '');
      if (!clean || ignored.has(clean.toLowerCase())) continue;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([type]) => type)
    .slice(0, 18);
}

type StackSearchInfo = {
  filter?: string;
  filterSpec?: SearchFilterSpec;
  destination: SearchDestination;
  tapped?: boolean;
  shuffle: boolean;
  count?: number;
};

function humanizeSearchFilter(filter?: SearchFilterSpec, fallback?: string): string | undefined {
  if (fallback) return fallback;
  if (!filter) return undefined;

  const parts: string[] = [];
  const supertypes = filter.supertypes?.map(s => s.toLowerCase()) || [];
  const types = filter.types?.map(t => t.toLowerCase()) || [];
  const subtypes = filter.subtypes || [];

  if (supertypes.includes('basic') && types.includes('land')) {
    parts.push('basic land');
  } else {
    if (supertypes.length > 0) parts.push(supertypes.join(' or '));
    if (types.length > 0) parts.push(types.join(' or '));
  }
  if (subtypes.length > 0) parts.push(subtypes.join(' or '));
  if (filter.colors?.length) parts.push(filter.colors.join(' or '));
  if (filter.cmc) parts.push(`mana value ${filter.cmc.op} ${filter.cmc.value}`);
  if (filter.permanent && !types.some(type => ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].includes(type))) {
    parts.push('permanent');
  }
  if (filter.manaValueLessThanSourcePower) {
    parts.push(typeof filter.sourcePowerLimit === 'number'
      ? `mana value less than ${filter.sourcePowerLimit}`
      : 'mana value less than source power');
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

function searchPickerMetadata(search: StackSearchInfo): Pick<TutorCardOption, 'legal' | 'reason' | 'destination' | 'entersTapped' | 'mustReveal'> {
  const reason = search.filter
    ? `Matches ${search.filter}`
    : 'Legal library choice';
  return {
    legal: true,
    reason,
    destination: search.destination,
    entersTapped: search.destination === 'battlefield' ? Boolean(search.tapped) : undefined,
    // Type-restricted library searches normally reveal the chosen card. Broad
    // "any card" tutors should not expose the pick in live play.
    mustReveal: Boolean(search.filter || search.filterSpec),
  };
}

function cardFilterFromSearchInfo(search: StackSearchInfo): CardFilter {
  if (search.filterSpec) {
    const { sourcePowerLimit: _sourcePowerLimit, ...filter } = search.filterSpec;
    return filter as CardFilter;
  }

  const text = (search.filter || '').toLowerCase();
  const filter: CardFilter = {};

  if (/\bbasic\b/.test(text)) filter.supertypes = ['basic'];

  const types = [
    'artifact',
    'battle',
    'creature',
    'enchantment',
    'instant',
    'land',
    'planeswalker',
    'sorcery',
  ].filter(type => new RegExp(`\\b${type}\\b`).test(text));
  if (types.length) filter.types = types;

  const subtypePairs: Array<[RegExp, string]> = [
    [/\bplains\b/, 'Plains'],
    [/\bisland\b/, 'Island'],
    [/\bswamp\b/, 'Swamp'],
    [/\bmountain\b/, 'Mountain'],
    [/\bforest\b/, 'Forest'],
    [/\bgoblin\b/, 'Goblin'],
    [/\bdragon\b/, 'Dragon'],
    [/\bwizard\b/, 'Wizard'],
    [/\belf\b/, 'Elf'],
    [/\bhuman\b/, 'Human'],
  ];
  const subtypes = subtypePairs
    .filter(([pattern]) => pattern.test(text))
    .map(([, subtype]) => subtype);
  if (subtypes.length) filter.subtypes = subtypes;

  if (/\blegendary\b/.test(text)) filter.supertypes = [...new Set([...(filter.supertypes || []), 'Legendary'])];
  if (/\bpermanent\b/.test(text)) filter.permanent = true;

  return filter;
}

function searchInfoFromEffects(
  effects: unknown[] | undefined,
  state?: GameState,
  sourceInstanceId?: string,
): StackSearchInfo | undefined {
  if (!Array.isArray(effects)) return undefined;
  const searchEffect = effects.find((effect): effect is {
    kind: 'SearchLibrary';
    filter?: SearchFilterSpec;
    destination?: SearchDestination;
    tapped?: boolean;
    shuffle?: boolean;
    count?: number;
  } => typeof effect === 'object' && effect !== null && (effect as { kind?: string }).kind === 'SearchLibrary');

  if (!searchEffect) return undefined;

  const hasShuffleEffect = effects.some(effect =>
    typeof effect === 'object' && effect !== null && (effect as { kind?: string }).kind === 'ShuffleLibrary'
  );

  const filterSpec = searchEffect.filter
    ? { ...searchEffect.filter }
    : undefined;
  if (filterSpec?.manaValueLessThanSourcePower && state && sourceInstanceId) {
    filterSpec.sourcePowerLimit = getEffectivePower(state, sourceInstanceId);
  }

  return {
    filter: humanizeSearchFilter(filterSpec),
    filterSpec,
    destination: searchEffect.destination || 'hand',
    tapped: searchEffect.tapped,
    shuffle: searchEffect.shuffle ?? hasShuffleEffect,
    count: searchEffect.count,
  };
}

function amountRefToChoiceCount(count: unknown): number {
  return typeof count === 'number' && Number.isFinite(count)
    ? Math.max(0, Math.floor(count))
    : 1;
}

function libraryChoiceInfoFromEffects(effects: unknown[] | undefined): { mode: 'scry' | 'surveil'; count: number } | undefined {
  if (!Array.isArray(effects)) return undefined;
  const effect = effects.find((candidate): candidate is { kind: 'Scry' | 'Surveil'; count?: unknown } =>
    typeof candidate === 'object'
    && candidate !== null
    && (((candidate as { kind?: string }).kind === 'Scry') || ((candidate as { kind?: string }).kind === 'Surveil')),
  );
  if (!effect) return undefined;
  return {
    mode: effect.kind === 'Scry' ? 'scry' : 'surveil',
    count: amountRefToChoiceCount(effect.count),
  };
}

function controllerIdForStackItem(item: StackItem | undefined): string | undefined {
  if (!item) return undefined;
  return item.kind === 'Spell' ? item.casterId : item.controllerId;
}

function normalizeOracleForFrontendParser(oracleText: string, cardName: string): string {
  if (!cardName) return oracleText;
  const escaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return oracleText.replace(new RegExp(escaped, 'gi'), '~');
}

function definitionLooksPermanent(def: CardDefinition): boolean {
  const typeText = [def.type_line, ...def.card_types].join(' ').toLowerCase();
  return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']
    .some(type => typeText.includes(type));
}

function spellEffectsForChoicePrompt(state: GameState, item: Extract<StackItem, { kind: 'Spell' }>): Effect[] {
  const card = state.cards.get(item.cardInstanceId);
  const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
  if (!def) return [];

  const override = getOverride(def.id, def.name);
  if (override?.kind === 'Spell') return override.effects as Effect[];

  if (definitionLooksPermanent(def)) return [];

  const parsed = parseOracleText(normalizeOracleForFrontendParser(def.oracle_text, def.name));
  if (parsed.kind === 'Spell') return parsed.effects as Effect[];
  if (parsed.kind === 'Modal' && item.chosenModes?.length) {
    const effects: Effect[] = [];
    for (const modeIndex of item.chosenModes) {
      const choice = parsed.modal.choices[modeIndex];
      if (choice) effects.push(...(choice.effects as Effect[]));
    }
    return effects;
  }
  return [];
}

/** Pad a card list to the non-commander library size, or truncate if over. */
function padDeckToSize(list: string[], colors: string[], targetSize: number): string[] {
  if (list.length > targetSize) return list.slice(0, targetSize);
  const padded = [...list];
  const landOptions = colors
    .map(c => ({ W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' }[c]))
    .filter(Boolean) as string[];
  if (landOptions.length === 0) landOptions.push('Forest');
  let i = 0;
  while (padded.length < targetSize) {
    padded.push(landOptions[i % landOptions.length]);
    i++;
  }
  return padded;
}

/** Map cards in a zone to SimpleCards, with attachment relationships */
function mapCards(engine: GameState, zone: Zone, playerId: string): SimpleCard[] {
  const instances = getCardsInZone(engine, playerId, zone);
  const cards = instances.map(inst => {
    const def = getCardDefinition(engine, inst);
    return toSimpleCard(inst, def);
  });

  // Build attachment relationships for battlefield cards
  if (zone === 'battlefield') {
    const cardMap = new Map(cards.map(c => [c.instanceId, c]));
    for (const card of cards) {
      if (card.attachedTo) {
        const parent = cardMap.get(card.attachedTo);
        if (parent) {
          if (!parent.attachments) parent.attachments = [];
          parent.attachments.push(card);
        }
      }
    }
    // Filter out attached cards from the top-level list (they'll show under their parent)
    return cards.filter(c => !c.attachedTo);
  }

  return cards;
}

/**
 * Check whether the player could cast a spell if they tapped available lands.
 * Returns true if untapped lands + current mana pool can cover the cost.
 */
function couldCastWithLands(state: GameState, playerId: string, manaCost: ManaCost): boolean {
  // Use findLandsToTap for accurate dual-land handling
  // If it can find a valid tapping plan, the spell is castable
  const currentActions = getLegalActions(state, playerId);
  const manaActions = currentActions.filter(
    (a): a is { kind: 'ActivateManaAbility'; cardInstanceId: string; color: ManaColor } =>
      a.kind === 'ActivateManaAbility',
  );
  return findLandsToTap(state, playerId, manaCost, manaActions) !== null;
}

function enumerateVirtualCastTargets(state: GameState, playerId: string, card: CardInstance): string[][] {
  const specs = getSpellTargetSpecs(state, card);
  if (specs.length === 0) return [[]];
  if (specs.length === 1 && specs[0].count === 1) {
    return getLegalTargets(state, playerId, specs[0]).map(target => [target]);
  }
  return [];
}

function enumerateVirtualActivatedAbilityTargets(state: GameState, playerId: string, ability: ActivatedAbility): string[][] {
  const specs = ability.targets ?? [];
  if (specs.length === 0) return [[]];
  if (specs.length === 1) {
    const spec = {
      id: specs[0].id,
      type: specs[0].type as Parameters<typeof getLegalTargets>[2]['type'],
      count: 1,
    };
    return getLegalTargets(state, playerId, spec).map(target => [target]);
  }
  return [];
}

function getManaActionAmount(state: GameState, playerId: string, action: AIAction): number {
  if (action.kind !== 'ActivateManaAbility') return 1;
  const card = state.cards.get(action.cardInstanceId);
  const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
  const info = def?.manaProduction;
  if (!info) return 1;

  let amount = info.amounts[action.color] ?? 1;
  if (info.amountScale === 'creaturesYouControl') {
    const creatureCount = [...state.cards.values()].filter(instance => {
      if (instance.ownerId !== playerId || instance.zone !== 'battlefield') return false;
      const cardDef = state.cardDefinitions.get(instance.definitionId);
      return cardDef?.card_types.includes('creature');
    }).length;
    amount *= creatureCount;
  }
  return Math.max(0, amount);
}

function manaSourceAutoTapRank(state: GameState, cardInstanceId: string): number {
  const card = state.cards.get(cardInstanceId);
  const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
  if (!def) return 4;
  if (def.card_types.includes('land')) return 0;
  if (def.manaProduction?.requiresSacrifice || def.manaProduction?.sacrificeFilter || def.manaProduction?.activationZone === 'hand') return 4;
  if (def.card_types.includes('artifact')) return 1;
  if (def.card_types.includes('creature')) return 3;
  return 2;
}

function manaCostValue(cost: ManaCost): number {
  return cost.W + cost.U + cost.B + cost.R + cost.G + cost.C + cost.generic + (cost.hybrid?.length || 0);
}

function describeManaPaymentPlan(state: GameState, playerId: string, actions: AIAction[] | null): string | undefined {
  if (!actions || actions.length === 0) return undefined;
  const parts = actions
    .filter((action): action is Extract<AIAction, { kind: 'ActivateManaAbility' }> =>
      action.kind === 'ActivateManaAbility',
    )
    .map(action => {
      const card = state.cards.get(action.cardInstanceId);
      const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
      const amount = getManaActionAmount(state, playerId, action);
      const mana = amount > 1 ? `${amount}${action.color}` : action.color;
      return `${def?.name || 'source'} -> ${mana}`;
    });
  if (parts.length === 0) return undefined;
  const shown = parts.slice(0, 3).join(', ');
  const extra = parts.length > 3 ? `, +${parts.length - 3} more` : '';
  return `Auto-pay: ${shown}${extra}`;
}

function reducedSpellCost(state: GameState, playerId: string, def: CardDefinition, extraGeneric = 0): ManaCost {
  const baseCost = parseManaString(def.mana_cost);
  const totalCost: ManaCost = {
    ...baseCost,
    generic: baseCost.generic + extraGeneric,
    hybrid: baseCost.hybrid?.map(options => [...options]),
  };
  const reduction = Math.min(totalCost.generic, getCostReduction(state, playerId, def));
  return reduction > 0
    ? { ...totalCost, generic: totalCost.generic - reduction }
    : totalCost;
}

/**
 * Find ActivateManaAbility actions to tap lands to pay for a spell's mana cost.
 * Uses a greedy algorithm: pay colored costs first, then generic.
 * Returns the list of mana ability actions to apply, or null if not possible.
 */
function findLandsToTap(
  state: GameState,
  playerId: string,
  manaCost: ManaCost,
  manaActions: Extract<AIAction, { kind: 'ActivateManaAbility' }>[],
): Extract<AIAction, { kind: 'ActivateManaAbility' }>[] | null {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return null;

  // Calculate what we still need after existing mana pool
  const needed: ManaCost = {
    ...manaCost,
    hybrid: manaCost.hybrid?.map(options => [...options]),
  };
  const pool: ManaPool = { ...player.manaPool };
  const colorSymbols: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

  // Subtract what's already in the pool from what's needed
  for (const color of colorSymbols) {
    const pay = Math.min(pool[color], needed[color]);
    needed[color] -= pay;
    pool[color] -= pay;
  }

  const hybridNeeded: ManaColor[][] = [];
  for (const options of needed.hybrid || []) {
    const poolColor = [...options].sort((a, b) => pool[b] - pool[a])
      .find(color => pool[color] > 0);
    if (poolColor) {
      pool[poolColor] -= 1;
    } else {
      hybridNeeded.push(options);
    }
  }
  needed.hybrid = hybridNeeded;

  // Use remaining pool for generic
  let genericNeeded = needed.generic;
  for (const color of colorSymbols) {
    const pay = Math.min(pool[color], genericNeeded);
    genericNeeded -= pay;
    pool[color] -= pay;
  }
  needed.generic = genericNeeded;

  // Check if we still need any mana
  const totalNeeded = needed.W + needed.U + needed.B + needed.R + needed.G + needed.C + needed.generic + (needed.hybrid?.length || 0);
  if (totalNeeded === 0) return []; // Already have enough in pool

  // Group mana actions by card instance (a dual land might produce multiple colors)
  const actionsByCard = new Map<string, Extract<AIAction, { kind: 'ActivateManaAbility' }>[]>();
  for (const action of manaActions) {
    const list = actionsByCard.get(action.cardInstanceId) || [];
    list.push(action);
    actionsByCard.set(action.cardInstanceId, list);
  }

  const result: Extract<AIAction, { kind: 'ActivateManaAbility' }>[] = [];
  const usedCards = new Set<string>();

  // First pass: tap lands for specific colored mana needs
  // Prefer single-color producers over dual/multi lands to preserve flexibility
  for (const color of colorSymbols) {
    while (needed[color] > 0) {
      // Sort candidates: fewest color options first (basic land before dual before 5-color)
      const candidates = [...actionsByCard.entries()]
        .filter(([id]) => !usedCards.has(id))
        .filter(([, actions]) => actions.some(a => a.kind === 'ActivateManaAbility' && a.color === color))
        .sort((a, b) =>
          manaSourceAutoTapRank(state, a[0]) - manaSourceAutoTapRank(state, b[0])
          || a[1].length - b[1].length
        );

      if (candidates.length === 0) return null; // Can't pay colored cost

      const [cardId, actions] = candidates[0];
      const matchingAction = actions.find(
        a => a.kind === 'ActivateManaAbility' && a.color === color,
      )!;
      result.push(matchingAction);
      usedCards.add(cardId);
      needed[color] = Math.max(0, needed[color] - getManaActionAmount(state, playerId, matchingAction));
    }
  }

  for (const options of needed.hybrid || []) {
    const candidates = [...actionsByCard.entries()]
      .filter(([id]) => !usedCards.has(id))
      .filter(([, actions]) =>
        actions.some(a => a.kind === 'ActivateManaAbility' && options.includes(a.color)),
      )
      .sort((a, b) =>
        manaSourceAutoTapRank(state, a[0]) - manaSourceAutoTapRank(state, b[0])
        || a[1].length - b[1].length
      );

    if (candidates.length === 0) return null;

    const [cardId, actions] = candidates[0];
    const matchingAction = actions.find(
      a => a.kind === 'ActivateManaAbility' && options.includes(a.color),
    )!;
    result.push(matchingAction);
    usedCards.add(cardId);
  }

  // Second pass: tap lands for generic mana (prefer lands that only produce colorless)
  while (needed.generic > 0) {
    let found = false;
    // Prefer colorless-only lands first, then any available land
    const cardEntries = [...actionsByCard.entries()].sort((a, b) =>
      manaSourceAutoTapRank(state, a[0]) - manaSourceAutoTapRank(state, b[0])
      || a[1].length - b[1].length
    );
    for (const [cardId, actions] of cardEntries) {
      if (usedCards.has(cardId)) continue;
      if (actions.length > 0) {
        const action = actions[0];
        result.push(action); // Tap for any color
        usedCards.add(cardId);
        needed.generic = Math.max(0, needed.generic - Math.max(1, getManaActionAmount(state, playerId, action)));
        found = true;
        break;
      }
    }
    if (!found) return null; // Can't pay generic cost
  }

  return result;
}

function hasAutoTapCastOption(state: GameState, playerId: string, engineActions: AIAction[]): boolean {
  const existingCastIds = new Set(
    engineActions
      .filter(a => a.kind === 'CastSpell')
      .map(a => a.cardInstanceId),
  );

  const player = state.players.find(p => p.id === playerId);
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (!player || playerIndex < 0) return false;

  const isMainPhase = state.phase === 'precombat_main' || state.phase === 'postcombat_main';
  const canCastWithAutoTap = (card: CardInstance): boolean => {
    if (existingCastIds.has(card.instanceId)) return false;
    const def = getCardDefinition(state, card);
    if (def.card_types.includes('land')) return false;

    const isInstant = def.card_types.includes('instant');
    const hasFlash = def.keywords.includes('Flash');
    if (!isInstant && !hasFlash) {
      if (state.activePlayerIndex !== playerIndex) return false;
      if (!isMainPhase) return false;
      if (state.stack.length > 0) return false;
    }

    const taxAmount = card.zone === 'command'
      ? getCommanderCastCount(player, card.instanceId) * 2
      : 0;
    const totalCost = reducedSpellCost(state, playerId, def, taxAmount);
    if (!couldCastWithLands(state, playerId, totalCost)) return false;

    return enumerateVirtualCastTargets(state, playerId, card).length > 0;
  };

  const hand = getCardsInZone(state, playerId, 'hand');
  if (hand.some(canCastWithAutoTap)) return true;

  const commandZone = getCardsInZone(state, playerId, 'command');
  return commandZone.some(card => {
    const isCommander = card.isCommander
      || player.commanderInstanceIds?.includes(card.instanceId)
      || player.commanderInstanceId === card.instanceId;
    return isCommander && canCastWithAutoTap(card);
  });
}

function hasAutoTapEquipOption(state: GameState, playerId: string, engineActions: AIAction[]): boolean {
  const existingEquipKeys = new Set(
    engineActions
      .filter(a => a.kind === 'Equip')
      .map(a => `${a.equipmentInstanceId}>${a.targetCreatureId}`),
  );

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex < 0) return false;
  if (state.activePlayerIndex !== playerIndex) return false;
  if (state.phase !== 'precombat_main' && state.phase !== 'postcombat_main') return false;
  if (state.stack.length > 0) return false;

  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  const creatures = battlefield.filter(card => isEffectiveCreature(state, card.instanceId));
  if (creatures.length === 0) return false;

  for (const equipment of battlefield) {
    const def = getCardDefinition(state, equipment);
    if (!def.isEquipment || !def.equipCost) continue;
    const cost: ManaCost = { ...def.equipCost };
    if (!couldCastWithLands(state, playerId, cost)) continue;
    if (creatures.some(creature =>
      equipment.attachedTo !== creature.instanceId
      && !existingEquipKeys.has(`${equipment.instanceId}>${creature.instanceId}`)
    )) {
      return true;
    }
  }

  return false;
}

function hasMeaningfulHumanActionForAutoSkip(state: GameState, playerId: string): boolean {
  const actions = getLegalActions(state, playerId);
  if (actions.some(isMeaningfulAutoSkipAction)) return true;
  return hasAutoTapCastOption(state, playerId, actions) || hasAutoTapEquipOption(state, playerId, actions);
}

function getOpeningHandStats(state: GameState, playerId: string) {
  const hand = getCardsInZone(state, playerId, 'hand');
  let lands = 0;
  let cheapPlays = 0;
  let rampSources = 0;

  for (const card of hand) {
    const def = getCardDefinition(state, card);
    const isLand = def.card_types.includes('land');
    if (isLand) lands += 1;
    if (!isLand && def.cmc <= 3) cheapPlays += 1;
    if (def.manaProduction || /add\s+\{?[wubrgc]/i.test(def.oracle_text)) rampSources += 1;
  }

  return { hand, lands, nonlands: hand.length - lands, cheapPlays, rampSources };
}

function shouldAIMulliganOpeningHand(state: GameState, playerId: string, mulligansTaken: number): boolean {
  const stats = getOpeningHandStats(state, playerId);
  if (stats.hand.length < 7 || mulligansTaken >= 2) return false;

  if (stats.lands <= 1) return true;
  if (stats.lands >= 6) return true;
  if (stats.lands === 2 && stats.cheapPlays === 0 && stats.rampSources === 0) return true;
  if (stats.lands === 5 && stats.cheapPlays === 0) return true;

  return false;
}

function runAIMulligans(
  state: GameStateWithAI,
  aiIds: string[],
  aiCommanderNames: Record<string, string>,
): { state: GameStateWithAI; messages: string[] } {
  let current: GameState = state;
  const messages: string[] = [];

  for (const aiId of aiIds) {
    let mulligansTaken = 0;
    while (shouldAIMulliganOpeningHand(current, aiId, mulligansTaken)) {
      current = redrawOpeningHandForMulligan(current, aiId);
      mulligansTaken += 1;
      messages.push(`${aiCommanderNames[aiId] || aiId} mulligans to ${7 - mulligansTaken}.`);
    }

    current = bottomOpeningHandCardsForMulligan(current, aiId, mulligansTaken);
    if (mulligansTaken === 0) {
      messages.push(`${aiCommanderNames[aiId] || aiId} keeps their hand.`);
    } else {
      const stats = getOpeningHandStats(current, aiId);
      messages.push(`${aiCommanderNames[aiId] || aiId} keeps ${stats.hand.length} cards.`);
    }
  }

  return { state: current as GameStateWithAI, messages };
}

/** Format a mana pool as a readable string like "2R 3C" or "empty" */
function formatManaPool(pool: { W: number; U: number; B: number; R: number; G: number; C: number }): string {
  const parts: string[] = [];
  if (pool.W > 0) parts.push(`${pool.W}W`);
  if (pool.U > 0) parts.push(`${pool.U}U`);
  if (pool.B > 0) parts.push(`${pool.B}B`);
  if (pool.R > 0) parts.push(`${pool.R}R`);
  if (pool.G > 0) parts.push(`${pool.G}G`);
  if (pool.C > 0) parts.push(`${pool.C}C`);
  return parts.length > 0 ? parts.join(' ') : 'empty';
}

/** Derive the SimpleGameState for the UI from the engine's GameState */
function deriveSimpleState(
  engine: GameState,
  humanId: string,
  aiIds: string[],
  humanCommanderName: string,
  aiCommanderNames: Record<string, string>,
): SimpleGameState {
  const humanPlayer = getPlayer(engine, humanId);

  const humanHand = mapCards(engine, 'hand', humanId);
  const humanBattlefield = mapCards(engine, 'battlefield', humanId);
  const humanGraveyard = mapCards(engine, 'graveyard', humanId);
  const humanCommandZone = mapCards(engine, 'command', humanId);

  // Build per-AI data
  const aiPlayers: SimplePlayer[] = [];
  const aiHands: Record<string, SimpleCard[]> = {};
  const aiBattlefields: Record<string, SimpleCard[]> = {};
  const aiGraveyards: Record<string, SimpleCard[]> = {};
  const aiCommandZones: Record<string, SimpleCard[]> = {};

  for (const aiId of aiIds) {
    const aiP = getPlayer(engine, aiId);
    aiPlayers.push({
      id: aiId,
      name: aiCommanderNames[aiId] || `AI ${aiId}`,
      life: aiP.life,
      handCount: getCardsInZone(engine, aiId, 'hand').length,
      libraryCount: getCardsInZone(engine, aiId, 'library').length,
    });
    aiHands[aiId] = mapCards(engine, 'hand', aiId);
    aiBattlefields[aiId] = mapCards(engine, 'battlefield', aiId);
    aiGraveyards[aiId] = mapCards(engine, 'graveyard', aiId);
    aiCommandZones[aiId] = mapCards(engine, 'command', aiId);
  }

  // Build stack display
  const stackDisplay = engine.stack.map(item => {
    let name = '(spell/ability)';
    let casterId = '';
    let card: SimpleCard | undefined;
    if (item.kind === 'Spell') {
      const inst = engine.cards.get(item.cardInstanceId);
      if (inst) {
        const def = engine.cardDefinitions.get(inst.definitionId);
        name = def?.name || '(unknown spell)';
        if (def) card = toSimpleCard(inst, def);
      }
      casterId = item.casterId;
    } else if (item.kind === 'TriggeredAbility') {
      const inst = engine.cards.get(item.sourceInstanceId);
      if (inst) {
        const def = engine.cardDefinitions.get(inst.definitionId);
        name = `${def?.name || '?'} trigger`;
        if (def) card = toSimpleCard(inst, def);
      }
      casterId = item.controllerId;
    } else if (item.kind === 'ActivatedAbility') {
      const inst = engine.cards.get(item.sourceInstanceId);
      if (inst) {
        const def = engine.cardDefinitions.get(inst.definitionId);
        name = `${def?.name || '?'} ability`;
        if (def) card = toSimpleCard(inst, def);
      }
      casterId = item.controllerId;
    }
    return {
      id: item.id,
      kind: item.kind,
      name,
      casterId,
      card,
      targetNames: item.targets.map(targetId => displayNameForTarget(engine, targetId)),
    };
  });

  // Determine game-over: human lost or ALL AIs lost
  const humanLost = humanPlayer.hasLost;
  const allAIsLost = aiIds.every(id => getPlayer(engine, id).hasLost);
  const anyAIAlive = !allAIsLost;
  const gameOver = humanLost || allAIsLost;
  let winnerId: string | null = null;
  if (humanLost && anyAIAlive) winnerId = aiIds[0]; // AI wins
  else if (allAIsLost && !humanLost) winnerId = humanId;

  // Priority player
  const priorityPlayer = engine.players[engine.priorityPlayerIndex];

  // Map phase/step for display
  let displayStep = engine.step as string;
  if (engine.phase === 'precombat_main' || engine.phase === 'postcombat_main') {
    displayStep = 'main';
  }

  // First AI for backward-compatible aliases
  const firstAiId = aiIds[0] || 'ai1';
  const firstAiPlayer = aiPlayers[0] || { id: firstAiId, name: 'AI', life: 40, handCount: 0, libraryCount: 0 };

  // Convert raw turn number to round number (turn 1&2 in 2-player = round 1, etc.)
  const playerCount = engine.players.length;
  const roundNumber = publicTurnNumber(engine.turnNumber, playerCount);

  return {
    turnNumber: roundNumber,
    phase: engine.phase,
    step: displayStep,
    activePlayerId: engine.players[engine.activePlayerIndex]?.id || humanId,
    priorityPlayerId: priorityPlayer?.id || humanId,
    humanPlayer: {
      id: humanId,
      name: 'You',
      life: humanPlayer.life,
      handCount: getCardsInZone(engine, humanId, 'hand').length,
      libraryCount: getCardsInZone(engine, humanId, 'library').length,
    },
    humanCommander: humanCommanderName,
    humanHand,
    humanBattlefield,
    humanGraveyard,
    humanCommandZone,
    stack: stackDisplay,
    gameOver,
    winnerId,
    manaPool: { ...humanPlayer.manaPool },

    // Multiplayer AI fields
    aiPlayers,
    aiHands,
    aiBattlefields,
    aiGraveyards,
    aiCommandZones,
    aiCommanderNames,

    // Backward-compatible single-AI aliases
    aiPlayer: firstAiPlayer,
    aiCommander: aiCommanderNames[firstAiId] || 'AI',
    aiHand: aiHands[firstAiId] || [],
    aiBattlefield: aiBattlefields[firstAiId] || [],
    aiGraveyard: aiGraveyards[firstAiId] || [],
    aiCommandZone: aiCommandZones[firstAiId] || [],
  };
}

/** Capture a game log entry from the current engine state */
function captureLogEntry(
  engine: GameState,
  humanId: string,
  aiIds: string[],
  player: 'human' | 'ai',
  action: string,
  manaSpent: number,
  specificPlayerId?: string,
  decision?: DecisionReview,
): GameLogEntry {
  const humanPlayer = engine.players.find(p => p.id === humanId);

  const humanCreatures = getCardsInZone(engine, humanId, 'battlefield')
    .filter(inst => {
      const def = getCardDefinition(engine, inst);
      return def.card_types.includes('creature');
    }).length;

  // Sum all AI creatures across all AI players
  let aiCreatures = 0;
  for (const aiId of aiIds) {
    aiCreatures += getCardsInZone(engine, aiId, 'battlefield')
      .filter(inst => {
        const def = getCardDefinition(engine, inst);
        return def.card_types.includes('creature');
      }).length;
  }

  const totalMana = Object.values(humanPlayer?.manaPool ?? { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })
    .reduce((sum, v) => sum + v, 0);
  const untappedLands = getCardsInZone(engine, humanId, 'battlefield')
    .filter(inst => {
      const def = getCardDefinition(engine, inst);
      return def.card_types.includes('land') && !inst.tapped;
    }).length;

  // Use first AI's life for backward compat
  const firstAi = engine.players.find(p => p.id === (aiIds[0] || 'ai1'));
  const aiTotalHand = aiIds.reduce((sum, id) => sum + getCardsInZone(engine, id, 'hand').length, 0);

  return {
    turnNumber: publicTurnNumber(engine.turnNumber, engine.players.length),
    player,
    playerId: specificPlayerId || (player === 'human' ? humanId : aiIds[0]),
    action,
    phase: engine.phase,
    manaAvailable: player === 'human' ? totalMana + untappedLands : 0,
    manaSpent,
    boardCreatureCount: { human: humanCreatures, ai: aiCreatures },
    lifeTotals: {
      human: humanPlayer?.life ?? 0,
      ai: firstAi?.life ?? 0,
    },
    cardsInHand: {
      human: getCardsInZone(engine, humanId, 'hand').length,
      ai: aiTotalHand,
    },
    timestamp: Date.now(),
    playByPlay: player === 'human' ? playByPlayFromDecision(action, decision) : `${action}.`,
    decision,
  };
}

/** Convert engine AIAction to SimpleLegalAction for the UI */
function toSimpleLegalAction(action: AIAction, engineState: GameState): SimpleLegalAction {
  switch (action.kind) {
    case 'PlayLand': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      return {
        kind: 'PlayLand',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `Play ${def?.name || 'land'}`,
        _engineAction: action,
      };
    }
    case 'CastSpell': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      return {
        kind: 'CastSpell',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `Cast ${def?.name || 'spell'}${targetLabelSuffix(engineState, action.targets)}`,
        _engineAction: action,
      };
    }
    case 'ActivateManaAbility': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      const verb = def?.manaProduction?.activationZone === 'hand'
        ? 'Exile'
        : 'Tap';
      return {
        kind: 'ActivateManaAbility',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `${verb} ${def?.name || 'permanent'} for ${action.color}`,
        _engineAction: action,
      };
    }
    case 'ManualUntapManaSource': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      return {
        kind: 'ManualUntapManaSource',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `Untap ${def?.name || 'mana source'}`,
        _engineAction: action,
      };
    }
    case 'ActivateAbility': {
      const inst = engineState.cards.get(action.cardInstanceId);
      const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
      return {
        kind: 'ActivateAbility',
        cardInstanceId: action.cardInstanceId,
        cardName: def?.name,
        label: `Activate ${def?.name || 'ability'}${targetLabelSuffix(engineState, action.targets)}`,
        _engineAction: action,
      };
    }
    case 'DeclareAttackers': {
      const attackerInst = action.attacks.length === 1
        ? engineState.cards.get(action.attacks[0].cardInstanceId)
        : undefined;
      const attackerDef = attackerInst
        ? engineState.cardDefinitions.get(attackerInst.definitionId)
        : undefined;
      const names = action.attacks.map(a => {
        const inst = engineState.cards.get(a.cardInstanceId);
        const def = inst ? engineState.cardDefinitions.get(inst.definitionId) : undefined;
        return def?.name || '?';
      });
      const defenderNames = [
        ...new Set(action.attacks.map(a => {
          const defender = engineState.players.find(p => p.id === a.defendingPlayerId);
          return defender?.name.replace(/\s+\(AI\)$/, '') || a.defendingPlayerId;
        })),
      ];
      return {
        kind: 'DeclareAttackers',
        cardInstanceId: attackerInst?.instanceId,
        cardName: attackerDef?.name,
        label: action.attacks.length > 0
          ? `Attack ${defenderNames.join(', ')} with ${names.join(', ')}`
          : 'Skip attacks',
        _engineAction: action,
      };
    }
    case 'DeclareBlockers': {
      const blockerInst = action.blocks.length === 1
        ? engineState.cards.get(action.blocks[0].cardInstanceId)
        : undefined;
      const blockerDef = blockerInst
        ? engineState.cardDefinitions.get(blockerInst.definitionId)
        : undefined;
      return {
        kind: 'DeclareBlockers',
        cardInstanceId: blockerInst?.instanceId,
        cardName: blockerDef?.name,
        label: action.blocks.length > 0
          ? `Block with ${action.blocks.length} creature(s)`
          : 'No blocks',
        _engineAction: action,
      };
    }
    case 'Equip': {
      const equipInst = engineState.cards.get(action.equipmentInstanceId);
      const equipDef = equipInst ? engineState.cardDefinitions.get(equipInst.definitionId) : undefined;
      const targetInst = engineState.cards.get(action.targetCreatureId);
      const targetDef = targetInst ? engineState.cardDefinitions.get(targetInst.definitionId) : undefined;
      return {
        kind: 'Equip',
        cardInstanceId: action.equipmentInstanceId,
        cardName: equipDef?.name,
        label: `Equip ${equipDef?.name || 'equipment'} to ${targetDef?.name || 'creature'}`,
        _engineAction: action,
      };
    }
    case 'PassPriority': {
      // Context-aware label
      let label = 'Done';
      if (engineState.stack.length > 0) {
        label = "Don't Respond";
      } else if (engineState.phase === 'precombat_main' || engineState.phase === 'postcombat_main') {
        label = 'End Phase';
      } else if (engineState.step === 'declare_attackers') {
        label = 'Skip Attacks';
      }
      return {
        kind: 'PassPriority',
        label,
        _engineAction: action,
      };
    }
  }
}

function targetGroupKey(action: SimpleLegalAction): string | null {
  const engineAction = action._engineAction;
  if (engineAction.kind === 'CastSpell' && engineAction.targets.length === 1) {
    return `cast:${engineAction.cardInstanceId}:${(engineAction.chosenModes || []).join(',')}`;
  }
  if (engineAction.kind === 'ActivateAbility' && engineAction.targets.length === 1) {
    return `ability:${engineAction.cardInstanceId}:${engineAction.abilityIndex}`;
  }
  if (engineAction.kind === 'Equip') {
    return `equip:${engineAction.equipmentInstanceId}`;
  }
  return null;
}

function targetIdForGroupedAction(action: SimpleLegalAction): string | null {
  const engineAction = action._engineAction;
  if (engineAction.kind === 'CastSpell' || engineAction.kind === 'ActivateAbility') {
    return engineAction.targets.length === 1 ? engineAction.targets[0] : null;
  }
  if (engineAction.kind === 'Equip') {
    return engineAction.targetCreatureId;
  }
  return null;
}

function baseLabelForTargetGroup(engineState: GameState, action: SimpleLegalAction): string {
  const engineAction = action._engineAction;
  if (engineAction.kind === 'CastSpell') {
    const card = engineState.cards.get(engineAction.cardInstanceId);
    const def = card ? engineState.cardDefinitions.get(card.definitionId) : undefined;
    return `Cast ${def?.name || action.cardName || 'spell'}`;
  }
  if (engineAction.kind === 'ActivateAbility') {
    const card = engineState.cards.get(engineAction.cardInstanceId);
    const def = card ? engineState.cardDefinitions.get(card.definitionId) : undefined;
    return `Activate ${def?.name || action.cardName || 'ability'}`;
  }
  if (engineAction.kind === 'Equip') {
    const card = engineState.cards.get(engineAction.equipmentInstanceId);
    const def = card ? engineState.cardDefinitions.get(card.definitionId) : undefined;
    return `Equip ${def?.name || action.cardName || 'equipment'}`;
  }
  return action.label;
}

function collapseTargetedActions(
  actions: SimpleLegalAction[],
  engineState: GameState,
): SimpleLegalAction[] {
  const groups = new Map<string, SimpleLegalAction[]>();
  for (const action of actions) {
    const key = targetGroupKey(action);
    if (!key) continue;
    const bucket = groups.get(key) || [];
    bucket.push(action);
    groups.set(key, bucket);
  }

  const emitted = new Set<string>();
  const collapsed: SimpleLegalAction[] = [];
  for (const action of actions) {
    const key = targetGroupKey(action);
    if (!key) {
      collapsed.push(action);
      continue;
    }
    const group = groups.get(key) || [];
    if (group.length <= 1) {
      collapsed.push(action);
      continue;
    }
    if (emitted.has(key)) continue;
    emitted.add(key);

    const targetChoices = group
      .map(groupedAction => {
        const targetId = targetIdForGroupedAction(groupedAction);
        return targetId
          ? {
              targetId,
              label: targetPickerLabel(engineState, targetId),
              action: groupedAction,
            }
          : null;
      })
      .filter(Boolean) as TargetActionChoice[];

    collapsed.push({
      ...action,
      label: `${baseLabelForTargetGroup(engineState, action)}: choose target`,
      targetChoices,
    });
  }
  return collapsed;
}

// ========== Hook ==========

export function useShelectorGame() {
  const [gameState, setGameState] = useState<SimpleGameState | null>(null);
  const [legalActions, setLegalActions] = useState<SimpleLegalAction[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [opponentInfo, setOpponentInfo] = useState<OpponentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mulliganPhase, setMulliganPhase] = useState(false);
  const [mulliganCount, setMulliganCount] = useState(0);
  const [selectedMulliganCardIds, setSelectedMulliganCardIds] = useState<string[]>([]);
  const [selectedMulliganBottomIds, setSelectedMulliganBottomIds] = useState<string[]>([]);
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([]);
  const [authorityUpdates, setAuthorityUpdates] = useState<EngineStateUpdate[]>([]);
  const [lastStateUpdate, setLastStateUpdate] = useState<EngineStateUpdate | null>(null);
  const [currentPrompt, setCurrentPrompt] = useState<EnginePrompt | null>(null);
  const [lastPlayedCard, setLastPlayedCard] = useState<LastPlayedCard | null>(null);
  const [discardPhase, setDiscardPhase] = useState(false);
  const [discardCount, setDiscardCount] = useState(0);
  const [tutorPhase, setTutorPhase] = useState(false);
  const [tutorCards, setTutorCards] = useState<TutorCardOption[]>([]);
  const [tutorTitle, setTutorTitle] = useState('');
  const [libraryChoice, setLibraryChoice] = useState<LibraryManipulationChoice | null>(null);
  const tutorDestinationRef = useRef<SearchDestination>('hand');
  const tutorFilterSpecRef = useRef<SearchFilterSpec | undefined>(undefined);
  const tutorTappedRef = useRef(false);
  const tutorShuffleRef = useRef(true);
  // Number of additional cards the active tutor can still find (for "up to N" searches).
  // 0 means the current pick is the last one; > 0 means the picker re-opens after each pick.
  const tutorRemainingRef = useRef<number>(0);
  const tutorFilterRef = useRef<string | undefined>(undefined);
  const tutorSourceNameRef = useRef<string>('Search');
  const tutorSourceInstanceIdRef = useRef<string | undefined>(undefined);
  const tutorPromptRequestRef = useRef<SearchLibraryPromptRequest | null>(null);
  const pendingCastChoiceActionRef = useRef<SimpleLegalAction | null>(null);
  const pendingCastChoiceModeRef = useRef<PendingCastChoiceMode | null>(null);
  const pendingCastSelectCardsPromptRef = useRef<SelectCardsPromptRequest | null>(null);
  const pendingPlayLandChoiceRef = useRef<PendingPlayLandChoice | null>(null);
  const pendingSearchEntryChoiceRef = useRef<PendingSearchEntryChoice | null>(null);
  const pendingTargetChoiceRef = useRef<PendingTargetChoice | null>(null);
  const pendingLibraryChoiceRef = useRef<{ stackItemId: string; mode: 'scry' | 'surveil' } | null>(null);
  const libraryManipulationPromptRequestRef = useRef<LibraryManipulationPromptRequest | null>(null);
  const [optionalTriggerChoice, setOptionalTriggerChoice] = useState<OptionalTriggerChoice | null>(null);
  const optionalTriggerPromptRequestRef = useRef<OptionalTriggerPromptRequest | null>(null);
  const [damageAssignmentChoice, setDamageAssignmentChoice] = useState<DamageAssignmentChoice | null>(null);
  const damageAssignmentPromptRequestRef = useRef<DamageAssignmentPromptRequest | null>(null);
  const [triggerOrderChoice, setTriggerOrderChoice] = useState<TriggerOrderChoiceState | null>(null);
  const triggerOrderPromptRequestRef = useRef<OrderTriggersPromptRequest | null>(null);
  const submitActionRef = useRef<((action: SimpleLegalAction) => void) | null>(null);
  const [undosRemaining, setUndosRemaining] = useState(10);

  // Undo history — snapshots of engine state + chat messages before each human action
  const undoStackRef = useRef<{
    engine: GameStateWithAI;
    messages: ChatMessage[];
    log: GameLogEntry[];
    lastPlayedCard: LastPlayedCard | null;
  }[]>([]);

  // Engine state ref (mutable, not in React state to avoid re-serializing Map objects)
  const engineRef = useRef<GameStateWithAI | null>(null);
  // Keep deck info for mulligan re-init
  const humanDeckRef = useRef<GeneratedDeck | null>(null);
  const aiDecksRef = useRef<GeneratedDeck[]>([]);
  const cardLookupRef = useRef<((name: string) => ScryfallCard | undefined) | null>(null);
  const humanCommanderRef = useRef('Unknown Commander');
  const aiCommanderNamesRef = useRef<Record<string, string>>({ ai1: 'Shelector AI' });
  const humanIdRef = useRef('human');
  const aiIdsRef = useRef<string[]>(['ai1']);
  const discardCountRef = useRef(0);
  const [newPlayerMode, setNewPlayerModeState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('deckreps_new_player_mode') === '1';
  });

  const setNewPlayerMode = useCallback((on: boolean) => {
    setNewPlayerModeState(on);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('deckreps_new_player_mode', on ? '1' : '0');
    }
  }, []);
  const [coachMode, setCoachMode] = useState(true); // On by default — this is a learning tool
  const [holdPriority, setHoldPriorityState] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('deckreps_hold_priority') === '1';
  });
  const holdPriorityRef = useRef(holdPriority);
  const setHoldPriority = useCallback((on: boolean) => {
    holdPriorityRef.current = on;
    setHoldPriorityState(on);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('deckreps_hold_priority', on ? '1' : '0');
    }
  }, []);

  // try* action error state (Task 7 — game-reliability-refactor)
  const [actionError, setActionError] = useState<{ reason: string; message: string } | null>(null);
  const [lastEvents, setLastEvents] = useState<ActionGameEvent[]>([]);

  // End-game modal state (Task 27 — game-reliability-refactor)
  const [endGame, setEndGame] = useState<EndGameState>({ open: false, kind: 'loss' });

  // Track which mana sources were tapped but mana not yet spent on a spell
  // These can be untapped. Once a spell is cast, the taps become "committed" and can't be reversed.
  const uncommittedTapsRef = useRef<Map<string, { color: ManaColor; amount: number }>>(new Map());
  const stepEffectsDoneRef = useRef<Set<string>>(new Set());

  const addMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setChatMessages(prev => [...prev, { role, text, timestamp: Date.now() }]);
  }, []);

  const appendLog = useCallback((entry: GameLogEntry) => {
    setGameLog(prev => [...prev, entry]);
  }, []);

  const recordAuthorityUpdate = useCallback((update?: EngineStateUpdate) => {
    if (!update) return;
    const playerCount = engineRef.current?.players.length || 1;
    const displayUpdate: EngineStateUpdate = {
      ...update,
      turnNumber: publicTurnNumber(update.turnNumber, playerCount),
      visibleDiffs: update.visibleDiffs.map(diff => diff.kind === 'PhaseChanged'
        ? {
            ...diff,
            from: { ...diff.from, turnNumber: publicTurnNumber(diff.from.turnNumber, playerCount) },
            to: { ...diff.to, turnNumber: publicTurnNumber(diff.to.turnNumber, playerCount) },
          }
        : diff),
    };
    setLastStateUpdate(displayUpdate);
    setAuthorityUpdates(prev => [...prev.slice(-199), displayUpdate]);
  }, []);

  const recordStateUpdate = useCallback((
    before: GameState,
    after: GameState,
    action: SimpleLegalAction,
    events: ActionGameEvent[],
    options: { playerId?: string; source?: 'ui' | 'ai' | 'system' } = {},
  ) => {
    const playerId = options.playerId || humanIdRef.current;
    const request = createClientActionRequest(before, playerId, action._engineAction, {
      source: options.source || 'ui',
      label: action.label,
    });
    const update = buildStateUpdate(
      before,
      after,
      {
        requestId: request.id,
        playerId,
        actionKind: request.action.kind,
        label: request.label,
      },
        events,
      );
    recordAuthorityUpdate(update);
  }, [recordAuthorityUpdate]);

  const applyActionThroughAuthority = useCallback((
    state: GameState,
    playerId: string,
    action: AIAction,
    options: { source?: 'ui' | 'ai' | 'system'; label?: string; recordUpdate?: boolean } = {},
  ): ClientActionResponse => {
    const simpleAction = toSimpleLegalAction(action, state);
    const request = createClientActionRequest(state, playerId, action, {
      source: options.source || 'system',
      label: options.label || simpleAction.label,
    });
    const response = applyClientActionRequest(state, request);
    if (options.recordUpdate !== false) {
      recordAuthorityUpdate(response.update);
    }
    return response;
  }, [recordAuthorityUpdate]);

  const recordSystemStateTransition = useCallback((before: GameState, after: GameState): GameState => {
    if (before === after) return after;
    recordAuthorityUpdate(buildStateUpdate(before, after));
    return after;
  }, [recordAuthorityUpdate]);

  const advanceStepWithAuthority = useCallback((state: GameState): GameState =>
    recordSystemStateTransition(state, advanceStep(state)),
  [recordSystemStateTransition]);

  const performUntapStepWithAuthority = useCallback((state: GameState): GameState =>
    recordSystemStateTransition(state, performUntapStep(state)),
  [recordSystemStateTransition]);

  const drawCardsWithAuthority = useCallback((state: GameState, playerId: string, count: number): GameState =>
    recordSystemStateTransition(state, drawCards(state, playerId, count)),
  [recordSystemStateTransition]);

  const resolveTopOfStackWithAuthority = useCallback((state: GameState): GameState =>
    recordSystemStateTransition(state, resolveTopOfStack(state)),
  [recordSystemStateTransition]);

  const resolveCombatDamageWithAuthority = useCallback((state: GameState): GameState =>
    recordSystemStateTransition(state, resolveCombatDamage(state)),
  [recordSystemStateTransition]);

  const rememberLastPlayedCard = useCallback((
    state: GameState,
    cardInstanceId: string | undefined,
    playerId: string,
    action: LastPlayedCard['action'],
  ) => {
    if (!cardInstanceId) return;
    const inst = state.cards.get(cardInstanceId);
    if (!inst) return;
    const def = state.cardDefinitions.get(inst.definitionId);
    if (!def) return;

    setLastPlayedCard({
      card: toSimpleCard(inst, def),
      playerId,
      playerName: playerId === humanIdRef.current
        ? 'You'
        : aiCommanderNamesRef.current[playerId] || 'AI',
      action,
      turnNumber: publicTurnNumber(state.turnNumber, state.players.length),
    });
  }, []);

  /**
   * Process engine events after a try* call and open the EndGameModal when
   * a PlayerLost or PossibleLoop event is present.
   * (Task 27 — game-reliability-refactor)
   */
  const applyEvents = useCallback(
    (events: ActionGameEvent[], postState: GameState) => {
      if (events.length === 0) return;
      setLastEvents(prev => [...prev, ...events]);
      const humanId = humanIdRef.current;
      for (const ev of events) {
        if (ev.kind === 'PlayerLost') {
          if (ev.playerId === humanId) {
            setEndGame({ open: true, kind: 'loss', reason: ev.reason });
          } else {
            // Check if ALL opponents have now lost (using post-action state)
            const allOpponentsLost = postState.players
              .filter(p => p.id !== humanId)
              .every(p => p.hasLost || p.id === ev.playerId);
            if (allOpponentsLost) {
              setEndGame({ open: true, kind: 'win' });
            }
          }
        } else if (ev.kind === 'PossibleLoop') {
          setEndGame({ open: true, kind: 'loop', loopSources: ev.signature.sources });
        }
      }
    },
    [],
  );

  /** Sync the React state from the engine ref and compute legal actions */
  const syncState = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const humanPlayer = engine.players.find(p => p.id === humanIdRef.current);
    if (humanPlayer) {
      const total = Object.values(humanPlayer.manaPool).reduce((a, b) => a + b, 0);
      if (total > 0) console.log('[syncState] mana pool:', humanPlayer.manaPool);
    }
    const simple = deriveSimpleState(
      engine,
      humanIdRef.current,
      aiIdsRef.current,
      humanCommanderRef.current,
      aiCommanderNamesRef.current,
    );
    setGameState(simple);

    // Compute legal actions for human if they have priority and game not over
    if (!simple.gameOver && simple.priorityPlayerId === humanIdRef.current) {
      const engineActions = getLegalActions(engine, humanIdRef.current);
      const simpleActions = engineActions.map(a => toSimpleLegalAction(a, engine));

      // Add virtual CastSpell actions for cards that could be cast with auto-tap.
      // The engine only returns CastSpell when mana is already in pool.
      // We check each card in hand (and command zone) to see if it could be cast
      // by tapping available lands, and add a synthetic CastSpell action if so.
      const existingCastIds = new Set(
        engineActions
          .filter(a => a.kind === 'CastSpell')
          .map(a => a.cardInstanceId),
      );

      const humanId = humanIdRef.current;
      const player = engine.players.find(p => p.id === humanId);
      const playerIndex = engine.players.findIndex(p => p.id === humanId);
      const isMainPhase = engine.phase === 'precombat_main' || engine.phase === 'postcombat_main';
      const availableManaActions = engineActions.filter(
        (a): a is Extract<AIAction, { kind: 'ActivateManaAbility' }> =>
          a.kind === 'ActivateManaAbility',
      );

      if (player) {
        // Check cards in hand
        const hand = getCardsInZone(engine, humanId, 'hand');
        for (const card of hand) {
          if (existingCastIds.has(card.instanceId)) continue; // Already has CastSpell action
          const def = getCardDefinition(engine, card);
          if (def.card_types.includes('land')) continue; // Lands aren't cast

          // Check timing: instants/flash can be cast anytime with priority,
          // sorcery-speed needs main phase + active player + empty stack
          const isInstant = def.card_types.includes('instant');
          const hasFlash = def.keywords.includes('Flash');
          if (!isInstant && !hasFlash) {
            if (engine.activePlayerIndex !== playerIndex) continue;
            if (!isMainPhase) continue;
            if (engine.stack.length > 0) continue;
          }

          // Check if player could pay the reduced cost with available lands.
          const totalCost = reducedSpellCost(engine, humanId, def);
          const paymentPlan = findLandsToTap(engine, humanId, totalCost, availableManaActions);
          if (paymentPlan) {
            // Create synthetic cast actions with required targets, including stack targets.
            const targetSets = enumerateVirtualCastTargets(engine, humanId, card);
            for (const targets of targetSets) {
              const castAction: AIAction = {
                kind: 'CastSpell',
                cardInstanceId: card.instanceId,
                targets,
              };
              simpleActions.push({
                kind: 'CastSpell',
                cardInstanceId: card.instanceId,
                cardName: def.name,
                label: `Cast ${def.name}${targetLabelSuffix(engine, targets)}`,
                paymentPreview: describeManaPaymentPlan(engine, humanId, paymentPlan),
                _engineAction: castAction,
              });
            }
          }
        }

        // Check command zone (commander)
        const commandZone = getCardsInZone(engine, humanId, 'command');
        for (const card of commandZone) {
          if (existingCastIds.has(card.instanceId)) continue;
          const isCommander = card.isCommander || player.commanderInstanceIds?.includes(card.instanceId) || player.commanderInstanceId === card.instanceId;
          if (!isCommander) continue;
          const def = getCardDefinition(engine, card);
          if (def.card_types.includes('land')) continue;

          const isInstant = def.card_types.includes('instant');
          const hasFlash = def.keywords.includes('Flash');
          if (!isInstant && !hasFlash) {
            if (engine.activePlayerIndex !== playerIndex) continue;
            if (!isMainPhase) continue;
            if (engine.stack.length > 0) continue;
          }

          const taxAmount = getCommanderCastCount(player, card.instanceId) * 2;
          const totalCost = reducedSpellCost(engine, humanId, def, taxAmount);
          const paymentPlan = findLandsToTap(engine, humanId, totalCost, availableManaActions);
          if (paymentPlan) {
            const targetSets = enumerateVirtualCastTargets(engine, humanId, card);
            for (const targets of targetSets) {
              const castAction: AIAction = {
                kind: 'CastSpell',
                cardInstanceId: card.instanceId,
                targets,
              };
              simpleActions.push({
                kind: 'CastSpell',
                cardInstanceId: card.instanceId,
                cardName: def.name,
                label: `Cast ${def.name}${targetLabelSuffix(engine, targets)}`,
                paymentPreview: describeManaPaymentPlan(engine, humanId, paymentPlan),
                _engineAction: castAction,
              });
            }
          }
        }

        // Add virtual activated abilities that can be paid by auto-tapping mana sources.
        // The engine only returns ActivateAbility once the mana is already floating.
        const existingActivateKeys = new Set(
          engineActions
            .filter(a => a.kind === 'ActivateAbility')
            .map(a => `${a.cardInstanceId}:${a.abilityIndex}:${a.targets.join(',')}`),
        );
        const battlefieldForAbilities = getCardsInZone(engine, humanId, 'battlefield');
        for (const sourceCard of battlefieldForAbilities) {
          if (sourceCard.ownerId !== humanId) continue;
          const abilities = getActivatedAbilities(engine, sourceCard.instanceId);
          for (let abilityIndex = 0; abilityIndex < abilities.length; abilityIndex++) {
            const ability = abilities[abilityIndex];
            if (ability.isManaAbility) continue;
            if (!ability.cost.mana) continue;
            if (ability.cost.tap && sourceCard.tapped) continue;
            if (ability.cost.tap && isBlockedBySummoningSicknessForTap(engine, sourceCard.instanceId)) continue;
            if (ability.cost.sacrifice && ability.cost.sacrifice !== 'self') continue;
            if (ability.cost.payLife && player.life < ability.cost.payLife) continue;

            const abilityCost = parseManaString(ability.cost.mana);
            const paymentPlan = findLandsToTap(engine, humanId, abilityCost, availableManaActions);
            if (!paymentPlan) continue;

            const sourceDef = getCardDefinition(engine, sourceCard);
            const targetSets = enumerateVirtualActivatedAbilityTargets(engine, humanId, ability);
            for (const targets of targetSets) {
              const key = `${sourceCard.instanceId}:${abilityIndex}:${targets.join(',')}`;
              if (existingActivateKeys.has(key)) continue;
              const activateAction: AIAction = {
                kind: 'ActivateAbility',
                cardInstanceId: sourceCard.instanceId,
                abilityIndex,
                targets,
              };
              simpleActions.push({
                kind: 'ActivateAbility',
                cardInstanceId: sourceCard.instanceId,
                cardName: sourceDef.name,
                label: `Activate ${sourceDef.name}${targetLabelSuffix(engine, targets)}`,
                paymentPreview: describeManaPaymentPlan(engine, humanId, paymentPlan),
                _engineAction: activateAction,
              });
            }
          }
        }

        // Add virtual Equip actions for equipment that can be paid for by auto-tapping.
        // The engine only returns Equip once the mana is already floating.
        if (engine.activePlayerIndex === playerIndex && isMainPhase && engine.stack.length === 0) {
          const existingEquipKeys = new Set(
            engineActions
              .filter(a => a.kind === 'Equip')
              .map(a => `${a.equipmentInstanceId}>${a.targetCreatureId}`),
          );
          const battlefield = getCardsInZone(engine, humanId, 'battlefield');
          const creatures = battlefield.filter(card => isEffectiveCreature(engine, card.instanceId));
          const equipment = battlefield.filter(card => {
            const def = getCardDefinition(engine, card);
            return Boolean(def.isEquipment && def.equipCost);
          });

          for (const equipCard of equipment) {
            const equipDef = getCardDefinition(engine, equipCard);
            if (!equipDef.equipCost) continue;
            const equipCost: ManaCost = { ...equipDef.equipCost };
            const paymentPlan = findLandsToTap(engine, humanId, equipCost, availableManaActions);
            if (!paymentPlan) continue;

            for (const creature of creatures) {
              if (equipCard.attachedTo === creature.instanceId) continue;
              const key = `${equipCard.instanceId}>${creature.instanceId}`;
              if (existingEquipKeys.has(key)) continue;

              const targetDef = getCardDefinition(engine, creature);
              const equipAction: AIAction = {
                kind: 'Equip',
                equipmentInstanceId: equipCard.instanceId,
                targetCreatureId: creature.instanceId,
              };
              simpleActions.push({
                kind: 'Equip',
                cardInstanceId: equipCard.instanceId,
                cardName: equipDef.name,
                label: `Equip ${equipDef.name} to ${targetDef.name}`,
                paymentPreview: describeManaPaymentPlan(engine, humanId, paymentPlan),
                _engineAction: equipAction,
              });
            }
          }
        }
      }

      const canSkipRestOfTurn = engine.stack.length === 0;
      if (canSkipRestOfTurn) {
        simpleActions.unshift({
          kind: 'SkipRestOfTurn',
          label: 'Skip Rest of Turn',
          _engineAction: { kind: 'PassPriority' },
        });
      } else if (isEmptyWindowSkippable(simpleActions)) {
        simpleActions.unshift({
          kind: 'SkipEmptyPhases',
          label: engine.stack.length > 0 ? 'Pass Empty Responses' : 'Skip Empty Phases',
          _engineAction: { kind: 'PassPriority' },
        });
      }

      const visibleActions = collapseTargetedActions(simpleActions, engine);
      setLegalActions(visibleActions);
      setCurrentPrompt(buildVisibleActionPrompt(engine, humanIdRef.current, visibleActions));
    } else {
      setLegalActions([]);
      setCurrentPrompt(buildActionPrompt(engine, simple.priorityPlayerId) || null);
    }
  }, []);

  /**
   * Narrate meaningful AI decisions into the messages array
   * and accumulate game log entries.
   */
  const narrateDecisions = useCallback(
    (
      decisions: { action: AIAction }[],
      state: GameState,
      messages: { role: ChatMessage['role']; text: string }[],
      logEntries: GameLogEntry[],
    ) => {
      for (const decision of decisions) {
        const a = decision.action;
        let actionText: string | null = null;
        let manaSpent = 0;

        // Get AI's current mana pool for context
        const aiPlayer = state.players.find(p => aiIdsRef.current.includes(p.id));
        const aiPoolStr = aiPlayer ? formatManaPool(aiPlayer.manaPool) : 'empty';

        if (a.kind === 'PlayLand') {
          const inst = state.cards.get(a.cardInstanceId);
          const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
          actionText = `Played ${def?.name || 'a land'}`;
          messages.push({ role: 'shelector', text: `${actionText}.` });
          rememberLastPlayedCard(state, a.cardInstanceId, inst?.ownerId || aiIdsRef.current[0], 'Played');
        } else if (a.kind === 'CastSpell') {
          const inst = state.cards.get(a.cardInstanceId);
          const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
          actionText = `Cast ${def?.name || 'a spell'}`;
          const costStr = def?.mana_cost || '?';
          if (def) {
            const cost = parseManaString(def.mana_cost);
            manaSpent = manaCostValue(cost);
          }
          messages.push({ role: 'shelector', text: `${actionText} (cost: ${costStr}). Floating: ${aiPoolStr}` });
          rememberLastPlayedCard(state, a.cardInstanceId, inst?.ownerId || aiIdsRef.current[0], 'Cast');
        } else if (a.kind === 'ActivateManaAbility') {
          const inst = state.cards.get(a.cardInstanceId);
          const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
          messages.push({ role: 'shelector', text: `Tapped ${def?.name || 'a permanent'} for mana. Floating: ${aiPoolStr}` });
        } else if (a.kind === 'DeclareAttackers') {
          if (a.attacks.length > 0) {
            const names = a.attacks.map(atk => {
              const inst = state.cards.get(atk.cardInstanceId);
              const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
              const defender = state.players.find(p => p.id === atk.defendingPlayerId);
              const defenderName = defender?.name.replace(/\s+\(AI\)$/, '') || atk.defendingPlayerId;
              return `${def?.name || '?'} at ${defenderName}`;
            });
            actionText = `Attacked with ${names.join(', ')}`;
            messages.push({ role: 'shelector', text: `${actionText}.` });
          }
        } else if (a.kind === 'DeclareBlockers') {
          if (a.blocks.length > 0) {
            actionText = `Blocked with ${a.blocks.length} creature(s)`;
            messages.push({ role: 'shelector', text: `${actionText}.` });
          }
        } else if (a.kind === 'ActivateAbility') {
          const inst = state.cards.get(a.cardInstanceId);
          const def = inst ? state.cardDefinitions.get(inst.definitionId) : undefined;
          actionText = `Activated ${def?.name || 'an ability'}`;
          messages.push({ role: 'shelector', text: `${actionText}.` });
          rememberLastPlayedCard(state, a.cardInstanceId, inst?.ownerId || aiIdsRef.current[0], 'Activated');
        }

        if (actionText) {
          logEntries.push(captureLogEntry(
            state, humanIdRef.current, aiIdsRef.current,
            'ai', actionText, manaSpent,
          ));
        }
      }
    },
    [rememberLastPlayedCard],
  );

  /**
   * Run state-based actions, then move any pending triggers onto the stack.
   * Returns the updated state. This is the standard MTG post-action check:
   * SBAs first (creatures die, legend rule, etc.), then triggers queue up.
   */
  const queueHumanOptionalTriggerChoice = useCallback((current: GameState): boolean => {
    const trigger = current.pendingTriggers.find(candidate =>
      candidate.controllerId === humanIdRef.current && candidate.ability.optional === true);
    if (!trigger) {
      optionalTriggerPromptRequestRef.current = null;
      setOptionalTriggerChoice(null);
      return false;
    }

    const sourceCard = current.cards.get(trigger.sourceInstanceId);
    const sourceDef = sourceCard ? current.cardDefinitions.get(sourceCard.definitionId) : undefined;
    const request = createOptionalTriggerPromptRequest(current, humanIdRef.current, trigger.id);
    optionalTriggerPromptRequestRef.current = request;
    setOptionalTriggerChoice({
      id: request.id,
      triggerId: trigger.id,
      sourceName: request.sourceName || sourceDef?.name || 'Triggered ability',
      triggerKind: request.triggerKind || trigger.ability.trigger.kind,
      title: `${request.sourceName || sourceDef?.name || 'Triggered ability'} trigger`,
    });
    return true;
  }, []);

  const queueHumanDamageAssignmentChoice = useCallback((current: GameState): boolean => {
    if (current.step !== 'combat_damage' || !current.combat || current.combat.attackers.length === 0) {
      damageAssignmentPromptRequestRef.current = null;
      setDamageAssignmentChoice(null);
      return false;
    }

    const request = createDamageAssignmentPromptRequest(current, humanIdRef.current);
    const unresolvedGroups = request.groups.filter(group => {
      const existingOrder = current.combat?.blockerOrder?.[group.attackerId];
      return group.blockers.length > 1
        && (!existingOrder || existingOrder.length !== group.blockers.length);
    });
    if (unresolvedGroups.length === 0) {
      damageAssignmentPromptRequestRef.current = null;
      setDamageAssignmentChoice(null);
      return false;
    }

    damageAssignmentPromptRequestRef.current = {
      ...request,
      groups: unresolvedGroups,
    };
    setDamageAssignmentChoice({
      id: request.id,
      title: 'Assign combat damage',
      groups: unresolvedGroups,
    });
    return true;
  }, []);

  const queueHumanTriggerOrderChoice = useCallback((current: GameState): boolean => {
    if (current.pendingTriggers.length < 2) {
      triggerOrderPromptRequestRef.current = null;
      setTriggerOrderChoice(null);
      return false;
    }

    const allHumanControlled = current.pendingTriggers.every(trigger => trigger.controllerId === humanIdRef.current);
    if (!allHumanControlled) {
      triggerOrderPromptRequestRef.current = null;
      setTriggerOrderChoice(null);
      return false;
    }

    const request = createOrderTriggersPromptRequest(current, humanIdRef.current);
    if (request.triggers.length < 2) {
      triggerOrderPromptRequestRef.current = null;
      setTriggerOrderChoice(null);
      return false;
    }

    triggerOrderPromptRequestRef.current = request;
    setTriggerOrderChoice({
      id: request.id,
      title: 'Order triggered abilities',
      triggers: request.triggers.map(trigger => ({
        triggerId: trigger.triggerId,
        sourceName: trigger.sourceName,
        triggerKind: trigger.triggerKind,
      })),
    });
    return true;
  }, []);

  const runSBAAndTriggers = useCallback((s: GameState): GameState => {
    let current = s;
    // SBAs may produce triggers, and resolving triggers may cause more SBAs,
    // so loop until stable (with a safety cap).
    let rounds = 10;
    while (rounds-- > 0) {
      current = checkStateBasedActions(current);
      if (current.pendingTriggers.length > 0) {
        if (queueHumanOptionalTriggerChoice(current)) {
          break;
        }
        if (queueHumanTriggerOrderChoice(current)) {
          break;
        }
        current = putTriggersOnStack(current);
        // New stack items mean we should check SBAs again after they resolve,
        // but we don't resolve here — the main loop handles that.
        break;
      }
      // No pending triggers and SBAs didn't change anything — stable.
      break;
    }
    return current;
  }, [queueHumanOptionalTriggerChoice, queueHumanTriggerOrderChoice]);

  /**
   * Check if the top of the stack is a "tax" triggered ability (Rhystic Study,
   * Smothering Tithe, Mystic Remora, etc.) and handle the payment choice.
   *
   * Returns { state, handled, messages } — if handled is true, the trigger was
   * resolved (or skipped due to payment) and shouldn't be resolved again.
   */
  const resolveTaxTrigger = useCallback(
    (
      state: GameState,
      messages: { role: ChatMessage['role']; text: string }[],
    ): { state: GameState; handled: boolean } => {
      if (state.stack.length === 0) return { state, handled: false };

      const top = state.stack[state.stack.length - 1];
      if (!isTriggeredAbilityStackItem(top)) return { state, handled: false };
      const triggerItem = top as TriggeredAbilityStackItem;

      // Check if the source card has a cached unlessTax ability
      const sourceCard = state.cards.get(triggerItem.sourceInstanceId);
      if (!sourceCard) return { state, handled: false };
      const sourceDef = state.cardDefinitions.get(sourceCard.definitionId);
      if (!sourceDef?.unlessTax) return { state, handled: false };

      const taxInfo = sourceDef.unlessTax;

      // Who cast the spell that triggered this?
      const casterId = triggerItem.eventContext?.casterId;
      if (!casterId) {
        // No context — just resolve normally
        return { state, handled: false };
      }

      const caster = state.players.find(p => p.id === casterId);
      if (!caster) return { state, handled: false };

      const controllerId = triggerItem.controllerId;
      const controllerName = controllerId === humanIdRef.current
        ? 'You'
        : aiCommanderNamesRef.current[controllerId] || controllerId;
      const casterName = casterId === humanIdRef.current
        ? 'You'
        : aiCommanderNamesRef.current[casterId] || casterId;

      // Determine if the caster pays
      const totalMana = Object.values(caster.manaPool).reduce((a, b) => a + b, 0);
      let pays = false;

      if (aiIdsRef.current.includes(casterId)) {
        // AI decision: pay if they have enough mana and it's worth it
        pays = totalMana >= taxInfo.taxAmount;
      } else {
        // Human caster: for now, auto-decide based on available mana
        // (TODO: prompt the human with a choice UI)
        pays = totalMana >= taxInfo.taxAmount;
      }

      // Remove the trigger from the stack
      const newStack = state.stack.slice(0, -1);
      let newState: GameState = {
        ...state,
        stack: newStack,
        hasPriorityPassed: new Array(state.players.length).fill(false),
        priorityPlayerIndex: state.activePlayerIndex,
      };

      if (pays) {
        // Deduct mana from caster
        const casterIdx = newState.players.findIndex(p => p.id === casterId);
        let remaining = taxInfo.taxAmount;
        const newPool = { ...caster.manaPool };
        // Pay from colorless first, then any color
        for (const color of ['C', 'W', 'U', 'B', 'R', 'G'] as const) {
          const deduct = Math.min(newPool[color], remaining);
          newPool[color] -= deduct;
          remaining -= deduct;
          if (remaining <= 0) break;
        }
        const newPlayers = newState.players.map((p, i) =>
          i === casterIdx ? { ...p, manaPool: newPool } : p
        );
        newState = { ...newState, players: newPlayers };

        messages.push({
          role: 'system',
          text: `${sourceDef.name}: ${casterName} paid {${taxInfo.taxAmount}} — no effect.`,
        });
      } else {
        // Effect happens — draw card or create treasure
        const drawCount = taxInfo.effectCount ?? 1;
        if (taxInfo.effect === 'draw') {
          newState = drawCards(newState, controllerId, drawCount);
          messages.push({
            role: controllerId === humanIdRef.current ? 'system' : 'shelector',
            text: `${sourceDef.name}: ${casterName} didn't pay {${taxInfo.taxAmount}} — ${controllerName === 'You' ? 'you draw' : controllerName + ' draws'} ${drawCount}.`,
          });
        } else if (taxInfo.effect === 'treasure') {
          // Simplified: create Treasure token(s)
          // Full implementation would create actual Treasure tokens
          messages.push({
            role: controllerId === humanIdRef.current ? 'system' : 'shelector',
            text: `${sourceDef.name}: ${casterName} didn't pay {${taxInfo.taxAmount}} — Treasure token created.`,
          });
        }
      }

      return { state: recordSystemStateTransition(state, newState), handled: true };
    },
    [recordSystemStateTransition],
  );

  /**
   * Core game loop: follows the proven pattern from the integration test.
   *
   * Steps through the turn structure while routing player priority passes
   * through the authority layer so auto-passes are visible in the same update
   * feed as normal UI actions.
   */
  const advanceGameLoop = useCallback(
    (currentState: GameState, messages: { role: ChatMessage['role']; text: string }[], logEntries: GameLogEntry[]): GameState => {
      let state = currentState;
      let safety = 200;

      // Run SBAs + triggers on entry (the action that preceded advanceGameLoop
      // may have caused creatures to die, etc.)
      const checkGameOver = (s: GameState): boolean => {
        const humanDead = s.players.find(p => p.id === humanIdRef.current)?.hasLost;
        const allAIDead = aiIdsRef.current.every(id => {
          const p = s.players.find(pl => pl.id === id);
          return p?.hasLost;
        });
        if (humanDead) messages.push({ role: 'system', text: 'You have been defeated!' });
        else if (allAIDead) messages.push({ role: 'system', text: 'Victory! You won the game!' });
        return !!(humanDead || allAIDead);
      };

      /** Check if top of stack is a human spell with searchAbility — show card picker */
      /** Check if top of stack has a search effect from the human — show card picker */
      const applyValidatedLoopAction = (
        s: GameState,
        playerId: string,
        action: AIAction,
        source: 'ai' | 'system' = 'ai',
      ): { state: GameState; events: ActionGameEvent[]; simpleAction: SimpleLegalAction } | null => {
        const simpleAction = toSimpleLegalAction(action, s);
        const response = applyActionThroughAuthority(s, playerId, action, {
          source,
          label: simpleAction.label,
        });
        if (!response.ok || !response.state) {
          const playerName = s.players.find(player => player.id === playerId)?.name || playerId;
          messages.push({
            role: 'system',
            text: `${playerName} action rejected: ${response.message || 'illegal action'}`,
          });
          return null;
        }
        return {
          state: response.state,
          events: response.events || [],
          simpleAction,
        };
      };

      const passPriorityThroughAuthority = (
        s: GameState,
        playerId: string,
        source: 'ai' | 'system' = 'system',
      ): GameState => {
        const applied = applyValidatedLoopAction(s, playerId, { kind: 'PassPriority' }, source);
        return applied?.state || s;
      };

      const tryResolveTutor = (): boolean => {
        if (state.stack.length === 0) return false;
        const top = state.stack[state.stack.length - 1];
        if (!top) return false;

        // Determine if this is a human-controlled search effect
        let controllerId: string | undefined;
        let sourceName = 'Search';
        let sourceInstanceId: string | undefined;
        let searchInfo: StackSearchInfo | undefined;

        if (top.kind === 'Spell' && top.casterId === humanIdRef.current) {
          // Spell with search (Demonic Tutor, etc.)
          controllerId = top.casterId;
          sourceInstanceId = top.cardInstanceId;
          const tc = state.cards.get(top.cardInstanceId);
          const td = tc ? state.cardDefinitions.get(tc.definitionId) : undefined;
          sourceName = td?.name || sourceName;
          const effectSearch = searchInfoFromEffects(spellEffectsForChoicePrompt(state, top), state, top.cardInstanceId);
          if (effectSearch) {
            searchInfo = effectSearch;
          } else if (td?.searchAbility && !definitionLooksPermanent(td)) {
            const ability = td.searchAbility as {
              filter?: string;
              destination: SearchDestination;
              tapped?: boolean;
              shuffle: boolean;
              count?: number;
            };
            searchInfo = ability;
          }
        } else if (top.kind === 'ActivatedAbility' && top.controllerId === humanIdRef.current) {
          // Activated ability with search (fetch lands, Sakura-Tribe Elder, etc.)
          controllerId = top.controllerId;
          sourceInstanceId = top.sourceInstanceId;
          const sourceCard = state.cards.get(top.sourceInstanceId);
          const sourceDef = sourceCard ? state.cardDefinitions.get(sourceCard.definitionId) : undefined;
          sourceName = sourceDef?.name || sourceName;
          // Prefer the actual stack ability effects. Cached searchAbility is a
          // coarse card-level hint and can lose subtype filters such as
          // "Mountain or Plains" on typed fetch lands.
          if (top.ability) {
            const effectSearch = searchInfoFromEffects(top.ability.effects, state, top.sourceInstanceId);
            if (effectSearch) {
              searchInfo = effectSearch;
            }
          }
          if (!searchInfo && sourceDef?.searchAbility) {
            const ability = sourceDef.searchAbility as {
              filter?: string;
              destination: SearchDestination;
              tapped?: boolean;
              shuffle: boolean;
              count?: number;
            };
            searchInfo = ability;
          }
        }

        if (!controllerId || !searchInfo) return false;
        const resolvedSearch = resolveTopStackSearchPrompt(state, {
          id: `search-${top.id}`,
          playerId: humanIdRef.current,
          revealPolicy: searchInfo.filter || searchInfo.filterSpec ? 'reveal' : 'hidden',
          minSelections: 0,
          maxSelections: 1,
        });
        if (!resolvedSearch.ok) {
          messages.push({ role: 'system', text: resolvedSearch.message });
          return false;
        }

        const search = {
          ...searchInfo,
          destination: resolvedSearch.request.destination,
          tapped: resolvedSearch.request.tapped,
          shuffle: resolvedSearch.request.shuffle,
        };
        state = resolvedSearch.state;
        engineRef.current = state as GameStateWithAI;
        recordAuthorityUpdate(resolvedSearch.update);
        const promptRequest = resolvedSearch.request;
        const pickerMetadata = searchPickerMetadata(search);
        const pickerCards = [...promptRequest.legalChoices, ...promptRequest.invalidChoices]
          .map((choice): TutorCardOption | null => {
            const c = state.cards.get(choice.cardInstanceId);
            if (!c) return null;
            const d = getCardDefinition(state, c);
            return {
              instanceId: c.instanceId,
              name: d.name,
              typeLine: d.type_line,
              manaCost: d.mana_cost,
              oracleText: d.oracle_text,
              colors: d.colors,
              cmc: d.cmc,
              ...pickerMetadata,
              legal: choice.legal,
              reason: choice.legal ? pickerMetadata.reason : choice.reason,
              destination: choice.destination,
            };
          })
          .filter((option): option is TutorCardOption => Boolean(option));

        tutorDestinationRef.current = search.destination;
        tutorFilterSpecRef.current = search.filterSpec;
        tutorTappedRef.current = !!search.tapped;
        tutorShuffleRef.current = search.shuffle;
        // For "up to N" searches: track how many additional picks remain after this one.
        const totalCount = Math.max(1, search.count ?? 1);
        tutorRemainingRef.current = totalCount - 1;
        tutorFilterRef.current = search.filter;
        tutorSourceNameRef.current = sourceName;
        tutorSourceInstanceIdRef.current = sourceInstanceId;
        tutorPromptRequestRef.current = promptRequest;
        const filterDesc = search.filter ? ` for ${search.filter}` : '';
        const countSuffix = totalCount > 1 ? ` (pick 1 of up to ${totalCount})` : '';
        setTutorTitle(`${sourceName}: Search your library${filterDesc}${countSuffix}`);
        setTutorCards(pickerCards);
        setTutorPhase(true);
        messages.push({ role: 'system', text: `${sourceName} — search your library${filterDesc}${countSuffix}.` });
        return true;
      };

      const tryPauseForLibraryChoice = (): boolean => {
        if (state.stack.length === 0) return false;
        const top = state.stack[state.stack.length - 1] as StackItem & { namedCardChoices?: Record<string, string> };
        if (!top) return false;

        let controllerId: string | undefined;
        let sourceName = 'Library choice';
        let sourceInstanceId: string | undefined;
        let effects: unknown[] | undefined;

        if (top.kind === 'Spell') {
          controllerId = top.casterId;
          sourceInstanceId = top.cardInstanceId;
          const spellCard = state.cards.get(top.cardInstanceId);
          const spellDef = spellCard ? state.cardDefinitions.get(spellCard.definitionId) : undefined;
          sourceName = spellDef?.name || sourceName;
          effects = spellEffectsForChoicePrompt(state, top);
        } else if (top.kind === 'ActivatedAbility') {
          controllerId = top.controllerId;
          sourceInstanceId = top.sourceInstanceId;
          const sourceCard = state.cards.get(top.sourceInstanceId);
          const sourceDef = sourceCard ? state.cardDefinitions.get(sourceCard.definitionId) : undefined;
          sourceName = sourceDef?.name || sourceName;
          effects = top.ability.effects;
        } else if (top.kind === 'TriggeredAbility') {
          controllerId = top.controllerId;
          sourceInstanceId = top.sourceInstanceId;
          const sourceCard = state.cards.get(top.sourceInstanceId);
          const sourceDef = sourceCard ? state.cardDefinitions.get(sourceCard.definitionId) : undefined;
          sourceName = sourceDef?.name || sourceName;
          effects = top.ability.effects;
        }

        if (controllerId !== humanIdRef.current) return false;
        const info = libraryChoiceInfoFromEffects(effects);
        if (!info || info.count <= 0) return false;
        if (top.namedCardChoices?.[`${info.mode}TopIds`]) return false;

        const promptRequest = createLibraryManipulationPromptRequest(
          state,
          humanIdRef.current,
          info.mode,
          info.count,
          {
            sourceInstanceId,
            stackItemId: top.id,
          },
        );
        if (promptRequest.legalChoices.length === 0) return false;
        const cards = promptRequest.legalChoices
          .map(choice => state.cards.get(choice.cardInstanceId))
          .filter((card): card is CardInstance => Boolean(card))
          .map(card => toTutorCardOption(state, card))
          .filter((option): option is TutorCardOption => !!option);
        if (cards.length === 0) return false;

        engineRef.current = state as GameStateWithAI;
        pendingLibraryChoiceRef.current = { stackItemId: top.id, mode: info.mode };
        libraryManipulationPromptRequestRef.current = promptRequest;
        setLibraryChoice({
          id: `${top.id}:${info.mode}:${cards.map(card => card.instanceId).join('|')}`,
          mode: info.mode,
          title: `${sourceName}: ${info.mode === 'scry' ? 'Scry' : 'Surveil'} ${cards.length}`,
          cards,
        });
        messages.push({ role: 'system', text: `${sourceName} - choose cards for ${info.mode}.` });
        return true;
      };

      const allPlayersHavePassed = (s: GameState): boolean =>
        s.hasPriorityPassed.every((passed, index) => passed || s.players[index].hasLost);

      const humanHasPriority = (s: GameState): boolean => {
        const humanIndex = s.players.findIndex(p => p.id === humanIdRef.current);
        return humanIndex >= 0
          && s.priorityPlayerIndex === humanIndex
          && !s.hasPriorityPassed[humanIndex];
      };

      const shouldPauseForHumanPriority = (s: GameState): boolean => {
        if (s.stack.length === 0) return false;
        if (holdPriorityRef.current && controllerIdForStackItem(s.stack[s.stack.length - 1]) === humanIdRef.current) {
          return true;
        }
        // Main phases and attack/block choices are handled by their own
        // branches. Generic priority windows should only pause when the human
        // has an actual decision; empty upkeep/draw/opponent-turn windows can
        // safely pass without forcing extra clicks.
        return hasMeaningfulHumanActionForAutoSkip(s, humanIdRef.current);
      };

      const passUntilHumanOrAllPassed = (s: GameState): { state: GameState; pause: boolean } => {
        let next = s;
        let guard = next.players.length + 1;
        while (!allPlayersHavePassed(next) && guard-- > 0) {
          if (humanHasPriority(next)) {
            if (shouldPauseForHumanPriority(next)) {
              return { state: next, pause: true };
            }
            next = passPriorityThroughAuthority(next, humanIdRef.current, 'system');
            continue;
          }
          const priorityPlayer = next.players[next.priorityPlayerIndex];
          if (!priorityPlayer) break;
          next = passPriorityThroughAuthority(
            next,
            priorityPlayer.id,
            aiIdsRef.current.includes(priorityPlayer.id) ? 'ai' : 'system',
          );
        }
        return { state: next, pause: false };
      };

      const stepKey = (s: GameState, suffix: string): string =>
        `${s.turnNumber}:${s.activePlayerIndex}:${s.step}:${suffix}`;

      state = runSBAAndTriggers(state);
      if (optionalTriggerPromptRequestRef.current || triggerOrderPromptRequestRef.current) return state;
      if (checkGameOver(state)) return state;

      while (safety-- > 0) {
        if (optionalTriggerPromptRequestRef.current || triggerOrderPromptRequestRef.current) break;
        // Check game over: human lost, or all AIs lost
        const humanLostCheck = state.players.find(p => p.id === humanIdRef.current)?.hasLost;
        const allAIsLostCheck = aiIdsRef.current.every(id => {
          const p = state.players.find(pl => pl.id === id);
          return p?.hasLost;
        });
        if (humanLostCheck || allAIsLostCheck) break;

        console.log(`[LOOP ${200-safety}] step=${state.step} phase=${state.phase} turn=${state.turnNumber} active=${state.players[state.activePlayerIndex]?.id} stack=${state.stack.length}`);

        // Stack resolution with priority passing
        if (state.stack.length > 0) {
          const priorityPlayer = state.players[state.priorityPlayerIndex];

          if (priorityPlayer && priorityPlayer.id === humanIdRef.current) {
            // Surface stack priority only when the human has a real response.
            // Empty response windows on AI turns are auto-passed so the player
            // does not have to click through every opponent phase.
            if (state.hasPriorityPassed.every((p, i) => p || state.players[i].hasLost)) {
              console.log(`  -> all passed, resolving stack (${state.stack.length} items)`);
              if (tryPauseForLibraryChoice()) break;
              if (tryResolveTutor()) break;
              { const taxResult = resolveTaxTrigger(state, messages); if (taxResult.handled) { state = taxResult.state; } else { state = resolveTopOfStackWithAuthority(state); } }
              state = runSBAAndTriggers(state);
              if (checkGameOver(state)) break;
              continue;
            }
            if (!shouldPauseForHumanPriority(state)) {
              state = passPriorityThroughAuthority(state, humanIdRef.current, 'system');
              continue;
            }
            // Wait for an explicit Pass action instead of auto-resolving past real possible responses.
            console.log(`  -> stack has ${state.stack.length} items, human has priority - waiting`);
            break;
          }

          if (priorityPlayer && aiIdsRef.current.includes(priorityPlayer.id)) {
            // AI has priority with items on the stack — let AI decide (may cast instants)
            try {
              const config = createAIConfig(priorityPlayer.id, 3);
              const decision = makeDecision(state, config);

              if (!decision || decision.action.kind === 'PassPriority') {
                // AI passes priority on the stack
                const passResult = applyValidatedLoopAction(state, priorityPlayer.id, { kind: 'PassPriority' }, 'ai');
                state = passResult?.state || state;
                // Check if all players have now passed (stack resolves)
                if (state.hasPriorityPassed.every((p, i) => p || state.players[i].hasLost)) {
                  console.log(`  -> all passed, resolving stack (${state.stack.length} items)`);
                  if (tryPauseForLibraryChoice()) break;
                  if (tryResolveTutor()) break;
                  { const taxResult = resolveTaxTrigger(state, messages); if (taxResult.handled) { state = taxResult.state; } else { state = resolveTopOfStackWithAuthority(state); } }
                  state = runSBAAndTriggers(state);
                  if (checkGameOver(state)) break;
                }
                continue;
              }

              // AI cast something in response — apply it
              const applied = applyValidatedLoopAction(state, priorityPlayer.id, decision.action, 'ai');
              if (!applied) {
                state = passPriorityThroughAuthority(state, priorityPlayer.id, 'ai');
                continue;
              }
              state = applied.state;
              narrateDecisions([decision], state, messages, logEntries);
              state = runSBAAndTriggers(state);
              if (checkGameOver(state)) break;
              // Loop back — the new spell is on top of the stack,
              // priority resets, and we check again
              continue;
            } catch (aiErr: unknown) {
              console.error('AI stack response error:', aiErr);
              if (priorityPlayer) {
                state = passPriorityThroughAuthority(state, priorityPlayer.id, 'ai');
              }
              continue;
            }
          }

          // Fallback: no valid priority player — just resolve
          console.log(`  -> resolving stack (${state.stack.length} items)`);
          if (tryPauseForLibraryChoice()) break;
          if (tryResolveTutor()) break;
          state = resolveTopOfStackWithAuthority(state);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        const activePlayer = state.players[state.activePlayerIndex];
        const activeId = activePlayer.id;
        const isHumanActive = activeId === humanIdRef.current;

        // Step-specific handling
        if (state.step === 'untap') {
          state = performUntapStepWithAuthority(state);
          state = advanceStepWithAuthority(state);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        if (state.step === 'draw') {
          const drawKey = stepKey(state, 'draw');
          if (!stepEffectsDoneRef.current.has(drawKey)) {
            state = drawCardsWithAuthority(state, activeId, 1);
            stepEffectsDoneRef.current.add(drawKey);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
          }

          const priority = passUntilHumanOrAllPassed(state);
          state = priority.state;
          if (priority.pause) break;

          state = advanceStepWithAuthority(state);
          stepEffectsDoneRef.current.delete(drawKey);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        // Main phases (precombat_main or postcombat_main)
        if (state.phase === 'precombat_main' || state.phase === 'postcombat_main') {
          if (isHumanActive) {
            // Check if human already passed priority (from submitAction applying PassPriority through authority)
            const humanIdx = state.players.findIndex(p => p.id === humanIdRef.current);
            const humanAlreadyPassed = humanIdx >= 0 && state.hasPriorityPassed[humanIdx];
            if (!humanAlreadyPassed) {
              // Human hasn't passed yet — break and show UI so they can play cards
              break;
            }
            // Human already passed — auto-pass remaining players and advance
            console.log('  -> human passed main phase, auto-passing remaining');
            let passGuard = state.players.length + 1;
            while (!allPlayersHavePassed(state) && passGuard-- > 0) {
              const priorityPlayer = state.players[state.priorityPlayerIndex];
              if (!priorityPlayer) break;
              state = passPriorityThroughAuthority(
                state,
                priorityPlayer.id,
                aiIdsRef.current.includes(priorityPlayer.id) ? 'ai' : 'system',
              );
            }
            state = advanceStepWithAuthority(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          } else {
            // AI's main phase — make ONE decision at a time so the human
            // can respond to spells with counterspells / instants.
            const currentAiId = activeId;
            try {
              const config = createAIConfig(currentAiId, 3);
              const decision = makeDecision(state, config);

              if (!decision) {
                console.log(`  -> AI (${currentAiId}) main phase: no decision (null)`);
                const priority = passUntilHumanOrAllPassed(state);
                state = priority.state;
                if (priority.pause) break;
                state = advanceStepWithAuthority(state);
                state = runSBAAndTriggers(state);
                if (checkGameOver(state)) break;
                continue;
              }

              const action = decision.action;
              const actionInst = 'cardInstanceId' in action ? state.cards.get(action.cardInstanceId) : undefined;
              const actionDef = actionInst ? state.cardDefinitions.get(actionInst.definitionId) : undefined;
              console.log(`  -> AI main phase: ${action.kind}${actionDef ? ' — ' + actionDef.name : ''}`);

              const applied = applyValidatedLoopAction(state, currentAiId, decision.action, 'ai');
              if (!applied) {
                const priority = passUntilHumanOrAllPassed(state);
                state = priority.state;
                if (priority.pause) break;
                state = advanceStepWithAuthority(state);
                state = runSBAAndTriggers(state);
                if (checkGameOver(state)) break;
                continue;
              }
              state = applied.state;

              // Narrate this single decision
              narrateDecisions([decision], state, messages, logEntries);

              // AI actions may cause creatures to die, ETBs to fire, etc.
              state = runSBAAndTriggers(state);
              if (checkGameOver(state)) break;

              if (action.kind === 'PassPriority') {
                // AI passed — pass remaining players and advance
                const priority = passUntilHumanOrAllPassed(state);
                state = priority.state;
                if (priority.pause) break;
                state = advanceStepWithAuthority(state);
                state = runSBAAndTriggers(state);
                if (checkGameOver(state)) break;
                continue;
              }

              if (action.kind === 'CastSpell' || action.kind === 'ActivateAbility') {
                if (state.stack.length > 0) {
                  const humanIdx = state.players.findIndex(p => p.id === humanIdRef.current);
                  if (humanIdx >= 0) {
                    const spellInst = 'cardInstanceId' in action ? state.cards.get(action.cardInstanceId) : undefined;
                    const spellDef = spellInst ? state.cardDefinitions.get(spellInst.definitionId) : undefined;
                    messages.push({
                      role: 'system',
                      text: `${spellDef?.name || 'A spell or ability'} is on the stack. Inspect it, respond, or pass priority.`,
                    });
                    state = {
                      ...state,
                      priorityPlayerIndex: humanIdx,
                      hasPriorityPassed: state.players.map(() => false),
                    };
                    if (shouldPauseForHumanPriority(state)) {
                      break;
                    }
                    state = passPriorityThroughAuthority(state, humanIdRef.current, 'system');
                    continue;
                  }
                }
              }

              // For non-spell actions (PlayLand, ActivateManaAbility, DeclareAttackers, etc.)
              // continue the loop to let the AI keep going
              continue;
            } catch (aiErr: unknown) {
              console.error(`AI (${currentAiId}) turn error:`, aiErr);
              messages.push({
                role: 'system',
                text: `AI error: ${aiErr instanceof Error ? aiErr.message : 'unknown'}`,
              });
              // On error, pass through to advance
              const priority = passUntilHumanOrAllPassed(state);
              state = priority.state;
              if (priority.pause) break;
              state = advanceStepWithAuthority(state);
              state = runSBAAndTriggers(state);
              if (checkGameOver(state)) break;
              continue;
            }
          }
        }

        // Combat steps
        if (
          state.step === 'begin_combat' ||
          state.step === 'declare_attackers' ||
          state.step === 'declare_blockers' ||
          state.step === 'first_strike_damage' ||
          state.step === 'combat_damage' ||
          state.step === 'end_of_combat'
        ) {
          if (state.step === 'begin_combat') {
            const priority = passUntilHumanOrAllPassed(state);
            state = priority.state;
            if (priority.pause) break;
            state = advanceStepWithAuthority(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          }

          // declare_attackers: let human choose or auto-skip
          if (state.step === 'declare_attackers') {
            // If combat is already populated (human just declared attackers via submitAction),
            // skip re-prompting and re-declaring — that would overwrite the attacker list with [].
            const alreadyDeclared = !!(state.combat && state.combat.attackers.length > 0);
            if (isHumanActive && !alreadyDeclared) {
              const actions = getLegalActions(state, humanIdRef.current);
              const hasRealAttacks = actions.some(
                a => a.kind === 'DeclareAttackers' && a.attacks.length > 0,
              );
              if (hasRealAttacks) {
                break; // Show attack UI to human
              }
              // No creatures to attack with — declare empty attackers through authority.
              const emptyAttack = actions.find(a => a.kind === 'DeclareAttackers' && a.attacks.length === 0);
              if (emptyAttack) {
                const applied = applyValidatedLoopAction(state, humanIdRef.current, emptyAttack, 'system');
                if (applied) {
                  state = applied.state;
                } else {
                  break;
                }
              }
            } else if (!isHumanActive) {
              // AI declares attackers
              try {
                const config = createAIConfig(activeId, 3);
                const decision = makeDecision(state, config);
                if (decision && decision.action.kind === 'DeclareAttackers' && decision.action.attacks.length > 0) {
                  const applied = applyValidatedLoopAction(state, activeId, decision.action, 'ai');
                  if (applied) {
                    state = applied.state;
                    narrateDecisions([decision], state, messages, logEntries);
                    state = runSBAAndTriggers(state);
                    if (checkGameOver(state)) break;
                  }
                }
              } catch (aiErr: unknown) {
                console.error('AI attack declaration error:', aiErr);
              }
            }
            const priority = passUntilHumanOrAllPassed(state);
            state = priority.state;
            if (priority.pause) break;
            state = advanceStepWithAuthority(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          }

          // declare_blockers: let the human block when they are a defender; AI defaults to no blocks.
          if (state.step === 'declare_blockers') {
            let pauseForHumanBlockers = false;
            if (state.combat && state.combat.attackers.length > 0) {
              // There are attackers — each non-active player needs to declare blockers
              // In multiplayer, each defender gets a chance
              const activeId2 = state.players[state.activePlayerIndex].id;
              const defenders = state.players
                .filter(p => p.id !== activeId2 && !p.hasLost)
                .map(p => p.id);
              for (const defenderId of defenders) {
                const blockActions = getLegalActions(state, defenderId);
                if (defenderId === humanIdRef.current) {
                  const hasBlocks = blockActions.some(
                    a => a.kind === 'DeclareBlockers' && a.blocks.length > 0,
                  );
                  if (hasBlocks) {
                    pauseForHumanBlockers = true;
                    break;
                  }
                }
                const noBlock = blockActions.find(a => a.kind === 'DeclareBlockers' && a.blocks.length === 0);
                if (noBlock) {
                  const applied = applyValidatedLoopAction(state, defenderId, noBlock, 'system');
                  if (applied) {
                    state = applied.state;
                  }
                }
              }
            }
            if (pauseForHumanBlockers) break;
            const priority = passUntilHumanOrAllPassed(state);
            state = priority.state;
            if (priority.pause) break;
            state = advanceStepWithAuthority(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          }

          // combat_damage: resolve damage if attackers exist
          if (state.step === 'combat_damage') {
            if (state.combat && state.combat.attackers.length > 0) {
              if (queueHumanDamageAssignmentChoice(state)) {
                break;
              }
              try {
                state = resolveCombatDamageWithAuthority(state);
                console.log('  -> resolved combat damage');
                // Combat damage may kill creatures — check SBAs and triggers
                state = runSBAAndTriggers(state);
                for (const p of state.players) {
                  const name = p.id === humanIdRef.current ? 'You' : (aiCommanderNamesRef.current[p.id] || p.id);
                  if (p.hasLost) {
                    messages.push({ role: 'system', text: `${name} ${p.id === humanIdRef.current ? 'have' : 'has'} been eliminated! (Life: ${p.life})` });
                  } else if (p.life < 40) {
                    messages.push({ role: 'system', text: `${name}: Life ${p.life}` });
                  }
                }
                if (checkGameOver(state)) break;
              } catch (e) {
                console.error('Combat damage error:', e);
              }
            }
            const priority = passUntilHumanOrAllPassed(state);
            state = priority.state;
            if (priority.pause) break;
            state = advanceStepWithAuthority(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            continue;
          }

          const priority = passUntilHumanOrAllPassed(state);
          state = priority.state;
          if (priority.pause) break;
          state = advanceStepWithAuthority(state);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        // Upkeep, end step, cleanup — pass through
        if (state.step === 'upkeep' || state.step === 'end' || state.step === 'cleanup') {
          if (state.step === 'cleanup') {
            // Discard to hand size (max 7) for the active player
            const activePlayer = state.players[state.activePlayerIndex];
            const activeId = activePlayer.id;
            const handCards = getCardsInZone(state, activeId, 'hand');

            if (handCards.length > 7) {
              const excess = handCards.length - 7;

              if (activeId === humanIdRef.current) {
                // Human must choose which cards to discard — pause the loop
                discardCountRef.current = excess;
                setDiscardCount(excess);
                setDiscardPhase(true);
                messages.push({
                  role: 'system',
                  text: `Discard ${excess} card${excess > 1 ? 's' : ''} to hand size (7).`,
                });
                break;
              } else {
                // AI auto-discards: drop highest-CMC non-land cards first
                const sorted = [...handCards].sort((a, b) => {
                  const defA = getCardDefinition(state, a);
                  const defB = getCardDefinition(state, b);
                  return defB.cmc - defA.cmc; // highest CMC first
                });
                const toDiscard = sorted.slice(0, excess);
                if (toDiscard.length > 0) {
                  const discardRequest = createSelectCardsPromptRequest(state, activeId, {
                    subject: 'DiscardToHandSize',
                    zone: 'hand',
                    destination: 'graveyard',
                    minSelections: toDiscard.length,
                    maxSelections: toDiscard.length,
                  });
                  const discardResponse = applySelectCardsPromptResponse(state, discardRequest, {
                    requestId: discardRequest.id,
                    kind: 'SelectCards',
                    playerId: activeId,
                    selectedCardInstanceIds: toDiscard.map(card => card.instanceId),
                  });
                  recordAuthorityUpdate(discardResponse.update);
                  if (!discardResponse.ok || !discardResponse.state) {
                    messages.push({
                      role: 'system',
                      text: discardResponse.message || `${activePlayer.name} could not discard to hand size.`,
                    });
                    break;
                  }
                  state = discardResponse.state;
                  for (const card of toDiscard) {
                    const def = getCardDefinition(state, card);
                    messages.push({ role: 'shelector', text: `Discarded ${def.name}.` });
                  }
                }
              }
            }

            const oldTurn = state.turnNumber;
            state = advanceStepWithAuthority(state);
            state = runSBAAndTriggers(state);
            if (checkGameOver(state)) break;
            if (state.turnNumber !== oldTurn) {
              uncommittedTapsRef.current.clear(); // New turn — reset tap tracking
              stepEffectsDoneRef.current.clear();
              const newActive = state.players[state.activePlayerIndex];
              const isNewActiveHuman = newActive.id === humanIdRef.current;
              const activeName = isNewActiveHuman
                ? 'Your'
                : `${aiCommanderNamesRef.current[newActive.id] || newActive.id}'s`;
              messages.push({
                role: 'system',
                text: `Turn ${publicTurnNumber(state.turnNumber, state.players.length)} \u2014 ${activeName} turn.`,
              });
            }
            continue;
          }
          const priority = passUntilHumanOrAllPassed(state);
          state = priority.state;
          if (priority.pause) break;
          state = advanceStepWithAuthority(state);
          state = runSBAAndTriggers(state);
          if (checkGameOver(state)) break;
          continue;
        }

        // Fallback — pass through
        const priority = passUntilHumanOrAllPassed(state);
        state = priority.state;
        if (priority.pause) break;
        state = advanceStepWithAuthority(state);
        state = runSBAAndTriggers(state);
        if (checkGameOver(state)) break;
        continue;
      }

      return state;
    },
    [
      advanceStepWithAuthority,
      applyActionThroughAuthority,
      drawCardsWithAuthority,
      narrateDecisions,
      performUntapStepWithAuthority,
      queueHumanDamageAssignmentChoice,
      recordAuthorityUpdate,
      resolveCombatDamageWithAuthority,
      resolveTaxTrigger,
      resolveTopOfStackWithAuthority,
      runSBAAndTriggers,
    ],
  );

  const resolveLibraryChoice = useCallback((topIds: string[], movedIds: string[]) => {
    const engine = engineRef.current;
    const pending = pendingLibraryChoiceRef.current;
    if (!engine || !pending || engine.stack.length === 0) {
      setLibraryChoice(null);
      pendingLibraryChoiceRef.current = null;
      libraryManipulationPromptRequestRef.current = null;
      syncState();
      return;
    }

    const top = engine.stack[engine.stack.length - 1] as StackItem & { namedCardChoices?: Record<string, string> };
    if (!top || top.id !== pending.stackItemId) {
      setLibraryChoice(null);
      pendingLibraryChoiceRef.current = null;
      libraryManipulationPromptRequestRef.current = null;
      syncState();
      return;
    }

    const promptRequest = libraryManipulationPromptRequestRef.current;
    if (!promptRequest) {
      addMessage('system', `Could not resolve ${pending.mode}: missing engine prompt.`);
      syncState();
      return;
    }

    const promptResponse = applyLibraryManipulationPromptResponse(engine, promptRequest, {
      requestId: promptRequest.id,
      kind: 'LibraryManipulation',
      playerId: humanIdRef.current,
      topCardInstanceIds: topIds,
      movedCardInstanceIds: movedIds,
    });
    recordAuthorityUpdate(promptResponse.update);
    if (!promptResponse.ok || !promptResponse.libraryManipulationChoices) {
      addMessage('system', promptResponse.message || `Could not resolve ${pending.mode}: choose each revealed card exactly once.`);
      syncState();
      return;
    }

    const namedCardChoices: Record<string, string> = {
      ...(top.namedCardChoices || {}),
      ...promptResponse.libraryManipulationChoices,
    };
    const stack = [
      ...engine.stack.slice(0, -1),
      { ...top, namedCardChoices } as StackItem,
    ];
    let state: GameState = { ...engine, stack };

    setLibraryChoice(null);
    pendingLibraryChoiceRef.current = null;
    libraryManipulationPromptRequestRef.current = null;

    state = resolveTopOfStackWithAuthority(state);
    state = runSBAAndTriggers(state);

    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    state = advanceGameLoop(state, loopMessages, loopLogEntries);

    engineRef.current = state as GameStateWithAI;
    addMessage('player', `Resolved ${pending.mode} choice.`);
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);
    syncState();
  }, [addMessage, advanceGameLoop, recordAuthorityUpdate, resolveTopOfStackWithAuthority, runSBAAndTriggers, syncState]);

  const resolveOptionalTriggerChoice = useCallback((use: boolean) => {
    const engine = engineRef.current;
    const promptRequest = optionalTriggerPromptRequestRef.current;
    if (!engine || !promptRequest) {
      optionalTriggerPromptRequestRef.current = null;
      setOptionalTriggerChoice(null);
      syncState();
      return;
    }

    const promptResponse = applyOptionalTriggerPromptResponse(engine, promptRequest, {
      requestId: promptRequest.id,
      kind: 'OptionalTrigger',
      playerId: humanIdRef.current,
      triggerId: promptRequest.triggerId,
      use,
    });
    recordAuthorityUpdate(promptResponse.update);
    if (!promptResponse.ok || !promptResponse.state) {
      addMessage('system', promptResponse.message || 'Could not resolve optional trigger choice.');
      syncState();
      return;
    }

    optionalTriggerPromptRequestRef.current = null;
    setOptionalTriggerChoice(null);

    let state = promptResponse.state as GameStateWithAI;
    if (!use) {
      state = runSBAAndTriggers(state) as GameStateWithAI;
    }

    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    state = advanceGameLoop(state, loopMessages, loopLogEntries) as GameStateWithAI;

    engineRef.current = state;
    addMessage('player', `${use ? 'Used' : 'Declined'} ${promptRequest.sourceName || 'optional trigger'}.`);
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);
    syncState();
  }, [addMessage, advanceGameLoop, recordAuthorityUpdate, runSBAAndTriggers, syncState]);

  const resolveDamageAssignmentChoice = useCallback((orders: DamageAssignmentOrder[]) => {
    const engine = engineRef.current;
    const promptRequest = damageAssignmentPromptRequestRef.current;
    if (!engine || !promptRequest) {
      damageAssignmentPromptRequestRef.current = null;
      setDamageAssignmentChoice(null);
      syncState();
      return;
    }

    const promptResponse = applyDamageAssignmentPromptResponse(engine, promptRequest, {
      requestId: promptRequest.id,
      kind: 'DamageAssignment',
      playerId: humanIdRef.current,
      orders,
    });
    recordAuthorityUpdate(promptResponse.update);
    if (!promptResponse.ok || !promptResponse.state) {
      addMessage('system', promptResponse.message || 'Could not apply combat damage order.');
      syncState();
      return;
    }

    damageAssignmentPromptRequestRef.current = null;
    setDamageAssignmentChoice(null);

    let state = promptResponse.state as GameStateWithAI;
    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    state = advanceGameLoop(state, loopMessages, loopLogEntries) as GameStateWithAI;

    engineRef.current = state;
    addMessage('player', 'Set combat damage order.');
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);
    syncState();
  }, [addMessage, advanceGameLoop, recordAuthorityUpdate, syncState]);

  const resolveTriggerOrderChoice = useCallback((orderedTriggerIds: string[]) => {
    const engine = engineRef.current;
    const promptRequest = triggerOrderPromptRequestRef.current;
    if (!engine || !promptRequest) {
      triggerOrderPromptRequestRef.current = null;
      setTriggerOrderChoice(null);
      syncState();
      return;
    }

    const promptResponse = applyOrderTriggersPromptResponse(engine, promptRequest, {
      requestId: promptRequest.id,
      kind: 'OrderTriggers',
      playerId: humanIdRef.current,
      orderedTriggerIds,
    });
    recordAuthorityUpdate(promptResponse.update);
    if (!promptResponse.ok || !promptResponse.state) {
      addMessage('system', promptResponse.message || 'Could not apply trigger order.');
      syncState();
      return;
    }

    triggerOrderPromptRequestRef.current = null;
    setTriggerOrderChoice(null);

    let state = promptResponse.state as GameStateWithAI;
    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    state = advanceGameLoop(state, loopMessages, loopLogEntries) as GameStateWithAI;

    engineRef.current = state;
    addMessage('player', 'Ordered triggered abilities.');
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);
    syncState();
  }, [addMessage, advanceGameLoop, recordAuthorityUpdate, syncState]);

  // Spawn opponent via the Shelector API
  const spawnOpponent = useCallback(async (options?: SpawnOptions) => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = {
        bracket: options?.bracket ?? 3,
        avoid_colors: options?.avoid_colors ?? [],
        mode: options?.mode ?? 'random',
        human_commander: options?.human_commander ?? null,
        human_colors: options?.human_colors ?? null,
      };
      const res = await fetch(shelectorApiUrl('/spawn-opponent'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Spawn failed: ${res.status}`);
      const data = await res.json();
      setOpponentInfo({
        commander: data.commander || 'Unknown Commander',
        colors: data.colors || [],
        strategy: data.strategy || 'midrange',
        personality: data.personality || 'Balanced',
        deckSize: data.deck_size || 100,
      });
      addMessage('system', `Opponent spawned: ${data.commander || 'Unknown Commander'}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to spawn opponent';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [addMessage]);

  /** Build a CardLookup from API card data (human deck + AI deck) */
  const buildCardLookup = useCallback(
    (cardDataMaps: Record<string, CardDataFromAPI>[]): ((name: string) => ScryfallCard | undefined) => {
      const byName = new Map<string, ScryfallCard>();
      const addLookup = (name: string | undefined | null, card: ScryfallCard) => {
        for (const alias of lookupNameAliases(name)) {
          const normalized = normalizeLookupName(alias);
          if (normalized) byName.set(normalized, card);
        }
      };
      // Add basic lands
      for (const [name, card] of Object.entries(BASIC_LANDS)) {
        addLookup(name, card);
        addLookup(card.name, card);
      }
      // Add API cards
      for (const dataMap of cardDataMaps) {
        for (const [name, data] of Object.entries(dataMap)) {
          const scryfallCard = apiCardToScryfall(name, data);
          addLookup(name, scryfallCard);
          addLookup(data.name, scryfallCard);
        }
      }
      return (name: string) => byName.get(normalizeLookupName(name));
    },
    [],
  );

  /** Initialize engine and draw opening hands */
  const initEngine = useCallback(
    (
      humanDeck: GeneratedDeck,
      aiDecks: GeneratedDeck[],
      lookup: (name: string) => ScryfallCard | undefined,
      options?: StartGameOptions,
    ): GameStateWithAI => {
      return initGameFromDecks({
        humanDeck,
        aiDecks,
        aiDifficulty: options?.aiDifficulty ?? 3,
        cardLookup: lookup,
        format: options?.format ?? 'commander',
        humanGoesFirst: true,
        startingLife: options?.startingLife ?? 40,
        startingHandSize: options?.startingHandSize ?? 7,
      });
    },
    [],
  );

  // Initialize a new game with real decks for all players
  const startGame = useCallback(
    (importedCards?: ImportedCards, aiDeckDataArray?: ImportedCards | ImportedCards[], options?: StartGameOptions): boolean => {
      setError(null);
      setChatMessages([]);
      setGameLog([]);
      setAuthorityUpdates([]);
      setLastStateUpdate(null);
      setCurrentPrompt(null);
      setLastPlayedCard(null);
      setSelectedMulliganBottomIds([]);
      uncommittedTapsRef.current.clear();
      stepEffectsDoneRef.current.clear();
      pendingCastChoiceActionRef.current = null;
      pendingCastChoiceModeRef.current = null;
      pendingCastSelectCardsPromptRef.current = null;
      pendingPlayLandChoiceRef.current = null;
      pendingSearchEntryChoiceRef.current = null;
      pendingTargetChoiceRef.current = null;
      tutorSourceInstanceIdRef.current = undefined;
      tutorPromptRequestRef.current = null;
      libraryManipulationPromptRequestRef.current = null;
      optionalTriggerPromptRequestRef.current = null;
      damageAssignmentPromptRequestRef.current = null;
      triggerOrderPromptRequestRef.current = null;
      setTutorPhase(false);
      setTutorCards([]);
      setTutorTitle('');
      setLibraryChoice(null);
      setOptionalTriggerChoice(null);
      setDamageAssignmentChoice(null);
      setTriggerOrderChoice(null);
      pendingLibraryChoiceRef.current = null;
      const format = options?.format ?? 'commander';

      // Normalize aiDeckDataArray to always be an array
      const aiDeckDatas: (ImportedCards | undefined)[] = aiDeckDataArray
        ? Array.isArray(aiDeckDataArray) ? aiDeckDataArray : [aiDeckDataArray]
        : [undefined];

      // Determine human deck info
      const humanCommanderName = importedCards?.commander || 'Unknown Commander';
      const humanCards = importedCards ? [...importedCards.cards, ...importedCards.lands] : [];
      const humanColors = importedCards?.cardData
        ? Array.from(
            new Set(
              Object.values(importedCards.cardData).flatMap(d => d.color_identity || []),
            ),
          )
        : ['G'];

      // Build card lookup from all available card data
      const dataMaps: Record<string, CardDataFromAPI>[] = [];
      if (importedCards?.cardData) dataMaps.push(importedCards.cardData);

      // Build AI decks
      const aiDecks: GeneratedDeck[] = [];
      const aiIds: string[] = [];
      const aiCmdNames: Record<string, string> = {};

      // If we have opponentInfos (from ShelectorGamePage), use them for fallback
      const opponentInfoArr = opponentInfo ? [opponentInfo] : [];

      for (let i = 0; i < aiDeckDatas.length; i++) {
        const aiData = aiDeckDatas[i];
        const fallbackInfo = opponentInfoArr[i] || opponentInfo;
        const aiId = `ai${i + 1}`;
        aiIds.push(aiId);

        const aiCommanderName = aiData?.commander || fallbackInfo?.commander || `Shelector AI ${i + 1}`;
        aiCmdNames[aiId] = aiCommanderName;

        const aiCards = aiData ? [...aiData.cards, ...aiData.lands] : [];
        const aiColors = aiData?.cardData
          ? Array.from(
              new Set(
                Object.values(aiData.cardData).flatMap(d => d.color_identity || []),
              ),
            )
          : fallbackInfo?.colors || ['B', 'R'];

        if (aiData?.cardData) dataMaps.push(aiData.cardData);

        const aiCmdrNames = resolveCommanderNamesForImport(aiCommanderName, aiData?.cardData)
          .map((s: string) => s.toLowerCase());
        const aiList = format === 'limited'
          ? aiCards
          : padDeckToSize(
              aiCards.filter(n => !aiCmdrNames.includes(n.toLowerCase())),
              aiColors,
              100 - Math.max(1, aiCmdrNames.length),
            );

        aiDecks.push({
          id: `ai-deck-${i + 1}`,
          commander: aiCommanderName,
          list: aiList,
          sideboard: aiData?.sideboard || [],
          colors: aiColors,
          bracket: 3,
          theme: '',
        });
      }

      const lookup = buildCardLookup(dataMaps);

      const humanCmdrNames = resolveCommanderNamesForImport(humanCommanderName, importedCards?.cardData)
        .map(n => n.toLowerCase());
      const humanList = format === 'limited'
        ? humanCards
        : padDeckToSize(
            humanCards.filter(n => !humanCmdrNames.includes(n.toLowerCase())),
            humanColors,
            100 - Math.max(1, humanCmdrNames.length),
          );

      const humanDeck: GeneratedDeck = {
        id: 'human-deck',
        commander: humanCommanderName,
        list: humanList,
        sideboard: importedCards?.sideboard || [],
        colors: humanColors,
        bracket: 3,
        theme: '',
      };

      // Store for mulligan re-init
      humanDeckRef.current = humanDeck;
      aiDecksRef.current = aiDecks;
      cardLookupRef.current = lookup;
      humanCommanderRef.current = humanCommanderName;
      aiCommanderNamesRef.current = aiCmdNames;
      humanIdRef.current = 'human';
      aiIdsRef.current = aiIds;

      try {
        if (format !== 'limited') {
          const missingCommanders = [humanDeck, ...aiDecks].flatMap(deck => {
            const commanderNames = resolveCommanderNamesForLookup(deck.commander, lookup);
            return commanderNames.filter(name => !lookup(name));
          });
          if (missingCommanders.length > 0) {
            throw new Error(
              `Commander not found: ${[...new Set(missingCommanders)].join(', ')}. Re-import the deck so commander card data is included.`,
            );
          }
        }

        let engine = initEngine(humanDeck, aiDecks, lookup, options);
        const aiMulligans = runAIMulligans(engine, aiIds, aiCmdNames);
        engine = aiMulligans.state;
        engineRef.current = engine;

        setMulliganPhase(true);
        setMulliganCount(0);
        setSelectedMulliganCardIds([]);
        setSelectedMulliganBottomIds([]);

        // Derive display state
        const simple = deriveSimpleState(
          engine, humanIdRef.current, aiIdsRef.current,
          humanCommanderName, aiCmdNames,
        );
        setGameState(simple);
        setCurrentPrompt(buildActionPrompt(engine, simple.priorityPlayerId) || null);
        setLegalActions([]);

        addMessage('system', 'Opening hands drawn. Mulligan phase.');
        for (const text of aiMulligans.messages) {
          addMessage('shelector', text);
        }
        return true;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to initialize game';
        setError(msg);
        console.error('Engine init error:', err);
        return false;
      }
    },
    [opponentInfo, addMessage, buildCardLookup, initEngine],
  );

  /** Advance engine past beginning phase to precombat main for turn start */
  const advanceToPrecombatMain = useCallback((engine: GameState): GameState => {
    let current = engine;
    let safety = 20;
    while (current.phase === 'beginning' && safety-- > 0) {
      if (current.step === 'untap') {
        current = performUntapStepWithAuthority(current);
      }
      if (current.step === 'draw') {
        const activePlayer = current.players[current.activePlayerIndex];
        current = drawCardsWithAuthority(current, activePlayer.id, 1);
      }
      current = advanceStepWithAuthority(current);
    }
    return current;
  }, [advanceStepWithAuthority, drawCardsWithAuthority, performUntapStepWithAuthority]);

  // Keep hand -- end mulligan phase, proceed to normal gameplay
  const keepHand = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;

    if (mulliganCount > 0) {
      const handCards = getCardsInZone(engine, humanIdRef.current, 'hand');
      const cardsToBottom = Math.min(mulliganCount, handCards.length);
      const selectedIds = selectedMulliganBottomIds.filter(id =>
        handCards.some(card => card.instanceId === id),
      );

      if (selectedIds.length !== cardsToBottom) {
        addMessage(
          'system',
          `Choose ${cardsToBottom} card${cardsToBottom === 1 ? '' : 's'} from your hand to put on the bottom before keeping.`,
        );
        syncState();
        return;
      }

      const bottomRequest = createSelectCardsPromptRequest(engine, humanIdRef.current, {
        subject: 'OpeningMulliganBottom',
        zone: 'hand',
        destination: 'library',
        minSelections: cardsToBottom,
        maxSelections: cardsToBottom,
      });
      const bottomResponse = applySelectCardsPromptResponse(engine, bottomRequest, {
        requestId: bottomRequest.id,
        kind: 'SelectCards',
        playerId: humanIdRef.current,
        selectedCardInstanceIds: selectedIds,
      });
      recordAuthorityUpdate(bottomResponse.update);
      if (!bottomResponse.ok || !bottomResponse.state) {
        addMessage('system', bottomResponse.message || 'Those mulligan bottom choices are not legal.');
        syncState();
        return;
      }
      engineRef.current = bottomResponse.state as GameStateWithAI;
      addMessage(
        'player',
        `Keeping ${handCards.length - cardsToBottom} cards (mulliganed ${cardsToBottom} time${cardsToBottom > 1 ? 's' : ''}).`,
      );
    } else {
      addMessage('player', 'Keeping opening hand.');
    }

    setSelectedMulliganBottomIds([]);
    setSelectedMulliganCardIds([]);
    setMulliganPhase(false);
    addMessage('system', 'Game started! You are on the play.');
    addMessage('system', `Turn 1 \u2014 Your precombat main phase.`);

    // Advance engine to precombat main
    const advanced = advanceToPrecombatMain(engineRef.current || engine);
    engineRef.current = advanced as GameStateWithAI;

    syncState();
  }, [mulliganCount, selectedMulliganBottomIds, addMessage, syncState, advanceToPrecombatMain]);

  // Mulligan selected cards during the opening-hand trainer phase. If called
  // without selected cards, keep the old full-redraw London mulligan fallback.
  const mulligan = useCallback((cardInstanceIds?: string[]) => {
    const selectedIds = (cardInstanceIds || []).filter(Boolean);
    if (selectedIds.length > 0) {
      const engine = engineRef.current;
      if (!engine) return;

      const handIds = new Set(
        getCardsInZone(engine, humanIdRef.current, 'hand').map(card => card.instanceId),
      );
      const validIds = selectedIds.filter(id => handIds.has(id));
      if (validIds.length === 0) {
        addMessage('system', 'Select at least one card from your hand to mulligan.');
        syncState();
        return;
      }

      const mulliganRequest = createSelectCardsPromptRequest(engine, humanIdRef.current, {
        subject: 'OpeningMulligan',
        zone: 'hand',
        destination: 'library',
        minSelections: 1,
        maxSelections: handIds.size,
        commitSelection: false,
      });
      const mulliganResponse = applySelectCardsPromptResponse(engine, mulliganRequest, {
        requestId: mulliganRequest.id,
        kind: 'SelectCards',
        playerId: humanIdRef.current,
        selectedCardInstanceIds: validIds,
      });
      recordAuthorityUpdate(mulliganResponse.update);
      if (!mulliganResponse.ok) {
        addMessage('system', mulliganResponse.message || 'Those mulligan choices are not legal.');
        syncState();
        return;
      }

      const result = applyOpeningMulliganRedraw(engine, humanIdRef.current, validIds);
      recordAuthorityUpdate(result.update);
      if (!result.ok) {
        addMessage('system', result.message);
        syncState();
        return;
      }
      engineRef.current = result.state as GameStateWithAI;
      stepEffectsDoneRef.current.clear();
      setSelectedMulliganCardIds([]);
      setSelectedMulliganBottomIds([]);
      addMessage(
        'player',
        `Mulliganed ${result.redrawn} selected card${result.redrawn === 1 ? '' : 's'} and drew ${result.redrawn}.`,
      );
      syncState();
      return;
    }

    const humanDeck = humanDeckRef.current;
    const aiDecks = aiDecksRef.current;
    const lookup = cardLookupRef.current;
    if (!humanDeck || !aiDecks || aiDecks.length === 0 || !lookup) return;

    const newMulliganCount = mulliganCount + 1;
    setMulliganCount(newMulliganCount);
    setSelectedMulliganCardIds([]);
    setSelectedMulliganBottomIds([]);

    try {
      let newEngine = initEngine(humanDeck, aiDecks, lookup);
      const aiMulligans = runAIMulligans(newEngine, aiIdsRef.current, aiCommanderNamesRef.current);
      newEngine = aiMulligans.state;
      stepEffectsDoneRef.current.clear();
      engineRef.current = newEngine;

      // Auto-keep after 3 mulligans
      if (newMulliganCount >= 3) {
        const handCards = getCardsInZone(newEngine, humanIdRef.current, 'hand');
        const cardsToBottom = Math.min(newMulliganCount, handCards.length);
        const selectedBottomIds = handCards
          .slice(Math.max(0, handCards.length - cardsToBottom))
          .map(card => card.instanceId);
        if (cardsToBottom > 0) {
          const bottomRequest = createSelectCardsPromptRequest(newEngine, humanIdRef.current, {
            subject: 'OpeningMulliganBottom',
            zone: 'hand',
            destination: 'library',
            minSelections: cardsToBottom,
            maxSelections: cardsToBottom,
          });
          const bottomResponse = applySelectCardsPromptResponse(newEngine, bottomRequest, {
            requestId: bottomRequest.id,
            kind: 'SelectCards',
            playerId: humanIdRef.current,
            selectedCardInstanceIds: selectedBottomIds,
          });
          recordAuthorityUpdate(bottomResponse.update);
          if (!bottomResponse.ok || !bottomResponse.state) {
            addMessage('system', bottomResponse.message || 'Auto-keep mulligan bottom choices were rejected.');
            syncState();
            return;
          }
          newEngine = bottomResponse.state as GameStateWithAI;
        }

        setMulliganPhase(false);
        setSelectedMulliganCardIds([]);
        setSelectedMulliganBottomIds([]);

        const advanced = advanceToPrecombatMain(newEngine);
        engineRef.current = advanced as GameStateWithAI;

        syncState();

        for (const text of aiMulligans.messages) {
          addMessage('shelector', text);
        }
        addMessage(
          'player',
          `Mulliganed to ${handCards.length - cardsToBottom} (auto-kept after 3 mulligans).`,
        );
        addMessage('system', 'Game started! You are on the play.');
        addMessage('system', `Turn 1 \u2014 Your precombat main phase.`);
        return;
      }

      // Show new hand
      const simple = deriveSimpleState(
        newEngine, humanIdRef.current, aiIdsRef.current,
        humanCommanderRef.current, aiCommanderNamesRef.current,
      );
      setGameState(simple);
      setCurrentPrompt(buildActionPrompt(newEngine, simple.priorityPlayerId) || null);

      addMessage(
        'player',
        `Mulligan #${newMulliganCount}. Drawing a new hand of 7 (will put ${newMulliganCount} on bottom).`,
      );
      for (const text of aiMulligans.messages) {
        addMessage('shelector', text);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Mulligan failed';
      setError(msg);
      console.error('Mulligan error:', err);
    }
  }, [mulliganCount, addMessage, initEngine, recordAuthorityUpdate, syncState, advanceToPrecombatMain]);

  const toggleMulliganCard = useCallback((cardInstanceId: string) => {
    setSelectedMulliganCardIds(prev =>
      prev.includes(cardInstanceId)
        ? prev.filter(id => id !== cardInstanceId)
        : [...prev, cardInstanceId],
    );
  }, []);

  const toggleMulliganBottomCard = useCallback((cardInstanceId: string) => {
    setSelectedMulliganBottomIds(prev => {
      const required = Math.max(0, mulliganCount);
      if (prev.includes(cardInstanceId)) {
        return prev.filter(id => id !== cardInstanceId);
      }
      if (required > 0 && prev.length >= required) {
        return [...prev.slice(1), cardInstanceId];
      }
      return [...prev, cardInstanceId];
    });
  }, [mulliganCount]);

  // Discard a card from hand. Cleanup uses this for hand-size discards; the
  // trainer also exposes it as a manual sandbox action.
  const discardCard = useCallback(
    (cardInstanceId: string) => {
      const engine = engineRef.current;
      if (!engine) return;

      const card = engine.cards.get(cardInstanceId);
      if (!card || card.zone !== 'hand' || card.ownerId !== humanIdRef.current) return;

      const def = getCardDefinition(engine, card);
      const discardRequest = createSelectCardsPromptRequest(engine, humanIdRef.current, {
        subject: discardPhase ? 'DiscardToHandSize' : 'ManualDiscard',
        zone: 'hand',
        destination: 'graveyard',
        minSelections: 1,
        maxSelections: 1,
      });
      const discardResponse = applySelectCardsPromptResponse(engine, discardRequest, {
        requestId: discardRequest.id,
        kind: 'SelectCards',
        playerId: humanIdRef.current,
        selectedCardInstanceIds: [cardInstanceId],
      });
      recordAuthorityUpdate(discardResponse.update);
      if (!discardResponse.ok || !discardResponse.state) {
        addMessage('system', discardResponse.message || 'That discard is not legal right now.');
        syncState();
        return;
      }
      const newEngine = discardResponse.state as GameStateWithAI;
      engineRef.current = newEngine;

      addMessage('player', `Discarded ${def.name}.`);

      if (!discardPhase) {
        syncState();
        return;
      }

      discardCountRef.current -= 1;
      setDiscardCount(discardCountRef.current);

      if (discardCountRef.current <= 0) {
        // Done discarding — continue the game loop
        setDiscardPhase(false);

        // Advance past cleanup to next turn
        const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
        const loopLogEntries: GameLogEntry[] = [];
        let state: GameState = newEngine;
        const oldTurn = state.turnNumber;
        state = advanceStepWithAuthority(state);
        state = runSBAAndTriggers(state);
        if (state.turnNumber !== oldTurn) {
          const newActive = state.players[state.activePlayerIndex];
          const isNewActiveHuman = newActive.id === humanIdRef.current;
          const activeName = isNewActiveHuman
            ? 'Your'
            : `${aiCommanderNamesRef.current[newActive.id] || newActive.id}'s`;
          loopMessages.push({
            role: 'system',
            text: `Turn ${publicTurnNumber(state.turnNumber, state.players.length)} \u2014 ${activeName} turn.`,
          });
        }
        // Continue the game loop for AI turns etc.
        state = advanceGameLoop(state, loopMessages, loopLogEntries);
        engineRef.current = state as GameStateWithAI;

        for (const msg of loopMessages) {
          addMessage(msg.role, msg.text);
        }
        if (loopLogEntries.length > 0) {
          setGameLog(prev => [...prev, ...loopLogEntries]);
        }
      }

      syncState();
    },
    [advanceGameLoop, advanceStepWithAuthority, addMessage, discardPhase, recordAuthorityUpdate, runSBAAndTriggers, syncState],
  );

  const resolveTutor = useCallback((cardInstanceId: string) => {
    const pendingCastChoice = pendingCastChoiceActionRef.current;
    if (pendingCastChoice) {
      pendingCastChoiceActionRef.current = null;
      const choiceMode = pendingCastChoiceModeRef.current;
      pendingCastChoiceModeRef.current = null;
      const selectCardsPrompt = pendingCastSelectCardsPromptRef.current;
      pendingCastSelectCardsPromptRef.current = null;
      setTutorPhase(false);
      setTutorCards([]);
      setTutorTitle('');

      const pendingEngineAction = pendingCastChoice._engineAction;
      if (pendingEngineAction.kind === 'CastSpell') {
        if (choiceMode === 'discardLand' && selectCardsPrompt) {
          const engineForChoice = engineRef.current;
          if (!engineForChoice) return;
          const selectResponse = applySelectCardsPromptResponse(engineForChoice, selectCardsPrompt, {
            requestId: selectCardsPrompt.id,
            kind: 'SelectCards',
            playerId: humanIdRef.current,
            selectedCardInstanceIds: [cardInstanceId],
          });
          recordAuthorityUpdate(selectResponse.update);
          if (!selectResponse.ok) {
            addMessage('system', selectResponse.message || 'That discard choice is not legal right now.');
            syncState();
            return;
          }
        }

        if (choiceMode === 'sacrificeCreature') {
          submitActionRef.current?.({
            ...pendingCastChoice,
            _engineAction: {
              ...pendingEngineAction,
              namedCardChoices: {
                ...(pendingEngineAction.namedCardChoices || {}),
                sacrificeCardId: cardInstanceId,
              },
            },
          });
          return;
        }

        submitActionRef.current?.({
          ...pendingCastChoice,
          _engineAction: {
            ...pendingEngineAction,
            cardChoices: {
              ...(pendingEngineAction.cardChoices || {}),
              discardedCardIds: [cardInstanceId],
            },
          },
        });
      }
      return;
    }

    const pendingLandChoice = pendingPlayLandChoiceRef.current;
    if (pendingLandChoice) {
      pendingPlayLandChoiceRef.current = null;
      setTutorPhase(false);
      setTutorCards([]);
      setTutorTitle('');

      const pendingEngineAction = pendingLandChoice.action._engineAction;
      if (pendingEngineAction.kind === 'PlayLand') {
        if (pendingLandChoice.kind === 'payLife') {
          const engineForReplacement = engineRef.current;
          if (!engineForReplacement) return;
          const replacementRequest = createBattlefieldEntryReplacementPromptRequest(
            engineForReplacement,
            humanIdRef.current,
            pendingEngineAction.cardInstanceId,
            {
              sourceInstanceId: pendingEngineAction.cardInstanceId,
            },
          );
          const replacementResponse = applyChooseReplacementPromptResponse(engineForReplacement, replacementRequest, {
            requestId: replacementRequest.id,
            kind: 'ChooseReplacement',
            playerId: humanIdRef.current,
            selectedOptionId: cardInstanceId === 'pay-life'
              ? 'pay_life_enter_untapped'
              : 'enter_tapped',
          });
          recordAuthorityUpdate(replacementResponse.update);
          if (!replacementResponse.ok) {
            addMessage('system', replacementResponse.message || 'That replacement choice is not legal right now.');
            syncState();
            return;
          }
        }
        submitActionRef.current?.({
          ...pendingLandChoice.action,
          _engineAction: {
            ...pendingEngineAction,
            ...(pendingLandChoice.kind === 'creatureType'
              ? { chosenCreatureType: cardInstanceId }
              : { payLifeToEnterUntapped: cardInstanceId === 'pay-life' }),
          },
        });
      }
      return;
    }

    const pendingTargetChoice = pendingTargetChoiceRef.current;
    if (pendingTargetChoice) {
      pendingTargetChoiceRef.current = null;
      setTutorPhase(false);
      setTutorCards([]);
      setTutorTitle('');
      const selected = pendingTargetChoice.choices.find(choice => choice.targetId === cardInstanceId);
      if (!selected) {
        addMessage('system', `${cardInstanceId} is not a legal target for ${pendingTargetChoice.label}.`);
        syncState();
        return;
      }
      submitActionRef.current?.(selected.action);
      return;
    }

    const pendingSearchEntryChoice = pendingSearchEntryChoiceRef.current;
    let selectedCardInstanceId = cardInstanceId;
    let payLifeForSearchEntry: boolean | undefined;
    if (pendingSearchEntryChoice) {
      pendingSearchEntryChoiceRef.current = null;
      selectedCardInstanceId = pendingSearchEntryChoice.cardInstanceId;
      payLifeForSearchEntry = cardInstanceId === 'pay-life';
      setTutorPhase(false);
      setTutorCards([]);
      setTutorTitle('');
    }

    const engine = engineRef.current;
    if (!engine) return;

    const card = engine.cards.get(selectedCardInstanceId);
    if (!card) return;
    const def = engine.cardDefinitions.get(card.definitionId);
    const cardName = def?.name || 'a card';
    if (payLifeForSearchEntry !== undefined) {
      const replacementRequest = createBattlefieldEntryReplacementPromptRequest(
        engine,
        humanIdRef.current,
        selectedCardInstanceId,
        {
          sourceInstanceId: tutorSourceInstanceIdRef.current,
          forceTapped: tutorTappedRef.current,
        },
      );
      const replacementResponse = applyChooseReplacementPromptResponse(engine, replacementRequest, {
        requestId: replacementRequest.id,
        kind: 'ChooseReplacement',
        playerId: humanIdRef.current,
        selectedOptionId: payLifeForSearchEntry ? 'pay_life_enter_untapped' : 'enter_tapped',
      });
      recordAuthorityUpdate(replacementResponse.update);
      if (!replacementResponse.ok) {
        addMessage('system', replacementResponse.message || 'That replacement choice is not legal right now.');
        syncState();
        return;
      }
    }

    // Determine destination from the tutor's oracle text
    const dest = tutorDestinationRef.current;
    const filter = tutorFilterRef.current;
    const promptRequest = tutorPromptRequestRef.current;
    if (!promptRequest) {
      addMessage('system', 'That search no longer has an active engine prompt. Resolve the stack again to continue.');
      syncState();
      return;
    }
    const isLegalLibraryChoice = promptRequest.legalChoices.some(choice => choice.cardInstanceId === selectedCardInstanceId);
    if (!isLegalLibraryChoice) {
      const sourceName = tutorSourceNameRef.current || 'this search';
      addMessage('system', `${cardName} is not a legal choice for ${sourceName}. Choose a legal card.`);
      appendLog({
        ...captureLogEntry(
          engine,
          humanIdRef.current,
          aiIdsRef.current,
          'human',
          `Rejected illegal search choice: ${cardName}`,
          0,
          humanIdRef.current,
        ),
        playByPlay: `${cardName} was rejected by the rules validator. State was not changed.`,
        rulesAudit: {
          severity: 'error',
          reason: `${cardName} did not match ${filter || 'the current search predicate'} for ${sourceName}.`,
        },
      });
      syncState();
      return;
    }

    if (dest === 'battlefield' && payLifeForSearchEntry === undefined && !tutorTappedRef.current) {
      const optionalLifeCost = def ? getOptionalUntappedLifeCostFromText(def.oracle_text) : undefined;
      if (optionalLifeCost !== undefined) {
        pendingSearchEntryChoiceRef.current = { cardInstanceId: selectedCardInstanceId, optionalLifeCost };
        setTutorTitle(`${cardName}: enter untapped?`);
        setTutorCards([
          {
            instanceId: 'pay-life',
            name: `Pay ${optionalLifeCost} life`,
            typeLine: 'Enter untapped',
            manaCost: '',
            legal: true,
            reason: 'Land enters untapped',
            destination: 'choice' as const,
          },
          {
            instanceId: 'enter-tapped',
            name: 'Enter tapped',
            typeLine: 'Do not pay life',
            manaCost: '',
            legal: true,
            reason: 'Land enters tapped',
            destination: 'choice' as const,
          },
        ]);
        setTutorPhase(true);
        addMessage('system', `Choose whether to pay ${optionalLifeCost} life for ${cardName}.`);
        syncState();
        return;
      }
    }

    const activePrompt = promptRequest;
    const promptResponse = applySearchLibraryPromptResponse(engine, activePrompt, {
      requestId: activePrompt.id,
      kind: 'SearchLibrary',
      playerId: humanIdRef.current,
      selectedCardInstanceIds: [selectedCardInstanceId],
      payLifeToEnterUntapped: payLifeForSearchEntry,
    });
    if (!promptResponse.ok || !promptResponse.state) {
      recordAuthorityUpdate(promptResponse.update);
      const message = promptResponse.message || 'Could not resolve that search choice.';
      addMessage('system', message);
      syncState();
      return;
    }
    recordAuthorityUpdate(promptResponse.update);
    const resolvedEngine = promptResponse.state as GameStateWithAI;
    engineRef.current = resolvedEngine;

    const movedCard = resolvedEngine.cards.get(selectedCardInstanceId);
    const playerBefore = engine.players.find(p => p.id === humanIdRef.current);
    const playerAfter = resolvedEngine.players.find(p => p.id === humanIdRef.current);
    const paidLife = Math.max(0, (playerBefore?.life ?? 0) - (playerAfter?.life ?? playerBefore?.life ?? 0));
    if (dest === 'top') {
      addMessage('player', `Found ${cardName} and put it on top of library.${tutorShuffleRef.current ? ' Library shuffled.' : ''}`);
    } else if (dest === 'battlefield') {
      const entryText = movedCard?.tapped ? ' tapped' : '';
      const lifeText = paidLife > 0 ? ` Paid ${paidLife} life.` : '';
      addMessage('player', `Found ${cardName} and put it onto the battlefield${entryText}.${lifeText}${tutorShuffleRef.current ? ' Library shuffled.' : ''}`);
    } else if (dest === 'graveyard') {
      addMessage('player', `Found ${cardName} and put it into graveyard.${tutorShuffleRef.current ? ' Library shuffled.' : ''}`);
    } else {
      addMessage('player', `Found ${cardName} and put it into hand.${tutorShuffleRef.current ? ' Library shuffled.' : ''}`);
    }

    appendLog({
      ...captureLogEntry(
        engineRef.current || engine,
        humanIdRef.current,
        aiIdsRef.current,
        'human',
        `Search choice: ${tutorSourceNameRef.current} found ${cardName}`,
        0,
        humanIdRef.current,
      ),
      playByPlay: `${tutorSourceNameRef.current} found ${cardName} and put it ${
        dest === 'top' ? 'on top of the library' : `into ${dest}`
      }.`,
      rulesAudit: {
        severity: 'info',
        reason: `Search choice validated against ${filter || 'the current engine predicate'} before moving the card.`,
      },
    });

    if (tutorRemainingRef.current > 0) {
      tutorRemainingRef.current -= 1;
      const remaining = tutorRemainingRef.current + 1;
      const activeFilter = tutorFilterRef.current;
      const activeFilterSpec = tutorFilterSpecRef.current;
      const sourceName = tutorSourceNameRef.current;
      const updatedEngine = engineRef.current!;
      const nextPromptRequest = createSearchLibraryPromptRequest(
        updatedEngine,
        humanIdRef.current,
        cardFilterFromSearchInfo({
          filter: activeFilter,
          filterSpec: activeFilterSpec,
          destination: tutorDestinationRef.current,
          tapped: tutorTappedRef.current,
          shuffle: tutorShuffleRef.current,
        }),
        tutorDestinationRef.current,
        {
          sourceInstanceId: tutorSourceInstanceIdRef.current,
          tapped: tutorTappedRef.current,
          shuffle: tutorShuffleRef.current,
          revealPolicy: activeFilter || activeFilterSpec ? 'reveal' : 'hidden',
          minSelections: 0,
          maxSelections: 1,
        },
      );
      const pickerMetadata: Pick<TutorCardOption, 'legal' | 'reason' | 'destination' | 'entersTapped' | 'mustReveal'> = {
        legal: true,
        reason: activeFilter ? `Matches ${activeFilter}` : 'Legal library choice',
        destination: tutorDestinationRef.current,
        entersTapped: tutorDestinationRef.current === 'battlefield' ? tutorTappedRef.current : undefined,
        mustReveal: Boolean(activeFilter || activeFilterSpec),
      };
      const pickerCards = [...nextPromptRequest.legalChoices, ...nextPromptRequest.invalidChoices]
        .map((choice): TutorCardOption | null => {
          const c = updatedEngine.cards.get(choice.cardInstanceId);
          if (!c) return null;
          const d = getCardDefinition(updatedEngine, c);
          return {
            instanceId: c.instanceId,
            name: d.name,
            typeLine: d.type_line,
            manaCost: d.mana_cost,
            oracleText: d.oracle_text,
            colors: d.colors,
            cmc: d.cmc,
            ...pickerMetadata,
            legal: choice.legal,
            reason: choice.legal ? pickerMetadata.reason : choice.reason,
            destination: choice.destination,
          };
        })
        .filter((option): option is TutorCardOption => Boolean(option));
      tutorPromptRequestRef.current = nextPromptRequest;

      const filterDesc = activeFilter ? ` for ${activeFilter}` : '';
      const countSuffix = ` (${remaining} more - Cancel to stop here)`;
      setTutorTitle(`${sourceName}: Search your library${filterDesc}${countSuffix}`);
      setTutorCards(pickerCards);
      syncState();
      return;
    }

    setTutorPhase(false);
    setTutorCards([]);
    setTutorTitle('');
    tutorRemainingRef.current = 0;
    tutorFilterRef.current = undefined;
    tutorFilterSpecRef.current = undefined;
    tutorTappedRef.current = false;
    tutorShuffleRef.current = true;
    tutorSourceInstanceIdRef.current = undefined;
    tutorPromptRequestRef.current = null;
    libraryManipulationPromptRequestRef.current = null;

    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    const state: GameState = advanceGameLoop(engineRef.current!, loopMessages, loopLogEntries);
    engineRef.current = state as GameStateWithAI;
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);

    syncState();
    return;

  }, [addMessage, appendLog, recordAuthorityUpdate, syncState, advanceGameLoop]);

  /** Cancel the active tutor — useful for "up to N" searches when the user wants
   * fewer than N picks, or to skip the search entirely. */
  const cancelTutor = useCallback(() => {
    if (!engineRef.current) return;
    const pendingCastChoice = pendingCastChoiceActionRef.current;
    const pendingLandChoice = pendingPlayLandChoiceRef.current;
    const choiceMode = pendingCastChoiceModeRef.current;
    const activeSearchPrompt = tutorPromptRequestRef.current;
    const activeSearchSourceName = tutorSourceNameRef.current;
    setTutorPhase(false);
    setTutorCards([]);
    setTutorTitle('');
    tutorRemainingRef.current = 0;
    tutorFilterRef.current = undefined;
    tutorFilterSpecRef.current = undefined;
    tutorTappedRef.current = false;
    tutorShuffleRef.current = true;
    tutorSourceInstanceIdRef.current = undefined;
    tutorPromptRequestRef.current = null;

    if (pendingCastChoice) {
      pendingCastChoiceActionRef.current = null;
      pendingCastChoiceModeRef.current = null;
      pendingCastSelectCardsPromptRef.current = null;
      if (choiceMode === 'sacrificeCreature') {
        addMessage('player', 'No creature sacrificed.');
        submitActionRef.current?.(pendingCastChoice);
        return;
      }
      addMessage('player', 'Cancelled the cast choice.');
      syncState();
      return;
    }

    if (pendingLandChoice) {
      pendingPlayLandChoiceRef.current = null;
      addMessage('player', 'Cancelled the land choice.');
      syncState();
      return;
    }

    if (pendingSearchEntryChoiceRef.current) {
      pendingSearchEntryChoiceRef.current = null;
      addMessage('player', 'Cancelled the entry choice.');
      syncState();
      return;
    }

    if (pendingTargetChoiceRef.current) {
      pendingTargetChoiceRef.current = null;
      addMessage('player', 'Cancelled target selection.');
      syncState();
      return;
    }

    if (activeSearchPrompt) {
      const promptResponse = applySearchLibraryPromptResponse(engineRef.current, activeSearchPrompt, {
        requestId: activeSearchPrompt.id,
        kind: 'SearchLibrary',
        playerId: humanIdRef.current,
        selectedCardInstanceIds: [],
      });
      if (promptResponse.ok && promptResponse.state) {
        recordAuthorityUpdate(promptResponse.update);
        engineRef.current = promptResponse.state as GameStateWithAI;
      } else {
        recordAuthorityUpdate(promptResponse.update);
        addMessage('system', promptResponse.message || 'Could not stop this search cleanly.');
        syncState();
        return;
      }
    }

    addMessage('player', `Stopped searching${activeSearchSourceName ? ` (${activeSearchSourceName})` : ''}.`);

    // Resume game loop after the tutor ends
    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    const state: GameState = advanceGameLoop(engineRef.current, loopMessages, loopLogEntries);
    engineRef.current = state as GameStateWithAI;
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);
    syncState();
  }, [addMessage, recordAuthorityUpdate, syncState, advanceGameLoop]);

  // Undo last human action
  const undoAction = useCallback(() => {
    if (undosRemaining <= 0 || undoStackRef.current.length === 0) return;

    const snapshot = undoStackRef.current.pop()!;
    engineRef.current = snapshot.engine;
    setChatMessages([...snapshot.messages, { role: 'system', text: `Undo! (${undosRemaining - 1} remaining)`, timestamp: Date.now() }]);
    setGameLog(snapshot.log);
    setLastPlayedCard(snapshot.lastPlayedCard);
    setUndosRemaining(prev => prev - 1);

    // Clear any special phases
    pendingCastChoiceActionRef.current = null;
    pendingCastChoiceModeRef.current = null;
    pendingCastSelectCardsPromptRef.current = null;
    pendingPlayLandChoiceRef.current = null;
    pendingSearchEntryChoiceRef.current = null;
    pendingTargetChoiceRef.current = null;
    optionalTriggerPromptRequestRef.current = null;
    damageAssignmentPromptRequestRef.current = null;
    triggerOrderPromptRequestRef.current = null;
    setOptionalTriggerChoice(null);
    setDamageAssignmentChoice(null);
    setTriggerOrderChoice(null);
    setDiscardPhase(false);
    setTutorPhase(false);
    setTutorCards([]);
    setTutorTitle('');

    syncState();
  }, [undosRemaining, syncState]);

  // Untap a mana source — only if the mana hasn't been spent on a spell yet
  const untapManaSource = useCallback((cardInstanceId: string) => {
    const engine = engineRef.current;
    if (!engine) return;

    // Only allow untapping uncommitted taps (mana not yet spent on a spell)
    const tapRecord = uncommittedTapsRef.current.get(cardInstanceId);
    if (!tapRecord) return;

    const card = engine.cards.get(cardInstanceId);
    const def = card ? engine.cardDefinitions.get(card.definitionId) : undefined;
    const result = tryUntapManaSource(
      engine,
      humanIdRef.current,
      cardInstanceId,
      tapRecord.color,
      tapRecord.amount,
    );
    if (!result.ok) {
      setActionError({ reason: result.reason, message: result.message });
      addMessage('system', `Cannot untap mana source: ${result.message}`);
      syncState();
      return;
    }

    engineRef.current = result.state as GameStateWithAI;
    applyEvents(result.events, result.state);
    recordStateUpdate(engine, result.state, {
      kind: 'ManualUntapManaSource',
      cardInstanceId,
      color: tapRecord.color,
      amount: tapRecord.amount,
      label: `Untap ${def?.name || 'mana source'}`,
      _engineAction: {
        kind: 'ManualUntapManaSource',
        cardInstanceId,
        color: tapRecord.color,
        amount: tapRecord.amount,
      },
    } as SimpleLegalAction, result.events, { source: 'system' });

    uncommittedTapsRef.current.delete(cardInstanceId);
    const player = result.state.players.find(p => p.id === humanIdRef.current);
    const pool = player?.manaPool || { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    addMessage('player', `Untapped ${def?.name || 'mana source'}. Floating: ${formatManaPool(pool)}`);
    syncState();
  }, [addMessage, applyEvents, recordStateUpdate, syncState]);

  const adjustCounters = useCallback((cardInstanceId: string, counterType: string, delta: number) => {
    const engine = engineRef.current;
    if (!engine) return;

    const card = engine.cards.get(cardInstanceId);
    const def = card ? engine.cardDefinitions.get(card.definitionId) : undefined;
    const result = tryAdjustCounters(engine, humanIdRef.current, cardInstanceId, counterType, delta);
    if (!result.ok) {
      setActionError({ reason: result.reason, message: result.message });
      addMessage('system', `Cannot adjust counters: ${result.message}`);
      syncState();
      return;
    }

    engineRef.current = result.state as GameStateWithAI;
    applyEvents(result.events, result.state);

    const cleanCounterType = counterType.trim().replace(/\s+/g, ' ');
    const sign = delta > 0 ? '+' : '';
    addMessage(
      'system',
      `Manual correction: ${def?.name || 'Permanent'} ${sign}${delta} ${cleanCounterType} counter${Math.abs(delta) === 1 ? '' : 's'}.`,
    );
    syncState();
  }, [addMessage, applyEvents, syncState]);

  // Deep-clone engine state for undo snapshots (Maps need special handling)
  const cloneEngineState = useCallback((s: GameStateWithAI): GameStateWithAI => {
    return {
      ...s,
      cards: new Map(s.cards),
      cardDefinitions: new Map(s.cardDefinitions),
      sideboards: s.sideboards ? new Map([...s.sideboards.entries()].map(([playerId, cards]) => [playerId, [...cards]])) : undefined,
      battlefieldAbilities: new Map(s.battlefieldAbilities),
      players: s.players.map(p => ({ ...p, manaPool: { ...p.manaPool }, commanderDamage: { ...p.commanderDamage } })),
      stack: [...s.stack],
      pendingTriggers: [...s.pendingTriggers],
      hasPriorityPassed: [...s.hasPriorityPassed],
    };
  }, []);

  const skipEmptyPhases = useCallback(() => {
    let state = engineRef.current as GameState | null;
    if (!state || gameState?.gameOver || mulliganPhase || discardPhase || tutorPhase || libraryChoice || optionalTriggerChoice || damageAssignmentChoice || triggerOrderChoice) return;

    const humanId = humanIdRef.current;
    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    const collectedEvents: ActionGameEvent[] = [];
    let skippedWindows = 0;
    let safety = 80;
    const applySkipAction = (s: GameState, action: AIAction, playerId = humanId): GameState | null => {
      const response = applyActionThroughAuthority(s, playerId, action, {
        source: 'system',
        label: toSimpleLegalAction(action, s).label,
      });
      if (!response.ok || !response.state) {
        addMessage('system', `Could not skip action: ${response.message || 'the current action is not legal.'}`);
        return null;
      }
      collectedEvents.push(...(response.events || []));
      return response.state;
    };

    while (state && safety-- > 0) {
      const humanIndex = state.players.findIndex(p => p.id === humanId);
      if (humanIndex < 0 || state.players[humanIndex]?.hasLost) break;

      if (state.priorityPlayerIndex !== humanIndex || state.hasPriorityPassed[humanIndex]) {
        const advanced = advanceGameLoop(state, loopMessages, loopLogEntries);
        if (advanced === state) break;
        state = advanced;
        continue;
      }

      if (hasMeaningfulHumanActionForAutoSkip(state, humanId)) {
        break;
      }

      const actions = getLegalActions(state, humanId);
      const emptyAttack = actions.find(
        (a): a is Extract<AIAction, { kind: 'DeclareAttackers' }> =>
          a.kind === 'DeclareAttackers' && a.attacks.length === 0,
      );
      const emptyBlocks = actions.find(
        (a): a is Extract<AIAction, { kind: 'DeclareBlockers' }> =>
          a.kind === 'DeclareBlockers' && a.blocks.length === 0,
      );
      const pass = actions.find(
        (a): a is Extract<AIAction, { kind: 'PassPriority' }> =>
          a.kind === 'PassPriority',
      );

      if (emptyAttack) {
        const applied = applySkipAction(state, emptyAttack);
        if (!applied) break;
        state = applied;
      } else if (emptyBlocks) {
        const applied = applySkipAction(state, emptyBlocks);
        if (!applied) break;
        state = applied;
      } else if (pass) {
        const applied = applySkipAction(state, pass);
        if (!applied) break;
        state = applied;
      } else {
        break;
      }

      skippedWindows += 1;
      state = advanceGameLoop(state, loopMessages, loopLogEntries);
    }

    if (!state) return;

    engineRef.current = state as GameStateWithAI;
    applyEvents(collectedEvents, state);
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);
    if (skippedWindows > 0) {
      addMessage(
        'player',
        `Skipped ${skippedWindows} empty priority window${skippedWindows === 1 ? '' : 's'}.`,
      );
    }
    syncState();
  }, [
    addMessage,
    advanceGameLoop,
    advanceStepWithAuthority,
    applyEvents,
    damageAssignmentChoice,
    discardPhase,
    gameState?.gameOver,
    libraryChoice,
    mulliganPhase,
    optionalTriggerChoice,
    triggerOrderChoice,
    syncState,
    tutorPhase,
    applyActionThroughAuthority,
  ]);

  const skipRestOfTurn = useCallback(() => {
    let state = engineRef.current as GameState | null;
    if (!state || gameState?.gameOver || mulliganPhase || discardPhase || tutorPhase || libraryChoice || optionalTriggerChoice || damageAssignmentChoice || triggerOrderChoice) return;

    const humanId = humanIdRef.current;
    if (state.players[state.activePlayerIndex]?.id !== humanId) {
      skipEmptyPhases();
      return;
    }

    const startingTurn = state.turnNumber;
    const startingActivePlayerIndex = state.activePlayerIndex;
    const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
    const loopLogEntries: GameLogEntry[] = [];
    const collectedEvents: ActionGameEvent[] = [];
    let skippedWindows = 0;
    let safety = 120;
    const applySkipAction = (s: GameState, action: AIAction, playerId = humanId): GameState | null => {
      const response = applyActionThroughAuthority(s, playerId, action, {
        source: 'system',
        label: toSimpleLegalAction(action, s).label,
      });
      if (!response.ok || !response.state) {
        addMessage('system', `Could not skip action: ${response.message || 'the current action is not legal.'}`);
        return null;
      }
      collectedEvents.push(...(response.events || []));
      return response.state;
    };
    const combatSteps = new Set<NonNullable<GameState['step']>>([
      'declare_attackers',
      'declare_blockers',
      'first_strike_damage',
      'combat_damage',
      'end_of_combat',
    ]);
    const allPriorityPassed = (s: GameState): boolean =>
      s.hasPriorityPassed.every((passed, index) => passed || s.players[index].hasLost);
    const resolveCombatDamageBeforeAdvance = (s: GameState): GameState => {
      if (s.step !== 'combat_damage' || !s.combat || s.combat.attackers.length === 0) {
        return s;
      }
      if (queueHumanDamageAssignmentChoice(s)) {
        return s;
      }

      try {
        return runSBAAndTriggers(resolveCombatDamageWithAuthority(s));
      } catch (combatErr: unknown) {
        console.error('Combat damage error while skipping turn:', combatErr);
        return s;
      }
    };

    const passWindowAndAdvance = (s: GameState): GameState => {
      let next = s;
      let passGuard = next.players.length + 2;
      while (!allPriorityPassed(next) && passGuard-- > 0) {
        const priorityPlayer = next.players[next.priorityPlayerIndex];
        if (!priorityPlayer) break;
        const passed = applySkipAction(next, { kind: 'PassPriority' }, priorityPlayer.id);
        if (!passed) break;
        next = passed;
      }
      next = resolveCombatDamageBeforeAdvance(next);
      if (next.stack.length > 0) return next;
      return advanceStepWithAuthority(next);
    };
    const skipRemainingCombat = (s: GameState): GameState => {
      let next = s;
      let combatGuard = 20;
      while (combatSteps.has(next.step) && combatGuard-- > 0) {
        if (next.stack.length > 0) break;
        next = passWindowAndAdvance(next);
      }
      return next;
    };

    while (state && safety-- > 0) {
      const humanIndex = state.players.findIndex(p => p.id === humanId);
      if (humanIndex < 0 || state.players[humanIndex]?.hasLost) break;
      if (state.turnNumber !== startingTurn || state.activePlayerIndex !== startingActivePlayerIndex) break;

      const actions = getLegalActions(state, humanId);
      const emptyAttack = actions.find(
        (a): a is Extract<AIAction, { kind: 'DeclareAttackers' }> =>
          a.kind === 'DeclareAttackers' && a.attacks.length === 0,
      );
      const emptyBlocks = actions.find(
        (a): a is Extract<AIAction, { kind: 'DeclareBlockers' }> =>
          a.kind === 'DeclareBlockers' && a.blocks.length === 0,
      );
      const pass = actions.find(
        (a): a is Extract<AIAction, { kind: 'PassPriority' }> =>
          a.kind === 'PassPriority',
      );

      if (state.step === 'declare_attackers' && emptyAttack) {
        const applied = applySkipAction(state, emptyAttack);
        if (!applied) break;
        state = applied;
        skippedWindows += 1;
        state = skipRemainingCombat(state);
        continue;
      } else if (state.step === 'declare_blockers' && emptyBlocks) {
        const applied = applySkipAction(state, emptyBlocks);
        if (!applied) break;
        state = applied;
        skippedWindows += 1;
        state = skipRemainingCombat(state);
        continue;
      } else if (
        pass &&
        state.priorityPlayerIndex === humanIndex &&
        !state.hasPriorityPassed[humanIndex]
      ) {
        const applied = applySkipAction(state, pass);
        if (!applied) break;
        state = applied;
        skippedWindows += 1;
      } else {
        const advanced = advanceGameLoop(state, loopMessages, loopLogEntries);
        if (advanced === state) break;
        state = advanced;
        continue;
      }

      const advanced = advanceGameLoop(state, loopMessages, loopLogEntries);
      if (advanced === state) {
        continue;
      }
      state = advanced;
    }

    if (!state) return;

    engineRef.current = state as GameStateWithAI;
    applyEvents(collectedEvents, state);
    for (const msg of loopMessages) addMessage(msg.role, msg.text);
    if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);
    addMessage(
      'player',
      skippedWindows > 0
        ? `Skipped the rest of your turn (${skippedWindows} window${skippedWindows === 1 ? '' : 's'} passed).`
        : 'Skipped the rest of your turn.',
    );
    syncState();
  }, [
    addMessage,
    advanceGameLoop,
    applyEvents,
    damageAssignmentChoice,
    discardPhase,
    gameState?.gameOver,
    libraryChoice,
    mulliganPhase,
    optionalTriggerChoice,
    triggerOrderChoice,
    queueHumanDamageAssignmentChoice,
    resolveCombatDamageWithAuthority,
    runSBAAndTriggers,
    skipEmptyPhases,
    syncState,
    tutorPhase,
    applyActionThroughAuthority,
  ]);

  // Handle player action
  const submitAction = useCallback(
    (action: SimpleLegalAction) => {
      const engine = engineRef.current;
      if (!engine || gameState?.gameOver) return;
      if (optionalTriggerChoice) {
        addMessage('system', 'Choose whether to use the pending optional trigger first.');
        return;
      }
      if (damageAssignmentChoice) {
        addMessage('system', 'Choose combat damage order first.');
        return;
      }
      if (triggerOrderChoice) {
        addMessage('system', 'Order the pending triggers first.');
        return;
      }

      if (action.kind === 'SkipRestOfTurn') {
        skipRestOfTurn();
        return;
      }

      if (action.kind === 'SkipEmptyPhases') {
        skipEmptyPhases();
        return;
      }

      if (action.targetChoices?.length) {
        pendingTargetChoiceRef.current = {
          label: action.label,
          choices: action.targetChoices,
        };
        tutorRemainingRef.current = 0;
        tutorFilterRef.current = undefined;
        tutorFilterSpecRef.current = undefined;
        tutorTappedRef.current = false;
        tutorShuffleRef.current = false;
        tutorSourceNameRef.current = action.label;
        tutorSourceInstanceIdRef.current = action.cardInstanceId;
        tutorPromptRequestRef.current = null;
        setTutorTitle(action.label);
        setTutorCards(action.targetChoices.map(choice => {
          const card = engine.cards.get(choice.targetId);
          const def = card ? engine.cardDefinitions.get(card.definitionId) : undefined;
          const player = engine.players.find(candidate => candidate.id === choice.targetId);
          return {
            instanceId: choice.targetId,
            name: choice.label,
            typeLine: def?.type_line || (player ? 'Player' : 'Target'),
            manaCost: def?.mana_cost || '',
            oracleText: def?.oracle_text,
            colors: def?.colors,
            cmc: def?.cmc,
            legal: true,
            reason: 'Legal target from the current engine prompt',
            destination: 'choice' as const,
          };
        }));
        setTutorPhase(true);
        addMessage('system', `Choose a target for ${action.label}.`);
        syncState();
        return;
      }

      const engineAction = action._engineAction;
      if (!engineAction) {
        console.warn('No engine action attached to', action);
        return;
      }

      pendingCastSelectCardsPromptRef.current = null;

      if (needsMoxDiamondDiscardChoice(engineAction, engine as GameState)) {
        const card = engine.cards.get(engineAction.cardInstanceId);
        const def = card ? engine.cardDefinitions.get(card.definitionId) : undefined;
        const discardRequest = createSelectCardsPromptRequest(engine as GameState, humanIdRef.current, {
          subject: 'AdditionalCost',
          zone: 'hand',
          destination: 'graveyard',
          filter: { types: ['land'] },
          commitSelection: false,
          minSelections: 1,
          maxSelections: 1,
        });
        const discardOptions = discardRequest.legalChoices
          .filter(choice => choice.cardInstanceId !== engineAction.cardInstanceId)
          .flatMap(choice => {
            const handCard = engine.cards.get(choice.cardInstanceId);
            if (!handCard) return [];
            const option = toTutorCardOption(engine as GameState, handCard);
            return option
              ? [{ ...option, legal: true, reason: choice.reason || 'Land card you can discard', destination: 'graveyard' as const }]
              : [];
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        if (discardOptions.length > 0) {
          pendingCastChoiceActionRef.current = action;
          pendingCastChoiceModeRef.current = 'discardLand';
          pendingCastSelectCardsPromptRef.current = discardRequest;
          tutorRemainingRef.current = 0;
          tutorFilterRef.current = undefined;
          tutorFilterSpecRef.current = undefined;
          tutorTappedRef.current = false;
          tutorShuffleRef.current = false;
          tutorSourceNameRef.current = def?.name || 'Cast choice';
          tutorSourceInstanceIdRef.current = undefined;
          tutorPromptRequestRef.current = null;
          setTutorTitle(`${def?.name || 'Mox Diamond'}: discard a land card`);
          setTutorCards(discardOptions);
          setTutorPhase(true);
          addMessage('system', `Choose a land to discard so ${def?.name || 'Mox Diamond'} can enter the battlefield.`);
          syncState();
          return;
        }
      }

      if (needsCastSacrificeCreatureChoice(engineAction, engine as GameState)) {
        const card = engine.cards.get(engineAction.cardInstanceId);
        const def = card ? engine.cardDefinitions.get(card.definitionId) : undefined;
        const sacrificeOptions = [...engine.cards.values()]
          .filter(instance => instance.zone === 'battlefield')
          .filter(instance => {
            const permanentDef = engine.cardDefinitions.get(instance.definitionId);
            return permanentDef?.card_types.includes('creature');
          })
          .flatMap(instance => {
            const option = toTutorCardOption(engine as GameState, instance);
            return option
              ? [{ ...option, legal: true, reason: 'Creature that can be sacrificed', destination: 'graveyard' as const }]
              : [];
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        if (sacrificeOptions.length > 0) {
          pendingCastChoiceActionRef.current = action;
          pendingCastChoiceModeRef.current = 'sacrificeCreature';
          tutorRemainingRef.current = 0;
          tutorFilterRef.current = undefined;
          tutorFilterSpecRef.current = { types: ['creature'] };
          tutorTappedRef.current = false;
          tutorShuffleRef.current = false;
          tutorSourceNameRef.current = def?.name || 'Cast choice';
          tutorSourceInstanceIdRef.current = undefined;
          tutorPromptRequestRef.current = null;
          setTutorTitle(`${def?.name || 'Cast trigger'}: choose a creature to sacrifice, or cancel to decline`);
          setTutorCards(sacrificeOptions);
          setTutorPhase(true);
          addMessage('system', `${def?.name || 'This spell'} allows any player to sacrifice a creature to counter it.`);
          syncState();
          return;
        }
      }

      if (engineAction.kind === 'PlayLand') {
        const card = engine.cards.get(engineAction.cardInstanceId);
        const def = card ? engine.cardDefinitions.get(card.definitionId) : undefined;

        if (def && isCreatureTypeChoiceLand(def) && !engineAction.chosenCreatureType) {
          const creatureTypes = getCreatureTypeChoices(engine as GameState, humanIdRef.current);
          const typeOptions = (creatureTypes.length > 0 ? creatureTypes : ['Dragon'])
            .map(type => ({
              instanceId: type,
              name: type,
              typeLine: 'Creature type',
              manaCost: '',
              legal: true,
              reason: 'Available creature type choice',
              destination: 'choice' as const,
            }));

          pendingPlayLandChoiceRef.current = { kind: 'creatureType', action };
          tutorRemainingRef.current = 0;
          tutorFilterRef.current = undefined;
          tutorFilterSpecRef.current = undefined;
          tutorTappedRef.current = false;
          tutorShuffleRef.current = false;
          tutorSourceNameRef.current = def.name;
          tutorSourceInstanceIdRef.current = undefined;
          tutorPromptRequestRef.current = null;
          setTutorTitle(`${def.name}: choose a creature type`);
          setTutorCards(typeOptions);
          setTutorPhase(true);
          addMessage('system', `Choose a creature type for ${def.name}.`);
          syncState();
          return;
        }

        const optionalLifeCost = def ? getOptionalUntappedLifeCostFromText(def.oracle_text) : undefined;
        if (def && optionalLifeCost !== undefined && engineAction.payLifeToEnterUntapped === undefined) {
          pendingPlayLandChoiceRef.current = { kind: 'payLife', action };
          tutorRemainingRef.current = 0;
          tutorFilterRef.current = undefined;
          tutorFilterSpecRef.current = undefined;
          tutorTappedRef.current = false;
          tutorShuffleRef.current = false;
          tutorSourceNameRef.current = def.name;
          tutorSourceInstanceIdRef.current = undefined;
          tutorPromptRequestRef.current = null;
          setTutorTitle(`${def.name}: enter untapped?`);
          setTutorCards([
            {
              instanceId: 'pay-life',
              name: `Pay ${optionalLifeCost} life`,
              typeLine: 'Enter untapped',
              manaCost: '',
              legal: true,
              reason: 'Land enters untapped',
              destination: 'choice' as const,
            },
            {
              instanceId: 'enter-tapped',
              name: 'Enter tapped',
              typeLine: 'Do not pay life',
              manaCost: '',
              legal: true,
              reason: 'Land enters tapped',
              destination: 'choice' as const,
            },
          ]);
          setTutorPhase(true);
          addMessage('system', `Choose whether to pay ${optionalLifeCost} life for ${def.name}.`);
          syncState();
          return;
        }
      }

      // Snapshot state before meaningful human actions (for undo)
      // Skip mana taps and pass priority — only snapshot game-changing actions
      const isUndoable = action.kind !== 'ActivateManaAbility' && action.kind !== 'PassPriority';
      if (isUndoable && undosRemaining > 0) {
        undoStackRef.current.push({
          engine: cloneEngineState(engine),
          messages: [...chatMessages],
          log: [...gameLog],
          lastPlayedCard,
        });
        if (undoStackRef.current.length > 10) {
          undoStackRef.current.shift();
        }
      }

      try {
        // Capture review data before applying the action so post-game grading
        // can compare the chosen line against the available alternatives.
        let decisionReview: DecisionReview | undefined;
        try {
          decisionReview = buildDecisionReview(engine, humanIdRef.current, action, legalActions);
        } catch {
          // Review capture is optional and must not break gameplay.
        }
        let coachMessage: string | null = null;
        if (
          coachMode &&
          decisionReview &&
          engineAction.kind !== 'DeclareAttackers' &&
          engineAction.kind !== 'DeclareBlockers'
        ) {
          coachMessage = coachMessageFromDecision(decisionReview);
        } else if (coachMode && isUndoable && engineAction.kind !== 'DeclareAttackers' && engineAction.kind !== 'DeclareBlockers') {
          try {
            const allActions = getLegalActions(engine, humanIdRef.current);
            // Only evaluate if there were real choices (not just pass)
            const meaningfulActions = allActions.filter(a => a.kind !== 'PassPriority' && a.kind !== 'ActivateManaAbility');
            if (meaningfulActions.length > 1) {
              const ranked = evaluateActions(engine, humanIdRef.current, meaningfulActions);
              const humanIdx = ranked.findIndex(r => {
                if (r.action.kind !== engineAction.kind) return false;
                if ('cardInstanceId' in r.action && 'cardInstanceId' in engineAction) {
                  return r.action.cardInstanceId === engineAction.cardInstanceId;
                }
                return true;
              });
              const humanEval = humanIdx >= 0 ? ranked[humanIdx] : null;
              const bestEval = ranked[0];

              if (humanEval && humanIdx === 0) {
                coachMessage = `Optimal play.`;
              } else if (humanEval && bestEval) {
                const bestCard = 'cardInstanceId' in bestEval.action
                  ? engine.cards.get(bestEval.action.cardInstanceId)
                  : null;
                const bestDef = bestCard ? engine.cardDefinitions.get(bestCard.definitionId) : null;
                const bestName = bestDef?.name || bestEval.action.kind;
                const scoreDiff = bestEval.score - (humanEval?.score ?? 0);
                if (scoreDiff < 1) {
                  coachMessage = `Good play (close to optimal).`;
                } else {
                  coachMessage = `Consider: ${bestName} (score ${bestEval.score.toFixed(1)} vs your ${humanEval.score.toFixed(1)}). ${bestEval.reasoning || ''}`;
                }
              }
            }
          } catch {
            // Coach evaluation is optional — don't break the game
          }
        }

        let newState: GameState;
        const collectedEvents: ActionGameEvent[] = [];
        let authorityUpdateRecorded = false;

        const recordRejectedResponse = (
          response: ClientActionResponse,
          prefix: string,
          uiAction: SimpleLegalAction,
        ) => {
          if (response.update) {
            recordAuthorityUpdate(response.update);
            authorityUpdateRecorded = true;
          }
          appendLog({
            ...captureLogEntry(
              engine as GameState,
              humanIdRef.current,
              aiIdsRef.current,
              'human',
              `Rejected illegal action: ${uiAction.label}`,
              0,
              humanIdRef.current,
            ),
            playByPlay: `${uiAction.label} was rejected by the rules validator. State was not changed.`,
            rulesAudit: {
              severity: 'error',
              reason: response.message || 'That action is not legal in the current game state.',
            },
          });
          setActionError({
            reason: response.reason || 'illegal_action',
            message: response.message || 'That action is not legal in the current game state.',
          });
          addMessage('system', `${prefix}: ${response.message || 'That action is not legal in the current game state.'}`);
          syncState();
        };

        const applyAuthoritativeAction = (
          state: GameState,
          playerId: string,
          uiAction: SimpleLegalAction,
          options: { recordAcceptedUpdate?: boolean; rejectionPrefix?: string } = {},
        ): GameState | null => {
          const request = createClientActionRequest(state, playerId, uiAction._engineAction, {
            source: 'ui',
            label: uiAction.label,
          });
          const response = applyClientActionRequest(state, request);
          if (!response.ok || !response.state) {
            recordRejectedResponse(response, options.rejectionPrefix || 'Cannot apply action', uiAction);
            return null;
          }
          if (options.recordAcceptedUpdate !== false && response.update) {
            recordAuthorityUpdate(response.update);
            authorityUpdateRecorded = true;
          }
          if (response.events) {
            collectedEvents.push(...response.events);
          }
          return response.state;
        };

        const applyAuthoritativePaymentPrompt = (
          state: GameState,
          manaCost: ManaCost,
          manaActions: Extract<AIAction, { kind: 'ActivateManaAbility' }>[],
          sourceInstanceId: string | undefined,
          label: string,
        ): GameState | null => {
          const paymentRequest = createPayCostsPromptRequest(
            state,
            humanIdRef.current,
            manaCost,
            {
              sourceInstanceId,
              proposedManaActions: manaActions,
            },
          );
          const paymentResponse = applyPayCostsPromptResponse(state, paymentRequest, {
            requestId: paymentRequest.id,
            kind: 'PayCosts',
            playerId: humanIdRef.current,
            selectedManaActions: manaActions,
          });
          recordAuthorityUpdate(paymentResponse.update);
          if (!paymentResponse.ok || !paymentResponse.state) {
            appendLog({
              ...captureLogEntry(
                state,
                humanIdRef.current,
                aiIdsRef.current,
                'human',
                `Rejected mana payment for ${label}`,
                0,
                humanIdRef.current,
              ),
              playByPlay: `Mana payment for ${label} was rejected by the rules validator.`,
              rulesAudit: {
                severity: 'error',
                reason: paymentResponse.message || 'The selected mana payment is not legal in the current game state.',
              },
            });
            setActionError({
              reason: paymentResponse.reason || 'illegal_response',
              message: paymentResponse.message || 'The selected mana payment is not legal in the current game state.',
            });
            addMessage('system', `Cannot pay costs: ${paymentResponse.message || 'That mana payment is not legal.'}`);
            syncState();
            return null;
          }

          authorityUpdateRecorded = true;
          addMessage('system', `Auto-pay accepted for ${label}: ${describeManaPaymentPlan(state, humanIdRef.current, manaActions)}.`);
          return paymentResponse.state as GameState;
        };

        const validateTargetPromptResponse = (
          state: GameState,
          spec: TargetSpec | undefined,
          selectedTargetIds: string[],
          sourceInstanceId: string | undefined,
          label: string,
        ): boolean => {
          if (!spec || selectedTargetIds.length === 0) return true;
          const targetRequest = createSelectTargetPromptRequest(state, humanIdRef.current, spec, {
            sourceInstanceId,
          });
          const targetResponse = applySelectTargetPromptResponse(state, targetRequest, {
            requestId: targetRequest.id,
            kind: 'SelectTarget',
            playerId: humanIdRef.current,
            selectedTargetIds,
          });
          recordAuthorityUpdate(targetResponse.update);
          if (targetResponse.ok) return true;

          appendLog({
            ...captureLogEntry(
              state,
              humanIdRef.current,
              aiIdsRef.current,
              'human',
              `Rejected illegal target for ${label}`,
              0,
              humanIdRef.current,
            ),
            playByPlay: `Target selection for ${label} was rejected by the rules validator.`,
            rulesAudit: {
              severity: 'error',
              reason: targetResponse.message || 'That target is not legal in the current game state.',
            },
          });
          setActionError({
            reason: targetResponse.reason || 'illegal_response',
            message: targetResponse.message || 'That target is not legal in the current game state.',
          });
          addMessage('system', `Cannot choose target: ${targetResponse.message || 'That target is not legal in the current game state.'}`);
          syncState();
          return false;
        };

        // For DeclareAttackers with no actual attacks, skip combat through
        // authority-recorded no-op declarations and priority passes.
        if (engineAction.kind === 'DeclareAttackers' && engineAction.attacks.length === 0) {
          const attackState = applyAuthoritativeAction(
            engine as GameState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot declare attackers' },
          );
          if (!attackState) {
            return;
          }
          newState = attackState;
          let combatSafety = 20;
          while (
            (newState.step === 'declare_attackers' ||
             newState.step === 'declare_blockers' ||
             newState.step === 'first_strike_damage' ||
             newState.step === 'combat_damage' ||
             newState.step === 'end_of_combat') &&
            combatSafety-- > 0
          ) {
            let passGuard = newState.players.length + 2;
            while (
              !newState.hasPriorityPassed.every((passed, index) => passed || newState.players[index].hasLost) &&
              passGuard-- > 0
            ) {
              const priorityPlayer = newState.players[newState.priorityPlayerIndex];
              if (!priorityPlayer) break;
              const passResponse = applyActionThroughAuthority(
                newState,
                priorityPlayer.id,
                { kind: 'PassPriority' },
                {
                  source: priorityPlayer.id === humanIdRef.current ? 'system' : 'ai',
                  label: toSimpleLegalAction({ kind: 'PassPriority' }, newState).label,
                },
              );
              authorityUpdateRecorded = true;
              if (passResponse.events) {
                collectedEvents.push(...passResponse.events);
              }
              if (!passResponse.ok || !passResponse.state) {
                addMessage('system', `Could not skip combat priority: ${passResponse.message || 'priority pass was rejected.'}`);
                break;
              }
              newState = passResponse.state;
            }
            newState = advanceStepWithAuthority(newState);
          }
        } else if (engineAction.kind === 'CastSpell') {
          // Auto-tap lands if needed before casting the spell
          const humanId = humanIdRef.current;
          const card = engine.cards.get(engineAction.cardInstanceId);
          const player = engine.players.find(p => p.id === humanId);

          let precastState: GameState = engine as GameState;

          if (engineAction.chosenModes?.length) {
            const modeRequest = createChooseModePromptRequest(
              precastState,
              humanIdRef.current,
              engineAction.cardInstanceId,
            );
            const modeResponse = applyChooseModePromptResponse(precastState, modeRequest, {
              requestId: modeRequest.id,
              kind: 'ChooseMode',
              playerId: humanIdRef.current,
              selectedModeIndices: engineAction.chosenModes,
            });
            recordAuthorityUpdate(modeResponse.update);
            if (!modeResponse.ok) {
              appendLog({
                ...captureLogEntry(
                  precastState,
                  humanIdRef.current,
                  aiIdsRef.current,
                  'human',
                  `Rejected mode choice for ${action.label}`,
                  0,
                  humanIdRef.current,
                ),
                playByPlay: `Mode choice for ${action.label} was rejected by the rules validator.`,
                rulesAudit: {
                  severity: 'error',
                  reason: modeResponse.message || 'That mode choice is not legal in the current game state.',
                },
              });
              setActionError({
                reason: modeResponse.reason || 'illegal_response',
                message: modeResponse.message || 'That mode choice is not legal in the current game state.',
              });
              addMessage('system', `Cannot choose mode: ${modeResponse.message || 'That mode choice is not legal.'}`);
              syncState();
              return;
            }
            authorityUpdateRecorded = true;
          }

          if (card && player) {
            const targetSpecs = getSpellTargetSpecs(engine as GameState, card);
            if (
              targetSpecs.length === 1
              && !validateTargetPromptResponse(
                engine as GameState,
                targetSpecs[0],
                engineAction.targets,
                engineAction.cardInstanceId,
                action.label,
              )
            ) {
              return;
            }

            const def = getCardDefinition(engine, card);
            const isFromCommandZone = card.zone === 'command';
            const taxAmount = isFromCommandZone ? getCommanderCastCount(player, card.instanceId) * 2 : 0;
            const totalCost = reducedSpellCost(engine, humanId, def, taxAmount);

            if (!canPayCost(player.manaPool, totalCost)) {
              // Need to auto-tap lands first
              const currentActions = getLegalActions(engine, humanId);
              const manaActions = currentActions.filter(a => a.kind === 'ActivateManaAbility');
              const landsToTap = findLandsToTap(engine, humanId, totalCost, manaActions);

              if (landsToTap && landsToTap.length > 0) {
                const tapState = applyAuthoritativePaymentPrompt(
                  engine as GameState,
                  totalCost,
                  landsToTap,
                  engineAction.cardInstanceId,
                  action.label,
                );
                if (!tapState) return;
                const poolBeforeCast = tapState.players.find(p => p.id === humanId)?.manaPool;
                addMessage('system', `Mana available: ${poolBeforeCast ? formatManaPool(poolBeforeCast) : '?'}`);
                precastState = tapState;
              }
              // If no lands found, fall through with original state (tryCastSpell will report error)
            } else {
              // Already have enough mana in pool
              const poolBeforeCast = player.manaPool;
              addMessage('system', `Using floating mana: ${formatManaPool(poolBeforeCast)}`);
            }
          }

          const castState = applyAuthoritativeAction(
            precastState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot cast' },
          );
          if (!castState) {
            return;
          }
          newState = castState;
        } else if (engineAction.kind === 'PlayLand') {
          const playedState = applyAuthoritativeAction(
            engine as GameState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot play land' },
          );
          if (!playedState) {
            return;
          }
          newState = playedState;
        } else if (engineAction.kind === 'ActivateManaAbility') {
          const manaState = applyAuthoritativeAction(
            engine as GameState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot tap for mana' },
          );
          if (!manaState) {
            return;
          }
          newState = manaState;
        } else if (engineAction.kind === 'ActivateAbility') {
          let preActivateState = engine as GameState;
          const abilities = getActivatedAbilities(preActivateState, engineAction.cardInstanceId);
          const ability = abilities[engineAction.abilityIndex];
          if (ability?.targets?.length === 1) {
            const targetSpec: TargetSpec = {
              id: ability.targets[0].id,
              type: ability.targets[0].type as TargetSpec['type'],
              count: 1,
            };
            if (!validateTargetPromptResponse(
              preActivateState,
              targetSpec,
              engineAction.targets,
              engineAction.cardInstanceId,
              action.label,
            )) {
              return;
            }
          }
          const abilityCost = ability?.cost.mana ? parseManaString(ability.cost.mana) : null;

          if (abilityCost) {
            const player = preActivateState.players.find(p => p.id === humanIdRef.current);
            if (player && !canPayCost(player.manaPool, abilityCost)) {
              const manaActions = getLegalActions(preActivateState, humanIdRef.current).filter(
                (a): a is { kind: 'ActivateManaAbility'; cardInstanceId: string; color: ManaColor } =>
                  a.kind === 'ActivateManaAbility',
              );
              const landsToTap = findLandsToTap(preActivateState, humanIdRef.current, abilityCost, manaActions);
              if (landsToTap && landsToTap.length > 0) {
                const tapState = applyAuthoritativePaymentPrompt(
                  preActivateState,
                  abilityCost,
                  landsToTap,
                  engineAction.cardInstanceId,
                  action.label,
                );
                if (!tapState) return;
                const poolBeforeAbility = tapState.players.find(p => p.id === humanIdRef.current)?.manaPool;
                addMessage('system', `Mana available: ${poolBeforeAbility ? formatManaPool(poolBeforeAbility) : '?'}`);
                preActivateState = tapState;
              }
            } else if (player) {
              addMessage('system', `Using floating mana: ${formatManaPool(player.manaPool)}`);
            }
          }

          const activatedState = applyAuthoritativeAction(
            preActivateState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot activate ability' },
          );
          if (!activatedState) {
            return;
          }
          newState = activatedState;
        } else if (engineAction.kind === 'PassPriority') {
          const passedState = applyAuthoritativeAction(
            engine as GameState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot pass priority' },
          );
          if (!passedState) {
            return;
          }
          newState = passedState;
        } else if (engineAction.kind === 'DeclareAttackers') {
          const attackState = applyAuthoritativeAction(
            engine as GameState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot declare attackers' },
          );
          if (!attackState) {
            return;
          }
          newState = attackState;
        } else if (engineAction.kind === 'DeclareBlockers') {
          const blockState = applyAuthoritativeAction(
            engine as GameState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot declare blockers' },
          );
          if (!blockState) {
            return;
          }
          newState = blockState;
        } else if (engineAction.kind === 'Equip') {
          let preEquipState = engine as GameState;
          if (!validateTargetPromptResponse(
            preEquipState,
            { id: 'equip-target', type: 'Creature', count: 1 },
            [engineAction.targetCreatureId],
            engineAction.equipmentInstanceId,
            action.label,
          )) {
            return;
          }
          const equipment = preEquipState.cards.get(engineAction.equipmentInstanceId);
          const equipDef = equipment ? getCardDefinition(preEquipState, equipment) : undefined;
          const equipCost = equipDef?.equipCost ? { ...equipDef.equipCost } as ManaCost : null;

          if (equipCost) {
            const player = preEquipState.players.find(p => p.id === humanIdRef.current);
            if (player && !canPayCost(player.manaPool, equipCost)) {
              const manaActions = getLegalActions(preEquipState, humanIdRef.current).filter(
                (a): a is { kind: 'ActivateManaAbility'; cardInstanceId: string; color: ManaColor } =>
                  a.kind === 'ActivateManaAbility',
              );
              const landsToTap = findLandsToTap(preEquipState, humanIdRef.current, equipCost, manaActions);
              if (landsToTap && landsToTap.length > 0) {
                const tapState = applyAuthoritativePaymentPrompt(
                  preEquipState,
                  equipCost,
                  landsToTap,
                  engineAction.equipmentInstanceId,
                  action.label,
                );
                if (!tapState) return;
                const poolBeforeEquip = tapState.players.find(p => p.id === humanIdRef.current)?.manaPool;
                addMessage('system', `Mana available: ${poolBeforeEquip ? formatManaPool(poolBeforeEquip) : '?'}`);
                preEquipState = tapState;
              }
            } else if (player) {
              addMessage('system', `Using floating mana: ${formatManaPool(player.manaPool)}`);
            }
          }

          const equippedState = applyAuthoritativeAction(
            preEquipState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot equip' },
          );
          if (!equippedState) {
            return;
          }
          newState = equippedState;
        } else {
          const fallbackState = applyAuthoritativeAction(
            engine as GameState,
            humanIdRef.current,
            action,
            { rejectionPrefix: 'Cannot apply action' },
          );
          if (!fallbackState) {
            return;
          }
          newState = fallbackState;
        }

        if (action.kind === 'PlayLand') {
          rememberLastPlayedCard(newState, action.cardInstanceId, humanIdRef.current, 'Played');
        } else if (action.kind === 'CastSpell') {
          rememberLastPlayedCard(newState, action.cardInstanceId, humanIdRef.current, 'Cast');
        } else if (action.kind === 'ActivateAbility' || action.kind === 'Equip') {
          rememberLastPlayedCard(newState, action.cardInstanceId, humanIdRef.current, 'Activated');
        }

        // Accumulate events from this action and open the EndGameModal if needed
        applyEvents(collectedEvents, newState);
        if (!authorityUpdateRecorded) {
          recordStateUpdate(engine as GameState, newState, action, collectedEvents);
        }

        // Track uncommitted mana taps (can be untapped) vs committed (used for a spell)
        if (engineAction.kind === 'ActivateManaAbility' && 'cardInstanceId' in engineAction) {
          const activatedCard = newState.cards.get(engineAction.cardInstanceId);
          if (activatedCard?.zone === 'battlefield' && activatedCard.tapped) {
            const poolBefore = engine.players.find(p => p.id === humanIdRef.current)?.manaPool;
            const poolAfterTap = newState.players.find(p => p.id === humanIdRef.current)?.manaPool;
            const amount = poolBefore && poolAfterTap
              ? Math.max(0, poolAfterTap[engineAction.color] - poolBefore[engineAction.color])
              : 1;
            uncommittedTapsRef.current.set(engineAction.cardInstanceId, {
              color: engineAction.color,
              amount: Math.max(0, amount),
            });
          }
        } else if (engineAction.kind === 'CastSpell' || engineAction.kind === 'ActivateAbility' || engineAction.kind === 'Equip') {
          // Mana was spent on a spell or ability, so manual taps are now committed.
          uncommittedTapsRef.current.clear();
        }

        // Log what the player did with mana context
        const poolAfter = newState.players.find(p => p.id === humanIdRef.current)?.manaPool;
        const poolStr = poolAfter ? formatManaPool(poolAfter) : 'empty';

        if (action.kind === 'PlayLand') {
          addMessage('player', `Played ${action.cardName || 'a land'}.`);
        } else if (action.kind === 'CastSpell') {
          // Show what was spent
          const castAction = engineAction as { kind: 'CastSpell'; cardInstanceId: string };
          const cardInst = engine.cards.get(castAction.cardInstanceId);
          const cardDef = cardInst ? getCardDefinition(engine, cardInst) : undefined;
          const costStr = cardDef?.mana_cost || '?';
          // Check if this spell produces mana (ritual) — don't show "Floating: empty" since it'll resolve to add mana
          const isManaSpell = cardDef?.oracle_text?.toLowerCase().includes('add {') || cardDef?.oracle_text?.toLowerCase().includes('add mana');
          const floatingNote = isManaSpell ? '(resolving...)' : `Floating: ${poolStr}`;
          addMessage('player', `Cast ${action.cardName || 'a spell'} (cost: ${costStr}). ${floatingNote}`);
        } else if (action.kind === 'PassPriority') {
          // Use context-aware label from the action
          const passMsg = engine.stack.length > 0 ? 'Chose not to respond.' : action.label + '.';
          addMessage('player', passMsg);
        } else if (action.kind === 'DeclareAttackers') {
          addMessage('player', action.label);
        } else if (action.kind === 'DeclareBlockers') {
          addMessage('player', action.label);
        } else if (action.kind === 'ActivateAbility') {
          const msg = action.label.startsWith('Equip')
            ? `${action.label}. Floating: ${poolStr}`
            : `Activated ${action.cardName || 'an ability'}.`;
          addMessage('player', msg);
        } else if (action.kind === 'Equip') {
          addMessage('player', `${action.label}. Floating: ${poolStr}`);
        } else if (action.kind === 'ActivateManaAbility') {
          // Show mana gained and floating total
          const poolBefore = engine.players.find(p => p.id === humanIdRef.current)?.manaPool;
          const gained: string[] = [];
          if (poolAfter && poolBefore) {
            for (const c of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
              const diff = poolAfter[c] - poolBefore[c];
              if (diff > 0) gained.push(`+${diff}${c}`);
            }
          }
          const gainStr = gained.length > 0 ? gained.join(' ') : '+1 mana';
          addMessage('player', `Tapped ${action.cardName || 'a permanent'} (${gainStr}). Floating: ${poolStr}`);
        }
        // Note: ActivateManaAbility now has narration for manual tapping

        // Record game log entry for meaningful human actions
        if (action.kind !== 'ActivateManaAbility') {
          const humanAction = action.kind === 'PlayLand'
            ? `Played ${action.cardName || 'a land'}`
            : action.kind === 'CastSpell'
            ? `Cast ${action.cardName || 'a spell'}`
            : action.kind === 'DeclareAttackers'
            ? action.label
            : action.kind === 'DeclareBlockers'
            ? action.label
            : action.kind === 'ActivateAbility'
            ? `Activated ${action.cardName || 'an ability'}`
            : action.kind === 'Equip'
            ? action.label
            : action.kind === 'PassPriority'
            ? 'Passed priority'
            : action.label;
          // Estimate mana spent from CMC of card if it was a cast
          let manaSpent = 0;
          if (action.kind === 'CastSpell' && action.cardInstanceId) {
            const card = newState.cards.get(action.cardInstanceId);
            if (card) {
              const def = getCardDefinition(newState, card);
              const cost = parseManaString(def.mana_cost);
              manaSpent = manaCostValue(cost);
            }
          }
          appendLog(captureLogEntry(
            newState, humanIdRef.current, aiIdsRef.current,
            'human', humanAction, manaSpent,
            undefined,
            decisionReview,
          ));
        }

        if (engineAction.kind === 'ActivateManaAbility') {
          engineRef.current = newState as GameStateWithAI;
          syncState();
          return;
        }

        // Run the game loop: resolve stack, advance steps, run AI turns
        const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
        const loopLogEntries: GameLogEntry[] = [];
        newState = advanceGameLoop(newState, loopMessages, loopLogEntries);

        // Commit state
        engineRef.current = newState as GameStateWithAI;

        // Check if mana pool changed after spell resolution (e.g., rituals add mana)
        const poolAfterLoop = newState.players.find(p => p.id === humanIdRef.current)?.manaPool;
        if (poolAfterLoop && poolAfter) {
          const totalBefore = Object.values(poolAfter).reduce((a, b) => a + b, 0);
          const totalAfterLoop = Object.values(poolAfterLoop).reduce((a, b) => a + b, 0);
          if (totalAfterLoop > totalBefore) {
            // Mana was added by spell resolution (ritual, mana dork trigger, etc.)
            const gained: string[] = [];
            for (const c of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
              const diff = poolAfterLoop[c] - poolAfter[c];
              if (diff > 0) gained.push(`+${diff}${c}`);
            }
            addMessage('system', `Spell resolved: ${gained.join(' ')} added. Floating: ${formatManaPool(poolAfterLoop)}`);
          }
        }

        // Add accumulated messages
        for (const msg of loopMessages) {
          addMessage(msg.role, msg.text);
        }

        // Add accumulated log entries from AI turns
        if (loopLogEntries.length > 0) {
          setGameLog(prev => [...prev, ...loopLogEntries]);
        }

        // Check game over
        const humanP = newState.players.find(p => p.id === humanIdRef.current);
        const allAIsLost = aiIdsRef.current.every(id => {
          const p = newState.players.find(pl => pl.id === id);
          return p?.hasLost;
        });
        if (humanP?.hasLost) {
          addMessage('system', 'You have been defeated!');
        } else if (allAIsLost) {
          addMessage('system', 'Victory! The Shelector has been defeated!');
        }

        // Coach feedback
        if (coachMessage) {
          addMessage('system', `Coach: ${coachMessage}`);
        }

        // Sync display
        syncState();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Action failed';
        addMessage('system', `Error: ${msg}`);
        console.error('Action error:', err);
        syncState();
      }
    },
    [gameState, addMessage, appendLog, syncState, advanceGameLoop, advanceStepWithAuthority, applyActionThroughAuthority, applyEvents, damageAssignmentChoice, lastPlayedCard, optionalTriggerChoice, rememberLastPlayedCard, recordAuthorityUpdate, recordStateUpdate, skipEmptyPhases, skipRestOfTurn, triggerOrderChoice],
  );
  submitActionRef.current = submitAction;

  const exportGameSave = useCallback((): ShelectorGameSaveSnapshot | null => {
    const engine = engineRef.current;
    if (!engine) return null;
    return {
      version: 1,
      savedAt: Date.now(),
      engine: serializeGameState(engine),
      humanDeck: humanDeckRef.current,
      aiDecks: aiDecksRef.current,
      humanCommander: humanCommanderRef.current,
      aiCommanderNames: aiCommanderNamesRef.current,
      humanId: humanIdRef.current,
      aiIds: aiIdsRef.current,
      opponentInfo,
      chatMessages,
      gameLog,
      authorityUpdates,
      lastStateUpdate,
      currentPrompt,
      lastPlayedCard,
      mulliganPhase,
      mulliganCount,
      selectedMulliganCardIds,
      selectedMulliganBottomIds,
      discardPhase,
      discardCount,
      tutorPhase,
      tutorCards,
      tutorTitle,
      libraryChoice,
      optionalTriggerChoice,
      damageAssignmentChoice,
      triggerOrderChoice,
      undosRemaining,
      coachMode,
      newPlayerMode,
      holdPriority,
      actionError,
      lastEvents,
      endGame,
    };
  }, [
    opponentInfo,
    chatMessages,
    gameLog,
    authorityUpdates,
    lastStateUpdate,
    currentPrompt,
    lastPlayedCard,
    mulliganPhase,
    mulliganCount,
    selectedMulliganCardIds,
    selectedMulliganBottomIds,
    discardPhase,
    discardCount,
    tutorPhase,
    tutorCards,
    tutorTitle,
    libraryChoice,
    optionalTriggerChoice,
    damageAssignmentChoice,
    triggerOrderChoice,
    undosRemaining,
    coachMode,
    newPlayerMode,
    holdPriority,
    actionError,
    lastEvents,
    endGame,
  ]);

  const restoreGameSave = useCallback((snapshot: ShelectorGameSaveSnapshot): boolean => {
    try {
      if (!snapshot || snapshot.version !== 1) {
        throw new Error('Unsupported save snapshot');
      }
      const restored = deserializeGameState(snapshot.engine) as GameStateWithAI;
      const aiIdSet = new Set(snapshot.aiIds || []);
      restored.players = restored.players.map(player => ({
        ...player,
        isAI: aiIdSet.has(player.id),
      }));

      engineRef.current = restored;
      humanDeckRef.current = snapshot.humanDeck;
      aiDecksRef.current = snapshot.aiDecks || [];
      humanCommanderRef.current = snapshot.humanCommander || 'Unknown Commander';
      aiCommanderNamesRef.current = snapshot.aiCommanderNames || {};
      humanIdRef.current = snapshot.humanId || 'human';
      aiIdsRef.current = snapshot.aiIds || [];
      cardLookupRef.current = (name: string) => {
        const normalized = normalizeLookupName(name);
        for (const def of restored.cardDefinitions.values()) {
          if (normalizeLookupName(def.name) === normalized) {
            return {
              id: def.id,
              name: def.name,
              type_line: def.type_line,
              oracle_text: def.oracle_text,
              mana_cost: def.mana_cost,
              cmc: def.cmc,
              colors: def.colors,
              color_identity: def.color_identity,
              keywords: def.keywords,
              power: def.power?.toString() ?? null,
              toughness: def.toughness?.toString() ?? null,
            } as ScryfallCard;
          }
        }
        return undefined;
      };

      undoStackRef.current = [];
      uncommittedTapsRef.current.clear();
      stepEffectsDoneRef.current.clear();
      pendingCastChoiceActionRef.current = null;
      pendingCastSelectCardsPromptRef.current = null;
      pendingPlayLandChoiceRef.current = null;
      pendingSearchEntryChoiceRef.current = null;
      pendingTargetChoiceRef.current = null;
      libraryManipulationPromptRequestRef.current = null;
      const restoredLibraryChoice = snapshot.libraryChoice || null;
      pendingLibraryChoiceRef.current = restoredLibraryChoice
        ? { stackItemId: restoredLibraryChoice.id.split(':')[0], mode: restoredLibraryChoice.mode }
        : null;
      setOpponentInfo(snapshot.opponentInfo || null);
      setChatMessages(snapshot.chatMessages || []);
      setGameLog(snapshot.gameLog || []);
      setAuthorityUpdates(snapshot.authorityUpdates || []);
      setLastStateUpdate(snapshot.lastStateUpdate || null);
      setLastPlayedCard(snapshot.lastPlayedCard || null);
      setMulliganPhase(Boolean(snapshot.mulliganPhase));
      setMulliganCount(snapshot.mulliganCount || 0);
      setSelectedMulliganCardIds(snapshot.selectedMulliganCardIds || []);
      setSelectedMulliganBottomIds(snapshot.selectedMulliganBottomIds || []);
      setDiscardPhase(Boolean(snapshot.discardPhase));
      setDiscardCount(snapshot.discardCount || 0);
      discardCountRef.current = snapshot.discardCount || 0;
      setTutorPhase(Boolean(snapshot.tutorPhase));
      setTutorCards(snapshot.tutorCards || []);
      setTutorTitle(snapshot.tutorTitle || '');
      setLibraryChoice(restoredLibraryChoice);
      const restoredOptionalTriggerChoice = snapshot.optionalTriggerChoice || null;
      optionalTriggerPromptRequestRef.current = restoredOptionalTriggerChoice
        ? createOptionalTriggerPromptRequest(restored, humanIdRef.current, restoredOptionalTriggerChoice.triggerId, {
            id: restoredOptionalTriggerChoice.id,
          })
        : null;
      setOptionalTriggerChoice(restoredOptionalTriggerChoice);
      const restoredDamageAssignmentChoice = snapshot.damageAssignmentChoice || null;
      damageAssignmentPromptRequestRef.current = restoredDamageAssignmentChoice
        ? createDamageAssignmentPromptRequest(restored, humanIdRef.current, {
            id: restoredDamageAssignmentChoice.id,
          })
        : null;
      setDamageAssignmentChoice(restoredDamageAssignmentChoice);
      const restoredTriggerOrderChoice = snapshot.triggerOrderChoice || null;
      triggerOrderPromptRequestRef.current = restoredTriggerOrderChoice
        ? createOrderTriggersPromptRequest(restored, humanIdRef.current, {
            id: restoredTriggerOrderChoice.id,
          })
        : null;
      setTriggerOrderChoice(restoredTriggerOrderChoice);
      setUndosRemaining(snapshot.undosRemaining ?? 10);
      setCoachMode(Boolean(snapshot.coachMode));
      setNewPlayerMode(Boolean(snapshot.newPlayerMode));
      setHoldPriority(Boolean(snapshot.holdPriority));
      setActionError(snapshot.actionError || null);
      setLastEvents(snapshot.lastEvents || []);
      setEndGame(snapshot.endGame || { open: false, kind: 'loss' });
      setIsLoading(false);
      setError(null);
      syncState();
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not restore save';
      setError(msg);
      console.error('Restore save error:', err);
      return false;
    }
  }, [setCoachMode, setHoldPriority, setNewPlayerMode, syncState]);

  const isHumanTurn = gameState?.priorityPlayerId === humanIdRef.current;
  const isGameOver = gameState?.gameOver ?? false;
  const winner = gameState?.winnerId ?? null;

  return {
    // State
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
    mulliganBottomCount: mulliganPhase && mulliganCount > 0 ? mulliganCount : 0,
    selectedMulliganCardIds,
    selectedMulliganBottomIds,
    discardPhase,
    discardCount,
    tutorPhase,
    tutorCards,
    tutorTitle,
      libraryChoice,
      optionalTriggerChoice,
      damageAssignmentChoice,
      triggerOrderChoice,
      gameLog,
      authorityUpdates,
      lastStateUpdate,
      currentPrompt,
      lastPlayedCard,
      undosRemaining,
    coachMode,
    newPlayerMode,
    holdPriority,
    untappableCardIds: [...uncommittedTapsRef.current.keys()],
    // try* error state (Task 7)
    actionError,
    lastEvents,

    // End-game modal state and handlers (Task 27)
    endGame,
    closeEndGame: () => setEndGame(prev => ({ ...prev, open: false })),
    newGame: () => {
      resetLoopDetector();
      setEndGame({ open: false, kind: 'loss' });
      setLastEvents([]);
    },
    declareDraw: () => setEndGame({ open: false, kind: 'loop' }),
    concedeGame: () => setEndGame({ open: true, kind: 'loss', reason: 'concede' }),
    playItOut: () => {
      resetLoopDetector();
      setEndGame(prev => ({ ...prev, open: false }));
    },
    reviewLog: () => setEndGame(prev => ({ ...prev, open: false })),

    // Actions
    spawnOpponent,
    startGame,
    exportGameSave,
    restoreGameSave,
    submitAction,
    keepHand,
    mulligan,
    toggleMulliganCard,
    toggleMulliganBottomCard,
    discardCard,
    resolveTutor,
    cancelTutor,
    resolveLibraryChoice,
    resolveOptionalTriggerChoice,
    resolveDamageAssignmentChoice,
    resolveTriggerOrderChoice,
    undoAction,
    setCoachMode,
    setNewPlayerMode,
    setHoldPriority,
    untapManaSource,
    adjustCounters,
    clearActionError: () => setActionError(null),
  };
}
