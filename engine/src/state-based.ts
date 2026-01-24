import { GameState } from './types';

export function checkStateBasedActions(state: GameState): GameState {
  const newCards = new Map(state.cards);
  const newPlayers = state.players.map(p => ({ ...p }));

  // Creatures with lethal damage die
  for (const [id, card] of newCards) {
    if (card.zone !== 'battlefield') continue;

    const def = state.cardDefinitions.get(card.definitionId);
    if (!def || !def.card_types.includes('creature')) continue;

    const toughness = def.toughness ?? 0;
    if (card.damage >= toughness) {
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
