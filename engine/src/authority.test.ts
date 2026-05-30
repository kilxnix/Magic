import { describe, expect, it } from 'vitest';
import {
  applyClientActionRequest,
  applyChooseModePromptResponse,
  applyChooseReplacementPromptResponse,
  applyPayCostsPromptResponse,
  applyDamageAssignmentPromptResponse,
  applyOrderTriggersPromptResponse,
  applyOptionalTriggerPromptResponse,
  applyOpeningMulliganRedraw,
  applyLibraryManipulationPromptResponse,
  applyNamedCardPromptResponse,
  applySearchLibraryPromptResponse,
  applySelectCardsPromptResponse,
  applySelectTargetPromptResponse,
  auditActionReplay,
  auditEngineEventLogReplay,
  auditEngineReplay,
  auditPromptReplay,
  auditSearchPromptReplay,
  buildActionPrompt,
  buildStateUpdate,
  createClientActionRequest,
  createEngineEventLogRecord,
  createBattlefieldEntryReplacementPromptRequest,
  createChooseModePromptRequest,
  createDamageAssignmentPromptRequest,
  createOrderTriggersPromptRequest,
  createOptionalTriggerPromptRequest,
  createLibraryManipulationPromptRequest,
  createNamedCardPromptRequest,
  createSearchLibraryPromptRequest,
  createSelectCardsPromptRequest,
  createSelectTargetPromptRequest,
  createPayCostsPromptRequest,
  diffGameStates,
  labelForAction,
  resolveTopStackSearchPrompt,
  stateFingerprint,
  summarizeActionPromptChoices,
} from './authority';
import { resolveCombatDamage } from './combat';
import { initGameState } from './game-state';
import type { CardDefinition, CardInstance, GameState, StackItem, TriggeredAbilityRef } from './types';
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

function stateWithFetchSearchTargets(): GameState {
  const templeGarden = {
    ...def('temple_garden_fetch', 'Temple Garden', 'Land - Forest Plains', ''),
    cmc: 0,
  };
  const mountain = {
    ...def('mountain_fetch', 'Mountain', 'Basic Land - Mountain', ''),
    cmc: 0,
  };
  const island = {
    ...def('island_fetch', 'Island', 'Basic Land - Island', ''),
    cmc: 0,
  };
  const wateryGrave = {
    ...def('watery_grave_fetch', 'Watery Grave', 'Land - Island Swamp', ''),
    cmc: 0,
  };
  const aridMesa = {
    ...def('arid_mesa_fetch', 'Arid Mesa', 'Land', ''),
    cmc: 0,
  };
  return {
    ...stateWithSearchedShockLand(),
    cards: new Map<string, CardInstance>([
      ['temple_garden_fetch_1', cardInstance('temple_garden_fetch_1', templeGarden.id, 'p1', 'library')],
      ['mountain_fetch_1', cardInstance('mountain_fetch_1', mountain.id, 'p1', 'library')],
      ['island_fetch_1', cardInstance('island_fetch_1', island.id, 'p1', 'library')],
      ['watery_grave_fetch_1', cardInstance('watery_grave_fetch_1', wateryGrave.id, 'p1', 'library')],
      ['arid_mesa_fetch_1', cardInstance('arid_mesa_fetch_1', aridMesa.id, 'p1', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [templeGarden.id, templeGarden],
      [mountain.id, mountain],
      [island.id, island],
      [wateryGrave.id, wateryGrave],
      [aridMesa.id, aridMesa],
    ]),
  };
}

function stateWithSearchedEtbCreature(): GameState {
  const visionary: CardDefinition = {
    ...def(
      'elvish_visionary',
      'Elvish Visionary',
      'Creature - Elf Shaman',
      '{1}{G}',
      'When Elvish Visionary enters the battlefield, draw a card.',
    ),
    cmc: 2,
  };
  const commander = def('commander', 'Test Commander', 'Legendary Creature - Human', '{1}{G}');
  const state = initGameState([
    { playerId: 'p1', name: 'Player One', cards: [commander, visionary], commanderId: commander.id },
    { playerId: 'p2', name: 'Player Two', cards: [commander], commanderId: commander.id },
  ]);
  const visionaryInstance = [...state.cards.values()].find(card => card.definitionId === visionary.id && card.ownerId === 'p1');
  if (!visionaryInstance) throw new Error('Elvish Visionary not found');
  state.cards.set(visionaryInstance.instanceId, { ...visionaryInstance, zone: 'library' });
  return {
    ...state,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'main',
    hasPriorityPassed: [false, false],
    stack: [],
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
      { kind: 'PlayLand', label: 'Playable land', count: 1 },
      { kind: 'PassPriority', label: 'Pass/resolve', count: 1 },
    ]));
    expect(prompt?.legalChoices.some(choice => choice.kind === 'PlayLand' && choice.label === 'Play Forest')).toBe(true);
    expect(prompt?.legalChoices.some(choice => choice.kind === 'PassPriority')).toBe(true);
  });

  it('summarizes action prompts by decision workflow categories', () => {
    const summary = summarizeActionPromptChoices([
      {
        id: 'cast-targeted',
        kind: 'CastSpell',
        label: 'Cast Beast Within targeting Sol Ring',
        action: { kind: 'CastSpell', cardInstanceId: 'beast-within', targets: ['sol-ring'] },
      },
      {
        id: 'cast-simple',
        kind: 'CastSpell',
        label: 'Cast Sol Ring',
        action: { kind: 'CastSpell', cardInstanceId: 'sol-ring', targets: [] },
      },
      {
        id: 'mana',
        kind: 'ActivateManaAbility',
        label: 'Tap Forest for G',
        action: { kind: 'ActivateManaAbility', cardInstanceId: 'forest', color: 'G' },
      },
      {
        id: 'equip',
        kind: 'Equip',
        label: 'Equip Sword',
        action: { kind: 'Equip', equipmentInstanceId: 'sword', targetCreatureId: 'bear' },
      },
      {
        id: 'pass',
        kind: 'PassPriority',
        label: 'Pass priority',
        action: { kind: 'PassPriority' },
      },
    ]);

    expect(summary).toEqual(expect.arrayContaining([
      { kind: 'CastSpell', label: 'Castable', count: 1 },
      { kind: 'CastSpell', label: 'Target/select', count: 1 },
      { kind: 'ActivateManaAbility', label: 'Mana ability', count: 1 },
      { kind: 'Equip', label: 'Special action', count: 1 },
      { kind: 'PassPriority', label: 'Pass/resolve', count: 1 },
    ]));
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

  it('requires unrestricted tutor searches to choose a card when the library has choices', () => {
    const state = stateWithSisaySearchChoices();
    const request = createSearchLibraryPromptRequest(state, 'p1', {}, 'hand', {
      id: 'prompt-unrestricted-tutor',
      maxSelections: 1,
      createdAt: 1,
    });

    expect(request.minSelections).toBe(1);
    expect(request.legalChoices.length).toBeGreaterThan(0);

    const rejected = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: [],
    });

    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');
    expect(rejected.message).toBe('Search response must choose between 1 and 1 card(s).');
  });

  it('still allows fail-to-find for restricted hidden-library searches', () => {
    const state = stateWithSisaySearchChoices();
    const request = createSearchLibraryPromptRequest(state, 'p1', { types: ['land'], subtypes: ['Island'] }, 'hand', {
      id: 'prompt-restricted-search',
      maxSelections: 1,
      createdAt: 1,
    });

    expect(request.minSelections).toBe(0);
    expect(request.legalChoices).toHaveLength(0);

    const accepted = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: [],
    });

    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.state).toBe(state);
    }
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

  it('resolves a stack search item into a typed prompt without auto-selecting a library card', () => {
    const state = stateWithSisaySearchChoices();
    const filter: CardFilter = {
      supertypes: ['Legendary'],
      permanent: true,
      manaValueLessThanSourcePower: true,
    };
    state.stack = [{
      kind: 'ActivatedAbility',
      id: 'stack_sisay_search',
      sourceInstanceId: 'sisay_1',
      controllerId: 'p1',
      ability: {
        targets: [],
        effects: [{
          kind: 'SearchLibrary',
          player: { kind: 'Controller' },
          filter,
          destination: 'battlefield',
          shuffle: true,
        }],
      },
      targets: [],
    }];
    state.hasPriorityPassed = [true, true];

    const result = resolveTopStackSearchPrompt(state, {
      playerId: 'p1',
      createdAt: 42,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.stack).toHaveLength(0);
    expect(result.state.cards.get('arcane_signet_1')?.zone).toBe('library');
    expect(result.request.kind).toBe('SearchLibrary');
    expect(result.request.sourceInstanceId).toBe('sisay_1');
    expect(result.request.revealPolicy).toBe('reveal');
    expect(result.request.legalChoices.map(choice => choice.cardName)).toEqual(['Yoshimaru, Ever Faithful']);
    expect(result.request.invalidChoices.find(choice => choice.cardName === 'Arcane Signet')?.reason)
      .toBe('Not Legendary');
    expect(result.update.oldStateId).toBe(stateFingerprint(state));
    expect(result.update.newStateId).toBe(stateFingerprint(result.state));
    expect(result.update.oldStateId).not.toBe(result.update.newStateId);

    const rejected = applySearchLibraryPromptResponse(result.state, result.request, {
      requestId: result.request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['arcane_signet_1'],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toBe('Illegal search selection: Not Legendary');
  });

  it('search prompt resolution queues battlefield-entry triggers exactly once', () => {
    const state = stateWithSisaySearchChoices();
    const cards = new Map(state.cards);
    const cardDefinitions = new Map(state.cardDefinitions);
    cardDefinitions.set('landfall_source', def(
      'landfall_source',
      'Landfall Watcher',
      'Creature - Elemental',
      '{2}{G}',
      'Landfall - Whenever a land enters the battlefield under your control, you gain 1 life.',
    ));
    cardDefinitions.set('fetchable_forest', def('fetchable_forest', 'Fetchable Forest', 'Basic Land - Forest'));
    cards.set('landfall_source_1', {
      ...cardInstance('landfall_source_1', 'landfall_source', 'p1', 'battlefield'),
      summoningSick: false,
    });
    cards.set('fetchable_forest_1', cardInstance('fetchable_forest_1', 'fetchable_forest', 'p1', 'library'));
    const landfallAbility: TriggeredAbilityRef = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'Landfall' },
      effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 1 }],
    };
    const preparedState = {
      ...state,
      cards,
      cardDefinitions,
      battlefieldAbilities: new Map(state.battlefieldAbilities).set('landfall_source_1', [landfallAbility]),
    };
    const request = createSearchLibraryPromptRequest(preparedState, 'p1', { types: ['land'] }, 'battlefield', {
      id: 'prompt-landfall-once',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 51,
    });

    const response = applySearchLibraryPromptResponse(preparedState, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['fetchable_forest_1'],
    });

    expect(response.ok).toBe(true);
    expect(response.state?.cards.get('fetchable_forest_1')?.zone).toBe('battlefield');
    expect(response.state?.pendingTriggers.filter(trigger => trigger.sourceInstanceId === 'landfall_source_1')).toHaveLength(1);
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

  it('limits fetch-land search prompts by land subtype instead of card name', () => {
    const state = stateWithFetchSearchTargets();
    const islandScout = {
      ...def('island_scout_fetch', 'Island Scout', 'Creature - Merfolk', ''),
      cmc: 2,
    };
    state.cardDefinitions.set(islandScout.id, islandScout);
    state.cards.set('island_scout_fetch_1', cardInstance('island_scout_fetch_1', islandScout.id, 'p1', 'library'));
    const filter: CardFilter = { types: ['land'], subtypes: ['Mountain', 'Plains'] };
    const request = createSearchLibraryPromptRequest(state, 'p1', filter, 'battlefield', {
      id: 'prompt-arid-mesa-fetch',
      sourceInstanceId: 'arid_mesa_fetch_1',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 151,
    });

    expect(request.legalChoices.map(choice => choice.cardName)).toEqual([
      'Mountain',
      'Temple Garden',
    ]);
    expect(request.invalidChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        cardInstanceId: 'island_fetch_1',
        cardName: 'Island',
        reason: 'Missing subtype Mountain or Plains',
      }),
      expect.objectContaining({
        cardInstanceId: 'watery_grave_fetch_1',
        cardName: 'Watery Grave',
        reason: 'Missing subtype Mountain or Plains',
      }),
      expect.objectContaining({
        cardInstanceId: 'arid_mesa_fetch_1',
        cardName: 'Arid Mesa',
        reason: 'Missing subtype Mountain or Plains',
      }),
      expect.objectContaining({
        cardInstanceId: 'island_scout_fetch_1',
        cardName: 'Island Scout',
        reason: 'Not a land card',
      }),
    ]));

    const rejected = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['watery_grave_fetch_1'],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toBe('Illegal search selection: Missing subtype Mountain or Plains');

    const accepted = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['temple_garden_fetch_1'],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state?.cards.get('temple_garden_fetch_1')?.zone).toBe('battlefield');
    expect(accepted.state?.cards.get('watery_grave_fetch_1')?.zone).toBe('library');
  });

  it('registers searched battlefield entries and queues their ETB triggers in the engine transaction', () => {
    const state = stateWithSearchedEtbCreature();
    const visionary = [...state.cards.values()].find(card => card.definitionId === 'elvish_visionary');
    expect(visionary).toBeDefined();

    const request = createSearchLibraryPromptRequest(
      state,
      'p1',
      { types: ['Creature'] },
      'battlefield',
      {
        id: 'prompt-search-etb-creature',
        minSelections: 1,
        maxSelections: 1,
        createdAt: 18,
      },
    );
    const accepted = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: [visionary!.instanceId],
    });

    expect(accepted.ok).toBe(true);
    expect(accepted.state?.cards.get(visionary!.instanceId)?.zone).toBe('battlefield');
    expect(accepted.state?.battlefieldAbilities.get(visionary!.instanceId)?.length).toBeGreaterThan(0);
    expect(accepted.state?.pendingTriggers.some(trigger => trigger.sourceInstanceId === visionary!.instanceId)).toBe(true);
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

  it('disambiguates duplicate target names by controller, zone, and ordinal', () => {
    const state = stateWithTargetChoices();
    state.cards.set('forest_2', cardInstance('forest_2', 'forest', 'p1', 'battlefield'));
    state.cards.set('forest_graveyard_1', cardInstance('forest_graveyard_1', 'forest', 'p1', 'graveyard'));

    const request = createSelectTargetPromptRequest(state, 'p1', {
      id: 'target-permanent',
      type: 'Permanent',
      count: 1,
    }, {
      id: 'prompt-duplicate-targets',
      createdAt: 1711,
    });

    expect(request.legalChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: 'forest_1',
        label: 'Forest (Player One, Battlefield #1)',
      }),
      expect.objectContaining({
        targetId: 'forest_2',
        label: 'Forest (Player One, Battlefield #2)',
      }),
      expect.objectContaining({
        targetId: 'bear_1',
        label: 'Grizzly Bears (Player Two, Battlefield)',
      }),
    ]));
    expect(request.invalidChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: 'forest_graveyard_1',
        label: 'Forest (Player One, Graveyard)',
        reason: 'Not on the battlefield',
      }),
    ]));
  });

  it('uses source-aware control and another-object constraints in typed target prompts', () => {
    const state = stateWithTargetChoices();
    const friendlyBear = {
      ...def('friendly_bear', 'Friendly Bear', 'Creature - Bear', '{1}{G}'),
      card_types: ['creature' as const],
      power: 2,
      toughness: 2,
    };
    state.cardDefinitions.set(friendlyBear.id, friendlyBear);
    state.cards.set('friendly_bear_1', cardInstance('friendly_bear_1', friendlyBear.id, 'p1', 'battlefield'));
    state.cards.set('source_creature_1', cardInstance('source_creature_1', friendlyBear.id, 'p1', 'battlefield'));

    const request = createSelectTargetPromptRequest(state, 'p1', {
      id: 'target-another-your-creature',
      type: 'Creature',
      count: 1,
      constraints: { controllerControls: true, notSource: true },
    }, {
      id: 'prompt-another-your-creature',
      sourceInstanceId: 'source_creature_1',
      createdAt: 171,
    });

    expect(request.legalChoices.map(choice => choice.targetId)).toEqual(['friendly_bear_1']);
    expect(request.invalidChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetId: 'bear_1',
        legal: false,
        reason: 'Target must be controlled by you',
      }),
      expect.objectContaining({
        targetId: 'source_creature_1',
        legal: false,
        reason: 'Target must be another object',
      }),
    ]));

    const rejected = applySelectTargetPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectTarget',
      playerId: 'p1',
      selectedTargetIds: ['source_creature_1'],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain('Target must be another object');
  });

  it('includes graveyard cards in typed target prompts when an effect targets a graveyard card', () => {
    const state = stateWithTargetChoices();
    const relic = def('dead_relic', 'Dead Relic', 'Artifact');
    state.cardDefinitions.set(relic.id, relic);
    state.cards.set('dead_relic_1', cardInstance('dead_relic_1', relic.id, 'p2', 'graveyard'));

    const request = createSelectTargetPromptRequest(state, 'p1', {
      id: 'target-graveyard-card',
      type: 'CardInGraveyard',
      count: 1,
      constraints: { opponentControls: true },
    }, {
      id: 'prompt-graveyard-card',
      createdAt: 19,
    });

    expect(request.legalChoices.map(choice => choice.targetId)).toEqual(['dead_relic_1']);
    expect(request.invalidChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetId: 'forest_1', legal: false, reason: 'Not in a graveyard' }),
    ]));
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
      {
        kind: 'Action',
        request: actionRequest,
        expectedStateBeforeId: stateFingerprint(state),
        expectedStateAfterId: afterPass.update?.newStateId,
        expectedRuleEventKinds: ['ActionAccepted'],
      },
      {
        kind: 'Prompt',
        request: targetRequest,
        response: {
          requestId: targetRequest.id,
          kind: 'SelectTarget',
          playerId: 'p1',
          selectedTargetIds: ['bear_1'],
        },
        expectedStateBeforeId: stateFingerprint(afterPass.state!),
        expectedRuleEventKinds: ['PromptResponseAccepted'],
      },
    ]);

    expect(report.ok).toBe(true);
    expect(report.finalState).toBeDefined();
    expect(report.steps).toEqual([
      expect.objectContaining({ kind: 'Action', actionKind: 'PassPriority', ok: true }),
      expect.objectContaining({ kind: 'Prompt', promptKind: 'SelectTarget', ok: true }),
    ]);
  });

  it('fails mixed replay audit when recorded state ids do not match the replay stream', () => {
    const state = stateWithTargetChoices();
    const pass = buildActionPrompt(state, 'p1')?.legalChoices.find(choice => choice.kind === 'PassPriority')?.action;
    expect(pass).toBeDefined();
    const actionRequest = createClientActionRequest(state, 'p1', pass as AIAction, {
      id: 'req-replay-state-mismatch',
      createdAt: 240,
    });

    const report = auditEngineReplay(state, [{
      kind: 'Action',
      request: actionRequest,
      expectedStateBeforeId: 'recorded-wrong-state',
    }]);

    expect(report.ok).toBe(false);
    expect(report.steps).toEqual([expect.objectContaining({
      requestId: 'req-replay-state-mismatch',
      ok: false,
      reason: 'state_mismatch',
      message: expect.stringContaining('Replay state-before mismatch'),
    })]);
  });

  it('fails mixed replay audit when recorded presentation events are missing', () => {
    const state = stateWithTargetChoices();
    const pass = buildActionPrompt(state, 'p1')?.legalChoices.find(choice => choice.kind === 'PassPriority')?.action;
    expect(pass).toBeDefined();
    const actionRequest = createClientActionRequest(state, 'p1', pass as AIAction, {
      id: 'req-replay-event-mismatch',
      createdAt: 241,
    });

    const report = auditEngineReplay(state, [{
      kind: 'Action',
      request: actionRequest,
      expectedRuleEventKinds: ['DiceRolled'],
    }]);

    expect(report.ok).toBe(false);
    expect(report.steps).toEqual([expect.objectContaining({
      requestId: 'req-replay-event-mismatch',
      ok: false,
      reason: 'event_mismatch',
      message: 'Replay event mismatch: missing DiceRolled.',
    })]);
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

  it('puts selected hand cards on top of the library in submitted order', () => {
    const state = stateWithForestInHand();
    const ponder = def('ponder', 'Ponder', 'Sorcery', '{U}');
    const opt = def('opt', 'Opt', 'Instant', '{U}');
    const island = def('top-island', 'Island', 'Basic Land - Island');
    const bolt = def('library-bolt', 'Lightning Bolt', 'Instant', '{R}');
    state.cardDefinitions.set(ponder.id, ponder);
    state.cardDefinitions.set(opt.id, opt);
    state.cardDefinitions.set(island.id, island);
    state.cardDefinitions.set(bolt.id, bolt);
    state.cards.set('ponder-hand', cardInstance('ponder-hand', ponder.id, 'p1', 'hand'));
    state.cards.set('opt-hand', cardInstance('opt-hand', opt.id, 'p1', 'hand'));
    state.cards.set('island-library', cardInstance('island-library', island.id, 'p1', 'library'));
    state.cards.set('bolt-library', cardInstance('bolt-library', bolt.id, 'p1', 'library'));

    const request = createSelectCardsPromptRequest(state, 'p1', {
      id: 'prompt-put-on-top',
      subject: 'PutOnTopOfLibrary',
      zone: 'hand',
      destination: 'library',
      minSelections: 2,
      maxSelections: 2,
      createdAt: 33,
    });

    const accepted = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: ['opt-hand', 'ponder-hand'],
    });

    expect(accepted.ok).toBe(true);
    const libraryOrder = [...accepted.state!.cards.values()]
      .filter(card => card.ownerId === 'p1' && card.zone === 'library')
      .map(card => card.instanceId);
    expect(libraryOrder.slice(0, 4)).toEqual(['opt-hand', 'ponder-hand', 'island-library', 'bolt-library']);
  });

  it('limits stack top-library choice prompts to the revealed candidate cards', () => {
    const state = stateWithForestInHand();
    const cards = [
      def('top-a', 'Top A', 'Instant', '{U}'),
      def('top-b', 'Top B', 'Instant', '{U}'),
      def('top-c', 'Top C', 'Instant', '{U}'),
      def('hidden-d', 'Hidden D', 'Instant', '{U}'),
    ];
    for (const definition of cards) state.cardDefinitions.set(definition.id, definition);
    state.cards.set('top-a', cardInstance('top-a', 'top-a', 'p1', 'library'));
    state.cards.set('top-b', cardInstance('top-b', 'top-b', 'p1', 'library'));
    state.cards.set('top-c', cardInstance('top-c', 'top-c', 'p1', 'library'));
    state.cards.set('hidden-d', cardInstance('hidden-d', 'hidden-d', 'p1', 'library'));

    const request = createSelectCardsPromptRequest(state, 'p1', {
      id: 'prompt-top-library-choice',
      subject: 'TopLibraryChoice',
      zone: 'library',
      destination: 'hand',
      commitSelection: false,
      candidateCardInstanceIds: ['top-a', 'top-b', 'top-c'],
      preserveOrder: true,
      minSelections: 1,
      maxSelections: 3,
      createdAt: 34,
    });

    expect(request.legalChoices.map(choice => choice.cardInstanceId)).toEqual(['top-a', 'top-b', 'top-c']);
    expect(request.legalChoices.map(choice => choice.cardInstanceId)).not.toContain('hidden-d');

    const accepted = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: ['top-b', 'top-a'],
    });
    expect(accepted.ok).toBe(true);
    expect((accepted.state!.stack[0] as { namedCardChoices?: Record<string, string> } | undefined)?.namedCardChoices).toBeUndefined();

    const rejected = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: ['hidden-d'],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');
  });

  it('limits top-library search prompts and bottoms unselected looked-at cards', () => {
    const state = stateWithForestInHand();
    const cards = [
      def('top-1', 'Top One', 'Instant', '{U}'),
      def('top-2', 'Top Two', 'Instant', '{U}'),
      def('top-3', 'Top Three', 'Instant', '{U}'),
      def('top-4', 'Top Four', 'Instant', '{U}'),
      def('top-5', 'Top Five', 'Instant', '{U}'),
    ];
    for (const cardDef of cards) {
      state.cardDefinitions.set(cardDef.id, cardDef);
      state.cards.set(`${cardDef.id}-library`, cardInstance(`${cardDef.id}-library`, cardDef.id, 'p1', 'library'));
    }

    const request = createSearchLibraryPromptRequest(state, 'p1', {}, 'hand', {
      id: 'prompt-top-four',
      topCount: 4,
      putUnselectedTopCardsOnBottom: true,
      minSelections: 1,
      maxSelections: 1,
      createdAt: 44,
    });

    expect(request.legalChoices.map(choice => choice.cardName)).toEqual(['Top One', 'Top Two', 'Top Three', 'Top Four']);
    const accepted = applySearchLibraryPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: ['top-2-library'],
    });

    expect(accepted.ok).toBe(true);
    expect(accepted.state?.cards.get('top-2-library')?.zone).toBe('hand');
    const libraryOrder = [...accepted.state!.cards.values()]
      .filter(card => card.ownerId === 'p1' && card.zone === 'library')
      .map(card => card.instanceId);
    expect(libraryOrder).toEqual(['top-5-library', 'top-1-library', 'top-3-library', 'top-4-library']);
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

    state.cards.set(
      'redraw_library_card',
      cardInstance('redraw_library_card', forest!.definitionId, 'p1', 'library'),
    );
    const redraw = applyOpeningMulliganRedraw(state, 'p1', [forest!.instanceId]);
    expect(redraw.ok).toBe(true);
    if (!redraw.ok) return;
    expect(redraw.redrawn).toBe(1);
    expect(redraw.state.cards.get(forest!.instanceId)?.zone).toBe('library');
    expect(redraw.state.cards.get('redraw_library_card')?.zone).toBe('hand');
    expect(redraw.update.oldStateId).toBe(stateFingerprint(state));
    expect(redraw.update.newStateId).toBe(stateFingerprint(redraw.state));

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

  it('can attach a validated card selection to a stack item without moving the card', () => {
    const state = stateWithForestInHand();
    const forest = [...state.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1');
    expect(forest).toBeDefined();
    state.stack = [{
      kind: 'TriggeredAbility',
      id: 'stack-sacrifice-choice',
      sourceInstanceId: forest!.instanceId,
      controllerId: 'p1',
      ability: {
        kind: 'TriggeredAbility',
        trigger: { kind: 'ETB', who: 'self' },
        effects: [],
      },
      targets: [],
    }];

    const request = createSelectCardsPromptRequest(state, 'p1', {
      id: 'prompt-stack-card-choice',
      subject: 'SacrificeChoice',
      zone: 'hand',
      destination: 'graveyard',
      commitSelection: false,
      stackItemId: 'stack-sacrifice-choice',
      choiceKey: 'sacrificeCardId:p1',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 225,
    });
    const accepted = applySelectCardsPromptResponse(state, request, {
      requestId: request.id,
      kind: 'SelectCards',
      playerId: 'p1',
      selectedCardInstanceIds: [forest!.instanceId],
    });

    expect(accepted.ok).toBe(true);
    expect(accepted.state?.cards.get(forest!.instanceId)?.zone).toBe('hand');
    expect((accepted.state?.stack[0] as StackItem & { namedCardChoices?: Record<string, string> }).namedCardChoices)
      .toEqual({ 'sacrificeCardId:p1': forest!.instanceId });
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

  it('validates APNAP trigger ordering before moving pending triggers to the stack', () => {
    const sourceA = def('source_a', 'Source A', 'Creature');
    const sourceB = def('source_b', 'Source B', 'Creature');
    const sourceC = def('source_c', 'Source C', 'Creature');
    const base = stateWithSisaySearchChoices();
    const state: GameState = {
      ...base,
      cards: new Map<string, CardInstance>([
        ['source_a_1', cardInstance('source_a_1', sourceA.id, 'p1', 'battlefield')],
        ['source_b_1', cardInstance('source_b_1', sourceB.id, 'p1', 'battlefield')],
        ['source_c_1', cardInstance('source_c_1', sourceC.id, 'p2', 'battlefield')],
      ]),
      cardDefinitions: new Map<string, CardDefinition>([
        [sourceA.id, sourceA],
        [sourceB.id, sourceB],
        [sourceC.id, sourceC],
      ]),
      pendingTriggers: [
        {
          id: 'trigger-a',
          sourceInstanceId: 'source_a_1',
          controllerId: 'p1',
          ability: { kind: 'TriggeredAbility', trigger: { kind: 'ETB', who: 'self' }, effects: [] },
          requiredTargets: [],
        },
        {
          id: 'trigger-c',
          sourceInstanceId: 'source_c_1',
          controllerId: 'p2',
          ability: { kind: 'TriggeredAbility', trigger: { kind: 'ETB', who: 'self' }, effects: [] },
          requiredTargets: [],
        },
        {
          id: 'trigger-b',
          sourceInstanceId: 'source_b_1',
          controllerId: 'p1',
          ability: { kind: 'TriggeredAbility', trigger: { kind: 'ETB', who: 'self' }, effects: [] },
          requiredTargets: [],
        },
      ],
    };

    const request = createOrderTriggersPromptRequest(state, 'p1', {
      id: 'prompt-order-triggers',
      createdAt: 240,
    });
    expect(request.triggers.map(trigger => trigger.triggerId)).toEqual(['trigger-a', 'trigger-b', 'trigger-c']);

    const rejected = applyOrderTriggersPromptResponse(state, request, {
      requestId: request.id,
      kind: 'OrderTriggers',
      playerId: 'p1',
      orderedTriggerIds: ['trigger-c', 'trigger-b', 'trigger-a'],
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');
    expect(state.pendingTriggers).toHaveLength(3);

    const accepted = applyOrderTriggersPromptResponse(state, request, {
      requestId: request.id,
      kind: 'OrderTriggers',
      playerId: 'p1',
      orderedTriggerIds: ['trigger-b', 'trigger-a', 'trigger-c'],
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state?.pendingTriggers).toHaveLength(0);
    expect(accepted.state?.stack.map(item => item.id)).toEqual(['trigger-b', 'trigger-a', 'trigger-c']);
  });

  it('lets players accept or decline pending optional triggers explicitly', () => {
    const source = def('source_optional', 'Goblin Matron', 'Creature - Goblin');
    const base = stateWithSisaySearchChoices();
    const optionalTrigger = {
      id: 'trigger-optional',
      sourceInstanceId: 'source_optional_1',
      controllerId: 'p1',
      ability: {
        kind: 'TriggeredAbility' as const,
        trigger: { kind: 'ETB' as const, who: 'self' as const },
        effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 1 }],
        optional: true,
      },
      requiredTargets: [],
    };
    const mandatoryTrigger = {
      ...optionalTrigger,
      id: 'trigger-mandatory',
      ability: {
        ...optionalTrigger.ability,
        optional: false,
      },
    };
    const state: GameState = {
      ...base,
      cards: new Map<string, CardInstance>([
        ['source_optional_1', cardInstance('source_optional_1', source.id, 'p1', 'battlefield')],
      ]),
      cardDefinitions: new Map<string, CardDefinition>([[source.id, source]]),
      pendingTriggers: [optionalTrigger, mandatoryTrigger],
    };

    const request = createOptionalTriggerPromptRequest(state, 'p1', 'trigger-optional', {
      id: 'prompt-optional-trigger',
      createdAt: 245,
    });
    expect(request).toMatchObject({
      kind: 'OptionalTrigger',
      triggerId: 'trigger-optional',
      sourceName: 'Goblin Matron',
      triggerKind: 'ETB',
    });

    const rejected = applyOptionalTriggerPromptResponse(state, request, {
      requestId: request.id,
      kind: 'OptionalTrigger',
      playerId: 'p1',
      triggerId: 'trigger-mandatory',
      use: false,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toBe('illegal_response');
    expect(state.pendingTriggers).toHaveLength(2);

    const declined = applyOptionalTriggerPromptResponse(state, request, {
      requestId: request.id,
      kind: 'OptionalTrigger',
      playerId: 'p1',
      triggerId: 'trigger-optional',
      use: false,
    });
    expect(declined.ok).toBe(true);
    expect(declined.state?.pendingTriggers.map(trigger => trigger.id)).toEqual(['trigger-mandatory']);
    expect(declined.state?.stack).toHaveLength(0);
    expect(declined.update?.rulesEvents).toEqual([{
      kind: 'PromptResponseAccepted',
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'OptionalTrigger',
      optionalTriggerId: 'trigger-optional',
      useOptionalTrigger: false,
    }]);

    const accepted = applyOptionalTriggerPromptResponse(state, request, {
      requestId: request.id,
      kind: 'OptionalTrigger',
      playerId: 'p1',
      triggerId: 'trigger-optional',
      use: true,
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.state?.pendingTriggers.map(trigger => trigger.id)).toEqual(['trigger-mandatory']);
    expect(accepted.state?.stack.map(item => item.id)).toEqual(['trigger-optional']);
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

  it('validates named-card prompt responses and stores the live choice on the stack item', () => {
    const state = stateWithForestInHand();
    const pact = def('tainted_pact', 'Tainted Pact', 'Instant', '{1}{B}');
    const oracle = def('oracle', "Thassa's Oracle", 'Creature - Merfolk Wizard', '{U}{U}');
    state.cardDefinitions.set(pact.id, pact);
    state.cardDefinitions.set(oracle.id, oracle);
    state.cards.set('pact_stack', cardInstance('pact_stack', pact.id, 'p1', 'stack'));
    state.cards.set('oracle_library', cardInstance('oracle_library', oracle.id, 'p1', 'library'));
    state.stack = [{
      kind: 'Spell',
      id: 'stack-pact',
      cardInstanceId: 'pact_stack',
      casterId: 'p1',
      targets: [],
    }];

    const request = createNamedCardPromptRequest(state, 'p1', {
      id: 'prompt-name-card',
      stackItemId: 'stack-pact',
      choiceKey: 'namedCard',
      sourceInstanceId: 'pact_stack',
      createdAt: 26,
    });
    expect(request.legalChoices.map(choice => choice.cardName)).toContain("Thassa's Oracle");

    const accepted = applyNamedCardPromptResponse(state, request, {
      requestId: request.id,
      kind: 'NamedCard',
      playerId: 'p1',
      chosenCardName: "Thassa's Oracle",
    });
    expect(accepted.ok).toBe(true);
    expect(accepted.namedCardName).toBe("Thassa's Oracle");
    expect((accepted.state?.stack[0] as StackItem & { namedCardChoices?: Record<string, string> }).namedCardChoices)
      .toEqual({ namedCard: "Thassa's Oracle" });
    expect(accepted.update?.rulesEvents).toEqual([{
      kind: 'PromptResponseAccepted',
      requestId: request.id,
      playerId: 'p1',
      promptKind: 'NamedCard',
      namedCardName: "Thassa's Oracle",
    }]);

    const arbitrary = applyNamedCardPromptResponse(state, request, {
      requestId: request.id,
      kind: 'NamedCard',
      playerId: 'p1',
      chosenCardName: 'Black Lotus',
    });
    expect(arbitrary.ok).toBe(true);
    expect(arbitrary.namedCardName).toBe('Black Lotus');

    const illegal = applyNamedCardPromptResponse(state, request, {
      requestId: request.id,
      kind: 'NamedCard',
      playerId: 'p1',
      chosenCardName: '',
    });
    expect(illegal.ok).toBe(false);
    expect(illegal.message).toContain('Illegal named-card choice');
  });

  it('validates scry and surveil library manipulation responses against the revealed card set', () => {
    const state = stateWithSisaySearchChoices();
    state.stack = [{
      kind: 'Spell',
      id: 'stack-surveil',
      cardInstanceId: 'sisay_1',
      casterId: 'p1',
      targets: [],
    }];
    state.cards.set('sisay_1', { ...state.cards.get('sisay_1')!, zone: 'stack' });
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
    expect(accepted.state).not.toBe(state);
    expect(accepted.libraryManipulationChoices).toEqual({
      surveilTopIds: revealedIds[1],
      surveilGraveyardIds: `${revealedIds[0]},${revealedIds[2]}`,
    });
    expect((accepted.state?.stack[0] as StackItem & { namedCardChoices?: Record<string, string> }).namedCardChoices)
      .toEqual(accepted.libraryManipulationChoices);

    const allMoved = applyLibraryManipulationPromptResponse(state, request, {
      requestId: request.id,
      kind: 'LibraryManipulation',
      playerId: 'p1',
      topCardInstanceIds: [],
      movedCardInstanceIds: revealedIds,
    });
    expect(allMoved.ok).toBe(true);
    expect(allMoved.libraryManipulationChoices).toEqual({
      surveilTopIds: '',
      surveilGraveyardIds: revealedIds.join(','),
    });
    expect(
      Object.prototype.hasOwnProperty.call(
        (allMoved.state?.stack[0] as StackItem & { namedCardChoices?: Record<string, string> }).namedCardChoices || {},
        'surveilTopIds',
      ),
    ).toBe(true);

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

  it('commits direct scry and surveil choices to library and graveyard order', () => {
    const scryState = stateWithSisaySearchChoices();
    const scryRequest = createLibraryManipulationPromptRequest(scryState, 'p1', 'scry', 3, {
      id: 'prompt-scry-direct',
      createdAt: 25,
    });
    const scryRevealed = scryRequest.legalChoices.map(choice => choice.cardInstanceId);

    const scryAccepted = applyLibraryManipulationPromptResponse(scryState, scryRequest, {
      requestId: scryRequest.id,
      kind: 'LibraryManipulation',
      playerId: 'p1',
      topCardInstanceIds: [scryRevealed[2], scryRevealed[0]],
      movedCardInstanceIds: [scryRevealed[1]],
    });
    expect(scryAccepted.ok).toBe(true);
    expect([...scryAccepted.state!.cards.values()]
      .filter(card => card.ownerId === 'p1' && card.zone === 'library')
      .map(card => card.instanceId))
      .toEqual([scryRevealed[2], scryRevealed[0], 'counterspell_1', 'blood_crypt_1', scryRevealed[1]]);

    const surveilState = stateWithSisaySearchChoices();
    const surveilRequest = createLibraryManipulationPromptRequest(surveilState, 'p1', 'surveil', 3, {
      id: 'prompt-surveil-direct',
      createdAt: 26,
    });
    const surveilRevealed = surveilRequest.legalChoices.map(choice => choice.cardInstanceId);

    const surveilAccepted = applyLibraryManipulationPromptResponse(surveilState, surveilRequest, {
      requestId: surveilRequest.id,
      kind: 'LibraryManipulation',
      playerId: 'p1',
      topCardInstanceIds: [surveilRevealed[1]],
      movedCardInstanceIds: [surveilRevealed[0], surveilRevealed[2]],
    });
    expect(surveilAccepted.ok).toBe(true);
    expect([...surveilAccepted.state!.cards.values()]
      .filter(card => card.ownerId === 'p1' && card.zone === 'library')
      .map(card => card.instanceId))
      .toEqual([surveilRevealed[1], 'counterspell_1', 'blood_crypt_1']);
    expect(surveilAccepted.state!.cards.get(surveilRevealed[0])?.zone).toBe('graveyard');
    expect(surveilAccepted.state!.cards.get(surveilRevealed[2])?.zone).toBe('graveyard');
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
    expect(request.legalChoices.map(choice => choice.label)).toEqual(['Draw a card', 'Gain 3 life']);
    expect(labelForAction(state, {
      kind: 'CastSpell',
      cardInstanceId: 'charm_in_hand',
      targets: [],
      chosenModes: [1],
    })).toBe('Cast Test Charm choosing Gain 3 life');

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

  it('rejects forged modal cast requests whose chosen modes were not generated as legal actions', () => {
    const state = stateWithForestInHand();
    const charm = def(
      'strict_charm',
      'Strict Charm',
      'Instant',
      '{U}',
      'Choose one —\n• Draw a card.\n• Gain 3 life.',
    );
    state.cardDefinitions.set(charm.id, charm);
    state.cards.set('strict_charm_in_hand', cardInstance('strict_charm_in_hand', charm.id, 'p1', 'hand'));
    state.players = state.players.map(player =>
      player.id === 'p1'
        ? { ...player, manaPool: { ...player.manaPool, U: 1 } }
        : player,
    );

    const prompt = buildActionPrompt(state, 'p1');
    const legalModePayloads = prompt?.legalChoices
      .filter(choice => choice.kind === 'CastSpell')
      .map(choice => (choice.action as Extract<AIAction, { kind: 'CastSpell' }>).chosenModes);
    expect(legalModePayloads).toEqual([[0], [1]]);

    const forged = applyClientActionRequest(state, createClientActionRequest(state, 'p1', {
      kind: 'CastSpell',
      cardInstanceId: 'strict_charm_in_hand',
      targets: [],
      chosenModes: [0, 1],
    }, {
      id: 'req-forged-modal-choice',
      createdAt: 26,
    }));

    expect(forged.ok).toBe(false);
    expect(forged.reason).toBe('illegal_action');
    expect(forged.state).toBeUndefined();
    expect(state.cards.get('strict_charm_in_hand')?.zone).toBe('hand');
  });

  it('allows one or both selections for choose-one-or-both modal actions', () => {
    const state = stateWithForestInHand();
    const charm = def(
      'flexible_charm',
      'Flexible Charm',
      'Instant',
      '{G}',
      'Choose one or both —\n• Draw a card.\n• Gain 3 life.',
    );
    state.cardDefinitions.set(charm.id, charm);
    state.cards.set('flexible_charm_in_hand', cardInstance('flexible_charm_in_hand', charm.id, 'p1', 'hand'));
    state.players = state.players.map(player =>
      player.id === 'p1'
        ? { ...player, manaPool: { ...player.manaPool, G: 1 } }
        : player,
    );

    const modeRequest = createChooseModePromptRequest(state, 'p1', 'flexible_charm_in_hand', {
      id: 'prompt-flexible-mode-choice',
      createdAt: 27,
    });
    expect(modeRequest.minSelections).toBe(1);
    expect(modeRequest.maxSelections).toBe(2);

    const acceptedSingle = applyChooseModePromptResponse(state, modeRequest, {
      requestId: modeRequest.id,
      kind: 'ChooseMode',
      playerId: 'p1',
      selectedModeIndices: [0],
    });
    expect(acceptedSingle.ok).toBe(true);

    const prompt = buildActionPrompt(state, 'p1');
    const legalModePayloads = prompt?.legalChoices
      .filter(choice => choice.kind === 'CastSpell')
      .map(choice => (choice.action as Extract<AIAction, { kind: 'CastSpell' }>).chosenModes);
    expect(legalModePayloads).toEqual([[0], [1], [0, 1]]);
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

  it('can attach review decision metadata to an authoritative state update', () => {
    const before = stateWithForestInHand();
    const after = applyClientActionRequest(
      before,
      createClientActionRequest(before, 'p1', {
        kind: 'PlayLand',
        cardInstanceId: [...before.cards.values()].find(card => card.definitionId === 'forest')!.instanceId,
      }, {
        id: 'req-reviewed-play',
        createdAt: 3,
      }),
    ).state!;

    const update = buildStateUpdate(before, after, {
      requestId: 'req-reviewed-play',
      playerId: 'p1',
      actionKind: 'PlayLand',
      label: 'Play Forest',
      review: {
        decisionId: 'decision-1',
        selectedLabel: 'Play Forest',
        selectedScore: 8.3,
        bestLabel: 'Play Forest',
        bestScore: 8.3,
        scoreDelta: 0,
        confidence: 'high',
        legalActionCount: 3,
        rulesAuditOk: true,
      },
    });

    expect(update.rulesEvents).toEqual(expect.arrayContaining([
      {
        kind: 'ReviewDecisionRecorded',
        requestId: 'req-reviewed-play',
        playerId: 'p1',
        decisionId: 'decision-1',
        selectedLabel: 'Play Forest',
        selectedScore: 8.3,
        bestLabel: 'Play Forest',
        bestScore: 8.3,
        scoreDelta: 0,
        confidence: 'high',
        legalActionCount: 3,
        rulesAuditOk: true,
      },
    ]));
  });

  it('surfaces d20 rolls as authoritative presentation events', () => {
    const before = stateWithForestInHand();
    const after: GameState = {
      ...before,
      diceRolls: [{
        id: 'dice_1',
        playerId: 'p1',
        sourceInstanceId: 'morningstar-1',
        sourceName: 'Goblin Morningstar',
        sides: 20,
        result: 17,
        outcomeMin: 10,
        outcomeMax: 20,
        turnNumber: before.turnNumber,
        phase: before.phase,
        step: before.step,
      }],
    };

    const update = buildStateUpdate(before, after);

    expect(update.rulesEvents).toContainEqual({
      kind: 'DiceRolled',
      roll: {
        id: 'dice_1',
        playerId: 'p1',
        sourceInstanceId: 'morningstar-1',
        sourceName: 'Goblin Morningstar',
        sides: 20,
        result: 17,
        outcomeMin: 10,
        outcomeMax: 20,
        turnNumber: before.turnNumber,
        phase: before.phase,
        step: before.step,
      },
    });
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

  it('builds and audits event-log records from committed authoritative updates', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const playLand = prompt?.legalChoices.find(choice => choice.kind === 'PlayLand')?.action;
    expect(playLand).toBeDefined();

    const request = createClientActionRequest(state, 'p1', playLand as AIAction, {
      id: 'req-event-log-play-forest',
      createdAt: 17,
    });
    const applied = applyClientActionRequest(state, request);
    expect(applied.ok).toBe(true);
    expect(applied.update).toBeDefined();

    const logRecord = createEngineEventLogRecord(
      0,
      { kind: 'Action', request },
      applied.update!,
      1700000000000,
    );
    const report = auditEngineEventLogReplay(state, [logRecord]);

    expect(logRecord.stateIdBefore).toBe(stateFingerprint(state));
    expect(logRecord.stateIdAfter).toBe(applied.update?.newStateId);
    expect(logRecord.rulesEvents.map(event => event.kind)).toEqual(['ActionAccepted', 'RulesEvent']);
    expect(logRecord.visibleDiffs.map(diff => diff.kind)).toContain('CardZoneChanged');
    expect(report.ok).toBe(true);
    expect(report.finalState?.cards.get((playLand as Extract<AIAction, { kind: 'PlayLand' }>).cardInstanceId)?.zone)
      .toBe('battlefield');
    expect(report.steps[0]).toEqual(expect.objectContaining({
      sequence: 0,
      requestId: 'req-event-log-play-forest',
      expectedStateBeforeId: logRecord.stateIdBefore,
      expectedStateAfterId: logRecord.stateIdAfter,
      ok: true,
    }));
  });

  it('rejects event-log replay when committed diffs no longer match engine output', () => {
    const state = stateWithForestInHand();
    const prompt = buildActionPrompt(state, 'p1');
    const playLand = prompt?.legalChoices.find(choice => choice.kind === 'PlayLand')?.action;
    expect(playLand).toBeDefined();

    const request = createClientActionRequest(state, 'p1', playLand as AIAction, {
      id: 'req-event-log-tampered-diff',
      createdAt: 18,
    });
    const applied = applyClientActionRequest(state, request);
    expect(applied.ok).toBe(true);
    expect(applied.update).toBeDefined();

    const logRecord = createEngineEventLogRecord(0, { kind: 'Action', request }, applied.update!);
    const tampered = {
      ...logRecord,
      visibleDiffs: [],
    };
    const report = auditEngineEventLogReplay(state, [tampered]);

    expect(report.ok).toBe(false);
    expect(report.steps[0]).toEqual(expect.objectContaining({
      requestId: 'req-event-log-tampered-diff',
      ok: false,
      reason: 'diff_mismatch',
      message: 'Event log visible-diff sequence does not match replayed engine output. Expected none; got CardZoneChanged, CardSummoningSicknessChanged.',
    }));
  });

  it('audits rejected prompt-response event records without mutating replay state', () => {
    const state = stateWithSisaySearchChoices();
    const request = createSearchLibraryPromptRequest(state, 'p1', {
      supertypes: ['Legendary'],
      permanent: true,
      manaValueLessThanSourcePower: true,
    }, 'battlefield', {
      id: 'prompt-event-log-sisay',
      sourceInstanceId: 'sisay_1',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 19,
    });
    const response = {
      requestId: request.id,
      kind: 'SearchLibrary' as const,
      playerId: 'p1',
      selectedCardInstanceIds: ['arcane_signet_1'],
    };
    const rejected = applySearchLibraryPromptResponse(state, request, response);
    expect(rejected.ok).toBe(false);
    expect(rejected.update).toBeDefined();

    const logRecord = createEngineEventLogRecord(
      0,
      { kind: 'Prompt', request, response },
      rejected.update!,
      false,
    );
    const report = auditEngineEventLogReplay(state, [logRecord]);

    expect(logRecord.expectedOk).toBe(false);
    expect(logRecord.stateIdBefore).toBe(stateFingerprint(state));
    expect(logRecord.stateIdAfter).toBe(stateFingerprint(state));
    expect(logRecord.rulesEvents.map(event => event.kind)).toEqual(['PromptResponseRejected']);
    expect(report.ok).toBe(true);
    expect(report.finalState).toBe(state);
    expect(report.steps[0]).toEqual(expect.objectContaining({
      requestId: request.id,
      ok: true,
      actualRuleEventKinds: ['PromptResponseRejected'],
      expectedVisibleDiffKinds: [],
      actualVisibleDiffKinds: [],
    }));
  });

  it('rejects event-log replay when a supposedly accepted prompt response replays as illegal', () => {
    const state = stateWithSisaySearchChoices();
    const request = createSearchLibraryPromptRequest(state, 'p1', {
      supertypes: ['Legendary'],
      permanent: true,
      manaValueLessThanSourcePower: true,
    }, 'battlefield', {
      id: 'prompt-event-log-illegal-as-accepted',
      sourceInstanceId: 'sisay_1',
      minSelections: 1,
      maxSelections: 1,
      createdAt: 20,
    });
    const response = {
      requestId: request.id,
      kind: 'SearchLibrary' as const,
      playerId: 'p1',
      selectedCardInstanceIds: ['arcane_signet_1'],
    };
    const rejected = applySearchLibraryPromptResponse(state, request, response);
    expect(rejected.ok).toBe(false);
    expect(rejected.update).toBeDefined();

    const forgedAcceptedRecord = createEngineEventLogRecord(
      0,
      { kind: 'Prompt', request, response },
      {
        ...rejected.update!,
        rulesEvents: [{
          kind: 'PromptResponseAccepted',
          requestId: request.id,
          playerId: 'p1',
          promptKind: 'SearchLibrary',
          selectedCardInstanceIds: ['arcane_signet_1'],
          destination: 'battlefield',
        }],
      },
      true,
    );
    const report = auditEngineEventLogReplay(state, [forgedAcceptedRecord]);

    expect(report.ok).toBe(false);
    expect(report.steps[0]).toEqual(expect.objectContaining({
      requestId: request.id,
      ok: false,
      reason: 'result_mismatch',
      message: 'Event log result mismatch: expected ok=true, got ok=false.',
    }));
  });

  it('replays validated manual mana untap corrections after a mana action', () => {
    const state = stateWithForestInHand();
    const forest = [...state.cards.values()].find(card => card.ownerId === 'p1' && card.definitionId === 'forest');
    expect(forest).toBeDefined();
    state.cards.set(forest!.instanceId, { ...forest!, zone: 'battlefield', tapped: true });
    state.players = state.players.map(player =>
      player.id === 'p1'
        ? { ...player, manaPool: { ...player.manaPool, G: 1 } }
        : player,
    );

    const untapRequest = createClientActionRequest(state, 'p1', {
      kind: 'ManualUntapManaSource',
      cardInstanceId: forest!.instanceId,
      color: 'G',
      amount: 1,
    }, {
      id: 'req-replay-manual-untap',
      source: 'system',
      createdAt: 36,
    });
    const untapped = applyClientActionRequest(state, untapRequest);
    expect(untapped.ok).toBe(true);
    expect(untapped.state?.cards.get(forest!.instanceId)?.tapped).toBe(false);
    expect(untapped.state?.players.find(player => player.id === 'p1')?.manaPool.G).toBe(0);

    const report = auditActionReplay(state, [untapRequest]);
    expect(report.ok).toBe(true);
    expect(report.finalState?.cards.get(forest!.instanceId)?.tapped).toBe(false);
  });

  it('replays validated manual counter corrections through the authority boundary', () => {
    const state = stateWithSisaySearchChoices();
    const request = createClientActionRequest(state, 'p1', {
      kind: 'ManualAdjustCounters',
      cardInstanceId: 'sisay_1',
      counterType: '+1/+1',
      delta: 2,
    }, {
      id: 'req-replay-manual-counters',
      source: 'system',
      createdAt: 37,
    });

    const adjusted = applyClientActionRequest(state, request);
    expect(adjusted.ok).toBe(true);
    expect(adjusted.state?.cards.get('sisay_1')?.counters['+1/+1']).toBe(2);

    const report = auditActionReplay(state, [request]);
    expect(report.ok).toBe(true);
    expect(report.finalState?.cards.get('sisay_1')?.counters['+1/+1']).toBe(2);
  });

  it('replays validated manual token corrections through the authority boundary', () => {
    const state = stateWithForestInHand();
    const request = createClientActionRequest(state, 'p1', {
      kind: 'ManualCreateToken',
      name: 'Treasure',
      count: 1,
      power: 0,
      toughness: 0,
      colors: [],
      types: ['artifact'],
      subtypes: ['Treasure'],
      keywords: [],
    }, {
      id: 'req-replay-manual-token',
      source: 'system',
      createdAt: 38,
    });

    const created = applyClientActionRequest(state, request);
    expect(created.ok).toBe(true);
    const token = [...(created.state?.cards.values() || [])].find(card => {
      const def = created.state?.cardDefinitions.get(card.definitionId);
      return card.ownerId === 'p1' && card.zone === 'battlefield' && card.isToken && def?.name === 'Treasure';
    });
    expect(token).toBeDefined();

    const report = auditActionReplay(state, [request]);
    expect(report.ok).toBe(true);
    expect([...(report.finalState?.cards.values() || [])].some(card => {
      const def = report.finalState?.cardDefinitions.get(card.definitionId);
      return card.ownerId === 'p1' && card.zone === 'battlefield' && card.isToken && def?.name === 'Treasure';
    })).toBe(true);
  });

  it('replays validated manual player counter corrections through the authority boundary', () => {
    const state = stateWithForestInHand();
    const request = createClientActionRequest(state, 'p1', {
      kind: 'ManualAdjustPlayerCounter',
      playerId: 'p1',
      counterType: 'experience',
      delta: 3,
    }, {
      id: 'req-replay-manual-player-counter',
      source: 'system',
      createdAt: 39,
    });

    const adjusted = applyClientActionRequest(state, request);
    expect(adjusted.ok).toBe(true);
    expect(adjusted.state?.players.find(player => player.id === 'p1')?.playerCounters?.experience).toBe(3);
    expect(adjusted.update?.visibleDiffs).toContainEqual(expect.objectContaining({
      kind: 'PlayerCounterChanged',
      playerId: 'p1',
      counterType: 'experience',
      from: 0,
      to: 3,
    }));

    const report = auditActionReplay(state, [request]);
    expect(report.ok).toBe(true);
    expect(report.finalState?.players.find(player => player.id === 'p1')?.playerCounters?.experience).toBe(3);
  });

  it('replays validated manual zone corrections through the authority boundary', () => {
    const state = stateWithForestInHand();
    const forest = [...state.cards.values()].find(card => card.ownerId === 'p1' && card.definitionId === 'forest');
    expect(forest).toBeDefined();
    const request = createClientActionRequest(state, 'p1', {
      kind: 'ManualMoveCard',
      cardInstanceId: forest!.instanceId,
      zone: 'graveyard',
    }, {
      id: 'req-replay-manual-zone',
      source: 'system',
      createdAt: 40,
    });

    const moved = applyClientActionRequest(state, request);
    expect(moved.ok).toBe(true);
    expect(moved.state?.cards.get(forest!.instanceId)?.zone).toBe('graveyard');
    expect(moved.update?.visibleDiffs).toContainEqual(expect.objectContaining({
      kind: 'CardZoneChanged',
      cardId: forest!.instanceId,
      from: 'hand',
      to: 'graveyard',
    }));

    const report = auditActionReplay(state, [request]);
    expect(report.ok).toBe(true);
    expect(report.finalState?.cards.get(forest!.instanceId)?.zone).toBe('graveyard');
  });

  it('replays validated manual damage corrections through the authority boundary', () => {
    const state = stateWithSisaySearchChoices();
    const request = createClientActionRequest(state, 'p1', {
      kind: 'ManualAdjustDamage',
      cardInstanceId: 'sisay_1',
      delta: 2,
    }, {
      id: 'req-replay-manual-damage',
      source: 'system',
      createdAt: 41,
    });

    const adjusted = applyClientActionRequest(state, request);
    expect(adjusted.ok).toBe(true);
    expect(adjusted.state?.cards.get('sisay_1')?.damage).toBe(2);
    expect(adjusted.update?.visibleDiffs).toContainEqual(expect.objectContaining({
      kind: 'CardDamageChanged',
      cardId: 'sisay_1',
      from: 0,
      to: 2,
    }));

    const report = auditActionReplay(state, [request]);
    expect(report.ok).toBe(true);
    expect(report.finalState?.cards.get('sisay_1')?.damage).toBe(2);
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

  it('does not create a Sisay search prompt while Sisay is still a permanent spell on the stack', () => {
    const base = stateWithSisaySearchChoices();
    const sisay = base.cards.get('sisay_1')!;
    const sisayDef = base.cardDefinitions.get('sisay')!;
    const cardDefinitions = new Map(base.cardDefinitions);
    cardDefinitions.set('sisay', {
      ...sisayDef,
      oracle_text: "{W}{U}{B}{R}{G}, {T}: Search your library for a legendary permanent card with mana value less than Sisay, Weatherlight Captain's power, put that card onto the battlefield, then shuffle.",
    });
    const cards = new Map(base.cards);
    cards.set('sisay_1', { ...sisay, zone: 'stack' });
    const state: GameState = {
      ...base,
      cardDefinitions,
      cards,
      stack: [{
        kind: 'Spell',
        id: 'stack-sisay-spell',
        cardInstanceId: 'sisay_1',
        casterId: 'p1',
        targets: [],
      }],
      hasPriorityPassed: [true, true],
    };

    const result = resolveTopStackSearchPrompt(state, {
      playerId: 'p1',
      createdAt: 99,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_search_effect');
    expect(state.stack).toHaveLength(1);
    expect(state.cards.get('sisay_1')?.zone).toBe('stack');
    expect(state.cards.get('arcane_signet_1')?.zone).toBe('library');
  });

  it('creates a Rampant Growth search prompt only after the spell resolves off the stack', () => {
    const base = stateWithForestInHand();
    const forest = [...base.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1')!;
    const rampantGrowth = def(
      'rampant_growth',
      'Rampant Growth',
      'Sorcery',
      '{1}{G}',
      'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    );
    const cards = new Map(base.cards);
    cards.set(forest.instanceId, { ...forest, zone: 'library' });
    cards.set('rampant_growth_1', cardInstance('rampant_growth_1', 'rampant_growth', 'p1', 'stack'));
    const state: GameState = {
      ...base,
      cardDefinitions: new Map(base.cardDefinitions).set('rampant_growth', rampantGrowth),
      cards,
      stack: [{
        kind: 'Spell',
        id: 'stack-rampant-growth',
        cardInstanceId: 'rampant_growth_1',
        casterId: 'p1',
        targets: [],
      }],
      hasPriorityPassed: [true, true],
    };

    const result = resolveTopStackSearchPrompt(state, {
      playerId: 'p1',
      createdAt: 100,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.stack).toHaveLength(0);
    expect(result.state.cards.get('rampant_growth_1')?.zone).toBe('graveyard');
    expect(result.state.cards.get(forest.instanceId)?.zone).toBe('library');
    expect(result.request.kind).toBe('SearchLibrary');
    expect(result.request.legalChoices.map(choice => choice.cardInstanceId)).toContain(forest.instanceId);

    const response = applySearchLibraryPromptResponse(result.state, result.request, {
      requestId: result.request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: [forest.instanceId],
    });

    expect(response.ok).toBe(true);
    expect(response.state?.cards.get(forest.instanceId)?.zone).toBe('battlefield');
    expect(response.state?.cards.get(forest.instanceId)?.tapped).toBe(true);
  });

  it('does not create a stack search prompt while priority is still pending', () => {
    const base = stateWithForestInHand();
    const forest = [...base.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1')!;
    const rampantGrowth = def(
      'rampant_growth',
      'Rampant Growth',
      'Sorcery',
      '{1}{G}',
      'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
    );
    const cards = new Map(base.cards);
    cards.set(forest.instanceId, { ...forest, zone: 'library' });
    cards.set('rampant_growth_1', cardInstance('rampant_growth_1', 'rampant_growth', 'p1', 'stack'));
    const state: GameState = {
      ...base,
      cardDefinitions: new Map(base.cardDefinitions).set('rampant_growth', rampantGrowth),
      cards,
      stack: [{
        kind: 'Spell',
        id: 'stack-rampant-growth',
        cardInstanceId: 'rampant_growth_1',
        casterId: 'p1',
        targets: [],
      }],
      hasPriorityPassed: [true, false],
    };

    const result = resolveTopStackSearchPrompt(state, {
      playerId: 'p1',
      createdAt: 102,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('priority_pending');
    expect(state.stack).toHaveLength(1);
    expect(state.cards.get('rampant_growth_1')?.zone).toBe('stack');
    expect(state.cards.get(forest.instanceId)?.zone).toBe('library');
  });

  it('keeps Cultivate multi-destination searches in one typed prompt', () => {
    const base = stateWithForestInHand();
    const forest = [...base.cards.values()].find(card => card.definitionId === 'forest' && card.ownerId === 'p1')!;
    const islandDef = base.cardDefinitions.get('island')!;
    const cultivate = def(
      'cultivate',
      'Cultivate',
      'Sorcery',
      '{2}{G}',
      'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
    );
    const cards = new Map(base.cards);
    cards.set(forest.instanceId, { ...forest, zone: 'library' });
    cards.set('cultivate_1', cardInstance('cultivate_1', 'cultivate', 'p1', 'stack'));
    cards.set('p1_extra_island', cardInstance('p1_extra_island', islandDef.id, 'p1', 'library'));
    const state: GameState = {
      ...base,
      cardDefinitions: new Map(base.cardDefinitions).set('cultivate', cultivate),
      cards,
      stack: [{
        kind: 'Spell',
        id: 'stack-cultivate',
        cardInstanceId: 'cultivate_1',
        casterId: 'p1',
        targets: [],
      }],
      hasPriorityPassed: [true, true],
    };

    const result = resolveTopStackSearchPrompt(state, {
      playerId: 'p1',
      createdAt: 101,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.minSelections).toBe(0);
    expect(result.request.maxSelections).toBe(2);
    expect(result.request.destinationBySelectionIndex).toEqual(['battlefield', 'hand']);
    expect(result.request.tappedBySelectionIndex).toEqual([true, false]);
    expect(result.request.legalChoices.map(choice => choice.cardInstanceId))
      .toEqual(expect.arrayContaining([forest.instanceId, 'p1_extra_island']));

    const partialResponse = applySearchLibraryPromptResponse(result.state, result.request, {
      requestId: result.request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: [forest.instanceId],
    });

    expect(partialResponse.ok).toBe(true);
    expect(partialResponse.state?.cards.get(forest.instanceId)?.zone).toBe('battlefield');
    expect(partialResponse.state?.cards.get(forest.instanceId)?.tapped).toBe(true);
    expect(partialResponse.state?.cards.get('p1_extra_island')?.zone).toBe('library');

    const response = applySearchLibraryPromptResponse(result.state, result.request, {
      requestId: result.request.id,
      kind: 'SearchLibrary',
      playerId: 'p1',
      selectedCardInstanceIds: [forest.instanceId, 'p1_extra_island'],
    });

    expect(response.ok).toBe(true);
    expect(response.state?.cards.get(forest.instanceId)?.zone).toBe('battlefield');
    expect(response.state?.cards.get(forest.instanceId)?.tapped).toBe(true);
    expect(response.state?.cards.get('p1_extra_island')?.zone).toBe('hand');
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
