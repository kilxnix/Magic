import { describe, expect, it } from 'vitest';
import {
  deserializeGameState,
  getLegalActions,
  tapLandForMana,
  type ManaColor,
} from 'commander-engine';
import { createDeclareBlockersQaState, createSisayRawLandsQaState } from './qaGameScenarios';

describe('QA game scenarios', () => {
  it('loads raw dual lands with mana actions and reaches Sisay activation after tapping WUBRG', () => {
    let state = deserializeGameState(createSisayRawLandsQaState());
    const firstActions = getLegalActions(state, 'human');

    expect(firstActions.some(action =>
      action.kind === 'ActivateManaAbility' && action.cardInstanceId === 'temple_garden_1',
    )).toBe(true);
    expect(firstActions.some(action =>
      action.kind === 'ActivateAbility' && action.cardInstanceId === 'sisay_1',
    )).toBe(false);

    const taps: Array<[string, ManaColor]> = [
      ['temple_garden_1', 'W'],
      ['rejuvenating_springs_1', 'U'],
      ['undergrowth_stadium_1', 'B'],
      ['stomping_ground_1', 'G'],
      ['steam_vents_1', 'R'],
    ];
    for (const [cardId, color] of taps) {
      state = tapLandForMana(state, 'human', cardId, color);
    }

    const afterMana = getLegalActions(state, 'human');
    expect(afterMana.some(action =>
      action.kind === 'ActivateAbility' && action.cardInstanceId === 'sisay_1',
    )).toBe(true);
  });

  it('loads a defender-owned declare-blockers decision even while attacker has priority', () => {
    const state = deserializeGameState(createDeclareBlockersQaState());
    const actions = getLegalActions(state, 'human');

    expect(state.players[state.priorityPlayerIndex]?.id).toBe('ai-1');
    expect(state.step).toBe('declare_blockers');
    expect(actions.some(action =>
      action.kind === 'DeclareBlockers' && action.blocks.length === 0,
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'DeclareBlockers'
      && action.blocks.some(block =>
        block.cardInstanceId === 'sisay_blocker_1'
        && block.blockingAttackerId === 'body_launderer_1',
      ),
    )).toBe(true);
  });
});
