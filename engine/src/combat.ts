import { AttackerDeclaration, BlockerDeclaration, CombatState, GameState } from './types';
import { getCardDefinition, getPlayer } from './game-state';
import {
  canAttackThisTurn,
  shouldTapWhenAttacking,
  canBlock,
  satisfiesMenace,
  instanceHasKeyword,
  isLethalDamage,
} from './keywords';

export function canDeclareAttacker(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (state.activePlayerIndex !== playerIndex) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'battlefield') return false;
  if (card.tapped) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('creature')) return false;

  // Use keyword helpers for defender/haste/summoning sickness
  if (!canAttackThisTurn(state, cardInstanceId)) return false;

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

  // Tap attackers (unless they have vigilance)
  const newCards = new Map(state.cards);
  for (const attack of attacks) {
    const card = newCards.get(attack.cardInstanceId)!;
    if (shouldTapWhenAttacking(state, attack.cardInstanceId)) {
      newCards.set(attack.cardInstanceId, { ...card, tapped: true });
    }
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

  // Check flying/reach restrictions
  if (!canBlock(state, cardInstanceId, attackerInstanceId)) return false;

  return true;
}

export function declareBlockers(state: GameState, playerId: string, blocks: BlockerDeclaration[]): GameState {
  if (!state.combat) throw new Error('No combat state');

  for (const block of blocks) {
    if (!canDeclareBlocker(state, playerId, block.cardInstanceId, block.blockingAttackerId)) {
      throw new Error(`Cannot declare blocker: ${block.cardInstanceId}`);
    }
  }

  // Calculate updated blockers list
  const newBlockers = [...state.combat.blockers, ...blocks];

  // Validate menace for each attacker
  for (const attacker of state.combat.attackers) {
    const blockerIds = newBlockers
      .filter(b => b.blockingAttackerId === attacker.cardInstanceId)
      .map(b => b.cardInstanceId);

    if (!satisfiesMenace(state, attacker.cardInstanceId, blockerIds)) {
      throw new Error(`Menace creature ${attacker.cardInstanceId} requires 2+ blockers`);
    }
  }

  const combat: CombatState = {
    ...state.combat,
    blockers: newBlockers,
  };

  return {
    ...state,
    combat,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}

/**
 * Helper to apply lifelink: when a creature with lifelink deals damage,
 * its controller gains that much life.
 */
function applyLifelink(
  state: GameState,
  newPlayers: ReturnType<typeof state.players.map>,
  sourceId: string,
  damageDealt: number,
): void {
  if (damageDealt <= 0) return;
  if (!instanceHasKeyword(state, sourceId, 'Lifelink')) return;

  const sourceCard = state.cards.get(sourceId);
  if (!sourceCard) return;

  const ownerIndex = newPlayers.findIndex(p => p.id === sourceCard.ownerId);
  if (ownerIndex !== -1) {
    newPlayers[ownerIndex].life += damageDealt;
  }
}

/**
 * Track commander damage dealt to a player in combat.
 * If the source is a commander, add the damage to the defender's commanderDamage record.
 */
function trackCommanderDamage(
  state: GameState,
  newPlayers: ReturnType<typeof state.players.map>,
  sourceId: string,
  defenderId: string,
  damageDealt: number,
): void {
  if (damageDealt <= 0) return;

  const sourceCard = state.cards.get(sourceId);
  if (!sourceCard || !sourceCard.isCommander) return;

  const defenderIndex = newPlayers.findIndex(p => p.id === defenderId);
  if (defenderIndex === -1) return;

  const currentDamage = newPlayers[defenderIndex].commanderDamage[sourceId] ?? 0;
  newPlayers[defenderIndex].commanderDamage = {
    ...newPlayers[defenderIndex].commanderDamage,
    [sourceId]: currentDamage + damageDealt,
  };
}

/**
 * Calculate lethal damage considering deathtouch.
 * Returns 1 for deathtouch (minimum lethal), otherwise returns remaining toughness.
 */
function getLethalDamageAmount(
  state: GameState,
  sourceId: string,
  targetId: string,
): number {
  const target = state.cards.get(targetId);
  if (!target) return 0;

  const def = state.cardDefinitions.get(target.definitionId);
  if (!def) return 0;

  const toughness = def.toughness ?? 0;
  const remainingToughness = toughness - target.damage;

  // Deathtouch: 1 damage is lethal
  if (instanceHasKeyword(state, sourceId, 'Deathtouch')) {
    return Math.min(1, remainingToughness);
  }

  return Math.max(0, remainingToughness);
}

export function resolveCombatDamage(state: GameState): GameState {
  if (!state.combat) throw new Error("No combat state");

  const newCards = new Map(state.cards);
  const newPlayers = state.players.map(p => ({ ...p }));

  // TODO Phase 5: First strike / double strike damage steps
  // For now, all damage happens simultaneously in one step

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
        applyLifelink(state, newPlayers, attacker.cardInstanceId, attackerPower);
        trackCommanderDamage(state, newPlayers, attacker.cardInstanceId, attacker.defendingPlayerId, attackerPower);
      }
    } else {
      // Blocked — deal damage to blockers, handle trample
      let remainingDamage = attackerPower;
      const hasTrample = instanceHasKeyword(state, attacker.cardInstanceId, 'Trample');

      // Deal damage to each blocker (in order)
      for (const blocker of blockers) {
        const blockerCard = newCards.get(blocker.cardInstanceId);
        if (!blockerCard) continue;

        // Calculate how much damage to assign to this blocker
        const lethalAmount = getLethalDamageAmount(state, attacker.cardInstanceId, blocker.cardInstanceId);
        const damageToBlocker = hasTrample
          ? Math.min(lethalAmount, remainingDamage) // Trample: only assign lethal
          : remainingDamage; // Normal: all damage to first blocker

        if (damageToBlocker > 0) {
          newCards.set(blockerCard.instanceId, {
            ...blockerCard,
            damage: blockerCard.damage + damageToBlocker,
          });
          remainingDamage -= damageToBlocker;
          applyLifelink(state, newPlayers, attacker.cardInstanceId, damageToBlocker);
        }

        if (!hasTrample) break; // Without trample, all damage goes to first blocker
      }

      // Trample: excess damage to defending player
      if (hasTrample && remainingDamage > 0) {
        const defenderIndex = newPlayers.findIndex(p => p.id === attacker.defendingPlayerId);
        if (defenderIndex !== -1) {
          newPlayers[defenderIndex].life -= remainingDamage;
          applyLifelink(state, newPlayers, attacker.cardInstanceId, remainingDamage);
          trackCommanderDamage(state, newPlayers, attacker.cardInstanceId, attacker.defendingPlayerId, remainingDamage);
        }
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
        applyLifelink(state, newPlayers, blocker.cardInstanceId, blockerPower);
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
