import type { GameState } from './types';
import { getCardDefinition } from './game-state';

const YOU_CANT_LOSE = /\byou\s+(?:can['\u2019]?t|cannot)\s+lose\s+the\s+game\b/i;
const PLAYERS_CANT_LOSE = /\bplayers\s+(?:can['\u2019]?t|cannot)\s+lose\s+the\s+game\b/i;
const OPPONENTS_CANT_WIN = /\byour\s+opponents\s+(?:can['\u2019]?t|cannot)\s+win\s+the\s+game\b/i;
const PLAYERS_CANT_WIN = /\bplayers\s+(?:can['\u2019]?t|cannot)\s+win\s+the\s+game\b/i;

function battlefieldOracleTexts(state: GameState): Array<{ controllerId: string; oracleText: string }> {
  const texts: Array<{ controllerId: string; oracleText: string }> = [];
  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield') continue;
    const def = getCardDefinition(state, card);
    texts.push({ controllerId: card.ownerId, oracleText: def.oracle_text || '' });
  }
  return texts;
}

export function playerCantLose(state: GameState, playerId: string): boolean {
  return battlefieldOracleTexts(state).some(({ controllerId, oracleText }) =>
    PLAYERS_CANT_LOSE.test(oracleText)
    || (controllerId === playerId && YOU_CANT_LOSE.test(oracleText)),
  );
}

export function playerCantWin(state: GameState, playerId: string): boolean {
  return battlefieldOracleTexts(state).some(({ controllerId, oracleText }) =>
    PLAYERS_CANT_WIN.test(oracleText)
    || (controllerId !== playerId && OPPONENTS_CANT_WIN.test(oracleText)),
  );
}

