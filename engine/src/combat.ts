import { AttackerDeclaration, BlockerDeclaration, CombatState, GameState } from './types';
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

export function canDeclareBlocker(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  attackerInstanceId: string
): boolean {
  if (!state.combat) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'battlefield') return false;
  if (card.tapped) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('creature')) return false;

  // Can only block attackers targeting you
  const attacker = state.combat.attackers.find(a => a.cardInstanceId === attackerInstanceId);
  if (!attacker) return false;
  if (attacker.defendingPlayerId !== playerId) return false;

  return true;
}

export function declareBlockers(state: GameState, playerId: string, blocks: BlockerDeclaration[]): GameState {
  if (!state.combat) throw new Error('No combat state');

  for (const block of blocks) {
    if (!canDeclareBlocker(state, playerId, block.cardInstanceId, block.blockingAttackerId)) {
      throw new Error(`Cannot declare blocker: ${block.cardInstanceId}`);
    }
  }

  const combat: CombatState = {
    ...state.combat,
    blockers: [...state.combat.blockers, ...blocks],
  };

  return {
    ...state,
    combat,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}

export function resolveCombatDamage(state: GameState): GameState {
  if (!state.combat) throw new Error("No combat state");

  const newCards = new Map(state.cards);
  const newPlayers = state.players.map(p => ({ ...p }));

  for (const attacker of state.combat.attackers) {
    const attackerCard = newCards.get(attacker.cardInstanceId);
    if (!attackerCard) continue;

    const attackerDef = state.cardDefinitions.get(attackerCard.definitionId);
    const attackerPower = attackerDef?.power ?? 0;

    // Find blockers for this attacker
    const blockers = state.combat.blockers.filter(b => b.blockingAttackerId === attacker.cardInstanceId);

    if (blockers.length === 0) {
      // Unblocked — deal damage to defending player
      const defenderIndex = newPlayers.findIndex(p => p.id === attacker.defendingPlayerId);
      if (defenderIndex !== -1) {
        newPlayers[defenderIndex].life -= attackerPower;
      }
    } else {
      // Blocked — deal damage to first blocker (simplified)
      const firstBlocker = newCards.get(blockers[0].cardInstanceId);
      if (firstBlocker) {
        newCards.set(firstBlocker.instanceId, {
          ...firstBlocker,
          damage: firstBlocker.damage + attackerPower,
        });
      }

      // Each blocker deals damage back to attacker
      for (const blocker of blockers) {
        const blockerCard = newCards.get(blocker.cardInstanceId);
        if (!blockerCard) continue;

        const blockerDef = state.cardDefinitions.get(blockerCard.definitionId);
        const blockerPower = blockerDef?.power ?? 0;

        const currentAttacker = newCards.get(attacker.cardInstanceId);
        if (!currentAttacker) continue;

        newCards.set(attacker.cardInstanceId, {
          ...currentAttacker,
          damage: currentAttacker.damage + blockerPower,
        });
      }
    }
  }

  return {
    ...state,
    cards: newCards,
    players: newPlayers,
    combat: null,
  };
}
