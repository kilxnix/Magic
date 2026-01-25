/**
 * Threat Assessment
 *
 * Evaluates how threatening each player is in a multiplayer Commander game.
 * Used to focus removal and attacks on the appropriate targets.
 */

import { GameState, Player, CardInstance } from '../types';
import { getCardsInZone, getCardDefinition } from '../game-state';
import type { ThreatAssessment } from './types';

// Scoring constants
const LIFE_FACTOR = 0.5;
const CREATURE_POWER_FACTOR = 1.5;
const CREATURE_COUNT_FACTOR = 2;
const CARDS_IN_HAND_FACTOR = 1;
const COMMANDER_DAMAGE_DEALT_FACTOR = 3;
const COMMANDER_ON_FIELD_BONUS = 5;
const MANA_AVAILABLE_FACTOR = 0.5;

/**
 * Calculate the total power of creatures on a player's battlefield.
 */
function calculateBoardPower(state: GameState, playerId: string): number {
  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  let totalPower = 0;

  for (const card of battlefield) {
    const def = getCardDefinition(state, card);
    if (def.card_types.includes('creature')) {
      totalPower += def.power ?? 0;
    }
  }

  return totalPower;
}

/**
 * Count creatures on a player's battlefield.
 */
function countCreatures(state: GameState, playerId: string): number {
  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  return battlefield.filter(card => {
    const def = getCardDefinition(state, card);
    return def.card_types.includes('creature');
  }).length;
}

/**
 * Calculate total commander damage dealt by this player to all opponents.
 */
function totalCommanderDamageDealt(state: GameState, playerId: string): number {
  const player = state.players.find(p => p.id === playerId);
  if (!player?.commanderInstanceId) return 0;

  let totalDealt = 0;
  for (const opponent of state.players) {
    if (opponent.id === playerId) continue;
    const damage = opponent.commanderDamage[player.commanderInstanceId] ?? 0;
    totalDealt += damage;
  }

  return totalDealt;
}

/**
 * Check if player's commander is on the battlefield.
 */
function isCommanderOnBattlefield(state: GameState, playerId: string): boolean {
  const player = state.players.find(p => p.id === playerId);
  if (!player?.commanderInstanceId) return false;

  const commander = state.cards.get(player.commanderInstanceId);
  return commander?.zone === 'battlefield';
}

/**
 * Count untapped lands (available mana).
 */
function countAvailableMana(state: GameState, playerId: string): number {
  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  return battlefield.filter(card => {
    const def = getCardDefinition(state, card);
    return def.card_types.includes('land') && !card.tapped;
  }).length;
}

/**
 * Assess the threat level of a single player.
 */
export function assessPlayerThreat(
  state: GameState,
  playerId: string,
  fromPerspective: string,
): ThreatAssessment {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.hasLost) {
    return { playerId, threatScore: 0, reasons: ['Player eliminated'] };
  }

  if (playerId === fromPerspective) {
    return { playerId, threatScore: 0, reasons: ['Self'] };
  }

  let score = 0;
  const reasons: string[] = [];

  // Life total: higher life = more staying power = more threatening
  const lifeScore = player.life * LIFE_FACTOR;
  score += lifeScore;
  if (player.life >= 35) {
    reasons.push(`High life (${player.life})`);
  }

  // Board presence: creatures and their power
  const boardPower = calculateBoardPower(state, playerId);
  const creatureCount = countCreatures(state, playerId);

  const powerScore = boardPower * CREATURE_POWER_FACTOR;
  const countScore = creatureCount * CREATURE_COUNT_FACTOR;
  score += powerScore + countScore;

  if (boardPower >= 10) {
    reasons.push(`Strong board (${boardPower} power)`);
  }
  if (creatureCount >= 4) {
    reasons.push(`Many creatures (${creatureCount})`);
  }

  // Cards in hand: more options = more threatening
  const hand = getCardsInZone(state, playerId, 'hand');
  const handScore = hand.length * CARDS_IN_HAND_FACTOR;
  score += handScore;

  if (hand.length >= 5) {
    reasons.push(`Full hand (${hand.length} cards)`);
  }

  // Commander damage dealt: shows aggression and progress toward wins
  const cmdDamage = totalCommanderDamageDealt(state, playerId);
  const cmdScore = cmdDamage * COMMANDER_DAMAGE_DEALT_FACTOR;
  score += cmdScore;

  if (cmdDamage >= 10) {
    reasons.push(`Commander damage dealt (${cmdDamage})`);
  }

  // Commander on battlefield: can deal more commander damage
  if (isCommanderOnBattlefield(state, playerId)) {
    score += COMMANDER_ON_FIELD_BONUS;
    reasons.push('Commander on battlefield');
  }

  // Available mana: can respond or cast threats
  const manaAvailable = countAvailableMana(state, playerId);
  const manaScore = manaAvailable * MANA_AVAILABLE_FACTOR;
  score += manaScore;

  if (manaAvailable >= 5) {
    reasons.push(`Open mana (${manaAvailable})`);
  }

  if (reasons.length === 0) {
    reasons.push('Baseline threat');
  }

  return { playerId, threatScore: score, reasons };
}

/**
 * Assess all opponents and return sorted by threat level (highest first).
 */
export function assessAllThreats(
  state: GameState,
  fromPerspective: string,
): ThreatAssessment[] {
  const assessments: ThreatAssessment[] = [];

  for (const player of state.players) {
    if (player.id === fromPerspective) continue;
    if (player.hasLost) continue;

    const assessment = assessPlayerThreat(state, player.id, fromPerspective);
    assessments.push(assessment);
  }

  // Sort by threat score descending
  return assessments.sort((a, b) => b.threatScore - a.threatScore);
}

/**
 * Get the archenemy (highest threat player).
 */
export function getArchenemy(
  state: GameState,
  fromPerspective: string,
): ThreatAssessment | null {
  const threats = assessAllThreats(state, fromPerspective);
  return threats.length > 0 ? threats[0] : null;
}

/**
 * Check if a player is significantly ahead (archenemy).
 * Returns true if the top threat is at least 50% higher than the next.
 */
export function hasArchenemy(
  state: GameState,
  fromPerspective: string,
): boolean {
  const threats = assessAllThreats(state, fromPerspective);
  if (threats.length < 2) return false;

  const top = threats[0].threatScore;
  const second = threats[1].threatScore;

  // Archenemy if top is 50% higher than second
  return top > second * 1.5;
}

/**
 * Get the threat level normalized to 0-1 scale.
 * Useful for blending threat into scoring.
 */
export function getNormalizedThreat(
  state: GameState,
  playerId: string,
  fromPerspective: string,
): number {
  const threats = assessAllThreats(state, fromPerspective);
  const maxThreat = threats.length > 0 ? threats[0].threatScore : 1;

  const assessment = threats.find(t => t.playerId === playerId);
  if (!assessment) return 0;

  return maxThreat > 0 ? assessment.threatScore / maxThreat : 0;
}
