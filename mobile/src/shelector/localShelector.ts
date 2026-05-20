/**
 * Local Shelector runtime
 *
 * Keeps Shelector-controlled players inside the mobile bundle instead of
 * requiring a backend API round trip from a cellular device.
 */

import type { GameState, AIPlayerConfig, AIDifficulty } from '@/types';
import { createAIConfig, runAITurn } from '@engine/ai/agent';
import { getDefaultPersonality } from '@engine/ai/personalities';

export function createLocalShelectorConfig(
  playerId: string,
  difficulty: AIDifficulty,
): AIPlayerConfig {
  return {
    ...createAIConfig(playerId, difficulty),
    personality: getDefaultPersonality(difficulty),
  };
}

export function runLocalShelectorTurn(
  state: GameState,
  config: AIPlayerConfig,
) {
  return runAITurn(state, config);
}
