/**
 * useGameEngine
 *
 * Core hook for game engine integration. Manages game state and
 * provides action dispatchers for player interactions.
 */

import { useState, useCallback } from 'react';
import type {
  GameState,
  CardInstance,
  Zone,
  ManaColor,
  AttackerDeclaration,
  BlockerDeclaration,
  AIAction,
  DeckInput,
} from '@/types';
import { initGameState, getCardsInZone, getCardDefinition } from '@engine/game-state';
import { playLand, tapLandForMana } from '@engine/actions';
import { castSpell } from '@engine/stack';
import { declareAttackers, declareBlockers } from '@engine/combat';
import { passPriority } from '@engine/priority';
import { advanceStep } from '@engine/turn-manager';
import { checkStateBasedActions } from '@engine/state-based';
import { getLegalActions } from '@engine/ai/legal-actions';

export interface UseGameEngineResult {
  // State
  gameState: GameState | null;
  humanPlayerId: string;
  isLoading: boolean;
  error: string | null;

  // Initialization
  initGame: (decks: DeckInput[], humanPlayerId: string) => void;
  setGameState: (state: GameState) => void;

  // Actions
  playLand: (cardInstanceId: string) => void;
  castSpell: (cardInstanceId: string, targets: string[]) => void;
  activateMana: (cardInstanceId: string, color: ManaColor) => void;
  tapPermanent: (cardInstanceId: string) => void;
  declareAttackers: (attacks: AttackerDeclaration[]) => void;
  declareBlockers: (blocks: BlockerDeclaration[]) => void;
  passPriority: () => void;
  advanceStep: () => void;

  // Queries
  canPlayLand: (cardInstanceId: string) => boolean;
  canCastSpell: (cardInstanceId: string) => boolean;
  getLegalActions: () => AIAction[];
  getCardsInZone: (playerId: string, zone: Zone) => CardInstance[];
}

export function useGameEngine(): UseGameEngineResult {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [humanPlayerId, setHumanPlayerId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize game with decks
  const initGame = useCallback((decks: DeckInput[], playerId: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const state = initGameState(decks);
      setGameState(state);
      setHumanPlayerId(playerId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to initialize game');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Play a land
  const handlePlayLand = useCallback((cardInstanceId: string) => {
    if (!gameState) return;
    try {
      let newState = playLand(gameState, humanPlayerId, cardInstanceId);
      newState = checkStateBasedActions(newState);
      setGameState(newState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to play land');
    }
  }, [gameState, humanPlayerId]);

  // Cast a spell
  const handleCastSpell = useCallback((cardInstanceId: string, targets: string[]) => {
    if (!gameState) return;
    try {
      let newState = castSpell(gameState, humanPlayerId, cardInstanceId, targets);
      newState = checkStateBasedActions(newState);
      setGameState(newState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cast spell');
    }
  }, [gameState, humanPlayerId]);

  // Activate mana ability (tap land for mana)
  const handleActivateMana = useCallback((cardInstanceId: string, color: ManaColor) => {
    if (!gameState) return;
    try {
      const newState = tapLandForMana(gameState, humanPlayerId, cardInstanceId, color);
      setGameState(newState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to activate mana');
    }
  }, [gameState, humanPlayerId]);

  // Tap a permanent (for mana abilities this calls activateMana, otherwise just taps)
  const handleTapPermanent = useCallback((cardInstanceId: string) => {
    if (!gameState) return;
    const card = gameState.cards.get(cardInstanceId);
    if (!card) return;

    const def = getCardDefinition(gameState, card);

    // If it's a land, tap for mana
    if (def.card_types.includes('land')) {
      // Determine mana color from color identity or default to colorless
      const color: ManaColor = def.color_identity[0] || 'C';
      handleActivateMana(cardInstanceId, color);
    } else {
      // For other permanents, just toggle tapped state (placeholder for abilities)
      const updatedCards = new Map(gameState.cards);
      updatedCards.set(cardInstanceId, { ...card, tapped: !card.tapped });
      setGameState({ ...gameState, cards: updatedCards });
    }
  }, [gameState, handleActivateMana]);

  // Declare attackers
  const handleDeclareAttackers = useCallback((attacks: AttackerDeclaration[]) => {
    if (!gameState) return;
    try {
      let newState = declareAttackers(gameState, humanPlayerId, attacks);
      newState = checkStateBasedActions(newState);
      setGameState(newState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to declare attackers');
    }
  }, [gameState, humanPlayerId]);

  // Declare blockers
  const handleDeclareBlockers = useCallback((blocks: BlockerDeclaration[]) => {
    if (!gameState) return;
    try {
      let newState = declareBlockers(gameState, humanPlayerId, blocks);
      newState = checkStateBasedActions(newState);
      setGameState(newState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to declare blockers');
    }
  }, [gameState, humanPlayerId]);

  // Pass priority
  const handlePassPriority = useCallback(() => {
    if (!gameState) return;
    try {
      let newState = passPriority(gameState);
      newState = checkStateBasedActions(newState);
      setGameState(newState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pass priority');
    }
  }, [gameState]);

  // Advance to next step
  const handleAdvanceStep = useCallback(() => {
    if (!gameState) return;
    try {
      let newState = advanceStep(gameState);
      newState = checkStateBasedActions(newState);
      setGameState(newState);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to advance step');
    }
  }, [gameState]);

  // Check if player can play a land
  const canPlayLand = useCallback((cardInstanceId: string): boolean => {
    if (!gameState) return false;
    const player = gameState.players.find(p => p.id === humanPlayerId);
    if (!player || player.hasPlayedLand) return false;

    const card = gameState.cards.get(cardInstanceId);
    if (!card || card.zone !== 'hand') return false;

    const def = gameState.cardDefinitions.get(card.definitionId);
    if (!def?.card_types.includes('land')) return false;

    // Can only play lands in main phase with empty stack
    const isMainPhase = gameState.phase === 'precombat_main' || gameState.phase === 'postcombat_main';
    const isActivePlayer = gameState.players[gameState.activePlayerIndex]?.id === humanPlayerId;

    return isMainPhase && isActivePlayer && gameState.stack.length === 0;
  }, [gameState, humanPlayerId]);

  // Check if player can cast a spell
  const canCastSpell = useCallback((cardInstanceId: string): boolean => {
    if (!gameState) return false;
    const actions = getLegalActions(gameState, humanPlayerId);
    return actions.some(a => a.kind === 'CastSpell' && a.cardInstanceId === cardInstanceId);
  }, [gameState, humanPlayerId]);

  // Get legal actions for current player
  const handleGetLegalActions = useCallback((): AIAction[] => {
    if (!gameState) return [];
    return getLegalActions(gameState, humanPlayerId);
  }, [gameState, humanPlayerId]);

  // Get cards in a zone
  const handleGetCardsInZone = useCallback((playerId: string, zone: Zone): CardInstance[] => {
    if (!gameState) return [];
    return getCardsInZone(gameState, playerId, zone);
  }, [gameState]);

  return {
    gameState,
    humanPlayerId,
    isLoading,
    error,
    initGame,
    setGameState,
    playLand: handlePlayLand,
    castSpell: handleCastSpell,
    activateMana: handleActivateMana,
    tapPermanent: handleTapPermanent,
    declareAttackers: handleDeclareAttackers,
    declareBlockers: handleDeclareBlockers,
    passPriority: handlePassPriority,
    advanceStep: handleAdvanceStep,
    canPlayLand,
    canCastSpell,
    getLegalActions: handleGetLegalActions,
    getCardsInZone: handleGetCardsInZone,
  };
}
