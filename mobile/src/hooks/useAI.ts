/**
 * useAI
 *
 * Runs AI turns when an AI player has priority.
 * Uses a timeout to add visual delay between AI actions.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import type { GameState, AIPlayerConfig, AIDecision } from '@/types';
import { runAITurn, createAIConfig } from '@engine/ai/agent';

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

  // Set AI config for a player
  const setAIConfig = useCallback((playerId: string, difficulty: number) => {
    setAIConfigs(prev => {
      const next = new Map(prev);
      next.set(playerId, createAIConfig(playerId, difficulty as 1 | 2 | 3 | 4 | 5));
      return next;
    });
  }, []);

  // Run AI when it has priority
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

    // Check if priority player is an AI
    const aiConfig = aiConfigs.get(priorityPlayerId);
    if (!aiConfig) {
      // Not an AI player, do nothing
      return;
    }

    // Run AI with delay for visual feedback
    setIsAIThinking(true);

    timeoutRef.current = setTimeout(() => {
      try {
        const { finalState, decisions } = runAITurn(gameState, aiConfig);

        if (decisions.length > 0) {
          setLastAIDecision(decisions[decisions.length - 1]);
        }

        onStateUpdate(finalState);
      } catch (e) {
        console.error('AI error:', e);
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
