import type { GameOutcomePreventionEffectRef, GameState } from './types';
import { getCardDefinition } from './game-state';

const YOU_CANT_LOSE = /\byou\s+(?:can['\u2019]?t|cannot)\s+lose\s+the\s+game\b/i;
const PLAYERS_CANT_LOSE = /\bplayers\s+(?:can['\u2019]?t|cannot)\s+lose\s+the\s+game\b/i;
const OPPONENTS_CANT_WIN = /\byour\s+opponents\s+(?:can['\u2019]?t|cannot)\s+win\s+the\s+game\b/i;
const PLAYERS_CANT_WIN = /\bplayers\s+(?:can['\u2019]?t|cannot)\s+win\s+the\s+game\b/i;
const YOU_CANT_LOSE_LIFE = /\byou\s+(?:can['\u2019]?t|cannot)\s+lose\s+life\b/i;
const PLAYERS_CANT_LOSE_LIFE = /\bplayers\s+(?:can['\u2019]?t|cannot)\s+lose\s+life\b/i;

function battlefieldOracleTexts(state: GameState): Array<{ controllerId: string; oracleText: string }> {
  const texts: Array<{ controllerId: string; oracleText: string }> = [];
  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield') continue;
    const def = getCardDefinition(state, card);
    texts.push({ controllerId: card.ownerId, oracleText: def.oracle_text || '' });
  }
  return texts;
}

function protectedBy(effect: GameOutcomePreventionEffectRef, playerId: string): boolean {
  return !effect.protectedPlayerIds || effect.protectedPlayerIds.includes(playerId);
}

function activeGameOutcomeEffects(state: GameState): GameOutcomePreventionEffectRef[] {
  return (state.gameOutcomePreventionEffects || []).filter(
    effect => effect.expiresAtTurnNumber >= state.turnNumber,
  );
}

export function playerCantLose(state: GameState, playerId: string): boolean {
  if (activeGameOutcomeEffects(state).some(effect => effect.preventsLoss && protectedBy(effect, playerId))) {
    return true;
  }

  return battlefieldOracleTexts(state).some(({ controllerId, oracleText }) =>
    PLAYERS_CANT_LOSE.test(oracleText)
    || (controllerId === playerId && YOU_CANT_LOSE.test(oracleText)),
  );
}

export function playerCantWin(state: GameState, playerId: string): boolean {
  if (activeGameOutcomeEffects(state).some(effect => effect.preventsWin && protectedBy(effect, playerId))) {
    return true;
  }

  return battlefieldOracleTexts(state).some(({ controllerId, oracleText }) =>
    PLAYERS_CANT_WIN.test(oracleText)
    || (controllerId !== playerId && OPPONENTS_CANT_WIN.test(oracleText)),
  );
}

export function playerCantLoseLife(state: GameState, playerId: string): boolean {
  if (activeGameOutcomeEffects(state).some(effect => effect.preventsLifeLoss && protectedBy(effect, playerId))) {
    return true;
  }

  return battlefieldOracleTexts(state).some(({ controllerId, oracleText }) =>
    PLAYERS_CANT_LOSE_LIFE.test(oracleText)
    || (controllerId === playerId && YOU_CANT_LOSE_LIFE.test(oracleText)),
  );
}

export function playerCanPayLife(state: GameState, playerId: string, amount: number): boolean {
  if (amount <= 0) return true;
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player || player.life < amount) return false;
  return !playerCantLoseLife(state, playerId);
}

export function registerGameOutcomePrevention(
  state: GameState,
  effect: Omit<GameOutcomePreventionEffectRef, 'id'> & { id?: string },
): GameState {
  const id = effect.id ?? `outcome_prevention_${state.turnNumber}_${(state.gameOutcomePreventionEffects || []).length + 1}`;
  return {
    ...state,
    gameOutcomePreventionEffects: [
      ...(state.gameOutcomePreventionEffects || []),
      { ...effect, id },
    ],
  };
}

export function pruneGameOutcomePreventionEffects(state: GameState): GameState {
  const active = activeGameOutcomeEffects(state);
  if (active.length === (state.gameOutcomePreventionEffects || []).length) return state;
  return { ...state, gameOutcomePreventionEffects: active };
}
