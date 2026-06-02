import { describe, expect, it } from 'vitest';
import {
  deserializeGameState,
  getLegalActions,
  tapLandForMana,
  type ManaColor,
} from 'commander-engine';
import { createDeclareBlockersQaState, createLandEntryFetchQaState, createLibraryManipulationQaState, createModalChoiceQaState, createSisayRawLandsQaState } from './qaGameScenarios';

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

  it('loads Stomping Ground from hand and Scalding Tarn activation for browser QA', () => {
    const state = deserializeGameState(createLandEntryFetchQaState());
    const actions = getLegalActions(state, 'human');

    expect(actions.some(action =>
      action.kind === 'PlayLand' && action.cardInstanceId === 'stomping_ground_hand_1',
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'ActivateAbility' && action.cardInstanceId === 'scalding_tarn_board_1',
    )).toBe(true);
  });

  it('loads a modal spell with separate legal damage and artifact-destroy choices for browser QA', () => {
    const state = deserializeGameState(createModalChoiceQaState());
    const actions = getLegalActions(state, 'human');
    const abradeActions = actions.filter(action =>
      action.kind === 'CastSpell'
      && (action.cardInstanceId === 'abrade_damage_1' || action.cardInstanceId === 'abrade_artifact_1')
    );

    expect(abradeActions.some(action =>
      action.kind === 'CastSpell'
      && action.chosenModes?.[0] === 0
      && action.targets.includes('opponent_bear_1'),
    )).toBe(true);
    expect(abradeActions.some(action =>
      action.kind === 'CastSpell'
      && action.chosenModes?.[0] === 1
      && action.targets.includes('opponent_sol_ring_1'),
    )).toBe(true);
  });

  it('loads scry and surveil spells for browser QA', () => {
    const state = deserializeGameState(createLibraryManipulationQaState());
    const actions = getLegalActions(state, 'human');

    expect(actions.some(action =>
      action.kind === 'CastSpell' && action.cardInstanceId === 'library_qa_opt_1',
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'CastSpell' && action.cardInstanceId === 'library_qa_consider_1',
    )).toBe(true);
  });
});
