// NOTE: shared by frontend/src/lib/roomEngineBridge.ts (room) and
// frontend/src/hooks/useShelectorGame.ts (single-player) via commander-engine.
import { GameState } from './types';
import { advanceStep, performUntapStep } from './turn-manager';
import { drawCards } from './actions';
import { checkStateBasedActions } from './state-based';
import { checkTriggersForEvent } from './stack';

/**
 * Canonical step-advance + turn-based-action logic, shared by BOTH the 1v1
 * single-player path (useShelectorGame) and the 1v1v1v1 room path
 * (roomEngineBridge). Previously each path re-implemented this inline, which is
 * how they drifted (the room path silently lacked the draw step and state-based
 * actions). Keep this the single source of truth so they can never diverge.
 *
 * When all players have passed priority on an empty stack, the game advances one
 * step and performs that step's turn-based actions (CR 500.1):
 *  - untap step  -> untap the active player's permanents (performed before the
 *                   advance so the untap belongs to the step being left, matching
 *                   the existing engine ordering).
 *  - draw step   -> the active player draws one card. CR 103.8a: ONLY a two-player
 *                   game's starting player skips their very first draw; in
 *                   multiplayer the starting player draws on turn 1.
 * State-based actions are then checked (CR 704) so lethal damage / 0-toughness
 * creatures die, players at 0 life (or 21 commander damage) lose, etc.
 *
 * @param options.skipDraw force-skip the draw (e.g. an explicit 2-player turn-1
 *   skip already decided by the caller). The multiplayer turn-1 skip is handled
 *   internally via player count, so callers normally omit this.
 */
export function advanceStepWithTurnActions(
  state: GameState,
  options: { skipDraw?: boolean } = {},
): GameState {
  let next = state.step === 'untap'
    ? advanceStep(performUntapStep(state))
    : advanceStep(state);

  if (next.step === 'draw' && !options.skipDraw) {
    const skipFirstDraw = next.turnNumber === 1 && next.players.length === 2;
    if (!skipFirstDraw) {
      const activeId = next.players[next.activePlayerIndex].id;
      // Slice 11: fire DrawStepStart before the turn-based draw so permanents with
      // "At the beginning of your draw step, draw an additional card." (Immortal Sun)
      // can queue their trigger.  The trigger resolves after priority is granted; the
      // mandatory turn-based draw happens inline here per CR 504.1.
      next = checkTriggersForEvent(next, { kind: 'DrawStepStart', activePlayerId: activeId });
      next = drawCards(next, activeId, 1);
    }
  }

  return checkStateBasedActions(next);
}
