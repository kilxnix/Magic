/**
 * useCombat
 *
 * Manages combat phase state for attacker/blocker declarations.
 */

import { useState, useCallback, useMemo } from 'react';
import type { GameState, AttackerDeclaration, BlockerDeclaration } from '@/types';

export interface UseCombatResult {
  isInCombat: boolean;
  combatStep: 'declare_attackers' | 'declare_blockers' | 'damage' | null;
  isDeclaringAttackers: boolean;
  isDeclaringBlockers: boolean;

  // Pending declarations
  pendingAttackers: Map<string, string>; // cardId -> defendingPlayerId
  pendingBlockers: Map<string, string>; // blockerId -> attackerId

  // Actions
  toggleAttacker: (cardId: string, defenderId: string) => void;
  removeAttacker: (cardId: string) => void;
  assignBlocker: (blockerId: string, attackerId: string) => void;
  removeBlocker: (blockerId: string) => void;
  clearPending: () => void;

  // Convert to declarations
  getAttackerDeclarations: () => AttackerDeclaration[];
  getBlockerDeclarations: () => BlockerDeclaration[];
}

export function useCombat(
  gameState: GameState | null,
  humanPlayerId: string
): UseCombatResult {
  const [pendingAttackers, setPendingAttackers] = useState<Map<string, string>>(new Map());
  const [pendingBlockers, setPendingBlockers] = useState<Map<string, string>>(new Map());

  // Determine combat step based on game state
  const combatStep = useMemo(() => {
    if (!gameState) return null;
    if (gameState.step === 'declare_attackers') return 'declare_attackers';
    if (gameState.step === 'declare_blockers') return 'declare_blockers';
    if (gameState.step === 'combat_damage' || gameState.step === 'first_strike_damage') return 'damage';
    return null;
  }, [gameState?.step]);

  const isInCombat = combatStep !== null;
  const isDeclaringAttackers = combatStep === 'declare_attackers' &&
    gameState?.players[gameState.activePlayerIndex]?.id === humanPlayerId;
  const isDeclaringBlockers = combatStep === 'declare_blockers' &&
    (gameState?.combat?.attackers.some(a => a.defendingPlayerId === humanPlayerId) ?? false);

  const toggleAttacker = useCallback((cardId: string, defenderId: string) => {
    setPendingAttackers(prev => {
      const next = new Map(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.set(cardId, defenderId);
      }
      return next;
    });
  }, []);

  const removeAttacker = useCallback((cardId: string) => {
    setPendingAttackers(prev => {
      const next = new Map(prev);
      next.delete(cardId);
      return next;
    });
  }, []);

  const assignBlocker = useCallback((blockerId: string, attackerId: string) => {
    setPendingBlockers(prev => {
      const next = new Map(prev);
      next.set(blockerId, attackerId);
      return next;
    });
  }, []);

  const removeBlocker = useCallback((blockerId: string) => {
    setPendingBlockers(prev => {
      const next = new Map(prev);
      next.delete(blockerId);
      return next;
    });
  }, []);

  const clearPending = useCallback(() => {
    setPendingAttackers(new Map());
    setPendingBlockers(new Map());
  }, []);

  const getAttackerDeclarations = useCallback((): AttackerDeclaration[] => {
    const declarations: AttackerDeclaration[] = [];
    pendingAttackers.forEach((defenderId, cardId) => {
      declarations.push({ cardInstanceId: cardId, defendingPlayerId: defenderId });
    });
    return declarations;
  }, [pendingAttackers]);

  const getBlockerDeclarations = useCallback((): BlockerDeclaration[] => {
    const declarations: BlockerDeclaration[] = [];
    pendingBlockers.forEach((attackerId, blockerId) => {
      declarations.push({ cardInstanceId: blockerId, blockingAttackerId: attackerId });
    });
    return declarations;
  }, [pendingBlockers]);

  return {
    isInCombat,
    combatStep,
    isDeclaringAttackers,
    isDeclaringBlockers,
    pendingAttackers,
    pendingBlockers,
    toggleAttacker,
    removeAttacker,
    assignBlocker,
    removeBlocker,
    clearPending,
    getAttackerDeclarations,
    getBlockerDeclarations,
  };
}
