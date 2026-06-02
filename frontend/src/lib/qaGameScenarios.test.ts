import { describe, expect, it } from 'vitest';
import {
  deserializeGameState,
  applyDamageAssignmentPromptResponse,
  applySelectCardsPromptResponse,
  checkStateBasedActions,
  createDamageAssignmentPromptRequest,
  createSelectCardsPromptRequest,
  getEffectivePower,
  getLegalActions,
  instanceHasKeyword,
  advanceStep,
  passPriority,
  resetLoopDetector,
  resolveCombatDamage,
  resolveTopOfStack,
  tapLandForMana,
  tryDeclareBlockers,
  tryEquip,
  tryPlayLand,
  type ManaColor,
} from 'commander-engine';
import { groupBattlefieldCards } from '../components/GameBoard';
import { toSimpleCard } from '../hooks/useShelectorGame';
import { createBrainGorgersSacrificeQaState, createComplexCombatQaState, createCostReductionQaState, createCreatureManaSicknessQaState, createDeclareBlockersQaState, createEquipmentD20QaState, createEquipmentEquipQaState, createGenerousGiftQaState, createKrenkoSkirkQaState, createLandEntryFetchQaState, createLibraryManipulationQaState, createMagecraftTriggersQaState, createModalChoiceQaState, createMulliganSelectionQaState, createSeeBeyondQaState, createSisayRawLandsQaState, createSpellCopyQaState, createStormGrapeshotQaState, createTokenStackQaState } from './qaGameScenarios';

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

  it('resolves the declare-blockers QA branch with deathtouch damage moving Sisay off the battlefield', () => {
    let state = deserializeGameState(createDeclareBlockersQaState());
    const blockAction = getLegalActions(state, 'human').find(action =>
      action.kind === 'DeclareBlockers'
      && action.blocks.some(block =>
        block.cardInstanceId === 'sisay_blocker_1'
        && block.blockingAttackerId === 'body_launderer_1',
      ),
    );

    expect(blockAction?.kind).toBe('DeclareBlockers');
    const blocked = tryDeclareBlockers(
      state,
      'human',
      blockAction?.kind === 'DeclareBlockers' ? blockAction.blocks : [],
    );
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) throw new Error(blocked.message);
    state = blocked.state!;

    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state);
    state = passPriority(state);
    state = passPriority(state);
    state = advanceStep(state);
    state = resolveCombatDamage(state);

    expect(state.cards.get('sisay_blocker_1')?.zone).toBe('command');
    expect(state.cards.get('body_launderer_1')?.zone).toBe('battlefield');
    expect(state.players.find(player => player.id === 'human')?.life).toBe(40);
  });

  it('loads Stomping Ground, Cavern choice, and Scalding Tarn activation for browser QA', () => {
    const state = deserializeGameState(createLandEntryFetchQaState());
    const actions = getLegalActions(state, 'human');

    expect(actions.some(action =>
      action.kind === 'PlayLand' && action.cardInstanceId === 'stomping_ground_hand_1',
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'PlayLand' && action.cardInstanceId === 'cavern_of_souls_hand_1',
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'ActivateAbility' && action.cardInstanceId === 'scalding_tarn_board_1',
    )).toBe(true);
  });

  it('does not report a possible loop when Cavern resolves in the land-entry QA state', () => {
    resetLoopDetector();
    const state = deserializeGameState(createLandEntryFetchQaState());

    const result = tryPlayLand(state, 'human', 'cavern_of_souls_hand_1', {
      chosenCreatureType: 'Human',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.cards.get('cavern_of_souls_hand_1')?.zone).toBe('battlefield');
    expect(result.events.some(event => event.kind === 'PossibleLoop')).toBe(false);
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

  it('loads Generous Gift with an opponent commander target for browser QA', () => {
    const state = deserializeGameState(createGenerousGiftQaState());
    const actions = getLegalActions(state, 'human');

    expect(actions.some(action =>
      action.kind === 'CastSpell'
      && action.cardInstanceId === 'generous_gift_1'
      && action.targets.includes('countered_commander_1'),
    )).toBe(true);
  });

  it('loads Krenko, Impact Tremors, stacked Goblins, and Skirk sacrifice mana for browser QA', () => {
    const state = deserializeGameState(createKrenkoSkirkQaState());
    const actions = getLegalActions(state, 'human');
    const goblins = [...state.cards.values()].filter(card => {
      const def = state.cardDefinitions.get(card.definitionId);
      return card.zone === 'battlefield' && card.ownerId === 'human' && /goblin/i.test(def?.type_line || '');
    });

    expect(goblins).toHaveLength(4);
    expect(actions.some(action =>
      action.kind === 'ActivateAbility' && action.cardInstanceId === 'krenko_skirk_qa_krenko_1',
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'ActivateManaAbility'
      && action.cardInstanceId === 'krenko_skirk_qa_skirk_1'
      && action.color === 'R',
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

  it('loads See Beyond with enough mana and selectable hand cards for browser QA', () => {
    const state = deserializeGameState(createSeeBeyondQaState());
    const actions = getLegalActions(state, 'human');

    expect(actions.some(action =>
      action.kind === 'CastSpell' && action.cardInstanceId === 'see_beyond_1',
    )).toBe(true);
    expect([...state.cards.values()].filter(card => card.ownerId === 'human' && card.zone === 'hand')).toHaveLength(3);
    expect([...state.cards.values()].filter(card => card.ownerId === 'human' && card.zone === 'library')).toHaveLength(3);
  });

  it('loads a seven-card opening hand for mulligan selection browser QA', () => {
    const state = deserializeGameState(createMulliganSelectionQaState());

    expect([...state.cards.values()].filter(card => card.ownerId === 'human' && card.zone === 'hand')).toHaveLength(7);
    expect([...state.cards.values()].filter(card => card.ownerId === 'human' && card.zone === 'library')).toHaveLength(5);
  });

  it('loads a cost-reduced instant that is castable with only colored mana available', () => {
    const state = deserializeGameState(createCostReductionQaState());
    const actions = getLegalActions(state, 'human');

    expect(state.players[0].manaPool.R).toBe(1);
    expect(actions.some(action =>
      action.kind === 'CastSpell'
      && action.cardInstanceId === 'cost_reduction_qa_bolt_1'
      && action.targets.includes('ai-1'),
    )).toBe(true);
  });

  it('loads Brain Gorgers ETB sacrifice choice and commits the selected creature', () => {
    let state = deserializeGameState(createBrainGorgersSacrificeQaState());
    const top = state.stack[0];

    expect(top?.kind).toBe('TriggeredAbility');
    const request = createSelectCardsPromptRequest(state, 'human', {
      subject: 'SacrificeChoice',
      zone: 'battlefield',
      destination: 'graveyard',
      filter: { types: ['creature'] },
      commitSelection: false,
      stackItemId: top.id,
      choiceKey: 'sacrificeCardId:human',
      sourceInstanceId: 'brain_gorgers_qa_1',
      minSelections: 1,
      maxSelections: 1,
    });

    expect(request.legalChoices.map(choice => choice.cardInstanceId).sort()).toEqual([
      'brain_gorgers_qa_doomed_bear_1',
      'brain_gorgers_qa_keeper_elf_1',
    ]);

    const response = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'human',
      selectedCardInstanceIds: ['brain_gorgers_qa_doomed_bear_1'],
    });
    expect(response.ok).toBe(true);
    state = resolveTopOfStack(response.state!);

    expect(state.cards.get('brain_gorgers_qa_1')?.zone).toBe('battlefield');
    expect(state.cards.get('brain_gorgers_qa_doomed_bear_1')?.zone).toBe('graveyard');
    expect(state.cards.get('brain_gorgers_qa_keeper_elf_1')?.zone).toBe('battlefield');
  });

  it('loads Goblin Morningstar d20 casting for browser QA', () => {
    const state = deserializeGameState(createEquipmentD20QaState());
    const actions = getLegalActions(state, 'human');

    expect(actions.some(action =>
      action.kind === 'CastSpell'
      && action.cardInstanceId === 'equipment_d20_qa_morningstar_hand_1',
    )).toBe(true);
    expect(actions.some(action => action.kind === 'Equip')).toBe(false);
    expect([...state.cards.values()].filter(card =>
      card.definitionId === 'equipment_d20_qa_morningstar' && card.zone === 'battlefield',
    )).toHaveLength(0);
  });

  it('loads Goblin Morningstar equip action for browser QA', () => {
    let state = deserializeGameState(createEquipmentEquipQaState());
    const actions = getLegalActions(state, 'human');

    expect(actions.some(action =>
      action.kind === 'CastSpell'
      && action.cardInstanceId === 'equipment_d20_qa_morningstar_hand_1',
    )).toBe(false);
    expect(actions.some(action =>
      action.kind === 'Equip'
      && action.equipmentInstanceId === 'equipment_d20_qa_morningstar_board_1'
      && action.targetCreatureId === 'equipment_d20_qa_bear_1',
    )).toBe(true);

    const equipped = tryEquip(state, 'human', 'equipment_d20_qa_morningstar_board_1', 'equipment_d20_qa_bear_1');
    expect(equipped.ok).toBe(true);
    if (!equipped.ok) return;
    state = equipped.state;
    expect(state.cards.get('equipment_d20_qa_morningstar_board_1')?.attachedTo).toBe('equipment_d20_qa_bear_1');
    expect(getEffectivePower(state, 'equipment_d20_qa_bear_1')).toBe(3);
    expect(instanceHasKeyword(state, 'equipment_d20_qa_bear_1', 'Trample')).toBe(true);
  });

  it('stacks matching tokens for browser QA', () => {
    const state = deserializeGameState(createTokenStackQaState());
    const cards = [...state.cards.values()]
      .filter(card => card.zone === 'battlefield')
      .map(card => toSimpleCard(card, state.cardDefinitions.get(card.definitionId)!, state));

    expect(cards).toHaveLength(3);
    const groups = groupBattlefieldCards(cards, true);
    expect(groups.creatures).toHaveLength(1);
    expect(groups.creatures[0].card.name).toBe('Goblin');
    expect(groups.creatures[0].cards).toHaveLength(3);
  });

  it('exposes mana only for non-summoning-sick mana creatures in browser QA', () => {
    const state = deserializeGameState(createCreatureManaSicknessQaState());
    const actions = getLegalActions(state, 'human');

    expect(actions.some(action =>
      action.kind === 'ActivateManaAbility'
      && action.cardInstanceId === 'creature_mana_qa_ready_elf_1',
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'ActivateManaAbility'
      && action.cardInstanceId === 'creature_mana_qa_sick_elf_1',
    )).toBe(false);
  });

  it('loads a storm spell with previous spell count for browser QA', () => {
    const state = deserializeGameState(createStormGrapeshotQaState());
    const actions = getLegalActions(state, 'human');

    expect(state.spellsCastThisTurn).toBe(2);
    expect(state.cards.get('storm_qa_commander_1')?.zone).toBe('battlefield');
    expect(state.battlefieldAbilities.get('storm_qa_commander_1')?.some(ability =>
      ability.trigger.kind === 'CastInstantOrSorcery',
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'CastSpell'
      && action.cardInstanceId === 'storm_qa_grapeshot_1'
      && action.targets.includes('ai-1'),
    )).toBe(true);
  });

  it('loads a copy-spell target on the stack for browser QA', () => {
    const state = deserializeGameState(createSpellCopyQaState());
    const actions = getLegalActions(state, 'human');

    expect(state.stack).toHaveLength(1);
    expect(state.cards.get('copy_qa_commander_1')?.zone).toBe('battlefield');
    expect(state.battlefieldAbilities.get('copy_qa_commander_1')?.some(ability =>
      ability.trigger.kind === 'CastInstantOrSorcery',
    )).toBe(true);
    expect(actions.some(action =>
      action.kind === 'CastSpell'
      && action.cardInstanceId === 'copy_qa_fork_1'
      && action.targets.includes('copy_qa_bolt_1'),
    )).toBe(true);
  });

  it('loads magecraft trigger permanents for browser QA', () => {
    const state = deserializeGameState(createMagecraftTriggersQaState());
    const actions = getLegalActions(state, 'human');

    expect(state.cards.get('magecraft_qa_commander_1')?.zone).toBe('battlefield');
    expect(state.battlefieldAbilities.get('magecraft_qa_commander_1')?.length).toBeGreaterThan(0);
    expect(state.battlefieldAbilities.get('magecraft_qa_archmage_1')?.length).toBeGreaterThan(0);
    expect(state.battlefieldAbilities.get('magecraft_qa_storm_kiln_1')?.length).toBeGreaterThan(0);
    expect(state.battlefieldAbilities.get('magecraft_qa_veyran_1')?.length).toBeGreaterThan(0);
    expect(actions.some(action =>
      action.kind === 'CastSpell' && action.cardInstanceId === 'magecraft_qa_opt_1',
    )).toBe(true);
  });

  it('loads a four-player complex combat damage assignment state for browser QA', () => {
    const state = deserializeGameState(createComplexCombatQaState());
    const request = createDamageAssignmentPromptRequest(state, 'human', { id: 'test_damage_assignment' });

    expect(state.players).toHaveLength(4);
    expect(state.step).toBe('combat_damage');
    expect(state.combat?.attackers).toHaveLength(3);
    expect(request.groups).toHaveLength(1);
    expect(request.groups[0].attackerName).toBe('Trampling Commander');
    expect(request.groups[0].blockers.map(blocker => blocker.blockerName)).toEqual([
      'Bear Blocker',
      'Wall Blocker',
    ]);

    const response = applyDamageAssignmentPromptResponse(state, request, {
      requestId: request.id,
      kind: 'DamageAssignment',
      playerId: 'human',
      orders: [{
        attackerId: 'complex_combat_commander_1',
        blockerIds: ['complex_combat_bear_1', 'complex_combat_wall_1'],
      }],
    });
    expect(response.ok).toBe(true);

    const damaged = checkStateBasedActions(resolveCombatDamage(response.state!));
    expect(damaged.players.find(player => player.id === 'human')?.life).toBe(44);
    expect(damaged.players.find(player => player.id === 'ai-1')?.life).toBe(39);
    expect(damaged.players.find(player => player.id === 'ai-1')?.commanderDamage.complex_combat_commander_1).toBe(1);
    expect(damaged.players.find(player => player.id === 'ai-2')?.life).toBe(36);
    expect(damaged.players.find(player => player.id === 'ai-3')?.life).toBe(38);
    expect(damaged.cards.get('complex_combat_bear_1')?.zone).toBe('graveyard');
    expect(damaged.cards.get('complex_combat_wall_1')?.zone).toBe('graveyard');
    expect(damaged.cards.get('complex_combat_colossus_1')?.zone).toBe('graveyard');
  });
});
