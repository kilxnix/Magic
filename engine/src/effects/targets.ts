import { isSpellStackItem, type GameState } from '../types';
import {
  canBeTargetedByOpponent,
  canBeTargetedByController,
  isProtectedFromSource,
  isBlockedByHexproofFromOwnColors,
  hasKeyword,
} from '../keywords';
import { isEffectiveCreature } from '../effective-types';
import { getCardDefinition } from '../game-state';
import { typeLineHasType, typeLineHasSubtype, typeLineHasSupertype } from '../type-line';
import { getEffectivePower, getEffectiveToughness } from './continuous';

/**
 * Slice 5 (player-level static prohibitions): check whether a player has
 * PlayerHexproof or PlayerShroud active via a continuous effect registered
 * from a permanent they control ("You have hexproof/shroud.").
 *
 * Returns:
 *   'hexproof' — opponent cannot target the player; self-targeting is allowed.
 *   'shroud'   — neither opponent NOR the player themselves may target.
 *   null       — no player hexproof/shroud in effect.
 *
 * The check mirrors the permanent hexproof/shroud check in keywords.ts
 * (canBeTargetedByOpponent / canBeTargetedByController) but operates on the
 * player's continuousEffects rather than on instance keywords.
 */
function playerTargetingRestriction(state: GameState, playerId: string): 'hexproof' | 'shroud' | null {
  const effects = state.continuousEffects;
  if (!effects || effects.length === 0) return null;

  for (const ce of effects) {
    // The source of the continuous effect must still be on the battlefield.
    const source = state.cards.get(ce.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // PlayerHexproof/PlayerShroud are selfOnly statics that protect the
    // effect's controller. Check that the targeted player IS the controller.
    if (ce.controllerId !== playerId) continue;

    if (ce.ability.modifier.kind === 'PlayerShroud') return 'shroud';
    if (ce.ability.modifier.kind === 'PlayerHexproof') return 'hexproof';
  }
  return null;
}

export type TargetType = 'Creature' | 'Player' | 'Any' | 'Permanent' | 'Land' | 'Artifact' | 'Enchantment' | 'ArtifactOrEnchantment' | 'ArtifactEnchantmentOrLand' | 'NonlandPermanent' | 'Spell' | 'NoncreatureSpell' | 'CreatureSpell' | 'CreatureOrEnchantmentSpell' | 'ArtifactOrCreatureSpell' | 'InstantOrSorcerySpell' | 'EnchantmentInstantOrSorcerySpell' | 'CardInGraveyard' | 'CreatureCardInGraveyard' | 'CreatureOrEnchantmentCardInGraveyard' | 'CreatureOrPlaneswalker';

export interface TargetSpec {
  /** Stable id for mapping spec -> StackItem.targets position */
  id: string;
  type: TargetType;
  /** Number of choices required for this spec (v0 is usually 1) */
  count: number;
  /**
   * Minimum number of choices when the spec allows choosing FEWER than `count`
   * ("deals N damage divided as you choose among any number of targets" /
   * "among one, two, or three targets"). Absent = exactly `count` choices
   * required (the existing behavior for every other spec).
   */
  minCount?: number;
  constraints?: {
    opponentControls?: boolean;
    controllerControls?: boolean;
    notSource?: boolean;
    colors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
    notColors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
    cmc?: { op: 'eq' | 'lte' | 'gte'; value: number };
    /**
     * Required card types — OR semantics across the list (matches CardFilter.types):
     * "instant or sorcery card" → ['instant', 'sorcery'], "permanent card" → the six
     * permanent card types. AND-shapes ("artifact creature card") put one type in the
     * TargetType (CreatureCardInGraveyard) and the other here.
     */
    types?: string[];
    /** Required subtypes — OR semantics ("Goblin card", "Spirit card"). */
    subtypes?: string[];
    /** Excluded card types — "nonenchantment creature", "nonartifact creature". */
    excludeTypes?: string[];
    /** Excluded subtypes — "non-Human creature", "non-Vampire creature". */
    excludeSubtypes?: string[];
    /** Excluded supertypes — "nonlegendary creature" (['legendary']), "nonbasic land" (['basic']). */
    excludeSupertypes?: string[];
    /** "nontoken creature/permanent" — the target may not be a token. */
    nontoken?: boolean;
    /** Effective power bound — "with power 5 or greater". */
    power?: { op: 'eq' | 'lte' | 'gte'; value: number };
    /** Effective toughness bound — "with toughness 3 or less". */
    toughness?: { op: 'eq' | 'lte' | 'gte'; value: number };
    /** Combat requirement — "attacking creature", "blocking creature", "attacking or blocking creature". */
    combatStatus?: 'attacking' | 'blocking' | 'attackingOrBlocking';
    /** Tap-state requirement — "tapped creature" / "untapped creature". */
    tappedStatus?: 'tapped' | 'untapped';
    /**
     * Keyword-absence requirement — "without flying", "without trample", etc.
     * The target must NOT have any of the listed keywords (all must be absent).
     * Checked at the time of target validation via hasKeyword.
     */
    lacksKeywords?: string[];
    /**
     * Slice 8 (choose-type-return): target must have the creature subtype stored in
     * namedCardChoices['chosenCreatureType'] at cast time. Used by
     * matchChosenTypeReturnFromGraveyard (Haunting Voyage family) so graveyard
     * targets are restricted to the chosen type. When namedCardChoices is absent or
     * the key is missing, the constraint is skipped (acts as unfiltered — safe
     * because validateTargetChoices is called only when actual choices exist).
     */
    chosenCreatureTypeFromCastTime?: boolean;
  };
}

function isPlayerId(state: GameState, id: string): boolean {
  return state.players.some(p => p.id === id);
}

function isCreatureOnBattlefield(state: GameState, cardInstanceId: string): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.zone !== 'battlefield') return false;
  return isEffectiveCreature(state, cardInstanceId);
}

function isAnyTarget(state: GameState, id: string): boolean {
  if (isPlayerId(state, id)) return true;
  return isCreatureOnBattlefield(state, id);
}

function isSpellTargetOnStack(
  state: GameState,
  id: string,
  targetType: Extract<TargetType, 'Spell' | 'NoncreatureSpell' | 'CreatureSpell' | 'CreatureOrEnchantmentSpell' | 'ArtifactOrCreatureSpell' | 'InstantOrSorcerySpell' | 'EnchantmentInstantOrSorcerySpell'>,
): boolean {
  for (const item of state.stack) {
    if (!isSpellStackItem(item)) continue;
    if (item.id !== id && item.cardInstanceId !== id) continue;

    if (targetType === 'Spell') return true;

    const card = state.cards.get(item.cardInstanceId);
    const def = card ? getCardDefinition(state, card) : undefined;
    if (!def) return false;

    const isCreatureSpell = def.card_types.includes('creature');
    if (targetType === 'CreatureSpell') return isCreatureSpell;
    if (targetType === 'CreatureOrEnchantmentSpell') return isCreatureSpell || def.card_types.includes('enchantment');
    if (targetType === 'ArtifactOrCreatureSpell') return isCreatureSpell || def.card_types.includes('artifact');
    if (targetType === 'InstantOrSorcerySpell') {
      return def.card_types.includes('instant') || def.card_types.includes('sorcery');
    }
    if (targetType === 'EnchantmentInstantOrSorcerySpell') {
      return def.card_types.includes('enchantment') || def.card_types.includes('instant') || def.card_types.includes('sorcery');
    }
    return !isCreatureSpell;
  }
  return false;
}

function matchesNumericConstraint(value: number, constraint: { op: 'eq' | 'lte' | 'gte'; value: number } | undefined): boolean {
  if (!constraint) return true;
  if (constraint.op === 'eq') return value === constraint.value;
  if (constraint.op === 'lte') return value <= constraint.value;
  return value >= constraint.value;
}

function matchesCmcConstraint(value: number, constraint: NonNullable<TargetSpec['constraints']>['cmc']): boolean {
  return matchesNumericConstraint(value, constraint);
}

function getTargetDefinition(state: GameState, chosenId: string): ReturnType<typeof getCardDefinition> | undefined {
  const card = state.cards.get(chosenId);
  if (card) return getCardDefinition(state, card);
  const stackItem = state.stack.find(item => item.id === chosenId || (isSpellStackItem(item) && item.cardInstanceId === chosenId));
  if (stackItem && isSpellStackItem(stackItem)) {
    const stackCard = state.cards.get(stackItem.cardInstanceId);
    return stackCard ? getCardDefinition(state, stackCard) : undefined;
  }
  return undefined;
}

/**
 * Validate that chosenIds satisfy specs in order.
 *
 * Throws on invalid choice.
 */
export function validateTargetChoices(
  state: GameState,
  casterId: string,
  specs: TargetSpec[],
  chosenIds: string[],
  sourceInstanceId?: string,
): void {
  const expectedTotal = specs.reduce((sum, s) => sum + (s.count ?? 1), 0);
  const minTotal = specs.reduce((sum, s) => sum + (s.minCount ?? s.count ?? 1), 0);
  if (chosenIds.length < minTotal || chosenIds.length > expectedTotal) {
    throw new Error(minTotal === expectedTotal
      ? `Expected ${expectedTotal} target choice(s), got ${chosenIds.length}`
      : `Expected ${minTotal} to ${expectedTotal} target choice(s), got ${chosenIds.length}`);
  }

  let offset = 0;
  for (const spec of specs) {
    const targetCount = spec.count ?? 1;
    const slice = chosenIds.slice(offset, offset + targetCount);
    offset += targetCount;

    for (const chosenId of slice) {
      // Type check
      if (spec.type === 'Player') {
        if (!isPlayerId(state, chosenId)) {
          throw new Error(`Invalid target for ${spec.id}: expected player, got ${chosenId}`);
        }
        if (spec.constraints?.opponentControls && chosenId === casterId) {
          throw new Error(`Invalid target for ${spec.id}: expected opponent, got controller`);
        }
        // Slice 5: player hexproof/shroud (Ivory Mask / Leyline of Sanctity family).
        // Mirrors the permanent hexproof/shroud check below (canBeTargetedByOpponent /
        // canBeTargetedByController), but for players protected by a continuous effect
        // registered from "You have hexproof/shroud." on a permanent they control.
        const playerRestriction = playerTargetingRestriction(state, chosenId);
        if (playerRestriction === 'shroud') {
          // Shroud: no one — not even the player themselves — may target them.
          throw new Error(`Invalid target for ${spec.id}: player has shroud`);
        }
        if (playerRestriction === 'hexproof' && chosenId !== casterId) {
          // Hexproof: opponents cannot target; the player can still target themselves.
          throw new Error(`Invalid target for ${spec.id}: player has hexproof`);
        }
      } else if (spec.type === 'Creature') {
        if (!isCreatureOnBattlefield(state, chosenId)) {
          throw new Error(`Invalid target for ${spec.id}: expected creature on battlefield, got ${chosenId}`);
        }
      } else if (spec.type === 'Any') {
        if (!isAnyTarget(state, chosenId)) {
          throw new Error(`Invalid target for ${spec.id}: expected any target, got ${chosenId}`);
        }
        // Slice 5: player hexproof/shroud also applies to "Any" targets that are players.
        if (isPlayerId(state, chosenId)) {
          const playerRestrictionAny = playerTargetingRestriction(state, chosenId);
          if (playerRestrictionAny === 'shroud') {
            throw new Error(`Invalid target for ${spec.id}: player has shroud`);
          }
          if (playerRestrictionAny === 'hexproof' && chosenId !== casterId) {
            throw new Error(`Invalid target for ${spec.id}: player has hexproof`);
          }
        }
      } else if (spec.type === 'Permanent' || spec.type === 'NonlandPermanent' || spec.type === 'Land') {
        // Any permanent on the battlefield
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected permanent on battlefield, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (spec.type === 'NonlandPermanent') {
          if (def.card_types.includes('land')) {
            throw new Error(`Invalid target for ${spec.id}: expected nonland permanent, got land`);
          }
        } else if (spec.type === 'Land') {
          if (!def.card_types.includes('land')) {
            throw new Error(`Invalid target for ${spec.id}: expected land, got ${chosenId}`);
          }
        }
      } else if (spec.type === 'Artifact') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected artifact on battlefield, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (!def.card_types.includes('artifact')) {
          throw new Error(`Invalid target for ${spec.id}: expected artifact, got ${chosenId}`);
        }
      } else if (spec.type === 'Enchantment') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected enchantment on battlefield, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (!def.card_types.includes('enchantment')) {
          throw new Error(`Invalid target for ${spec.id}: expected enchantment, got ${chosenId}`);
        }
      } else if (spec.type === 'ArtifactOrEnchantment') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected artifact or enchantment on battlefield, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (!def.card_types.includes('artifact') && !def.card_types.includes('enchantment')) {
          throw new Error(`Invalid target for ${spec.id}: expected artifact or enchantment, got ${chosenId}`);
        }
      } else if (spec.type === 'ArtifactEnchantmentOrLand') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected artifact, enchantment, or land on battlefield, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (!def.card_types.includes('artifact') && !def.card_types.includes('enchantment') && !def.card_types.includes('land')) {
          throw new Error(`Invalid target for ${spec.id}: expected artifact, enchantment, or land, got ${chosenId}`);
        }
      } else if (spec.type === 'CreatureOrPlaneswalker') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected creature or planeswalker on battlefield, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (!isEffectiveCreature(state, chosenId) && !def.card_types.includes('planeswalker')) {
          throw new Error(`Invalid target for ${spec.id}: expected creature or planeswalker, got ${chosenId}`);
        }
      } else if (
        spec.type === 'Spell'
        || spec.type === 'NoncreatureSpell'
        || spec.type === 'CreatureSpell'
        || spec.type === 'CreatureOrEnchantmentSpell'
        || spec.type === 'ArtifactOrCreatureSpell'
        || spec.type === 'InstantOrSorcerySpell'
        || spec.type === 'EnchantmentInstantOrSorcerySpell'
      ) {
        if (!isSpellTargetOnStack(state, chosenId, spec.type)) {
          throw new Error(`Invalid target for ${spec.id}: expected ${spec.type} on the stack, got ${chosenId}`);
        }
        // Spells are on the stack — validated at cast time, not here
        // Just ensure an id was provided
      } else if (spec.type === 'CreatureCardInGraveyard') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'graveyard') {
          throw new Error(`Invalid target for ${spec.id}: expected card in graveyard, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (!def.card_types.includes('creature')) {
          throw new Error(`Invalid target for ${spec.id}: expected creature card in graveyard, got ${chosenId}`);
        }
      } else if (spec.type === 'CreatureOrEnchantmentCardInGraveyard') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'graveyard') {
          throw new Error(`Invalid target for ${spec.id}: expected card in graveyard, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (!def.card_types.includes('creature') && !def.card_types.includes('enchantment')) {
          throw new Error(`Invalid target for ${spec.id}: expected creature or enchantment card in graveyard, got ${chosenId}`);
        }
      } else if (spec.type === 'CardInGraveyard') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'graveyard') {
          throw new Error(`Invalid target for ${spec.id}: expected card in graveyard, got ${chosenId}`);
        }
      }

      // Check hexproof/shroud for permanent targets
      const targetCard = state.cards.get(chosenId);
      if (targetCard && targetCard.zone === 'battlefield') {
        const isOwnedByCaster = targetCard.ownerId === casterId;
        if (isOwnedByCaster) {
          // Controller targeting their own permanent - shroud and protection from
          // the source both block this.
          if (!canBeTargetedByController(state, chosenId)) {
            throw new Error(`Invalid target for ${spec.id}: target has shroud`);
          }
          if (isProtectedFromSource(state, chosenId, sourceInstanceId)) {
            throw new Error(`Invalid target for ${spec.id}: target has protection from the source`);
          }
        } else {
          // Opponent targeting - hexproof, shroud, and protection from the
          // source all block this.
          if (!canBeTargetedByOpponent(state, chosenId)) {
            throw new Error(`Invalid target for ${spec.id}: target has hexproof or shroud`);
          }
          if (isProtectedFromSource(state, chosenId, sourceInstanceId)) {
            throw new Error(`Invalid target for ${spec.id}: target has protection from the source`);
          }
          // Tam, Mindful First-Year — "hexproof from each of its colors":
          // block when the source shares a color with the target creature's own colors.
          if (isBlockedByHexproofFromOwnColors(state, chosenId, sourceInstanceId)) {
            throw new Error(`Invalid target for ${spec.id}: target has hexproof from that color`);
          }
        }
      }

      // Constraints
      if (spec.constraints?.notColors?.length) {
        const card = state.cards.get(chosenId);
        if (!card) {
          throw new Error(`Invalid target for ${spec.id}: color restriction requires a card, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (spec.constraints.notColors.some(color => def.colors.includes(color))) {
          throw new Error(`Invalid target for ${spec.id}: target has an excluded color`);
        }
      }

      if (spec.constraints?.colors?.length) {
        const card = state.cards.get(chosenId);
        if (!card) {
          throw new Error(`Invalid target for ${spec.id}: color restriction requires a card, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (!spec.constraints.colors.some(color => def.colors.includes(color))) {
          throw new Error(`Invalid target for ${spec.id}: target is missing a required color`);
        }
      }

      if (spec.constraints?.cmc) {
        const def = getTargetDefinition(state, chosenId);
        if (!def) {
          throw new Error(`Invalid target for ${spec.id}: mana value restriction requires a card, got ${chosenId}`);
        }
        if (!matchesCmcConstraint(def.cmc ?? 0, spec.constraints.cmc)) {
          throw new Error(`Invalid target for ${spec.id}: mana value ${def.cmc ?? 0} does not satisfy ${spec.constraints.cmc.op} ${spec.constraints.cmc.value}`);
        }
      }

      if (spec.constraints?.types?.length || spec.constraints?.subtypes?.length) {
        const card = state.cards.get(chosenId);
        if (!card) {
          throw new Error(`Invalid target for ${spec.id}: type restriction requires a card, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        if (spec.constraints.types?.length) {
          const hasRequiredType = spec.constraints.types.some(t =>
            def.card_types.includes(t as never) || typeLineHasType(def.type_line, t));
          if (!hasRequiredType) {
            throw new Error(`Invalid target for ${spec.id}: target is not a ${spec.constraints.types.join(' or ')} card`);
          }
        }
        if (spec.constraints.subtypes?.length) {
          const hasRequiredSubtype = spec.constraints.subtypes.some(st => typeLineHasSubtype(def.type_line, st));
          if (!hasRequiredSubtype) {
            throw new Error(`Invalid target for ${spec.id}: target is not a ${spec.constraints.subtypes.join(' or ')} card`);
          }
        }
      }

      if (
        spec.constraints?.excludeTypes?.length
        || spec.constraints?.excludeSubtypes?.length
        || spec.constraints?.excludeSupertypes?.length
      ) {
        const card = state.cards.get(chosenId);
        if (!card) {
          throw new Error(`Invalid target for ${spec.id}: type exclusion requires a card, got ${chosenId}`);
        }
        const def = getCardDefinition(state, card);
        for (const excluded of spec.constraints.excludeTypes ?? []) {
          if (def.card_types.includes(excluded as never) || typeLineHasType(def.type_line, excluded)) {
            throw new Error(`Invalid target for ${spec.id}: target has excluded type ${excluded}`);
          }
        }
        for (const excluded of spec.constraints.excludeSubtypes ?? []) {
          if (typeLineHasSubtype(def.type_line, excluded)) {
            throw new Error(`Invalid target for ${spec.id}: target has excluded subtype ${excluded}`);
          }
        }
        for (const excluded of spec.constraints.excludeSupertypes ?? []) {
          if (typeLineHasSupertype(def.type_line, excluded)) {
            throw new Error(`Invalid target for ${spec.id}: target has excluded supertype ${excluded}`);
          }
        }
      }

      if (spec.constraints?.nontoken) {
        const card = state.cards.get(chosenId);
        if (!card || card.isToken) {
          throw new Error(`Invalid target for ${spec.id}: target must be a nontoken permanent`);
        }
      }

      if (spec.constraints?.power || spec.constraints?.toughness) {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: power/toughness restriction requires a permanent on the battlefield, got ${chosenId}`);
        }
        if (spec.constraints.power && !matchesNumericConstraint(getEffectivePower(state, chosenId), spec.constraints.power)) {
          throw new Error(`Invalid target for ${spec.id}: power ${getEffectivePower(state, chosenId)} does not satisfy ${spec.constraints.power.op} ${spec.constraints.power.value}`);
        }
        if (spec.constraints.toughness && !matchesNumericConstraint(getEffectiveToughness(state, chosenId), spec.constraints.toughness)) {
          throw new Error(`Invalid target for ${spec.id}: toughness ${getEffectiveToughness(state, chosenId)} does not satisfy ${spec.constraints.toughness.op} ${spec.constraints.toughness.value}`);
        }
      }

      if (spec.constraints?.combatStatus) {
        const isAttacking = !!state.combat?.attackers.some(a => a.cardInstanceId === chosenId);
        const isBlocking = !!state.combat?.blockers.some(b => b.cardInstanceId === chosenId);
        const status = spec.constraints.combatStatus;
        const satisfies = status === 'attacking'
          ? isAttacking
          : status === 'blocking'
            ? isBlocking
            : (isAttacking || isBlocking);
        if (!satisfies) {
          throw new Error(`Invalid target for ${spec.id}: target must be ${status === 'attackingOrBlocking' ? 'attacking or blocking' : status}`);
        }
      }

      if (spec.constraints?.tappedStatus) {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: tap-state restriction requires a permanent on the battlefield, got ${chosenId}`);
        }
        if (spec.constraints.tappedStatus === 'tapped' && !card.tapped) {
          throw new Error(`Invalid target for ${spec.id}: target must be tapped`);
        }
        if (spec.constraints.tappedStatus === 'untapped' && card.tapped) {
          throw new Error(`Invalid target for ${spec.id}: target must be untapped`);
        }
      }

      if (spec.constraints?.opponentControls && spec.type !== 'Player') {
        const card = state.cards.get(chosenId);
        if (!card) {
          // opponentControls only makes sense for permanents; be strict.
          throw new Error(`Invalid target for ${spec.id}: opponentControls requires a permanent, got ${chosenId}`);
        }
        if (card.ownerId === casterId) {
          throw new Error(`Invalid target for ${spec.id}: target must be controlled by an opponent`);
        }
      }

      if (spec.constraints?.controllerControls && spec.type !== 'Player') {
        const card = state.cards.get(chosenId);
        if (!card) {
          throw new Error(`Invalid target for ${spec.id}: controllerControls requires a permanent, got ${chosenId}`);
        }
        if (card.ownerId !== casterId) {
          throw new Error(`Invalid target for ${spec.id}: target must be controlled by you`);
        }
      }

      if (spec.constraints?.notSource && sourceInstanceId && chosenId === sourceInstanceId) {
        throw new Error(`Invalid target for ${spec.id}: target must be another object`);
      }

      // Slice 8: "without <keyword>" — the target must NOT have the listed keywords.
      if (spec.constraints?.lacksKeywords?.length) {
        for (const kw of spec.constraints.lacksKeywords) {
          if (hasKeyword(state, chosenId, kw)) {
            throw new Error(`Invalid target for ${spec.id}: target must not have keyword '${kw}'`);
          }
        }
      }
    }
  }
}
