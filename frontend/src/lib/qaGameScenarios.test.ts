import { describe, expect, it } from 'vitest';
import {
  deserializeGameState,
  getLegalActions,
  tapLandForMana,
  type ManaColor,
} from 'commander-engine';
import { createSisayRawLandsQaState } from './qaGameScenarios';

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
});
