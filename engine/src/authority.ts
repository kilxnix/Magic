import type {
  CardDefinition,
  CardInstance,
  GameState,
  ManaCost,
  ManaColor,
  ManaPool,
  PendingTrigger,
  Phase,
  StackItem,
  Step,
  Zone,
} from './types';
import { getLegalActions } from './ai/legal-actions';
import { getLegalTargets } from './ai/legal-actions';
import { dispatchAIAction } from './ai/agent';
import { canPlayLandDetailed } from './actions';
import { canPayCost } from './mana';
import {
  checkTriggersForEvent,
  createETBTriggers,
  putPendingTriggerOnStack,
  putTriggersOnStack,
  registerBattlefieldAbilities,
  registerContinuousAbilitiesForPermanent,
} from './stack';
import { executeSearchLibrary, executeShuffleLibrary, matchesCardFilter } from './effects/executor';
import { getEffectivePower, getEffectiveToughness } from './effects/continuous';
import { parseOracleText } from './effects/parser';
import { getOverride } from './effects/overrides';
import { getOptionalUntappedLifeCost } from './permanent-entry';
import { validateStateInvariants } from './invariants';
import { instanceHasKeyword } from './keywords';
import type { AIAction } from './ai/types';
import type { ActionFailure, GameEvent as ActionGameEvent } from './actions-public';
import type { CardFilter, Effect, SearchLibraryEffect, TargetRef } from './effects/ast';
import type { TargetSpec } from './effects/targets';
import { getCardDefinition } from './game-state';

export type ClientActionSource = 'ui' | 'ai' | 'system';

export interface ClientActionRequest {
  id: string;
  playerId: string;
  action: AIAction;
  actionId?: string;
  source: ClientActionSource;
  label?: string;
  expectedStateId?: string;
  expectedPromptId?: string;
  createdAt: number;
}

export type ClientActionFailure = ActionFailure | 'illegal_action' | 'stale_state' | 'invariant_violation';

export interface ClientActionResponse {
  requestId: string;
  ok: boolean;
  reason?: ClientActionFailure;
  message?: string;
  state?: GameState;
  events?: ActionGameEvent[];
  update?: EngineStateUpdate;
}

export type EnginePromptKind =
  | 'SearchLibrary'
  | 'SelectTarget'
  | 'ChooseReplacement'
  | 'PayCosts'
  | 'SelectCards'
  | 'LibraryManipulation'
  | 'OptionalTrigger'
  | 'OrderTriggers'
  | 'DamageAssignment'
  | 'ChooseMode';

export type ClientPromptFailure =
  | 'invalid_request'
  | 'wrong_player'
  | 'stale_state'
  | 'illegal_response'
  | 'invariant_violation';

export type SearchLibraryDestination = 'battlefield' | 'hand' | 'top' | 'graveyard';

export type PromptRevealPolicy = 'hidden' | 'reveal' | 'public';

export interface SearchLibraryChoice {
  cardInstanceId: string;
  cardName: string;
  legal: boolean;
  reason?: string;
  destination: SearchLibraryDestination;
}

export interface SearchLibraryPromptRequest {
  id: string;
  kind: 'SearchLibrary';
  playerId: string;
  sourceInstanceId?: string;
  expectedStateId: string;
  filter: CardFilter;
  destination: SearchLibraryDestination;
  tapped?: boolean;
  shuffle: boolean;
  revealPolicy: PromptRevealPolicy;
  minSelections: number;
  maxSelections: number;
  legalChoices: SearchLibraryChoice[];
  invalidChoices: SearchLibraryChoice[];
  createdAt: number;
}

export interface CreateSearchLibraryPromptOptions {
  id?: string;
  sourceInstanceId?: string;
  tapped?: boolean;
  shuffle?: boolean;
  revealPolicy?: PromptRevealPolicy;
  minSelections?: number;
  maxSelections?: number;
  createdAt?: number;
}

export interface SearchLibraryPromptResponse {
  requestId: string;
  kind: 'SearchLibrary';
  playerId: string;
  selectedCardInstanceIds: string[];
  payLifeToEnterUntapped?: boolean;
}

export type ResolveStackSearchPromptFailure =
  | 'stack_empty'
  | 'not_controller'
  | 'no_search_effect'
  | 'unsupported_search_player';

export interface ResolveStackSearchPromptOptions extends CreateSearchLibraryPromptOptions {
  playerId?: string;
}

export type ResolveStackSearchPromptResult =
  | {
      ok: true;
      state: GameState;
      request: SearchLibraryPromptRequest;
      update: EngineStateUpdate;
      stackItemId: string;
      sourceName: string;
    }
  | {
      ok: false;
      reason: ResolveStackSearchPromptFailure;
      message: string;
    };

export interface ClientPromptResponse {
  requestId: string;
  ok: boolean;
  reason?: ClientPromptFailure;
  message?: string;
  state?: GameState;
  update?: EngineStateUpdate;
  selectedTargetIds?: string[];
  selectedReplacementOptionId?: ReplacementOptionId;
  selectedManaActions?: ManaPaymentAction[];
  selectedCardInstanceIds?: string[];
  libraryManipulationChoices?: Record<string, string>;
  orderedTriggerIds?: string[];
  optionalTriggerId?: string;
  useOptionalTrigger?: boolean;
  damageAssignmentOrders?: DamageAssignmentOrder[];
  selectedModeIndices?: number[];
}

export interface TargetChoice {
  targetId: string;
  label: string;
  legal: boolean;
  reason?: string;
}

export interface SelectTargetPromptRequest {
  id: string;
  kind: 'SelectTarget';
  playerId: string;
  expectedStateId: string;
  sourceInstanceId?: string;
  targetSpec: TargetSpec;
  minSelections: number;
  maxSelections: number;
  legalChoices: TargetChoice[];
  invalidChoices: TargetChoice[];
  createdAt: number;
}

export interface CreateSelectTargetPromptOptions {
  id?: string;
  sourceInstanceId?: string;
  minSelections?: number;
  maxSelections?: number;
  createdAt?: number;
}

export interface SelectTargetPromptResponse {
  requestId: string;
  kind: 'SelectTarget';
  playerId: string;
  selectedTargetIds: string[];
}

export type ReplacementPromptSubject = 'BattlefieldEntry';

export type ReplacementOptionId = 'enter_tapped' | 'pay_life_enter_untapped' | 'enter_default';

export interface ReplacementChoice {
  optionId: ReplacementOptionId;
  label: string;
  legal: boolean;
  reason?: string;
  effects: {
    tapped?: boolean;
    lifePayment?: number;
  };
}

export interface ChooseReplacementPromptRequest {
  id: string;
  kind: 'ChooseReplacement';
  playerId: string;
  expectedStateId: string;
  sourceInstanceId?: string;
  cardInstanceId: string;
  subject: ReplacementPromptSubject;
  forceTapped?: boolean;
  defaultTapped?: boolean;
  legalChoices: ReplacementChoice[];
  invalidChoices: ReplacementChoice[];
  createdAt: number;
}

export interface CreateBattlefieldEntryReplacementPromptOptions {
  id?: string;
  sourceInstanceId?: string;
  forceTapped?: boolean;
  defaultTapped?: boolean;
  createdAt?: number;
}

export interface ChooseReplacementPromptResponse {
  requestId: string;
  kind: 'ChooseReplacement';
  playerId: string;
  selectedOptionId: ReplacementOptionId;
}

export type ManaPaymentAction = Extract<AIAction, { kind: 'ActivateManaAbility' }>;

export interface ManaPaymentChoice {
  action: ManaPaymentAction;
  label: string;
  legal: boolean;
  reason?: string;
}

export interface PayCostsPromptRequest {
  id: string;
  kind: 'PayCosts';
  playerId: string;
  expectedStateId: string;
  sourceInstanceId?: string;
  manaCost: ManaCost;
  legalChoices: ManaPaymentChoice[];
  invalidChoices: ManaPaymentChoice[];
  proposedManaActions: ManaPaymentAction[];
  createdAt: number;
}

export interface CreatePayCostsPromptOptions {
  id?: string;
  sourceInstanceId?: string;
  proposedManaActions?: ManaPaymentAction[];
  createdAt?: number;
}

export interface PayCostsPromptResponse {
  requestId: string;
  kind: 'PayCosts';
  playerId: string;
  selectedManaActions: ManaPaymentAction[];
}

export type SelectCardsSubject =
  | 'DiscardToHandSize'
  | 'ManualDiscard'
  | 'AdditionalCost'
  | 'OpeningMulligan'
  | 'OpeningMulliganBottom';

export interface SelectCardsChoice {
  cardInstanceId: string;
  cardName: string;
  zone: Zone;
  legal: boolean;
  reason?: string;
}

export interface SelectCardsPromptRequest {
  id: string;
  kind: 'SelectCards';
  playerId: string;
  expectedStateId: string;
  sourceInstanceId?: string;
  subject: SelectCardsSubject;
  zone: Zone;
  destination: Zone;
  filter?: CardFilter;
  commitSelection: boolean;
  minSelections: number;
  maxSelections: number;
  legalChoices: SelectCardsChoice[];
  invalidChoices: SelectCardsChoice[];
  createdAt: number;
}

export interface CreateSelectCardsPromptOptions {
  id?: string;
  sourceInstanceId?: string;
  subject?: SelectCardsSubject;
  zone?: Zone;
  destination?: Zone;
  filter?: CardFilter;
  commitSelection?: boolean;
  minSelections?: number;
  maxSelections?: number;
  createdAt?: number;
}

export type LibraryManipulationMode = 'scry' | 'surveil';

export interface LibraryManipulationChoice {
  cardInstanceId: string;
  cardName: string;
  legal: boolean;
  reason?: string;
}

export interface LibraryManipulationPromptRequest {
  id: string;
  kind: 'LibraryManipulation';
  playerId: string;
  expectedStateId: string;
  sourceInstanceId?: string;
  stackItemId?: string;
  mode: LibraryManipulationMode;
  count: number;
  legalChoices: LibraryManipulationChoice[];
  invalidChoices: LibraryManipulationChoice[];
  createdAt: number;
}

export interface CreateLibraryManipulationPromptOptions {
  id?: string;
  sourceInstanceId?: string;
  stackItemId?: string;
  createdAt?: number;
}

export interface LibraryManipulationPromptResponse {
  requestId: string;
  kind: 'LibraryManipulation';
  playerId: string;
  topCardInstanceIds: string[];
  movedCardInstanceIds: string[];
}

export interface TriggerOrderChoice {
  triggerId: string;
  controllerId: string;
  sourceInstanceId: string;
  sourceName: string;
  triggerKind: string;
}

export interface OrderTriggersPromptRequest {
  id: string;
  kind: 'OrderTriggers';
  playerId: string;
  expectedStateId: string;
  triggers: TriggerOrderChoice[];
  createdAt: number;
}

export interface CreateOrderTriggersPromptOptions {
  id?: string;
  createdAt?: number;
}

export interface OrderTriggersPromptResponse {
  requestId: string;
  kind: 'OrderTriggers';
  playerId: string;
  orderedTriggerIds: string[];
}

export interface OptionalTriggerPromptRequest {
  id: string;
  kind: 'OptionalTrigger';
  playerId: string;
  expectedStateId: string;
  triggerId: string;
  sourceInstanceId: string;
  sourceName: string;
  triggerKind: string;
  createdAt: number;
}

export interface CreateOptionalTriggerPromptOptions {
  id?: string;
  createdAt?: number;
}

export interface OptionalTriggerPromptResponse {
  requestId: string;
  kind: 'OptionalTrigger';
  playerId: string;
  triggerId: string;
  use: boolean;
}

export interface DamageAssignmentBlockerChoice {
  blockerId: string;
  blockerName: string;
  lethalDamage: number;
  currentDamage: number;
  legal: boolean;
  reason?: string;
}

export interface DamageAssignmentGroup {
  attackerId: string;
  attackerName: string;
  attackerPower: number;
  blockers: DamageAssignmentBlockerChoice[];
}

export interface DamageAssignmentPromptRequest {
  id: string;
  kind: 'DamageAssignment';
  playerId: string;
  expectedStateId: string;
  groups: DamageAssignmentGroup[];
  createdAt: number;
}

export interface CreateDamageAssignmentPromptOptions {
  id?: string;
  createdAt?: number;
}

export interface DamageAssignmentOrder {
  attackerId: string;
  blockerIds: string[];
}

export interface DamageAssignmentPromptResponse {
  requestId: string;
  kind: 'DamageAssignment';
  playerId: string;
  orders: DamageAssignmentOrder[];
}

export interface ModeChoice {
  modeIndex: number;
  label: string;
  legal: boolean;
  reason?: string;
}

export interface ChooseModePromptRequest {
  id: string;
  kind: 'ChooseMode';
  playerId: string;
  expectedStateId: string;
  sourceInstanceId: string;
  minSelections: number;
  maxSelections: number;
  legalChoices: ModeChoice[];
  invalidChoices: ModeChoice[];
  createdAt: number;
}

export interface CreateChooseModePromptOptions {
  id?: string;
  minSelections?: number;
  maxSelections?: number;
  createdAt?: number;
}

export interface ChooseModePromptResponse {
  requestId: string;
  kind: 'ChooseMode';
  playerId: string;
  selectedModeIndices: number[];
}

export interface SelectCardsPromptResponse {
  requestId: string;
  kind: 'SelectCards';
  playerId: string;
  selectedCardInstanceIds: string[];
}

export interface ActionReplayAuditStep {
  index: number;
  requestId: string;
  playerId: string;
  actionKind: AIAction['kind'];
  stateBeforeId: string;
  stateAfterId?: string;
  ok: boolean;
  reason?: ClientActionFailure | 'missing_state' | 'invariant_violation';
  message?: string;
}

export interface ActionReplayAuditReport {
  ok: boolean;
  finalState?: GameState;
  steps: ActionReplayAuditStep[];
}

export interface SearchPromptReplayRecord {
  request: SearchLibraryPromptRequest;
  response: SearchLibraryPromptResponse;
}

export interface TargetPromptReplayRecord {
  request: SelectTargetPromptRequest;
  response: SelectTargetPromptResponse;
}

export interface ReplacementPromptReplayRecord {
  request: ChooseReplacementPromptRequest;
  response: ChooseReplacementPromptResponse;
}

export interface PayCostsPromptReplayRecord {
  request: PayCostsPromptRequest;
  response: PayCostsPromptResponse;
}

export interface SelectCardsPromptReplayRecord {
  request: SelectCardsPromptRequest;
  response: SelectCardsPromptResponse;
}

export type OpeningMulliganRedrawFailure =
  | 'empty_selection'
  | 'duplicate_selection'
  | 'illegal_selection'
  | 'invariant_violation';

export type OpeningMulliganRedrawResult =
  | {
      ok: true;
      state: GameState;
      update: EngineStateUpdate;
      redrawn: number;
    }
  | {
      ok: false;
      reason: OpeningMulliganRedrawFailure;
      message: string;
      update: EngineStateUpdate;
    };

export interface LibraryManipulationPromptReplayRecord {
  request: LibraryManipulationPromptRequest;
  response: LibraryManipulationPromptResponse;
}

export interface ChooseModePromptReplayRecord {
  request: ChooseModePromptRequest;
  response: ChooseModePromptResponse;
}

export interface DamageAssignmentPromptReplayRecord {
  request: DamageAssignmentPromptRequest;
  response: DamageAssignmentPromptResponse;
}

export interface OrderTriggersPromptReplayRecord {
  request: OrderTriggersPromptRequest;
  response: OrderTriggersPromptResponse;
}

export interface OptionalTriggerPromptReplayRecord {
  request: OptionalTriggerPromptRequest;
  response: OptionalTriggerPromptResponse;
}

export type PromptReplayRecord =
  | SearchPromptReplayRecord
  | TargetPromptReplayRecord
  | ReplacementPromptReplayRecord
  | PayCostsPromptReplayRecord
  | SelectCardsPromptReplayRecord
  | LibraryManipulationPromptReplayRecord
  | OptionalTriggerPromptReplayRecord
  | OrderTriggersPromptReplayRecord
  | DamageAssignmentPromptReplayRecord
  | ChooseModePromptReplayRecord;

export interface PromptReplayAuditStep {
  index: number;
  requestId: string;
  playerId: string;
  promptKind: EnginePromptKind;
  stateBeforeId: string;
  stateAfterId?: string;
  ok: boolean;
  reason?: ClientPromptFailure | 'missing_state' | 'invariant_violation';
  message?: string;
}

export interface PromptReplayAuditReport {
  ok: boolean;
  finalState?: GameState;
  steps: PromptReplayAuditStep[];
}

export type EngineReplayRecord =
  | { kind: 'Action'; request: ClientActionRequest }
  | ({ kind: 'Prompt' } & PromptReplayRecord);

export interface EngineReplayAuditStep {
  index: number;
  kind: EngineReplayRecord['kind'];
  requestId: string;
  playerId: string;
  stateBeforeId: string;
  stateAfterId?: string;
  ok: boolean;
  actionKind?: AIAction['kind'];
  promptKind?: EnginePromptKind;
  reason?: ClientActionFailure | ClientPromptFailure | 'missing_state' | 'invariant_violation';
  message?: string;
}

export interface EngineReplayAuditReport {
  ok: boolean;
  finalState?: GameState;
  steps: EngineReplayAuditStep[];
}

export type PromptType =
  | 'main-action'
  | 'priority'
  | 'stack-response'
  | 'declare-attackers'
  | 'declare-blockers'
  | 'game-over';

export interface ActionPromptChoice {
  id: string;
  kind: AIAction['kind'];
  label: string;
  action: AIAction;
}

export interface ActionPromptChoiceSummary {
  kind: AIAction['kind'];
  label: string;
  count: number;
}

export interface PrioritySnapshot {
  activePlayerId?: string;
  priorityPlayerId?: string;
  passedPriorityPlayerIds: string[];
  stackSize: number;
  stackTop?: StackObjectSummary;
  canResolveTopOfStack: boolean;
}

export interface EnginePrompt {
  id: string;
  type: PromptType;
  playerId: string;
  title: string;
  guidance: string;
  phase: Phase;
  step: Step;
  stackSize: number;
  priority: PrioritySnapshot;
  legalChoices: ActionPromptChoice[];
  legalChoiceSummary: ActionPromptChoiceSummary[];
  defaultActionId?: string;
  canCancel: boolean;
  canSubmit: boolean;
}

export type VisibleDiff =
  | {
      kind: 'CardZoneChanged';
      cardId: string;
      cardName?: string;
      ownerId: string;
      from?: Zone;
      to?: Zone;
    }
  | {
      kind: 'CardTappedChanged';
      cardId: string;
      cardName?: string;
      ownerId: string;
      from: boolean;
      to: boolean;
    }
  | {
      kind: 'CounterChanged';
      cardId: string;
      cardName?: string;
      ownerId: string;
      counterType: string;
      from: number;
      to: number;
    }
  | {
      kind: 'CardDamageChanged';
      cardId: string;
      cardName?: string;
      ownerId: string;
      from: number;
      to: number;
    }
  | {
      kind: 'CardSummoningSicknessChanged';
      cardId: string;
      cardName?: string;
      ownerId: string;
      from: boolean;
      to: boolean;
    }
  | {
      kind: 'CardPhasedOutChanged';
      cardId: string;
      cardName?: string;
      ownerId: string;
      from: boolean;
      to: boolean;
    }
  | {
      kind: 'AttachmentChanged';
      cardId: string;
      cardName?: string;
      ownerId: string;
      from?: string;
      to?: string;
    }
  | {
      kind: 'LifeChanged';
      playerId: string;
      from: number;
      to: number;
    }
  | {
      kind: 'ManaPoolChanged';
      playerId: string;
      color: ManaColor;
      from: number;
      to: number;
    }
  | {
      kind: 'PoisonChanged';
      playerId: string;
      from: number;
      to: number;
    }
  | {
      kind: 'PlayerCounterChanged';
      playerId: string;
      counterType: string;
      from: number;
      to: number;
    }
  | {
      kind: 'PlayerLostChanged';
      playerId: string;
      from: boolean;
      to: boolean;
    }
  | {
      kind: 'CommanderDamageChanged';
      playerId: string;
      commanderId: string;
      from: number;
      to: number;
    }
  | {
      kind: 'CommanderTaxChanged';
      playerId: string;
      commanderId?: string;
      from: number;
      to: number;
    }
  | {
      kind: 'CommanderCastCountChanged';
      playerId: string;
      commanderId?: string;
      from: number;
      to: number;
    }
  | {
      kind: 'PhaseChanged';
      from: { turnNumber: number; activePlayerId?: string; phase: Phase; step: Step };
      to: { turnNumber: number; activePlayerId?: string; phase: Phase; step: Step };
    }
  | {
      kind: 'PriorityChanged';
      from?: string;
      to?: string;
    }
  | {
      kind: 'StackChanged';
      fromCount: number;
      toCount: number;
      fromTop?: StackObjectSummary;
      toTop?: StackObjectSummary;
    }
  | {
      kind: 'CombatChanged';
      from?: CombatSummary;
      to?: CombatSummary;
    };

export interface StackObjectSummary {
  id: string;
  kind: StackItem['kind'];
  name?: string;
  controllerId?: string;
}

export interface CombatSummary {
  attackers: { cardId: string; defenderId: string }[];
  blockers: { cardId: string; attackerId: string }[];
  blockersDeclared?: boolean;
  blockersDeclaredBy: string[];
  blockerOrder: { attackerId: string; blockerIds: string[] }[];
  damageAssignment: { cardId: string; amount: number }[];
}

export type EngineEvent =
  | {
      kind: 'ActionAccepted';
      requestId: string;
      playerId: string;
      actionKind: AIAction['kind'];
      label?: string;
    }
  | {
      kind: 'ActionRejected';
      requestId: string;
      playerId: string;
      actionKind: AIAction['kind'];
      reason: ClientActionFailure;
      message: string;
    }
  | {
      kind: 'PromptResponseAccepted';
      requestId: string;
      playerId: string;
      promptKind: EnginePromptKind;
      selectedCardInstanceIds?: string[];
      selectedTargetIds?: string[];
      selectedReplacementOptionId?: ReplacementOptionId;
      selectedManaActions?: ManaPaymentAction[];
      orderedTriggerIds?: string[];
      optionalTriggerId?: string;
      useOptionalTrigger?: boolean;
      damageAssignmentOrders?: DamageAssignmentOrder[];
      destination?: SearchLibraryDestination;
    }
  | {
      kind: 'PromptResponseRejected';
      requestId: string;
      playerId: string;
      promptKind: EnginePromptKind;
      reason: ClientPromptFailure;
      message: string;
      selectedCardInstanceIds?: string[];
      selectedTargetIds?: string[];
      selectedReplacementOptionId?: ReplacementOptionId;
      selectedManaActions?: ManaPaymentAction[];
      orderedTriggerIds?: string[];
      optionalTriggerId?: string;
      useOptionalTrigger?: boolean;
      damageAssignmentOrders?: DamageAssignmentOrder[];
    }
  | {
      kind: 'RulesEvent';
      event: ActionGameEvent;
    };

export interface EngineStateUpdate {
  oldStateId: string;
  newStateId: string;
  activePlayerId?: string;
  priorityPlayerId?: string;
  phase: Phase;
  step: Step;
  turnNumber: number;
  priority: PrioritySnapshot;
  visibleDiffs: VisibleDiff[];
  rulesEvents: EngineEvent[];
  prompt?: EnginePrompt;
}

export interface CreateActionRequestOptions {
  id?: string;
  source?: ClientActionSource;
  label?: string;
  actionId?: string;
  expectedStateId?: string;
  expectedPromptId?: string;
  createdAt?: number;
}

export interface StateUpdateRequestInfo {
  requestId: string;
  playerId: string;
  actionKind: AIAction['kind'];
  label?: string;
}

const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => normalizeForStableJson(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, normalizeForStableJson(entry)]);
    return Object.fromEntries(entries);
  }
  return value;
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

export function actionKey(action: AIAction): string {
  return stableJson(action);
}

function cardName(state: GameState, card?: CardInstance): string | undefined {
  if (!card) return undefined;
  return getCardDefinition(state, card).name;
}

function activePlayerId(state: GameState): string | undefined {
  return state.players[state.activePlayerIndex]?.id;
}

function priorityPlayerId(state: GameState): string | undefined {
  return state.players[state.priorityPlayerIndex]?.id;
}

function prioritySnapshot(state: GameState): PrioritySnapshot {
  const passedPriorityPlayerIds = state.players
    .filter((player, index) => state.hasPriorityPassed[index] && !player.hasLost)
    .map(player => player.id);
  const activePlayers = state.players.filter(player => !player.hasLost);
  const canResolveTopOfStack = state.stack.length > 0
    && activePlayers.length > 0
    && activePlayers.every(player => passedPriorityPlayerIds.includes(player.id));

  return {
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    passedPriorityPlayerIds,
    stackSize: state.stack.length,
    stackTop: stackSummary(state, state.stack[state.stack.length - 1]),
    canResolveTopOfStack,
  };
}

function stackSummary(state: GameState, item?: StackItem): StackObjectSummary | undefined {
  if (!item) return undefined;
  if (item.kind === 'Spell') {
    const card = state.cards.get(item.cardInstanceId);
    return {
      id: item.id,
      kind: item.kind,
      name: cardName(state, card),
      controllerId: item.casterId,
    };
  }
  return {
    id: item.id,
    kind: item.kind,
    name: cardName(state, state.cards.get(item.sourceInstanceId)),
    controllerId: item.controllerId,
  };
}

function playerName(state: GameState, playerId: string): string | undefined {
  return state.players.find(player => player.id === playerId)?.name;
}

function targetName(state: GameState, targetId: string): string {
  const card = state.cards.get(targetId);
  if (card) return cardName(state, card) || targetId;
  return playerName(state, targetId) || targetId;
}

function targetSuffix(state: GameState, targets?: string[]): string {
  if (!targets?.length) return '';
  const names = targets.map(targetId => targetName(state, targetId));
  return ` targeting ${names.join(', ')}`;
}

function stateSignature(state: GameState): unknown {
  const cards = [...state.cards.values()]
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId))
    .map(card => ({
      instanceId: card.instanceId,
      definitionId: card.definitionId,
      ownerId: card.ownerId,
      zone: card.zone,
      tapped: card.tapped,
      summoningSick: card.summoningSick,
      counters: card.counters,
      attachedTo: card.attachedTo,
      damage: card.damage,
      isCommander: card.isCommander,
      isToken: card.isToken,
    }));

  return {
    players: state.players.map(player => ({
      id: player.id,
      life: player.life,
      poisonCounters: player.poisonCounters,
      playerCounters: player.playerCounters,
      commanderDamage: player.commanderDamage,
      commanderCastCount: player.commanderCastCount,
      commanderCastCounts: player.commanderCastCounts,
      manaPool: player.manaPool,
      hasPlayedLand: player.hasPlayedLand,
      landsPlayedThisTurn: player.landsPlayedThisTurn,
      hasLost: player.hasLost,
    })),
    cards,
    activePlayerIndex: state.activePlayerIndex,
    priorityPlayerIndex: state.priorityPlayerIndex,
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    spellsCastThisTurn: state.spellsCastThisTurn,
    hasPriorityPassed: state.hasPriorityPassed,
    stack: state.stack.map(item => stackSummary(state, item)),
    combat: state.combat
      ? {
          attackers: state.combat.attackers,
          blockers: state.combat.blockers,
          blockersDeclared: state.combat.blockersDeclared,
          blockersDeclaredBy: state.combat.blockersDeclaredBy,
          blockerOrder: state.combat.blockerOrder,
        }
      : null,
  };
}

export function stateFingerprint(state: GameState): string {
  return hashText(stableJson(stateSignature(state)));
}

function actionReferencesSameObject(legal: AIAction, requested: AIAction): boolean {
  if (legal.kind !== requested.kind) return false;
  switch (legal.kind) {
    case 'PlayLand':
      return requested.kind === 'PlayLand' && legal.cardInstanceId === requested.cardInstanceId;
    case 'ActivateManaAbility':
      return requested.kind === 'ActivateManaAbility'
        && legal.cardInstanceId === requested.cardInstanceId
        && legal.color === requested.color;
    case 'ManualUntapManaSource':
      return requested.kind === 'ManualUntapManaSource'
        && legal.cardInstanceId === requested.cardInstanceId
        && legal.color === requested.color
        && legal.amount === requested.amount;
    case 'ManualAdjustCounters':
      return requested.kind === 'ManualAdjustCounters'
        && legal.cardInstanceId === requested.cardInstanceId
        && legal.counterType === requested.counterType
        && legal.delta === requested.delta;
    case 'ManualAdjustPlayerCounter':
      return requested.kind === 'ManualAdjustPlayerCounter'
        && legal.playerId === requested.playerId
        && legal.counterType === requested.counterType
        && legal.delta === requested.delta;
    case 'ManualMoveCard':
      return requested.kind === 'ManualMoveCard'
        && legal.cardInstanceId === requested.cardInstanceId
        && legal.zone === requested.zone;
    case 'ManualAdjustDamage':
      return requested.kind === 'ManualAdjustDamage'
        && legal.cardInstanceId === requested.cardInstanceId
        && legal.delta === requested.delta;
    case 'ManualCreateToken':
      return requested.kind === 'ManualCreateToken'
        && legal.name === requested.name
        && legal.count === requested.count
        && legal.power === requested.power
        && legal.toughness === requested.toughness
        && stableJson(legal.colors) === stableJson(requested.colors)
        && stableJson(legal.types) === stableJson(requested.types)
        && stableJson(legal.subtypes) === stableJson(requested.subtypes)
        && stableJson(legal.keywords || []) === stableJson(requested.keywords || []);
    case 'CastSpell':
      return requested.kind === 'CastSpell'
        && legal.cardInstanceId === requested.cardInstanceId
        && stableJson(legal.targets) === stableJson(requested.targets);
    case 'ActivateAbility':
      return requested.kind === 'ActivateAbility'
        && legal.cardInstanceId === requested.cardInstanceId
        && legal.abilityIndex === requested.abilityIndex
        && stableJson(legal.targets) === stableJson(requested.targets);
    case 'DeclareAttackers':
      return requested.kind === 'DeclareAttackers'
        && stableJson(legal.attacks) === stableJson(requested.attacks);
    case 'DeclareBlockers':
      return requested.kind === 'DeclareBlockers'
        && stableJson(legal.blocks) === stableJson(requested.blocks);
    case 'Equip':
      return requested.kind === 'Equip'
        && legal.equipmentInstanceId === requested.equipmentInstanceId
        && legal.targetCreatureId === requested.targetCreatureId;
    case 'PassPriority':
      return requested.kind === 'PassPriority';
    default: {
      const _never: never = legal;
      return stableJson(_never) === stableJson(requested);
    }
  }
}

function isLegalRequestedAction(state: GameState, playerId: string, action: AIAction): boolean {
  if (isValidatedOutOfBandAction(action)) {
    return dispatchAIAction(state, playerId, action).ok;
  }
  const requestedKey = actionKey(action);
  return getLegalActions(state, playerId).some(legal =>
    actionKey(legal) === requestedKey || actionReferencesSameObject(legal, action),
  );
}

function illegalActionMessage(state: GameState, playerId: string, action: AIAction): string {
  if (action.kind === 'PlayLand') {
    const legality = canPlayLandDetailed(state, playerId, action.cardInstanceId);
    return legality.legal
      ? 'That land play is not available from the current prompt.'
      : legality.reason;
  }
  if (action.kind === 'ManualUntapManaSource') {
    const result = dispatchAIAction(state, playerId, action);
    return result.ok ? 'That mana correction is not available now.' : result.message;
  }
  if (action.kind === 'ManualAdjustCounters') {
    const result = dispatchAIAction(state, playerId, action);
    return result.ok ? 'That counter correction is not available now.' : result.message;
  }
  if (action.kind === 'ManualAdjustPlayerCounter') {
    const result = dispatchAIAction(state, playerId, action);
    return result.ok ? 'That player-counter correction is not available now.' : result.message;
  }
  if (action.kind === 'ManualMoveCard') {
    const result = dispatchAIAction(state, playerId, action);
    return result.ok ? 'That zone correction is not available now.' : result.message;
  }
  if (action.kind === 'ManualAdjustDamage') {
    const result = dispatchAIAction(state, playerId, action);
    return result.ok ? 'That damage correction is not available now.' : result.message;
  }
  if (action.kind === 'ManualCreateToken') {
    const result = dispatchAIAction(state, playerId, action);
    return result.ok ? 'That token correction is not available now.' : result.message;
  }
  return 'That action is not legal in the current game state.';
}

function isValidatedOutOfBandAction(action: AIAction): boolean {
  return action.kind === 'ManualUntapManaSource'
    || action.kind === 'ManualAdjustCounters'
    || action.kind === 'ManualAdjustPlayerCounter'
    || action.kind === 'ManualMoveCard'
    || action.kind === 'ManualAdjustDamage'
    || action.kind === 'ManualCreateToken';
}

export function labelForAction(state: GameState, action: AIAction): string {
  switch (action.kind) {
    case 'PlayLand':
      return `Play ${cardName(state, state.cards.get(action.cardInstanceId)) || 'land'}`;
    case 'CastSpell':
      return `Cast ${cardName(state, state.cards.get(action.cardInstanceId)) || 'spell'}${targetSuffix(state, action.targets)}`;
    case 'ActivateManaAbility':
      return `Tap ${cardName(state, state.cards.get(action.cardInstanceId)) || 'source'} for ${action.color}`;
    case 'ManualUntapManaSource':
      return `Undo mana tap for ${cardName(state, state.cards.get(action.cardInstanceId)) || 'source'}`;
    case 'ManualAdjustCounters':
      return `Adjust ${cardName(state, state.cards.get(action.cardInstanceId)) || 'permanent'} counters`;
    case 'ManualAdjustPlayerCounter':
      return `Adjust ${playerName(state, action.playerId) || 'player'} ${action.counterType} counters`;
    case 'ManualMoveCard':
      return `Move ${cardName(state, state.cards.get(action.cardInstanceId)) || 'card'} to ${action.zone}`;
    case 'ManualAdjustDamage':
      return `Adjust ${cardName(state, state.cards.get(action.cardInstanceId)) || 'permanent'} damage`;
    case 'ManualCreateToken':
      return `Create ${action.count} ${action.name} token${action.count === 1 ? '' : 's'}`;
    case 'ActivateAbility':
      return `Activate ${cardName(state, state.cards.get(action.cardInstanceId)) || 'ability'}${targetSuffix(state, action.targets)}`;
    case 'DeclareAttackers':
      return action.attacks.length === 0
        ? 'Declare no attackers'
        : `Declare ${action.attacks.length} attacker${action.attacks.length === 1 ? '' : 's'}`;
    case 'DeclareBlockers':
      return action.blocks.length === 0
        ? 'Declare no blockers'
        : `Declare ${action.blocks.length} blocker${action.blocks.length === 1 ? '' : 's'}`;
    case 'Equip':
      return `Equip ${cardName(state, state.cards.get(action.equipmentInstanceId)) || 'Equipment'}`;
    case 'PassPriority':
      return state.stack.length > 0 ? "Don't respond" : 'Pass priority';
    default: {
      const _never: never = action;
      return (_never as AIAction).kind;
    }
  }
}

function promptTypeForState(state: GameState): PromptType {
  if (state.players.some(player => player.hasLost)) return 'game-over';
  if (state.step === 'declare_attackers') return 'declare-attackers';
  if (state.step === 'declare_blockers') return 'declare-blockers';
  if (state.stack.length > 0) return 'stack-response';
  if (state.phase === 'precombat_main' || state.phase === 'postcombat_main') {
    return 'main-action';
  }
  return 'priority';
}

function promptTitleForState(state: GameState, type: PromptType): string {
  switch (type) {
    case 'game-over':
      return 'Match complete';
    case 'declare-attackers':
      return 'Choose attackers';
    case 'declare-blockers':
      return 'Choose blockers';
    case 'stack-response':
      return 'Respond to the stack';
    case 'main-action':
      return 'Choose an action';
    case 'priority':
      return 'Priority';
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

const ACTION_KIND_LABELS: Record<AIAction['kind'], string> = {
  CastSpell: 'Castable',
  PlayLand: 'Playable land',
  ActivateManaAbility: 'Mana ability',
  ManualUntapManaSource: 'Special action',
  ManualAdjustCounters: 'Special action',
  ManualAdjustPlayerCounter: 'Special action',
  ManualMoveCard: 'Special action',
  ManualAdjustDamage: 'Special action',
  ManualCreateToken: 'Special action',
  ActivateAbility: 'Activated ability',
  DeclareAttackers: 'Attack/block',
  DeclareBlockers: 'Attack/block',
  Equip: 'Special action',
  PassPriority: 'Pass/resolve',
};

function actionChoiceSummaryLabel(action: AIAction): string {
  switch (action.kind) {
    case 'CastSpell':
    case 'ActivateAbility':
      return action.targets.length > 0 ? 'Target/select' : ACTION_KIND_LABELS[action.kind];
    case 'DeclareAttackers':
    case 'DeclareBlockers':
      return 'Attack/block';
    case 'Equip':
    case 'ManualAdjustCounters':
    case 'ManualAdjustPlayerCounter':
    case 'ManualMoveCard':
    case 'ManualAdjustDamage':
    case 'ManualUntapManaSource':
    case 'ManualCreateToken':
      return 'Special action';
    default:
      return ACTION_KIND_LABELS[action.kind];
  }
}

export function summarizeActionPromptChoices(
  choices: ActionPromptChoice[],
): ActionPromptChoiceSummary[] {
  const counts = new Map<string, ActionPromptChoiceSummary>();
  for (const choice of choices) {
    const label = actionChoiceSummaryLabel(choice.action);
    const current = counts.get(label);
    if (current) {
      current.count += 1;
    } else {
      counts.set(label, { kind: choice.kind, label, count: 1 });
    }
  }
  return [...counts.values()]
    .sort((a, b) => a.label.localeCompare(b.label));
}

function meaningfulChoiceCount(choices: ActionPromptChoice[]): number {
  return choices.filter(choice => choice.kind !== 'PassPriority').length;
}

function promptGuidanceForState(
  state: GameState,
  type: PromptType,
  playerId: string,
  legalChoices: ActionPromptChoice[],
): string {
  const player = playerName(state, playerId) || 'This player';
  const priorityPlayer = priorityPlayerId(state);
  const priorityName = priorityPlayer ? playerName(state, priorityPlayer) || priorityPlayer : 'the next player';
  const stackTop = stackSummary(state, state.stack[state.stack.length - 1]);
  const stackName = stackTop?.name || 'the top stack object';
  const hasMeaningfulChoice = meaningfulChoiceCount(legalChoices) > 0;

  switch (type) {
    case 'game-over':
      return 'The match has ended. Review the log, then start a new game or rematch.';
    case 'declare-attackers':
      return hasMeaningfulChoice
        ? 'Choose attackers now, or declare no attackers to continue combat.'
        : 'No attackers are currently legal; declare no attackers to continue combat.';
    case 'declare-blockers':
      return hasMeaningfulChoice
        ? 'Choose blockers now, or declare no blockers before combat damage.'
        : 'No blockers are currently legal; declare no blockers before combat damage.';
    case 'stack-response':
      if (state.stack.length === 0) {
        return `${player} has priority. No stack object is waiting right now.`;
      }
      if (state.players.every((candidate, index) => candidate.hasLost || state.hasPriorityPassed[index])) {
        return `All players have passed. The next pass resolves ${stackName}.`;
      }
      return hasMeaningfulChoice
        ? `${stackName} is on the stack. Respond with an available instant-speed action or pass priority.`
        : `${stackName} is on the stack, but no response is currently available. Pass priority to continue.`;
    case 'main-action':
      return hasMeaningfulChoice
        ? 'Main phase actions are available: play a land, cast spells, activate abilities, or pass to move on.'
        : 'No main-phase action is currently available. Pass priority to move on.';
    case 'priority':
      return hasMeaningfulChoice
        ? `${priorityName} has priority in this timing window. Use an available action or pass priority.`
        : `${priorityName} has priority. If there is nothing useful to do, pass priority.`;
    default: {
      const _never: never = type;
      return _never;
    }
  }
}

export function buildActionPrompt(state: GameState, playerId = priorityPlayerId(state)): EnginePrompt | undefined {
  if (!playerId) return undefined;
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player || player.hasLost) return undefined;
  const type = promptTypeForState(state);
  const legalActions = type === 'game-over' ? [] : getLegalActions(state, playerId);
  const legalChoices = legalActions.map(action => ({
    id: actionKey(action),
    kind: action.kind,
    label: labelForAction(state, action),
    action,
  }));
  const defaultChoice = legalChoices.find(choice => choice.kind === 'PassPriority');

  return {
    id: `${stateFingerprint(state)}:${playerId}:${type}`,
    type,
    playerId,
    title: promptTitleForState(state, type),
    guidance: promptGuidanceForState(state, type, playerId, legalChoices),
    phase: state.phase,
    step: state.step,
    stackSize: state.stack.length,
    priority: prioritySnapshot(state),
    legalChoices,
    legalChoiceSummary: summarizeActionPromptChoices(legalChoices),
    defaultActionId: defaultChoice?.id,
    canCancel: type !== 'game-over',
    canSubmit: legalChoices.length > 0,
  };
}

export function createClientActionRequest(
  state: GameState,
  playerId: string,
  action: AIAction,
  options: CreateActionRequestOptions = {},
): ClientActionRequest {
  const expectedStateId = options.expectedStateId || stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const prompt = buildActionPrompt(state, playerId);
  return {
    id: options.id || `req_${expectedStateId}_${hashText(`${playerId}:${actionKey(action)}:${createdAt}`)}`,
    playerId,
    action,
    actionId: options.actionId || actionKey(action),
    source: options.source || 'ui',
    label: options.label || labelForAction(state, action),
    expectedStateId,
    expectedPromptId: options.expectedPromptId || prompt?.id,
    createdAt,
  };
}

function isPermanentDefinitionForPrompt(cardDef: CardDefinition): boolean {
  return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']
    .some(type => (
      cardDef.card_types.includes(type as CardDefinition['card_types'][number])
      || cardDef.type_line.toLowerCase().includes(type)
    ));
}

function matchesNumericPromptFilter(
  value: number,
  filter?: { op: 'eq' | 'lte' | 'gte'; value: number },
): boolean {
  if (!filter) return true;
  switch (filter.op) {
    case 'eq':
      return value === filter.value;
    case 'lte':
      return value <= filter.value;
    case 'gte':
      return value >= filter.value;
    default: {
      const _never: never = filter.op;
      return Boolean(_never);
    }
  }
}

function searchFilterFailureReason(
  state: GameState,
  def: CardDefinition,
  filter: CardFilter,
  sourceInstanceId?: string,
): string {
  const typeLine = def.type_line.toLowerCase();

  if (filter.permanent && !isPermanentDefinitionForPrompt(def)) {
    return 'Not a permanent card';
  }

  if (filter.types?.length) {
    const hasMatchingType = filter.types.some(type =>
      def.card_types.includes(type as CardDefinition['card_types'][number])
      || typeLine.includes(type.toLowerCase()),
    );
    if (!hasMatchingType) return `Not a ${filter.types.join(' or ')} card`;
  }

  if (filter.subtypes?.length) {
    const hasMatchingSubtype = filter.subtypes.some(subtype => typeLine.includes(subtype.toLowerCase()));
    if (!hasMatchingSubtype) return `Missing subtype ${filter.subtypes.join(' or ')}`;
  }

  if (filter.excludeSubtypes?.length) {
    const hasExcludedSubtype = filter.excludeSubtypes.some(subtype => typeLine.includes(subtype.toLowerCase()));
    if (hasExcludedSubtype) return `Has excluded subtype ${filter.excludeSubtypes.join(' or ')}`;
  }

  if (filter.supertypes?.length) {
    const hasMatchingSupertype = filter.supertypes.some(supertype => typeLine.includes(supertype.toLowerCase()));
    if (!hasMatchingSupertype) return `Not ${filter.supertypes.join(' or ')}`;
  }

  if (filter.colors?.length) {
    const hasMatchingColor = filter.colors.some(color => def.colors.includes(color));
    if (!hasMatchingColor) return `Not ${filter.colors.join(' or ')}`;
  }

  if (filter.cmc && !matchesNumericPromptFilter(def.cmc, filter.cmc)) {
    return `Mana value ${def.cmc} does not satisfy ${filter.cmc.op} ${filter.cmc.value}`;
  }

  if (filter.manaValueLessThanSourcePower) {
    if (!sourceInstanceId) return 'Missing source for mana value comparison';
    const source = state.cards.get(sourceInstanceId);
    if (!source) return 'Source is no longer available';
    const sourcePower = getEffectivePower(state, sourceInstanceId);
    if (def.cmc >= sourcePower) {
      return `Mana value ${def.cmc} is not less than source power ${sourcePower}`;
    }
  }

  if (filter.power && !matchesNumericPromptFilter(def.power ?? 0, filter.power)) {
    return `Power ${def.power ?? 0} does not satisfy ${filter.power.op} ${filter.power.value}`;
  }

  return 'Does not match this search effect';
}

function evaluateSearchLibraryChoice(
  state: GameState,
  playerId: string,
  filter: CardFilter,
  destination: SearchLibraryDestination,
  card: CardInstance,
  sourceInstanceId?: string,
): SearchLibraryChoice {
  const def = getCardDefinition(state, card);
  const cardName = def.name || card.instanceId;
  if (card.ownerId !== playerId || card.zone !== 'library') {
    return {
      cardInstanceId: card.instanceId,
      cardName,
      legal: false,
      reason: 'Card is not in your library',
      destination,
    };
  }
  const legal = matchesCardFilter(def, filter, { state, sourceInstanceId });
  return {
    cardInstanceId: card.instanceId,
    cardName,
    legal,
    reason: legal ? undefined : searchFilterFailureReason(state, def, filter, sourceInstanceId),
    destination,
  };
}

export function createSearchLibraryPromptRequest(
  state: GameState,
  playerId: string,
  filter: CardFilter,
  destination: SearchLibraryDestination,
  options: CreateSearchLibraryPromptOptions = {},
): SearchLibraryPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const choices = [...state.cards.values()]
    .filter(card => card.ownerId === playerId && card.zone === 'library')
    .map(card => evaluateSearchLibraryChoice(
      state,
      playerId,
      filter,
      destination,
      card,
      options.sourceInstanceId,
    ))
    .sort((a, b) => {
      if (a.legal !== b.legal) return a.legal ? -1 : 1;
      return a.cardName.localeCompare(b.cardName);
    });

  const legalChoices = choices.filter(choice => choice.legal);
  const invalidChoices = choices.filter(choice => !choice.legal);
  const minSelections = options.minSelections ?? 0;
  const maxSelections = options.maxSelections ?? 1;

  return {
    id: options.id || `prompt_${expectedStateId}_${hashText(`${playerId}:SearchLibrary:${createdAt}`)}`,
    kind: 'SearchLibrary',
    playerId,
    sourceInstanceId: options.sourceInstanceId,
    expectedStateId,
    filter,
    destination,
    tapped: options.tapped,
    shuffle: options.shuffle ?? false,
    revealPolicy: options.revealPolicy || 'hidden',
    minSelections,
    maxSelections,
    legalChoices,
    invalidChoices,
    createdAt,
  };
}

function isSearchLibraryEffect(effect: unknown): effect is SearchLibraryEffect {
  return Boolean(effect && typeof effect === 'object' && (effect as { kind?: unknown }).kind === 'SearchLibrary');
}

function searchPlayerFromTargetRef(
  ref: TargetRef,
  controllerId: string,
  targets: string[] = [],
): string | null {
  switch (ref.kind) {
    case 'Controller':
    case 'Source':
      return controllerId;
    case 'Player':
      return ref.playerId;
    case 'Chosen':
      return targets[0] ?? null;
    default:
      return null;
  }
}

function spellEffectsFromStackItem(state: GameState, item: Extract<StackItem, { kind: 'Spell' }>): Effect[] {
  const card = state.cards.get(item.cardInstanceId);
  const def = card ? getCardDefinition(state, card) : undefined;
  if (!def) return [];

  const override = getOverride(def.id, def.name);
  if (override?.kind === 'Spell') return override.effects as Effect[];

  const parsed = parseOracleText(def.oracle_text, def.mana_cost);
  if (parsed.kind === 'Spell') return parsed.effects as Effect[];
  if (parsed.kind === 'Modal' && item.chosenModes?.length) {
    const effects: Effect[] = [];
    for (const modeIndex of item.chosenModes) {
      const mode = parsed.modal.choices[modeIndex];
      if (mode) effects.push(...(mode.effects as Effect[]));
    }
    return effects;
  }
  return [];
}

function stackItemSearchEffect(state: GameState, item: StackItem): SearchLibraryEffect | null {
  const effects = item.kind === 'Spell'
    ? spellEffectsFromStackItem(state, item)
    : item.kind === 'ActivatedAbility' || item.kind === 'TriggeredAbility'
      ? item.ability.effects as Effect[]
      : [];
  return effects.find(isSearchLibraryEffect) ?? null;
}

function stackItemControllerId(item: StackItem): string {
  if (item.kind === 'Spell') return item.casterId;
  return item.controllerId;
}

function stackItemSourceInstanceId(item: StackItem): string | undefined {
  return item.kind === 'Spell' ? item.cardInstanceId : item.sourceInstanceId;
}

function stackItemSourceName(state: GameState, item: StackItem): string {
  const sourceId = stackItemSourceInstanceId(item);
  const source = sourceId ? state.cards.get(sourceId) : undefined;
  const def = source ? getCardDefinition(state, source) : undefined;
  return def?.name || 'Search';
}

function removeTopStackItemForPrompt(state: GameState, item: StackItem): GameState {
  const newStack = state.stack.slice(0, -1);
  let cards = state.cards;
  if (item.kind === 'Spell' && !item.isCopy) {
    const card = state.cards.get(item.cardInstanceId);
    if (card) {
      cards = new Map(state.cards);
      cards.set(card.instanceId, {
        ...card,
        zone: 'graveyard',
        tapped: false,
        damage: 0,
      });
    }
  }
  return {
    ...state,
    cards,
    stack: newStack,
    priorityPlayerIndex: state.activePlayerIndex,
    hasPriorityPassed: state.players.map(() => false),
  };
}

export function resolveTopStackSearchPrompt(
  state: GameState,
  options: ResolveStackSearchPromptOptions = {},
): ResolveStackSearchPromptResult {
  if (state.stack.length === 0) {
    return { ok: false, reason: 'stack_empty', message: 'Stack is empty' };
  }

  const item = state.stack[state.stack.length - 1];
  const controllerId = stackItemControllerId(item);
  if (options.playerId && controllerId !== options.playerId) {
    return {
      ok: false,
      reason: 'not_controller',
      message: 'Top stack search belongs to another player',
    };
  }

  const effect = stackItemSearchEffect(state, item);
  if (!effect) {
    return { ok: false, reason: 'no_search_effect', message: 'Top stack item has no search effect' };
  }

  const playerId = searchPlayerFromTargetRef(effect.player, controllerId, 'targets' in item ? item.targets : []);
  if (!playerId) {
    return {
      ok: false,
      reason: 'unsupported_search_player',
      message: 'This search effect does not target a single searchable player',
    };
  }

  const nextState = removeTopStackItemForPrompt(state, item);
  const sourceInstanceId = stackItemSourceInstanceId(item);
  const createdAt = options.createdAt ?? Date.now();
  const revealPolicy = options.revealPolicy
    || (Object.keys(effect.filter || {}).length > 0 ? 'reveal' : 'hidden');
  const request = createSearchLibraryPromptRequest(
    nextState,
    playerId,
    effect.filter,
    effect.destination,
    {
      ...options,
      id: options.id || `search-${item.id}`,
      sourceInstanceId,
      tapped: options.tapped ?? effect.tapped,
      shuffle: options.shuffle ?? effect.shuffle,
      revealPolicy,
      createdAt,
    },
  );
  const update = buildStateUpdate(state, nextState);

  return {
    ok: true,
    state: nextState,
    request,
    update,
    stackItemId: item.id,
    sourceName: stackItemSourceName(state, item),
  };
}

function promptRejectUpdate(
  state: GameState,
  request: SearchLibraryPromptRequest,
  response: SearchLibraryPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      selectedCardInstanceIds: response.selectedCardInstanceIds,
    }],
    prompt: buildActionPrompt(state),
  };
}

function selectedPromptChoiceReason(
  state: GameState,
  request: SearchLibraryPromptRequest,
  selectedCardInstanceId: string,
): string {
  const card = state.cards.get(selectedCardInstanceId);
  if (!card) return 'Card no longer exists';
  return evaluateSearchLibraryChoice(
    state,
    request.playerId,
    request.filter,
    request.destination,
    card,
    request.sourceInstanceId,
  ).reason || 'Selection is not legal for this search';
}

function validateBattlefieldEntryReplacementResponse(
  state: GameState,
  request: SearchLibraryPromptRequest,
  response: SearchLibraryPromptResponse,
  selectedCardInstanceId: string,
): string | undefined {
  if (request.destination !== 'battlefield') return undefined;
  if (response.payLifeToEnterUntapped === undefined) return undefined;

  const card = state.cards.get(selectedCardInstanceId);
  const def = card ? getCardDefinition(state, card) : undefined;
  if (!card || !def) return 'Selected card is no longer available';

  const optionalLifeCost = getOptionalUntappedLifeCost(def.oracle_text);
  if (request.tapped) {
    return 'This effect puts the card onto the battlefield tapped, so an untapped replacement choice is not available';
  }
  if (optionalLifeCost === undefined) {
    return `${def.name} has no optional life payment to enter untapped`;
  }
  if (response.payLifeToEnterUntapped) {
    const player = state.players.find(candidate => candidate.id === request.playerId);
    if (!player || player.life < optionalLifeCost) {
      return `Cannot pay ${optionalLifeCost} life for ${def.name}`;
    }
  }
  return undefined;
}

function applyBattlefieldEntryFromSearch(state: GameState, cardInstanceId: string): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card || card.zone !== 'battlefield') return state;

  let nextState = registerBattlefieldAbilities(state, cardInstanceId);
  nextState = registerContinuousAbilitiesForPermanent(nextState, cardInstanceId);
  nextState = createETBTriggers(nextState, cardInstanceId);
  const enteredCard = nextState.cards.get(cardInstanceId);
  const definition = enteredCard ? getCardDefinition(nextState, enteredCard) : undefined;
  if (!enteredCard || !definition) return nextState;

  if (definition.card_types.includes('land')) {
    return checkTriggersForEvent(nextState, {
      kind: 'LandETB',
      instanceId: cardInstanceId,
      controllerId: enteredCard.ownerId,
    });
  }

  if (definition.card_types.includes('creature')) {
    return checkTriggersForEvent(nextState, {
      kind: 'CreatureETB',
      instanceId: cardInstanceId,
      controllerId: enteredCard.ownerId,
    });
  }

  return nextState;
}

export function applySearchLibraryPromptResponse(
  state: GameState,
  request: SearchLibraryPromptRequest,
  response: SearchLibraryPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'SearchLibrary' || response.kind !== 'SearchLibrary' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active search request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: promptRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This search prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: promptRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this search response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: promptRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  const selectedIds = [...new Set(response.selectedCardInstanceIds)];
  if (
    selectedIds.length !== response.selectedCardInstanceIds.length
    || selectedIds.length < request.minSelections
    || selectedIds.length > request.maxSelections
  ) {
    const message = `Search response must choose between ${request.minSelections} and ${request.maxSelections} card(s).`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: promptRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const legalChoiceIds = new Set(request.legalChoices.map(choice => choice.cardInstanceId));
  for (const selectedId of selectedIds) {
    if (!legalChoiceIds.has(selectedId)) {
      const message = `Illegal search selection: ${selectedPromptChoiceReason(state, request, selectedId)}`;
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: promptRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }

    const currentCard = state.cards.get(selectedId);
    if (!currentCard) {
      const message = 'Illegal search selection: card no longer exists';
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: promptRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }
    const currentChoice = evaluateSearchLibraryChoice(
      state,
      request.playerId,
      request.filter,
      request.destination,
      currentCard,
      request.sourceInstanceId,
    );
    if (!currentChoice.legal) {
      const message = `Illegal search selection: ${currentChoice.reason || 'selection no longer matches this search'}`;
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: promptRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }

    const replacementFailure = validateBattlefieldEntryReplacementResponse(
      state,
      request,
      response,
      selectedId,
    );
    if (replacementFailure) {
      const message = `Illegal replacement response: ${replacementFailure}`;
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: promptRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }
  }

  let nextState = state;
  if (selectedIds.length === 0) {
    nextState = request.shuffle ? executeShuffleLibrary(state, request.playerId) : state;
  } else {
    for (const selectedId of selectedIds) {
      nextState = executeSearchLibrary(
        nextState,
        request.playerId,
        request.filter,
        request.destination,
        request.tapped,
        false,
        {
          selectedCardInstanceId: selectedId,
          sourceInstanceId: request.sourceInstanceId,
          payLifeToEnterUntapped: response.payLifeToEnterUntapped,
        },
      );
      if (request.destination === 'battlefield') {
        nextState = applyBattlefieldEntryFromSearch(nextState, selectedId);
      }
    }
    if (request.shuffle) nextState = executeShuffleLibrary(nextState, request.playerId);
  }

  const invariantReport = validateStateInvariants(nextState);
  if (!invariantReport.ok) {
    const message = `Engine invariant failed: ${invariantReport.violations[0]?.message || 'invalid state'}`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invariant_violation',
      message,
      update: promptRejectUpdate(state, request, response, 'invariant_violation', message),
    };
  }

  return {
    requestId: response.requestId,
    ok: true,
    state: nextState,
    update: {
      ...buildStateUpdate(state, nextState),
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: response.requestId,
        playerId: response.playerId,
        promptKind: 'SearchLibrary',
        selectedCardInstanceIds: selectedIds,
        destination: request.destination,
      }],
    },
  };
}

function targetLabel(state: GameState, targetId: string): string {
  const card = state.cards.get(targetId);
  if (card) return cardName(state, card) || targetId;
  return playerName(state, targetId) || targetId;
}

function possibleTargetIds(state: GameState): string[] {
  const ids = new Set<string>();
  for (const player of state.players) {
    if (!player.hasLost) ids.add(player.id);
  }
  for (const card of state.cards.values()) {
    if (card.zone === 'battlefield') ids.add(card.instanceId);
  }
  for (const item of state.stack) {
    ids.add(item.id);
    if (item.kind === 'Spell') ids.add(item.cardInstanceId);
  }
  return [...ids].sort((a, b) => targetLabel(state, a).localeCompare(targetLabel(state, b)));
}

function targetFailureReason(state: GameState, spec: TargetSpec, targetId: string): string {
  const card = state.cards.get(targetId);
  if (spec.type === 'Player') return state.players.some(player => player.id === targetId && !player.hasLost)
    ? 'Does not match this target restriction'
    : 'Not a player';
  if (!card) return 'Not a targetable object for this effect';
  if (card.zone !== 'battlefield') return 'Not on the battlefield';
  const def = getCardDefinition(state, card);
  switch (spec.type) {
    case 'Creature':
      return 'Not a creature';
    case 'Permanent':
      return 'Does not match this permanent target restriction';
    case 'NonlandPermanent':
      return def.card_types.includes('land') ? 'Land permanents are excluded' : 'Does not match this target restriction';
    case 'Artifact':
      return 'Not an artifact';
    case 'Enchantment':
      return 'Not an enchantment';
    case 'ArtifactOrEnchantment':
      return 'Not an artifact or enchantment';
    case 'ArtifactEnchantmentOrLand':
      return 'Not an artifact, enchantment, or land';
    case 'Spell':
    case 'NoncreatureSpell':
    case 'CreatureSpell':
    case 'InstantOrSorcerySpell':
      return 'Not a matching spell on the stack';
    case 'CreatureCardInGraveyard':
      return 'Not a creature card in a graveyard';
    case 'Any':
      return 'Not a legal any-target object';
    default: {
      const _never: never = spec.type;
      return `Unsupported target type ${_never}`;
    }
  }
}

function buildTargetChoices(
  state: GameState,
  playerId: string,
  spec: TargetSpec,
): { legalChoices: TargetChoice[]; invalidChoices: TargetChoice[] } {
  const legalIds = new Set(getLegalTargets(state, playerId, spec));
  const choices = possibleTargetIds(state).map(targetId => ({
    targetId,
    label: targetLabel(state, targetId),
    legal: legalIds.has(targetId),
    reason: legalIds.has(targetId) ? undefined : targetFailureReason(state, spec, targetId),
  }));
  return {
    legalChoices: choices.filter(choice => choice.legal),
    invalidChoices: choices.filter(choice => !choice.legal),
  };
}

export function createSelectTargetPromptRequest(
  state: GameState,
  playerId: string,
  targetSpec: TargetSpec,
  options: CreateSelectTargetPromptOptions = {},
): SelectTargetPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const { legalChoices, invalidChoices } = buildTargetChoices(state, playerId, targetSpec);
  const count = targetSpec.count ?? 1;
  return {
    id: options.id || `target_${expectedStateId}_${hashText(`${playerId}:${targetSpec.id}:${createdAt}`)}`,
    kind: 'SelectTarget',
    playerId,
    expectedStateId,
    sourceInstanceId: options.sourceInstanceId,
    targetSpec,
    minSelections: options.minSelections ?? count,
    maxSelections: options.maxSelections ?? count,
    legalChoices,
    invalidChoices,
    createdAt,
  };
}

function targetPromptRejectUpdate(
  state: GameState,
  request: SelectTargetPromptRequest,
  response: SelectTargetPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      selectedTargetIds: response.selectedTargetIds,
    }],
    prompt: buildActionPrompt(state),
  };
}

export function applySelectTargetPromptResponse(
  state: GameState,
  request: SelectTargetPromptRequest,
  response: SelectTargetPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'SelectTarget' || response.kind !== 'SelectTarget' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active target request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: targetPromptRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This target prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: targetPromptRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this target response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: targetPromptRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  const selectedIds = [...new Set(response.selectedTargetIds)];
  if (
    selectedIds.length !== response.selectedTargetIds.length
    || selectedIds.length < request.minSelections
    || selectedIds.length > request.maxSelections
  ) {
    const message = `Target response must choose between ${request.minSelections} and ${request.maxSelections} target(s).`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: targetPromptRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const currentLegalIds = new Set(getLegalTargets(state, request.playerId, request.targetSpec));
  for (const targetId of selectedIds) {
    if (!currentLegalIds.has(targetId)) {
      const message = `Illegal target selection: ${targetFailureReason(state, request.targetSpec, targetId)}`;
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: targetPromptRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }
  }

  const update: EngineStateUpdate = {
    oldStateId: currentStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseAccepted',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: 'SelectTarget',
      selectedTargetIds: selectedIds,
    }],
    prompt: buildActionPrompt(state),
  };

  return {
    requestId: response.requestId,
    ok: true,
    state,
    update,
    selectedTargetIds: selectedIds,
  };
}

export function createBattlefieldEntryReplacementPromptRequest(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  options: CreateBattlefieldEntryReplacementPromptOptions = {},
): ChooseReplacementPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const card = state.cards.get(cardInstanceId);
  const def = card ? getCardDefinition(state, card) : undefined;
  const player = state.players.find(candidate => candidate.id === playerId);
  const cardLabel = def?.name || cardInstanceId;
  const optionalLifeCost = def ? getOptionalUntappedLifeCost(def.oracle_text) : undefined;
  const choices: ReplacementChoice[] = [];

  if (!card || card.ownerId !== playerId) {
    choices.push({
      optionId: 'enter_default',
      label: `Resolve ${cardLabel} entry`,
      legal: false,
      reason: 'Card is missing or not controlled by this player',
      effects: {},
    });
  } else if (optionalLifeCost === undefined) {
    choices.push({
      optionId: 'enter_default',
      label: `${cardLabel} enters normally`,
      legal: true,
      effects: {
        tapped: options.forceTapped || options.defaultTapped,
      },
    });
  } else {
    choices.push({
      optionId: 'pay_life_enter_untapped',
      label: `Pay ${optionalLifeCost} life so ${cardLabel} enters untapped`,
      legal: !options.forceTapped && Boolean(player && player.life >= optionalLifeCost),
      reason: options.forceTapped
        ? 'This effect forces the permanent to enter tapped'
        : !player || player.life < optionalLifeCost
          ? `Cannot pay ${optionalLifeCost} life`
          : undefined,
      effects: {
        tapped: false,
        lifePayment: optionalLifeCost,
      },
    });
    choices.push({
      optionId: 'enter_tapped',
      label: `${cardLabel} enters tapped`,
      legal: true,
      effects: {
        tapped: true,
        lifePayment: 0,
      },
    });
  }

  return {
    id: options.id || `replacement_${expectedStateId}_${hashText(`${playerId}:${cardInstanceId}:BattlefieldEntry:${createdAt}`)}`,
    kind: 'ChooseReplacement',
    playerId,
    expectedStateId,
    sourceInstanceId: options.sourceInstanceId,
    cardInstanceId,
    subject: 'BattlefieldEntry',
    forceTapped: options.forceTapped,
    defaultTapped: options.defaultTapped,
    legalChoices: choices.filter(choice => choice.legal),
    invalidChoices: choices.filter(choice => !choice.legal),
    createdAt,
  };
}

function replacementPromptRejectUpdate(
  state: GameState,
  request: ChooseReplacementPromptRequest,
  response: ChooseReplacementPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      selectedReplacementOptionId: response.selectedOptionId,
    }],
    prompt: buildActionPrompt(state),
  };
}

export function applyChooseReplacementPromptResponse(
  state: GameState,
  request: ChooseReplacementPromptRequest,
  response: ChooseReplacementPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'ChooseReplacement' || response.kind !== 'ChooseReplacement' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active replacement request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: replacementPromptRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This replacement prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: replacementPromptRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this replacement response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: replacementPromptRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  const rebuilt = createBattlefieldEntryReplacementPromptRequest(
    state,
    request.playerId,
    request.cardInstanceId,
    {
      id: request.id,
      sourceInstanceId: request.sourceInstanceId,
      forceTapped: request.forceTapped,
      defaultTapped: request.defaultTapped,
      createdAt: request.createdAt,
    },
  );
  const currentChoice = rebuilt.legalChoices.find(choice => choice.optionId === response.selectedOptionId);
  if (!currentChoice) {
    const rejectedChoice = rebuilt.invalidChoices.find(choice => choice.optionId === response.selectedOptionId);
    const message = `Illegal replacement choice: ${rejectedChoice?.reason || 'choice is not available'}`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: replacementPromptRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const update: EngineStateUpdate = {
    oldStateId: currentStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseAccepted',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: 'ChooseReplacement',
      selectedReplacementOptionId: response.selectedOptionId,
    }],
    prompt: buildActionPrompt(state),
  };

  return {
    requestId: response.requestId,
    ok: true,
    state,
    update,
    selectedReplacementOptionId: response.selectedOptionId,
  };
}

function manaActionChoice(state: GameState, action: ManaPaymentAction, legalActionKeys: Set<string>): ManaPaymentChoice {
  const legal = legalActionKeys.has(actionKey(action));
  return {
    action,
    label: labelForAction(state, action),
    legal,
    reason: legal ? undefined : 'Mana action is not legal in the current game state',
  };
}

export function createPayCostsPromptRequest(
  state: GameState,
  playerId: string,
  manaCost: ManaCost,
  options: CreatePayCostsPromptOptions = {},
): PayCostsPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const legalManaActions = getLegalActions(state, playerId)
    .filter((action): action is ManaPaymentAction => action.kind === 'ActivateManaAbility');
  const legalKeys = new Set(legalManaActions.map(action => actionKey(action)));
  const proposed = options.proposedManaActions || legalManaActions;
  const choices = proposed.map(action => manaActionChoice(state, action, legalKeys));

  return {
    id: options.id || `pay_${expectedStateId}_${hashText(`${playerId}:${stableJson(manaCost)}:${createdAt}`)}`,
    kind: 'PayCosts',
    playerId,
    expectedStateId,
    sourceInstanceId: options.sourceInstanceId,
    manaCost,
    legalChoices: choices.filter(choice => choice.legal),
    invalidChoices: choices.filter(choice => !choice.legal),
    proposedManaActions: proposed,
    createdAt,
  };
}

function payCostsRejectUpdate(
  state: GameState,
  request: PayCostsPromptRequest,
  response: PayCostsPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      selectedManaActions: response.selectedManaActions,
    }],
    prompt: buildActionPrompt(state),
  };
}

export function applyPayCostsPromptResponse(
  state: GameState,
  request: PayCostsPromptRequest,
  response: PayCostsPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'PayCosts' || response.kind !== 'PayCosts' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active payment request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: payCostsRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This payment prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: payCostsRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this payment response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: payCostsRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  let nextState = state;
  const nestedEvents: EngineEvent[] = [];
  for (const selectedAction of response.selectedManaActions) {
    if (selectedAction.kind !== 'ActivateManaAbility') {
      const message = 'Payment responses may only activate mana abilities.';
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: payCostsRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }

    const legalKeys = new Set(
      getLegalActions(nextState, request.playerId)
        .filter((action): action is ManaPaymentAction => action.kind === 'ActivateManaAbility')
        .map(action => actionKey(action)),
    );
    if (!legalKeys.has(actionKey(selectedAction))) {
      const message = `Illegal mana payment action: ${labelForAction(nextState, selectedAction)}`;
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: payCostsRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }

    const nestedRequest = createClientActionRequest(nextState, request.playerId, selectedAction, {
      id: `${response.requestId}:mana:${nestedEvents.length}`,
      source: 'ui',
      label: labelForAction(nextState, selectedAction),
    });
    const nestedResponse = applyClientActionRequest(nextState, nestedRequest);
    if (!nestedResponse.ok || !nestedResponse.state) {
      const message = nestedResponse.message || 'Mana action was rejected while paying costs.';
      return {
        requestId: response.requestId,
        ok: false,
        reason: nestedResponse.reason === 'invariant_violation' ? 'invariant_violation' : 'illegal_response',
        message,
        update: payCostsRejectUpdate(
          state,
          request,
          response,
          nestedResponse.reason === 'invariant_violation' ? 'invariant_violation' : 'illegal_response',
          message,
        ),
      };
    }
    if (nestedResponse.update) nestedEvents.push(...nestedResponse.update.rulesEvents);
    nextState = nestedResponse.state;
  }

  const player = nextState.players.find(candidate => candidate.id === request.playerId);
  if (!player || !canPayCost(player.manaPool, request.manaCost)) {
    const message = 'Selected mana actions do not produce enough mana to pay this cost.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: payCostsRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const invariantReport = validateStateInvariants(nextState);
  if (!invariantReport.ok) {
    const message = `Engine invariant failed: ${invariantReport.violations[0]?.message || 'invalid state'}`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invariant_violation',
      message,
      update: payCostsRejectUpdate(state, request, response, 'invariant_violation', message),
    };
  }

  return {
    requestId: response.requestId,
    ok: true,
    state: nextState,
    update: {
      ...buildStateUpdate(state, nextState),
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: response.requestId,
        playerId: response.playerId,
        promptKind: 'PayCosts',
        selectedManaActions: response.selectedManaActions,
      }, ...nestedEvents],
    },
    selectedManaActions: response.selectedManaActions,
  };
}

export function createSelectCardsPromptRequest(
  state: GameState,
  playerId: string,
  options: CreateSelectCardsPromptOptions = {},
): SelectCardsPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const zone = options.zone || 'hand';
  const destination = options.destination || 'graveyard';
  const subject = options.subject || 'ManualDiscard';
  const commitSelection = options.commitSelection ?? true;
  const minSelections = options.minSelections ?? 1;
  const maxSelections = options.maxSelections ?? minSelections;
  const choices = [...state.cards.values()]
    .filter(card => card.ownerId === playerId)
    .map(card => {
      const def = getCardDefinition(state, card);
      const inZone = card.zone === zone;
      const matchesFilter = !options.filter
        || matchesCardFilter(def, options.filter, {
          state,
          sourceInstanceId: options.sourceInstanceId,
        });
      return {
        cardInstanceId: card.instanceId,
        cardName: def?.name || card.instanceId,
        zone: card.zone,
        legal: inZone && matchesFilter,
        reason: !inZone
          ? `Card is not in ${zone}`
          : matchesFilter
            ? undefined
            : 'Card does not match the required selection filter',
      };
    })
    .sort((a, b) => {
      if (a.legal !== b.legal) return a.legal ? -1 : 1;
      return a.cardName.localeCompare(b.cardName);
    });

  return {
    id: options.id || `select_cards_${expectedStateId}_${hashText(`${playerId}:${subject}:${zone}:${destination}:${createdAt}`)}`,
    kind: 'SelectCards',
    playerId,
    expectedStateId,
    sourceInstanceId: options.sourceInstanceId,
    subject,
    zone,
    destination,
    filter: options.filter,
    commitSelection,
    minSelections,
    maxSelections,
    legalChoices: choices.filter(choice => choice.legal),
    invalidChoices: choices.filter(choice => !choice.legal),
    createdAt,
  };
}

function selectCardsRejectUpdate(
  state: GameState,
  request: SelectCardsPromptRequest,
  response: SelectCardsPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      selectedCardInstanceIds: response.selectedCardInstanceIds,
    }],
    prompt: buildActionPrompt(state),
  };
}

export function applySelectCardsPromptResponse(
  state: GameState,
  request: SelectCardsPromptRequest,
  response: SelectCardsPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'SelectCards' || response.kind !== 'SelectCards' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active card-selection request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: selectCardsRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This card-selection prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: selectCardsRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this card-selection response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: selectCardsRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  const selectedIds = [...new Set(response.selectedCardInstanceIds)];
  if (
    selectedIds.length !== response.selectedCardInstanceIds.length
    || selectedIds.length < request.minSelections
    || selectedIds.length > request.maxSelections
  ) {
    const message = `Card-selection response must choose between ${request.minSelections} and ${request.maxSelections} card(s).`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: selectCardsRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const legalIds = new Set(request.legalChoices.map(choice => choice.cardInstanceId));
  for (const selectedId of selectedIds) {
    const card = state.cards.get(selectedId);
    const def = card ? getCardDefinition(state, card) : undefined;
    const matchesFilter = !request.filter
      || Boolean(def && matchesCardFilter(def, request.filter, {
        state,
        sourceInstanceId: request.sourceInstanceId,
      }));
    if (!legalIds.has(selectedId) || !card || card.ownerId !== request.playerId || card.zone !== request.zone || !matchesFilter) {
      const invalidChoice = request.invalidChoices.find(choice => choice.cardInstanceId === selectedId);
      const reason = invalidChoice?.reason
        || (!card || card.ownerId !== request.playerId || card.zone !== request.zone
          ? `Card is not in ${request.zone}`
          : 'Card does not match the required selection filter');
      const message = `Illegal card selection: ${cardName(state, card) || selectedId}. ${reason}.`;
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: selectCardsRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }
  }

  const newCards = new Map(state.cards);
  if (request.commitSelection) {
    for (const selectedId of selectedIds) {
      const card = newCards.get(selectedId);
      if (!card) continue;
      newCards.set(selectedId, {
        ...card,
        zone: request.destination,
        tapped: request.destination === 'battlefield' ? card.tapped : false,
        damage: request.destination === 'battlefield' ? card.damage : 0,
        counters: request.destination === 'battlefield' ? card.counters : {},
      });
    }
  }
  const nextState: GameState = request.commitSelection ? { ...state, cards: newCards } : state;
  const invariantReport = validateStateInvariants(nextState);
  if (!invariantReport.ok) {
    const message = `Engine invariant failed: ${invariantReport.violations[0]?.message || 'invalid state'}`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invariant_violation',
      message,
      update: selectCardsRejectUpdate(state, request, response, 'invariant_violation', message),
    };
  }

  return {
    requestId: response.requestId,
    ok: true,
    state: nextState,
    update: {
      ...buildStateUpdate(state, nextState),
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: response.requestId,
        playerId: response.playerId,
        promptKind: 'SelectCards',
        selectedCardInstanceIds: selectedIds,
      }],
    },
    selectedCardInstanceIds: selectedIds,
  };
}

function shuffleCardEntries(entries: [string, CardInstance][]): [string, CardInstance][] {
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function openingHandCards(state: GameState, playerId: string): CardInstance[] {
  return [...state.cards.values()].filter(card => card.ownerId === playerId && card.zone === 'hand');
}

function openingHandLandCount(state: GameState, hand: CardInstance[]): number {
  return hand.filter(card => {
    const def = getCardDefinition(state, card);
    return def.card_types.includes('land');
  }).length;
}

export function redrawOpeningHandForMulligan(
  state: GameState,
  playerId: string,
  handSize = 7,
): GameState {
  const pool: [string, CardInstance][] = [];
  const otherEntries: [string, CardInstance][] = [];

  for (const [id, card] of state.cards) {
    if (card.ownerId === playerId && (card.zone === 'hand' || card.zone === 'library')) {
      pool.push([id, { ...card, zone: 'library' }]);
    } else {
      otherEntries.push([id, card]);
    }
  }

  const shuffled = shuffleCardEntries(pool).map(([id, card], index) => [
    id,
    { ...card, zone: index < handSize ? 'hand' : 'library' },
  ] as [string, CardInstance]);

  return { ...state, cards: new Map([...otherEntries, ...shuffled]) };
}

export function bottomOpeningHandCardsForMulligan(
  state: GameState,
  playerId: string,
  count: number,
): GameState {
  if (count <= 0) return state;

  const hand = openingHandCards(state, playerId);
  if (hand.length === 0) return state;
  const lands = openingHandLandCount(state, hand);

  const scored = hand.map(card => {
    const def = getCardDefinition(state, card);
    const isLand = def.card_types.includes('land');
    let score = def.cmc ?? 0;
    if (isLand && lands > 3) score += 10;
    if (isLand && lands <= 2) score -= 10;
    if (!isLand && lands <= 2 && (def?.cmc ?? 0) >= 5) score += 6;
    if (!isLand && (def?.cmc ?? 0) <= 2) score -= 2;
    return { card, score };
  });

  const toBottom = new Set(
    scored
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(count, hand.length))
      .map(item => item.card.instanceId),
  );

  const keptEntries: [string, CardInstance][] = [];
  const bottomEntries: [string, CardInstance][] = [];
  for (const [id, card] of state.cards) {
    if (toBottom.has(id)) {
      bottomEntries.push([id, {
        ...card,
        zone: 'library',
        tapped: false,
        damage: 0,
      }]);
    } else {
      keptEntries.push([id, card]);
    }
  }

  return { ...state, cards: new Map([...keptEntries, ...bottomEntries]) };
}

function openingMulliganRedrawReject(
  state: GameState,
  reason: OpeningMulliganRedrawFailure,
  message: string,
): OpeningMulliganRedrawResult {
  return {
    ok: false,
    reason,
    message,
    update: {
      ...buildStateUpdate(state, state),
      rulesEvents: [{
        kind: 'PromptResponseRejected',
        requestId: 'opening-mulligan-redraw',
        playerId: activePlayerId(state) || '',
        promptKind: 'SelectCards',
        reason: reason === 'invariant_violation' ? 'invariant_violation' : 'illegal_response',
        message,
      }],
    },
  };
}

export function applyOpeningMulliganRedraw(
  state: GameState,
  playerId: string,
  cardInstanceIds: string[],
): OpeningMulliganRedrawResult {
  const selectedIds = [...new Set(cardInstanceIds.filter(Boolean))];
  if (selectedIds.length === 0) {
    return openingMulliganRedrawReject(state, 'empty_selection', 'Select at least one card to mulligan.');
  }
  if (selectedIds.length !== cardInstanceIds.filter(Boolean).length) {
    return openingMulliganRedrawReject(state, 'duplicate_selection', 'A card can only be selected once.');
  }

  for (const id of selectedIds) {
    const card = state.cards.get(id);
    if (!card || card.ownerId !== playerId || card.zone !== 'hand') {
      return openingMulliganRedrawReject(state, 'illegal_selection', 'Mulligan redraw selections must be cards in your hand.');
    }
  }

  const selected = new Set(selectedIds);
  const libraryEntries: [string, CardInstance][] = [];
  const selectedEntries: [string, CardInstance][] = [];
  const otherEntries: [string, CardInstance][] = [];

  for (const [id, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryEntries.push([id, card]);
      continue;
    }

    if (selected.has(id) && card.ownerId === playerId && card.zone === 'hand') {
      selectedEntries.push([id, { ...card, zone: 'library' }]);
      continue;
    }

    otherEntries.push([id, card]);
  }

  const redrawn = Math.min(selectedEntries.length, libraryEntries.length);
  const shuffledLibrary = shuffleCardEntries(libraryEntries).map(([id, card], index) => [
    id,
    { ...card, zone: index < redrawn ? 'hand' : 'library' },
  ] as [string, CardInstance]);
  const returnedSelected = shuffleCardEntries(selectedEntries);
  const nextState: GameState = {
    ...state,
    cards: new Map([...otherEntries, ...shuffledLibrary, ...returnedSelected]),
  };
  const invariantReport = validateStateInvariants(nextState);
  if (!invariantReport.ok) {
    return openingMulliganRedrawReject(
      state,
      'invariant_violation',
      `Engine invariant failed: ${invariantReport.violations[0]?.message || 'invalid state'}`,
    );
  }

  return {
    ok: true,
    state: nextState,
    update: buildStateUpdate(state, nextState),
    redrawn,
  };
}

function libraryManipulationRejectUpdate(
  state: GameState,
  request: LibraryManipulationPromptRequest,
  response: LibraryManipulationPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      selectedCardInstanceIds: [...response.topCardInstanceIds, ...response.movedCardInstanceIds],
    }],
    prompt: buildActionPrompt(state),
  };
}

function libraryManipulationChoiceKeys(
  mode: LibraryManipulationMode,
  topIds: string[],
  movedIds: string[],
): Record<string, string> {
  return mode === 'scry'
    ? {
        scryTopIds: topIds.join(','),
        scryBottomIds: movedIds.join(','),
      }
    : {
        surveilTopIds: topIds.join(','),
        surveilGraveyardIds: movedIds.join(','),
      };
}

export function createLibraryManipulationPromptRequest(
  state: GameState,
  playerId: string,
  mode: LibraryManipulationMode,
  count: number,
  options: CreateLibraryManipulationPromptOptions = {},
): LibraryManipulationPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const topLibraryCards = [...state.cards.values()]
    .filter(card => card.ownerId === playerId && card.zone === 'library')
    .slice(0, Math.max(0, count));
  const legalChoices = topLibraryCards.map(card => ({
    cardInstanceId: card.instanceId,
    cardName: cardName(state, card) || card.instanceId,
    legal: true,
  }));

  return {
    id: options.id || `library_choice_${expectedStateId}_${hashText(`${playerId}:${mode}:${count}:${createdAt}`)}`,
    kind: 'LibraryManipulation',
    playerId,
    expectedStateId,
    sourceInstanceId: options.sourceInstanceId,
    stackItemId: options.stackItemId,
    mode,
    count,
    legalChoices,
    invalidChoices: [],
    createdAt,
  };
}

export function applyLibraryManipulationPromptResponse(
  state: GameState,
  request: LibraryManipulationPromptRequest,
  response: LibraryManipulationPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'LibraryManipulation' || response.kind !== 'LibraryManipulation' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active library-manipulation request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: libraryManipulationRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This library-manipulation prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: libraryManipulationRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this library-manipulation response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: libraryManipulationRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  const submittedIds = [...response.topCardInstanceIds, ...response.movedCardInstanceIds];
  const submittedSet = new Set(submittedIds);
  const revealedIds = request.legalChoices.map(choice => choice.cardInstanceId);
  const revealedSet = new Set(revealedIds);
  const hasDuplicate = submittedSet.size !== submittedIds.length;
  const hasUnknown = submittedIds.some(id => !revealedSet.has(id));
  const missesRevealed = revealedIds.some(id => !submittedSet.has(id));
  if (hasDuplicate || hasUnknown || missesRevealed) {
    const message = `${request.mode} response must choose each revealed card exactly once.`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: libraryManipulationRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const choiceKeys = libraryManipulationChoiceKeys(
    request.mode,
    response.topCardInstanceIds,
    response.movedCardInstanceIds,
  );
  let nextState = state;
  if (request.stackItemId) {
    const stackIndex = state.stack.findIndex(item => item.id === request.stackItemId);
    if (stackIndex < 0) {
      const message = 'The stack item for this library-manipulation prompt is no longer available.';
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'stale_state',
        message,
        update: libraryManipulationRejectUpdate(state, request, response, 'stale_state', message),
      };
    }
    const stackItem = state.stack[stackIndex] as StackItem & { namedCardChoices?: Record<string, string> };
    const stack = [...state.stack];
    stack[stackIndex] = {
      ...stackItem,
      namedCardChoices: {
        ...(stackItem.namedCardChoices || {}),
        ...choiceKeys,
      },
    } as StackItem;
    nextState = { ...state, stack };
  }

  return {
    requestId: response.requestId,
    ok: true,
    state: nextState,
    update: {
      ...buildStateUpdate(state, nextState),
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: response.requestId,
        playerId: response.playerId,
        promptKind: 'LibraryManipulation',
        selectedCardInstanceIds: submittedIds,
      }],
    },
    selectedCardInstanceIds: submittedIds,
    libraryManipulationChoices: choiceKeys,
  };
}

function apnapPlayerOrder(state: GameState): string[] {
  const playerOrder: string[] = [];
  for (let i = 0; i < state.players.length; i += 1) {
    const index = (state.activePlayerIndex + i) % state.players.length;
    playerOrder.push(state.players[index].id);
  }
  return playerOrder;
}

function orderedTriggerChoices(state: GameState): TriggerOrderChoice[] {
  const playerOrder = apnapPlayerOrder(state);
  return [...(state.pendingTriggers || [])]
    .sort((a, b) => {
      const controllerDiff = playerOrder.indexOf(a.controllerId) - playerOrder.indexOf(b.controllerId);
      return controllerDiff !== 0 ? controllerDiff : a.id.localeCompare(b.id);
    })
    .map(trigger => ({
      triggerId: trigger.id,
      controllerId: trigger.controllerId,
      sourceInstanceId: trigger.sourceInstanceId,
      sourceName: cardName(state, state.cards.get(trigger.sourceInstanceId)) || trigger.sourceInstanceId,
      triggerKind: trigger.ability.trigger.kind,
    }));
}

export function createOrderTriggersPromptRequest(
  state: GameState,
  playerId: string,
  options: CreateOrderTriggersPromptOptions = {},
): OrderTriggersPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();

  return {
    id: options.id || `order_triggers_${expectedStateId}_${hashText(`${playerId}:${createdAt}`)}`,
    kind: 'OrderTriggers',
    playerId,
    expectedStateId,
    triggers: orderedTriggerChoices(state),
    createdAt,
  };
}

function optionalTriggerChoice(
  state: GameState,
  triggerId: string,
): PendingTrigger | undefined {
  return (state.pendingTriggers || []).find(trigger => trigger.id === triggerId);
}

export function createOptionalTriggerPromptRequest(
  state: GameState,
  playerId: string,
  triggerId: string,
  options: CreateOptionalTriggerPromptOptions = {},
): OptionalTriggerPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const trigger = optionalTriggerChoice(state, triggerId);

  return {
    id: options.id || `optional_trigger_${expectedStateId}_${hashText(`${playerId}:${triggerId}:${createdAt}`)}`,
    kind: 'OptionalTrigger',
    playerId,
    expectedStateId,
    triggerId,
    sourceInstanceId: trigger?.sourceInstanceId || '',
    sourceName: trigger ? cardName(state, state.cards.get(trigger.sourceInstanceId)) || trigger.sourceInstanceId : '',
    triggerKind: trigger?.ability.trigger.kind || '',
    createdAt,
  };
}

function optionalTriggerRejectUpdate(
  state: GameState,
  request: OptionalTriggerPromptRequest,
  response: OptionalTriggerPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      optionalTriggerId: response.triggerId,
      useOptionalTrigger: response.use,
    }],
    prompt: buildActionPrompt(state),
  };
}

export function applyOptionalTriggerPromptResponse(
  state: GameState,
  request: OptionalTriggerPromptRequest,
  response: OptionalTriggerPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'OptionalTrigger' || response.kind !== 'OptionalTrigger' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active optional-trigger request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: optionalTriggerRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This optional-trigger prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: optionalTriggerRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this optional-trigger response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: optionalTriggerRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  if (request.triggerId !== response.triggerId) {
    const message = 'Optional-trigger response must answer the requested trigger.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: optionalTriggerRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const trigger = optionalTriggerChoice(state, request.triggerId);
  if (!trigger || trigger.controllerId !== response.playerId || trigger.ability.optional !== true) {
    const message = 'Optional-trigger response must reference one of your pending optional triggers.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: optionalTriggerRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const nextState = response.use
    ? putPendingTriggerOnStack(state, request.triggerId)
    : { ...state, pendingTriggers: state.pendingTriggers.filter(candidate => candidate.id !== request.triggerId) };
  const invariantReport = validateStateInvariants(nextState);
  if (!invariantReport.ok) {
    const message = `Engine invariant failed: ${invariantReport.violations[0]?.message || 'invalid state'}`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invariant_violation',
      message,
      update: optionalTriggerRejectUpdate(state, request, response, 'invariant_violation', message),
    };
  }

  return {
    requestId: response.requestId,
    ok: true,
    state: nextState,
    update: {
      ...buildStateUpdate(state, nextState),
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: response.requestId,
        playerId: response.playerId,
        promptKind: 'OptionalTrigger',
        optionalTriggerId: response.triggerId,
        useOptionalTrigger: response.use,
      }],
    },
  };
}

function orderTriggersRejectUpdate(
  state: GameState,
  request: OrderTriggersPromptRequest,
  response: OrderTriggersPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      orderedTriggerIds: response.orderedTriggerIds,
    }],
    prompt: buildActionPrompt(state),
  };
}

function triggerOrderRespectsApnap(state: GameState, triggerIds: string[]): boolean {
  const playerOrder = apnapPlayerOrder(state);
  const pendingById = new Map((state.pendingTriggers || []).map(trigger => [trigger.id, trigger]));
  let lastControllerIndex = -1;

  for (const triggerId of triggerIds) {
    const trigger = pendingById.get(triggerId);
    if (!trigger) return false;
    const controllerIndex = playerOrder.indexOf(trigger.controllerId);
    if (controllerIndex < lastControllerIndex) return false;
    lastControllerIndex = controllerIndex;
  }

  return true;
}

export function applyOrderTriggersPromptResponse(
  state: GameState,
  request: OrderTriggersPromptRequest,
  response: OrderTriggersPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'OrderTriggers' || response.kind !== 'OrderTriggers' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active trigger-order request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: orderTriggersRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This trigger-order prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: orderTriggersRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this trigger-order response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: orderTriggersRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  const expectedIds = (state.pendingTriggers || []).map(trigger => trigger.id).sort();
  const submittedIds = [...response.orderedTriggerIds].sort();
  const hasDuplicates = new Set(response.orderedTriggerIds).size !== response.orderedTriggerIds.length;
  const sameSet = expectedIds.length === submittedIds.length
    && expectedIds.every((id, index) => id === submittedIds[index]);
  if (hasDuplicates || !sameSet || !triggerOrderRespectsApnap(state, response.orderedTriggerIds)) {
    const message = 'Trigger order must include every pending trigger exactly once and preserve APNAP controller groups.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: orderTriggersRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  const nextState = putTriggersOnStack(state, {}, response.orderedTriggerIds);
  const invariantReport = validateStateInvariants(nextState);
  if (!invariantReport.ok) {
    const message = `Engine invariant failed: ${invariantReport.violations[0]?.message || 'invalid state'}`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invariant_violation',
      message,
      update: orderTriggersRejectUpdate(state, request, response, 'invariant_violation', message),
    };
  }

  return {
    requestId: response.requestId,
    ok: true,
    state: nextState,
    update: {
      ...buildStateUpdate(state, nextState),
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: response.requestId,
        playerId: response.playerId,
        promptKind: 'OrderTriggers',
        orderedTriggerIds: response.orderedTriggerIds,
      }],
    },
    orderedTriggerIds: response.orderedTriggerIds,
  };
}

function damageAssignmentGroups(state: GameState, playerId: string): DamageAssignmentGroup[] {
  if (!state.combat) return [];

  return state.combat.attackers
    .filter(attacker => {
      const attackerCard = state.cards.get(attacker.cardInstanceId);
      return attackerCard?.ownerId === playerId
        && state.combat!.blockers.filter(blocker => blocker.blockingAttackerId === attacker.cardInstanceId).length > 1;
    })
    .map(attacker => {
      const blockers = state.combat!.blockers
        .filter(blocker => blocker.blockingAttackerId === attacker.cardInstanceId)
        .map(blocker => {
          const blockerCard = state.cards.get(blocker.cardInstanceId);
          const remainingToughness = Math.max(
            0,
            getEffectiveToughness(state, blocker.cardInstanceId) - (blockerCard?.damage || 0),
          );
          const lethalDamage = instanceHasKeyword(state, attacker.cardInstanceId, 'Deathtouch')
            ? Math.min(1, remainingToughness)
            : remainingToughness;
          return {
            blockerId: blocker.cardInstanceId,
            blockerName: cardName(state, blockerCard) || blocker.cardInstanceId,
            lethalDamage,
            currentDamage: blockerCard?.damage || 0,
            legal: Boolean(blockerCard && blockerCard.zone === 'battlefield'),
            reason: blockerCard?.zone === 'battlefield' ? undefined : 'Blocker is no longer on the battlefield',
          };
        });

      return {
        attackerId: attacker.cardInstanceId,
        attackerName: cardName(state, state.cards.get(attacker.cardInstanceId)) || attacker.cardInstanceId,
        attackerPower: getEffectivePower(state, attacker.cardInstanceId),
        blockers,
      };
    });
}

export function createDamageAssignmentPromptRequest(
  state: GameState,
  playerId: string,
  options: CreateDamageAssignmentPromptOptions = {},
): DamageAssignmentPromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();

  return {
    id: options.id || `damage_assignment_${expectedStateId}_${hashText(`${playerId}:${createdAt}`)}`,
    kind: 'DamageAssignment',
    playerId,
    expectedStateId,
    groups: damageAssignmentGroups(state, playerId),
    createdAt,
  };
}

function damageAssignmentRejectUpdate(
  state: GameState,
  request: DamageAssignmentPromptRequest,
  response: DamageAssignmentPromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
      damageAssignmentOrders: response.orders,
    }],
    prompt: buildActionPrompt(state),
  };
}

export function applyDamageAssignmentPromptResponse(
  state: GameState,
  request: DamageAssignmentPromptRequest,
  response: DamageAssignmentPromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'DamageAssignment' || response.kind !== 'DamageAssignment' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active damage-assignment request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: damageAssignmentRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This damage-assignment prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: damageAssignmentRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this damage-assignment response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: damageAssignmentRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  const groups = damageAssignmentGroups(state, response.playerId);
  const expectedGroups = new Map(groups.map(group => [group.attackerId, group]));
  const responseGroups = new Map(response.orders.map(order => [order.attackerId, order]));
  if (responseGroups.size !== response.orders.length || responseGroups.size !== expectedGroups.size) {
    const message = 'Damage assignment must include exactly one order for each blocked attacker with multiple blockers.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: damageAssignmentRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  for (const [attackerId, group] of expectedGroups) {
    const order = responseGroups.get(attackerId);
    if (!order) {
      const message = `Missing damage order for ${group.attackerName}.`;
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: damageAssignmentRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }

    const expectedIds = group.blockers.map(blocker => blocker.blockerId).sort();
    const submittedIds = [...order.blockerIds].sort();
    const hasDuplicates = new Set(order.blockerIds).size !== order.blockerIds.length;
    const matches = expectedIds.length === submittedIds.length
      && expectedIds.every((id, index) => id === submittedIds[index]);
    if (hasDuplicates || !matches) {
      const message = `Damage order for ${group.attackerName} must include each current blocker exactly once.`;
      return {
        requestId: response.requestId,
        ok: false,
        reason: 'illegal_response',
        message,
        update: damageAssignmentRejectUpdate(state, request, response, 'illegal_response', message),
      };
    }
  }

  const blockerOrder = {
    ...(state.combat?.blockerOrder || {}),
    ...Object.fromEntries(response.orders.map(order => [order.attackerId, [...order.blockerIds]])),
  };
  const nextState: GameState = state.combat
    ? { ...state, combat: { ...state.combat, blockerOrder } }
    : state;
  const invariantReport = validateStateInvariants(nextState);
  if (!invariantReport.ok) {
    const message = `Engine invariant failed: ${invariantReport.violations[0]?.message || 'invalid state'}`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invariant_violation',
      message,
      update: damageAssignmentRejectUpdate(state, request, response, 'invariant_violation', message),
    };
  }

  return {
    requestId: response.requestId,
    ok: true,
    state: nextState,
    update: {
      ...buildStateUpdate(state, nextState),
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: response.requestId,
        playerId: response.playerId,
        promptKind: 'DamageAssignment',
        damageAssignmentOrders: response.orders,
      }],
    },
    damageAssignmentOrders: response.orders,
  };
}

function chooseModeRejectUpdate(
  state: GameState,
  request: ChooseModePromptRequest,
  response: ChooseModePromptResponse,
  reason: ClientPromptFailure,
  message: string,
): EngineStateUpdate {
  const currentStateId = stateFingerprint(state);
  return {
    oldStateId: request.expectedStateId,
    newStateId: currentStateId,
    activePlayerId: activePlayerId(state),
    priorityPlayerId: priorityPlayerId(state),
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    priority: prioritySnapshot(state),
    visibleDiffs: [],
    rulesEvents: [{
      kind: 'PromptResponseRejected',
      requestId: response.requestId,
      playerId: response.playerId,
      promptKind: request.kind,
      reason,
      message,
    }],
    prompt: buildActionPrompt(state),
  };
}

function modalChoicesForCard(state: GameState, sourceInstanceId: string): { chooseCount: number; upTo?: boolean; choices: ModeChoice[] } | undefined {
  const card = state.cards.get(sourceInstanceId);
  const def = card ? getCardDefinition(state, card) : undefined;
  if (!def) return undefined;
  const parsed = parseOracleText(def.oracle_text);
  if (parsed.kind !== 'Modal') return undefined;
  return {
    chooseCount: parsed.modal.chooseCount,
    upTo: parsed.modal.upTo,
    choices: parsed.modal.choices.map((choice, modeIndex) => ({
      modeIndex,
      label: choice.label || `Mode ${modeIndex + 1}`,
      legal: true,
    })),
  };
}

export function createChooseModePromptRequest(
  state: GameState,
  playerId: string,
  sourceInstanceId: string,
  options: CreateChooseModePromptOptions = {},
): ChooseModePromptRequest {
  const expectedStateId = stateFingerprint(state);
  const createdAt = options.createdAt ?? Date.now();
  const modal = modalChoicesForCard(state, sourceInstanceId);
  const minSelections = options.minSelections ?? (modal?.upTo ? 1 : modal?.chooseCount ?? 1);
  const maxSelections = options.maxSelections ?? (modal?.chooseCount ?? minSelections);
  const legalChoices = modal?.choices || [];
  return {
    id: options.id || `choose_mode_${expectedStateId}_${hashText(`${playerId}:${sourceInstanceId}:${createdAt}`)}`,
    kind: 'ChooseMode',
    playerId,
    expectedStateId,
    sourceInstanceId,
    minSelections,
    maxSelections,
    legalChoices,
    invalidChoices: modal ? [] : [{
      modeIndex: -1,
      label: 'No modal choices',
      legal: false,
      reason: 'The source is not a modal spell',
    }],
    createdAt,
  };
}

export function applyChooseModePromptResponse(
  state: GameState,
  request: ChooseModePromptRequest,
  response: ChooseModePromptResponse,
): ClientPromptResponse {
  if (request.kind !== 'ChooseMode' || response.kind !== 'ChooseMode' || request.id !== response.requestId) {
    const message = 'Prompt response does not match the active mode-choice request.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'invalid_request',
      message,
      update: chooseModeRejectUpdate(state, request, response, 'invalid_request', message),
    };
  }

  if (request.playerId !== response.playerId) {
    const message = 'This mode-choice prompt belongs to another player.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'wrong_player',
      message,
      update: chooseModeRejectUpdate(state, request, response, 'wrong_player', message),
    };
  }

  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId !== currentStateId) {
    const message = 'The game state changed before this mode-choice response reached the engine.';
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'stale_state',
      message,
      update: chooseModeRejectUpdate(state, request, response, 'stale_state', message),
    };
  }

  const selectedModes = [...new Set(response.selectedModeIndices)];
  const legalModes = new Set(request.legalChoices.map(choice => choice.modeIndex));
  if (
    selectedModes.length !== response.selectedModeIndices.length
    || selectedModes.length < request.minSelections
    || selectedModes.length > request.maxSelections
    || selectedModes.some(mode => !legalModes.has(mode))
  ) {
    const message = `Mode response must choose between ${request.minSelections} and ${request.maxSelections} legal mode(s).`;
    return {
      requestId: response.requestId,
      ok: false,
      reason: 'illegal_response',
      message,
      update: chooseModeRejectUpdate(state, request, response, 'illegal_response', message),
    };
  }

  return {
    requestId: response.requestId,
    ok: true,
    state,
    update: {
      ...buildStateUpdate(state, state),
      rulesEvents: [{
        kind: 'PromptResponseAccepted',
        requestId: response.requestId,
        playerId: response.playerId,
        promptKind: 'ChooseMode',
      }],
    },
    selectedModeIndices: selectedModes,
  };
}

function manaPoolDiffs(before: ManaPool, after: ManaPool, playerId: string): VisibleDiff[] {
  const diffs: VisibleDiff[] = [];
  for (const color of MANA_COLORS) {
    if (before[color] !== after[color]) {
      diffs.push({
        kind: 'ManaPoolChanged',
        playerId,
        color,
        from: before[color],
        to: after[color],
      });
    }
  }
  return diffs;
}

function counterKeys(before?: Record<string, number>, after?: Record<string, number>): string[] {
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
}

function numberRecordKeys(before?: Record<string, number>, after?: Record<string, number>): string[] {
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
}

function combatSummary(state: GameState): CombatSummary | undefined {
  if (!state.combat) return undefined;
  return {
    attackers: [...state.combat.attackers]
      .map(attacker => ({
        cardId: attacker.cardInstanceId,
        defenderId: attacker.defendingPlayerId,
      }))
      .sort((a, b) => `${a.cardId}:${a.defenderId}`.localeCompare(`${b.cardId}:${b.defenderId}`)),
    blockers: [...state.combat.blockers]
      .map(blocker => ({
        cardId: blocker.cardInstanceId,
        attackerId: blocker.blockingAttackerId,
      }))
      .sort((a, b) => `${a.cardId}:${a.attackerId}`.localeCompare(`${b.cardId}:${b.attackerId}`)),
    blockersDeclared: state.combat.blockersDeclared,
    blockersDeclaredBy: [...(state.combat.blockersDeclaredBy || [])].sort(),
    blockerOrder: Object.entries(state.combat.blockerOrder || {})
      .map(([attackerId, blockerIds]) => ({ attackerId, blockerIds: [...blockerIds] }))
      .sort((a, b) => a.attackerId.localeCompare(b.attackerId)),
    damageAssignment: [...state.combat.damageAssignment.entries()]
      .map(([cardId, amount]) => ({ cardId, amount }))
      .sort((a, b) => a.cardId.localeCompare(b.cardId)),
  };
}

function diffCards(before: GameState, after: GameState): VisibleDiff[] {
  const diffs: VisibleDiff[] = [];
  const cardIds = [...new Set([...before.cards.keys(), ...after.cards.keys()])].sort();

  for (const cardId of cardIds) {
    const beforeCard = before.cards.get(cardId);
    const afterCard = after.cards.get(cardId);
    const reference = afterCard || beforeCard;
    if (!reference) continue;
    const name = cardName(after, afterCard) || cardName(before, beforeCard);

    if (beforeCard?.zone !== afterCard?.zone) {
      diffs.push({
        kind: 'CardZoneChanged',
        cardId,
        cardName: name,
        ownerId: reference.ownerId,
        from: beforeCard?.zone,
        to: afterCard?.zone,
      });
    }

    if (beforeCard && afterCard && beforeCard.tapped !== afterCard.tapped) {
      diffs.push({
        kind: 'CardTappedChanged',
        cardId,
        cardName: name,
        ownerId: reference.ownerId,
        from: beforeCard.tapped,
        to: afterCard.tapped,
      });
    }

    if (beforeCard && afterCard && beforeCard.damage !== afterCard.damage) {
      diffs.push({
        kind: 'CardDamageChanged',
        cardId,
        cardName: name,
        ownerId: reference.ownerId,
        from: beforeCard.damage,
        to: afterCard.damage,
      });
    }

    if (beforeCard && afterCard && beforeCard.summoningSick !== afterCard.summoningSick) {
      diffs.push({
        kind: 'CardSummoningSicknessChanged',
        cardId,
        cardName: name,
        ownerId: reference.ownerId,
        from: beforeCard.summoningSick,
        to: afterCard.summoningSick,
      });
    }

    if (beforeCard && afterCard && Boolean(beforeCard.phasedOut) !== Boolean(afterCard.phasedOut)) {
      diffs.push({
        kind: 'CardPhasedOutChanged',
        cardId,
        cardName: name,
        ownerId: reference.ownerId,
        from: Boolean(beforeCard.phasedOut),
        to: Boolean(afterCard.phasedOut),
      });
    }

    if (beforeCard?.attachedTo !== afterCard?.attachedTo) {
      diffs.push({
        kind: 'AttachmentChanged',
        cardId,
        cardName: name,
        ownerId: reference.ownerId,
        from: beforeCard?.attachedTo,
        to: afterCard?.attachedTo,
      });
    }

    for (const counterType of counterKeys(beforeCard?.counters, afterCard?.counters)) {
      const oldCount = beforeCard?.counters[counterType] || 0;
      const newCount = afterCard?.counters[counterType] || 0;
      if (oldCount !== newCount) {
        diffs.push({
          kind: 'CounterChanged',
          cardId,
          cardName: name,
          ownerId: reference.ownerId,
          counterType,
          from: oldCount,
          to: newCount,
        });
      }
    }
  }

  return diffs;
}

export function diffGameStates(before: GameState, after: GameState): VisibleDiff[] {
  const diffs: VisibleDiff[] = [];

  const beforeActive = activePlayerId(before);
  const afterActive = activePlayerId(after);
  if (
    before.turnNumber !== after.turnNumber
    || beforeActive !== afterActive
    || before.phase !== after.phase
    || before.step !== after.step
  ) {
    diffs.push({
      kind: 'PhaseChanged',
      from: {
        turnNumber: before.turnNumber,
        activePlayerId: beforeActive,
        phase: before.phase,
        step: before.step,
      },
      to: {
        turnNumber: after.turnNumber,
        activePlayerId: afterActive,
        phase: after.phase,
        step: after.step,
      },
    });
  }

  const beforePriority = priorityPlayerId(before);
  const afterPriority = priorityPlayerId(after);
  if (beforePriority !== afterPriority) {
    diffs.push({ kind: 'PriorityChanged', from: beforePriority, to: afterPriority });
  }

  if (
    before.stack.length !== after.stack.length
    || stackSummary(before, before.stack[before.stack.length - 1])?.id
      !== stackSummary(after, after.stack[after.stack.length - 1])?.id
  ) {
    diffs.push({
      kind: 'StackChanged',
      fromCount: before.stack.length,
      toCount: after.stack.length,
      fromTop: stackSummary(before, before.stack[before.stack.length - 1]),
      toTop: stackSummary(after, after.stack[after.stack.length - 1]),
    });
  }

  const beforeCombat = combatSummary(before);
  const afterCombat = combatSummary(after);
  if (stableJson(beforeCombat ?? null) !== stableJson(afterCombat ?? null)) {
    diffs.push({
      kind: 'CombatChanged',
      from: beforeCombat,
      to: afterCombat,
    });
  }

  for (const beforePlayer of before.players) {
    const afterPlayer = after.players.find(player => player.id === beforePlayer.id);
    if (!afterPlayer) continue;
    if (beforePlayer.life !== afterPlayer.life) {
      diffs.push({
        kind: 'LifeChanged',
        playerId: beforePlayer.id,
        from: beforePlayer.life,
        to: afterPlayer.life,
      });
    }
    if (beforePlayer.poisonCounters !== afterPlayer.poisonCounters) {
      diffs.push({
        kind: 'PoisonChanged',
        playerId: beforePlayer.id,
        from: beforePlayer.poisonCounters,
        to: afterPlayer.poisonCounters,
      });
    }
    for (const counterType of numberRecordKeys(beforePlayer.playerCounters, afterPlayer.playerCounters)) {
      const oldCount = beforePlayer.playerCounters?.[counterType] || 0;
      const newCount = afterPlayer.playerCounters?.[counterType] || 0;
      if (oldCount !== newCount) {
        diffs.push({
          kind: 'PlayerCounterChanged',
          playerId: beforePlayer.id,
          counterType,
          from: oldCount,
          to: newCount,
        });
      }
    }
    if (beforePlayer.hasLost !== afterPlayer.hasLost) {
      diffs.push({
        kind: 'PlayerLostChanged',
        playerId: beforePlayer.id,
        from: beforePlayer.hasLost,
        to: afterPlayer.hasLost,
      });
    }
    if (beforePlayer.commanderTax !== afterPlayer.commanderTax) {
      diffs.push({
        kind: 'CommanderTaxChanged',
        playerId: beforePlayer.id,
        commanderId: beforePlayer.commanderInstanceId || afterPlayer.commanderInstanceId || undefined,
        from: beforePlayer.commanderTax,
        to: afterPlayer.commanderTax,
      });
    }
    if (beforePlayer.commanderCastCount !== afterPlayer.commanderCastCount) {
      diffs.push({
        kind: 'CommanderCastCountChanged',
        playerId: beforePlayer.id,
        commanderId: beforePlayer.commanderInstanceId || afterPlayer.commanderInstanceId || undefined,
        from: beforePlayer.commanderCastCount,
        to: afterPlayer.commanderCastCount,
      });
    }
    for (const commanderId of numberRecordKeys(beforePlayer.commanderDamage, afterPlayer.commanderDamage)) {
      const oldCount = beforePlayer.commanderDamage[commanderId] || 0;
      const newCount = afterPlayer.commanderDamage[commanderId] || 0;
      if (oldCount !== newCount) {
        diffs.push({
          kind: 'CommanderDamageChanged',
          playerId: beforePlayer.id,
          commanderId,
          from: oldCount,
          to: newCount,
        });
      }
    }
    for (const commanderId of numberRecordKeys(beforePlayer.commanderCastCounts, afterPlayer.commanderCastCounts)) {
      const oldCount = beforePlayer.commanderCastCounts?.[commanderId] || 0;
      const newCount = afterPlayer.commanderCastCounts?.[commanderId] || 0;
      if (oldCount !== newCount) {
        diffs.push({
          kind: 'CommanderCastCountChanged',
          playerId: beforePlayer.id,
          commanderId,
          from: oldCount,
          to: newCount,
        });
        diffs.push({
          kind: 'CommanderTaxChanged',
          playerId: beforePlayer.id,
          commanderId,
          from: Math.max(0, oldCount - 1) * 2,
          to: Math.max(0, newCount - 1) * 2,
        });
      }
    }
    diffs.push(...manaPoolDiffs(beforePlayer.manaPool, afterPlayer.manaPool, beforePlayer.id));
  }

  diffs.push(...diffCards(before, after));

  return diffs;
}

export function buildStateUpdate(
  before: GameState,
  after: GameState,
  requestInfo?: StateUpdateRequestInfo,
  actionEvents: ActionGameEvent[] = [],
): EngineStateUpdate {
  const rulesEvents: EngineEvent[] = [];
  if (requestInfo) {
    rulesEvents.push({
      kind: 'ActionAccepted',
      requestId: requestInfo.requestId,
      playerId: requestInfo.playerId,
      actionKind: requestInfo.actionKind,
      label: requestInfo.label,
    });
  }
  for (const event of actionEvents) {
    rulesEvents.push({ kind: 'RulesEvent', event });
  }

  return {
    oldStateId: stateFingerprint(before),
    newStateId: stateFingerprint(after),
    activePlayerId: activePlayerId(after),
    priorityPlayerId: priorityPlayerId(after),
    phase: after.phase,
    step: after.step,
    turnNumber: after.turnNumber,
    priority: prioritySnapshot(after),
    visibleDiffs: diffGameStates(before, after),
    rulesEvents,
    prompt: buildActionPrompt(after),
  };
}

export function applyClientActionRequest(
  state: GameState,
  request: ClientActionRequest,
): ClientActionResponse {
  const currentStateId = stateFingerprint(state);
  if (request.expectedStateId && request.expectedStateId !== currentStateId) {
    return {
      requestId: request.id,
      ok: false,
      reason: 'stale_state',
      message: 'The game state changed before this action reached the engine.',
      update: {
        oldStateId: request.expectedStateId,
        newStateId: currentStateId,
        activePlayerId: activePlayerId(state),
        priorityPlayerId: priorityPlayerId(state),
        phase: state.phase,
        step: state.step,
        turnNumber: state.turnNumber,
        priority: prioritySnapshot(state),
        visibleDiffs: [],
        rulesEvents: [{
          kind: 'ActionRejected',
          requestId: request.id,
          playerId: request.playerId,
          actionKind: request.action.kind,
          reason: 'stale_state',
          message: 'The game state changed before this action reached the engine.',
        }],
        prompt: buildActionPrompt(state),
      },
    };
  }

  const currentPrompt = buildActionPrompt(state, request.playerId);
  if (
    request.expectedPromptId
    && (!currentPrompt || currentPrompt.id !== request.expectedPromptId)
  ) {
    const message = 'The available-action prompt changed before this action reached the engine.';
    return {
      requestId: request.id,
      ok: false,
      reason: 'stale_state',
      message,
      update: {
        oldStateId: request.expectedStateId || currentStateId,
        newStateId: currentStateId,
        activePlayerId: activePlayerId(state),
        priorityPlayerId: priorityPlayerId(state),
        phase: state.phase,
        step: state.step,
        turnNumber: state.turnNumber,
        priority: prioritySnapshot(state),
        visibleDiffs: [],
        rulesEvents: [{
          kind: 'ActionRejected',
          requestId: request.id,
          playerId: request.playerId,
          actionKind: request.action.kind,
          reason: 'stale_state',
          message,
        }],
        prompt: currentPrompt || buildActionPrompt(state),
      },
    };
  }

  if (!isLegalRequestedAction(state, request.playerId, request.action)) {
    const message = illegalActionMessage(state, request.playerId, request.action);
    return {
      requestId: request.id,
      ok: false,
      reason: 'illegal_action',
      message,
      update: {
        oldStateId: currentStateId,
        newStateId: currentStateId,
        activePlayerId: activePlayerId(state),
        priorityPlayerId: priorityPlayerId(state),
        phase: state.phase,
        step: state.step,
        turnNumber: state.turnNumber,
        priority: prioritySnapshot(state),
        visibleDiffs: [],
        rulesEvents: [{
          kind: 'ActionRejected',
          requestId: request.id,
          playerId: request.playerId,
          actionKind: request.action.kind,
          reason: 'illegal_action',
          message,
        }],
        prompt: buildActionPrompt(state),
      },
    };
  }

  if (
    request.actionId
    && !isValidatedOutOfBandAction(request.action)
    && (!currentPrompt || !currentPrompt.legalChoices.some(choice => choice.id === request.actionId))
  ) {
    const message = 'That action was not offered by the current engine prompt.';
    return {
      requestId: request.id,
      ok: false,
      reason: 'illegal_action',
      message,
      update: {
        oldStateId: currentStateId,
        newStateId: currentStateId,
        activePlayerId: activePlayerId(state),
        priorityPlayerId: priorityPlayerId(state),
        phase: state.phase,
        step: state.step,
        turnNumber: state.turnNumber,
        priority: prioritySnapshot(state),
        visibleDiffs: [],
        rulesEvents: [{
          kind: 'ActionRejected',
          requestId: request.id,
          playerId: request.playerId,
          actionKind: request.action.kind,
          reason: 'illegal_action',
          message,
        }],
        prompt: currentPrompt || buildActionPrompt(state),
      },
    };
  }

  const result = dispatchAIAction(state, request.playerId, request.action);
  if (!result.ok) {
    return {
      requestId: request.id,
      ok: false,
      reason: result.reason,
      message: result.message,
      update: {
        oldStateId: currentStateId,
        newStateId: currentStateId,
        activePlayerId: activePlayerId(state),
        priorityPlayerId: priorityPlayerId(state),
        phase: state.phase,
        step: state.step,
        turnNumber: state.turnNumber,
        priority: prioritySnapshot(state),
        visibleDiffs: [],
        rulesEvents: [{
          kind: 'ActionRejected',
          requestId: request.id,
          playerId: request.playerId,
          actionKind: request.action.kind,
          reason: result.reason,
          message: result.message,
        }],
        prompt: buildActionPrompt(state),
      },
    };
  }

  const invariantReport = validateStateInvariants(result.state);
  if (!invariantReport.ok) {
    const message = `Engine invariant failed: ${invariantReport.violations[0]?.message || 'invalid state'}`;
    return {
      requestId: request.id,
      ok: false,
      reason: 'invariant_violation',
      message,
      update: {
        oldStateId: currentStateId,
        newStateId: currentStateId,
        activePlayerId: activePlayerId(state),
        priorityPlayerId: priorityPlayerId(state),
        phase: state.phase,
        step: state.step,
        turnNumber: state.turnNumber,
        priority: prioritySnapshot(state),
        visibleDiffs: [],
        rulesEvents: [{
          kind: 'ActionRejected',
          requestId: request.id,
          playerId: request.playerId,
          actionKind: request.action.kind,
          reason: 'invariant_violation',
          message,
        }],
        prompt: buildActionPrompt(state),
      },
    };
  }

  return {
    requestId: request.id,
    ok: true,
    state: result.state,
    events: result.events,
    update: buildStateUpdate(
      state,
      result.state,
      {
        requestId: request.id,
        playerId: request.playerId,
        actionKind: request.action.kind,
        label: request.label,
      },
      result.events,
    ),
  };
}

export function auditActionReplay(
  initialState: GameState,
  requests: ClientActionRequest[],
): ActionReplayAuditReport {
  let state = initialState;
  const steps: ActionReplayAuditStep[] = [];

  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    const stateBeforeId = stateFingerprint(state);
    const response = applyClientActionRequest(state, request);
    const step: ActionReplayAuditStep = {
      index,
      requestId: request.id,
      playerId: request.playerId,
      actionKind: request.action.kind,
      stateBeforeId,
      ok: response.ok,
      reason: response.reason,
      message: response.message,
      stateAfterId: response.update?.newStateId,
    };
    steps.push(step);

    if (!response.ok || !response.state) {
      return {
        ok: false,
        steps,
      };
    }

    const invariantReport = validateStateInvariants(response.state);
    if (!invariantReport.ok) {
      steps[steps.length - 1] = {
        ...step,
        ok: false,
        reason: 'invariant_violation',
        message: invariantReport.violations[0]?.message || 'invalid state',
      };
      return {
        ok: false,
        steps,
      };
    }

    state = response.state;
  }

  return {
    ok: true,
    finalState: state,
    steps,
  };
}

export function auditSearchPromptReplay(
  initialState: GameState,
  records: SearchPromptReplayRecord[],
): PromptReplayAuditReport {
  return auditPromptReplay(initialState, records);
}

export function auditPromptReplay(
  initialState: GameState,
  records: PromptReplayRecord[],
): PromptReplayAuditReport {
  let state = initialState;
  const steps: PromptReplayAuditStep[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const { request, response } = records[index];
    const stateBeforeId = stateFingerprint(state);
    const result = request.kind === 'SearchLibrary'
      ? applySearchLibraryPromptResponse(state, request, response as SearchLibraryPromptResponse)
      : request.kind === 'SelectTarget'
        ? applySelectTargetPromptResponse(state, request, response as SelectTargetPromptResponse)
      : request.kind === 'ChooseReplacement'
        ? applyChooseReplacementPromptResponse(state, request, response as ChooseReplacementPromptResponse)
        : request.kind === 'PayCosts'
          ? applyPayCostsPromptResponse(state, request, response as PayCostsPromptResponse)
          : request.kind === 'SelectCards'
            ? applySelectCardsPromptResponse(state, request, response as SelectCardsPromptResponse)
              : request.kind === 'LibraryManipulation'
                ? applyLibraryManipulationPromptResponse(state, request, response as LibraryManipulationPromptResponse)
                : request.kind === 'OptionalTrigger'
                  ? applyOptionalTriggerPromptResponse(state, request, response as OptionalTriggerPromptResponse)
                  : request.kind === 'OrderTriggers'
                    ? applyOrderTriggersPromptResponse(state, request, response as OrderTriggersPromptResponse)
                    : request.kind === 'DamageAssignment'
                      ? applyDamageAssignmentPromptResponse(state, request, response as DamageAssignmentPromptResponse)
                      : applyChooseModePromptResponse(state, request, response as ChooseModePromptResponse);
    const step: PromptReplayAuditStep = {
      index,
      requestId: request.id,
      playerId: request.playerId,
      promptKind: request.kind,
      stateBeforeId,
      stateAfterId: result.update?.newStateId,
      ok: result.ok,
      reason: result.reason,
      message: result.message,
    };
    steps.push(step);

    if (!result.ok || !result.state) {
      return { ok: false, steps };
    }

    const invariantReport = validateStateInvariants(result.state);
    if (!invariantReport.ok) {
      steps[steps.length - 1] = {
        ...step,
        ok: false,
        reason: 'invariant_violation',
        message: invariantReport.violations[0]?.message || 'invalid state',
      };
      return { ok: false, steps };
    }

    state = result.state;
  }

  return {
    ok: true,
    finalState: state,
    steps,
  };
}

export function auditEngineReplay(
  initialState: GameState,
  records: EngineReplayRecord[],
): EngineReplayAuditReport {
  let state = initialState;
  const steps: EngineReplayAuditStep[] = [];

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const stateBeforeId = stateFingerprint(state);
    const result = record.kind === 'Action'
      ? applyClientActionRequest(state, record.request)
      : record.request.kind === 'SearchLibrary'
        ? applySearchLibraryPromptResponse(state, record.request, record.response as SearchLibraryPromptResponse)
        : record.request.kind === 'SelectTarget'
          ? applySelectTargetPromptResponse(state, record.request, record.response as SelectTargetPromptResponse)
          : record.request.kind === 'ChooseReplacement'
            ? applyChooseReplacementPromptResponse(state, record.request, record.response as ChooseReplacementPromptResponse)
            : record.request.kind === 'PayCosts'
              ? applyPayCostsPromptResponse(state, record.request, record.response as PayCostsPromptResponse)
              : record.request.kind === 'SelectCards'
                ? applySelectCardsPromptResponse(state, record.request, record.response as SelectCardsPromptResponse)
                : record.request.kind === 'LibraryManipulation'
                  ? applyLibraryManipulationPromptResponse(state, record.request, record.response as LibraryManipulationPromptResponse)
                  : record.request.kind === 'OptionalTrigger'
                    ? applyOptionalTriggerPromptResponse(state, record.request, record.response as OptionalTriggerPromptResponse)
                    : record.request.kind === 'OrderTriggers'
                      ? applyOrderTriggersPromptResponse(state, record.request, record.response as OrderTriggersPromptResponse)
                      : record.request.kind === 'DamageAssignment'
                        ? applyDamageAssignmentPromptResponse(state, record.request, record.response as DamageAssignmentPromptResponse)
                        : applyChooseModePromptResponse(state, record.request, record.response as ChooseModePromptResponse);

    const step: EngineReplayAuditStep = {
      index,
      kind: record.kind,
      requestId: record.kind === 'Action' ? record.request.id : record.request.id,
      playerId: record.kind === 'Action' ? record.request.playerId : record.request.playerId,
      stateBeforeId,
      stateAfterId: result.update?.newStateId,
      ok: result.ok,
      actionKind: record.kind === 'Action' ? record.request.action.kind : undefined,
      promptKind: record.kind === 'Prompt' ? record.request.kind : undefined,
      reason: result.reason,
      message: result.message,
    };
    steps.push(step);

    if (!result.ok || !result.state) {
      return { ok: false, steps };
    }

    const invariantReport = validateStateInvariants(result.state);
    if (!invariantReport.ok) {
      steps[steps.length - 1] = {
        ...step,
        ok: false,
        reason: 'invariant_violation',
        message: invariantReport.violations[0]?.message || 'invalid state',
      };
      return { ok: false, steps };
    }

    state = result.state;
  }

  return {
    ok: true,
    finalState: state,
    steps,
  };
}
