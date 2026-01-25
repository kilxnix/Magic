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
  | DeclareAttackersAction
  | DeclareBlockersAction
  | PassPriorityAction;

/**
 * AI difficulty level, aligned with Commander brackets.
 */
export type AIDifficulty = 1 | 2 | 3 | 4 | 5;

/**
 * Configuration for an AI player.
 */
export interface AIPlayerConfig {
  playerId: string;
  difficulty: AIDifficulty;
}

/**
 * Result of evaluating an action, including score and reasoning.
 */
export interface ActionEvaluation {
  action: AIAction;
  score: number;
  reasoning?: string;
}
