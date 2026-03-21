/**
 * AI Action Types
 *
 * Represents all possible actions an AI can take during a game.
 */

import { AttackerDeclaration, BlockerDeclaration, ManaColor } from '../types';

/**
 * An action to cast a spell from hand or command zone.
 */
export interface CastSpellAction {
  kind: 'CastSpell';
  cardInstanceId: string;
  targets: string[];
  chosenModes?: number[];
}

/**
 * An action to play a land from hand.
 */
export interface PlayLandAction {
  kind: 'PlayLand';
  cardInstanceId: string;
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
 * Union of all possible AI actions.
 */
export type AIAction =
  | CastSpellAction
  | PlayLandAction
  | ActivateManaAbilityAction
  | ActivateAbilityAction
  | DeclareAttackersAction
  | DeclareBlockersAction
  | PassPriorityAction;

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
