/**
 * useTargeting
 *
 * Manages target selection mode for spells and abilities.
 */

import { useState, useCallback, useMemo } from 'react';
import type { GameState, TargetSpec } from '@/types';
import { getLegalTargets } from '@engine/ai/legal-actions';

export interface UseTargetingResult {
  isTargeting: boolean;
  validTargets: string[];
  selectedTargets: string[];
  requiredCount: number;
  startTargeting: (sourceCardId: string, specs: TargetSpec[], requiredCount?: number) => void;
  selectTarget: (targetId: string) => void;
  deselectTarget: (targetId: string) => void;
  confirmTargets: () => string[];
  cancelTargeting: () => void;
  hasEnoughTargets: boolean;
}

export function useTargeting(
  gameState: GameState | null,
  humanPlayerId: string
): UseTargetingResult {
  const [isTargeting, setIsTargeting] = useState(false);
  const [sourceCardId, setSourceCardId] = useState<string | null>(null);
  const [targetSpecs, setTargetSpecs] = useState<TargetSpec[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [requiredCount, setRequiredCount] = useState(1);

  // Calculate valid targets
  const validTargets = useMemo(() => {
    if (!gameState || !isTargeting || targetSpecs.length === 0) {
      return [];
    }
    // For now, return all targetable permanents and players
    // TODO: Use getLegalTargets from engine when properly typed
    const targets: string[] = [];

    // Add opponent player IDs
    for (const player of gameState.players) {
      if (player.id !== humanPlayerId && !player.hasLost) {
        targets.push(player.id);
      }
    }

    // Add battlefield permanents
    for (const card of gameState.cards.values()) {
      if (card.zone === 'battlefield') {
        targets.push(card.instanceId);
      }
    }

    return targets;
  }, [gameState, isTargeting, targetSpecs, humanPlayerId]);

  const startTargeting = useCallback((
    cardId: string,
    specs: TargetSpec[],
    required: number = 1
  ) => {
    setSourceCardId(cardId);
    setTargetSpecs(specs);
    setSelectedTargets([]);
    setRequiredCount(required);
    setIsTargeting(true);
  }, []);

  const selectTarget = useCallback((targetId: string) => {
    if (!validTargets.includes(targetId)) return;

    setSelectedTargets(prev => {
      if (prev.includes(targetId)) {
        return prev;
      }
      // If we already have enough targets, replace the last one
      if (prev.length >= requiredCount) {
        return [...prev.slice(0, -1), targetId];
      }
      return [...prev, targetId];
    });
  }, [validTargets, requiredCount]);

  const deselectTarget = useCallback((targetId: string) => {
    setSelectedTargets(prev => prev.filter(id => id !== targetId));
  }, []);

  const confirmTargets = useCallback(() => {
    const targets = [...selectedTargets];
    setIsTargeting(false);
    setSourceCardId(null);
    setTargetSpecs([]);
    setSelectedTargets([]);
    setRequiredCount(1);
    return targets;
  }, [selectedTargets]);

  const cancelTargeting = useCallback(() => {
    setIsTargeting(false);
    setSourceCardId(null);
    setTargetSpecs([]);
    setSelectedTargets([]);
    setRequiredCount(1);
  }, []);

  const hasEnoughTargets = selectedTargets.length >= requiredCount;

  return {
    isTargeting,
    validTargets,
    selectedTargets,
    requiredCount,
    startTargeting,
    selectTarget,
    deselectTarget,
    confirmTargets,
    cancelTargeting,
    hasEnoughTargets,
  };
}
