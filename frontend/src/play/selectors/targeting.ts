import type { BoardTargetingPrompt, TargetingContext } from '../gameView.types';

/**
 * Reshapes the hook's `targetingPrompt` (a flat `BoardTargetingPrompt` with one
 * `choices[].targetId` per legal target) into the targeting context.
 *
 * The current board-target flow resolves ONE target per tap — there is no
 * multi-select accumulation and `BoardTargetingPrompt` carries no min/max, so we
 * approximate min/max = 1 and leave `selectedTargetIds` empty (per the inventory's
 * OPEN ITEM 7). When the underlying multi-target count is later surfaced, only this
 * function changes.
 */
export function targeting(prompt: BoardTargetingPrompt | null | undefined): TargetingContext {
  if (!prompt) {
    return {
      active: false,
      prompt: '',
      minTargets: 0,
      maxTargets: 0,
      legalTargetIds: [],
      legalTargets: [],
      selectedTargetIds: [],
    };
  }

  const promptText = prompt.label?.trim()
    ? prompt.label
    : `Choose a target for ${prompt.sourceName}`;

  return {
    active: true,
    prompt: promptText,
    minTargets: 1,
    maxTargets: 1,
    legalTargetIds: prompt.choices.map(choice => choice.targetId),
    legalTargets: prompt.choices.map(choice => ({
      id: choice.targetId,
      name: choice.label || choice.targetId,
    })),
    selectedTargetIds: [],
  };
}
