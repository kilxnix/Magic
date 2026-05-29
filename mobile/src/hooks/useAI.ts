/**
 * useAI
 *
 * Runs local Shelector turns when a Shelector-controlled player has priority.
 * Uses a timeout to add visual delay between Shelector actions.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import type { GameState, AIPlayerConfig, AIDecision } from '@/types';
import { createLocalShelectorConfig, runLocalShelectorTurn } from '@/shelector/localShelector';

const AI_DECISION_DELAY_MS = 500;

export interface UseAIResult {
  isAIThinking: boolean;
  lastAIDecision: AIDecision | null;
  aiConfigs: Map<string, AIPlayerConfig>;
  setAIConfig: (playerId: string, difficulty: number) => void;
}

export function useAI(
  gameState: GameState | null,
  humanPlayerId: string,
  onStateUpdate: (newState: GameState) => void,
): UseAIResult {
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [lastAIDecision, setLastAIDecision] = useState<AIDecision | null>(null);
  const [aiConfigs, setAIConfigs] = useState<Map<string, AIPlayerConfig>>(new Map());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Set local Shelector config for a player
  const setAIConfig = useCallback((playerId: string, difficulty: number) => {
    setAIConfigs(prev => {
      const next = new Map(prev);
      next.set(playerId, createLocalShelectorConfig(playerId, difficulty as 1 | 2 | 3 | 4 | 5));
      return next;
    });
  }, []);

  // Run local Shelector when it has priority
  useEffect(() => {
    if (!gameState) return;

    // Clean up previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    // Get current priority player
    const priorityPlayerId = gameState.players[gameState.priorityPlayerIndex]?.id;

    // If human has priority, do nothing
    if (priorityPlayerId === humanPlayerId) {
      setIsAIThinking(false);
      return;
    }

    // Check if priority player is controlled locally by Shelector
    const aiConfig = aiConfigs.get(priorityPlayerId);
    if (!aiConfig) {
      // Not a Shelector-controlled player, do nothing
      return;
    }

    // Run local Shelector with delay for visual feedback
    setIsAIThinking(true);

    timeoutRef.current = setTimeout(() => {
      try {
        const { finalState, decisions } = runLocalShelectorTurn(gameState, aiConfig);

        if (decisions.length > 0) {
          setLastAIDecision(decisions[decisions.length - 1]);
        }

        onStateUpdate(finalState);
      } catch (e) {
        console.error('Shelector error:', e);
      } finally {
        setIsAIThinking(false);
      }
    }, AI_DECISION_DELAY_MS);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [gameState, humanPlayerId, aiConfigs, onStateUpdate]);

  return {
    isAIThinking,
    lastAIDecision,
    aiConfigs,
    setAIConfig,
  };
}
