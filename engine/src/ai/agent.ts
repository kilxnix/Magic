/**
 * AI Agent
 *
 * The main AI decision-making engine. Integrates legal action generation,
 * evaluation, and target selection to make gameplay decisions.
 */

import { GameState } from '../types';
import { getCardDefinition, getCardsInZone } from '../game-state';
import { parseOracleText } from '../effects/parser';
import { getOverride } from '../effects/overrides';
import type { Effect } from '../effects/ast';
import { getLegalActions, getSpellTargetSpecs } from './legal-actions';
import { evaluateActions, getBestAction } from './evaluate';
import { selectTargetsForSpell, selectBestAttackTarget } from './targeting';
import { hashSeed, DEFAULT_RNG_SEED } from '../rng';
import type { AIAction, AIDifficulty, AIPlayerConfig, ActionEvaluation } from './types';
import {
  tryPlayLand,
  tryTapLandForMana,
  tryUntapManaSource,
  tryAdjustCounters,
  tryAdjustPlayerCounter,
  tryAdjustCommanderDamage,
  tryMoveCardManually,
  tryAdjustDamage,
  tryCreateManualToken,
  tryAttachCardManually,
  trySetPhaseStepManually,
  tryCastSpell,
  tryActivateAbility,
  tryPassPriority,
  tryDeclareAttackers,
  tryDeclareBlockers,
  tryEquip,
  fail,
} from '../actions-public';
import type { ActionResult } from '../actions-public';

/** Maximum consecutive failed dispatches before the AI forces a priority pass. */
const AI_RETRY_BUDGET = 5;

export interface DispatchAIActionOptions {
  autoNameMissingCardChoices?: boolean;
}

function normalizeOracleForAIParser(oracleText: string, cardName: string): string {
  if (!cardName) return oracleText;
  const escaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return oracleText.replace(new RegExp(escaped, 'gi'), '~');
}

function effectsForAICast(state: GameState, cardInstanceId: string): Effect[] {
  const card = state.cards.get(cardInstanceId);
  if (!card) return [];
  const def = getCardDefinition(state, card);
  const override = getOverride(def.id, def.name);
  if (override?.kind === 'Spell') return override.effects as Effect[];
  const parsed = parseOracleText(normalizeOracleForAIParser(def.oracle_text, def.name), def.mana_cost);
  if (parsed.kind === 'Spell') return parsed.effects as Effect[];
  return [];
}

function chooseNamedCardForAI(state: GameState, playerId: string, cardInstanceId: string): Record<string, string> | undefined {
  const effects = effectsForAICast(state, cardInstanceId);
  const nameEffects = effects.filter((effect): effect is Extract<Effect, { kind: 'ExileUntilNamed' }> =>
    effect.kind === 'ExileUntilNamed',
  );
  if (nameEffects.length === 0) return undefined;
  const library = getCardsInZone(state, playerId, 'library');
  const preferred = library.find(card => {
    const def = getCardDefinition(state, card);
    return /oracle|consultation|pact|combo|win/i.test(def.name);
  }) || library.find(card => !getCardDefinition(state, card).card_types.includes('land')) || library[0];
  const named = preferred ? getCardDefinition(state, preferred).name : 'Black Lotus';
  return Object.fromEntries(nameEffects.map(effect => [effect.namedCardChoiceId || 'namedCard', named]));
}

export function prepareAIActionForDispatch(state: GameState, playerId: string, action: AIAction): AIAction {
  if (action.kind !== 'CastSpell' || action.namedCardChoices) return action;
  const namedCardChoices = chooseNamedCardForAI(state, playerId, action.cardInstanceId);
  return namedCardChoices
    ? { ...action, namedCardChoices }
    : action;
}

/**
 * AI decision result including the chosen action and new game state.
 */
export interface AIDecision {
  action: AIAction;
  newState: GameState;
  reasoning?: string;
}

/**
 * AI choice result without applying the action. Use this in authority-driven
 * callers so the selected action is validated and committed exactly once by
 * the canonical action boundary.
 */
export interface AIActionChoice {
  action: AIAction;
  reasoning?: string;
}

/**
 * Dispatch an AI action through the try* API, returning an ActionResult.
 *
 * This is the canonical action-application layer: it validates and applies
 * state mutations through the public try* wrappers rather than calling raw
 * action functions directly.
 */
export function dispatchAIAction(
  state: GameState,
  playerId: string,
  action: AIAction,
  options: DispatchAIActionOptions = {},
): ActionResult {
  switch (action.kind) {
    case 'PlayLand':
      return tryPlayLand(state, playerId, action.cardInstanceId, {
        chosenCreatureType: action.chosenCreatureType,
        chosenColor: action.chosenColor,
        payLifeToEnterUntapped: action.payLifeToEnterUntapped,
      });

    case 'ActivateManaAbility':
      return tryTapLandForMana(state, playerId, action.cardInstanceId, action.color);

    case 'ManualUntapManaSource':
      return tryUntapManaSource(state, playerId, action.cardInstanceId, action.color, action.amount);

    case 'ManualAdjustCounters':
      return tryAdjustCounters(state, playerId, action.cardInstanceId, action.counterType, action.delta);

    case 'ManualAdjustPlayerCounter':
      return tryAdjustPlayerCounter(state, playerId, action.playerId, action.counterType, action.delta);

    case 'ManualAdjustCommanderDamage':
      return tryAdjustCommanderDamage(state, playerId, action.playerId, action.commanderInstanceId, action.delta);

    case 'ManualMoveCard':
      return tryMoveCardManually(state, playerId, action.cardInstanceId, action.zone);

    case 'ManualAdjustDamage':
      return tryAdjustDamage(state, playerId, action.cardInstanceId, action.delta);

    case 'ManualCreateToken':
      return tryCreateManualToken(state, playerId, action);

    case 'ManualAttachCard':
      return tryAttachCardManually(state, playerId, action.cardInstanceId, action.targetId);

    case 'ManualSetPhaseStep':
      return trySetPhaseStepManually(state, playerId, action.activePlayerId, action.phase, action.step);

    case 'CastSpell':
      // CastSpell in the AIAction doesn't carry a manaPayment — the mana pool
      // is expected to have been pre-loaded via ActivateManaAbility actions.
      // tryCastSpell checks the pool against the card's cost; pass an empty
      // payment object so the wrapper uses the pool as-is.
      return tryCastSpell(state, playerId, action.cardInstanceId, action.targets, {
        W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0,
      }, {
        chosenModes: action.chosenModes,
        namedCardChoices: action.namedCardChoices || (options.autoNameMissingCardChoices
          ? chooseNamedCardForAI(state, playerId, action.cardInstanceId)
          : undefined),
        cardChoices: action.cardChoices,
        xValue: action.xValue,
        faceName: action.faceName,
        delveCardIds: action.delveCardIds,
        convokeCreatureIds: action.convokeCreatureIds,
        improviseArtifactIds: action.improviseArtifactIds,
      });

    case 'DeclareAttackers':
      return tryDeclareAttackers(state, playerId, action.attacks);

    case 'DeclareBlockers':
      return tryDeclareBlockers(state, playerId, action.blocks);

    case 'ActivateAbility':
      return tryActivateAbility(
        state,
        playerId,
        action.cardInstanceId,
        action.abilityIndex,
        action.targets,
      );

    case 'Equip':
      return tryEquip(state, playerId, action.equipmentInstanceId, action.targetCreatureId);

    case 'PassPriority':
      return tryPassPriority(state, playerId);

    default: {
      // Exhaustiveness check
      const _never: never = action;
      return fail('internal_error', `Unknown AI action kind: ${(_never as AIAction).kind}`);
    }
  }
}

/**
 * Apply an AI action to the game state (legacy shim for backward compatibility).
 *
 * Prefer dispatchAIAction for new call sites.  This wrapper throws on failure
 * so that existing callers that expect a raw GameState keep working unchanged.
 */
export function applyAction(state: GameState, playerId: string, action: AIAction): GameState {
  const result = dispatchAIAction(state, playerId, action);
  if (result.ok) {
    return result.state;
  }
  throw new Error(`AI action ${action.kind} failed: ${result.message}`);
}

/**
 * Add randomness to action selection for lower difficulty levels.
 *
 * The jitter is a PURE deterministic function of the game's PRNG cursor
 * (`state.rngState`) and each action's identity — it does not advance the
 * cursor. That keeps AI decisions reproducible on replay (same state ⇒ same
 * ranking) and free of side effects, so calling the decision function
 * speculatively (previews, look-ahead) never perturbs the live RNG stream.
 * The cursor only moves on real random game events (shuffles, dice), which in
 * turn shifts subsequent AI jitter — so the AI still varies game to game.
 */
function addRandomness(
  evaluations: ActionEvaluation[],
  difficulty: AIDifficulty,
  state: GameState,
): ActionEvaluation[] {
  if (evaluations.length === 0) return evaluations;

  // Higher difficulty = less randomness
  const randomFactor = (5 - difficulty) * 2; // 8 for d1, 6 for d2, 4 for d3, 2 for d4, 0 for d5
  if (randomFactor === 0) {
    return [...evaluations].sort((a, b) => b.score - a.score);
  }

  const base = state.rngState ?? DEFAULT_RNG_SEED;
  return evaluations.map((ev, index) => {
    const key = `${base}:${index}:${ev.action.kind}:${(ev.action as { cardInstanceId?: string }).cardInstanceId ?? ''}`;
    const unit = hashSeed(key) / 4294967296; // deterministic value in [0, 1)
    return {
      ...ev,
      score: ev.score + (unit - 0.5) * randomFactor,
    };
  }).sort((a, b) => b.score - a.score);
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

function rankedActionChoices(
  state: GameState,
  config: AIPlayerConfig,
): { actions: AIAction[]; evaluations: ActionEvaluation[] } {
  const { playerId, difficulty } = config;

  let actions = getLegalActions(state, playerId);
  if (actions.length === 0) {
    return { actions, evaluations: [] };
  }

  actions = filterActionsByDifficulty(state, playerId, actions, difficulty);
  actions = actions.map(action => {
    action = enhanceCastSpellTargets(state, playerId, action);
    action = enhanceAttackTargets(state, playerId, action);
    return action;
  });

  let evaluations = evaluateActions(state, playerId, actions);
  evaluations = addRandomness(evaluations, difficulty, state);
  return { actions, evaluations };
}

export function chooseAction(
  state: GameState,
  config: AIPlayerConfig,
): AIActionChoice | null {
  const { evaluations } = rankedActionChoices(state, config);
  const bestEvaluation = evaluations[0];
  if (!bestEvaluation) return null;
  return {
    action: prepareAIActionForDispatch(state, config.playerId, bestEvaluation.action),
    reasoning: bestEvaluation.reasoning,
  };
}

/**
 * Make a single decision for an AI player, dispatching the chosen action
 * through the try* API.
 *
 * Returns:
 *   - An AIDecision when an action was successfully applied.
 *   - null when no legal actions exist or the chosen action could not be
 *     applied and no fallback was available.  The loop in runAITurn counts
 *     these null returns against the retry budget.
 */
export function makeDecision(
  state: GameState,
  config: AIPlayerConfig,
): AIDecision | null {
  const { playerId } = config;
  const { actions, evaluations } = rankedActionChoices(state, config);

  // Select the best action
  const bestEvaluation = evaluations[0];
  if (!bestEvaluation) {
    return null;
  }

  // Dispatch through the try* API
  const preparedAction = prepareAIActionForDispatch(state, playerId, bestEvaluation.action);
  const result = dispatchAIAction(state, playerId, preparedAction, { autoNameMissingCardChoices: true });
  if (result.ok) {
    return {
      action: preparedAction,
      newState: result.state,
      reasoning: bestEvaluation.reasoning,
    };
  }

  // Action failed — fall back to PassPriority if it was among the legal actions.
  const passAction = actions.find(a => a.kind === 'PassPriority');
  if (passAction) {
    const passResult = dispatchAIAction(state, playerId, passAction);
    if (passResult.ok) {
      return {
        action: passAction,
        newState: passResult.state,
        reasoning: `Fallback to pass (${result.reason}: ${result.message})`,
      };
    }
  }

  // Both the chosen action and the fallback pass failed; signal failure to the
  // loop so it can count against the retry budget.
  return null;
}

/**
 * Run the AI until it passes priority or changes phase.
 *
 * Returns the sequence of decisions made.
 *
 * A 5-action retry budget guards against stalling: if makeDecision returns
 * null (dispatch failed and no fallback was available) five times in a row,
 * the loop forces a PassPriority directly through tryPassPriority and exits.
 */
export function runAITurn(
  initialState: GameState,
  config: AIPlayerConfig,
  maxIterations: number = 100,
): { finalState: GameState; decisions: AIDecision[] } {
  let state = initialState;
  const decisions: AIDecision[] = [];
  let consecutiveFailures = 0;

  for (let i = 0; i < maxIterations; i++) {
    // Retry budget: if too many consecutive dispatches have failed, stop
    // trying and force a priority pass so the game can progress.
    if (consecutiveFailures >= AI_RETRY_BUDGET) {
      const passResult = tryPassPriority(state, config.playerId);
      if (passResult.ok) {
        decisions.push({
          action: { kind: 'PassPriority' },
          newState: passResult.state,
          reasoning: `Retry budget (${AI_RETRY_BUDGET}) exhausted — passing priority`,
        });
        state = passResult.state;
      }
      // Whether or not the forced pass succeeded, exit the loop.
      break;
    }

    const decision = makeDecision(state, config);

    if (!decision) {
      // null can mean "no legal actions" (clean exit) or "dispatch failed
      // and no fallback" (count against budget and retry).
      consecutiveFailures++;
      // If we've now hit the budget, the top of the loop will handle it.
      // Exit immediately only when there genuinely are no legal actions at all.
      const actions = getLegalActions(state, config.playerId);
      if (actions.length === 0) {
        break;
      }
      continue;
    }

    decisions.push(decision);
    state = decision.newState;
    consecutiveFailures = 0; // Reset budget on every successful dispatch.

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
