import { GameState, CardInstance, Zone } from './types';

/**
 * Commander replacement rule: If a commander would be put into the graveyard or exile
 * from anywhere, its owner may put it into the command zone instead.
 *
 * In this implementation, we always apply the replacement (owner always chooses command zone).
 * This is the standard behavior in most Commander games.
 */

/**
 * Check if a card is its owner's commander.
 */
export function isOwnersCommander(state: GameState, cardInstanceId: string): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card) return false;

  const owner = state.players.find(p => p.id === card.ownerId);
  if (!owner) return false;

  return owner.commanderInstanceId === cardInstanceId;
}

/**
 * Apply the commander replacement rule when moving a card to graveyard or exile.
 * If the card is a commander, it goes to the command zone instead.
 *
 * Returns the appropriate destination zone.
 */
export function getCommanderDestinationZone(
  state: GameState,
  cardInstanceId: string,
  intendedZone: Zone
): Zone {
  // Only applies to graveyard and exile
  if (intendedZone !== 'graveyard' && intendedZone !== 'exile') {
    return intendedZone;
  }

  // Check if this is the owner's commander
  if (isOwnersCommander(state, cardInstanceId)) {
    return 'command';
  }

  return intendedZone;
}

/**
 * Move a card to a new zone, applying the commander replacement rule if applicable.
 * Clears damage and tapped status when leaving the battlefield.
 */
export function moveCardWithCommanderReplacement(
  state: GameState,
  cardInstanceId: string,
  intendedZone: Zone
): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card) return state;

  const finalZone = getCommanderDestinationZone(state, cardInstanceId, intendedZone);

  const newCards = new Map(state.cards);
  const updatedCard: CardInstance = {
    ...card,
    zone: finalZone,
    // Reset battlefield-specific state when leaving
    damage: finalZone === 'battlefield' ? card.damage : 0,
    tapped: finalZone === 'battlefield' ? card.tapped : false,
    summoningSick: finalZone === 'battlefield' ? card.summoningSick : true,
  };

  newCards.set(cardInstanceId, updatedCard);

  return {
    ...state,
    cards: newCards,
  };
}

/**
 * Process all pending zone changes with commander replacement.
 * Takes a list of (cardInstanceId, intendedZone) pairs and applies them all.
 */
export function processZoneChangesWithCommanderReplacement(
  state: GameState,
  changes: Array<{ cardInstanceId: string; intendedZone: Zone }>
): GameState {
  let newState = state;

  for (const { cardInstanceId, intendedZone } of changes) {
    newState = moveCardWithCommanderReplacement(newState, cardInstanceId, intendedZone);
  }

  return newState;
}
