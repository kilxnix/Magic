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

  return card.isCommander === true
    || owner.commanderInstanceId === cardInstanceId
    || owner.commanderInstanceIds?.includes(cardInstanceId) === true;
}

/**
 * Apply the commander replacement rule when moving a card to graveyard, exile,
 * hand, or library.
 * If the card is a commander, it can go to the command zone instead.
 *
 * Per MTG rules (903.9a): If a commander would be put into its owner's hand,
 * library, graveyard, or exile from anywhere, that player may put it into the
 * command zone instead.
 *
 * The `ownerChoosesCommandZone` parameter controls whether the owner opts for command zone (CR 903.9a).
 * When null/undefined, we consult `state.commanderZoneReplacementChoices` (keyed by the commander's
 * instanceId — set by the UI prompt), then fall back to a DESTINATION-DEPENDENT default: the NATURAL
 * zone for HAND (so an effect that puts your commander into your hand — e.g. "Lost to the Spirit World"
 * — leaves it in hand for a cheaper recast instead of silently snapping it to the command zone; the
 * player may still opt for the command zone via the prompt), but the command zone for graveyard / exile
 * / library (the player-safe default that never loses the commander to death, exile, or a library tuck
 * when no choice prompt has been answered).
 */
export function getCommanderDestinationZone(
  state: GameState,
  cardInstanceId: string,
  intendedZone: Zone,
  ownerChoosesCommandZone?: boolean,
): Zone {
  // Only applies to graveyard, exile, hand, and library
  if (
    intendedZone !== 'graveyard'
    && intendedZone !== 'exile'
    && intendedZone !== 'hand'
    && intendedZone !== 'library'
  ) {
    return intendedZone;
  }

  // Check if this is the owner's commander
  if (isOwnersCommander(state, cardInstanceId)) {
    const explicit = state.commanderZoneReplacementChoices?.[cardInstanceId];
    // Hand → keep in hand by default (cheaper recast, the user's case); everything
    // else (graveyard/exile/library) → command zone so the commander is never lost
    // when no choice prompt has been answered.
    const defaultChoice = intendedZone !== 'hand';
    const choosesCommandZone = ownerChoosesCommandZone ?? explicit ?? defaultChoice;
    if (choosesCommandZone) {
      return 'command';
    }
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
  intendedZone: Zone,
  ownerChoosesCommandZone?: boolean,
): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card) return state;

  const finalZone = getCommanderDestinationZone(state, cardInstanceId, intendedZone, ownerChoosesCommandZone);

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
