/**
 * Grudge Tracking System
 *
 * Tracks damage dealt between players to influence AI targeting decisions.
 * Enables political gameplay and retaliation behavior.
 */

import { GameState } from '../types';
import type { DamageRecord } from './types';

/**
 * Extended game state interface that includes grudge tracking.
 */
export interface GameStateWithGrudges extends GameState {
  damageHistory: DamageRecord[];
}

/**
 * Initialize grudge tracking in a game state.
 */
export function initGrudgeTracking(state: GameState): GameStateWithGrudges {
  return {
    ...state,
    damageHistory: [],
  };
}

/**
 * Check if state has grudge tracking enabled.
 */
export function hasGrudgeTracking(state: GameState): state is GameStateWithGrudges {
  return 'damageHistory' in state && Array.isArray((state as GameStateWithGrudges).damageHistory);
}

/**
 * Record damage dealt from one player to another.
 */
export function recordDamage(
  state: GameStateWithGrudges,
  sourcePlayerId: string,
  targetPlayerId: string,
  amount: number,
): GameStateWithGrudges {
  if (amount <= 0) return state;
  if (sourcePlayerId === targetPlayerId) return state;

  const record: DamageRecord = {
    sourcePlayerId,
    targetPlayerId,
    amount,
    turnNumber: state.turnNumber,
  };

  return {
    ...state,
    damageHistory: [...state.damageHistory, record],
  };
}

/**
 * Get total damage dealt from one player to another.
 */
export function getDamageDealt(
  state: GameStateWithGrudges,
  sourcePlayerId: string,
  targetPlayerId: string,
): number {
  return state.damageHistory
    .filter(r => r.sourcePlayerId === sourcePlayerId && r.targetPlayerId === targetPlayerId)
    .reduce((sum, r) => sum + r.amount, 0);
}

/**
 * Get recent damage dealt (within last N turns).
 */
export function getRecentDamageDealt(
  state: GameStateWithGrudges,
  sourcePlayerId: string,
  targetPlayerId: string,
  withinTurns: number = 3,
): number {
  const cutoffTurn = state.turnNumber - withinTurns;

  return state.damageHistory
    .filter(r =>
      r.sourcePlayerId === sourcePlayerId &&
      r.targetPlayerId === targetPlayerId &&
      r.turnNumber >= cutoffTurn
    )
    .reduce((sum, r) => sum + r.amount, 0);
}

/**
 * Calculate grudge level against a player (0-1 scale).
 * Higher value = more reason to retaliate.
 */
export function calculateGrudgeLevel(
  state: GameStateWithGrudges,
  fromPerspective: string,
  againstPlayer: string,
): number {
  // Weight recent damage more heavily
  const recentDamage = getRecentDamageDealt(state, againstPlayer, fromPerspective, 3);
  const totalDamage = getDamageDealt(state, againstPlayer, fromPerspective);

  // Get our current life for normalization
  const player = state.players.find(p => p.id === fromPerspective);
  const maxLife = 40;
  const currentLife = player?.life ?? maxLife;

  // Calculate normalized grudge
  // Recent damage is weighted 3x more than old damage
  const weightedDamage = recentDamage * 3 + (totalDamage - recentDamage);

  // Normalize against max life (40 damage = max grudge)
  let grudge = weightedDamage / (maxLife * 2);

  // Increase grudge if we're at low life (damage hurts more)
  if (currentLife < maxLife / 2) {
    grudge *= 1.5;
  }

  // Cap at 1.0
  return Math.min(1.0, grudge);
}

/**
 * Get the player who has dealt the most damage to us recently.
 */
export function getMostRecentAttacker(
  state: GameStateWithGrudges,
  playerId: string,
): string | null {
  const recentTurns = 3;
  const cutoffTurn = state.turnNumber - recentTurns;

  // Group damage by source
  const damageBySource: Record<string, number> = {};

  for (const record of state.damageHistory) {
    if (record.targetPlayerId !== playerId) continue;
    if (record.turnNumber < cutoffTurn) continue;

    damageBySource[record.sourcePlayerId] = (damageBySource[record.sourcePlayerId] ?? 0) + record.amount;
  }

  // Find max
  let maxDamage = 0;
  let maxSource: string | null = null;

  for (const [source, damage] of Object.entries(damageBySource)) {
    if (damage > maxDamage) {
      maxDamage = damage;
      maxSource = source;
    }
  }

  return maxSource;
}

/**
 * Get grudge levels against all opponents, sorted by grudge descending.
 */
export function getGrudgeRanking(
  state: GameStateWithGrudges,
  playerId: string,
): Array<{ playerId: string; grudgeLevel: number }> {
  const rankings: Array<{ playerId: string; grudgeLevel: number }> = [];

  for (const player of state.players) {
    if (player.id === playerId) continue;
    if (player.hasLost) continue;

    const grudgeLevel = calculateGrudgeLevel(state, playerId, player.id);
    rankings.push({ playerId: player.id, grudgeLevel });
  }

  return rankings.sort((a, b) => b.grudgeLevel - a.grudgeLevel);
}

/**
 * Determine if we should retaliate against a specific player.
 * Used by Political personality to decide attack targets.
 */
export function shouldRetaliate(
  state: GameStateWithGrudges,
  playerId: string,
  againstPlayer: string,
  threshold: number = 0.3,
): boolean {
  const grudgeLevel = calculateGrudgeLevel(state, playerId, againstPlayer);
  return grudgeLevel >= threshold;
}

/**
 * Get targeting priority adjustment based on grudges.
 * Higher value = more likely to target this player.
 */
export function getGrudgeTargetingBonus(
  state: GameStateWithGrudges,
  playerId: string,
  targetPlayer: string,
): number {
  const grudgeLevel = calculateGrudgeLevel(state, playerId, targetPlayer);

  // Return bonus between 0 and 0.5
  // At max grudge, adds 50% to targeting priority
  return grudgeLevel * 0.5;
}

/**
 * Prune old damage records to prevent unbounded growth.
 * Keeps records from the last N turns.
 */
export function pruneOldRecords(
  state: GameStateWithGrudges,
  keepTurns: number = 10,
): GameStateWithGrudges {
  const cutoffTurn = state.turnNumber - keepTurns;

  return {
    ...state,
    damageHistory: state.damageHistory.filter(r => r.turnNumber >= cutoffTurn),
  };
}
