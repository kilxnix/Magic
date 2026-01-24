import { AttackerDeclaration, CombatState, GameState } from './types';
import { getCardDefinition, getPlayer } from './game-state';

export function canDeclareAttacker(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (state.activePlayerIndex !== playerIndex) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'battlefield') return false;
  if (card.tapped) return false;
  if (card.summoningSick) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('creature')) return false;
  if (def.keywords.includes('Defender')) return false;

  return true;
}

export function declareAttackers(state: GameState, playerId: string, attacks: AttackerDeclaration[]): GameState {
  // Validate all attackers
  for (const attack of attacks) {
    // Defending player must exist
    getPlayer(state, attack.defendingPlayerId);

    if (!canDeclareAttacker(state, playerId, attack.cardInstanceId)) {
      throw new Error(`Cannot declare attacker: ${attack.cardInstanceId}`);
    }
  }

  // Tap all attackers
  const newCards = new Map(state.cards);
  for (const attack of attacks) {
    const card = newCards.get(attack.cardInstanceId)!;
    newCards.set(attack.cardInstanceId, { ...card, tapped: true });
  }

  const combat: CombatState = {
    attackers: attacks,
    blockers: [],
    damageAssignment: new Map(),
  };

  return {
    ...state,
    cards: newCards,
    combat,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
