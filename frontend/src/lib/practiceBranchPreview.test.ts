import { describe, expect, it } from 'vitest';
import { deserializeGameState, getCardDefinition, getLegalActions } from 'commander-engine';
import { createDeclareBlockersQaState } from './qaGameScenarios';
import { buildPracticeBranchPreviews } from './practiceBranchPreview';
import type { SimpleLegalAction } from '../hooks/useShelectorGame';

function toSimpleAction(state: ReturnType<typeof deserializeGameState>, action: ReturnType<typeof getLegalActions>[number]): SimpleLegalAction {
  const cardInstanceId = 'cardInstanceId' in action ? action.cardInstanceId : undefined;
  const card = cardInstanceId ? state.cards.get(cardInstanceId) : undefined;
  const cardName = card ? getCardDefinition(state, card).name : undefined;
  return {
    kind: action.kind,
    cardInstanceId,
    cardName,
    label: action.kind === 'DeclareBlockers'
      ? action.blocks.length > 0
        ? `Block with ${action.blocks.length} creature(s)`
        : 'No blocks'
      : action.kind,
    _engineAction: action,
  };
}

describe('buildPracticeBranchPreviews', () => {
  it('describes blocker declarations instead of vague no-visible-count text', () => {
    const serializedState = createDeclareBlockersQaState();
    const state = deserializeGameState(serializedState);
    const legalActions = getLegalActions(state, 'human').map(action => toSimpleAction(state, action));

    const previews = buildPracticeBranchPreviews({
      serializedState,
      playerId: 'human',
      legalActions,
      max: 4,
    });

    expect(previews.some(preview => preview.summary.includes('No blockers declared'))).toBe(true);
    expect(previews.some(preview => preview.summary.includes('Blocks assigned: 1'))).toBe(true);
    expect(previews.every(preview => !preview.summary.includes('No visible count change'))).toBe(true);
    expect(previews.every(preview => preview.resultEngine)).toBe(true);
  });
});
