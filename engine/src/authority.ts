import type {
  CardInstance,
  GameState,
  ManaColor,
  ManaPool,
  Phase,
  StackItem,
  Step,
  Zone,
} from './types';
import { getLegalActions } from './ai/legal-actions';
import { dispatchAIAction } from './ai/agent';
import type { AIAction } from './ai/types';
import type { ActionFailure, GameEvent as ActionGameEvent } from './actions-public';

export type ClientActionSource = 'ui' | 'ai' | 'system';

export interface ClientActionRequest {
  id: string;
  playerId: string;
  action: AIAction;
  source: ClientActionSource;
  label?: string;
  expectedStateId?: string;
  createdAt: number;
}

export type ClientActionFailure = ActionFailure | 'illegal_action' | 'stale_state';

export interface ClientActionResponse {
  requestId: string;
  ok: boolean;
  reason?: ClientActionFailure;
  message?: string;
  state?: GameState;
  events?: ActionGameEvent[];
  update?: EngineStateUpdate;
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
  expectedStateId?: string;
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
  return state.cardDefinitions.get(card.definitionId)?.name;
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
  const requestedKey = actionKey(action);
  return getLegalActions(state, playerId).some(legal =>
    actionKey(legal) === requestedKey || actionReferencesSameObject(legal, action),
  );
}

export function labelForAction(state: GameState, action: AIAction): string {
  switch (action.kind) {
    case 'PlayLand':
      return `Play ${cardName(state, state.cards.get(action.cardInstanceId)) || 'land'}`;
    case 'CastSpell':
      return `Cast ${cardName(state, state.cards.get(action.cardInstanceId)) || 'spell'}${targetSuffix(state, action.targets)}`;
    case 'ActivateManaAbility':
      return `Tap ${cardName(state, state.cards.get(action.cardInstanceId)) || 'source'} for ${action.color}`;
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
  CastSpell: 'Cast',
  PlayLand: 'Land',
  ActivateManaAbility: 'Mana',
  ActivateAbility: 'Ability',
  DeclareAttackers: 'Attack',
  DeclareBlockers: 'Block',
  Equip: 'Equip',
  PassPriority: 'Pass',
};

export function summarizeActionPromptChoices(
  choices: ActionPromptChoice[],
): ActionPromptChoiceSummary[] {
  const counts = new Map<AIAction['kind'], number>();
  for (const choice of choices) {
    counts.set(choice.kind, (counts.get(choice.kind) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: ACTION_KIND_LABELS[kind], count }))
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
  return {
    id: options.id || `req_${expectedStateId}_${hashText(`${playerId}:${actionKey(action)}:${createdAt}`)}`,
    playerId,
    action,
    source: options.source || 'ui',
    label: options.label || labelForAction(state, action),
    expectedStateId,
    createdAt,
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

  if (!isLegalRequestedAction(state, request.playerId, request.action)) {
    const message = 'That action is not legal in the current game state.';
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
