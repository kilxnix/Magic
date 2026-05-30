/**
 * AI Target Selection Helpers
 *
 * Heuristics for choosing targets when casting spells or activating abilities.
 */

import { GameState, CardInstance, Player } from '../types';
import { getCardsInZone, getCardDefinition } from '../game-state';
import type { TargetSpec } from '../effects/targets';
import { evaluateCreature } from './evaluate';
import { getLegalTargets } from './legal-actions';

/**
 * Result of target selection with reasoning.
 */
export interface TargetSelection {
  targets: string[];
  reasoning: string;
}

/**
 * Score a creature as a removal target.
 * Higher scores = better target for removal.
 */
export function scoreRemovalTarget(
  state: GameState,
  card: CardInstance,
  casterId: string,
): number {
  // Don't target own creatures with removal
  if (card.ownerId === casterId) return -1000;

  let score = evaluateCreature(state, card);

  // Bonus for high-threat keywords
  const def = getCardDefinition(state, card);

  // Extra dangerous keywords
  if (def.keywords.includes('Indestructible')) score *= 1.5;
  if (def.keywords.includes('Hexproof')) score *= 0.5; // Can't actually target, but as a heuristic...
  if (def.keywords.includes('Flying')) score *= 1.2;
  if (def.keywords.includes('Deathtouch')) score *= 1.3;
  if (def.keywords.includes('Double Strike')) score *= 1.4;

  // Commander is a high-priority target
  if (card.isCommander) {
    score *= 2;
  }

  return score;
}

/**
 * Score a player as a damage target.
 * Higher scores = better target for damage.
 */
export function scoreDamageTarget(
  state: GameState,
  player: Player,
  casterId: string,
  damageAmount: number,
): number {
  // Don't damage self (usually)
  if (player.id === casterId) return -1000;

  // Can't damage eliminated players
  if (player.hasLost) return -1000;

  // Base score: dealing damage to opponents is inherently good
  let score = damageAmount * 0.5;

  // Prefer players closer to death (can potentially eliminate them)
  if (player.life <= damageAmount) {
    score += 100; // Lethal damage is very valuable
  }

  // Prefer lower life totals generally
  score += (40 - player.life) * 0.5;

  // In multiplayer, sometimes target the leading player
  // For now, just use life as the metric

  return score;
}

/**
 * Score a creature as a damage target.
 * Returns score for dealing damage to this creature.
 */
export function scoreCreatureDamageTarget(
  state: GameState,
  card: CardInstance,
  casterId: string,
  damageAmount: number,
): number {
  // Don't damage own creatures
  if (card.ownerId === casterId) return -1000;

  const def = getCardDefinition(state, card);
  const toughness = def.toughness ?? 0;
  const currentDamage = card.damage;
  const remainingToughness = toughness - currentDamage;

  // Can we kill it?
  const wouldDie = damageAmount >= remainingToughness;

  let score = 0;

  if (wouldDie) {
    // Value of killing the creature
    score += evaluateCreature(state, card);

    // Bonus for efficient kills (using just enough damage)
    const overkill = damageAmount - remainingToughness;
    score -= overkill * 0.1; // Small penalty for wasted damage
  } else {
    // Partial damage is less valuable
    score += damageAmount * 0.2;
  }

  return score;
}

/**
 * Select the best removal targets.
 */
export function selectRemovalTargets(
  state: GameState,
  casterId: string,
  spec: TargetSpec,
): TargetSelection {
  const legalTargets = getLegalTargets(state, casterId, spec);

  if (legalTargets.length === 0) {
    return { targets: [], reasoning: 'No legal targets' };
  }

  // Score all creature targets
  const scored: { id: string; score: number }[] = [];

  for (const targetId of legalTargets) {
    const card = state.cards.get(targetId);
    if (!card) continue;

    const score = scoreRemovalTarget(state, card, casterId);
    scored.push({ id: targetId, score });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take the top N based on spec.count
  const selectedTargets = scored.slice(0, spec.count).map(s => s.id);

  if (selectedTargets.length === 0 || scored[0].score < 0) {
    return { targets: [], reasoning: 'No good removal targets' };
  }

  const topTarget = state.cards.get(selectedTargets[0]);
  const topDef = topTarget ? getCardDefinition(state, topTarget) : null;

  return {
    targets: selectedTargets,
    reasoning: `Target ${topDef?.name ?? 'creature'} (score: ${scored[0].score.toFixed(1)})`,
  };
}

/**
 * Select the best damage targets.
 */
export function selectDamageTargets(
  state: GameState,
  casterId: string,
  spec: TargetSpec,
  damageAmount: number,
): TargetSelection {
  const legalTargets = getLegalTargets(state, casterId, spec);

  if (legalTargets.length === 0) {
    return { targets: [], reasoning: 'No legal targets' };
  }

  const scored: { id: string; score: number; isPlayer: boolean }[] = [];

  for (const targetId of legalTargets) {
    // Check if it's a player
    const player = state.players.find(p => p.id === targetId);
    if (player) {
      const score = scoreDamageTarget(state, player, casterId, damageAmount);
      scored.push({ id: targetId, score, isPlayer: true });
      continue;
    }

    // It's a creature
    const card = state.cards.get(targetId);
    if (card) {
      const score = scoreCreatureDamageTarget(state, card, casterId, damageAmount);
      scored.push({ id: targetId, score, isPlayer: false });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Take the top N
  const selectedTargets = scored.slice(0, spec.count).map(s => s.id);

  if (selectedTargets.length === 0 || scored[0].score < 0) {
    return { targets: [], reasoning: 'No good damage targets' };
  }

  const top = scored[0];
  let reasoning: string;

  if (top.isPlayer) {
    const player = state.players.find(p => p.id === top.id);
    reasoning = `Target ${player?.name ?? 'player'} for ${damageAmount} damage`;
  } else {
    const card = state.cards.get(top.id);
    const def = card ? getCardDefinition(state, card) : null;
    reasoning = `Target ${def?.name ?? 'creature'} for ${damageAmount} damage`;
  }

  return { targets: selectedTargets, reasoning };
}

/**
 * Select targets for a spell based on spell type heuristics.
 *
 * This is a general-purpose selector that tries to determine
 * the intent of the spell from its oracle text.
 */
export function selectTargetsForSpell(
  state: GameState,
  casterId: string,
  cardInstanceId: string,
  specs: TargetSpec[],
): TargetSelection {
  if (specs.length === 0) {
    return { targets: [], reasoning: 'No targets required' };
  }

  const card = state.cards.get(cardInstanceId);
  if (!card) {
    return { targets: [], reasoning: 'Card not found' };
  }

  const def = getCardDefinition(state, card);
  const oracleText = def.oracle_text.toLowerCase();

  const allTargets: string[] = [];
  const reasonings: string[] = [];

  for (const spec of specs) {
    let selection: TargetSelection;

    // Determine spell intent from oracle text
    if (oracleText.includes('destroy') ||
        oracleText.includes('exile') ||
        oracleText.includes('sacrifice')) {
      // Removal spell
      selection = selectRemovalTargets(state, casterId, spec);
    } else if (oracleText.includes('damage')) {
      // Damage spell - estimate damage from CMC or text
      const damageMatch = oracleText.match(/(\d+) damage/);
      const damage = damageMatch ? parseInt(damageMatch[1]) : def.cmc;
      selection = selectDamageTargets(state, casterId, spec, damage);
    } else if (spec.type === 'Creature' && spec.constraints?.opponentControls) {
      // Targets opponent creature, probably removal
      selection = selectRemovalTargets(state, casterId, spec);
    } else {
      // Default: just pick the first legal target
      const legalTargets = getLegalTargets(state, casterId, spec);
      if (legalTargets.length > 0) {
        selection = {
          targets: legalTargets.slice(0, spec.count),
          reasoning: 'Default target selection',
        };
      } else {
        selection = { targets: [], reasoning: 'No legal targets' };
      }
    }

    allTargets.push(...selection.targets);
    reasonings.push(selection.reasoning);
  }

  return {
    targets: allTargets,
    reasoning: reasonings.join('; '),
  };
}

/**
 * Select the best opponent to attack in multiplayer.
 */
export function selectBestAttackTarget(
  state: GameState,
  attackerId: string,
): string | null {
  const attacker = state.cards.get(attackerId);
  if (!attacker) return null;

  const attackerDef = getCardDefinition(state, attacker);
  const power = attackerDef.power ?? 0;

  let bestTarget: string | null = null;
  let bestScore = -Infinity;

  for (const player of state.players) {
    // Skip self and eliminated players
    if (player.id === attacker.ownerId) continue;
    if (player.hasLost) continue;

    let score = 0;

    // Prefer players we can kill
    if (player.life <= power) {
      score += 100;
    }

    // Prefer lower life
    score += (40 - player.life);

    // Prefer players with fewer blockers
    const theirCreatures = getCardsInZone(state, player.id, 'battlefield').filter(c => {
      const def = getCardDefinition(state, c);
      return def.card_types.includes('creature') && !c.tapped;
    });
    score -= theirCreatures.length * 2;

    // Commander damage considerations
    if (attacker.isCommander) {
      const existingDamage = player.commanderDamage[attackerId] ?? 0;
      if (existingDamage + power >= 21) {
        score += 150; // Lethal commander damage
      } else {
        score += existingDamage * 0.5; // Progress toward commander kill
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = player.id;
    }
  }

  return bestTarget;
}
