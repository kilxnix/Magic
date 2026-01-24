import { GameState, ManaColor, Phase } from './types';
import { getCardDefinition, getCardsInZone } from './game-state';
import { addMana } from './mana';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];

export function canPlayLand(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return false;

  if (state.activePlayerIndex !== playerIndex) return false;
  if (!MAIN_PHASES.includes(state.phase)) return false;
  if (state.players[playerIndex].hasPlayedLand) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card || card.zone !== 'hand' || card.ownerId !== playerId) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('land')) return false;

  return true;
}

export function playLand(state: GameState, playerId: string, cardInstanceId: string): GameState {
  if (!canPlayLand(state, playerId, cardInstanceId)) {
    throw new Error('Cannot play land');
  }

  const newCards = new Map(state.cards);
  const card = newCards.get(cardInstanceId)!;
  newCards.set(cardInstanceId, { ...card, zone: 'battlefield', tapped: false, summoningSick: false });

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hasPlayedLand: true } : p
  );

  return { ...state, cards: newCards, players: newPlayers };
}

export function tapLandForMana(state: GameState, playerId: string, cardInstanceId: string, color: ManaColor): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card) throw new Error('Card not found');
  if (card.ownerId !== playerId) throw new Error('Not your card');
  if (card.zone !== 'battlefield') throw new Error('Card not on battlefield');
  if (card.tapped) throw new Error('Card already tapped');

  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, tapped: true });

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, manaPool: addMana(p.manaPool, color, 1) } : p
  );

  return { ...state, cards: newCards, players: newPlayers };
}

export function drawCards(state: GameState, playerId: string, count: number): GameState {
  const library = getCardsInZone(state, playerId, 'library');
  const toDraw = Math.min(count, library.length);

  const newCards = new Map(state.cards);
  for (let i = 0; i < toDraw; i++) {
    const card = library[i];
    newCards.set(card.instanceId, { ...card, zone: 'hand' });
  }

  return { ...state, cards: newCards };
}
