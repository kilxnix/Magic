/**
 * AI Agent
 *
 * The main AI decision-making engine. Integrates legal action generation,
 * evaluation, and target selection to make gameplay decisions.
 */

import { GameState } from '../types';
import { playLand, tapLandForMana, activateAbility } from '../actions';
import { castSpell } from '../stack';
import { declareAttackers, declareBlockers } from '../combat';
import { passPriority } from '../priority';
import { getLegalActions, getSpellTargetSpecs } from './legal-actions';
import { evaluateActions, getBestAction } from './evaluate';
import { selectTargetsForSpell, selectBestAttackTarget } from './targeting';
import type { AIAction, AIDifficulty, AIPlayerConfig, ActionEvaluation } from './types';

/**
 * AI decision result including the chosen action and new game state.
 */
export interface AIDecision {
  action: AIAction;
  newState: GameState;
  reasoning?: string;
}

/**
 * Apply an AI action to the game state.
 */
export function applyAction(state: GameState, playerId: string, action: AIAction): GameState {
  switch (action.kind) {
    case 'PlayLand':
      return playLand(state, playerId, action.cardInstanceId);

    case 'ActivateManaAbility':
      return tapLandForMana(state, playerId, action.cardInstanceId, action.color);

    case 'CastSpell':
      return castSpell(state, playerId, action.cardInstanceId, action.targets, action.chosenModes);

    case 'DeclareAttackers':
      return declareAttackers(state, playerId, action.attacks);

    case 'DeclareBlockers':
      return declareBlockers(state, playerId, action.blocks);

    case 'ActivateAbility':
      return activateAbility(state, playerId, action.cardInstanceId, action.abilityIndex, action.targets);

    case 'PassPriority':
      return passPriority(state);

    default:
      // Exhaustiveness check
      const _never: never = action;
      throw new Error(`Unknown action kind: ${(_never as AIAction).kind}`);
  }
}

/**
 * Add randomness to action selection for lower difficulty levels.
 */
function addRandomness(
  evaluations: ActionEvaluation[],
  difficulty: AIDifficulty,
): ActionEvaluation[] {
  if (evaluations.length === 0) return evaluations;

  // Higher difficulty = less randomness
  const randomFactor = (5 - difficulty) * 2; // 8 for d1, 6 for d2, 4 for d3, 2 for d4, 0 for d5

  return evaluations.map(ev => ({
    ...ev,
    score: ev.score + (Math.random() - 0.5) * randomFactor,
  })).sort((a, b) => b.score - a.score);
}

/**
 * Filter actions based on difficulty level.
 *
 * Lower difficulties won't hold removal or make optimal plays.
 */
function filterActionsByDifficulty(
  state: GameState,
  playerId: string,
  actions: AIAction[],
  difficulty: AIDifficulty,
): AIAction[] {
  // Difficulty 1-2: No filtering, play everything available
  if (difficulty <= 2) {
    return actions;
  }

  // Difficulty 3+: May hold instant-speed removal
  // (For now, no filtering - we'll implement this in Task 6)

  return actions;
}

/**
 * Enhance cast spell actions with intelligent target selection.
 */
function enhanceCastSpellTargets(
  state: GameState,
  playerId: string,
  action: AIAction,
): AIAction {
  if (action.kind !== 'CastSpell') return action;

  // If targets already selected, use them
  if (action.targets.length > 0) return action;

  const card = state.cards.get(action.cardInstanceId);
  if (!card) return action;

  const specs = getSpellTargetSpecs(state, card);
  if (specs.length === 0) return action;

  const selection = selectTargetsForSpell(state, playerId, action.cardInstanceId, specs);

  if (selection.targets.length > 0) {
    return { ...action, targets: selection.targets };
  }

  return action;
}

/**
 * Enhance attack declarations with intelligent target selection.
 */
function enhanceAttackTargets(
  state: GameState,
  playerId: string,
  action: AIAction,
): AIAction {
  if (action.kind !== 'DeclareAttackers') return action;

  // For each attacker without a specified target, choose the best one
  const enhancedAttacks = action.attacks.map(attack => {
    const bestTarget = selectBestAttackTarget(state, attack.cardInstanceId);
    if (bestTarget) {
      return { ...attack, defendingPlayerId: bestTarget };
    }
    return attack;
  });

  return { ...action, attacks: enhancedAttacks };
}

/**
 * Make a decision for an AI player.
 */
export function makeDecision(
  state: GameState,
  config: AIPlayerConfig,
): AIDecision | null {
  const { playerId, difficulty } = config;

  // Get all legal actions
  let actions = getLegalActions(state, playerId);

  if (actions.length === 0) {
    return null; // No legal actions available
  }

  // Filter by difficulty
  actions = filterActionsByDifficulty(state, playerId, actions, difficulty);

  // Enhance actions with intelligent targeting
  actions = actions.map(action => {
    action = enhanceCastSpellTargets(state, playerId, action);
    action = enhanceAttackTargets(state, playerId, action);
    return action;
  });

  // Evaluate all actions
  let evaluations = evaluateActions(state, playerId, actions);

  // Add randomness for lower difficulties
  evaluations = addRandomness(evaluations, difficulty);

  // Select the best action
  const bestEvaluation = evaluations[0];
  if (!bestEvaluation) {
    return null;
  }

  // Apply the action
  try {
    const newState = applyAction(state, playerId, bestEvaluation.action);
    return {
      action: bestEvaluation.action,
      newState,
      reasoning: bestEvaluation.reasoning,
    };
  } catch (error) {
    // If the action fails, try to fall back to passing priority
    const passAction = actions.find(a => a.kind === 'PassPriority');
    if (passAction) {
      const newState = applyAction(state, playerId, passAction);
      return {
        action: passAction,
        newState,
        reasoning: 'Fallback to pass',
      };
    }
    return null;
  }
}

/**
 * Run the AI until it passes priority or changes phase.
 *
 * Returns the sequence of decisions made.
 */
export function runAITurn(
  initialState: GameState,
  config: AIPlayerConfig,
  maxIterations: number = 100,
): { finalState: GameState; decisions: AIDecision[] } {
  let state = initialState;
  const decisions: AIDecision[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const decision = makeDecision(state, config);

    if (!decision) {
      break; // No legal actions
    }

    decisions.push(decision);
    state = decision.newState;

    // Stop if we passed priority (let the game loop handle the rest)
    if (decision.action.kind === 'PassPriority') {
      break;
    }

    // Stop if we declared attackers/blockers (combat progresses)
    if (decision.action.kind === 'DeclareAttackers' ||
        decision.action.kind === 'DeclareBlockers') {
      break;
    }
  }

  return { finalState: state, decisions };
}

/**
 * Check if a player should be controlled by AI.
 */
export function isAIPlayer(
  _state: GameState,
  _playerId: string,
): boolean {
  // For now, this is a placeholder. In a real implementation,
  // this would check a player configuration or flag.
  // Currently returns false - AI must be explicitly invoked.
  return false;
}

/**
 * Create an AI player configuration.
 */
export function createAIConfig(
  playerId: string,
  difficulty: AIDifficulty = 3,
): AIPlayerConfig {
  return { playerId, difficulty };
}
