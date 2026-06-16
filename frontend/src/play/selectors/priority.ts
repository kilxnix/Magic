import type { SimpleLegalAction, PriorityContext } from '../gameView.types';
import { normalizeKind } from './legalActionsByObject';
import { phaseLabel } from './phaseLabel';

export interface PriorityInput {
  isHumanTurn: boolean;
  legalActions: SimpleLegalAction[];
  phase?: string;
  step?: string;
  /** UI-only "hold priority" capability (the engine has no hold concept). */
  canHold?: boolean;
}

/**
 * Builds the priority strip context.
 *
 * INVARIANT: `canPass` is true whenever the human has priority — there is never a
 * priority window the human can't get out of (no dead-ends).
 *
 * `hasMeaningfulResponse` is true when any non-pass legal action exists (cast,
 * play-land, activate, attack, block, equip) — i.e. there is a real decision.
 */
export function priority(input: PriorityInput): PriorityContext {
  const hasPriority = input.isHumanTurn;
  const hasMeaningfulResponse = input.legalActions.some(
    action => normalizeKind(action.kind) !== 'pass',
  );

  return {
    hasPriority,
    phaseLabel: phaseLabel(input.phase, input.step),
    hasMeaningfulResponse,
    canPass: hasPriority,
    canHold: Boolean(input.canHold),
  };
}
