/**
 * AI Personality Profiles
 *
 * Defines distinct playstyles for AI opponents in Commander games.
 */

import type { AIPersonality, PersonalityWeights } from './types';

/**
 * Personality weight profiles.
 *
 * Each personality has different tendencies:
 * - boardDevelopment: prefers casting creatures/permanents vs holding mana
 * - attackAggressiveness: how readily attacks when able
 * - removalEagerness: how quickly uses removal spells
 * - grudgeBias: how much past damage affects targeting
 * - politicalSpread: tendency to spread damage across opponents
 */
export const PERSONALITY_WEIGHTS: Record<AIPersonality, PersonalityWeights> = {
  /**
   * Aggressive: Swings wide, pressures life totals, hits open players.
   * Plays threats fast, attacks often, uses removal proactively.
   */
  Aggressive: {
    boardDevelopment: 0.9,
    attackAggressiveness: 0.95,
    removalEagerness: 0.7,
    grudgeBias: 0.3,
    politicalSpread: 0.2,
  },

  /**
   * Greedy: Ramps hard, ignores threats, goes for big plays.
   * Prioritizes own development, rarely attacks, holds removal.
   */
  Greedy: {
    boardDevelopment: 1.0,
    attackAggressiveness: 0.3,
    removalEagerness: 0.2,
    grudgeBias: 0.1,
    politicalSpread: 0.5,
  },

  /**
   * Political: Distributes damage, retaliates, targets the archenemy.
   * Spreads attacks, holds grudges, focuses on leading player.
   */
  Political: {
    boardDevelopment: 0.6,
    attackAggressiveness: 0.5,
    removalEagerness: 0.5,
    grudgeBias: 0.9,
    politicalSpread: 0.95,
  },

  /**
   * Balanced: Adapts to board state, plays "correctly".
   * Middle-of-the-road on all metrics.
   */
  Balanced: {
    boardDevelopment: 0.7,
    attackAggressiveness: 0.6,
    removalEagerness: 0.6,
    grudgeBias: 0.5,
    politicalSpread: 0.5,
  },
};

/**
 * Get the personality weights for a given personality type.
 */
export function getPersonalityWeights(personality: AIPersonality): PersonalityWeights {
  return PERSONALITY_WEIGHTS[personality];
}

/**
 * Get the default personality for a difficulty level.
 * Lower difficulties get more chaotic personalities.
 */
export function getDefaultPersonality(difficulty: number): AIPersonality {
  if (difficulty <= 2) {
    // Random between Aggressive and Greedy for low difficulty
    return Math.random() < 0.5 ? 'Aggressive' : 'Greedy';
  }
  if (difficulty === 3) {
    return 'Balanced';
  }
  if (difficulty === 4) {
    // Higher difficulty gets Political (smarter multiplayer)
    return Math.random() < 0.5 ? 'Political' : 'Balanced';
  }
  // Difficulty 5: fully Balanced (optimal play)
  return 'Balanced';
}

/**
 * Apply personality modifier to an action score.
 *
 * @param baseScore - Original evaluation score
 * @param actionType - Type of action being evaluated
 * @param weights - Personality weights to apply
 * @returns Modified score
 */
export function applyPersonalityModifier(
  baseScore: number,
  actionType: 'attack' | 'removal' | 'development' | 'pass',
  weights: PersonalityWeights,
): number {
  switch (actionType) {
    case 'attack':
      return baseScore * (0.5 + weights.attackAggressiveness * 0.5);
    case 'removal':
      return baseScore * (0.5 + weights.removalEagerness * 0.5);
    case 'development':
      return baseScore * (0.5 + weights.boardDevelopment * 0.5);
    case 'pass':
      // Greedy/development personalities slightly prefer passing to hold mana
      return baseScore * (1.0 + (1 - weights.boardDevelopment) * 0.2);
    default:
      return baseScore;
  }
}

/**
 * Determine if this personality should spread attacks across opponents.
 */
export function shouldSpreadAttacks(weights: PersonalityWeights): boolean {
  return Math.random() < weights.politicalSpread;
}

/**
 * Get the grudge multiplier for targeting a specific player.
 *
 * @param weights - Personality weights
 * @param grudgeLevel - How much this player has wronged us (0-1 scale)
 * @returns Multiplier for targeting priority (higher = more likely to target)
 */
export function getGrudgeMultiplier(
  weights: PersonalityWeights,
  grudgeLevel: number,
): number {
  // Grudge bias determines how much grudges affect decisions
  // At 0 bias, multiplier is always 1.0
  // At 1.0 bias with max grudge, multiplier is 2.0
  return 1.0 + (grudgeLevel * weights.grudgeBias);
}
