/**
 * AI Action Types
 *
 * Represents all possible actions an AI can take during a game.
 */

import { AttackerDeclaration, BlockerDeclaration, ManaColor, CardInstance } from '../types';

/**
 * An action to cast a spell from hand or command zone.
 */
export interface CastSpellAction {
  kind: 'CastSpell';
  cardInstanceId: string;
  targets: string[];
  chosenModes?: number[];
  namedCardChoices?: Record<string, string>;
  cardChoices?: CardInstance['choices'];
  xValue?: number;
  faceName?: string;
  delveCardIds?: string[];
  convokeCreatureIds?: string[];
  improviseArtifactIds?: string[];
}

/**
 * An action to play a land from hand.
 */
export interface PlayLandAction {
  kind: 'PlayLand';
  cardInstanceId: string;
  chosenCreatureType?: string;
  payLifeToEnterUntapped?: boolean;
}

/**
 * An action to activate a mana ability (tap land for mana).
 */
export interface ActivateManaAbilityAction {
  kind: 'ActivateManaAbility';
  cardInstanceId: string;
  color: ManaColor;
}

/**
 * A manual correction that reverses a just-added mana activation before the
 * floating mana has been spent. This is not generated as a normal legal play;
 * it exists so UI corrections still flow through validated engine actions.
 */
export interface ManualUntapManaSourceAction {
  kind: 'ManualUntapManaSource';
  cardInstanceId: string;
  color: ManaColor;
  amount: number;
}

/**
 * A manual correction that adjusts counters on a battlefield permanent. This is
 * not generated as a normal strategic action; it lets correction UI use the
 * same validated authority/replay path as ordinary game actions.
 */
export interface ManualAdjustCountersAction {
  kind: 'ManualAdjustCounters';
  cardInstanceId: string;
  counterType: string;
  delta: number;
}

export interface ManualAdjustPlayerCounterAction {
  kind: 'ManualAdjustPlayerCounter';
  playerId: string;
  counterType: string;
  delta: number;
}

export interface ManualMoveCardAction {
  kind: 'ManualMoveCard';
  cardInstanceId: string;
  zone: 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'command';
}

export interface ManualCreateTokenAction {
  kind: 'ManualCreateToken';
  name: string;
  count: number;
  power: number;
  toughness: number;
  colors: string[];
  types: string[];
  subtypes: string[];
  keywords?: string[];
}

/**
 * An action to declare attackers during the declare attackers step.
 */
export interface DeclareAttackersAction {
  kind: 'DeclareAttackers';
  attacks: AttackerDeclaration[];
}

/**
 * An action to declare blockers during the declare blockers step.
 */
export interface DeclareBlockersAction {
  kind: 'DeclareBlockers';
  blocks: BlockerDeclaration[];
}

/**
 * An action to activate a non-mana ability on a permanent.
 */
export interface ActivateAbilityAction {
  kind: 'ActivateAbility';
  cardInstanceId: string;
  abilityIndex: number;
  targets: string[];
}

/**
 * An action to pass priority.
 */
export interface PassPriorityAction {
  kind: 'PassPriority';
}

/**
 * An action to equip an equipment to a creature.
 */
export interface EquipAction {
  kind: 'Equip';
  equipmentInstanceId: string;  // The equipment card
  targetCreatureId: string;      // The creature to equip
}

/**
 * Union of all possible AI actions.
 */
export type AIAction =
  | CastSpellAction
  | PlayLandAction
  | ActivateManaAbilityAction
  | ManualUntapManaSourceAction
  | ManualAdjustCountersAction
  | ManualAdjustPlayerCounterAction
  | ManualMoveCardAction
  | ManualCreateTokenAction
  | ActivateAbilityAction
  | DeclareAttackersAction
  | DeclareBlockersAction
  | PassPriorityAction
  | EquipAction;

/**
 * AI difficulty level, aligned with Commander brackets.
 */
export type AIDifficulty = 1 | 2 | 3 | 4 | 5;

/**
 * AI personality types that define playstyle tendencies.
 */
export type AIPersonality = 'Aggressive' | 'Greedy' | 'Political' | 'Balanced';

/**
 * Weights that define personality behavior.
 */
export interface PersonalityWeights {
  /** Preference for developing board vs holding interaction (0-1) */
  boardDevelopment: number;
  /** How eagerly the AI attacks (0-1) */
  attackAggressiveness: number;
  /** How eagerly the AI uses removal (0-1) */
  removalEagerness: number;
  /** How much grudges affect targeting (0-1) */
  grudgeBias: number;
  /** Preference for spreading damage in multiplayer (0-1) */
  politicalSpread: number;
}

/**
 * Configuration for an AI player.
 */
export interface AIPlayerConfig {
  playerId: string;
  difficulty: AIDifficulty;
  personality?: AIPersonality;
}

/**
 * Tracks damage dealt between players for grudge system.
 */
export interface DamageRecord {
  sourcePlayerId: string;
  targetPlayerId: string;
  amount: number;
  turnNumber: number;
}

/**
 * Threat assessment result for a player.
 */
export interface ThreatAssessment {
  playerId: string;
  threatScore: number;
  reasons: string[];
}

/**
 * Result of evaluating an action, including score and reasoning.
 */
export interface ActionEvaluation {
  action: AIAction;
  score: number;
  reasoning?: string;
}
