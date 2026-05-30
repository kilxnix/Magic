import type { CardInstance, GameState } from './types';
import { getCardDefinition } from './game-state';

export interface CastZoneRestriction {
  sourceInstanceId: string;
  sourceName: string;
}

export function getCommanderTaxForCast(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
): number {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return 0;
  const castCount = player.commanderCastCounts?.[cardInstanceId]
    ?? (player.commanderInstanceId === cardInstanceId ? player.commanderCastCount : 0);
  return castCount * 2;
}

export function findCastZoneRestriction(
  state: GameState,
  playerId: string,
  card: CardInstance,
): CastZoneRestriction | null {
  if (card.zone === 'hand') return null;

  for (const [, permanent] of state.cards) {
    if (permanent.zone !== 'battlefield') continue;
    if (permanent.ownerId === playerId) continue;
    const def = getCardDefinition(state, permanent);

    const oracle = def.oracle_text.toLowerCase();
    if (
      oracle.includes("opponents can't cast spells") &&
      oracle.includes('anywhere other than their hands')
    ) {
      return {
        sourceInstanceId: permanent.instanceId,
        sourceName: def.name,
      };
    }
  }

  return null;
}
