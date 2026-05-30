import { isSpellStackItem, type GameState } from '../types';
import {
  canBeTargetedByOpponent,
  canBeTargetedByController,
  isProtectedFromSource,
} from '../keywords';
import { isEffectiveCreature } from '../effective-types';
import { getCardDefinition } from '../game-state';

export type TargetType = 'Creature' | 'Player' | 'Any' | 'Permanent' | 'Land' | 'Artifact' | 'Enchantment' | 'ArtifactOrEnchantment' | 'ArtifactEnchantmentOrLand' | 'NonlandPermanent' | 'Spell' | 'NoncreatureSpell' | 'CreatureSpell' | 'CreatureOrEnchantmentSpell' | 'ArtifactOrCreatureSpell' | 'InstantOrSorcerySpell' | 'CardInGraveyard' | 'CreatureCardInGraveyard' | 'CreatureOrEnchantmentCardInGraveyard';

export interface TargetSpec {
  /** Stable id for mapping spec -> StackItem.targets position */
  id: string;
  type: TargetType;
  /** Number of choices required for this spec (v0 is usually 1) */
  count: number;
  constraints?: {
    opponentControls?: boolean;
    controllerControls?: boolean;
    notSource?: boolean;
    colors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
    notColors?: Array<'W' | 'U' | 'B' | 'R' | 'G'>;
    cmc?: { op: 'eq' | 'lte' | 'gte'; value: number };
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
  targetType: Extract<TargetType, 'Spell' | 'NoncreatureSpell' | 'CreatureSpell' | 'CreatureOrEnchantmentSpell' | 'ArtifactOrCreatureSpell' | 'InstantOrSorcerySpell'>,
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
    return !isCreatureSpell;
  }
  return false;
}

function matchesCmcConstraint(value: number, constraint: NonNullable<TargetSpec['constraints']>['cmc']): boolean {
  if (!constraint) return true;
  if (constraint.op === 'eq') return value === constraint.value;
  if (constraint.op === 'lte') return value <= constraint.value;
  return value >= constraint.value;
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
  if (chosenIds.length !== expectedTotal) {
    throw new Error(`Expected ${expectedTotal} target choice(s), got ${chosenIds.length}`);
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
      } else if (spec.type === 'Creature') {
        if (!isCreatureOnBattlefield(state, chosenId)) {
          throw new Error(`Invalid target for ${spec.id}: expected creature on battlefield, got ${chosenId}`);
        }
      } else if (spec.type === 'Any') {
        if (!isAnyTarget(state, chosenId)) {
          throw new Error(`Invalid target for ${spec.id}: expected any target, got ${chosenId}`);
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
      } else if (
        spec.type === 'Spell'
        || spec.type === 'NoncreatureSpell'
        || spec.type === 'CreatureSpell'
        || spec.type === 'CreatureOrEnchantmentSpell'
        || spec.type === 'ArtifactOrCreatureSpell'
        || spec.type === 'InstantOrSorcerySpell'
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
    }
  }
}
