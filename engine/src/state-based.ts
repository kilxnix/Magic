import { GameState } from './types';
import { isIndestructible } from './keywords';

export function checkStateBasedActions(state: GameState): GameState {
  const newCards = new Map(state.cards);
  const newPlayers = state.players.map(p => ({ ...p }));

  // Creatures with lethal damage die (unless indestructible)
  for (const [id, card] of newCards) {
    if (card.zone !== 'battlefield') continue;

    const def = state.cardDefinitions.get(card.definitionId);
    if (!def || !def.card_types.includes('creature')) continue;

    const toughness = def.toughness ?? 0;

    // Check for lethal damage
    if (card.damage >= toughness) {
      // Indestructible creatures don't die from damage
      if (!isIndestructible(state, id)) {
        newCards.set(id, { ...card, zone: 'graveyard', damage: 0, tapped: false });
      }
    }
  }

  // Creatures with 0 or less toughness die (even if indestructible)
  // This handles effects like -X/-X that reduce toughness
  for (const [id, card] of newCards) {
    if (card.zone !== 'battlefield') continue;

    const def = state.cardDefinitions.get(card.definitionId);
    if (!def || !def.card_types.includes('creature')) continue;

    const toughness = def.toughness ?? 0;
    // TODO: Factor in +1/+1 and -1/-1 counters and continuous effects
    if (toughness <= 0) {
      newCards.set(id, { ...card, zone: 'graveyard', damage: 0, tapped: false });
    }
  }

  // Players at 0 or less life lose
  for (let i = 0; i < newPlayers.length; i++) {
    if (!newPlayers[i].hasLost && newPlayers[i].life <= 0) {
      newPlayers[i].hasLost = true;
    }
  }

  return { ...state, cards: newCards, players: newPlayers };
}

export function cleanupDamage(state: GameState): GameState {
  const newCards = new Map(state.cards);

  for (const [id, card] of newCards) {
    if (card.zone === 'battlefield' && card.damage > 0) {
      newCards.set(id, { ...card, damage: 0 });
    }
  }

  return { ...state, cards: newCards };
}
