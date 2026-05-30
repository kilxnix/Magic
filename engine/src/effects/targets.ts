import { isSpellStackItem, type GameState } from '../types';
import { canBeTargetedByOpponent, canBeTargetedByController } from '../keywords';
import { isEffectiveCreature } from '../effective-types';

export type TargetType = 'Creature' | 'Player' | 'Any' | 'Permanent' | 'Artifact' | 'Enchantment' | 'ArtifactOrEnchantment' | 'ArtifactEnchantmentOrLand' | 'NonlandPermanent' | 'Spell' | 'NoncreatureSpell' | 'CreatureSpell' | 'InstantOrSorcerySpell' | 'CreatureCardInGraveyard';

export interface TargetSpec {
  /** Stable id for mapping spec -> StackItem.targets position */
  id: string;
  type: TargetType;
  /** Number of choices required for this spec (v0 is usually 1) */
  count: number;
  constraints?: {
    opponentControls?: boolean;
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
  targetType: Extract<TargetType, 'Spell' | 'NoncreatureSpell' | 'CreatureSpell' | 'InstantOrSorcerySpell'>,
): boolean {
  for (const item of state.stack) {
    if (!isSpellStackItem(item)) continue;
    if (item.id !== id && item.cardInstanceId !== id) continue;

    if (targetType === 'Spell') return true;

    const card = state.cards.get(item.cardInstanceId);
    const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
    if (!def) return false;

    const isCreatureSpell = def.card_types.includes('creature');
    if (targetType === 'CreatureSpell') return isCreatureSpell;
    if (targetType === 'InstantOrSorcerySpell') {
      return def.card_types.includes('instant') || def.card_types.includes('sorcery');
    }
    return !isCreatureSpell;
  }
  return false;
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
): void {
  const expectedTotal = specs.reduce((sum, s) => sum + s.count, 0);
  if (chosenIds.length !== expectedTotal) {
    throw new Error(`Expected ${expectedTotal} target choice(s), got ${chosenIds.length}`);
  }

  let offset = 0;
  for (const spec of specs) {
    const slice = chosenIds.slice(offset, offset + spec.count);
    offset += spec.count;

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
      } else if (spec.type === 'Permanent' || spec.type === 'NonlandPermanent') {
        // Any permanent on the battlefield
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected permanent on battlefield, got ${chosenId}`);
        }
        if (spec.type === 'NonlandPermanent') {
          const def = state.cardDefinitions.get(card.definitionId);
          if (def && def.card_types.includes('land')) {
            throw new Error(`Invalid target for ${spec.id}: expected nonland permanent, got land`);
          }
        }
      } else if (spec.type === 'Artifact') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected artifact on battlefield, got ${chosenId}`);
        }
        const def = state.cardDefinitions.get(card.definitionId);
        if (!def || !def.card_types.includes('artifact')) {
          throw new Error(`Invalid target for ${spec.id}: expected artifact, got ${chosenId}`);
        }
      } else if (spec.type === 'Enchantment') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected enchantment on battlefield, got ${chosenId}`);
        }
        const def = state.cardDefinitions.get(card.definitionId);
        if (!def || !def.card_types.includes('enchantment')) {
          throw new Error(`Invalid target for ${spec.id}: expected enchantment, got ${chosenId}`);
        }
      } else if (spec.type === 'ArtifactOrEnchantment') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected artifact or enchantment on battlefield, got ${chosenId}`);
        }
        const def = state.cardDefinitions.get(card.definitionId);
        if (!def || (!def.card_types.includes('artifact') && !def.card_types.includes('enchantment'))) {
          throw new Error(`Invalid target for ${spec.id}: expected artifact or enchantment, got ${chosenId}`);
        }
      } else if (spec.type === 'ArtifactEnchantmentOrLand') {
        const card = state.cards.get(chosenId);
        if (!card || card.zone !== 'battlefield') {
          throw new Error(`Invalid target for ${spec.id}: expected artifact, enchantment, or land on battlefield, got ${chosenId}`);
        }
        const def = state.cardDefinitions.get(card.definitionId);
        if (!def || (!def.card_types.includes('artifact') && !def.card_types.includes('enchantment') && !def.card_types.includes('land'))) {
          throw new Error(`Invalid target for ${spec.id}: expected artifact, enchantment, or land, got ${chosenId}`);
        }
      } else if (spec.type === 'Spell' || spec.type === 'NoncreatureSpell' || spec.type === 'CreatureSpell' || spec.type === 'InstantOrSorcerySpell') {
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
        const def = state.cardDefinitions.get(card.definitionId);
        if (!def || !def.card_types.includes('creature')) {
          throw new Error(`Invalid target for ${spec.id}: expected creature card in graveyard, got ${chosenId}`);
        }
      }

      // Check hexproof/shroud for permanent targets
      const targetCard = state.cards.get(chosenId);
      if (targetCard && targetCard.zone === 'battlefield') {
        const isOwnedByCaster = targetCard.ownerId === casterId;
        if (isOwnedByCaster) {
          // Controller targeting their own permanent - only shroud blocks this
          if (!canBeTargetedByController(state, chosenId)) {
            throw new Error(`Invalid target for ${spec.id}: target has shroud`);
          }
        } else {
          // Opponent targeting - hexproof and shroud both block this
          if (!canBeTargetedByOpponent(state, chosenId)) {
            throw new Error(`Invalid target for ${spec.id}: target has hexproof or shroud`);
          }
        }
      }

      // Constraints
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
    }
  }
}
