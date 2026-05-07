/**
 * GameState Serialization
 *
 * Convert GameState to/from JSON-serializable format.
 */

import { GameState, CardInstance, CardDefinition, Player, StackItem, TriggeredAbilityStackItem, CombatState } from '../types';
import { hasGrudgeTracking, GameStateWithGrudges } from '../ai/grudges';
import type {
  SerializedGameStateV1,
  SerializedPlayerV1,
  SerializedCardInstanceV1,
  SerializedCardDefinitionV1,
  SerializedStackItemV1,
  SerializedCombatStateV1,
  SerializedDamageRecordV1,
  SaveGameV1,
  SaveMetadata,
} from './schema';
import { SAVE_VERSION, generateSaveId, createSaveMetadata } from './schema';

/**
 * Serialize a Player to JSON-safe format.
 */
function serializePlayer(player: Player, isAI: boolean = false): SerializedPlayerV1 {
  return {
    id: player.id,
    name: player.name,
    life: player.life,
    poisonCounters: player.poisonCounters,
    commanderDamage: { ...player.commanderDamage },
    commanderTax: player.commanderTax,
    commanderInstanceId: player.commanderInstanceId,
    commanderCastCount: player.commanderCastCount,
    manaPool: { ...player.manaPool },
    hasPlayedLand: player.hasPlayedLand,
    hasPriority: player.hasPriority,
    hasLost: player.hasLost,
    isAI,
  };
}

/**
 * Deserialize a Player from JSON.
 */
function deserializePlayer(data: SerializedPlayerV1): Player {
  return {
    id: data.id,
    name: data.name,
    life: data.life,
    poisonCounters: data.poisonCounters ?? 0,
    commanderDamage: { ...data.commanderDamage },
    commanderTax: data.commanderTax,
    commanderInstanceId: data.commanderInstanceId,
    commanderCastCount: data.commanderCastCount,
    manaPool: { ...data.manaPool },
    hasPlayedLand: data.hasPlayedLand,
    hasPriority: data.hasPriority,
    hasLost: data.hasLost,
  };
}

/**
 * Serialize a CardInstance.
 */
function serializeCardInstance(card: CardInstance): SerializedCardInstanceV1 {
  return {
    instanceId: card.instanceId,
    definitionId: card.definitionId,
    ownerId: card.ownerId,
    zone: card.zone,
    tapped: card.tapped,
    summoningSick: card.summoningSick,
    counters: { ...card.counters },
    attachedTo: card.attachedTo,
    damage: card.damage,
    isCommander: card.isCommander,
    fromSideboard: card.fromSideboard,
  };
}

/**
 * Deserialize a CardInstance.
 */
function deserializeCardInstance(data: SerializedCardInstanceV1): CardInstance {
  return {
    instanceId: data.instanceId,
    definitionId: data.definitionId,
    ownerId: data.ownerId,
    zone: data.zone as CardInstance['zone'],
    tapped: data.tapped,
    summoningSick: data.summoningSick,
    counters: { ...data.counters },
    attachedTo: data.attachedTo,
    damage: data.damage,
    isCommander: data.isCommander,
    fromSideboard: data.fromSideboard,
  };
}

/**
 * Serialize a CardDefinition.
 */
function serializeCardDefinition(def: CardDefinition): SerializedCardDefinitionV1 {
  return {
    id: def.id,
    name: def.name,
    type_line: def.type_line,
    oracle_text: def.oracle_text,
    mana_cost: def.mana_cost,
    cmc: def.cmc,
    colors: [...def.colors],
    color_identity: [...def.color_identity],
    keywords: [...def.keywords],
    power: def.power,
    toughness: def.toughness,
    card_types: [...def.card_types],
  };
}

/**
 * Deserialize a CardDefinition.
 */
function deserializeCardDefinition(data: SerializedCardDefinitionV1): CardDefinition {
  return {
    id: data.id,
    name: data.name,
    type_line: data.type_line,
    oracle_text: data.oracle_text,
    mana_cost: data.mana_cost,
    cmc: data.cmc,
    colors: data.colors as CardDefinition['colors'],
    color_identity: data.color_identity as CardDefinition['color_identity'],
    keywords: [...data.keywords],
    power: data.power,
    toughness: data.toughness,
    card_types: data.card_types as CardDefinition['card_types'],
  };
}

/**
 * Serialize a StackItem.
 */
function serializeStackItem(item: StackItem): SerializedStackItemV1 {
  if (item.kind === 'Spell') {
    return {
      kind: 'Spell',
      id: item.id,
      cardInstanceId: item.cardInstanceId,
      casterId: item.casterId,
      targets: [...item.targets],
    };
  } else {
    return {
      kind: 'TriggeredAbility',
      id: item.id,
      sourceInstanceId: item.sourceInstanceId,
      controllerId: item.controllerId,
      targets: [...item.targets],
      ability: item.ability,
    };
  }
}

/**
 * Deserialize a StackItem.
 */
function deserializeStackItem(data: SerializedStackItemV1): StackItem {
  if (data.kind === 'Spell') {
    return {
      kind: 'Spell',
      id: data.id,
      cardInstanceId: data.cardInstanceId!,
      casterId: data.casterId!,
      targets: [...data.targets],
    };
  } else {
    return {
      kind: 'TriggeredAbility',
      id: data.id,
      sourceInstanceId: data.sourceInstanceId!,
      controllerId: data.controllerId!,
      targets: [...data.targets],
      ability: data.ability as TriggeredAbilityStackItem['ability'],
    };
  }
}

/**
 * Serialize CombatState.
 */
function serializeCombatState(combat: CombatState): SerializedCombatStateV1 {
  return {
    attackers: combat.attackers.map(a => ({
      cardInstanceId: a.cardInstanceId,
      defendingPlayerId: a.defendingPlayerId,
    })),
    blockers: combat.blockers.map(b => ({
      cardInstanceId: b.cardInstanceId,
      blockingAttackerId: b.blockingAttackerId,
    })),
    damageAssignment: Array.from(combat.damageAssignment.entries()),
  };
}

/**
 * Deserialize CombatState.
 */
function deserializeCombatState(data: SerializedCombatStateV1): CombatState {
  return {
    attackers: data.attackers.map(a => ({
      cardInstanceId: a.cardInstanceId,
      defendingPlayerId: a.defendingPlayerId,
    })),
    blockers: data.blockers.map(b => ({
      cardInstanceId: b.cardInstanceId,
      blockingAttackerId: b.blockingAttackerId,
    })),
    damageAssignment: new Map(data.damageAssignment),
  };
}

/**
 * Serialize a GameState to JSON-safe format.
 */
export function serializeGameState(state: GameState): SerializedGameStateV1 {
  const serialized: SerializedGameStateV1 = {
    players: state.players.map(p => serializePlayer(p)),
    cards: Array.from(state.cards.entries()).map(([k, v]) => [k, serializeCardInstance(v)]),
    cardDefinitions: Array.from(state.cardDefinitions.entries()).map(([k, v]) => [k, serializeCardDefinition(v)]),
    activePlayerIndex: state.activePlayerIndex,
    priorityPlayerIndex: state.priorityPlayerIndex,
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    hasPriorityPassed: [...state.hasPriorityPassed],
    stack: state.stack.map(serializeStackItem),
    combat: state.combat ? serializeCombatState(state.combat) : null,
    battlefieldAbilities: Array.from(state.battlefieldAbilities.entries()),
    pendingTriggers: [...state.pendingTriggers],
    sideboards: state.sideboards
      ? Array.from(state.sideboards.entries()).map(([playerId, defs]) => [
          playerId,
          defs.map(serializeCardDefinition),
        ])
      : undefined,
  };

  // Include grudge data if present
  if (hasGrudgeTracking(state)) {
    serialized.damageHistory = (state as GameStateWithGrudges).damageHistory.map(r => ({
      sourcePlayerId: r.sourcePlayerId,
      targetPlayerId: r.targetPlayerId,
      amount: r.amount,
      turnNumber: r.turnNumber,
    }));
  }

  return serialized;
}

/**
 * Deserialize a GameState from JSON.
 */
export function deserializeGameState(data: SerializedGameStateV1): GameState {
  const state: GameState = {
    players: data.players.map(deserializePlayer),
    cards: new Map(data.cards.map(([k, v]) => [k, deserializeCardInstance(v)])),
    cardDefinitions: new Map(data.cardDefinitions.map(([k, v]) => [k, deserializeCardDefinition(v)])),
    activePlayerIndex: data.activePlayerIndex,
    priorityPlayerIndex: data.priorityPlayerIndex,
    phase: data.phase as GameState['phase'],
    step: data.step as GameState['step'],
    turnNumber: data.turnNumber,
    hasPriorityPassed: [...data.hasPriorityPassed],
    stack: data.stack.map(deserializeStackItem),
    combat: data.combat ? deserializeCombatState(data.combat) : null,
    battlefieldAbilities: new Map(data.battlefieldAbilities) as GameState['battlefieldAbilities'],
    pendingTriggers: [...data.pendingTriggers] as GameState['pendingTriggers'],
    sideboards: new Map((data.sideboards || []).map(([playerId, defs]) => [
      playerId,
      defs.map(deserializeCardDefinition),
    ])),
  };

  // Restore grudge data if present
  if (data.damageHistory) {
    (state as GameStateWithGrudges).damageHistory = data.damageHistory.map(r => ({
      sourcePlayerId: r.sourcePlayerId,
      targetPlayerId: r.targetPlayerId,
      amount: r.amount,
      turnNumber: r.turnNumber,
    }));
  }

  return state;
}

/**
 * Create a full save game object.
 */
export function createSaveGame(
  state: GameState,
  name: string,
  humanPlayerId: string = 'p1',
): SaveGameV1 {
  const id = generateSaveId();
  const humanPlayer = state.players.find(p => p.id === humanPlayerId);

  const metadata = createSaveMetadata(
    id,
    name,
    state.turnNumber,
    state.players.length,
    humanPlayer?.name ?? 'Player',
  );

  return {
    version: SAVE_VERSION,
    metadata,
    state: serializeGameState(state),
  };
}

/**
 * Extract GameState from a save game.
 */
export function loadFromSaveGame(save: SaveGameV1): GameState {
  return deserializeGameState(save.state);
}

/**
 * Serialize a save game to JSON string.
 */
export function saveGameToJson(save: SaveGameV1): string {
  return JSON.stringify(save);
}

/**
 * Parse a save game from JSON string.
 */
export function saveGameFromJson(json: string): SaveGameV1 {
  const parsed = JSON.parse(json);

  if (typeof parsed.version !== 'number') {
    throw new Error('Invalid save game: missing version');
  }

  if (parsed.version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version: ${parsed.version}`);
  }

  return parsed as SaveGameV1;
}
