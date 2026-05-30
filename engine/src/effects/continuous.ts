/**
 * Phase 15: Continuous Effects Layer System
 *
 * Handles static/continuous abilities that apply as long as their source
 * is on the battlefield. These are recalculated every time game state is queried.
 *
 * MTG Layer system (simplified):
 *   Layer 1: Copy effects
 *   Layer 2: Control-changing effects
 *   Layer 3: Text-changing effects
 *   Layer 4: Type-changing effects
 *   Layer 5: Color-changing effects
 *   Layer 6: Ability-adding/removing effects
 *   Layer 7: P/T modifications
 *     7a: Characteristic-defining abilities
 *     7b: Set P/T
 *     7c: Modify P/T (static abilities like "creatures you control get +1/+1")
 *     7d: Counters
 *     7e: Switching P/T
 *
 * This implementation focuses on layers 6 (keyword grants) and 7c (P/T mods).
 */

import type { GameState, CardInstance, CardDefinition } from '../types';
import type { StaticAbilityEffect, CardFilter } from './ast';
import { matchesCardFilter } from './executor';
import { getCardDefinition } from '../game-state';

// ============================================================================
// Continuous Effect Registration
// ============================================================================

/**
 * A registered continuous effect from a permanent on the battlefield.
 */
export interface ContinuousEffect {
  id: string;
  sourceInstanceId: string;
  controllerId: string;
  ability: StaticAbilityEffect;
  timestamp: number; // for ordering within the same layer
}

// Global timestamp counter for ordering
let continuousTimestamp = 0;

/**
 * Reset timestamp counter (for testing).
 */
export function resetContinuousTimestamp(): void {
  continuousTimestamp = 0;
}

/**
 * Register a continuous effect when a permanent with a static ability
 * enters the battlefield.
 */
export function registerContinuousEffect(
  state: GameState,
  sourceInstanceId: string,
  controllerId: string,
  ability: StaticAbilityEffect,
): GameState {
  const effect: ContinuousEffect = {
    id: `ce_${++continuousTimestamp}`,
    sourceInstanceId,
    controllerId,
    ability,
    timestamp: continuousTimestamp,
  };

  const newEffects = [...(state.continuousEffects || []), effect];
  return { ...state, continuousEffects: newEffects };
}

/**
 * Unregister all continuous effects from a specific source permanent
 * (e.g., when it leaves the battlefield).
 */
export function unregisterContinuousEffects(
  state: GameState,
  sourceInstanceId: string,
): GameState {
  const effects = state.continuousEffects || [];
  const newEffects = effects.filter(e => e.sourceInstanceId !== sourceInstanceId);
  return { ...state, continuousEffects: newEffects };
}

// ============================================================================
// Continuous Effect Queries (Layer System)
// ============================================================================

/**
 * Check if a card instance on the battlefield is affected by a continuous effect.
 */
function isAffectedBy(
  effect: ContinuousEffect,
  card: CardInstance,
  def: CardDefinition,
  state: GameState,
): boolean {
  const ability = effect.ability;

  if (ability.selfOnly && card.instanceId !== effect.sourceInstanceId) {
    return false;
  }

  // Check controller filter
  if (!ability.selfOnly && ability.controller === 'you' && card.ownerId !== effect.controllerId) {
    return false;
  }
  if (!ability.selfOnly && ability.controller === 'opponent' && card.ownerId === effect.controllerId) {
    return false;
  }

  // Check excludeSelf (for "Other creatures you control...")
  if (ability.excludeSelf && card.instanceId === effect.sourceInstanceId) {
    return false;
  }

  // Must be on the battlefield
  if (card.zone !== 'battlefield') {
    return false;
  }

  // Check card filter
  if (ability.filter.types || ability.filter.subtypes || ability.filter.colors || ability.filter.cmc || ability.filter.power) {
    return matchesCardFilter(def, ability.filter);
  }

  // No filter = matches all permanents
  return true;
}

function isLegendaryPermanentDefinition(def: CardDefinition): boolean {
  const typeLine = def.type_line.toLowerCase();
  const isPermanent = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']
    .some(type => def.card_types.includes(type as CardDefinition['card_types'][number]) || typeLine.includes(type));
  return isPermanent && typeLine.includes('legendary');
}

function uniqueColorsAmongOtherLegendaryPermanentsYouControl(
  state: GameState,
  controllerId: string,
  sourceInstanceId: string,
): number {
  const colors = new Set(['W', 'U', 'B', 'R', 'G'] as const);
  const seen = new Set<string>();

  for (const [, card] of state.cards) {
    if (card.instanceId === sourceInstanceId) continue;
    if (card.ownerId !== controllerId || card.zone !== 'battlefield') continue;

    const def = getCardDefinition(state, card);
    if (!isLegendaryPermanentDefinition(def)) continue;

    for (const color of def.colors) {
      if (colors.has(color as 'W' | 'U' | 'B' | 'R' | 'G')) {
        seen.add(color);
      }
    }
  }

  return seen.size;
}

/**
 * Get the total P/T modification for a card instance from all continuous effects.
 * This implements Layer 7c of the MTG layer system.
 */
export function getContinuousPTModification(
  state: GameState,
  instanceId: string,
): { power: number; toughness: number } {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') {
    return { power: 0, toughness: 0 };
  }

  const def = getCardDefinition(state, card);

  let powerMod = 0;
  let toughnessMod = 0;

  const effects = state.continuousEffects || [];
  // Sort by timestamp for consistent ordering within the same layer
  const sorted = [...effects].sort((a, b) => a.timestamp - b.timestamp);

  for (const effect of sorted) {
    // Check that the source is still on the battlefield
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    if (isAffectedBy(effect, card, def, state)) {
      if (effect.ability.modifier.kind === 'ModifyPT') {
        powerMod += effect.ability.modifier.power;
        toughnessMod += effect.ability.modifier.toughness;
      } else if (effect.ability.modifier.kind === 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl') {
        const colorCount = uniqueColorsAmongOtherLegendaryPermanentsYouControl(
          state,
          effect.controllerId,
          effect.sourceInstanceId,
        );
        powerMod += colorCount * effect.ability.modifier.powerPerColor;
        toughnessMod += colorCount * effect.ability.modifier.toughnessPerColor;
      }
    }
  }

  return { power: powerMod, toughness: toughnessMod };
}

/**
 * Get the total equipment P/T bonus for a creature instance.
 * Uses cached equipmentBonus data from CardDefinition.
 */
function getEquipmentPTBonus(state: GameState, instanceId: string): { power: number; toughness: number } {
  let power = 0, toughness = 0;
  for (const [, otherCard] of state.cards) {
    if (otherCard.attachedTo !== instanceId || otherCard.zone !== 'battlefield') continue;
    const equipDef = getCardDefinition(state, otherCard);
    if (!equipDef?.equipmentBonus) continue;
    power += equipDef.equipmentBonus.power;
    toughness += equipDef.equipmentBonus.toughness;
  }
  return { power, toughness };
}

/**
 * Get the effective power of a creature, including continuous effects, counters, and equipment.
 */
export function getEffectivePower(state: GameState, instanceId: string): number {
  const card = state.cards.get(instanceId);
  if (!card) return 0;

  const def = getCardDefinition(state, card);
  if (def.power === undefined) return 0;

  const basePower = def.power;
  const counterMod = (card.counters['+1/+1'] || 0) - (card.counters['-1/-1'] || 0);
  const tempMod = card.counters['_powerMod'] || 0;
  const continuous = getContinuousPTModification(state, instanceId);
  const equipmentBonus = getEquipmentPTBonus(state, instanceId);

  return basePower + counterMod + tempMod + continuous.power + equipmentBonus.power;
}

/**
 * Get the effective toughness of a creature, including continuous effects, counters, and equipment.
 */
export function getEffectiveToughness(state: GameState, instanceId: string): number {
  const card = state.cards.get(instanceId);
  if (!card) return 0;

  const def = getCardDefinition(state, card);
  if (def.toughness === undefined) return 0;

  const baseToughness = def.toughness;
  const counterMod = (card.counters['+1/+1'] || 0) - (card.counters['-1/-1'] || 0);
  const tempMod = card.counters['_toughnessMod'] || 0;
  const continuous = getContinuousPTModification(state, instanceId);
  const equipmentBonus = getEquipmentPTBonus(state, instanceId);

  return baseToughness + counterMod + tempMod + continuous.toughness + equipmentBonus.toughness;
}

/**
 * Get all keywords granted to a card instance by continuous effects.
 * This implements Layer 6 of the MTG layer system.
 */
export function getGrantedKeywords(
  state: GameState,
  instanceId: string,
): string[] {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') {
    return [];
  }

  const def = getCardDefinition(state, card);

  const keywords: string[] = [];
  const effects = state.continuousEffects || [];
  const sorted = [...effects].sort((a, b) => a.timestamp - b.timestamp);

  for (const effect of sorted) {
    if (effect.ability.modifier.kind !== 'GrantKeyword') continue;

    // Check that the source is still on the battlefield
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    if (isAffectedBy(effect, card, def, state)) {
      keywords.push(effect.ability.modifier.keyword);
    }
  }

  return keywords;
}

/**
 * Get the total cost reduction for spells cast by a player from continuous effects.
 */
export function getCostReduction(
  state: GameState,
  casterId: string,
  spellDef?: CardDefinition,
): number {
  let reduction = 0;

  const effects = state.continuousEffects || [];
  for (const effect of effects) {
    if (effect.ability.modifier.kind !== 'ReduceCost') continue;
    if (effect.ability.controller === 'you' && effect.controllerId !== casterId) continue;
    if (effect.ability.controller === 'opponent' && effect.controllerId === casterId) continue;

    // Check that the source is still on the battlefield
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // If there's a filter, check against the spell being cast
    if (spellDef && (
      effect.ability.filter.types
      || effect.ability.filter.subtypes
      || effect.ability.filter.colors
      || effect.ability.filter.cmc
      || effect.ability.filter.power
    )) {
      if (!matchesCardFilter(spellDef, effect.ability.filter)) continue;
    }

    reduction += effect.ability.modifier.amount;
  }

  return reduction;
}

// ============================================================================
// Conditional Effect Evaluation
// ============================================================================

import type { Condition } from './ast';

/**
 * Evaluate a condition against the current game state.
 */
export function evaluateCondition(
  state: GameState,
  condition: Condition,
  controllerId: string,
): boolean {
  switch (condition.kind) {
    case 'ControlsType': {
      const playerId = condition.controller === 'you' ? controllerId :
        state.players.find(p => p.id !== controllerId && !p.hasLost)?.id;
      if (!playerId) return false;

      for (const [, card] of state.cards) {
        if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
        const def = getCardDefinition(state, card);
        if (matchesCardFilter(def, condition.filter)) return true;
      }
      return false;
    }

    case 'ControlsMoreThan': {
      // Count what opponents control
      let opponentCount = 0;
      let yourCount = 0;

      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        const def = getCardDefinition(state, card);
        if (!matchesCardFilter(def, condition.what)) continue;

        if (card.ownerId === controllerId) {
          yourCount++;
        } else {
          opponentCount++;
        }
      }

      // "opponent controls more than you" — any single opponent
      // For simplicity, check total opponent count vs yours
      return opponentCount > yourCount;
    }

    case 'LifeAtOrBelow': {
      const player = condition.controller === 'you'
        ? state.players.find(p => p.id === controllerId)
        : state.players.find(p => p.id !== controllerId && !p.hasLost);
      if (!player) return false;
      return player.life <= condition.amount;
    }

    case 'LifeAtOrAbove': {
      const player = condition.controller === 'you'
        ? state.players.find(p => p.id === controllerId)
        : state.players.find(p => p.id !== controllerId && !p.hasLost);
      if (!player) return false;
      return player.life >= condition.amount;
    }

    default: {
      const _never: never = condition;
      return false;
    }
  }
}
