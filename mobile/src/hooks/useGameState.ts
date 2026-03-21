/**
 * useGameState
 *
 * Derived state selectors from GameState. Provides convenient access
 * to commonly needed game information.
 */

import { useMemo } from 'react';
import type {
  GameState,
  Player,
  CardInstance,
  CardDefinition,
  Phase,
  Step,
  StackItem,
  CombatState,
} from '@/types';
import { getCardsInZone, getCardDefinition } from '@engine/game-state';

export interface UseGameStateResult {
  // Player info
  humanPlayer: Player | null;
  opponents: Player[];
  activePlayer: Player | null;
  priorityPlayer: Player | null;

  // Zone contents (for human player)
  hand: CardInstance[];
  battlefield: CardInstance[];
  graveyard: CardInstance[];
  exile: CardInstance[];
  commandZone: CardInstance[];
  library: CardInstance[];

  // Organized battlefield
  lands: CardInstance[];
  creatures: CardInstance[];
  otherPermanents: CardInstance[];

  // Game state flags
  isYourTurn: boolean;
  hasYourPriority: boolean;
  currentPhase: Phase;
  currentStep: Step;
  turnNumber: number;

  // Stack
  stackItems: StackItem[];
  hasStackItems: boolean;

  // Combat
  combatState: CombatState | null;
  isInCombat: boolean;
  isDeclareAttackersStep: boolean;
  isDeclareBlockersStep: boolean;

  // Helper to get card definition
  getDefinition: (card: CardInstance) => CardDefinition | undefined;
}

const defaultState: UseGameStateResult = {
  humanPlayer: null,
  opponents: [],
  activePlayer: null,
  priorityPlayer: null,
  hand: [],
  battlefield: [],
  graveyard: [],
  exile: [],
  commandZone: [],
  library: [],
  lands: [],
  creatures: [],
  otherPermanents: [],
  isYourTurn: false,
  hasYourPriority: false,
  currentPhase: 'beginning',
  currentStep: 'untap',
  turnNumber: 1,
  stackItems: [],
  hasStackItems: false,
  combatState: null,
  isInCombat: false,
  isDeclareAttackersStep: false,
  isDeclareBlockersStep: false,
  getDefinition: () => undefined,
};

export function useGameState(
  gameState: GameState | null,
  humanPlayerId: string
): UseGameStateResult {
  return useMemo(() => {
    if (!gameState) return defaultState;

    // Player info
    const humanPlayer = gameState.players.find(p => p.id === humanPlayerId) ?? null;
    const opponents = gameState.players.filter(p => p.id !== humanPlayerId && !p.hasLost);
    const activePlayer = gameState.players[gameState.activePlayerIndex] ?? null;
    const priorityPlayer = gameState.players[gameState.priorityPlayerIndex] ?? null;

    // Zone contents
    const hand = getCardsInZone(gameState, humanPlayerId, 'hand');
    const battlefield = getCardsInZone(gameState, humanPlayerId, 'battlefield');
    const graveyard = getCardsInZone(gameState, humanPlayerId, 'graveyard');
    const exile = getCardsInZone(gameState, humanPlayerId, 'exile');
    const commandZone = getCardsInZone(gameState, humanPlayerId, 'command');
    const library = getCardsInZone(gameState, humanPlayerId, 'library');

    // Categorize battlefield permanents
    const lands: CardInstance[] = [];
    const creatures: CardInstance[] = [];
    const otherPermanents: CardInstance[] = [];

    for (const card of battlefield) {
      const def = gameState.cardDefinitions.get(card.definitionId);
      if (!def) continue;

      if (def.card_types.includes('land')) {
        lands.push(card);
      } else if (def.card_types.includes('creature')) {
        creatures.push(card);
      } else {
        otherPermanents.push(card);
      }
    }

    // Game state flags
    const isYourTurn = activePlayer?.id === humanPlayerId;
    const hasYourPriority = priorityPlayer?.id === humanPlayerId;

    // Combat state
    const isInCombat = gameState.phase === 'combat';
    const isDeclareAttackersStep = gameState.step === 'declare_attackers';
    const isDeclareBlockersStep = gameState.step === 'declare_blockers';

    // Helper function
    const getDefinition = (card: CardInstance): CardDefinition | undefined => {
      return gameState.cardDefinitions.get(card.definitionId);
    };

    return {
      humanPlayer,
      opponents,
      activePlayer,
      priorityPlayer,
      hand,
      battlefield,
      graveyard,
      exile,
      commandZone,
      library,
      lands,
      creatures,
      otherPermanents,
      isYourTurn,
      hasYourPriority,
      currentPhase: gameState.phase,
      currentStep: gameState.step,
      turnNumber: gameState.turnNumber,
      stackItems: gameState.stack,
      hasStackItems: gameState.stack.length > 0,
      combatState: gameState.combat,
      isInCombat,
      isDeclareAttackersStep,
      isDeclareBlockersStep,
      getDefinition,
    };
  }, [gameState, humanPlayerId]);
}
