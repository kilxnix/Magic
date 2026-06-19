/**
 * Phase 15: Continuous Effects Layer System
 *
 * Handles static/continuous abilities that apply as long as their source
 * is on the battlefield. These are recalculated every time game state is queried.
 *
 * MTG Layer system implemented in focused passes:
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
import type { StaticAbilityEffect, CardFilter, ForEachAmount } from './ast';
import { matchesCardFilter } from './executor';
import { getCardDefinition } from '../game-state';
import { isOwnersCommander } from '../commander';
import { typeLineHasSupertype, typeLineHasType, typeLineHasSubtype, typeLineSectionTerms } from '../type-line';
import { countDevotionToColors } from '../effective-types';

// ============================================================================
// Layer-7a CDA helpers
// ============================================================================

/**
 * Count entities matching a ForEachAmount for use in a layer-7a CDA.
 * This is a local, limited version of the executor's resolveForEachCount,
 * restricted to the supported CDA forms (battlefield / graveyard / library,
 * "you control" / "in your graveyard" zone phrases).  We cannot import from
 * executor.ts because executor.ts already imports from continuous.ts
 * (getEffectivePower / getEffectiveToughness), which would create a circular
 * dependency.
 */
function countForEachCDA(
  forEach: ForEachAmount,
  state: GameState,
  controllerId: string,
  sourceInstanceId?: string,
): number {
  let count = 0;
  const { zone, filter, controller } = forEach;

  // Slice 9: resolve namesSelf → build a names filter from the source card's name.
  let resolvedFilter = filter;
  if (filter?.namesSelf) {
    const sourceCard = sourceInstanceId ? state.cards.get(sourceInstanceId) : undefined;
    const sourceDef = sourceCard ? getCardDefinition(state, sourceCard) : undefined;
    if (!sourceDef) return 0;
    const { namesSelf: _, ...rest } = filter;
    resolvedFilter = { ...rest, names: [sourceDef.name] };
  }

  const ownerIds: string[] = controller === 'you'
    ? [controllerId]
    : controller === 'opponent'
      ? state.players.filter(p => !p.hasLost && p.id !== controllerId).map(p => p.id)
      : state.players.filter(p => !p.hasLost).map(p => p.id);

  // Slice 13 (CDA-companion): "GrantLandSubtype" effects — Ashaya-family statics
  // make nontoken creatures count as lands (or a specific land subtype) for CDA
  // counting purposes. Collect the set of GrantLandSubtype effects active in state
  // so we can check whether non-land instances qualify via a granted subtype.
  const grantLandEffects = (state.continuousEffects ?? []).filter(
    ce => ce.ability.modifier.kind === 'GrantLandSubtype',
  );

  const alreadyCounted = new Set<string>();

  for (const [, card] of state.cards) {
    if (card.zone !== zone) continue;
    if (!ownerIds.includes(card.ownerId)) continue;
    if (resolvedFilter) {
      const def = getCardDefinition(state, card);
      if (!matchesCardFilter(def, resolvedFilter)) {
        // Slice 13: the filter may ask for lands/a land-subtype. If so, also
        // check whether a GrantLandSubtype continuous effect applies to this
        // instance (treating it as a land with that subtype for count purposes).
        const filterAsksForLand = resolvedFilter.types?.includes('land') ?? false;
        if (filterAsksForLand && !alreadyCounted.has(card.instanceId)) {
          const wantedSubtype = resolvedFilter.subtypes?.[0]?.toLowerCase() ?? null;
          for (const grantEffect of grantLandEffects) {
            const grantMod = grantEffect.ability.modifier as { kind: 'GrantLandSubtype'; subtype: string };
            // Subtype must match (or filter asks for any land and we accept any grant)
            if (wantedSubtype !== null && grantMod.subtype.toLowerCase() !== wantedSubtype) continue;
            // Check whether the instance is affected by this grant
            const grantDef = getCardDefinition(state, card);
            if (isAffectedBy(grantEffect, card, grantDef, state)) {
              alreadyCounted.add(card.instanceId);
              count++;
              break;
            }
          }
        }
        continue;
      }
    }
    if (!alreadyCounted.has(card.instanceId)) {
      count++;
    }
  }
  return count;
}

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

  // Aura/Equipment "Enchanted/Equipped creature gets..." statics are applied via
  // the cached equipmentBonus path; skip them here so they don't double-apply.
  if (ability.attachedOnly) {
    return false;
  }

  // Conditional statics ("As long as <condition>, ..."): the modifier applies
  // only while the condition holds for the source's controller.
  if (ability.condition
      && !evaluateCondition(state, ability.condition, effect.controllerId, effect.sourceInstanceId)) {
    return false;
  }

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

  // Slice 2: combat-status filters — "Attacking creatures [you control] get …"
  // and "Blocking creatures [you control] get …". Only apply during combat when
  // state.combat exists; outside combat the modifier never fires.
  if (ability.filter.attacking) {
    if (!state.combat) return false;
    const isAttacker = state.combat.attackers.some(a => a.cardInstanceId === card.instanceId);
    if (!isAttacker) return false;
  }
  if (ability.filter.blocking) {
    if (!state.combat) return false;
    const isBlocker = state.combat.blockers.some(b => b.cardInstanceId === card.instanceId);
    if (!isBlocker) return false;
  }

  // Slice 8: tapped/untapped status filter — "Other tapped creatures you control
  // have deathtouch" / "Other untapped creatures you control have hexproof."
  // The `tapped` field is defined on CardFilter; we evaluate it against the live
  // instance state here (continuous re-evaluates at query time, so tap-state
  // changes are reflected immediately). `undefined` means no tapped filter.
  if (ability.filter.tapped !== undefined) {
    if (ability.filter.tapped !== card.tapped) return false;
  }

  // Check card filter
  if (
    ability.filter.types
    || ability.filter.excludeTypes
    || ability.filter.subtypes
    || ability.filter.colors
    || ability.filter.cmc
    || ability.filter.power
    || ability.filter.chosenCreatureTypeFromSource
    || ability.filter.chosenColorFromSource
    || ability.filter.chosenCardTypeFromSource
    || ability.filter.withKeyword
    || ability.filter.withoutKeyword
  ) {
    // Slice 8: keyword-holder filter — check withKeyword using instance-level data
    // (printed def.keywords + one-shot grantedKeywords + continuous effects) to
    // correctly handle continuously-granted keywords (e.g. a creature granted
    // Flying by another anthem should still qualify).
    // We avoid importing from keywords.ts (cycle risk: keywords.ts already imports
    // evaluateCondition from this file), so we inline the check here.
    if (ability.filter.withKeyword) {
      const norm = ability.filter.withKeyword.toLowerCase().replace(/[\s_-]/g, '');
      // Check printed definition keywords
      const hasInDef = def.keywords.some(k => k.toLowerCase().replace(/[\s_-]/g, '') === norm);
      // Check one-shot grants ("target creature gains flying until end of turn")
      const hasInGrants = (card.grantedKeywords ?? []).some(
        k => k.toLowerCase().replace(/[\s_-]/g, '') === norm,
      );
      // Check continuous GrantKeyword effects (other static abilities)
      let hasInContinuous = false;
      if (!hasInDef && !hasInGrants && state.continuousEffects) {
        for (const ce of state.continuousEffects) {
          if (ce.ability.modifier.kind !== 'GrantKeyword' && ce.ability.modifier.kind !== 'GrantKeywords') continue;
          const ceSource = state.cards.get(ce.sourceInstanceId);
          if (!ceSource || ceSource.zone !== 'battlefield') continue;
          // selfOnly grants don't apply to other creatures
          if (ce.ability.selfOnly && card.instanceId !== ce.sourceInstanceId) continue;
          if (ce.ability.excludeSelf && card.instanceId === ce.sourceInstanceId) continue;
          if (ce.ability.controller === 'you' && card.ownerId !== ce.controllerId) continue;
          if (ce.ability.controller === 'opponent' && card.ownerId === ce.controllerId) continue;
          const modKws = ce.ability.modifier.kind === 'GrantKeyword'
            ? [ce.ability.modifier.keyword]
            : ce.ability.modifier.keywords;
          if (modKws.some(k => k.toLowerCase().replace(/[\s_-]/g, '') === norm)) {
            hasInContinuous = true;
            break;
          }
        }
      }
      if (!hasInDef && !hasInGrants && !hasInContinuous) return false;
    }
    // Slice 5 (controller-agnostic filtered anthems): negated keyword-holder filter —
    // "Creatures without flying get -2/-0." Only creatures that LACK the keyword match.
    // Mirror of withKeyword: we check the same three sources (def, grantedKeywords,
    // continuous effects) and return false when the creature HAS the keyword.
    if (ability.filter.withoutKeyword) {
      const norm = ability.filter.withoutKeyword.toLowerCase().replace(/[\s_-]/g, '');
      const hasInDef = def.keywords.some(k => k.toLowerCase().replace(/[\s_-]/g, '') === norm);
      const hasInGrants = (card.grantedKeywords ?? []).some(
        k => k.toLowerCase().replace(/[\s_-]/g, '') === norm,
      );
      let hasInContinuous = false;
      if (!hasInDef && !hasInGrants && state.continuousEffects) {
        for (const ce of state.continuousEffects) {
          if (ce.ability.modifier.kind !== 'GrantKeyword' && ce.ability.modifier.kind !== 'GrantKeywords') continue;
          const ceSource = state.cards.get(ce.sourceInstanceId);
          if (!ceSource || ceSource.zone !== 'battlefield') continue;
          if (ce.ability.selfOnly && card.instanceId !== ce.sourceInstanceId) continue;
          if (ce.ability.excludeSelf && card.instanceId === ce.sourceInstanceId) continue;
          if (ce.ability.controller === 'you' && card.ownerId !== ce.controllerId) continue;
          if (ce.ability.controller === 'opponent' && card.ownerId === ce.controllerId) continue;
          const modKws = ce.ability.modifier.kind === 'GrantKeyword'
            ? [ce.ability.modifier.keyword]
            : ce.ability.modifier.keywords;
          if (modKws.some(k => k.toLowerCase().replace(/[\s_-]/g, '') === norm)) {
            hasInContinuous = true;
            break;
          }
        }
      }
      // Creature has the keyword → does NOT satisfy "without" filter
      if (hasInDef || hasInGrants || hasInContinuous) return false;
    }
    // Slice 13: nontoken filter — "Nontoken creatures you control" (Ashaya family).
    // matchesCardFilter checks def-level fields only; nontoken is an instance-state
    // check (card.isToken), so we apply it here before the def-level call.
    if (ability.filter.nontoken && card.isToken) return false;
    return matchesCardFilter(def, ability.filter, { state, sourceInstanceId: effect.sourceInstanceId, instanceId: card.instanceId });
  }

  // No filter = matches all permanents
  return true;
}

function isLegendaryPermanentDefinition(def: CardDefinition): boolean {
  const isPermanent = ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']
    .some(type => def.card_types.includes(type as CardDefinition['card_types'][number]) || typeLineHasType(def.type_line, type));
  return isPermanent && typeLineHasSupertype(def.type_line, 'legendary');
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

    // Use effective colors (Layer 5, CR 613.4b) so color-defining statics such as
    // Leyline of the Guildpact's "Each nonland permanent you control is all colors"
    // are counted here, not just the printed def.colors. getEffectiveColors returns
    // def.colors when no SetAllColors effect applies, so the no-overlay case is
    // unchanged.
    for (const color of getEffectiveColors(state, card.instanceId)) {
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
      } else if (effect.ability.modifier.kind === 'ModifyPTDynamic' && !effect.ability.attachedOnly) {
        // Slice 3: non-attached dynamic anthem (e.g. Jodah — "legendary creatures
        // you control get +X/+X, where X is the number of legendary creatures you
        // control"). Evaluate the ForEachAmount at query time using the same
        // countForEachCDA helper used by the attached-aura and CDA paths.
        const mod = effect.ability.modifier;
        if (mod.powerFormula) {
          powerMod += mod.powerSign * countForEachCDA(mod.powerFormula, state, effect.controllerId, effect.sourceInstanceId);
        }
        if (mod.toughnessFormula) {
          toughnessMod += mod.toughnessSign * countForEachCDA(mod.toughnessFormula, state, effect.controllerId, effect.sourceInstanceId);
        }
      }
    }

    // Slice 10: ModifyPTDynamic — attached-buff where-X auras (Exoskeletal Armor,
    // Death's Approach). The source aura's `attachedTo` determines which creature
    // receives the buff; `isAffectedBy` returns false for attachedOnly statics so
    // we handle this separately.
    if (effect.ability.modifier.kind === 'ModifyPTDynamic' && effect.ability.attachedOnly) {
      // The aura (source) must be attached to the card being evaluated.
      if (source.attachedTo !== instanceId) continue;
      const mod = effect.ability.modifier;
      if (mod.powerFormula) {
        powerMod += mod.powerSign * countForEachCDA(mod.powerFormula, state, effect.controllerId, effect.sourceInstanceId);
      }
      if (mod.toughnessFormula) {
        toughnessMod += mod.toughnessSign * countForEachCDA(mod.toughnessFormula, state, effect.controllerId, effect.sourceInstanceId);
      }
    }
  }

  return { power: powerMod, toughness: toughnessMod };
}

/**
 * Get the total equipment P/T bonus for a creature instance.
 * Uses cached equipmentBonus data from CardDefinition.
 */
function getEquipmentPTBonus(
  state: GameState,
  instanceId: string,
): { power: number; toughness: number; setBasePower?: number; setBaseToughness?: number } {
  let power = 0, toughness = 0;
  let setBasePower: number | undefined;
  let setBaseToughness: number | undefined;
  for (const [, otherCard] of state.cards) {
    if (otherCard.attachedTo !== instanceId || otherCard.zone !== 'battlefield') continue;
    const equipDef = getCardDefinition(state, otherCard);
    if (!equipDef?.equipmentBonus) continue;
    power += equipDef.equipmentBonus.power;
    toughness += equipDef.equipmentBonus.toughness;
    // Layer 7b SET. Timestamp order is not tracked on the cache path; these
    // base-setting auras are mutually exclusive in practice, so last-wins.
    if (equipDef.equipmentBonus.setBasePower !== undefined) setBasePower = equipDef.equipmentBonus.setBasePower;
    if (equipDef.equipmentBonus.setBaseToughness !== undefined) setBaseToughness = equipDef.equipmentBonus.setBaseToughness;
  }
  return { power, toughness, setBasePower, setBaseToughness };
}

/**
 * Layer-7a: compute the dynamic base P/T for `instanceId` from any registered
 * SetBasePTDynamic continuous effect whose source IS `instanceId` (CDAs are
 * self-referential by definition). Returns undefined when no CDA applies so
 * callers fall through to the printed value.
 *
 * Only the LAST registered CDA (by timestamp) is used; in practice a creature
 * has at most one CDA and the mutually-exclusive rule (CR 208.2) is not
 * violated in realistic decks.
 */
function getDynamicBasePT(
  state: GameState,
  instanceId: string,
  controllerId: string,
): { power?: number; toughness?: number } | undefined {
  const effects = state.continuousEffects || [];
  let dynamicPower: number | undefined;
  let dynamicToughness: number | undefined;

  for (const effect of effects) {
    if (effect.sourceInstanceId !== instanceId) continue;
    if (effect.ability.modifier.kind !== 'SetBasePTDynamic') continue;
    const mod = effect.ability.modifier;
    // Check source is still on battlefield
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;
    dynamicPower = mod.powerFormula !== null
      ? countForEachCDA(mod.powerFormula, state, controllerId, effect.sourceInstanceId)
      : undefined;
    dynamicToughness = mod.toughnessFormula !== null
      ? countForEachCDA(mod.toughnessFormula, state, controllerId, effect.sourceInstanceId)
      : undefined;
  }

  // Return undefined (fall-through to printed value) when no formula set either axis.
  if (dynamicPower === undefined && dynamicToughness === undefined) return undefined;
  return { power: dynamicPower, toughness: dynamicToughness };
}

/**
 * Get the effective power of a creature, including continuous effects, counters, and equipment.
 */
export function getEffectivePower(state: GameState, instanceId: string): number {
  const card = state.cards.get(instanceId);
  if (!card) return 0;

  const def = getCardDefinition(state, card);
  if (def.power === undefined) return 0;

  const counterMod = (card.counters['+1/+1'] || 0) - (card.counters['-1/-1'] || 0);
  const continuous = getContinuousPTModification(state, instanceId);
  const equipmentBonus = getEquipmentPTBonus(state, instanceId);
  // Layer 7a: CDA dynamic base (selfOnly static registered per permanent)
  const dynamicBase = getDynamicBasePT(state, instanceId, card.ownerId);

  // Layer 7c: P/T switch (Dwarven Thaumaturgist / Valakut Fireboar family).
  // When _switchPT is set, effective power = the toughness axis (and vice versa).
  if (card.counters['_switchPT']) {
    // Toughness axis: re-compute the un-swapped toughness value, then return it as power.
    const toughnessTempMod = card.counters['_toughnessMod'] || 0;
    const durationSetToughness = card.counters['_setBaseToughness'];
    const baseToughness = dynamicBase?.toughness
      ?? (durationSetToughness !== undefined ? durationSetToughness : undefined)
      ?? equipmentBonus.setBaseToughness
      ?? def.toughness ?? 0;
    return baseToughness + counterMod + toughnessTempMod + continuous.toughness + equipmentBonus.toughness;
  }

  const tempMod = card.counters['_powerMod'] || 0;
  // Layer 7b: SET. Priority (highest first):
  //   1. CDA (dynamicBase, layer 7a self-referential)
  //   2. Duration-scoped "has base power N" from instants/sorceries/activated
  //      abilities (_setBasePower counter, cleared at end-of-turn cleanup).
  //   3. Equipment/Aura setBasePower from cached equipmentBonus.
  //   4. Printed value (def.power).
  const durationSetPower = card.counters['_setBasePower'];
  const basePower = dynamicBase?.power
    ?? (durationSetPower !== undefined ? durationSetPower : undefined)
    ?? equipmentBonus.setBasePower
    ?? def.power;

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

  const counterMod = (card.counters['+1/+1'] || 0) - (card.counters['-1/-1'] || 0);
  const continuous = getContinuousPTModification(state, instanceId);
  const equipmentBonus = getEquipmentPTBonus(state, instanceId);
  // Layer 7a: CDA dynamic toughness (toughnessFormula is null for power-only CDAs)
  const dynamicBase = getDynamicBasePT(state, instanceId, card.ownerId);

  // Layer 7c: P/T switch (Dwarven Thaumaturgist / Valakut Fireboar family).
  // When _switchPT is set, effective toughness = the power axis (and vice versa).
  if (card.counters['_switchPT']) {
    // Power axis: re-compute the un-swapped power value, then return it as toughness.
    const powerTempMod = card.counters['_powerMod'] || 0;
    const durationSetPower = card.counters['_setBasePower'];
    const basePower = dynamicBase?.power
      ?? (durationSetPower !== undefined ? durationSetPower : undefined)
      ?? equipmentBonus.setBasePower
      ?? def.power ?? 0;
    return basePower + counterMod + powerTempMod + continuous.power + equipmentBonus.power;
  }

  const tempMod = card.counters['_toughnessMod'] || 0;
  // Layer 7b: SET. Priority (highest first):
  //   1. CDA (dynamicBase, layer 7a self-referential)
  //   2. Duration-scoped "has base toughness M" (_setBaseToughness counter).
  //   3. Equipment/Aura setBaseToughness.
  //   4. Printed value (def.toughness).
  const durationSetToughness = card.counters['_setBaseToughness'];
  const baseToughness = dynamicBase?.toughness
    ?? (durationSetToughness !== undefined ? durationSetToughness : undefined)
    ?? equipmentBonus.setBaseToughness
    ?? def.toughness;

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
    if (effect.ability.modifier.kind !== 'GrantKeyword' && effect.ability.modifier.kind !== 'GrantKeywords') continue;

    // Check that the source is still on the battlefield
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    if (isAffectedBy(effect, card, def, state)) {
      if (effect.ability.modifier.kind === 'GrantKeyword') {
        keywords.push(effect.ability.modifier.keyword);
      } else {
        keywords.push(...effect.ability.modifier.keywords);
      }
    }
  }

  return keywords;
}

// All five MTG colors used by SetAllColors (Layer 5).
const ALL_COLORS: readonly ('W' | 'U' | 'B' | 'R' | 'G')[] = ['W', 'U', 'B', 'R', 'G'];

/**
 * Layer 5 (CR 613.4b): Get the effective colors of a card instance on the battlefield,
 * overlaying any SetAllColors continuous effects from the permanent layer system.
 *
 * Returns the printed def.colors when no SetAllColors effect applies, or all five
 * colors {W,U,B,R,G} when the permanent is affected by a SetAllColors modifier.
 *
 * Mirrors the getEffectivePower / getEffectiveToughness pattern for layer 7.
 *
 * Called by matchesCardFilter (executor.ts) when an instance context is available,
 * and by isAffectedBy (continuous.ts) for the filter.colors check on battlefield
 * permanents.
 */
export function getEffectiveColors(
  state: GameState,
  instanceId: string,
): readonly string[] {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') {
    // Not on battlefield — no continuous layer overlays apply.
    const offBoardCard = state.cards.get(instanceId);
    if (!offBoardCard) return [];
    const offDef = getCardDefinition(state, offBoardCard);
    return offDef.colors;
  }

  const def = getCardDefinition(state, card);
  const effects = state.continuousEffects || [];

  for (const effect of effects) {
    if (effect.ability.modifier.kind !== 'SetAllColors') continue;

    // Source must be on battlefield
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // Check that this card is affected by the effect (uses def.colors for the
    // filter check — no recursion risk since SetAllColors has no color filter).
    if (isAffectedBy(effect, card, def, state)) {
      return ALL_COLORS;
    }
  }

  return def.colors;
}

/**
 * Slice 13 (CDA-companion): Return the basic-land subtype(s) granted to a
 * specific battlefield instance via GrantLandSubtype continuous effects.
 *
 * Used by countForEachCDA (internal) and by tests to verify the effect is active.
 * Returns an empty array when no GrantLandSubtype effect applies to the instance.
 */
export function getGrantedLandSubtypes(
  state: GameState,
  instanceId: string,
): string[] {
  const card = state.cards.get(instanceId);
  if (!card || card.zone !== 'battlefield') return [];
  const def = getCardDefinition(state, card);
  const effects = state.continuousEffects ?? [];
  const granted: string[] = [];
  for (const effect of effects) {
    if (effect.ability.modifier.kind !== 'GrantLandSubtype') continue;
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;
    if (isAffectedBy(effect, card, def, state)) {
      const subtype = (effect.ability.modifier as { kind: 'GrantLandSubtype'; subtype: string }).subtype;
      if (!granted.includes(subtype)) granted.push(subtype);
    }
  }
  return granted;
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
    // selfOnly ReduceCost markers describe a spell-self reducer ("This spell
    // costs {N} less to cast"), enforced at cast time by getIntrinsicCostReduction
    // reading the spell's own oracle text — NOT a battlefield static that reduces
    // other spells. If such a permanent registers this marker on the battlefield,
    // it must NOT reduce the controller's other spells.
    if (effect.ability.selfOnly) continue;
    if (effect.ability.controller === 'you' && effect.controllerId !== casterId) continue;
    if (effect.ability.controller === 'opponent' && effect.controllerId === casterId) continue;

    // Check that the source is still on the battlefield
    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // Conditional statics only apply while their condition holds.
    if (effect.ability.condition
        && !evaluateCondition(state, effect.ability.condition, effect.controllerId, effect.sourceInstanceId)) continue;

    // If there's a filter, check against the spell being cast
    if (spellDef && (
      effect.ability.filter.types
      || effect.ability.filter.excludeTypes
      || effect.ability.filter.subtypes
      || effect.ability.filter.colors
      || effect.ability.filter.cmc
      || effect.ability.filter.power
      || effect.ability.filter.chosenCreatureTypeFromSource
      || effect.ability.filter.chosenColorFromSource
      || effect.ability.filter.chosenCardTypeFromSource
    )) {
      if (!matchesCardFilter(spellDef, effect.ability.filter, { state, sourceInstanceId: effect.sourceInstanceId })) continue;
    }

    reduction += effect.ability.modifier.amount;
  }

  return reduction;
}

/**
 * Get the total cost increase for spells cast by a player from continuous effects.
 */
export function getCostIncrease(
  state: GameState,
  casterId: string,
  spellDef?: CardDefinition,
): number {
  let increase = 0;

  const effects = state.continuousEffects || [];
  for (const effect of effects) {
    if (effect.ability.modifier.kind !== 'IncreaseCost') continue;
    if (effect.ability.selfOnly) continue;
    if (effect.ability.controller === 'you' && effect.controllerId !== casterId) continue;
    if (effect.ability.controller === 'opponent' && effect.controllerId === casterId) continue;

    const source = state.cards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // Conditional statics only apply while their condition holds.
    if (effect.ability.condition
        && !evaluateCondition(state, effect.ability.condition, effect.controllerId, effect.sourceInstanceId)) continue;

    if (spellDef && (
      effect.ability.filter.types
      || effect.ability.filter.excludeTypes
      || effect.ability.filter.subtypes
      || effect.ability.filter.colors
      || effect.ability.filter.cmc
      || effect.ability.filter.power
      || effect.ability.filter.chosenCreatureTypeFromSource
      || effect.ability.filter.chosenColorFromSource
      || effect.ability.filter.chosenCardTypeFromSource
    )) {
      if (!matchesCardFilter(spellDef, effect.ability.filter, { state, sourceInstanceId: effect.sourceInstanceId })) continue;
    }

    increase += effect.ability.modifier.amount;
  }

  return increase;
}

type CostReductionController = 'you' | 'opponents' | 'any';

function subjectMatchesCostReduction(def: CardDefinition, subject: string): boolean {
  const normalized = subject.toLowerCase().replace(/\s+/g, ' ').trim();
  const hasType = (type: string) => (
    def.card_types.includes(type as CardDefinition['card_types'][number])
    || typeLineHasType(def.type_line, type)
  );

  if (/\bnonland permanent/.test(normalized)) return !hasType('land') && ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some(hasType);
  if (/\bpermanent/.test(normalized)) return ['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker'].some(hasType);
  if (/\bartifact/.test(normalized)) return hasType('artifact');
  if (/\bcreature/.test(normalized)) return hasType('creature');
  if (/\benchantment/.test(normalized)) return hasType('enchantment');
  if (/\bland/.test(normalized)) return hasType('land');
  if (/\bplaneswalker/.test(normalized)) return hasType('planeswalker');
  if (/\bbattle/.test(normalized)) return hasType('battle');
  return false;
}

function battlefieldCardsForCostReduction(
  state: GameState,
  casterId: string,
  subject: string,
  controller: CostReductionController,
): CardDefinition[] {
  const defs: CardDefinition[] = [];
  for (const [, card] of state.cards) {
    if (card.zone !== 'battlefield') continue;
    if (controller === 'you' && card.ownerId !== casterId) continue;
    if (controller === 'opponents' && card.ownerId === casterId) continue;
    const def = getCardDefinition(state, card);
    if (subjectMatchesCostReduction(def, subject)) defs.push(def);
  }
  return defs;
}

function controllerFromCostReductionClause(clause: string): CostReductionController {
  if (/\byou control\b/i.test(clause)) return 'you';
  if (/\byour opponents? control\b/i.test(clause)) return 'opponents';
  return 'any';
}

/**
 * Match a subject noun ("Cave", "creature", "artifact", "Elf") against a card
 * definition, checking both card types and subtypes. Used for graveyard-based
 * cost-reduction counts where the subject is often a subtype (e.g. "Cave card").
 */
function subjectMatchesCardDefByTypeOrSubtype(def: CardDefinition, subject: string): boolean {
  const normalized = subject.toLowerCase().replace(/\s+/g, ' ').trim();
  if (subjectMatchesCostReduction(def, normalized)) return true;
  // Also check subtypes (e.g. "Cave", "Elf", "Dragon")
  return typeLineHasSubtype(def.type_line, normalized);
}

/**
 * True if a card definition matches a multi-type filter phrase such as
 * "artifact and/or creature", "instant and sorcery", "noncreature, nonland".
 * Used for Form 28 (graveyard multi-filter for-each cost reductions).
 *
 * Handles:
 *  - "X and/or Y"  → card is X OR Y
 *  - "X and Y"     → card is X AND Y (rarely used for cost reductions)
 *  - "nonX, nonY"  → card is neither X nor Y
 *  - "X, nonY"     → card is X but not Y
 */
function cardMatchesMultiFilterPhrase(def: CardDefinition, phrase: string): boolean {
  // Helper: does def match a single possibly-"non" type term?
  const matchesTerm = (term: string): boolean => {
    const negated = term.startsWith('non');
    const base = negated ? term.slice(3) : term;
    const hasType = subjectMatchesCostReduction(def, base) || typeLineHasSubtype(def.type_line, base);
    return negated ? !hasType : hasType;
  };

  // "X and/or Y" or "X or Y" — OR semantics
  const andOrMatch = phrase.match(/^(.+?)\s+and\/or\s+(.+)$/);
  if (andOrMatch) {
    return matchesTerm(andOrMatch[1].trim()) || matchesTerm(andOrMatch[2].trim());
  }
  // "X and Y" — AND semantics (e.g., "instant and sorcery" → must be both — rarely true, usually OR)
  // For graveyard cost reductions "instant and sorcery card" means either instant or sorcery.
  const andMatch = phrase.match(/^(.+?)\s+and\s+(.+)$/);
  if (andMatch) {
    return matchesTerm(andMatch[1].trim()) || matchesTerm(andMatch[2].trim());
  }
  // Comma-separated: "nonX, nonY" or "X, nonY"
  const commaParts = phrase.split(/\s*,\s+/).map(p => p.trim()).filter(Boolean);
  if (commaParts.length > 1) {
    // All conditions must hold (AND semantics for comma-separated type restrictions)
    return commaParts.every(matchesTerm);
  }
  // Single term fallback
  return matchesTerm(phrase.trim());
}

/**
 * Count cards in the caster's graveyard matching the given subject noun.
 */
function graveyardCardsForCostReduction(
  state: GameState,
  casterId: string,
  subject: string,
): number {
  let count = 0;
  for (const [, card] of state.cards) {
    if (card.zone !== 'graveyard') continue;
    if (card.ownerId !== casterId) continue;
    const def = getCardDefinition(state, card);
    if (subjectMatchesCardDefByTypeOrSubtype(def, subject)) count++;
  }
  return count;
}

/**
 * Cost reducers printed on the spell itself apply before payment even while the
 * card is still in hand/command. This covers common Commander cards such as
 * Blasphemous Act and Cavern-Hoard Dragon.
 *
 * Supported forms:
 *   1. Flat: "This spell costs {N} less to cast."
 *   2. Battlefield for-each: "costs {N} less for each <type> you control"
 *   3. Greatest mana value: "costs {X} less, where X is the greatest mana value among ..."
 *   4. Opponents: "costs {N} less for each opponent you have"
 *   5. Graveyard for-each: "costs {N} less for each <type> card in your graveyard"
 *   6. Compound battlefield+graveyard: "costs {N} less for each <X> you control and each <X> card in your graveyard"
 *   7. Total power: "costs {X} less, where X is the total power of creatures you control"
 *   8. Greatest power: "costs {X} less, where X is the greatest power among creatures you control"
 *   9. Party count: "costs {N} less for each creature in your party" (Cleric/Rogue/Warrior/Wizard)
 *  10. Domain: "costs {N} less for each basic land type among lands you control"
 *  11. Multi-type graveyard: "costs {N} less for each instant and sorcery card in your graveyard"
 *  12. Card types among graveyard: "costs {N} less for each card type among cards in your graveyard"
 *  13. Colors: "costs {N} less for each color among permanents you control"
 *  14. Creature types: "costs {N} less for each creature type among creatures you control"
 *  15. Counter-gated: "costs {N} less for each creature you control with a +1/+1 counter on it"
 *  16. CMC conditional: "costs {N} less if you control a permanent with mana value N or greater"
 *  17. Graveyard count conditional: "costs {N} less if you have N or more instant/sorcery cards in your graveyard"
 *      (supports digit and spelled-out thresholds, e.g. "eight or more" — Octavia, Living Thesis)
 *  18. Distinct mana values in graveyard: "costs {N} less for each different mana value among cards in your graveyard"
 *  19. Card-type count threshold: "costs {N} less if there are N or more card types among cards in your graveyard"
 *  20. Creature died this turn: "costs {N} less if a creature died this turn"
 *  21. Opponents control at least: "costs {N} less if your opponents control N or more <type>"
 *  22. Target tapped: "costs {N} less if it targets a tapped creature"
 *  23. Target legendary you control: "costs {N} less if it targets a legendary creature you control"
 *  24. Target attacking: "costs {N} less if it targets an attacking creature"
 *  25. Creature attacking you: "costs {N} less if a creature is attacking you"
 *  26. Exile+graveyard union for-each (Sailors' Bane):
 *      "costs {N} less for each card you own in exile and in your graveyard that's ..."
 *  47. Historic total MV: "costs {X} less, where X is the total mana value of historic permanents you control"
 *  48. Differently named lands: "costs {X} less, where X is the number of differently named lands you control"
 *  49. Controls counter creature: "costs {N} less if you control a creature with a +1/+1 counter on it"
 *  50. Target flying: "costs {N} less if it targets a creature with flying"
 *
 * @param targets  Optional chosen targets (instance IDs). Pass the spell's declared targets so
 *                 forms 22-24, 50 can evaluate target-quality conditions at cast time.
 */
export function getIntrinsicCostReduction(
  state: GameState,
  casterId: string,
  spellDef: CardDefinition,
  targets?: string[],
): number {
  const text = spellDef.oracle_text || '';
  let reduction = 0;

  // Form 1: flat "costs {N} less to cast" — tightened to decline conditional
  // forms ("if <condition>", "for each", "where X is") that appear in the same
  // clause. The existing negative lookahead (?!\s+for each) is extended.
  const flatMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast\b(?!\s+for each)(?!\s*,?\s+where\b)(?!\s*\bif\b)/i);
  if (flatMatch) {
    reduction += parseInt(flatMatch[1], 10);
  }

  // Form 4: "costs {N} less to cast for each opponent you have"
  const opponentMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each opponent you have\b/i);
  if (opponentMatch) {
    const amount = parseInt(opponentMatch[1], 10);
    const opponentCount = state.players.filter(p => p.id !== casterId && !p.hasLost).length;
    reduction += amount * opponentCount;
  }

  // Form 46: "costs {N} less to cast for each opponent" — bare Undaunted form (no "you have").
  // Used in Undaunted reminder text ("This spell costs {1} less to cast for each opponent.")
  // Negative lookahead excludes "you have" so Form 4 (above) handles that case without
  // double-counting. Executor is identical to Form 4: count non-eliminated opponents.
  const opponentBareMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each opponent\b(?!\s+you\s+have)/i);
  if (opponentBareMatch && !opponentMatch) {
    // Guard against double-count: only apply when Form 4 did NOT match.
    const amount = parseInt(opponentBareMatch[1], 10);
    const opponentCount = state.players.filter(p => p.id !== casterId && !p.hasLost).length;
    reduction += amount * opponentCount;
  }

  // Form 6: compound "costs {N} less for each <subject> you control and each <subject> card in your graveyard"
  // Must be tested before form 2 (the simpler battlefield-only form) to avoid partial match.
  // Uses subjectMatchesCardDefByTypeOrSubtype (not the type-only subjectMatchesCostReduction) so
  // that subtypes like "Cave" are correctly matched on the battlefield.
  const compoundMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast for each (\w+) you control and each \2 card in your graveyard\b/i,
  );
  if (compoundMatch) {
    const amount = parseInt(compoundMatch[1], 10);
    const subject = compoundMatch[2];
    // Count on the battlefield (owned by caster, matching type or subtype)
    let battlefieldCount = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (subjectMatchesCardDefByTypeOrSubtype(def, subject)) battlefieldCount++;
    }
    const graveyardCount = graveyardCardsForCostReduction(state, casterId, subject);
    reduction += amount * (battlefieldCount + graveyardCount);
  } else {
    // Form 2: simple battlefield for-each (only when compound form didn't match)
    const eachMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each ([^.]+?)(?: you control| your opponents? control| on the battlefield)\b/i);
    if (eachMatch) {
      // Skip if the "for each" phrase contains "opponent" — that's form 4 already handled.
      // Skip counter-qualified forms: "with a +1/+1 counter on it" (Form 15, handled below)
      //   and other counter types (not supported). Because the Form 2 regex is non-greedy,
      //   "for each creature you control with a +1/+1 counter on it" matches JUST the
      //   "for each creature you control" part — so we must also check the text AFTER the match.
      // Also skip Forms 9,10,13,14 which are "among" phrases handled by specialized forms:
      //   - "for each creature in your party" (Form 9)
      //   - "for each basic land type among lands you control" (Form 10 — domain)
      //   - "for each color among permanents you control" (Form 13)
      //   - "for each creature type among creatures you control" (Form 14)
      const phrase = eachMatch[2].toLowerCase();
      const clauseEnd = eachMatch[0].toLowerCase();
      // Check if there's a "with a ... counter" qualifier following the match (Form 15 suffix).
      const matchEnd = eachMatch.index! + eachMatch[0].length;
      const textAfterMatch = text.substring(matchEnd);
      const hasCounterSuffix = /^\s+with\s+a\s+[+\-]?\d+\/[+\-]?\d+\s+counter\b/i.test(textAfterMatch) ||
        /^\s+with\s+\w+\s+counters?\b/i.test(textAfterMatch);
      const hasCounterCondition = /\bwith\s+a\s+[+\-]\d+\/[+\-]\d+\s+counter\b|\bwith\s+\w+\s+counters?\b/.test(clauseEnd);
      const isSpecializedForm =
        /\bbasic land type among\b/i.test(clauseEnd) ||     // Form 10: domain
        /\bcolor among\b/i.test(clauseEnd) ||               // Form 13: colors
        /\bcreature type among\b/i.test(clauseEnd) ||       // Form 14: creature types
        /\bcreature in your party\b/i.test(clauseEnd);      // Form 9: party
      if (!phrase.includes('opponent') && !hasCounterCondition && !hasCounterSuffix && !isSpecializedForm) {
        const amount = parseInt(eachMatch[1], 10);
        const clause = eachMatch[0];
        const controller = controllerFromCostReductionClause(clause);
        const count = battlefieldCardsForCostReduction(state, casterId, eachMatch[2], controller).length;
        reduction += amount * count;
      }
    }
  }

  // Form 5: "costs {N} less for each <type> card in your graveyard" (single-word subject only)
  // Note: Form 11 ("instant and sorcery card") and Form 12 ("card type among") are excluded
  // naturally — their subjects are multi-word so `(\w+) card` doesn't match them.
  const graveyardEachMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each (\w+) card in your graveyard\b/i);
  if (graveyardEachMatch && !compoundMatch) {
    // Only apply when the compound form didn't already cover this (compound handles "X you control and each X card in graveyard")
    const amount = parseInt(graveyardEachMatch[1], 10);
    const subject = graveyardEachMatch[2];
    const count = graveyardCardsForCostReduction(state, casterId, subject);
    reduction += amount * count;
  }

  // Form 3: greatest mana value "costs {X} less, where X is the greatest mana value among <type> you control"
  const greatestMatch = text.match(/\bthis spell costs \{X\} less to cast,? where X is the greatest mana value among ([^.]+?)(?: you control| your opponents? control| on the battlefield)\b/i);
  if (greatestMatch) {
    const clause = greatestMatch[0];
    const controller = controllerFromCostReductionClause(clause);
    const candidates = battlefieldCardsForCostReduction(state, casterId, greatestMatch[1], controller);
    reduction += Math.max(0, ...candidates.map(def => def.cmc || 0));
  }

  // Form 7: "costs {X} less, where X is the total power of creatures you control"
  const totalPowerMatch = text.match(/\bthis spell costs \{X\} less to cast,? where X is the total power of (\w+(?:\s+\w+)*?) you control\b/i);
  if (totalPowerMatch) {
    const subject = totalPowerMatch[1];
    let total = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (subjectMatchesCardDefByTypeOrSubtype(def, subject)) {
        total += Math.max(0, def.power ?? 0);
      }
    }
    reduction += total;
  }

  // Form 8: "costs {X} less, where X is the greatest power among <type> you control"
  const greatestPowerMatch = text.match(/\bthis spell costs \{X\} less to cast,? where X is the greatest power among ([^.]+?)(?: you control| your opponents? control| on the battlefield)\b/i);
  if (greatestPowerMatch) {
    const clause = greatestPowerMatch[0];
    const controller = controllerFromCostReductionClause(clause);
    let greatest = 0;
    for (const [instanceId, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (controller === 'you' && card.ownerId !== casterId) continue;
      if (controller === 'opponents' && card.ownerId === casterId) continue;
      const def = getCardDefinition(state, card);
      if (subjectMatchesCostReduction(def, greatestPowerMatch[1])) {
        greatest = Math.max(greatest, getEffectivePower(state, instanceId));
      }
    }
    reduction += greatest;
  }

  // Form 9: party count — "costs {N} less for each creature in your party"
  // Party: one each of Cleric, Rogue, Warrior, Wizard among creatures you control on the battlefield (max 4)
  const partyMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each creature in your party\b/i);
  if (partyMatch) {
    const amount = parseInt(partyMatch[1], 10);
    const partyTypes = ['cleric', 'rogue', 'warrior', 'wizard'];
    const foundTypes = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (!def.card_types.includes('creature') && !typeLineHasType(def.type_line, 'creature')) continue;
      for (const pt of partyTypes) {
        if (typeLineHasSubtype(def.type_line, pt)) {
          foundTypes.add(pt);
        }
      }
    }
    reduction += amount * foundTypes.size;
  }

  // Form 10: domain — "costs {N} less for each basic land type among lands you control"
  const domainMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each basic land type among lands you control\b/i);
  if (domainMatch) {
    const amount = parseInt(domainMatch[1], 10);
    const basicLandTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
    const foundLandTypes = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (!def.card_types.includes('land') && !typeLineHasType(def.type_line, 'land')) continue;
      for (const lt of basicLandTypes) {
        if (typeLineHasSubtype(def.type_line, lt)) {
          foundLandTypes.add(lt);
        }
      }
    }
    reduction += amount * foundLandTypes.size;
  }

  // Form 11: multi-type graveyard — "costs {N} less for each instant and sorcery card in your graveyard"
  const multiGraveyardMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each instant and sorcery card in your graveyard\b/i);
  if (multiGraveyardMatch) {
    const amount = parseInt(multiGraveyardMatch[1], 10);
    let count = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (def.card_types.includes('instant') || typeLineHasType(def.type_line, 'instant') ||
          def.card_types.includes('sorcery') || typeLineHasType(def.type_line, 'sorcery')) {
        count++;
      }
    }
    reduction += amount * count;
  }

  // Form 12: distinct card types among graveyard — "costs {N} less for each card type among cards in your graveyard"
  const cardTypesGraveyardMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each card type among cards in your graveyard\b/i);
  if (cardTypesGraveyardMatch) {
    const amount = parseInt(cardTypesGraveyardMatch[1], 10);
    const knownTypes = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery'];
    const foundTypes = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      for (const kt of knownTypes) {
        if (def.card_types.includes(kt as CardDefinition['card_types'][number]) ||
            typeLineHasType(def.type_line, kt)) {
          foundTypes.add(kt);
        }
      }
    }
    reduction += amount * foundTypes.size;
  }

  // Form 13: colors among permanents you control — "costs {N} less for each color among permanents you control"
  const colorsMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each color among permanents you control\b/i);
  if (colorsMatch) {
    const amount = parseInt(colorsMatch[1], 10);
    const foundColors = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      for (const color of def.colors) {
        if (color !== 'C') foundColors.add(color);
      }
    }
    reduction += amount * foundColors.size;
  }

  // Form 14: creature types among creatures you control — "costs {N} less for each creature type among creatures you control"
  const creatureTypesMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each creature type among creatures you control\b/i);
  if (creatureTypesMatch) {
    const amount = parseInt(creatureTypesMatch[1], 10);
    const foundCreatureTypes = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (!def.card_types.includes('creature') && !typeLineHasType(def.type_line, 'creature')) continue;
      const subtypes = typeLineSectionTerms(def.type_line, 'subtypes');
      for (const st of subtypes) {
        if (st) foundCreatureTypes.add(st.toLowerCase());
      }
    }
    reduction += amount * foundCreatureTypes.size;
  }

  // Form 15: counter-gated battlefield — "costs {N} less for each creature you control with a +1/+1 counter on it"
  // CardInstance.counters is tracked in game state so we can evaluate this.
  const counterGatedMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast for each creature you control with a \+1\/\+1 counter on it\b/i);
  if (counterGatedMatch) {
    const amount = parseInt(counterGatedMatch[1], 10);
    let count = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (!def.card_types.includes('creature') && !typeLineHasType(def.type_line, 'creature')) continue;
      if ((card.counters['+1/+1'] ?? 0) > 0) count++;
    }
    reduction += amount * count;
  }

  // Form 16: evaluable conditional — "costs {N} less if you control a permanent with mana value N or greater"
  // Uses the ControlsType-style check against cmc filter.
  const cmcCondMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast if you control a (?:permanent|creature|artifact|enchantment|planeswalker|land) with mana value (\d+) or greater\b/i);
  if (cmcCondMatch) {
    const amount = parseInt(cmcCondMatch[1], 10);
    const threshold = parseInt(cmcCondMatch[2], 10);
    let condMet = false;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if ((def.cmc ?? 0) >= threshold) { condMet = true; break; }
    }
    if (condMet) reduction += amount;
  }

  // Form 17: evaluable conditional — "costs {N} less if you have N or more instant and/or sorcery cards in your graveyard"
  // Supports both digit ("8") and spelled-out ("eight") thresholds (Octavia, Living Thesis).
  const graveyardCountCondMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast if you have (\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more instant(?:s)?(?: and(?:\/or)? sorcery)? cards? in your graveyard\b/i);
  if (graveyardCountCondMatch) {
    const amount = parseInt(graveyardCountCondMatch[1], 10);
    const WORD_NUMS_GY: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const thresholdRaw17 = graveyardCountCondMatch[2].toLowerCase();
    const threshold = WORD_NUMS_GY[thresholdRaw17] ?? parseInt(thresholdRaw17, 10);
    let count = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (def.card_types.includes('instant') || typeLineHasType(def.type_line, 'instant') ||
          def.card_types.includes('sorcery') || typeLineHasType(def.type_line, 'sorcery')) {
        count++;
      }
    }
    if (count >= threshold) reduction += amount;
  }

  // Form 18: distinct mana values among cards in graveyard
  // "costs {N} less for each different mana value among cards in your graveyard" (Oskar, Rubbish Reclaimer)
  // CardDefinition.cmc tracks the mana value; we collect distinct nonzero cmc values.
  const distinctCmcGraveyardMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast for each different mana value among cards in your graveyard\b/i,
  );
  if (distinctCmcGraveyardMatch) {
    const amount = parseInt(distinctCmcGraveyardMatch[1], 10);
    const seenCmcs = new Set<number>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      seenCmcs.add(def.cmc ?? 0);
    }
    reduction += amount * seenCmcs.size;
  }

  // Form 19: card-type count threshold conditional
  // "costs {N} less if there are N or more card types among cards in your graveyard" (Dusk Feaster delirium)
  // N may be a digit or a spelled-out word number (e.g. "four or more").
  const cardTypeCountCondMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast if there are (\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more card types among cards in your graveyard\b/i,
  );
  if (cardTypeCountCondMatch) {
    const amount = parseInt(cardTypeCountCondMatch[1], 10);
    const thresholdRaw = cardTypeCountCondMatch[2].toLowerCase();
    const WORD_NUMS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const threshold = WORD_NUMS[thresholdRaw] ?? parseInt(thresholdRaw, 10);
    const knownTypes = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'land', 'planeswalker', 'sorcery'];
    const foundTypes = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      for (const kt of knownTypes) {
        if (def.card_types.includes(kt as CardDefinition['card_types'][number]) ||
            typeLineHasType(def.type_line, kt)) {
          foundTypes.add(kt);
        }
      }
    }
    if (foundTypes.size >= threshold) reduction += amount;
  }

  // Form 20: "costs {N} less if a creature died this turn" (Purple Worm, Bone Picker)
  // Requires state.creaturesDiedThisTurn to be tracked by state-based.ts.
  const diedThisTurnMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast if a creature died this turn\b/i);
  if (diedThisTurnMatch) {
    const amount = parseInt(diedThisTurnMatch[1], 10);
    if ((state.creaturesDiedThisTurn ?? 0) > 0) reduction += amount;
  }

  // Form 21: "costs {N} less if your opponents control N or more creatures" (Lashwhip Predator)
  const opponentControlsAtLeastMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast if your opponents? controls? (\d+|one|two|three|four|five|six|seven|eight|nine|ten) or more (\w+(?:\s+\w+)*?)\b(?=\s*$|[.,\n])/i,
  );
  if (opponentControlsAtLeastMatch) {
    const reductionAmount = parseInt(opponentControlsAtLeastMatch[1], 10);
    const WORD_NUMS_OC: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const thresholdRaw = opponentControlsAtLeastMatch[2].toLowerCase();
    const threshold = WORD_NUMS_OC[thresholdRaw] ?? parseInt(thresholdRaw, 10);
    const subjectPhrase = opponentControlsAtLeastMatch[3].toLowerCase().trim();
    let count = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId === casterId) continue; // must be an opponent
      const def = getCardDefinition(state, card);
      if (subjectMatchesCostReduction(def, subjectPhrase)) count++;
    }
    if (count >= threshold) reduction += reductionAmount;
  }

  // ── Forms 22-24: target-quality conditionals ─────────────────────────────
  // These require `targets` (the chosen spell targets) to be non-empty.
  // When castSpell passes them, we evaluate the first creature target found.
  if (targets && targets.length > 0) {
    // Form 22: "costs {N} less if it targets a tapped creature"
    const targetTappedMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast if it targets a tapped creature\b/i);
    if (targetTappedMatch) {
      const amount = parseInt(targetTappedMatch[1], 10);
      for (const tid of targets) {
        const tCard = state.cards.get(tid);
        if (tCard && tCard.tapped) { reduction += amount; break; }
      }
    }

    // Form 23: "costs {N} less if it targets a legendary creature you control"
    const targetLegendaryMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast if it targets a legendary creature you control\b/i);
    if (targetLegendaryMatch) {
      const amount = parseInt(targetLegendaryMatch[1], 10);
      for (const tid of targets) {
        const tCard = state.cards.get(tid);
        if (!tCard || tCard.ownerId !== casterId) continue;
        const tDef = getCardDefinition(state, tCard);
        if (typeLineHasSupertype(tDef.type_line, 'legendary')) { reduction += amount; break; }
      }
    }

    // Form 24: "costs {N} less if it targets an attacking creature"
    const targetAttackingMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast if it targets an attacking creature\b/i);
    if (targetAttackingMatch) {
      const amount = parseInt(targetAttackingMatch[1], 10);
      const attackerIds = new Set((state.combat?.attackers ?? []).map(a => a.cardInstanceId));
      for (const tid of targets) {
        if (attackerIds.has(tid)) { reduction += amount; break; }
      }
    }
  }

  // Form 25: "costs {N} less if a creature is attacking you"
  // Does not require targets — checks whether any attacker is attacking this player.
  const creatureAttackingYouMatch = text.match(/\bthis spell costs \{(\d+)\} less to cast if a creature is attacking you\b/i);
  if (creatureAttackingYouMatch && state.combat) {
    const amount = parseInt(creatureAttackingYouMatch[1], 10);
    // An attacker is "attacking you" when its declared defending player is this player's id.
    const attackingYou = state.combat.attackers.some(a => a.defendingPlayerId === casterId);
    if (attackingYou) reduction += amount;
  }

  // Form 26: exile+graveyard union for-each (Sailors' Bane)
  // "for each card you own in exile and in your graveyard that's an instant card, a sorcery card,
  //  or a card that has an Adventure"
  const exileGyUnionMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast for each card you own in exile and in your graveyard that(?:'s| is) (?:an? )?(.+?)(?:\.|$)/i,
  );
  if (exileGyUnionMatch) {
    const amount = parseInt(exileGyUnionMatch[1], 10);
    const conditionText = exileGyUnionMatch[2].toLowerCase();
    let count = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'exile' && card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      // Match "instant card", "sorcery card", or "card that has an Adventure"
      const isInstant = def.card_types.includes('instant') || typeLineHasType(def.type_line, 'instant');
      const isSorcery = def.card_types.includes('sorcery') || typeLineHasType(def.type_line, 'sorcery');
      // Adventure cards have the "Adventure" keyword in their oracle text or keywords array
      const hasAdventure = def.keywords?.includes('Adventure') ||
        /\bAdventure\b/i.test(def.oracle_text || '');
      // Accept if ANY of the listed conditions match (the oracle text is an "or" list)
      const matches =
        (conditionText.includes('instant') && isInstant) ||
        (conditionText.includes('sorcery') && isSorcery) ||
        (conditionText.includes('adventure') && hasAdventure);
      if (matches) count++;
    }
    reduction += amount * count;
  }

  // ── Slice 5 long-tail additions (Forms 27-32) ───────────────────────────────

  // Form 27: "Affinity for <type>" keyword line (Myr Enforcer, Somber Hoverguard, Broodstar).
  // Some card databases store oracle text without reminder text, so the bare keyword
  // "Affinity for artifacts" must be handled as {1} less per artifact you control.
  // Guard: only apply when the explicit "this spell costs ... for each ..." form is NOT
  // already present in the oracle text (to avoid double-counting when the full reminder
  // text IS included, since Form 2 already handles that wording).
  const affinityMatch = text.match(/\baffinity for (\w+(?:\s+\w+)*)\b/i);
  if (affinityMatch && !/\bthis spell costs .* less to cast for each\b/i.test(text)) {
    const affinitySubjectRaw = affinityMatch[1].toLowerCase();
    const affinitySubjectSingular = affinitySubjectRaw.replace(/s$/, ''); // normalize plural
    let battlefieldCount = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (subjectMatchesCostReduction(def, affinitySubjectSingular) ||
          subjectMatchesCostReduction(def, affinitySubjectRaw)) {
        battlefieldCount++;
      }
    }
    // Affinity is always {1} less per permanent you control of the named type.
    reduction += battlefieldCount;
  }

  // Form 28: graveyard multi-filter for-each
  //   "for each artifact and/or creature card in your graveyard" (Chitin Gravestalker)
  //   "for each noncreature, nonland card in your graveyard" (Serpent of the Pass style)
  // Covers: "X and/or Y card", "X, nonY card", and "nonX, nonY card" phrasings.
  // Guard: only fire when Form 11 (instant and sorcery) did NOT already handle this.
  // Use a distinct pattern that requires either "and/or" or a "non"-prefix or comma,
  // so it does not overlap with the single-word Form 5 ("for each creature card ...").
  if (!multiGraveyardMatch) {
    const multiFilterGraveyardMatch = text.match(
      /\bthis spell costs \{(\d+)\} less to cast for each ((?:\w+\s+and\/or\s+\w+|non\w+(?:,\s+non\w+)*(?:\s+\w+)*|\w+(?:\s+and\s+\w+)+)) card(?:s)? in your graveyard\b/i,
    );
    if (multiFilterGraveyardMatch) {
      const amount = parseInt(multiFilterGraveyardMatch[1], 10);
      const typePhrase = multiFilterGraveyardMatch[2].toLowerCase();
      // Parse the type phrase: "artifact and/or creature", "noncreature, nonland", etc.
      let count = 0;
      for (const [, card] of state.cards) {
        if (card.zone !== 'graveyard') continue;
        if (card.ownerId !== casterId) continue;
        const def = getCardDefinition(state, card);
        if (cardMatchesMultiFilterPhrase(def, typePhrase)) count++;
      }
      reduction += amount * count;
    }
  }

  // Form 29: "if you control a <subtype> or a <subtype>" (Wolfkin Outcast // Wedding Crasher)
  // "costs {N} less to cast if you control a Human or a Wolf"
  const controlsSubtypeOrMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast if you control an? (\w+(?:\s+\w+)*?) or an? (\w+(?:\s+\w+)*?)(?:\.|$)/i,
  );
  if (controlsSubtypeOrMatch) {
    const amount = parseInt(controlsSubtypeOrMatch[1], 10);
    const typeA = controlsSubtypeOrMatch[2].toLowerCase().trim();
    const typeB = controlsSubtypeOrMatch[3].toLowerCase().trim();
    let condMet = false;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (subjectMatchesCardDefByTypeOrSubtype(def, typeA) ||
          subjectMatchesCardDefByTypeOrSubtype(def, typeB)) {
        condMet = true;
        break;
      }
    }
    if (condMet) reduction += amount;
  }

  // Form 30: "if you've cast another spell this turn" (Gigastorm Titan)
  // Evaluable from state.spellsCastThisTurn: the CURRENT spell is being cast,
  // so "another" means the count BEFORE this spell is >= 1 (i.e., at least one
  // other spell was cast this turn). castSpell increments spellsCastThisTurn
  // AFTER calling getIntrinsicCostReduction, so the count here reflects spells
  // cast BEFORE this one.
  const castAnotherThisTurnMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast if you'?ve cast another spell this turn\b/i,
  );
  if (castAnotherThisTurnMatch) {
    const amount = parseInt(castAnotherThisTurnMatch[1], 10);
    if ((state.spellsCastThisTurn ?? 0) >= 1) reduction += amount;
  }

  // Form 31: generalized exile+graveyard for-each without "that's" filter (Huskburster Swarm)
  // "for each <type> card you own in exile and in your graveyard"
  // Note: Form 26 already handles the "that's ..." filtered variant; this handles
  // the simpler "<type> card you own in exile and in your graveyard" form.
  const exileGySimpleMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast for each ([\w\s]+?) card you own in exile and in your graveyard\b(?!\s+that)/i,
  );
  if (exileGySimpleMatch) {
    const amount = parseInt(exileGySimpleMatch[1], 10);
    const subject = exileGySimpleMatch[2].toLowerCase().trim();
    let count = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'exile' && card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (subjectMatchesCardDefByTypeOrSubtype(def, subject)) count++;
    }
    reduction += amount * count;
  }

  // Note: Form 32 ("this effect can't reduce the cost to less than one mana") is a
  // minimum-cost rider, not itself a reduction. It is absorbed in parser recognition
  // (isSelfCostReductionSentence) and enforced as a clamp in stack.ts reduceGenericCost.

  // Form 36 (Slice 6): "costs {X} less to cast, where X is your devotion to <color(s)>"
  // Daybreak Chimera: "This spell costs {X} less to cast, where X is your devotion to white."
  // Callaphe: "This spell costs {X} less to cast, where X is your devotion to blue."
  // Enforced by countDevotionToColors (effective-types.ts) — computable at cast time.
  // Pattern deliberately broad: "where X is your devotion to <any color words>".
  // We parse the color(s) from the match, then call countDevotionToColors.
  const devotionCostMatch = text.match(
    /\bthis spell costs \{X\} less to cast,? where X is your devotion to ([\w\s,]+?)(?:\.|$)/i,
  );
  if (devotionCostMatch) {
    const colorPhrase = devotionCostMatch[1].toLowerCase().trim();
    // Map color words to ManaColor constants
    const colorMap: Record<string, 'W' | 'U' | 'B' | 'R' | 'G'> = {
      white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G',
    };
    const colors: Array<'W' | 'U' | 'B' | 'R' | 'G'> = [];
    for (const [word, code] of Object.entries(colorMap)) {
      if (new RegExp(`\\b${word}\\b`).test(colorPhrase)) {
        if (!colors.includes(code)) colors.push(code);
      }
    }
    if (colors.length > 0) {
      reduction += countDevotionToColors(state, casterId, colors);
    }
  }

  // ── Slice 5/12 dynamic cost-reduction additive forms (Forms 38-45) ────────

  // Form 38: "costs {N} less for each instant or sorcery card in your graveyard" (OR form)
  // Same executor logic as Form 11 (instant/sorcery — count either type). Guard: only fire when
  // Form 11 did NOT already handle this (Form 11 uses "and"; this uses "or").
  if (!multiGraveyardMatch) {
    const instantOrSorceryGYMatch = text.match(
      /\bthis spell costs \{(\d+)\} less to cast for each instant or sorcery card in your graveyard\b/i,
    );
    if (instantOrSorceryGYMatch) {
      const amount = parseInt(instantOrSorceryGYMatch[1], 10);
      let count = 0;
      for (const [, card] of state.cards) {
        if (card.zone !== 'graveyard') continue;
        if (card.ownerId !== casterId) continue;
        const def = getCardDefinition(state, card);
        if (def.card_types.includes('instant') || typeLineHasType(def.type_line, 'instant') ||
            def.card_types.includes('sorcery') || typeLineHasType(def.type_line, 'sorcery')) {
          count++;
        }
      }
      reduction += amount * count;
    }
  }

  // Form 39: "costs {N} less for each different converted mana cost among cards in your graveyard"
  // Legacy synonym for "mana value" (pre-MH2 wording). Same logic as Form 18 (distinctCmcGraveyardMatch).
  // Guard: only fire when Form 18 did NOT already match.
  if (!distinctCmcGraveyardMatch) {
    const legacyCmcGYMatch = text.match(
      /\bthis spell costs \{(\d+)\} less to cast for each different converted mana cost among cards in your graveyard\b/i,
    );
    if (legacyCmcGYMatch) {
      const amount = parseInt(legacyCmcGYMatch[1], 10);
      const seenCmcs = new Set<number>();
      for (const [, card] of state.cards) {
        if (card.zone !== 'graveyard') continue;
        if (card.ownerId !== casterId) continue;
        const def = getCardDefinition(state, card);
        seenCmcs.add(def.cmc ?? 0);
      }
      reduction += amount * seenCmcs.size;
    }
  }

  // Form 40: "costs {X} less to cast, where X is the number of [filter] cards in your graveyard"
  // Dynamic where-X GY count; graveyardCardsForCostReduction handles type/subtype matching.
  const whereXGYCountMatch = text.match(
    /\bthis spell costs \{X\} less to cast,? where X is the number of (\w+(?:\s+\w+)*?) cards? in your graveyard\b/i,
  );
  if (whereXGYCountMatch) {
    const subject = whereXGYCountMatch[1].toLowerCase().trim();
    reduction += graveyardCardsForCostReduction(state, casterId, subject);
  }

  // Form 41: "[type] in your graveyard" without "card" qualifier
  // e.g. "for each Zombie in your graveyard", "for each creature in your graveyard"
  // Same executor as Form 5 — graveyardCardsForCostReduction counts by type/subtype.
  // Guard: only fire when Form 5 (graveyardEachMatch, which requires "card") did NOT
  // already fire — prevents double-counting for "for each Zombie card in your graveyard".
  // The regex below is purposely greedy so it won't match "for each Zombie card in your
  // graveyard" (greedy `\w+(?:\s+\w+)*` eats "Zombie card" and then fails to find
  // " in your graveyard" after the trailing "card" placeholder token).
  // Wait — to safely exclude "card"-qualified forms, match only sentences where NO "card"
  // appears between "for each" and "in your graveyard":
  if (!graveyardEachMatch) {
    const typeInGYNoCCardMatch = text.match(
      /\bthis spell costs \{(\d+)\} less to cast for each ((?:(?!\bcard\b)\w+(?:\s+(?!\bcard\b)\w+)*)) in your graveyard\b/i,
    );
    if (typeInGYNoCCardMatch) {
      const phrase = typeInGYNoCCardMatch[2].toLowerCase().trim();
      // Skip "among" forms (Forms 12, 18, 39, 43, 44) handled above.
      const isAmongForm = /\bamong\b/.test(phrase);
      // Skip "instant" forms (Forms 11, 38) handled above.
      const isInstantSorcery = /\binstant\b/.test(phrase);
      if (!isAmongForm && !isInstantSorcery) {
        const amount = parseInt(typeInGYNoCCardMatch[1], 10);
        reduction += amount * graveyardCardsForCostReduction(state, casterId, phrase);
      }
    }
  }

  // Form 42: "for each card in your graveyard" — total graveyard count, no type filter
  const allGYMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast for each card in your graveyard\b/i,
  );
  if (allGYMatch) {
    const amount = parseInt(allGYMatch[1], 10);
    let count = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      count++;
    }
    reduction += amount * count;
  }

  // Form 43: "for each color among cards in your graveyard"
  // Complementary to Form 13 (permanents you control) — same logic but in graveyard.
  const colorsGYMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast for each color among cards in your graveyard\b/i,
  );
  if (colorsGYMatch) {
    const amount = parseInt(colorsGYMatch[1], 10);
    const foundColors = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      for (const color of def.colors) {
        if (color !== 'C') foundColors.add(color);
      }
    }
    reduction += amount * foundColors.size;
  }

  // Form 44: "for each creature type among creature cards in your graveyard"
  // Complementary to Form 14 (creatures you control) — creature-type diversity in GY.
  const creatureTypesGYMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast for each creature type among creature cards in your graveyard\b/i,
  );
  if (creatureTypesGYMatch) {
    const amount = parseInt(creatureTypesGYMatch[1], 10);
    const foundCreatureTypes = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'graveyard') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (!def.card_types.includes('creature') && !typeLineHasType(def.type_line, 'creature')) continue;
      const subtypes = typeLineSectionTerms(def.type_line, 'subtypes');
      for (const st of subtypes) {
        if (st) foundCreatureTypes.add(st.toLowerCase());
      }
    }
    reduction += amount * foundCreatureTypes.size;
  }

  // Note: Forms 45 (clamp rider variants "to less than {N}" and "below one mana") are
  // absorbed in parser recognition (isSelfCostReductionSentence) and enforced as a clamp
  // in stack.ts reduceGenericCost, exactly as Form 32. No reduction value emitted here.

  // ── Slice 10 long-tail additions (Forms 47-50) ─────────────────────────────

  // Form 47: "costs {X} less to cast, where X is the total mana value of historic
  //   permanents you control" (Excalibur, Sword of Eden).
  // Historic = legendary permanent | artifact | Saga (Dominaria rules CR 700.4a).
  // Sum def.cmc across matching permanents controlled by the caster.
  const whereXHistoricMVMatch = text.match(
    /\bthis spell costs \{X\} less to cast,? where X is the total mana value of historic permanents you control\b/i,
  );
  if (whereXHistoricMVMatch) {
    let total = 0;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      const isLegendary = typeLineHasSupertype(def.type_line, 'legendary');
      const isArtifact = def.card_types.includes('artifact') || typeLineHasType(def.type_line, 'artifact');
      const isSaga = def.card_types.includes('enchantment')
        ? /\bSaga\b/.test(def.type_line || '')
        : typeLineHasType(def.type_line, 'saga') || /\bSaga\b/.test(def.type_line || '');
      if (isLegendary || isArtifact || isSaga) {
        total += def.cmc ?? 0;
      }
    }
    reduction += total;
  }

  // Form 48: "costs {X} less to cast, where X is the number of differently named
  //   lands you control" (Fungal Colossus). Count distinct land names among the
  //   caster's battlefield lands. Uses def.name for uniqueness.
  const whereXDiffNamedLandsMatch = text.match(
    /\bthis spell costs \{X\} less to cast,? where X is the number of differently named lands you control\b/i,
  );
  if (whereXDiffNamedLandsMatch) {
    const seenNames = new Set<string>();
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (!def.card_types.includes('land') && !typeLineHasType(def.type_line, 'land')) continue;
      if (def.name) seenNames.add(def.name.toLowerCase());
    }
    reduction += seenNames.size;
  }

  // Form 49: "costs {N} less if you control a creature with a +1/+1 counter on it"
  //   (Prehistoric Turtlesaurus). Boolean conditional: apply if ANY creature owned
  //   by the caster has at least one +1/+1 counter. CardInstance.counters tracks this.
  const controlsCounterCreatureMatch = text.match(
    /\bthis spell costs \{(\d+)\} less to cast if you control a creature with a \+1\/\+1 counter on it\b/i,
  );
  if (controlsCounterCreatureMatch) {
    const amount = parseInt(controlsCounterCreatureMatch[1], 10);
    let condMet = false;
    for (const [, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      if (card.ownerId !== casterId) continue;
      const def = getCardDefinition(state, card);
      if (!def.card_types.includes('creature') && !typeLineHasType(def.type_line, 'creature')) continue;
      if ((card.counters['+1/+1'] ?? 0) > 0) { condMet = true; break; }
    }
    if (condMet) reduction += amount;
  }

  // Form 50: "costs {N} less if it targets a creature with flying"
  //   (Swampsnare Trap). Requires `targets` (threaded into this function).
  //   Check each target: if it's a creature with Flying in def.keywords or
  //   card.grantedKeywords (inline check to avoid keywords.ts import cycle).
  if (targets && targets.length > 0) {
    const targetFlyingMatch = text.match(
      /\bthis spell costs \{(\d+)\} less to cast if it targets a creature with flying\b/i,
    );
    if (targetFlyingMatch) {
      const amount = parseInt(targetFlyingMatch[1], 10);
      for (const tid of targets) {
        const tCard = state.cards.get(tid);
        if (!tCard) continue;
        const tDef = getCardDefinition(state, tCard);
        // Only creatures qualify
        if (!tDef.card_types.includes('creature') && !typeLineHasType(tDef.type_line, 'creature')) continue;
        // Check printed Flying keyword
        const hasFlying =
          tDef.keywords.some(k => k.toLowerCase() === 'flying') ||
          (tCard.grantedKeywords ?? []).some(k => k.toLowerCase() === 'flying') ||
          (state.continuousEffects ?? []).some(ce => {
            if (ce.ability.modifier.kind !== 'GrantKeyword' && ce.ability.modifier.kind !== 'GrantKeywords') return false;
            const ceSource = state.cards.get(ce.sourceInstanceId);
            if (!ceSource || ceSource.zone !== 'battlefield') return false;
            if (ce.ability.selfOnly && tCard.instanceId !== ce.sourceInstanceId) return false;
            if (ce.ability.excludeSelf && tCard.instanceId === ce.sourceInstanceId) return false;
            if (ce.ability.controller === 'you' && tCard.ownerId !== ce.controllerId) return false;
            if (ce.ability.controller === 'opponent' && tCard.ownerId === ce.controllerId) return false;
            const kws = ce.ability.modifier.kind === 'GrantKeyword'
              ? [ce.ability.modifier.keyword]
              : ce.ability.modifier.keywords;
            return kws.some(k => k.toLowerCase() === 'flying');
          });
        if (hasFlying) { reduction += amount; break; }
      }
    }
  }

  return Math.max(0, reduction);
}

// ============================================================================
// Conditional Effect Evaluation
// ============================================================================

import type { Condition } from './ast';

/**
 * Evaluate a condition against the current game state.
 *
 * `sourceInstanceId` (optional) identifies the permanent whose ability carries
 * the condition; it is only consulted by ControlsType.excludeSource ("you
 * control ANOTHER <filter>"), where the source itself must not satisfy the
 * filter.
 */
export function evaluateCondition(
  state: GameState,
  condition: Condition,
  controllerId: string,
  sourceInstanceId?: string,
): boolean {
  switch (condition.kind) {
    case 'ControlsType': {
      const playerId = condition.controller === 'you' ? controllerId :
        state.players.find(p => p.id !== controllerId && !p.hasLost)?.id;
      if (!playerId) return false;

      for (const [, card] of state.cards) {
        if (card.ownerId !== playerId || card.zone !== 'battlefield') continue;
        if (condition.excludeSource && card.instanceId === sourceInstanceId) continue;
        const def = getCardDefinition(state, card);
        if (matchesCardFilter(def, condition.filter)) return true;
      }
      return false;
    }

    case 'ControlsNone': {
      // Slice 1: "you control no [other] <filter>" / "your opponents control no <filter>".
      // True when NO battlefield permanent owned by the specified controller matches the filter.
      // Slice 9/11 extension: when condition.filter.tapped is defined, also check the
      // card instance's tapped state (e.g. "you control no untapped lands" uses tapped:false).
      const playerIds: string[] = condition.controller === 'you'
        ? [controllerId]
        : state.players.filter(p => p.id !== controllerId && !p.hasLost).map(p => p.id);
      for (const [instanceId, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (!playerIds.includes(card.ownerId)) continue;
        if (condition.excludeSource && instanceId === sourceInstanceId) continue;
        const def = getCardDefinition(state, card);
        if (!matchesCardFilter(def, condition.filter)) continue;
        // Instance-level tapped check (matchesCardFilter operates on def only)
        if (condition.filter.tapped !== undefined && card.tapped !== condition.filter.tapped) continue;
        return false;
      }
      return true;
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

    case 'CardsInZoneAtLeast': {
      const playerIds = condition.controller === 'you'
        ? [controllerId]
        : condition.controller === 'opponent'
          ? state.players.filter(p => p.id !== controllerId && !p.hasLost).map(p => p.id)
          : state.players.filter(p => !p.hasLost).map(p => p.id);
      let count = 0;
      for (const [, card] of state.cards) {
        if (card.zone !== condition.zone) continue;
        if (!playerIds.includes(card.ownerId)) continue;
        if (condition.filter) {
          const def = getCardDefinition(state, card);
          if (!matchesCardFilter(def, condition.filter)) continue;
        }
        count++;
        if (count >= condition.count) return true;
      }
      return false;
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

    case 'LifeAtOrBelowHalfStarting': {
      // Slice 7: "as long as your life total is less than or equal to half your starting
      // life total" — Bhaal / Myrkul family. The threshold is half startingLife (default 40).
      const player = condition.controller === 'you'
        ? state.players.find(p => p.id === controllerId)
        : state.players.find(p => p.id !== controllerId && !p.hasLost);
      if (!player) return false;
      const threshold = Math.floor((player.startingLife ?? 40) / 2);
      return player.life <= threshold;
    }

    case 'LifeAboveStarting': {
      // Slice 7: "as long as your life total is greater than your starting life total"
      // — Elenda, Saint of Dusk family.
      const player = condition.controller === 'you'
        ? state.players.find(p => p.id === controllerId)
        : state.players.find(p => p.id !== controllerId && !p.hasLost);
      if (!player) return false;
      return player.life > (player.startingLife ?? 40);
    }

    case 'PlayerAttackedThisTurn': {
      const attacked = new Set(state.playersWhoAttackedThisTurn || []);
      if (condition.controller === 'you') return attacked.has(controllerId);
      return state.players.some(player => player.id !== controllerId && !player.hasLost && attacked.has(player.id));
    }

    case 'ColorIsMostCommonAmongPermanents': {
      const counts = countPermanentColors(state);
      const target = counts[condition.color];
      const others = (Object.keys(counts) as Array<keyof typeof counts>)
        .filter(color => color !== condition.color);
      // Tied-for-most counts ties (incl. an empty board where every color is
      // tied at zero, per the printed rulings); strict requires a sole leader.
      if (condition.orTiedForMost) return others.every(color => counts[color] <= target);
      return others.every(color => counts[color] < target);
    }

    case 'ControlsCommander': {
      // True when the source's controller has a commander on the battlefield.
      // Checks all battlefield permanents the controller owns for commander status
      // (isCommander flag OR listed in player.commanderInstanceId / commanderInstanceIds).
      for (const [instanceId, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (card.ownerId !== controllerId) continue;
        if (isOwnersCommander(state, instanceId)) return true;
      }
      return false;
    }

    case 'CreatureDiedThisTurn': {
      // True when at least one creature has died this turn.
      // state.creaturesDiedThisTurn is incremented by checkStateBasedActions
      // and reset to 0 at the start of each new turn (nextTurn in turn-manager.ts).
      return (state.creaturesDiedThisTurn ?? 0) > 0;
    }

    case 'OpponentsControlAtLeast': {
      // True when opponents collectively control at least `count` permanents matching `what`.
      let count = 0;
      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (card.ownerId === controllerId) continue; // exclude caster
        const def = getCardDefinition(state, card);
        if (matchesCardFilter(def, condition.what)) count++;
        if (count >= condition.count) return true;
      }
      return false;
    }

    case 'EventPlayerHasMoreCardsInHand': {
      // Slice 12: Anvil of Bogardan family — only meaningful in trigger bodies (executor.ts).
      // In a static/continuous context there is no EventPlayer, so this condition is never true.
      return false;
    }

    case 'NoSpellsLastTurn': {
      // Slice 2 (werewolf): only meaningful in upkeep trigger bodies; not applicable to statics.
      return (state.spellsCastLastTurn ?? 0) === 0;
    }

    case 'AnyPlayerTwoOrMoreSpellsLastTurn': {
      // Slice 2 (werewolf): only meaningful in upkeep trigger bodies; not applicable to statics.
      return (state.spellsCastLastTurn ?? 0) >= 2;
    }

    case 'EnteredByCasting': {
      // Slice 11 (intervening-if ETB): meaningful only at ETB trigger resolution;
      // not applicable to continuous static abilities — always false in this context.
      return false;
    }

    case 'SpellsCastThisTurnAtLeast': {
      // Slice 9/11: "as long as you've cast two or more spells this turn."
      // state.spellsCastThisTurn is incremented by castSpell in stack.ts when a spell
      // is placed on the stack; reset to 0 at the start of each turn. We use the
      // controller's spellsCastThisTurn if tracked per-player, otherwise the global count.
      // Current engine only tracks a global count, so this condition applies to the
      // active player's total spells for the turn.
      return (state.spellsCastThisTurn ?? 0) >= condition.count;
    }

    case 'DistinctManaValuesInGraveyardAtLeast': {
      // Slice 9/11: "as long as there are N or more mana values among cards in your graveyard."
      // Counts the number of DISTINCT mana values (CMC) among cards in the controller's graveyard.
      // A mana value of 0 is a distinct value and counts.
      const distinctCmcs = new Set<number>();
      for (const [, card] of state.cards) {
        if (card.zone !== 'graveyard') continue;
        if (card.ownerId !== controllerId) continue;
        const def = getCardDefinition(state, card);
        distinctCmcs.add(def.cmc);
        if (distinctCmcs.size >= condition.count) return true;
      }
      return false;
    }

    case 'CardTypesInGraveyardAtLeast': {
      // Slice 5 (Delirium): "as long as there are four or more card types among cards in your
      // graveyard." Counts the number of DISTINCT card types (artifact, creature, enchantment,
      // instant, land, planeswalker, sorcery, battle) among all cards in the controller's
      // graveyard. Each card contributes each of its own card_types; early-exit once threshold met.
      const distinctTypes = new Set<string>();
      for (const [, card] of state.cards) {
        if (card.zone !== 'graveyard') continue;
        if (card.ownerId !== controllerId) continue;
        const def = getCardDefinition(state, card);
        for (const ct of def.card_types) {
          distinctTypes.add(ct);
          if (distinctTypes.size >= condition.count) return true;
        }
        // Also check type_line for types not yet in card_types (e.g. battle)
        for (const t of ['artifact', 'creature', 'enchantment', 'instant', 'land',
                         'planeswalker', 'sorcery', 'battle']) {
          if (typeLineHasType(def.type_line, t)) {
            distinctTypes.add(t);
            if (distinctTypes.size >= condition.count) return true;
          }
        }
      }
      return distinctTypes.size >= condition.count;
    }

    case 'IsActivePlayer': {
      // Slice 11 (self conditional anthem): "During your turn, this creature gets +N/+N."
      // True when the source's controller is the current active player.
      const activePlayer = state.players[state.activePlayerIndex];
      return !!activePlayer && activePlayer.id === controllerId;
    }

    case 'TopCardOfLibraryIs': {
      // Slice 4 (top-card-conditional anthem): "as long as the top card of your library is
      // <color> / a <type> card" (Vampire Nocturnus, Crown of Convergence family).
      //
      // The engine preserves Map insertion order for library zones; the first matching
      // entry is the top of the library (same assumption used by canPlayCardFromTopOfLibrary
      // in stack.ts). We stop at the first library card owned by the controller.
      let topCard: { def: CardDefinition } | null = null;
      for (const [, card] of state.cards) {
        if (card.zone !== 'library') continue;
        if (card.ownerId !== controllerId) continue;
        topCard = { def: getCardDefinition(state, card) };
        break; // first library entry = top of library (Map insertion order)
      }
      if (!topCard) return false; // empty library → condition is false

      const { def } = topCard;
      // Color check: the top card must share at least one color with the list
      if (condition.colors && condition.colors.length > 0) {
        return condition.colors.some(c => (def.colors as string[]).includes(c));
      }
      // Card-type check: the top card must have at least one matching card_type
      if (condition.cardTypes && condition.cardTypes.length > 0) {
        return condition.cardTypes.some(t => (def.card_types as string[]).includes(t));
      }
      return false; // neither field set — should not happen
    }

    case 'SelfIsUntapped': {
      // Slice 2 — conditional self-buff: "as long as it's untapped" (Giant Tortoise).
      // True when the source permanent's tapped field is falsy.
      // If sourceInstanceId is absent (e.g. evaluating from a non-permanent context),
      // the condition is false — conservative and honest.
      if (!sourceInstanceId) return false;
      const self = state.cards.get(sourceInstanceId);
      return self !== undefined && !self.tapped;
    }

    case 'SelfIsAttacking': {
      // Slice 2 — conditional self-buff: "as long as it's attacking" (Freyalise's Winds).
      // True when the source creature is currently a declared attacker.
      // If sourceInstanceId is absent or no combat is in progress, the condition is false.
      if (!sourceInstanceId || !state.combat) return false;
      return state.combat.attackers.some(a => a.cardInstanceId === sourceInstanceId);
    }

    case 'SelfIsEquipped': {
      // Slice 5 — conditional self-buff: "as long as this creature is equipped"
      // (Skyhunter Cub / Kitesail Apprentice / Armory Veteran family).
      // True when any battlefield permanent with subtype Equipment is attached to self.
      if (!sourceInstanceId) return false;
      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (card.attachedTo !== sourceInstanceId) continue;
        const def = getCardDefinition(state, card);
        if (typeLineHasSubtype(def.type_line, 'Equipment')) return true;
      }
      return false;
    }

    case 'SelfIsEnchanted': {
      // Slice 5 — conditional self-buff: "as long as this creature is enchanted"
      // (Thran Golem / Freewind Equenaut family).
      // True when any battlefield Aura (enchantment with attachedTo) is attached to self.
      if (!sourceInstanceId) return false;
      for (const [, card] of state.cards) {
        if (card.zone !== 'battlefield') continue;
        if (card.attachedTo !== sourceInstanceId) continue;
        const def = getCardDefinition(state, card);
        if (typeLineHasType(def.type_line, 'enchantment')) return true;
      }
      return false;
    }

    default: {
      const _never: never = condition;
      return false;
    }
  }
}

/** Count battlefield permanents per color (a multicolored permanent counts once for EACH of its colors). */
function countPermanentColors(state: GameState): Record<'W' | 'U' | 'B' | 'R' | 'G', number> {
  const counts: Record<'W' | 'U' | 'B' | 'R' | 'G', number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const [, card] of state.cards) {
    if (card.zone !== 'battlefield') continue;
    const def = getCardDefinition(state, card);
    for (const color of def.colors) {
      if (color in counts) counts[color as keyof typeof counts]++;
    }
  }
  return counts;
}
