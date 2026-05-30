/**
 * Save Game Schema
 *
 * Versioned schema for persisting Commander game state.
 */

import type { AIPersonality, AIDifficulty } from '../ai/types';

/**
 * Current save version. Increment on breaking schema changes.
 */
export const SAVE_VERSION = 1;

/**
 * Metadata about a saved game.
 */
export interface SaveMetadata {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  turnNumber: number;
  playerCount: number;
  humanPlayerName: string;
}

/**
 * Serialized player state for V1 schema.
 */
export interface SerializedPlayerV1 {
  id: string;
  name: string;
  life: number;
  poisonCounters?: number; // optional for backward compat with existing saves
  commanderDamage: Record<string, number>;
  commanderTax: number;
  commanderInstanceId: string | null;
  commanderInstanceIds?: string[];
  commanderCastCount: number;
  commanderCastCounts?: Record<string, number>;
  manaPool: {
    W: number;
    U: number;
    B: number;
    R: number;
    G: number;
    C: number;
  };
  snowManaPool?: {
    W: number;
    U: number;
    B: number;
    R: number;
    G: number;
    C: number;
  };
  restrictedMana?: Array<{
    color: string;
    amount: number;
    restriction: string;
    creatureType?: string;
    sourceInstanceId?: string;
    snow?: boolean;
  }>;
  conditionalMana?: Array<{
    color: string;
    amount: number;
    effect: string;
    sourceInstanceId?: string;
    snow?: boolean;
  }>;
  hasPlayedLand: boolean;
  hasPriority: boolean;
  hasLost: boolean;
  isAI: boolean;
  aiDifficulty?: AIDifficulty;
  aiPersonality?: AIPersonality;
}

/**
 * Serialized card instance for V1 schema.
 */
export interface SerializedCardInstanceV1 {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  zone: string;
  tapped: boolean;
  summoningSick: boolean;
  counters: Record<string, number>;
  attachedTo?: string;
  damage: number;
  deathtouchDamage?: boolean;
  isCommander: boolean;
  fromSideboard?: boolean;
  activeFaceName?: string;
  choices?: {
    chosenCreatureType?: string;
    imprintedCardIds?: string[];
    discardedCardIds?: string[];
  };
}

/**
 * Serialized card definition for V1 schema.
 */
export interface SerializedCardDefinitionV1 {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: string[];
  color_identity: string[];
  keywords: string[];
  power?: number;
  toughness?: number;
  card_types: string[];
  faces?: Array<{
    id: string;
    name: string;
    type_line: string;
    oracle_text: string;
    mana_cost: string;
    cmc: number;
    colors: string[];
    keywords: string[];
    card_types: string[];
    power?: number;
    toughness?: number;
  }>;
}

/**
 * Serialized stack item for V1 schema.
 */
export interface SerializedStackItemV1 {
  kind: 'Spell' | 'TriggeredAbility';
  id: string;
  cardInstanceId?: string;
  sourceInstanceId?: string;
  casterId?: string;
  controllerId?: string;
  targets: string[];
  castFromZone?: string;
  chosenModes?: number[];
  namedCardChoices?: Record<string, string>;
  cardChoices?: {
    chosenCreatureType?: string;
    imprintedCardIds?: string[];
    discardedCardIds?: string[];
  };
  xValue?: number;
  faceName?: string;
  cantBeCountered?: boolean;
  isCopy?: boolean;
  copyOfCardInstanceId?: string;
  targetSpecs?: unknown[];
  ability?: unknown;
  eventContext?: {
    casterId?: string;
    cardInstanceId?: string;
  };
}

/**
 * Serialized combat state for V1 schema.
 */
export interface SerializedCombatStateV1 {
  attackers: Array<{
    cardInstanceId: string;
    defendingPlayerId: string;
  }>;
  blockers: Array<{
    cardInstanceId: string;
    blockingAttackerId: string;
  }>;
  blockersDeclared?: boolean;
  blockersDeclaredBy?: string[];
  blockerOrder?: Record<string, string[]>;
  damageAssignment: Array<[string, number]>;
}

/**
 * Serialized damage record for grudge tracking.
 */
export interface SerializedDamageRecordV1 {
  sourcePlayerId: string;
  targetPlayerId: string;
  amount: number;
  turnNumber: number;
}

export interface SerializedDamagePreventionEffectV1 {
  id: string;
  sourceInstanceId?: string;
  controllerId: string;
  protectedTargetId?: string;
  amount: number | 'all';
  combatOnly: boolean;
  expiresAtTurnNumber: number;
}

export interface SerializedDiceRollRecordV1 {
  id: string;
  playerId: string;
  sourceInstanceId?: string;
  sourceName?: string;
  sides: 20;
  result: number;
  outcomeMin: number;
  outcomeMax: number;
  turnNumber: number;
  phase: string;
  step: string;
}

/**
 * Full serialized game state for V1 schema.
 */
export interface SerializedGameStateV1 {
  players: SerializedPlayerV1[];
  cards: Array<[string, SerializedCardInstanceV1]>;
  cardDefinitions: Array<[string, SerializedCardDefinitionV1]>;
  activePlayerIndex: number;
  priorityPlayerIndex: number;
  phase: string;
  step: string;
  turnNumber: number;
  spellsCastThisTurn?: number;
  hasPriorityPassed: boolean[];
  stack: SerializedStackItemV1[];
  combat: SerializedCombatStateV1 | null;
  battlefieldAbilities: Array<[string, unknown[]]>;
  pendingTriggers: unknown[];
  sideboards?: Array<[string, SerializedCardDefinitionV1[]]>;
  damageHistory?: SerializedDamageRecordV1[];
  damagePreventionEffects?: SerializedDamagePreventionEffectV1[];
  diceRolls?: SerializedDiceRollRecordV1[];
}

/**
 * Complete save game structure for V1.
 */
export interface SaveGameV1 {
  version: 1;
  metadata: SaveMetadata;
  state: SerializedGameStateV1;
}

/**
 * Union of all save game versions (for migration).
 */
export type SaveGame = SaveGameV1;

/**
 * The latest save game version type.
 */
export type SaveGameLatest = SaveGameV1;

/**
 * Create a new save game ID.
 */
export function generateSaveId(): string {
  return `save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create metadata for a new save.
 */
export function createSaveMetadata(
  id: string,
  name: string,
  turnNumber: number,
  playerCount: number,
  humanPlayerName: string,
): SaveMetadata {
  const now = new Date().toISOString();
  return {
    id,
    name,
    createdAt: now,
    updatedAt: now,
    turnNumber,
    playerCount,
    humanPlayerName,
  };
}

/**
 * Update metadata timestamp.
 */
export function updateSaveMetadata(metadata: SaveMetadata): SaveMetadata {
  return {
    ...metadata,
    updatedAt: new Date().toISOString(),
  };
}
