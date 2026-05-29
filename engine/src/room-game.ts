import type { CardDefinition, CardInstance, GameState, ManaColor, Player, Zone } from './types';
import { createPlayer } from './types';
import { getCardDefinition, getCardsInZone } from './game-state';
import type { CardLookup, GeneratedDeck } from './cards/deck-loader';
import { convertGeneratedDeck } from './cards/deck-loader';
import { getEffectivePower, getEffectiveToughness } from './effects/continuous';
import { instanceHasKeyword, type Keyword } from './keywords';
import { getLegalTargets, getSpellTargetSpecs } from './ai/legal-actions';
import { hasPlayerDeclaredBlockers } from './combat';
import type { TargetSpec } from './effects/targets';

export interface RoomGamePlayerConfig {
  id: string;
  name: string;
  deck: GeneratedDeck;
}

export interface RoomGameConfig {
  players: RoomGamePlayerConfig[];
  cardLookup: CardLookup;
  firstPlayerId?: string;
  startingLife?: number;
  startingHandSize?: number;
}

export interface PlayerScopedCard {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  zone: Zone;
  name: string;
  typeLine: string;
  oracleText: string;
  manaCost: string;
  cmc: number;
  colors: ManaColor[];
  colorIdentity: ManaColor[];
  cardTypes: string[];
  power?: number;
  toughness?: number;
  keywords: string[];
  tapped: boolean;
  summoningSick: boolean;
  counters: Record<string, number>;
  isCommander: boolean;
  castTargetSpecs?: TargetSpec[];
  legalTargetIds?: string[];
}

export interface PlayerScopedZone {
  count: number;
  cards?: PlayerScopedCard[];
}

export interface PlayerScopedPlayerView {
  id: string;
  name: string;
  life: number;
  poisonCounters: number;
  manaPool: Player['manaPool'];
  isActive: boolean;
  hasPriority: boolean;
  zones: {
    hand: PlayerScopedZone;
    library: PlayerScopedZone;
    battlefield: PlayerScopedZone;
    graveyard: PlayerScopedZone;
    exile: PlayerScopedZone;
    command: PlayerScopedZone;
  };
}

export interface PlayerScopedStackItemView {
  id: string;
  kind: string;
  label: string;
  controllerName: string;
  sourceName: string;
  targetNames: string[];
  order: number;
  resolvesNext: boolean;
  triggerKind?: string;
  why: string;
}

export interface PlayerScopedPendingTriggerGroup {
  key: string;
  sourceName: string;
  controllerName: string;
  triggerKind: string;
  count: number;
  why: string;
}

export interface PlayerScopedCombatCardView {
  id: string;
  name: string;
  controllerName: string;
  power: number;
  toughness: number;
  keywords: string[];
  damage: number;
}

export interface PlayerScopedCombatAssignmentView {
  attacker: PlayerScopedCombatCardView;
  defenderName: string;
  blockers: PlayerScopedCombatCardView[];
  unblocked: boolean;
  assignmentHint: string;
}

export interface PlayerScopedCombatView {
  step: GameState['step'];
  assignments: PlayerScopedCombatAssignmentView[];
}

export interface PlayerScopedLegalActionHint {
  action: string;
  enabled: boolean;
  reason: string;
}

export interface PlayerScopedComplexityView {
  stackCount: number;
  pendingTriggerCount: number;
  battlefieldCardCount: number;
  continuousEffectCount: number;
  largeBoardMode: boolean;
}

export interface PlayerScopedView {
  viewerId: string;
  turnNumber: number;
  phase: GameState['phase'];
  step: GameState['step'];
  activePlayerId: string;
  priorityPlayerId: string;
  stackSize: number;
  stack: PlayerScopedStackItemView[];
  pendingTriggerGroups: PlayerScopedPendingTriggerGroup[];
  combat: PlayerScopedCombatView | null;
  legalActions: PlayerScopedLegalActionHint[];
  teachingNotes: string[];
  complexity: PlayerScopedComplexityView;
  players: PlayerScopedPlayerView[];
}

let roomInstanceCounter = 0;

function nextRoomInstanceId(prefix: string): string {
  roomInstanceCounter += 1;
  return `${prefix}_${roomInstanceCounter}`;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function addCardInstance(
  state: GameState,
  ownerId: string,
  definition: CardDefinition,
  zone: Zone,
  isCommander: boolean,
): CardInstance {
  state.cardDefinitions.set(definition.id, definition);
  const instance: CardInstance = {
    instanceId: nextRoomInstanceId(isCommander ? 'room_cmd' : 'room_card'),
    definitionId: definition.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: 0,
    isCommander,
  };
  state.cards.set(instance.instanceId, instance);
  return instance;
}

function setupRoomPlayer(
  state: GameState,
  config: RoomGamePlayerConfig,
  cardLookup: CardLookup,
  startingLife: number,
  startingHandSize: number,
): Player {
  const deck = convertGeneratedDeck(config.deck, cardLookup);
  const player = createPlayer(config.id, config.name, startingLife);

  const commanders = deck.commanders?.length ? deck.commanders : deck.commander ? [deck.commander] : [];
  for (const commander of commanders) {
    const instance = addCardInstance(state, config.id, commander, 'command', true);
    player.commanderInstanceIds = [...(player.commanderInstanceIds || []), instance.instanceId];
    player.commanderCastCounts = {
      ...(player.commanderCastCounts || {}),
      [instance.instanceId]: 0,
    };
    if (!player.commanderInstanceId) {
      player.commanderInstanceId = instance.instanceId;
    }
  }

  const library = shuffle(deck.library);
  for (const definition of library) {
    addCardInstance(state, config.id, definition, 'library', false);
  }

  if (deck.sideboard.length > 0) {
    state.sideboards?.set(config.id, deck.sideboard);
    for (const definition of deck.sideboard) {
      state.cardDefinitions.set(definition.id, definition);
    }
  }

  for (const card of getCardsInZone(state, config.id, 'library').slice(0, startingHandSize)) {
    card.zone = 'hand';
  }

  return player;
}

export function initRoomGame(config: RoomGameConfig): GameState {
  if (config.players.length < 2 || config.players.length > 4) {
    throw new Error(`Room games require 2-4 players, got ${config.players.length}`);
  }

  roomInstanceCounter = 0;
  const startingLife = config.startingLife ?? 40;
  const startingHandSize = config.startingHandSize ?? 7;
  const state: GameState = {
    players: [],
    cards: new Map(),
    cardDefinitions: new Map(),
    sideboards: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  state.players = config.players.map(player =>
    setupRoomPlayer(state, player, config.cardLookup, startingLife, startingHandSize),
  );
  state.hasPriorityPassed = state.players.map(() => false);

  const firstIndex = config.firstPlayerId
    ? state.players.findIndex(player => player.id === config.firstPlayerId)
    : 0;
  state.activePlayerIndex = firstIndex >= 0 ? firstIndex : 0;
  state.priorityPlayerIndex = state.activePlayerIndex;
  state.players = state.players.map((player, index) => ({
    ...player,
    hasPriority: index === state.priorityPlayerIndex,
  }));

  return state;
}

function toScopedCard(state: GameState, instance: CardInstance): PlayerScopedCard {
  const definition = getCardDefinition(state, instance);
  const targetInfo = castTargetInfo(state, instance, definition);
  return {
    instanceId: instance.instanceId,
    definitionId: instance.definitionId,
    ownerId: instance.ownerId,
    zone: instance.zone,
    name: definition.name,
    typeLine: definition.type_line,
    oracleText: definition.oracle_text,
    manaCost: definition.mana_cost,
    cmc: definition.cmc,
    colors: definition.colors,
    colorIdentity: definition.color_identity,
    cardTypes: definition.card_types,
    power: definition.power,
    toughness: definition.toughness,
    keywords: [...(definition.keywords || []), ...(instance.grantedKeywords || [])],
    tapped: instance.tapped,
    summoningSick: instance.summoningSick,
    counters: { ...instance.counters },
    isCommander: instance.isCommander,
    ...targetInfo,
  };
}

function castTargetInfo(
  state: GameState,
  instance: CardInstance,
  definition: CardDefinition,
): Pick<PlayerScopedCard, 'castTargetSpecs' | 'legalTargetIds'> {
  if (!['hand', 'command'].includes(instance.zone)) return {};
  if (definition.card_types.includes('land')) return {};

  try {
    const specs = getSpellTargetSpecs(state, instance);
    if (specs.length === 0) return {};
    const legalTargetIds = Array.from(new Set(
      specs.flatMap(spec => getLegalTargets(state, instance.ownerId, spec)),
    ));
    return {
      castTargetSpecs: specs.map(spec => ({
        ...spec,
        constraints: spec.constraints ? { ...spec.constraints } : undefined,
      })),
      legalTargetIds,
    };
  } catch {
    return {};
  }
}

function visibleZone(state: GameState, playerId: string, zone: Zone, revealCards: boolean): PlayerScopedZone {
  const cards = getCardsInZone(state, playerId, zone);
  return {
    count: cards.length,
    cards: revealCards ? cards.map(card => toScopedCard(state, card)) : undefined,
  };
}

function getPlayerName(state: GameState, playerId?: string): string {
  if (!playerId) return 'Unknown player';
  return state.players.find(player => player.id === playerId)?.name || 'Unknown player';
}

function getCardName(state: GameState, instanceId?: string): string {
  if (!instanceId) return 'Unknown source';
  const instance = state.cards.get(instanceId);
  if (!instance) return 'Unknown source';
  return getCardDefinition(state, instance).name;
}

function targetNames(state: GameState, targets: string[] = []): string[] {
  return targets.map(targetId => {
    const player = state.players.find(item => item.id === targetId);
    if (player) return player.name;
    return getCardName(state, targetId);
  });
}

function triggerWhy(state: GameState, triggerKind: string, sourceName: string, context?: { casterId?: string; cardInstanceId?: string }): string {
  const castSource = context?.cardInstanceId ? getCardName(state, context.cardInstanceId) : '';
  const casterName = context?.casterId ? getPlayerName(state, context.casterId) : '';
  switch (triggerKind) {
    case 'ETB':
      return `${sourceName} triggered because a matching permanent entered the battlefield.`;
    case 'Landfall':
      return `${sourceName} triggered because a land entered under its controller's control.`;
    case 'OpponentCastSpell':
      return `${sourceName} triggered because an opponent cast a spell${casterName ? ` (${casterName})` : ''}.`;
    case 'YouCastSpell':
    case 'CastNoncreatureSpell':
    case 'CastInstantOrSorcery':
    case 'CastOrCopyInstantOrSorcery':
      return `${sourceName} triggered from a spell being cast or copied${castSource ? `: ${castSource}` : ''}.`;
    case 'Attacks':
    case 'CreatureYouControlAttacks':
      return `${sourceName} triggered during attacker declaration.`;
    case 'BeginningCombat':
      return `${sourceName} triggered at the beginning of combat.`;
    case 'EndStep':
      return `${sourceName} triggered at the beginning of the end step.`;
    case 'CombatDamageToPlayer':
      return `${sourceName} triggered because combat damage was dealt to a player.`;
    default:
      return `${sourceName} triggered from ${triggerKind}.`;
  }
}

function describeStackItem(state: GameState, item: GameState['stack'][number], index: number): PlayerScopedStackItemView {
  const order = state.stack.length - index;
  if (item.kind === 'Spell') {
    const label = getCardName(state, item.cardInstanceId);
    return {
      id: item.id,
      kind: 'Spell',
      label,
      controllerName: getPlayerName(state, item.casterId),
      sourceName: label,
      targetNames: targetNames(state, item.targets),
      order,
      resolvesNext: index === state.stack.length - 1,
      why: item.isCopy
        ? `${label} is a copied spell. Stack items resolve from top to bottom.`
        : `${label} was cast and is waiting for all players to pass priority.`,
    };
  }

  if (item.kind === 'TriggeredAbility') {
    const sourceName = getCardName(state, item.sourceInstanceId);
    const triggerKind = item.ability.trigger.kind;
    return {
      id: item.id,
      kind: 'Triggered Ability',
      label: `${sourceName} trigger`,
      controllerName: getPlayerName(state, item.controllerId),
      sourceName,
      targetNames: targetNames(state, item.targets),
      order,
      resolvesNext: index === state.stack.length - 1,
      triggerKind,
      why: triggerWhy(state, triggerKind, sourceName, item.eventContext),
    };
  }

  const sourceName = getCardName(state, item.sourceInstanceId);
  return {
    id: item.id,
    kind: 'Activated Ability',
    label: `${sourceName} ability`,
    controllerName: getPlayerName(state, item.controllerId),
    sourceName,
    targetNames: targetNames(state, item.targets),
    order,
    resolvesNext: index === state.stack.length - 1,
    why: `${sourceName}'s activated ability is on the stack. Players may respond before it resolves.`,
  };
}

function pendingTriggerGroups(state: GameState): PlayerScopedPendingTriggerGroup[] {
  const groups = new Map<string, PlayerScopedPendingTriggerGroup>();
  for (const trigger of state.pendingTriggers || []) {
    const sourceName = getCardName(state, trigger.sourceInstanceId);
    const triggerKind = trigger.ability.trigger.kind;
    const key = `${trigger.controllerId}:${trigger.sourceInstanceId}:${triggerKind}`;
    const current = groups.get(key);
    if (current) {
      current.count += 1;
      continue;
    }
    groups.set(key, {
      key,
      sourceName,
      controllerName: getPlayerName(state, trigger.controllerId),
      triggerKind,
      count: 1,
      why: triggerWhy(state, triggerKind, sourceName, trigger.eventContext),
    });
  }
  return [...groups.values()];
}

const COMBAT_KEYWORDS: Keyword[] = ['Flying', 'Reach', 'Trample', 'Deathtouch', 'First Strike', 'Double Strike', 'Lifelink', 'Menace', 'Vigilance'];

function combatCardView(state: GameState, instanceId: string): PlayerScopedCombatCardView {
  const instance = state.cards.get(instanceId);
  const source = instance ? getCardDefinition(state, instance) : undefined;
  return {
    id: instanceId,
    name: source?.name || 'Unknown creature',
    controllerName: instance ? getPlayerName(state, instance.ownerId) : 'Unknown player',
    power: instance ? getEffectivePower(state, instanceId) : 0,
    toughness: instance ? getEffectiveToughness(state, instanceId) : 0,
    keywords: COMBAT_KEYWORDS.filter(keyword => instanceHasKeyword(state, instanceId, keyword)),
    damage: instance?.damage || 0,
  };
}

function combatAssignmentHint(attacker: PlayerScopedCombatCardView, blockers: PlayerScopedCombatCardView[]): string {
  if (blockers.length === 0) {
    return `${attacker.name} is unblocked and will assign ${attacker.power} damage to the defending player.`;
  }
  const hasTrample = attacker.keywords.includes('Trample');
  const hasDeathtouch = attacker.keywords.includes('Deathtouch');
  if (hasTrample && hasDeathtouch) {
    return `${attacker.name} has trample and deathtouch, so 1 damage can be lethal to each blocker before excess tramples over.`;
  }
  if (hasTrample) {
    return `${attacker.name} has trample. The engine assigns lethal damage to blockers first, then excess to the defender.`;
  }
  return `${attacker.name} is blocked. Current engine assignment sends combat damage to blockers before player damage.`;
}

function combatView(state: GameState): PlayerScopedCombatView | null {
  if (!state.combat) return null;
  return {
    step: state.step,
    assignments: state.combat.attackers.map(attack => {
      const attacker = combatCardView(state, attack.cardInstanceId);
      const blockers = state.combat!.blockers
        .filter(block => block.blockingAttackerId === attack.cardInstanceId)
        .map(block => combatCardView(state, block.cardInstanceId));
      return {
        attacker,
        defenderName: getPlayerName(state, attack.defendingPlayerId),
        blockers,
        unblocked: blockers.length === 0,
        assignmentHint: combatAssignmentHint(attacker, blockers),
      };
    }),
  };
}

function hasVisibleCard(player: PlayerScopedPlayerView, zoneName: keyof PlayerScopedPlayerView['zones'], predicate: (card: PlayerScopedCard) => boolean): boolean {
  return Boolean(player.zones[zoneName].cards?.some(predicate));
}

function canUseVisibleManaSource(card: PlayerScopedCard): boolean {
  if (card.tapped) return false;
  if (card.cardTypes.includes('land')) return true;
  if (!/\badd\b/i.test(card.oracleText || '')) return false;
  if (card.cardTypes.includes('creature') && card.summoningSick && !card.keywords.includes('Haste')) return false;
  return true;
}

function legalActionHints(state: GameState, viewerId: string, scopedPlayers: PlayerScopedPlayerView[]): PlayerScopedLegalActionHint[] {
  const viewer = scopedPlayers.find(player => player.id === viewerId);
  const hasPriority = state.players[state.priorityPlayerIndex]?.id === viewerId;
  const isActive = state.players[state.activePlayerIndex]?.id === viewerId;
  const isMain = state.phase === 'precombat_main' || state.phase === 'postcombat_main';
  const stackEmpty = state.stack.length === 0;
  const hasLand = viewer ? hasVisibleCard(viewer, 'hand', card => card.cardTypes.includes('land')) : false;
  const hasSpell = viewer ? hasVisibleCard(viewer, 'hand', card => !card.cardTypes.includes('land')) : false;
  const hasCommander = viewer ? Boolean(viewer.zones.command.cards?.length) : false;
  const hasManaSource = viewer ? hasVisibleCard(viewer, 'battlefield', canUseVisibleManaSource) : false;
  const canAttack = isActive && state.step === 'declare_attackers' && hasPriority && !state.combat;
  const incomingAttackers = state.combat?.attackers.filter(attack => attack.defendingPlayerId === viewerId).length ?? 0;
  const canBlock = state.step === 'declare_blockers'
    && hasPriority
    && Boolean(state.combat)
    && incomingAttackers > 0
    && !hasPlayerDeclaredBlockers(state, viewerId);
  const mustDeclareAttackers = canAttack;
  const canPassPriority = hasPriority && !mustDeclareAttackers;

  return [
    {
      action: 'Pass Priority',
      enabled: canPassPriority,
      reason: !hasPriority
        ? `Waiting for ${getPlayerName(state, state.players[state.priorityPlayerIndex]?.id)} to act.`
        : mustDeclareAttackers
          ? 'Declare attackers first. You may declare no attackers.'
          : 'You have priority now.',
    },
    {
      action: 'Play Land',
      enabled: hasPriority && isActive && isMain && stackEmpty && hasLand,
      reason: !hasPriority ? 'You need priority.' : !isActive ? 'Only the active player can play lands.' : !isMain ? 'Lands use main-phase timing.' : !stackEmpty ? 'The stack must be empty.' : !hasLand ? 'No visible land in hand.' : 'Main phase, empty stack, land available.',
    },
    {
      action: 'Tap Mana',
      enabled: hasPriority && hasManaSource,
      reason: !hasPriority ? 'You need priority.' : !hasManaSource ? 'No visible mana source on board.' : 'A visible mana source is available.',
    },
    {
      action: 'Cast From Hand',
      enabled: hasPriority && hasSpell,
      reason: !hasPriority ? 'You need priority.' : !hasSpell ? 'No visible nonland card in hand.' : 'The current engine can submit the first visible spell.',
    },
    {
      action: 'Cast Commander',
      enabled: hasPriority && hasCommander,
      reason: !hasPriority ? 'You need priority.' : !hasCommander ? 'No commander visible in command zone.' : 'Commander is visible and can be submitted to the authority.',
    },
    {
      action: 'Declare Attackers',
      enabled: canAttack,
      reason: canAttack
        ? 'Declare attackers step and you have priority.'
        : state.combat
          ? 'Attackers have already been declared for this combat.'
          : 'Available only on your declare attackers step.',
    },
    {
      action: 'Declare Blockers',
      enabled: canBlock,
      reason: canBlock
        ? 'Declare blockers step and you have priority.'
        : hasPlayerDeclaredBlockers(state, viewerId)
          ? 'You have already declared blockers for this combat.'
          : incomingAttackers === 0 && state.step === 'declare_blockers'
            ? 'No creatures are attacking you.'
          : 'Available only when you are the defending priority player.',
    },
  ];
}

function teachingNotes(state: GameState): string[] {
  const notes: string[] = [];
  if (state.stack.length > 0) {
    notes.push('Stack: the top item resolves first after every player passes priority.');
  }
  if (state.pendingTriggers.length > 0) {
    notes.push('Triggers: pending triggers are grouped by source before they are placed on the stack.');
  }
  if (state.combat) {
    notes.push('Combat: attackers are tied to one defender; blockers and keyword notes show how damage will be assigned.');
  }
  if ((state.continuousEffects || []).length > 0) {
    notes.push('Layers: continuous effects are included in shown power/toughness and creature status.');
  }
  if (state.phase === 'precombat_main' || state.phase === 'postcombat_main') {
    notes.push('Timing: sorcery-speed actions need your main phase, priority, and an empty stack.');
  }
  return notes;
}

export function getPlayerView(state: GameState, viewerId: string): PlayerScopedView {
  if (!state.players.some(player => player.id === viewerId)) {
    throw new Error(`Viewer is not in game: ${viewerId}`);
  }
  const active = state.players[state.activePlayerIndex];
  const priority = state.players[state.priorityPlayerIndex];
  const scopedPlayers = state.players.map((player, index) => {
    const isViewer = player.id === viewerId;
    return {
      id: player.id,
      name: player.name,
      life: player.life,
      poisonCounters: player.poisonCounters,
      manaPool: { ...player.manaPool },
      isActive: index === state.activePlayerIndex,
      hasPriority: index === state.priorityPlayerIndex,
      zones: {
        hand: visibleZone(state, player.id, 'hand', isViewer),
        library: visibleZone(state, player.id, 'library', false),
        battlefield: visibleZone(state, player.id, 'battlefield', true),
        graveyard: visibleZone(state, player.id, 'graveyard', true),
        exile: visibleZone(state, player.id, 'exile', true),
        command: visibleZone(state, player.id, 'command', true),
      },
    };
  });
  const battlefieldCardCount = scopedPlayers.reduce((total, player) => total + player.zones.battlefield.count, 0);
  return {
    viewerId,
    turnNumber: state.turnNumber,
    phase: state.phase,
    step: state.step,
    activePlayerId: active.id,
    priorityPlayerId: priority.id,
    stackSize: state.stack.length,
    stack: state.stack.map((item, index) => describeStackItem(state, item, index)).reverse(),
    pendingTriggerGroups: pendingTriggerGroups(state),
    combat: combatView(state),
    legalActions: legalActionHints(state, viewerId, scopedPlayers),
    teachingNotes: teachingNotes(state),
    complexity: {
      stackCount: state.stack.length,
      pendingTriggerCount: state.pendingTriggers.length,
      battlefieldCardCount,
      continuousEffectCount: state.continuousEffects?.length || 0,
      largeBoardMode: battlefieldCardCount >= 24 || state.stack.length >= 8 || state.pendingTriggers.length >= 8,
    },
    players: scopedPlayers,
  };
}
