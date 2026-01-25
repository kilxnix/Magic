/**
 * AI Heuristic Evaluator
 *
 * Scores game states and actions using simple heuristics.
 * Higher scores are better for the AI.
 */

import { GameState, CardInstance, CardDefinition, Player } from '../types';
import { getCardsInZone, getCardDefinition } from '../game-state';
import type { AIAction, ActionEvaluation } from './types';

// Scoring constants
const LIFE_VALUE = 1;
const CARD_IN_HAND_VALUE = 2;
const CREATURE_BASE_VALUE = 3;
const CREATURE_POWER_VALUE = 1;
const CREATURE_TOUGHNESS_VALUE = 0.5;
const MANA_AVAILABLE_VALUE = 0.5;
const MANA_SPENT_VALUE = 1.5;
const THREAT_REMOVED_VALUE = 5;
const COMMANDER_VALUE = 10;

/**
 * Evaluate the value of a single creature.
 */
export function evaluateCreature(
  state: GameState,
  card: CardInstance,
): number {
  const def = getCardDefinition(state, card);
  const power = def.power ?? 0;
  const toughness = def.toughness ?? 0;

  let value = CREATURE_BASE_VALUE;
  value += power * CREATURE_POWER_VALUE;
  value += toughness * CREATURE_TOUGHNESS_VALUE;

  // Keywords add value
  if (def.keywords.includes('Flying')) value += 2;
  if (def.keywords.includes('Deathtouch')) value += 2;
  if (def.keywords.includes('Trample')) value += 1;
  if (def.keywords.includes('Lifelink')) value += 1.5;
  if (def.keywords.includes('Vigilance')) value += 1;
  if (def.keywords.includes('Haste')) value += 0.5;
  if (def.keywords.includes('First Strike') || def.keywords.includes('Double Strike')) value += 1.5;
  if (def.keywords.includes('Hexproof')) value += 2;
  if (def.keywords.includes('Indestructible')) value += 4;

  // Commander is extra valuable
  if (card.isCommander) {
    value += COMMANDER_VALUE;
  }

  return value;
}

/**
 * Evaluate a player's board position.
 */
export function evaluatePlayerPosition(
  state: GameState,
  playerId: string,
): number {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.hasLost) return -1000;

  let score = 0;

  // Life total
  score += player.life * LIFE_VALUE;

  // Cards in hand
  const hand = getCardsInZone(state, playerId, 'hand');
  score += hand.length * CARD_IN_HAND_VALUE;

  // Creatures on battlefield
  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  for (const card of battlefield) {
    const def = state.cardDefinitions.get(card.definitionId);
    if (def?.card_types.includes('creature')) {
      score += evaluateCreature(state, card);
    }
  }

  // Available mana
  const manaPool = player.manaPool;
  const totalMana = manaPool.W + manaPool.U + manaPool.B + manaPool.R + manaPool.G + manaPool.C;
  score += totalMana * MANA_AVAILABLE_VALUE;

  // Untapped lands (potential mana)
  for (const card of battlefield) {
    const def = state.cardDefinitions.get(card.definitionId);
    if (def?.card_types.includes('land') && !card.tapped) {
      score += MANA_AVAILABLE_VALUE;
    }
  }

  return score;
}

/**
 * Evaluate the game state from a player's perspective.
 * Considers own position minus opponents' positions.
 */
export function evaluateGameState(
  state: GameState,
  playerId: string,
): number {
  const ownScore = evaluatePlayerPosition(state, playerId);

  // Subtract opponents' scores (weighted down in multiplayer)
  let opponentScore = 0;
  let opponentCount = 0;

  for (const player of state.players) {
    if (player.id !== playerId && !player.hasLost) {
      opponentScore += evaluatePlayerPosition(state, player.id);
      opponentCount++;
    }
  }

  // Average opponent score
  const avgOpponentScore = opponentCount > 0 ? opponentScore / opponentCount : 0;

  return ownScore - avgOpponentScore * 0.8;
}

/**
 * Evaluate a PlayLand action.
 */
function evaluatePlayLand(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
): number {
  // Playing a land is almost always good - it's free mana development
  return 3;
}

/**
 * Evaluate a CastSpell action.
 */
function evaluateCastSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targets: string[],
): number {
  const card = state.cards.get(cardInstanceId);
  if (!card) return 0;

  const def = getCardDefinition(state, card);
  let score = 0;

  // Value of spending mana (better to use mana than leave it unspent)
  score += def.cmc * MANA_SPENT_VALUE;

  // Value based on card type
  if (def.card_types.includes('creature')) {
    const power = def.power ?? 0;
    const toughness = def.toughness ?? 0;
    score += CREATURE_BASE_VALUE + power * CREATURE_POWER_VALUE + toughness * CREATURE_TOUGHNESS_VALUE;
  }

  // Value for targeted removal
  if (targets.length > 0) {
    for (const targetId of targets) {
      const targetCard = state.cards.get(targetId);
      if (targetCard && targetCard.ownerId !== playerId) {
        // Removing an opponent's creature
        score += evaluateCreature(state, targetCard) * 0.9;
      }
    }
  }

  return score;
}

/**
 * Evaluate an ActivateManaAbility action.
 */
function evaluateActivateMana(
  state: GameState,
  playerId: string,
): number {
  // Tapping for mana is neutral unless there's something to cast
  // We'll give it a small positive score to prefer having mana
  return 0.1;
}

/**
 * Evaluate a DeclareAttackers action.
 */
function evaluateDeclareAttackers(
  state: GameState,
  playerId: string,
  attacks: { cardInstanceId: string; defendingPlayerId: string }[],
): number {
  if (attacks.length === 0) {
    // Not attacking is safe but doesn't advance win condition
    return 0;
  }

  let score = 0;

  for (const attack of attacks) {
    const attackerCard = state.cards.get(attack.cardInstanceId);
    if (!attackerCard) continue;

    const def = getCardDefinition(state, attackerCard);
    const power = def.power ?? 0;

    // Value of dealing damage
    const defender = state.players.find(p => p.id === attack.defendingPlayerId);
    if (defender) {
      // More valuable to attack players with lower life
      const lifeFactor = Math.max(1, 40 / Math.max(1, defender.life));
      score += power * lifeFactor;

      // Commander damage is extra valuable
      if (attackerCard.isCommander) {
        score += power * 2;
      }
    }

    // Penalty for attacking with valuable creatures that might die
    // (Will be refined in combat evaluation)
    const creatureValue = evaluateCreature(state, attackerCard);
    score -= creatureValue * 0.1; // Small risk penalty
  }

  return score;
}

/**
 * Evaluate a DeclareBlockers action.
 */
function evaluateDeclareBlockers(
  state: GameState,
  playerId: string,
  blocks: { cardInstanceId: string; blockingAttackerId: string }[],
): number {
  if (!state.combat) return 0;

  // Calculate damage that would be dealt to us
  let incomingDamage = 0;
  for (const attacker of state.combat.attackers) {
    if (attacker.defendingPlayerId !== playerId) continue;

    const attackerCard = state.cards.get(attacker.cardInstanceId);
    if (!attackerCard) continue;

    const def = state.cardDefinitions.get(attackerCard.definitionId);
    const power = def?.power ?? 0;

    // Check if this attacker is blocked
    const isBlocked = blocks.some(b => b.blockingAttackerId === attacker.cardInstanceId);
    if (!isBlocked) {
      incomingDamage += power;
    }
  }

  let score = 0;

  // Value of reducing incoming damage
  const player = state.players.find(p => p.id === playerId);
  if (player) {
    // Blocking is more valuable at low life
    const lifeFactor = Math.max(1, 40 / Math.max(1, player.life));
    score += (state.combat.attackers.length > 0 ? 1 : 0) * lifeFactor;
  }

  // Evaluate each block
  for (const block of blocks) {
    const blockerCard = state.cards.get(block.cardInstanceId);
    const attackerCard = state.cards.get(block.blockingAttackerId);
    if (!blockerCard || !attackerCard) continue;

    const blockerDef = state.cardDefinitions.get(blockerCard.definitionId);
    const attackerDef = state.cardDefinitions.get(attackerCard.definitionId);

    const blockerPower = blockerDef?.power ?? 0;
    const blockerToughness = blockerDef?.toughness ?? 0;
    const attackerPower = attackerDef?.power ?? 0;
    const attackerToughness = attackerDef?.toughness ?? 0;

    // Good block: kills attacker, blocker survives
    const attackerDies = blockerPower >= attackerToughness;
    const blockerDies = attackerPower >= blockerToughness;

    if (attackerDies && !blockerDies) {
      // Excellent trade
      score += evaluateCreature(state, attackerCard) * 1.5;
    } else if (attackerDies && blockerDies) {
      // Trade - good if attacker is more valuable
      score += evaluateCreature(state, attackerCard) - evaluateCreature(state, blockerCard);
    } else if (!attackerDies && blockerDies) {
      // Bad trade - losing blocker for nothing
      score -= evaluateCreature(state, blockerCard);
    } else {
      // Neither dies - just blocked damage
      score += attackerPower * 0.5;
    }
  }

  // Penalty for taking damage
  score -= incomingDamage * LIFE_VALUE;

  return score;
}

/**
 * Evaluate a PassPriority action.
 */
function evaluatePassPriority(
  state: GameState,
  playerId: string,
): number {
  // Passing is neutral but slightly negative (prefer action over inaction)
  return -0.1;
}

/**
 * Evaluate an action and return a score.
 */
export function evaluateAction(
  state: GameState,
  playerId: string,
  action: AIAction,
): ActionEvaluation {
  let score: number;
  let reasoning: string | undefined;

  switch (action.kind) {
    case 'PlayLand':
      score = evaluatePlayLand(state, playerId, action.cardInstanceId);
      reasoning = 'Land development';
      break;

    case 'CastSpell':
      score = evaluateCastSpell(state, playerId, action.cardInstanceId, action.targets);
      reasoning = 'Spell value';
      break;

    case 'ActivateManaAbility':
      score = evaluateActivateMana(state, playerId);
      reasoning = 'Mana generation';
      break;

    case 'DeclareAttackers':
      score = evaluateDeclareAttackers(state, playerId, action.attacks);
      reasoning = action.attacks.length > 0 ? 'Attack value' : 'No attack';
      break;

    case 'DeclareBlockers':
      score = evaluateDeclareBlockers(state, playerId, action.blocks);
      reasoning = action.blocks.length > 0 ? 'Block value' : 'No blocks';
      break;

    case 'PassPriority':
      score = evaluatePassPriority(state, playerId);
      reasoning = 'Pass';
      break;

    default:
      score = 0;
  }

  return { action, score, reasoning };
}

/**
 * Evaluate all actions and return sorted by score (highest first).
 */
export function evaluateActions(
  state: GameState,
  playerId: string,
  actions: AIAction[],
): ActionEvaluation[] {
  const evaluations = actions.map(action => evaluateAction(state, playerId, action));
  return evaluations.sort((a, b) => b.score - a.score);
}

/**
 * Get the best action from a list.
 */
export function getBestAction(
  state: GameState,
  playerId: string,
  actions: AIAction[],
): AIAction | null {
  if (actions.length === 0) return null;

  const evaluations = evaluateActions(state, playerId, actions);
  return evaluations[0].action;
}
