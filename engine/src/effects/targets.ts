import type { GameState } from '../types';

export type TargetType = 'Creature' | 'Player' | 'Any';

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
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return false;
  return def.card_types.includes('creature');
}

function isAnyTarget(state: GameState, id: string): boolean {
  if (isPlayerId(state, id)) return true;
  return isCreatureOnBattlefield(state, id);
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
      } else if (spec.type === 'Creature') {
        if (!isCreatureOnBattlefield(state, chosenId)) {
          throw new Error(`Invalid target for ${spec.id}: expected creature on battlefield, got ${chosenId}`);
        }
      } else if (spec.type === 'Any') {
        if (!isAnyTarget(state, chosenId)) {
          throw new Error(`Invalid target for ${spec.id}: expected any target, got ${chosenId}`);
        }
      } else {
        // Exhaustiveness
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _never: never = spec.type;
      }

      // Constraints
      if (spec.constraints?.opponentControls) {
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
