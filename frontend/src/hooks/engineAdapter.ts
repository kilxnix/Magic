/**
 * Engine Adapter Layer
 *
 * Bridges the full TypeScript engine types to the frontend's expected types.
 * The engine's CardInstance lacks controllerId/isAttacking/isBlocking/blockedBy,
 * and GameState lacks gameOver/winnerId — this adapter fills those gaps.
 */

import type {
  GameState as EngineGameState,
  CardInstance as EngineCardInstance,
  CardDefinition,
  Player,
  ManaColor,
  ManaPool,
  Zone,
  Phase,
  Step,
  StackItem,
  CombatState,
  AttackerDeclaration,
  BlockerDeclaration,
} from 'commander-engine';

// Re-export engine types that are already compatible
export type {
  CardDefinition,
  ManaColor,
  ManaPool,
  Zone,
  Phase,
  Step,
  AttackerDeclaration,
  BlockerDeclaration,
  CombatState,
};

// Re-export Player as-is (frontend Player type matches engine)
export type { Player };

// ===== Frontend-compatible CardInstance (adds combat flags + controllerId) =====

export interface FrontendCardInstance {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  controllerId: string;   // Engine doesn't have this; defaults to ownerId
  zone: Zone;
  tapped: boolean;
  summoningSick: boolean;
  counters: Record<string, number>;
  damage: number;
  isCommander: boolean;
  isAttacking: boolean;   // Derived from combat state
  isBlocking: string | null; // Derived from combat state (attackerId being blocked)
  blockedBy: string[];    // Derived from combat state
}

// ===== Frontend-compatible StackItem (flat shape for UI) =====

export interface FrontendStackItem {
  id: string;
  cardInstanceId: string;
  casterId: string;
  targets: string[];
  kind?: 'Spell' | 'TriggeredAbility';
}

// ===== Frontend-compatible GameState (adds gameOver/winnerId) =====

export interface FrontendGameState {
  players: Player[];
  cards: Map<string, FrontendCardInstance>;
  cardDefinitions: Map<string, CardDefinition>;
  activePlayerIndex: number;
  priorityPlayerIndex: number;
  phase: Phase;
  step: Step;
  turnNumber: number;
  hasPriorityPassed: boolean[];
  stack: FrontendStackItem[];
  combat: CombatState | null;
  battlefieldAbilities: Map<string, unknown>;
  pendingTriggers: unknown[];
  gameOver: boolean;
  winnerId: string | null;
}

// ===== Adapter Functions =====

/**
 * Adapt a single engine CardInstance to frontend format,
 * adding combat flags derived from the current combat state.
 */
export function adaptCardInstance(
  card: EngineCardInstance,
  combat: CombatState | null,
): FrontendCardInstance {
  let isAttacking = false;
  let isBlocking: string | null = null;
  const blockedBy: string[] = [];

  if (combat) {
    // Check if this card is an attacker
    const attackerDecl = combat.attackers.find(a => a.cardInstanceId === card.instanceId);
    if (attackerDecl) {
      isAttacking = true;
      // Find blockers assigned to this attacker
      for (const blocker of combat.blockers) {
        if (blocker.blockingAttackerId === card.instanceId) {
          blockedBy.push(blocker.cardInstanceId);
        }
      }
    }

    // Check if this card is a blocker
    const blockerDecl = combat.blockers.find(b => b.cardInstanceId === card.instanceId);
    if (blockerDecl) {
      isBlocking = blockerDecl.blockingAttackerId;
    }
  }

  return {
    instanceId: card.instanceId,
    definitionId: card.definitionId,
    ownerId: card.ownerId,
    controllerId: card.ownerId, // Engine doesn't track controllerId separately
    zone: card.zone,
    tapped: card.tapped,
    summoningSick: card.summoningSick,
    counters: card.counters,
    damage: card.damage,
    isCommander: card.isCommander,
    isAttacking,
    isBlocking,
    blockedBy,
  };
}

/**
 * Adapt a StackItem union to flat frontend format.
 */
function adaptStackItem(item: StackItem): FrontendStackItem {
  if (item.kind === 'Spell') {
    return {
      id: item.id,
      cardInstanceId: item.cardInstanceId,
      casterId: item.casterId,
      targets: item.targets,
      kind: 'Spell',
    };
  } else {
    // TriggeredAbility
    return {
      id: item.id,
      cardInstanceId: item.sourceInstanceId,
      casterId: item.controllerId,
      targets: item.targets,
      kind: 'TriggeredAbility',
    };
  }
}

/**
 * Derive gameOver/winnerId from player states.
 */
function deriveGameOver(players: Player[]): { gameOver: boolean; winnerId: string | null } {
  const alive = players.filter(p => !p.hasLost);
  if (alive.length === 1) {
    return { gameOver: true, winnerId: alive[0].id };
  }
  if (alive.length === 0) {
    return { gameOver: true, winnerId: null };
  }
  return { gameOver: false, winnerId: null };
}

/**
 * Adapt full engine GameState to frontend-compatible format.
 */
export function adaptGameState(state: EngineGameState): FrontendGameState {
  const { gameOver, winnerId } = deriveGameOver(state.players);

  // Adapt all card instances
  const frontendCards = new Map<string, FrontendCardInstance>();
  for (const [id, card] of state.cards) {
    frontendCards.set(id, adaptCardInstance(card, state.combat));
  }

  return {
    players: state.players,
    cards: frontendCards,
    cardDefinitions: state.cardDefinitions,
    activePlayerIndex: state.activePlayerIndex,
    priorityPlayerIndex: state.priorityPlayerIndex,
    phase: state.phase,
    step: state.step,
    turnNumber: state.turnNumber,
    hasPriorityPassed: state.hasPriorityPassed,
    stack: state.stack.map(adaptStackItem),
    combat: state.combat,
    battlefieldAbilities: state.battlefieldAbilities as Map<string, unknown>,
    pendingTriggers: state.pendingTriggers as unknown[],
    gameOver,
    winnerId,
  };
}

/**
 * Get all cards in a zone for a player from adapted state.
 */
export function getCardsInZoneAdapted(
  state: FrontendGameState,
  playerId: string,
  zone: Zone,
): FrontendCardInstance[] {
  const result: FrontendCardInstance[] = [];
  state.cards.forEach(card => {
    if ((card.ownerId === playerId || card.controllerId === playerId) && card.zone === zone) {
      result.push(card);
    }
  });
  return result;
}
