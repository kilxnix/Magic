import { describe, expect, it } from 'vitest';
import {
  applyClientActionRequest,
  applyChooseModePromptResponse,
  applyChooseReplacementPromptResponse,
  applyPayCostsPromptResponse,
  applyDamageAssignmentPromptResponse,
  applyLibraryManipulationPromptResponse,
  applySearchLibraryPromptResponse,
  applySelectCardsPromptResponse,
  applySelectTargetPromptResponse,
  auditActionReplay,
  auditEngineReplay,
  auditPromptReplay,
  auditSearchPromptReplay,
  buildActionPrompt,
  createClientActionRequest,
  createBattlefieldEntryReplacementPromptRequest,
  createChooseModePromptRequest,
  createDamageAssignmentPromptRequest,
  createLibraryManipulationPromptRequest,
  createSearchLibraryPromptRequest,
  createSelectCardsPromptRequest,
  createSelectTargetPromptRequest,
  createPayCostsPromptRequest,
  diffGameStates,
  labelForAction,
  stateFingerprint,
} from './authority';
import { resolveCombatDamage } from './combat';
import { initGameState } from './game-state';
import type { CardDefinition, CardInstance, GameState } from './types';
import type { AIAction } from './ai/types';
import type { CardFilter } from './effects/ast';
import type { TargetSpec } from './effects/targets';
import { getEffectivePower, registerContinuousEffect } from './effects/continuous';

function def(
  id: string,
  name: string,
  typeLine: string,
  manaCost = '',
  oracleText = '',
): CardDefinition {
  const lowerType = typeLine.toLowerCase();
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: manaCost,
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: [
      lowerType.includes('creature') ? 'creature' : undefined,
      lowerType.includes('land') ? 'land' : undefined,
      lowerType.includes('artifact') ? 'artifact' : undefined,
      lowerType.includes('enchantment') ? 'enchantment' : undefined,
      lowerType.includes('instant') ? 'instant' : undefined,
      lowerType.includes('sorcery') ? 'sorcery' : undefined,
    ].filter(Boolean) as CardDefinition['card_types'],
  };
}

function stateWithForestInHand(): GameState {
  const commander = def('commander', 'Test Commander', 'Legendary Creature - Human', '{1}{G}');
  const forest = def('forest', 'Forest', 'Basic Land - Forest', '', '{T}: Add {G}.');
  const island = def('island', 'Island', 'Basic Land - Island', '', '{T}: Add {U}.');
  const state = initGameState([
    { playerId: 'p1', name: 'Player One', cards: [commander, forest], commanderId: commander.id },
    { playerId: 'p2', name: 'Player Two', cards: [commander, island], commanderId: commander.id },
  ]);
  const forestInstance = [...state.cards.values()].find(card => card.definitionId === forest.id && card.ownerId === 'p1');
  if (!forestInstance) throw new Error('Forest not found');
  state.cards.set(forestInstance.instanceId, { ...forestInstance, zone: 'hand' });
  return {
    ...state,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    hasPriorityPassed: [false, false],
  };
}

function cardInstance(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'],
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  };
}

function stateWithSisaySearchChoices(): GameState {
  const sisay: CardDefinition = {
    ...def('sisay', 'Sisay, Weatherlight Captain', 'Legendary Creature - Human Soldier', '{2}{W}'),
    cmc: 3,
    power: 2,
    toughness: 2,
  };
  const yoshimaru: CardDefinition = {
    ...def('yoshimaru', 'Yoshimaru, Ever Faithful', 'Legendary Creature - Dog', '{W}'),
    cmc: 1,
  };
  const arcaneSignet: CardDefinition = {
    ...def('arcane_signet', 'Arcane Signet', 'Artifact', '{2}'),
    cmc: 2,
  };
  const akromasMemorial: CardDefinition = {
    ...def('akromas_memorial', "Akroma's Memorial", 'Legendary Artifact', '{7}'),
    cmc: 7,
  };
  const counterspell: CardDefinition = {
    ...def('counterspell', 'Counterspell', 'Instant', '{U}{U}'),
    cmc: 2,
  };
  const bloodCrypt: CardDefinition = {
    ...def('blood_crypt', 'Blood Crypt', 'Land - Swamp Mountain'),
    cmc: 0,
  };

  return {
    players: [
      {
        id: 'p1',
        name: 'Player One',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'p2',
        name: 'Player Two',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['sisay_1', cardInstance('sisay_1', sisay.id, 'p1', 'battlefield')],
      ['yoshimaru_1', cardInstance('yoshimaru_1', yoshimaru.id, 'p1', 'library')],
      ['arcane_signet_1', cardInstance('arcane_signet_1', arcaneSignet.id, 'p1', 'library')],
      ['akromas_memorial_1', cardInstance('akromas_memorial_1', akromasMemorial.id, 'p1', 'library')],
      ['counterspell_1', cardInstance('counterspell_1', counterspell.id, 'p1', 'library')],
      ['blood_crypt_1', cardInstance('blood_crypt_1', bloodCrypt.id, 'p1', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [sisay.id, sisay],
      [yoshimaru.id, yoshimaru],
      [arcaneSignet.id, arcaneSignet],
      [akromasMemorial.id, akromasMemorial],
      [counterspell.id, counterspell],
      [bloodCrypt.id, bloodCrypt],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

function stateWithSearchedShockLand(): GameState {
  const templeGarden: CardDefinition = {
    ...def(
      'temple_garden',
      'Temple Garden',
      'Land - Forest Plains',
      '',
      'As Temple Garden enters the battlefield, you may pay 2 life. If you don\'t, it enters the battlefield tapped.',
    ),
    cmc: 0,
  };
  return {
    players: [
      {
        id: 'p1',
        name: 'Player One',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'p2',
        name: 'Player Two',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['temple_garden_1', cardInstance('temple_garden_1', templeGarden.id, 'p1', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [templeGarden.id, templeGarden],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

function stateWithTargetChoices(): GameState {
  const forest = def('forest', 'Forest', 'Basic Land - Forest');
  const bear: CardDefinition = {
    ...def('bear', 'Grizzly Bears', 'Creature - Bear', '{1}{G}'),
    cmc: 2,
    power: 2,
    toughness: 2,
  };
  return {
    players: [
      {
        id: 'p1',
        name: 'Player One',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'p2',
        name: 'Player Two',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['forest_1', cardInstance('forest_1', forest.id, 'p1', 'battlefield')],
      ['bear_1', cardInstance('bear_1', bear.id, 'p2', 'battlefield')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [forest.id, forest],
      [bear.id, bear],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

function stateWithManaSource(): GameState {
  const state = stateWithForestInHand();
  const forest = [...state.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1');
  if (!forest) throw new Error('Forest not found');
  state.cards.set(forest.instanceId, { ...forest, zone: 'battlefield', tapped: false });
  const forestDef = state.cardDefinitions.get('forest');
  if (!forestDef) throw new Error('Forest definition not found');
  state.cardDefinitions.set('forest', {
    ...forestDef,
    manaProduction: {
      colors: ['G'],
      amounts: { G: 1 },
      isTapAbility: true,
      requiresSacrifice: false,
    },
  });
  return state;
}

describe('authority action boundary', () => {
  it('builds typed prompts from canonical legal actions', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');

    expect(prompt?.type).toBe('main-action');
    expect(prompt?.title).toBe('Choose an action');
    expect(prompt?.guidance).toContain('Main phase actions are available');
    expect(prompt?.playerId).toBe('p1');
    expect(prompt?.priority.priorityPlayerId).toBe('p1');
    expect(prompt?.priority.stackSize).toBe(0);
    expect(prompt?.legalChoiceSummary).toEqual(expect.arrayContaining([
      { kind: 'PlayLand', label: 'Land', count: 1 },
      { kind: 'PassPriority', label: 'Pass', count: 1 },
    ]));
    expect(prompt?.legalChoices.some(choice => choice.kind === 'PlayLand' && choice.label === 'Play Forest')).toBe(true);
    expect(prompt?.legalChoices.some(choice => choice.kind === 'PassPriority')).toBe(true);
  });

  it('creates typed Sisay search prompts from canonical legality and rejects forced illegal choices', () => {
    const state = stateWithSisaySearchChoices();
    const filter: CardFilter = {
      supertypes: ['Legendary'],
      permanent: true,
      manaValueLessThanSourcePower: true,
    };
    const request = createSearchLibraryPromptRequest(state, 'p1', filter, 'battlefield', {
      id: 'prompt-sisay',
      sourceInstanceId: 'sisay_1',
      shuffle: true,
      minSelections: 1,
      maxSelections: 1,
      createdAt: 11,
    });

    expect(request.kind).toBe('SearchLibrary');
    expect(request.expectedStateId).toBe(stateFingerprint(state));
    expect(request.legalChoices.map(choice => choice.cardName)).toEqual(['Yoshimaru, Ever Faithful']);
    expect(request.invalidChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardInstanceId: 'arcane_signet_1',
        cardName: 'Arcane Signet',
        legal: false,
        reason: 'Not Legendary',
      }),
      expect.objectContaining({
        cardInstanceId: 'counterspell_1',
        cardName: 'Counterspell',
        legal: false,
        reason: 'Not a permanent card',
      }),
      expect.objectContaining({
        cardInstanceId: 'akromas_memorial_1',
        cardName: "Akroma's Memorial",
        legal: false,
        reason: 'Mana value 7 is not less than source power 2',
      }),
    ]));

    const rejected = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['arcane_signet_1'],
    });

    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');
    expect(rejected.message).toContain('Not Legendary');
    expect(rejected.state).toBeUndefined();
    expect(rejected.update?.visibleDiffs).toEqual([]);
    expect(rejected.update?.rulesEvents).toEqual([{
      kind: 'PromptResponseRejected',
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'SearchLibrary',
      reason: 'illegal_response',
      message: 'Illegal search selection: Not Legendary',
      selectedCardInstanceIds: ['arcane_signet_1'],
    }]);
    expect(state.cards.get('arcane_signet_1')?.zone).toBe('library');
    expect(state.cards.get('yoshimaru_1')?.zone).toBe('library');

    const accepted = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['yoshimaru_1'],
    });

    expect(accepted.ok).toBe(true);
    expect(accepted.state?.cards.get('yoshimaru_1')?.zone).toBe('battlefield');
    expect(accepted.update?.visibleDiffs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'CardZoneChanged',
        cardName: 'Yoshimaru, Ever Faithful',
        from: 'library',
        to: 'battlefield',
      }),
    ]));
    expect(accepted.update?.rulesEvents).toEqual([{
      kind: 'PromptResponseAccepted',
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'SearchLibrary',
      selectedCardInstanceIds: ['yoshimaru_1'],
      destination: 'battlefield',
    }]);
  });

  it('uses Sisay current dynamic power when validating search prompt choices', () => {
    const sisay: CardDefinition = {
      ...def('sisay', 'Sisay, Weatherlight Captain', 'Legendary Creature - Human Soldier', '{2}{W}'),
      cmc: 3,
      colors: ['W'],
      power: 2,
      toughness: 2,
    };
    const legendWU: CardDefinition = {
      ...def('legend_wu', 'Two-Color Legend', 'Legendary Creature - Advisor', '{W}{U}'),
      cmc: 2,
      colors: ['W', 'U'],
      power: 2,
      toughness: 2,
    };
    const legendR: CardDefinition = {
      ...def('legend_r', 'Red Legend', 'Legendary Creature - Shaman', '{R}'),
      cmc: 1,
      colors: ['R'],
      power: 1,
      toughness: 1,
    };
    const legalFourDrop: CardDefinition = {
      ...def('legal_four', 'Four-Mana Legend', 'Legendary Creature - Time Lord', '{3}{U}'),
      cmc: 4,
      colors: ['U'],
      power: 4,
      toughness: 4,
    };
    const illegalFiveDrop: CardDefinition = {
      ...def('illegal_five', 'Five-Mana Legend', 'Legendary Creature - Avatar', '{4}{G}'),
      cmc: 5,
      colors: ['G'],
      power: 5,
      toughness: 5,
    };

    let state: GameState = {
      ...stateWithSisaySearchChoices(),
      cards: new Map<string, CardInstance>([
        ['sisay_1', cardInstance('sisay_1', sisay.id, 'p1', 'battlefield')],
        ['legend_wu_1', cardInstance('legend_wu_1', legendWU.id, 'p1', 'battlefield')],
        ['legend_r_1', cardInstance('legend_r_1', legendR.id, 'p1', 'battlefield')],
        ['legal_four_1', cardInstance('legal_four_1', legalFourDrop.id, 'p1', 'library')],
        ['illegal_five_1', cardInstance('illegal_five_1', illegalFiveDrop.id, 'p1', 'library')],
      ]),
      cardDefinitions: new Map<string, CardDefinition>([
        [sisay.id, sisay],
        [legendWU.id, legendWU],
        [legendR.id, legendR],
        [legalFourDrop.id, legalFourDrop],
        [illegalFiveDrop.id, illegalFiveDrop],
      ]),
    };

    state = registerContinuousEffect(state, 'sisay_1', 'p1', {
      kind: 'StaticAbility',
      modifier: {
        kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl',
        powerPerColor: 1,
        toughnessPerColor: 1,
      },
      filter: {},
      controller: 'any',
      excludeSelf: false,
      selfOnly: true,
    });

    expect(getEffectivePower(state, 'sisay_1')).toBe(5);

    const request = createSearchLibraryPromptRequest(
      state,
      'p1',
      { supertypes: ['Legendary'], permanent: true, manaValueLessThanSourcePower: true },
      'battlefield',
      {
        id: 'prompt-boosted-sisay',
        sourceInstanceId: 'sisay_1',
        minSelections: 1,
        maxSelections: 1,
        createdAt: 13,
      },
    );

    expect(request.legalChoices.map(choice => choice.cardName)).toEqual(['Four-Mana Legend']);
    expect(request.invalidChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardInstanceId: 'illegal_five_1',
        reason: 'Mana value 5 is not less than source power 5',
      }),
    ]));

    const accepted = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['legal_four_1'],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state?.cards.get('legal_four_1')?.zone).toBe('battlefield');
  });

  it('rejects stale typed search responses after canonical state changes', () => {
    const state = stateWithSisaySearchChoices();
    const filter: CardFilter = {
      supertypes: ['Legendary'],
      permanent: true,
      manaValueLessThanSourcePower: true,
    };
    const request = createSearchLibraryPromptRequest(state, 'p1', filter, 'battlefield', {
      id: 'prompt-stale-sisay',
      sourceInstanceId: 'sisay_1',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 12,
    });
    const changedState: GameState = { ...state, turnNumber: 2 };

    const response = applySearchLibraryPromptResponse(changedState, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['yoshimaru_1'],
    });

    expect(response.ok).toBe(false);
    expect(response.reason).toBe('stale_state');
    expect(response.state).toBeUndefined();
    expect(response.update?.visibleDiffs).toEqual([]);
    expect(changedState.cards.get('yoshimaru_1')?.zone).toBe('library');
  });

  it('audits typed search prompt responses by replaying legality and invariants', () => {
    const state = stateWithSisaySearchChoices();
    const filter: CardFilter = {
      supertypes: ['Legendary'],
      permanent: true,
      manaValueLessThanSourcePower: true,
    };
    const request = createSearchLibraryPromptRequest(state, 'p1', filter, 'battlefield', {
      id: 'prompt-audit-sisay',
      sourceInstanceId: 'sisay_1',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 13,
    });
    const report = auditSearchPromptReplay(state, [{
      request,
      response: {
        requestId: request.id,
        kind: 'SearchLibrary',
        playerId: 'p1',
        selectedCardInstanceIds: ['yoshimaru_1'],
      },
    }]);

    expect(report.ok).toBe(true);
    expect(report.steps).toEqual([expect.objectContaining({
      index: 0,
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'SearchLibrary',
      stateBeforeId: stateFingerprint(state),
      ok: true,
    })]);
    expect(report.finalState?.cards.get('yoshimaru_1')?.zone).toBe('battlefield');

    const illegalReport = auditSearchPromptReplay(state, [{
      request,
      response: {
        requestId: request.id,
        kind: 'SearchLibrary',
        playerId: 'p1',
        selectedCardInstanceIds: ['arcane_signet_1'],
      },
    }]);

    expect(illegalReport.ok).toBe(false);
    expect(illegalReport.finalState).toBeUndefined();
    expect(illegalReport.steps).toEqual([expect.objectContaining({
      requestId: request.id,
      ok: false,
      reason: 'illegal_response',
      message: 'Illegal search selection: Not Legendary',
    })]);
  });

  it('validates replacement responses for searched shock lands', () => {
    const state = stateWithSearchedShockLand();
    const filter: CardFilter = { types: ['land'], subtypes: ['Forest', 'Plains'] };
    const untappedRequest = createSearchLibraryPromptRequest(state, 'p1', filter, 'battlefield', {
      id: 'prompt-shock-untapped',
      tapped: false,
      minSelections: 1,
      maxSelections: 1,
      createdAt: 15,
    });
    const accepted = applySearchLibraryPromptResponse(state, untappedRequest, {
      requestId: untappedRequest.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['temple_garden_1'],
      payLifeToEnterUntapped: true,
    });

    expect(accepted.ok).toBe(true);
    expect(accepted.state?.players.find(player => player.id === 'p1')?.life).toBe(38);
    expect(accepted.state?.cards.get('temple_garden_1')?.zone).toBe('battlefield');
    expect(accepted.state?.cards.get('temple_garden_1')?.tapped).toBe(false);

    const tappedRequest = createSearchLibraryPromptRequest(state, 'p1', filter, 'battlefield', {
      id: 'prompt-shock-forced-tapped',
      tapped: true,
      minSelections: 1,
      maxSelections: 1,
      createdAt: 16,
    });
    const rejected = applySearchLibraryPromptResponse(state, tappedRequest, {
      requestId: tappedRequest.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['temple_garden_1'],
      payLifeToEnterUntapped: true,
    });

    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');
    expect(rejected.message).toContain('effect puts the card onto the battlefield tapped');
    expect(rejected.state).toBeUndefined();
    expect(state.cards.get('temple_garden_1')?.zone).toBe('library');
  });

  it('creates typed replacement prompts and rejects unavailable replacement choices', () => {
    const state = stateWithSearchedShockLand();
    const request = createBattlefieldEntryReplacementPromptRequest(state, 'p1', 'temple_garden_1', {
      id: 'prompt-entry-shock',
      createdAt: 17,
    });

    expect(request.kind).toBe('ChooseReplacement');
    expect(request.expectedStateId).toBe(stateFingerprint(state));
    expect(request.legalChoices.map(choice => choice.optionId)).toEqual([
      'pay_life_enter_untapped',
      'enter_tapped',
    ]);

    const accepted = applyChooseReplacementPromptResponse(state, request, {
      requestId: request.id,
      kind: 'ChooseReplacement',
      playerId: 'p1',
      selectedOptionId: 'pay_life_enter_untapped',
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state).toBe(state);
    expect(accepted.selectedReplacementOptionId).toBe('pay_life_enter_untapped');
    expect(accepted.update?.rulesEvents).toEqual([{
      kind: 'PromptResponseAccepted',
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'ChooseReplacement',
      selectedReplacementOptionId: 'pay_life_enter_untapped',
    }]);

    const forcedTappedRequest = createBattlefieldEntryReplacementPromptRequest(state, 'p1', 'temple_garden_1', {
      id: 'prompt-entry-forced-tapped',
      forceTapped: true,
      createdAt: 18,
    });
    expect(forcedTappedRequest.invalidChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        optionId: 'pay_life_enter_untapped',
        legal: false,
        reason: 'This effect forces the permanent to enter tapped',
      }),
    ]));

    const rejected = applyChooseReplacementPromptResponse(state, forcedTappedRequest, {
      requestId: forcedTappedRequest.id,
      kind: 'ChooseReplacement',
      playerId: 'p1',
      selectedOptionId: 'pay_life_enter_untapped',
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');
    expect(rejected.message).toContain('forces the permanent to enter tapped');
  });

  it('creates typed target prompts and rejects illegal target ids without mutation', () => {
    const state = stateWithTargetChoices();
    const spec: TargetSpec = { id: 'target-permanent', type: 'Permanent', count: 1 };
    const request = createSelectTargetPromptRequest(state, 'p1', spec, {
      id: 'prompt-target-permanent',
      createdAt: 17,
    });

    expect(request.expectedStateId).toBe(stateFingerprint(state));
    expect(request.legalChoices.map(choice => choice.targetId)).toEqual(expect.arrayContaining(['forest_1', 'bear_1']));
    expect(request.invalidChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'p1', legal: false }),
      expect.objectContaining({ targetId: 'p2', legal: false }),
    ]));

    const rejected = applySelectTargetPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectTarget',
      playerId: 'p1',
      selectedTargetIds: ['p2'],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');
    expect(rejected.message).toContain('Illegal target selection');
    expect(rejected.state).toBeUndefined();
    expect(rejected.update?.visibleDiffs).toEqual([]);

    const accepted = applySelectTargetPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectTarget',
      playerId: 'p1',
      selectedTargetIds: ['bear_1'],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state).toBe(state);
    expect(accepted.selectedTargetIds).toEqual(['bear_1']);
    expect(accepted.update?.rulesEvents).toEqual([{
      kind: 'PromptResponseAccepted',
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'SelectTarget',
      selectedTargetIds: ['bear_1'],
    }]);
  });

  it('audits typed target prompt responses by replaying legality without mutation', () => {
    const state = stateWithTargetChoices();
    const spec: TargetSpec = { id: 'target-permanent', type: 'Permanent', count: 1 };
    const request = createSelectTargetPromptRequest(state, 'p1', spec, {
      id: 'prompt-audit-target',
      createdAt: 18,
    });

    const report = auditPromptReplay(state, [{
      request,
      response: {
        requestId: request.id,
        kind: 'SelectTarget',
        playerId: 'p1',
        selectedTargetIds: ['bear_1'],
      },
    }]);

    expect(report.ok).toBe(true);
    expect(report.finalState).toBe(state);
    expect(report.steps).toEqual([expect.objectContaining({
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'SelectTarget',
      ok: true,
    })]);

    const illegalReport = auditPromptReplay(state, [{
      request,
      response: {
        requestId: request.id,
        kind: 'SelectTarget',
        playerId: 'p1',
        selectedTargetIds: ['p2'],
      },
    }]);

    expect(illegalReport.ok).toBe(false);
    expect(illegalReport.steps).toEqual([expect.objectContaining({
      requestId: request.id,
      promptKind: 'SelectTarget',
      ok: false,
      reason: 'illegal_response',
    })]);
  });

  it('audits typed replacement prompt responses with the same prompt replay path', () => {
    const state = stateWithSearchedShockLand();
    const request = createBattlefieldEntryReplacementPromptRequest(state, 'p1', 'temple_garden_1', {
      id: 'prompt-audit-replacement',
      createdAt: 19,
    });

    const report = auditPromptReplay(state, [{
      request,
      response: {
        requestId: request.id,
        kind: 'ChooseReplacement',
        playerId: 'p1',
        selectedOptionId: 'enter_tapped',
      },
    }]);

    expect(report.ok).toBe(true);
    expect(report.finalState).toBe(state);
    expect(report.steps).toEqual([expect.objectContaining({
      requestId: request.id,
      promptKind: 'ChooseReplacement',
      ok: true,
    })]);

    const forcedTapped = createBattlefieldEntryReplacementPromptRequest(state, 'p1', 'temple_garden_1', {
      id: 'prompt-audit-forced-replacement',
      forceTapped: true,
      createdAt: 20,
    });
    const illegalReport = auditPromptReplay(state, [{
      request: forcedTapped,
      response: {
        requestId: forcedTapped.id,
        kind: 'ChooseReplacement',
        playerId: 'p1',
        selectedOptionId: 'pay_life_enter_untapped',
      },
    }]);

    expect(illegalReport.ok).toBe(false);
    expect(illegalReport.steps).toEqual([expect.objectContaining({
      promptKind: 'ChooseReplacement',
      ok: false,
      reason: 'illegal_response',
    })]);
  });

  it('audits mixed action and prompt records as one committed replay stream', () => {
    const state = stateWithTargetChoices();
    const pass = buildActionPrompt(state, 'p1')?.legalChoices.find(choice => choice.kind === 'PassPriority')?.action;
    expect(pass).toBeDefined();
    const actionRequest = createClientActionRequest(state, 'p1', pass as AIAction, {
      id: 'req-replay-pass',
      createdAt: 23,
    });
    const afterPass = applyClientActionRequest(state, actionRequest);
    expect(afterPass.ok).toBe(true);
    expect(afterPass.state).toBeDefined();

    const targetRequest = createSelectTargetPromptRequest(afterPass.state!, 'p1', {
      id: 'target-permanent',
      type: 'Permanent',
      count: 1,
    }, {
      id: 'prompt-replay-target',
      createdAt: 24,
    });

    const report = auditEngineReplay(state, [
      { kind: 'Action', request: actionRequest },
      {
        kind: 'Prompt',
        request: targetRequest,
        response: {
          requestId: targetRequest.id,
          kind: 'SelectTarget',
          playerId: 'p1',
          selectedTargetIds: ['bear_1'],
        },
      },
    ]);

    expect(report.ok).toBe(true);
    expect(report.finalState).toBeDefined();
    expect(report.steps).toEqual([
      expect.objectContaining({ kind: 'Action', actionKind: 'PassPriority', ok: true }),
      expect.objectContaining({ kind: 'Prompt', promptKind: 'SelectTarget', ok: true }),
    ]);
  });

  it('validates pay-cost prompt responses and applies mana taps through authority', () => {
    const state = stateWithManaSource();
    const manaAction = buildActionPrompt(state, 'p1')?.legalChoices
      .find(choice => choice.kind === 'ActivateManaAbility')?.action as Extract<AIAction, { kind: 'ActivateManaAbility' }> | undefined;
    expect(manaAction).toBeDefined();

    const request = createPayCostsPromptRequest(state, 'p1', {
      W: 0,
      U: 0,
      B: 0,
      R: 0,
      G: 1,
      C: 0,
      generic: 0,
    }, {
      id: 'prompt-pay-green',
      proposedManaActions: [manaAction!],
      createdAt: 21,
    });

    expect(request.legalChoices).toHaveLength(1);
    const accepted = applyPayCostsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'PayCosts',
      playerId: 'p1',
      selectedManaActions: [manaAction!],
    });

    expect(accepted.ok).toBe(true);
    expect(accepted.state?.cards.get(manaAction!.cardInstanceId)?.tapped).toBe(true);
    expect(accepted.state?.players.find(player => player.id === 'p1')?.manaPool.G).toBe(1);
    expect(accepted.update?.rulesEvents).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'PromptResponseAccepted',
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'PayCosts',
    })]));

    const insufficient = applyPayCostsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'PayCosts',
      playerId: 'p1',
      selectedManaActions: [],
    });
    expect(insufficient.ok).toBe(false);
    expect(insufficient.reason).toBe('illegal_response');
    expect(insufficient.message).toContain('do not produce enough mana');
  });

  it('validates mandatory card-selection prompts for cleanup discard', () => {
    const state = stateWithForestInHand();
    const forest = [...state.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1');
    expect(forest).toBeDefined();
    const request = createSelectCardsPromptRequest(state, 'p1', {
      id: 'prompt-cleanup-discard',
      subject: 'DiscardToHandSize',
      zone: 'hand',
      destination: 'graveyard',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 22,
    });

    expect(request.kind).toBe('SelectCards');
    expect(request.legalChoices.map(choice => choice.cardInstanceId)).toContain(forest!.instanceId);

    const accepted = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: [forest!.instanceId],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state?.cards.get(forest!.instanceId)?.zone).toBe('graveyard');
    expect(accepted.update?.rulesEvents).toEqual([{
      kind: 'PromptResponseAccepted',
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'SelectCards',
      selectedCardInstanceIds: [forest!.instanceId],
    }]);

    const illegal = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: ['missing-card'],
    });
    expect(illegal.ok).toBe(false);
    expect(illegal.reason).toBe('illegal_response');
    expect(illegal.state).toBeUndefined();
  });

  it('validates opening mulligan card selections before redraw and bottom decisions', () => {
    const state = stateWithForestInHand();
    const forest = [...state.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1');
    expect(forest).toBeDefined();

    const mulliganRequest = createSelectCardsPromptRequest(state, 'p1', {
      id: 'prompt-opening-mulligan',
      subject: 'OpeningMulligan',
      zone: 'hand',
      destination: 'library',
      commitSelection: false,
      minSelections: 1,
      maxSelections: 7,
      createdAt: 223,
    });
    const mulliganAccepted = applySelectCardsPromptResponse(state, mulliganRequest, {
      requestId: mulliganRequest.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: [forest!.instanceId],
    });

    expect(mulliganAccepted.ok).toBe(true);
    expect(mulliganAccepted.state).toBe(state);
    expect(state.cards.get(forest!.instanceId)?.zone).toBe('hand');

    const bottomRequest = createSelectCardsPromptRequest(state, 'p1', {
      id: 'prompt-opening-mulligan-bottom',
      subject: 'OpeningMulliganBottom',
      zone: 'hand',
      destination: 'library',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 224,
    });
    const bottomAccepted = applySelectCardsPromptResponse(state, bottomRequest, {
      requestId: bottomRequest.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: [forest!.instanceId],
    });

    expect(bottomAccepted.ok).toBe(true);
    expect(bottomAccepted.state?.cards.get(forest!.instanceId)?.zone).toBe('library');
  });

  it('validates combat damage blocker ordering and uses it during combat damage', () => {
    const attacker: CardDefinition = {
      ...def('attacker', 'Charging Beast', 'Creature - Beast'),
      power: 3,
      toughness: 3,
    };
    const smallBlocker: CardDefinition = {
      ...def('small_blocker', 'Small Guard', 'Creature - Soldier'),
      power: 1,
      toughness: 1,
    };
    const largeBlocker: CardDefinition = {
      ...def('large_blocker', 'Large Guard', 'Creature - Giant'),
      power: 5,
      toughness: 5,
    };
    const base = stateWithSisaySearchChoices();
    const state: GameState = {
      ...base,
      phase: 'combat',
      step: 'combat_damage',
      cards: new Map<string, CardInstance>([
        ['attacker_1', cardInstance('attacker_1', attacker.id, 'p1', 'battlefield')],
        ['small_blocker_1', cardInstance('small_blocker_1', smallBlocker.id, 'p2', 'battlefield')],
        ['large_blocker_1', cardInstance('large_blocker_1', largeBlocker.id, 'p2', 'battlefield')],
      ]),
      cardDefinitions: new Map<string, CardDefinition>([
        [attacker.id, attacker],
        [smallBlocker.id, smallBlocker],
        [largeBlocker.id, largeBlocker],
      ]),
      combat: {
        attackers: [{ cardInstanceId: 'attacker_1', defendingPlayerId: 'p2' }],
        blockers: [
          { cardInstanceId: 'small_blocker_1', blockingAttackerId: 'attacker_1' },
          { cardInstanceId: 'large_blocker_1', blockingAttackerId: 'attacker_1' },
        ],
        blockersDeclared: true,
        blockersDeclaredBy: ['p2'],
        damageAssignment: new Map(),
      },
    };

    const request = createDamageAssignmentPromptRequest(state, 'p1', {
      id: 'prompt-damage-order',
      createdAt: 230,
    });
    expect(request.groups).toEqual([expect.objectContaining({
      attackerId: 'attacker_1',
      attackerPower: 3,
      blockers: expect.arrayContaining([
        expect.objectContaining({ blockerId: 'small_blocker_1', lethalDamage: 1 }),
        expect.objectContaining({ blockerId: 'large_blocker_1', lethalDamage: 5 }),
      ]),
    })]);

    const rejected = applyDamageAssignmentPromptResponse(state, request, {
      requestId: request.id,
      kind: 'DamageAssignment',
      playerId: 'p1',
      orders: [{ attackerId: 'attacker_1', blockerIds: ['large_blocker_1', 'large_blocker_1'] }],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');

    const accepted = applyDamageAssignmentPromptResponse(state, request, {
      requestId: request.id,
      kind: 'DamageAssignment',
      playerId: 'p1',
      orders: [{ attackerId: 'attacker_1', blockerIds: ['large_blocker_1', 'small_blocker_1'] }],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state?.combat?.blockerOrder).toEqual({
      attacker_1: ['large_blocker_1', 'small_blocker_1'],
    });

    const damaged = resolveCombatDamage(accepted.state!);
    expect(damaged.cards.get('large_blocker_1')?.damage).toBe(3);
    expect(damaged.cards.get('small_blocker_1')?.damage).toBe(0);
  });

  it('validates additional-cost land selections without committing the discard early', () => {
    const state = stateWithForestInHand();
    const signet = def('arcane_signet', 'Arcane Signet', 'Artifact', '{2}');
    state.cardDefinitions.set(signet.id, signet);
    state.cards.set('signet_in_hand', cardInstance('signet_in_hand', signet.id, 'p1', 'hand'));
    const forest = [...state.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1');
    expect(forest).toBeDefined();

    const request = createSelectCardsPromptRequest(state, 'p1', {
      id: 'prompt-mox-diamond-discard',
      subject: 'AdditionalCost',
      zone: 'hand',
      destination: 'graveyard',
      filter: { types: ['land'] },
      commitSelection: false,
      minSelections: 1,
      maxSelections: 1,
      createdAt: 23,
    });

    expect(request.legalChoices.map(choice => choice.cardInstanceId)).toContain(forest!.instanceId);
    expect(request.invalidChoices.find(choice => choice.cardInstanceId === 'signet_in_hand')?.reason)
      .toContain('required selection filter');

    const accepted = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: [forest!.instanceId],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.selectedCardInstanceIds).toEqual([forest!.instanceId]);
    expect(accepted.state?.cards.get(forest!.instanceId)?.zone).toBe('hand');

    const illegal = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: ['signet_in_hand'],
    });
    expect(illegal.ok).toBe(false);
    expect(illegal.message).toContain('required selection filter');
  });

  it('validates scry and surveil library manipulation responses against the revealed card set', () => {
    const state = stateWithSisaySearchChoices();
    const request = createLibraryManipulationPromptRequest(state, 'p1', 'surveil', 3, {
      id: 'prompt-surveil-three',
      stackItemId: 'stack-surveil',
      createdAt: 24,
    });
    const revealedIds = request.legalChoices.map(choice => choice.cardInstanceId);
    expect(revealedIds).toHaveLength(3);

    const accepted = applyLibraryManipulationPromptResponse(state, request, {
      requestId: request.id,
      kind: 'LibraryManipulation',
      playerId: 'p1',
      topCardInstanceIds: [revealedIds[1]],
      movedCardInstanceIds: [revealedIds[0], revealedIds[2]],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state).toBe(state);
    expect(accepted.libraryManipulationChoices).toEqual({
      surveilTopIds: revealedIds[1],
      surveilGraveyardIds: `${revealedIds[0]},${revealedIds[2]}`,
    });

    const illegal = applyLibraryManipulationPromptResponse(state, request, {
      requestId: request.id,
      kind: 'LibraryManipulation',
      playerId: 'p1',
      topCardInstanceIds: [revealedIds[0]],
      movedCardInstanceIds: ['not-revealed'],
    });
    expect(illegal.ok).toBe(false);
    expect(illegal.message).toContain('choose each revealed card exactly once');
  });

  it('validates modal mode choices before a modal cast is submitted', () => {
    const state = stateWithForestInHand();
    const charm = def('test_charm', 'Test Charm', 'Instant', '{U}', 'Choose one —\n• Draw a card.\n• Gain 3 life.');
    state.cardDefinitions.set(charm.id, charm);
    state.cards.set('charm_in_hand', cardInstance('charm_in_hand', charm.id, 'p1', 'hand'));
    const request = createChooseModePromptRequest(state, 'p1', 'charm_in_hand', {
      id: 'prompt-mode-choice',
      createdAt: 25,
    });

    expect(request.kind).toBe('ChooseMode');
    expect(request.legalChoices.map(choice => choice.modeIndex)).toEqual([0, 1]);

    const accepted = applyChooseModePromptResponse(state, request, {
      requestId: request.id,
      kind: 'ChooseMode',
      playerId: 'p1',
      selectedModeIndices: [1],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.selectedModeIndices).toEqual([1]);
    expect(accepted.state).toBe(state);

    const illegal = applyChooseModePromptResponse(state, request, {
      requestId: request.id,
      kind: 'ChooseMode',
      playerId: 'p1',
      selectedModeIndices: [3],
    });
    expect(illegal.ok).toBe(false);
    expect(illegal.reason).toBe('illegal_response');
  });

  it('includes selected target names in command labels', () => {
    const state = stateWithForestInHand();
    const source = [...state.cards.values()].find(card => card.ownerId === 'p1' && card.definitionId === 'commander');
    const target = [...state.cards.values()].find(card => card.ownerId === 'p2' && card.definitionId === 'island');
    expect(source).toBeDefined();
    expect(target).toBeDefined();
    state.cards.set(target!.instanceId, { ...target!, zone: 'battlefield' });

    expect(labelForAction(state, {
      kind: 'CastSpell',
      cardInstanceId: source!.instanceId,
      targets: [target!.instanceId],
    })).toBe('Cast Test Commander targeting Island');
  });

  it('validates a client action request, applies it, and emits visible diffs', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const playLand = prompt?.legalChoices.find(choice => choice.kind === 'PlayLand')?.action;
    expect(playLand).toBeDefined();

    const request = createClientActionRequest(state, 'p1', playLand as AIAction, {
      id: 'req-play-forest',
      createdAt: 1,
    });
    const response = applyClientActionRequest(state, request);

    expect(response.ok).toBe(true);
    expect(response.state?.cards.get((playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId)?.zone)
      .toBe('battlefield');
    expect(response.events).toEqual(expect.arrayContaining([
      { kind: 'LandPlayed', playerId: 'p1', cardId: (playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId },
    ]));
    expect(response.update?.oldStateId).toBe(stateFingerprint(state));
    expect(response.update?.rulesEvents).toContainEqual({
      kind: 'ActionAccepted',
      requestId: 'req-play-forest',
      playerId: 'p1',
      actionKind: 'PlayLand',
      label: 'Play Forest',
    });
    expect(response.update?.rulesEvents).toEqual(expect.arrayContaining([
      { kind: 'RulesEvent', event: { kind: 'LandPlayed', playerId: 'p1', cardId: (playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId } },
    ]));
    expect(response.update?.visibleDiffs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'CardZoneChanged',
        cardName: 'Forest',
        from: 'hand',
        to: 'battlefield',
      }),
    ]));
    expect(response.update?.prompt?.playerId).toBe('p1');
  });

  it('rejects actions that were not issued by the current engine prompt', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const playLand = prompt?.legalChoices.find(choice => choice.kind === 'PlayLand')?.action;
    expect(playLand).toBeDefined();

    const forged = createClientActionRequest(state, 'p1', playLand as AIAction, {
      id: 'req-forged-action-id',
      actionId: 'not-a-current-prompt-choice',
      createdAt: 2,
    });
    const response = applyClientActionRequest(state, forged);

    expect(response.ok).toBe(false);
    expect(response.reason).toBe('illegal_action');
    expect(response.message).toBe('That action was not offered by the current engine prompt.');
    expect(response.state).toBeUndefined();
    expect(state.cards.get((playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId)?.zone)
      .toBe('hand');
  });

  it('rejects stale and illegal action requests without mutating state', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const pass = prompt?.legalChoices.find(choice => choice.kind === 'PassPriority')?.action;
    expect(pass).toBeDefined();

    const stale = applyClientActionRequest(state, {
      ...createClientActionRequest(state, 'p1', pass as AIAction, { id: 'req-stale', createdAt: 1 }),
      expectedStateId: 'old-state',
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toBe('stale_state');
    expect(stale.state).toBeUndefined();
    expect(stale.events).toBeUndefined();
    expect(stale.update?.visibleDiffs).toEqual([]);

    const illegal = applyClientActionRequest(
      state,
      createClientActionRequest(state, 'p2', pass as AIAction, { id: 'req-illegal', createdAt: 2 }),
    );
    expect(illegal.ok).toBe(false);
    expect(illegal.reason).toBe('illegal_action');
    expect(illegal.state).toBeUndefined();
    expect(illegal.events).toBeUndefined();
    expect(illegal.update?.rulesEvents).toEqual([
      {
        kind: 'ActionRejected',
        requestId: 'req-illegal',
        playerId: 'p2',
        actionKind: 'PassPriority',
        reason: 'illegal_action',
        message: 'That action is not legal in the current game state.',
      },
    ]);
  });

  it('rejects direct land-play requests while the stack is non-empty', () => {
    const state = stateWithForestInHand();
    const forest = [...state.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1');
    const commander = [...state.cards.values()].find(card => card.definitionId === 'commander' && card.ownerId === 'p1');
    expect(forest).toBeDefined();
    expect(commander).toBeDefined();
    const stackedState: GameState = {
      ...state,
      cards: new Map(state.cards).set(commander!.instanceId, { ...commander!, zone: 'stack' }),
      stack: [{
        kind: 'Spell',
        id: 'stack-commander',
        cardInstanceId: commander!.instanceId,
        casterId: 'p1',
        targets: [],
      }],
    };

    const response = applyClientActionRequest(stackedState, createClientActionRequest(
      stackedState,
      'p1',
      { kind: 'PlayLand', cardInstanceId: forest!.instanceId },
      { id: 'req-illegal-land-stack', createdAt: 14 },
    ));

    expect(response.ok).toBe(false);
    expect(response.reason).toBe('illegal_action');
    expect(response.message).toBe('The stack must be empty');
    expect(response.state).toBeUndefined();
    expect(stackedState.cards.get(forest!.instanceId)?.zone).toBe('hand');
  });

  it('audits committed action requests by replaying legality and state invariants', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const playLand = prompt?.legalChoices.find(choice => choice.kind === 'PlayLand')?.action;
    expect(playLand).toBeDefined();

    const request = createClientActionRequest(state, 'p1', playLand as AIAction, {
      id: 'req-audit-play-forest',
      createdAt: 7,
    });
    const report = auditActionReplay(state, [request]);

    expect(report.ok).toBe(true);
    expect(report.steps).toEqual([
      expect.objectContaining({
        index: 0,
        requestId: 'req-audit-play-forest',
        actionKind: 'PlayLand',
        ok: true,
        stateBeforeId: stateFingerprint(state),
      }),
    ]);
    expect(report.finalState?.cards.get((playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId)?.zone)
      .toBe('battlefield');
  });

  it('fails replay audit when a committed request no longer matches the previous state', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const pass = prompt?.legalChoices.find(choice => choice.kind === 'PassPriority')?.action;
    expect(pass).toBeDefined();

    const staleRequest = {
      ...createClientActionRequest(state, 'p1', pass as AIAction, { id: 'req-audit-stale', createdAt: 8 }),
      expectedStateId: 'not-this-state',
    };
    const report = auditActionReplay(state, [staleRequest]);

    expect(report.ok).toBe(false);
    expect(report.finalState).toBeUndefined();
    expect(report.steps).toEqual([
      expect.objectContaining({
        requestId: 'req-audit-stale',
        ok: false,
        reason: 'stale_state',
      }),
    ]);
  });

  it('does not expose or accept land plays while the stack is nonempty', () => {
    const state = stateWithForestInHand();
    const forest = [...state.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1')!;
    const commander = [...state.cards.values()].find(card => card.definitionId === 'commander' && card.ownerId === 'p1')!;
    const instant = def('free-instant', 'Free Instant', 'Instant');
    const creature = def('free-creature', 'Free Creature', 'Creature - Bear');
    state.cardDefinitions.set(instant.id, instant);
    state.cardDefinitions.set(creature.id, creature);
    state.cards.set('instant-in-hand', {
      instanceId: 'instant-in-hand',
      definitionId: instant.id,
      ownerId: 'p1',
      zone: 'hand',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
    state.cards.set('creature-in-hand', {
      instanceId: 'creature-in-hand',
      definitionId: creature.id,
      ownerId: 'p1',
      zone: 'hand',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });
    state.cards.set(commander.instanceId, { ...commander, zone: 'stack' });
    state.stack = [{
      kind: 'Spell',
      id: 'stack-commander',
      cardInstanceId: commander.instanceId,
      casterId: 'p1',
      targets: [],
    }];

    const prompt = buildActionPrompt(state, 'p1');
    expect(prompt?.type).toBe('stack-response');
    expect(prompt?.legalChoices.some(choice => choice.kind === 'PlayLand')).toBe(false);
    expect(prompt?.legalChoices.some(choice => choice.kind === 'CastSpell' && choice.label === 'Cast Free Instant')).toBe(true);
    expect(prompt?.legalChoices.some(choice => choice.kind === 'CastSpell' && choice.label === 'Cast Free Creature')).toBe(false);

    const response = applyClientActionRequest(
      state,
      createClientActionRequest(
        state,
        'p1',
        { kind: 'PlayLand', cardInstanceId: forest.instanceId },
        { id: 'req-force-land-stack', createdAt: 3 },
      ),
    );

    expect(response.ok).toBe(false);
    expect(response.reason).toBe('illegal_action');
    expect(response.state).toBeUndefined();
    expect(state.cards.get(forest.instanceId)?.zone).toBe('hand');
    expect(response.update?.rulesEvents).toEqual([
      {
        kind: 'ActionRejected',
        requestId: 'req-force-land-stack',
        playerId: 'p1',
        actionKind: 'PlayLand',
        reason: 'illegal_action',
        message: 'The stack must be empty',
      },
    ]);
  });

  it('emits granular diffs for combat, commander, and visible card state changes', () => {
    const before = stateWithForestInHand();
    const card = [...before.cards.values()].find(candidate => candidate.ownerId === 'p1' && candidate.zone === 'hand');
    expect(card).toBeDefined();
    const commanderId = before.players[0].commanderInstanceId || 'commander-p1';
    const afterCards = new Map(before.cards);
    afterCards.set(card!.instanceId, {
      ...card!,
      damage: 3,
      summoningSick: false,
      phasedOut: true,
    });
    const after: GameState = {
      ...before,
      cards: afterCards,
      players: before.players.map(player => player.id === 'p2'
        ? {
            ...player,
            life: 19,
            hasLost: true,
            commanderDamage: { [commanderId]: 21 },
            commanderTax: 2,
            commanderCastCount: 2,
            commanderCastCounts: { [commanderId]: 2 },
          }
        : player),
      combat: {
        attackers: [{ cardInstanceId: card!.instanceId, defendingPlayerId: 'p2' }],
        blockers: [],
        blockersDeclared: false,
        blockersDeclaredBy: [],
        damageAssignment: new Map([[card!.instanceId, 3]]),
      },
    };

    expect(diffGameStates(before, after)).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'CombatChanged' }),
      expect.objectContaining({ kind: 'CardDamageChanged', cardId: card!.instanceId, from: 0, to: 3 }),
      expect.objectContaining({ kind: 'CardSummoningSicknessChanged', cardId: card!.instanceId }),
      expect.objectContaining({ kind: 'CardPhasedOutChanged', cardId: card!.instanceId, to: true }),
      expect.objectContaining({ kind: 'LifeChanged', playerId: 'p2', from: 40, to: 19 }),
      expect.objectContaining({ kind: 'PlayerLostChanged', playerId: 'p2', from: false, to: true }),
      expect.objectContaining({ kind: 'CommanderDamageChanged', playerId: 'p2', commanderId, from: 0, to: 21 }),
      expect.objectContaining({ kind: 'CommanderTaxChanged', playerId: 'p2', from: 0, to: 2 }),
      expect.objectContaining({ kind: 'CommanderCastCountChanged', playerId: 'p2', from: 0, to: 2 }),
    ]));
  });
});
