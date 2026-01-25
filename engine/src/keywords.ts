// Phase 5: Keyword helpers
// Query and manage keywords on cards

import type { GameState, CardDefinition, CardInstance } from './types';

export type Keyword =
  | 'Flying'
  | 'Reach'
  | 'Trample'
  | 'Deathtouch'
  | 'First Strike'
  | 'Double Strike'
  | 'Lifelink'
  | 'Vigilance'
  | 'Haste'
  | 'Menace'
  | 'Defender'
  | 'Hexproof'
  | 'Shroud'
  | 'Indestructible'
  | 'Ward'
  | 'Flash';

// Normalize keyword strings for comparison
function normalizeKeyword(keyword: string): string {
  return keyword.toLowerCase().replace(/[\s_-]/g, '');
}

// Map from normalized keyword to canonical Keyword type
const KEYWORD_MAP: Record<string, Keyword> = {
  'flying': 'Flying',
  'reach': 'Reach',
  'trample': 'Trample',
  'deathtouch': 'Deathtouch',
  'firststrike': 'First Strike',
  'doublestrike': 'Double Strike',
  'lifelink': 'Lifelink',
  'vigilance': 'Vigilance',
  'haste': 'Haste',
  'menace': 'Menace',
  'defender': 'Defender',
  'hexproof': 'Hexproof',
  'shroud': 'Shroud',
  'indestructible': 'Indestructible',
  'ward': 'Ward',
  'flash': 'Flash',
};

/**
 * Check if a card definition has a specific keyword.
 */
export function hasKeyword(def: CardDefinition, keyword: Keyword): boolean {
  const normalizedTarget = normalizeKeyword(keyword);
  for (const k of def.keywords) {
    if (normalizeKeyword(k) === normalizedTarget) {
      return true;
    }
  }
  return false;
}

/**
 * Get all keywords for a card definition.
 */
export function getKeywordsFromDefinition(def: CardDefinition): Set<Keyword> {
  const result = new Set<Keyword>();
  for (const k of def.keywords) {
    const normalized = normalizeKeyword(k);
    const canonical = KEYWORD_MAP[normalized];
    if (canonical) {
      result.add(canonical);
    }
  }
  return result;
}

/**
 * Get all keywords for a card instance.
 * Currently just returns definition keywords, but will be extended
 * in later phases to include granted abilities from continuous effects.
 */
export function getKeywordsForInstance(state: GameState, instanceId: string): Set<Keyword> {
  const card = state.cards.get(instanceId);
  if (!card) return new Set();

  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return new Set();

  // Base keywords from definition
  const keywords = getKeywordsFromDefinition(def);

  // TODO (Phase 6+): Add keywords granted by continuous effects
  // This would involve checking state.continuousEffects for GrantAbility effects

  return keywords;
}

/**
 * Check if a card instance has a specific keyword.
 */
export function instanceHasKeyword(state: GameState, instanceId: string, keyword: Keyword): boolean {
  return getKeywordsForInstance(state, instanceId).has(keyword);
}

/**
 * Check if a creature can attack this turn (considering summoning sickness and haste).
 */
export function canAttackThisTurn(state: GameState, instanceId: string): boolean {
  const card = state.cards.get(instanceId);
  if (!card) return false;
  if (card.zone !== 'battlefield') return false;

  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return false;
  if (!def.card_types.includes('creature')) return false;

  // Check defender
  if (instanceHasKeyword(state, instanceId, 'Defender')) {
    return false;
  }

  // Check summoning sickness (haste ignores it)
  if (card.summoningSick && !instanceHasKeyword(state, instanceId, 'Haste')) {
    return false;
  }

  return true;
}

/**
 * Check if a creature should tap when attacking (vigilance prevents this).
 */
export function shouldTapWhenAttacking(state: GameState, instanceId: string): boolean {
  return !instanceHasKeyword(state, instanceId, 'Vigilance');
}

/**
 * Check if a creature can block another creature (considering flying/reach).
 */
export function canBlock(
  state: GameState,
  blockerId: string,
  attackerId: string,
): boolean {
  // Flying creatures can only be blocked by creatures with flying or reach
  if (instanceHasKeyword(state, attackerId, 'Flying')) {
    if (!instanceHasKeyword(state, blockerId, 'Flying') &&
        !instanceHasKeyword(state, blockerId, 'Reach')) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a blocker assignment satisfies menace (needs 2+ blockers).
 * Returns true if the attacker doesn't have menace, or if blocked by 2+ creatures.
 */
export function satisfiesMenace(
  state: GameState,
  attackerId: string,
  blockerIds: string[],
): boolean {
  if (!instanceHasKeyword(state, attackerId, 'Menace')) {
    return true; // No menace, any number of blockers is fine
  }
  // Menace requires 2+ blockers or 0 blockers (unblocked)
  return blockerIds.length === 0 || blockerIds.length >= 2;
}

/**
 * Check if damage from a source is lethal to a creature (considering deathtouch).
 */
export function isLethalDamage(
  state: GameState,
  sourceId: string,
  targetId: string,
  damageAmount: number,
): boolean {
  const target = state.cards.get(targetId);
  if (!target) return false;

  const def = state.cardDefinitions.get(target.definitionId);
  if (!def) return false;
  if (!def.card_types.includes('creature')) return false;

  const toughness = def.toughness ?? 0;
  const currentDamage = target.damage;

  // Deathtouch: any positive damage is lethal
  if (instanceHasKeyword(state, sourceId, 'Deathtouch') && damageAmount > 0) {
    return true;
  }

  // Normal lethal damage check
  return currentDamage + damageAmount >= toughness;
}

/**
 * Check if a permanent is a valid target for an opponent's spell/ability.
 * Returns false if the permanent has hexproof or shroud.
 */
export function canBeTargetedByOpponent(state: GameState, permanentId: string): boolean {
  if (instanceHasKeyword(state, permanentId, 'Shroud')) {
    return false;
  }
  if (instanceHasKeyword(state, permanentId, 'Hexproof')) {
    return false;
  }
  return true;
}

/**
 * Check if a permanent is a valid target for its controller's spell/ability.
 * Returns false only if the permanent has shroud (hexproof allows self-targeting).
 */
export function canBeTargetedByController(state: GameState, permanentId: string): boolean {
  if (instanceHasKeyword(state, permanentId, 'Shroud')) {
    return false;
  }
  return true;
}

/**
 * Check if a creature is indestructible.
 */
export function isIndestructible(state: GameState, instanceId: string): boolean {
  return instanceHasKeyword(state, instanceId, 'Indestructible');
}
