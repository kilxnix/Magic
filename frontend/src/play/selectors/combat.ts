import type {
  SimpleLegalAction,
  CombatContext,
  CombatStep,
  DamageAssignmentChoiceLike,
} from '../gameView.types';

export interface CombatInput {
  /** The display step from SimpleGameState.step (e.g. 'declare_attackers'). */
  step?: string;
  legalActions: SimpleLegalAction[];
  /** The hook's `damageAssignmentChoice`, present only during damage ordering. */
  damageAssignmentChoice?: DamageAssignmentChoiceLike | null;
}

function eligibleAttackerIds(actions: SimpleLegalAction[]): string[] {
  const ids = new Set<string>();
  for (const action of actions) {
    const engine = action._engineAction;
    if (engine.kind === 'DeclareAttackers') {
      for (const attack of engine.attacks) ids.add(attack.cardInstanceId);
    }
  }
  return [...ids];
}

function eligibleBlockerIds(actions: SimpleLegalAction[]): string[] {
  const ids = new Set<string>();
  for (const action of actions) {
    const engine = action._engineAction;
    if (engine.kind === 'DeclareBlockers') {
      for (const block of engine.blocks) ids.add(block.cardInstanceId);
    }
  }
  return [...ids];
}

/**
 * Reshapes combat eligibility from the engine-enumerated DeclareAttackers /
 * DeclareBlockers actions in `legalActions`, plus the active damage-assignment
 * choice. Mirrors how GameBoard derives `eligibleAttackerIds` / `legalBlockPairs`,
 * but as pure data.
 */
export function combat(input: CombatInput): CombatContext {
  const { step, legalActions, damageAssignmentChoice } = input;

  if (damageAssignmentChoice) {
    const attackerId = damageAssignmentChoice.attackerInstanceId;
    const assignments: Record<string, string[]> = {};
    if (attackerId) {
      assignments[attackerId] = damageAssignmentChoice.blockerInstanceIds ?? [];
    }
    return { step: 'order-damage', eligibleIds: Object.keys(assignments), assignments };
  }

  let combatStep: CombatStep = 'none';
  let eligibleIds: string[] = [];

  if (step === 'declare_attackers') {
    combatStep = 'declare-attackers';
    eligibleIds = eligibleAttackerIds(legalActions);
  } else if (step === 'declare_blockers') {
    combatStep = 'declare-blockers';
    eligibleIds = eligibleBlockerIds(legalActions);
  }

  return { step: combatStep, eligibleIds, assignments: {} };
}
