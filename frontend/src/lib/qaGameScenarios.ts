import {
  registerBattlefieldAbilities,
  registerContinuousEffect,
  serializeGameState,
  type CardDefinition,
  type CardInstance,
  type GameState,
  type ManaColor,
  type SerializedGameStateV1,
} from 'commander-engine';

function cardTypes(typeLine: string): CardDefinition['card_types'] {
  const lower = typeLine.toLowerCase();
  return ([
    'creature',
    'instant',
    'sorcery',
    'artifact',
    'enchantment',
    'planeswalker',
    'land',
    'battle',
  ] as const).filter(type => lower.includes(type));
}

function def(
  id: string,
  name: string,
  typeLine: string,
  manaCost = '',
  oracleText = '',
  options: Partial<CardDefinition> = {},
): CardDefinition {
  return {
    id,
    name,
    type_line: typeLine,
    oracle_text: oracleText,
    mana_cost: manaCost,
    cmc: options.cmc ?? 0,
    colors: options.colors ?? [],
    color_identity: options.color_identity ?? (options.colors ?? []),
    keywords: options.keywords ?? [],
    power: options.power,
    toughness: options.toughness,
    card_types: options.card_types ?? cardTypes(typeLine),
    isEquipment: options.isEquipment,
    equipCost: options.equipCost,
    equipmentBonus: options.equipmentBonus,
    manaProduction: options.manaProduction,
    searchAbility: options.searchAbility,
    unlessTax: options.unlessTax,
  };
}

function instance(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  zone: CardInstance['zone'],
  options: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone,
    tapped: options.tapped ?? false,
    summoningSick: options.summoningSick ?? false,
    counters: options.counters ?? {},
    damage: options.damage ?? 0,
    isCommander: options.isCommander ?? false,
  };
}

function pool(values: Partial<Record<ManaColor, number>> = {}) {
  return {
    W: values.W ?? 0,
    U: values.U ?? 0,
    B: values.B ?? 0,
    R: values.R ?? 0,
    G: values.G ?? 0,
    C: values.C ?? 0,
  };
}

export function createSisayActivationQaState(): SerializedGameStateV1 {
  const sisay = def(
    'sisay',
    'Sisay, Weatherlight Captain',
    'Legendary Creature - Human Soldier',
    '{2}{W}',
    "Sisay, Weatherlight Captain gets +1/+1 for each color among other legendary permanents you control.\n{W}{U}{B}{R}{G}, {T}: Search your library for a legendary permanent card with mana value less than Sisay, Weatherlight Captain's power, put that card onto the battlefield, then shuffle.",
    { cmc: 3, colors: ['W'], color_identity: ['W', 'U', 'B', 'R', 'G'], power: 2, toughness: 2 },
  );
  const mahadi = def(
    'mahadi',
    'Mahadi, Emporium Master',
    'Legendary Creature - Cat Devil',
    '{1}{B}{R}',
    'At the beginning of your end step, create a Treasure token for each creature that died this turn.',
    { cmc: 3, colors: ['B', 'R'], color_identity: ['B', 'R'], power: 3, toughness: 3 },
  );
  const yoshimaru = def(
    'yoshimaru',
    'Yoshimaru, Ever Faithful',
    'Legendary Creature - Dog',
    '{W}',
    'Whenever another legendary permanent enters the battlefield under your control, put a +1/+1 counter on Yoshimaru, Ever Faithful.',
    { cmc: 1, colors: ['W'], color_identity: ['W'], power: 1, toughness: 1 },
  );
  const arcaneSignet = def(
    'arcane_signet',
    'Arcane Signet',
    'Artifact',
    '{2}',
    "{T}: Add one mana of any color in your commander's color identity.",
    { cmc: 2 },
  );
  const assassinsTrophy = def(
    'assassins_trophy',
    "Assassin's Trophy",
    'Instant',
    '{B}{G}',
    'Destroy target permanent an opponent controls. Its controller may search their library for a basic land card, put it onto the battlefield, then shuffle.',
    { cmc: 2, colors: ['B', 'G'], color_identity: ['B', 'G'] },
  );
  const jodah = def(
    'jodah',
    'Jodah, the Unifier',
    'Legendary Creature - Human Wizard',
    '{W}{U}{B}{R}{G}',
    'Legendary creatures you control get +X/+X, where X is the number of legendary creatures you control.',
    { cmc: 5, colors: ['W', 'U', 'B', 'R', 'G'], color_identity: ['W', 'U', 'B', 'R', 'G'], power: 5, toughness: 5 },
  );
  const forest = def('forest', 'Forest', 'Basic Land - Forest', '', '({T}: Add {G}.)', { card_types: ['land'] });

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Sisay QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'sisay_1',
        commanderCastCount: 1,
        manaPool: pool({ W: 1, U: 1, B: 1, R: 1, G: 1 }),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['sisay_1', instance('sisay_1', sisay.id, 'human', 'battlefield', { isCommander: true })],
      ['mahadi_1', instance('mahadi_1', mahadi.id, 'human', 'battlefield')],
      ['yoshimaru_1', instance('yoshimaru_1', yoshimaru.id, 'human', 'library')],
      ['arcane_signet_1', instance('arcane_signet_1', arcaneSignet.id, 'human', 'library')],
      ['assassins_trophy_1', instance('assassins_trophy_1', assassinsTrophy.id, 'human', 'library')],
      ['jodah_1', instance('jodah_1', jodah.id, 'human', 'library')],
      ['forest_1', instance('forest_1', forest.id, 'human', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [sisay.id, sisay],
      [mahadi.id, mahadi],
      [yoshimaru.id, yoshimaru],
      [arcaneSignet.id, arcaneSignet],
      [assassinsTrophy.id, assassinsTrophy],
      [jodah.id, jodah],
      [forest.id, forest],
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

  const stateWithSisayStaticEffect = registerContinuousEffect(state, 'sisay_1', 'human', {
    kind: 'StaticAbility',
    modifier: {
      kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl',
      powerPerColor: 1,
      toughnessPerColor: 1,
    },
    filter: {},
    controller: 'any',
    selfOnly: true,
    excludeSelf: false,
  });

  return serializeGameState(stateWithSisayStaticEffect);
}

export function createSisayRawLandsQaState(): SerializedGameStateV1 {
  const sisay = def(
    'sisay',
    'Sisay, Weatherlight Captain',
    'Legendary Creature - Human Soldier',
    '{2}{W}',
    "Sisay, Weatherlight Captain gets +1/+1 for each color among other legendary permanents you control.\n{W}{U}{B}{R}{G}, {T}: Search your library for a legendary permanent card with mana value less than Sisay, Weatherlight Captain's power, put that card onto the battlefield, then shuffle.",
    { cmc: 3, colors: ['W'], color_identity: ['W', 'U', 'B', 'R', 'G'], power: 2, toughness: 2 },
  );
  const mahadi = def(
    'mahadi',
    'Mahadi, Emporium Master',
    'Legendary Creature - Cat Devil',
    '{1}{B}{R}',
    'At the beginning of your end step, create a Treasure token for each creature that died this turn.',
    { cmc: 3, colors: ['B', 'R'], color_identity: ['B', 'R'], power: 3, toughness: 3 },
  );
  const templeGarden = def('temple_garden', 'Temple Garden', 'Land - Forest Plains');
  const rejuvenatingSprings = def('rejuvenating_springs', 'Rejuvenating Springs', 'Land - Forest Island');
  const undergrowthStadium = def('undergrowth_stadium', 'Undergrowth Stadium', 'Land - Swamp Forest');
  const stompingGround = def('stomping_ground', 'Stomping Ground', 'Land - Mountain Forest');
  const steamVents = def('steam_vents', 'Steam Vents', 'Land - Island Mountain');
  const yoshimaru = def(
    'yoshimaru',
    'Yoshimaru, Ever Faithful',
    'Legendary Creature - Dog',
    '{W}',
    'Whenever another legendary permanent enters the battlefield under your control, put a +1/+1 counter on Yoshimaru, Ever Faithful.',
    { cmc: 1, colors: ['W'], color_identity: ['W'], power: 1, toughness: 1 },
  );
  const jodah = def(
    'jodah',
    'Jodah, the Unifier',
    'Legendary Creature - Human Wizard',
    '{W}{U}{B}{R}{G}',
    'Legendary creatures you control get +X/+X, where X is the number of legendary creatures you control.',
    { cmc: 5, colors: ['W', 'U', 'B', 'R', 'G'], color_identity: ['W', 'U', 'B', 'R', 'G'], power: 5, toughness: 5 },
  );

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Sisay Raw Lands QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'sisay_1',
        commanderCastCount: 1,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['sisay_1', instance('sisay_1', sisay.id, 'human', 'battlefield', { isCommander: true })],
      ['mahadi_1', instance('mahadi_1', mahadi.id, 'human', 'battlefield')],
      ['temple_garden_1', instance('temple_garden_1', templeGarden.id, 'human', 'battlefield')],
      ['rejuvenating_springs_1', instance('rejuvenating_springs_1', rejuvenatingSprings.id, 'human', 'battlefield')],
      ['undergrowth_stadium_1', instance('undergrowth_stadium_1', undergrowthStadium.id, 'human', 'battlefield')],
      ['stomping_ground_1', instance('stomping_ground_1', stompingGround.id, 'human', 'battlefield')],
      ['steam_vents_1', instance('steam_vents_1', steamVents.id, 'human', 'battlefield')],
      ['yoshimaru_1', instance('yoshimaru_1', yoshimaru.id, 'human', 'library')],
      ['jodah_1', instance('jodah_1', jodah.id, 'human', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [sisay.id, sisay],
      [mahadi.id, mahadi],
      [templeGarden.id, templeGarden],
      [rejuvenatingSprings.id, rejuvenatingSprings],
      [undergrowthStadium.id, undergrowthStadium],
      [stompingGround.id, stompingGround],
      [steamVents.id, steamVents],
      [yoshimaru.id, yoshimaru],
      [jodah.id, jodah],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  const stateWithSisayStaticEffect = registerContinuousEffect(state, 'sisay_1', 'human', {
    kind: 'StaticAbility',
    modifier: {
      kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl',
      powerPerColor: 1,
      toughnessPerColor: 1,
    },
    filter: {},
    controller: 'any',
    selfOnly: true,
    excludeSelf: false,
  });

  return serializeGameState(stateWithSisayStaticEffect);
}

export function createLandEntryFetchQaState(): SerializedGameStateV1 {
  const commander = def(
    'lands_qa_commander',
    'Sisay, Weatherlight Captain',
    'Legendary Creature - Human Soldier',
    '{2}{W}',
    "Sisay, Weatherlight Captain gets +1/+1 for each color among other legendary permanents you control.\n{W}{U}{B}{R}{G}, {T}: Search your library for a legendary permanent card with mana value less than Sisay, Weatherlight Captain's power, put that card onto the battlefield, then shuffle.",
    { cmc: 3, colors: ['W'], color_identity: ['W', 'U', 'B', 'R', 'G'], power: 2, toughness: 2 },
  );
  const stompingGround = def(
    'stomping_ground_hand',
    'Stomping Ground',
    'Land - Mountain Forest',
    '',
    "As Stomping Ground enters, you may pay 2 life. If you don't, it enters tapped.",
    { card_types: ['land'] },
  );
  const scaldingTarn = def(
    'scalding_tarn_board',
    'Scalding Tarn',
    'Land',
    '',
    '{T}, Pay 1 life, Sacrifice this land: Search your library for an Island or Mountain card, put it onto the battlefield, then shuffle.',
    { card_types: ['land'] },
  );
  const cavern = def(
    'cavern_of_souls_hand',
    'Cavern of Souls',
    'Land',
    '',
    "As Cavern of Souls enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.",
    { card_types: ['land'] },
  );
  const steamVents = def(
    'steam_vents_library',
    'Steam Vents',
    'Land - Island Mountain',
    '',
    "As Steam Vents enters, you may pay 2 life. If you don't, it enters tapped.",
    { card_types: ['land'] },
  );
  const island = def('island_library', 'Island', 'Basic Land - Island', '', '({T}: Add {U}.)', { card_types: ['land'] });
  const forest = def('forest_library', 'Forest', 'Basic Land - Forest', '', '({T}: Add {G}.)', { card_types: ['land'] });
  const arcaneSignet = def(
    'arcane_signet_library',
    'Arcane Signet',
    'Artifact',
    '{2}',
    "{T}: Add one mana of any color in your commander's color identity.",
    { cmc: 2 },
  );

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Land Entry QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'lands_qa_commander_1',
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['lands_qa_commander_1', instance('lands_qa_commander_1', commander.id, 'human', 'command', { isCommander: true })],
      ['stomping_ground_hand_1', instance('stomping_ground_hand_1', stompingGround.id, 'human', 'hand')],
      ['cavern_of_souls_hand_1', instance('cavern_of_souls_hand_1', cavern.id, 'human', 'hand')],
      ['scalding_tarn_board_1', instance('scalding_tarn_board_1', scaldingTarn.id, 'human', 'battlefield')],
      ['steam_vents_library_1', instance('steam_vents_library_1', steamVents.id, 'human', 'library')],
      ['island_library_1', instance('island_library_1', island.id, 'human', 'library')],
      ['forest_library_1', instance('forest_library_1', forest.id, 'human', 'library')],
      ['arcane_signet_library_1', instance('arcane_signet_library_1', arcaneSignet.id, 'human', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [commander.id, commander],
      [stompingGround.id, stompingGround],
      [cavern.id, cavern],
      [scaldingTarn.id, scaldingTarn],
      [steamVents.id, steamVents],
      [island.id, island],
      [forest.id, forest],
      [arcaneSignet.id, arcaneSignet],
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

  return serializeGameState(state);
}

export function createModalChoiceQaState(): SerializedGameStateV1 {
  const commander = def(
    'modal_qa_commander',
    'Krenko, Mob Boss',
    'Legendary Creature - Goblin Warrior',
    '{2}{R}{R}',
    '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
    { cmc: 4, colors: ['R'], color_identity: ['R'], power: 3, toughness: 3 },
  );
  const abrade = def(
    'abrade',
    'Abrade',
    'Instant',
    '{1}{R}',
    'Choose one —\n• Abrade deals 3 damage to target creature.\n• Destroy target artifact.',
    { cmc: 2, colors: ['R'], color_identity: ['R'] },
  );
  const solRing = def(
    'opponent_sol_ring',
    'Sol Ring',
    'Artifact',
    '{1}',
    '{T}: Add {C}{C}.',
    { cmc: 1 },
  );
  const bear = def(
    'opponent_bear',
    'Grizzly Bears',
    'Creature - Bear',
    '{1}{G}',
    '',
    { cmc: 2, colors: ['G'], color_identity: ['G'], power: 2, toughness: 2 },
  );
  const mountain = def('modal_qa_mountain', 'Mountain', 'Basic Land - Mountain', '', '({T}: Add {R}.)', { card_types: ['land'] });

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Modal QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'modal_qa_commander_1',
        commanderCastCount: 0,
        manaPool: pool({ R: 4 }),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Modal QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['modal_qa_commander_1', instance('modal_qa_commander_1', commander.id, 'human', 'command', { isCommander: true })],
      ['abrade_damage_1', instance('abrade_damage_1', abrade.id, 'human', 'hand')],
      ['abrade_artifact_1', instance('abrade_artifact_1', abrade.id, 'human', 'hand')],
      ['modal_qa_mountain_1', instance('modal_qa_mountain_1', mountain.id, 'human', 'battlefield')],
      ['opponent_sol_ring_1', instance('opponent_sol_ring_1', solRing.id, 'ai-1', 'battlefield')],
      ['opponent_bear_1', instance('opponent_bear_1', bear.id, 'ai-1', 'battlefield')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [commander.id, commander],
      [abrade.id, abrade],
      [mountain.id, mountain],
      [solRing.id, solRing],
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

  return serializeGameState(state);
}

export function createKrenkoSkirkQaState(): SerializedGameStateV1 {
  const krenko = def(
    'krenko_skirk_qa_krenko',
    'Krenko, Mob Boss',
    'Legendary Creature - Goblin Warrior',
    '{2}{R}{R}',
    '{T}: Create X 1/1 red Goblin creature tokens, where X is the number of Goblins you control.',
    { cmc: 4, colors: ['R'], color_identity: ['R'], power: 3, toughness: 3 },
  );
  const skirk = def(
    'krenko_skirk_qa_skirk',
    'Skirk Prospector',
    'Creature - Goblin',
    '{R}',
    'Sacrifice a Goblin: Add {R}.',
    {
      cmc: 1,
      colors: ['R'],
      color_identity: ['R'],
      power: 1,
      toughness: 1,
      manaProduction: {
        colors: ['R'],
        amounts: { R: 1 },
        isTapAbility: false,
        requiresSacrifice: false,
        sacrificeFilter: { subtypes: ['Goblin'] },
      },
    },
  );
  const impactTremors = def(
    'krenko_skirk_qa_impact_tremors',
    'Impact Tremors',
    'Enchantment',
    '{1}{R}',
    'Whenever a creature enters the battlefield under your control, Impact Tremors deals 1 damage to each opponent.',
    { cmc: 2, colors: ['R'], color_identity: ['R'] },
  );
  const goblinToken = def(
    'krenko_skirk_qa_goblin_token',
    'Goblin',
    'Token Creature - Goblin',
    '',
    '',
    { colors: ['R'], color_identity: ['R'], power: 1, toughness: 1 },
  );
  const mountain = def('krenko_skirk_qa_mountain', 'Mountain', 'Basic Land - Mountain', '', '({T}: Add {R}.)', {
    card_types: ['land'],
    manaProduction: {
      colors: ['R'],
      amounts: { R: 1 },
      isTapAbility: true,
      requiresSacrifice: false,
    },
  });

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Krenko QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'krenko_skirk_qa_krenko_1',
        commanderCastCount: 1,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Krenko QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['krenko_skirk_qa_krenko_1', instance('krenko_skirk_qa_krenko_1', krenko.id, 'human', 'battlefield', {
        isCommander: true,
        summoningSick: false,
      })],
      ['krenko_skirk_qa_skirk_1', instance('krenko_skirk_qa_skirk_1', skirk.id, 'human', 'battlefield', {
        summoningSick: false,
      })],
      ['krenko_skirk_qa_impact_tremors_1', instance('krenko_skirk_qa_impact_tremors_1', impactTremors.id, 'human', 'battlefield')],
      ['krenko_skirk_qa_mountain_1', instance('krenko_skirk_qa_mountain_1', mountain.id, 'human', 'battlefield')],
      ['krenko_skirk_qa_goblin_1', instance('krenko_skirk_qa_goblin_1', goblinToken.id, 'human', 'battlefield', { isToken: true })],
      ['krenko_skirk_qa_goblin_2', instance('krenko_skirk_qa_goblin_2', goblinToken.id, 'human', 'battlefield', { isToken: true })],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [krenko.id, krenko],
      [skirk.id, skirk],
      [impactTremors.id, impactTremors],
      [goblinToken.id, goblinToken],
      [mountain.id, mountain],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 4,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  let withAbilities = state;
  for (const id of ['krenko_skirk_qa_krenko_1', 'krenko_skirk_qa_impact_tremors_1']) {
    withAbilities = registerBattlefieldAbilities(withAbilities, id);
  }

  return serializeGameState(withAbilities);
}

export function createLibraryManipulationQaState(): SerializedGameStateV1 {
  const commander = def(
    'library_qa_commander',
    'Talrand, Sky Summoner',
    'Legendary Creature - Merfolk Wizard',
    '{2}{U}{U}',
    'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    { cmc: 4, colors: ['U'], color_identity: ['U'], power: 2, toughness: 2 },
  );
  const opt = def(
    'library_qa_opt',
    'Opt',
    'Instant',
    '{U}',
    'Scry 1.\nDraw a card.',
    { cmc: 1, colors: ['U'], color_identity: ['U'] },
  );
  const consider = def(
    'library_qa_consider',
    'Consider',
    'Instant',
    '{U}',
    'Surveil 1.\nDraw a card.',
    { cmc: 1, colors: ['U'], color_identity: ['U'] },
  );
  const lightningBolt = def('library_qa_bolt', 'Lightning Bolt', 'Instant', '{R}', 'Lightning Bolt deals 3 damage to any target.', { cmc: 1, colors: ['R'], color_identity: ['R'] });
  const island = def('library_qa_island', 'Island', 'Basic Land - Island', '', '({T}: Add {U}.)', { card_types: ['land'] });
  const mountain = def('library_qa_mountain', 'Mountain', 'Basic Land - Mountain', '', '({T}: Add {R}.)', { card_types: ['land'] });
  const forest = def('library_qa_forest', 'Forest', 'Basic Land - Forest', '', '({T}: Add {G}.)', { card_types: ['land'] });

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Library Manipulation QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'library_qa_commander_1',
        commanderCastCount: 0,
        manaPool: pool({ U: 4 }),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Library QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['library_qa_commander_1', instance('library_qa_commander_1', commander.id, 'human', 'command', { isCommander: true })],
      ['library_qa_opt_1', instance('library_qa_opt_1', opt.id, 'human', 'hand')],
      ['library_qa_consider_1', instance('library_qa_consider_1', consider.id, 'human', 'hand')],
      ['library_qa_bolt_1', instance('library_qa_bolt_1', lightningBolt.id, 'human', 'library')],
      ['library_qa_island_1', instance('library_qa_island_1', island.id, 'human', 'library')],
      ['library_qa_mountain_1', instance('library_qa_mountain_1', mountain.id, 'human', 'library')],
      ['library_qa_forest_1', instance('library_qa_forest_1', forest.id, 'human', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [commander.id, commander],
      [opt.id, opt],
      [consider.id, consider],
      [lightningBolt.id, lightningBolt],
      [island.id, island],
      [mountain.id, mountain],
      [forest.id, forest],
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

  return serializeGameState(state);
}

export function createSeeBeyondQaState(): SerializedGameStateV1 {
  const commander = def(
    'see_beyond_commander',
    'Talrand, Sky Summoner',
    'Legendary Creature - Merfolk Wizard',
    '{2}{U}{U}',
    'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    { cmc: 4, colors: ['U'], color_identity: ['U'], power: 2, toughness: 2 },
  );
  const seeBeyond = def(
    'see_beyond',
    'See Beyond',
    'Sorcery',
    '{1}{U}',
    'Draw two cards, then shuffle a card from your hand into your library.',
    { cmc: 2, colors: ['U'], color_identity: ['U'] },
  );
  const merfolk = def(
    'see_beyond_merfolk',
    'Coral Merfolk',
    'Creature - Merfolk',
    '{1}{U}',
    '',
    { cmc: 2, colors: ['U'], color_identity: ['U'], power: 2, toughness: 1 },
  );
  const guard = def(
    'see_beyond_guard',
    'Maritime Guard',
    'Creature - Merfolk Soldier',
    '{1}{U}',
    '',
    { cmc: 2, colors: ['U'], color_identity: ['U'], power: 1, toughness: 3 },
  );
  const drawOne = def('see_beyond_draw_one', 'Drawn Card One', 'Creature - Fish', '{U}', '', { cmc: 1, colors: ['U'], color_identity: ['U'], power: 1, toughness: 1 });
  const drawTwo = def('see_beyond_draw_two', 'Drawn Card Two', 'Creature - Fish', '{U}', '', { cmc: 1, colors: ['U'], color_identity: ['U'], power: 1, toughness: 1 });
  const libraryRest = def('see_beyond_rest', 'Library Rest', 'Creature - Fish', '{U}', '', { cmc: 1, colors: ['U'], color_identity: ['U'], power: 1, toughness: 1 });
  const island = def('see_beyond_island', 'Island', 'Basic Land - Island', '', '({T}: Add {U}.)', { card_types: ['land'] });

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'See Beyond QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'see_beyond_commander_1',
        commanderCastCount: 0,
        manaPool: pool({ U: 2 }),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'See Beyond QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['see_beyond_commander_1', instance('see_beyond_commander_1', commander.id, 'human', 'command', { isCommander: true })],
      ['see_beyond_1', instance('see_beyond_1', seeBeyond.id, 'human', 'hand')],
      ['see_beyond_merfolk_1', instance('see_beyond_merfolk_1', merfolk.id, 'human', 'hand')],
      ['see_beyond_guard_1', instance('see_beyond_guard_1', guard.id, 'human', 'hand')],
      ['see_beyond_draw_one_1', instance('see_beyond_draw_one_1', drawOne.id, 'human', 'library')],
      ['see_beyond_draw_two_1', instance('see_beyond_draw_two_1', drawTwo.id, 'human', 'library')],
      ['see_beyond_rest_1', instance('see_beyond_rest_1', libraryRest.id, 'human', 'library')],
      ['see_beyond_island_1', instance('see_beyond_island_1', island.id, 'human', 'battlefield')],
      ['see_beyond_island_2', instance('see_beyond_island_2', island.id, 'human', 'battlefield')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [commander.id, commander],
      [seeBeyond.id, seeBeyond],
      [merfolk.id, merfolk],
      [guard.id, guard],
      [drawOne.id, drawOne],
      [drawTwo.id, drawTwo],
      [libraryRest.id, libraryRest],
      [island.id, island],
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

  return serializeGameState(state);
}

export function createMulliganSelectionQaState(): SerializedGameStateV1 {
  const commander = def(
    'mulligan_qa_commander',
    'Talrand, Sky Summoner',
    'Legendary Creature - Merfolk Wizard',
    '{2}{U}{U}',
    'Whenever you cast an instant or sorcery spell, create a 2/2 blue Drake creature token with flying.',
    { cmc: 4, colors: ['U'], color_identity: ['U'], power: 2, toughness: 2 },
  );
  const handDefs = [
    def('mulligan_qa_opt', 'Opt', 'Instant', '{U}', 'Scry 1.\nDraw a card.', { cmc: 1, colors: ['U'], color_identity: ['U'] }),
    def('mulligan_qa_counterspell', 'Counterspell', 'Instant', '{U}{U}', 'Counter target spell.', { cmc: 2, colors: ['U'], color_identity: ['U'] }),
    def('mulligan_qa_island', 'Island', 'Basic Land - Island', '', '({T}: Add {U}.)', { card_types: ['land'] }),
    def('mulligan_qa_mountain', 'Mountain', 'Basic Land - Mountain', '', '({T}: Add {R}.)', { card_types: ['land'] }),
    def('mulligan_qa_forest', 'Forest', 'Basic Land - Forest', '', '({T}: Add {G}.)', { card_types: ['land'] }),
    def('mulligan_qa_bear', 'Grizzly Bears', 'Creature - Bear', '{1}{G}', '', { cmc: 2, colors: ['G'], color_identity: ['G'], power: 2, toughness: 2 }),
    def('mulligan_qa_bolt', 'Lightning Bolt', 'Instant', '{R}', 'Lightning Bolt deals 3 damage to any target.', { cmc: 1, colors: ['R'], color_identity: ['R'] }),
  ];
  const libraryDefs = [
    def('mulligan_qa_draw_1', 'Ponder', 'Sorcery', '{U}', 'Look at the top three cards of your library, then put them back in any order. You may shuffle. Draw a card.', { cmc: 1, colors: ['U'], color_identity: ['U'] }),
    def('mulligan_qa_draw_2', 'Preordain', 'Sorcery', '{U}', 'Scry 2, then draw a card.', { cmc: 1, colors: ['U'], color_identity: ['U'] }),
    def('mulligan_qa_draw_3', 'Arcane Signet', 'Artifact', '{2}', '{T}: Add one mana of any color in your commander\'s color identity.', { cmc: 2, card_types: ['artifact'] }),
    def('mulligan_qa_draw_4', 'Sol Ring', 'Artifact', '{1}', '{T}: Add {C}{C}.', { cmc: 1, card_types: ['artifact'] }),
    def('mulligan_qa_draw_5', 'Island Two', 'Basic Land - Island', '', '({T}: Add {U}.)', { card_types: ['land'] }),
  ];
  const allDefs = [commander, ...handDefs, ...libraryDefs];

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Mulligan QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'mulligan_qa_commander_1',
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Mulligan QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['mulligan_qa_commander_1', instance('mulligan_qa_commander_1', commander.id, 'human', 'command', { isCommander: true })],
      ...handDefs.map((card): [string, CardInstance] => [
        `${card.id}_1`,
        instance(`${card.id}_1`, card.id, 'human', 'hand'),
      ]),
      ...libraryDefs.map((card): [string, CardInstance] => [
        `${card.id}_1`,
        instance(`${card.id}_1`, card.id, 'human', 'library'),
      ]),
    ]),
    cardDefinitions: new Map<string, CardDefinition>(allDefs.map(card => [card.id, card])),
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

  return serializeGameState(state);
}

export function createCostReductionQaState(): SerializedGameStateV1 {
  const mentor = def(
    'cost_reduction_qa_mentor',
    'Stormcatch Mentor',
    'Creature - Otter Wizard',
    '{1}{R}',
    'Instant and sorcery spells you cast cost {1} less to cast.',
    { cmc: 2, colors: ['R'], color_identity: ['R'], power: 1, toughness: 1 },
  );
  const bolt = def(
    'cost_reduction_qa_bolt',
    'Expensive Bolt',
    'Instant',
    '{1}{R}',
    'Expensive Bolt deals 3 damage to any target.',
    { cmc: 2, colors: ['R'], color_identity: ['R'] },
  );

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Cost Reduction QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool({ R: 1 }),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Cost Reduction QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['cost_reduction_qa_mentor_1', instance('cost_reduction_qa_mentor_1', mentor.id, 'human', 'battlefield')],
      ['cost_reduction_qa_bolt_1', instance('cost_reduction_qa_bolt_1', bolt.id, 'human', 'hand')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [mentor.id, mentor],
      [bolt.id, bolt],
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

  const withReduction = registerContinuousEffect(state, 'cost_reduction_qa_mentor_1', 'human', {
    kind: 'StaticAbility',
    modifier: { kind: 'ReduceCost', amount: 1 },
    filter: { types: ['instant', 'sorcery'] },
    controller: 'you',
    excludeSelf: false,
  });

  return serializeGameState(withReduction);
}

export function createStormGrapeshotQaState(): SerializedGameStateV1 {
  const commander = def(
    'storm_qa_commander',
    'Vivi Ornitier',
    'Legendary Creature - Wizard',
    '{1}{U}{R}',
    'Whenever you cast an instant or sorcery spell, Vivi Ornitier gets +1/+1 until end of turn.',
    { cmc: 3, colors: ['U', 'R'], color_identity: ['U', 'R'], power: 0, toughness: 3 },
  );
  const grapeshot = def(
    'storm_qa_grapeshot',
    'Grapeshot',
    'Sorcery',
    '{1}{R}',
    'Grapeshot deals 1 damage to any target.\nStorm',
    { cmc: 2, colors: ['R'], color_identity: ['R'] },
  );

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Storm QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'storm_qa_commander_1',
        commanderCastCount: 0,
        manaPool: pool({ R: 4 }),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Storm QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['storm_qa_commander_1', instance('storm_qa_commander_1', commander.id, 'human', 'battlefield', { isCommander: true })],
      ['storm_qa_grapeshot_1', instance('storm_qa_grapeshot_1', grapeshot.id, 'human', 'hand')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [commander.id, commander],
      [grapeshot.id, grapeshot],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    spellsCastThisTurn: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  return serializeGameState(registerBattlefieldAbilities(state, 'storm_qa_commander_1'));
}

export function createSpellCopyQaState(): SerializedGameStateV1 {
  const commander = def(
    'copy_qa_commander',
    'Vivi Ornitier',
    'Legendary Creature - Wizard',
    '{1}{U}{R}',
    'Whenever you cast an instant or sorcery spell, Vivi Ornitier gets +1/+1 until end of turn.',
    { cmc: 3, colors: ['U', 'R'], color_identity: ['U', 'R'], power: 0, toughness: 3 },
  );
  const lightningBolt = def(
    'copy_qa_bolt',
    'Lightning Bolt',
    'Instant',
    '{R}',
    'Lightning Bolt deals 3 damage to any target.',
    { cmc: 1, colors: ['R'], color_identity: ['R'] },
  );
  const fork = def(
    'copy_qa_fork',
    'Fork',
    'Instant',
    '{R}{R}',
    'Copy target instant or sorcery spell. You may choose new targets for the copy.',
    { cmc: 2, colors: ['R'], color_identity: ['R'] },
  );

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Spell Copy QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'copy_qa_commander_1',
        commanderCastCount: 0,
        manaPool: pool({ R: 4 }),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Spell Copy QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['copy_qa_commander_1', instance('copy_qa_commander_1', commander.id, 'human', 'battlefield', { isCommander: true })],
      ['copy_qa_bolt_1', instance('copy_qa_bolt_1', lightningBolt.id, 'human', 'stack')],
      ['copy_qa_fork_1', instance('copy_qa_fork_1', fork.id, 'human', 'hand')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [commander.id, commander],
      [lightningBolt.id, lightningBolt],
      [fork.id, fork],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    spellsCastThisTurn: 1,
    hasPriorityPassed: [false, false],
    stack: [{
      kind: 'Spell',
      id: 'copy_qa_bolt_stack_1',
      cardInstanceId: 'copy_qa_bolt_1',
      casterId: 'human',
      targets: ['ai-1'],
      castFromZone: 'hand',
    }],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  return serializeGameState(registerBattlefieldAbilities(state, 'copy_qa_commander_1'));
}

export function createMagecraftTriggersQaState(): SerializedGameStateV1 {
  const commander = def(
    'magecraft_qa_commander',
    'Vivi Ornitier',
    'Legendary Creature - Wizard',
    '{1}{U}{R}',
    'Whenever you cast an instant or sorcery spell, Vivi Ornitier gets +1/+1 until end of turn.',
    { cmc: 3, colors: ['U', 'R'], color_identity: ['U', 'R'], power: 0, toughness: 3 },
  );
  const opt = def(
    'magecraft_qa_opt',
    'Opt',
    'Instant',
    '{U}',
    'Scry 1.\nDraw a card.',
    { cmc: 1, colors: ['U'], color_identity: ['U'] },
  );
  const archmage = def(
    'magecraft_qa_archmage',
    'Archmage Emeritus',
    'Creature - Human Wizard',
    '{2}{U}{U}',
    'Magecraft - Whenever you cast or copy an instant or sorcery spell, draw a card.',
    { cmc: 4, colors: ['U'], color_identity: ['U'], power: 2, toughness: 2 },
  );
  const stormKiln = def(
    'magecraft_qa_storm_kiln',
    'Storm-Kiln Artist',
    'Creature - Dwarf Shaman',
    '{3}{R}',
    'Magecraft - Whenever you cast or copy an instant or sorcery spell, create a Treasure token.',
    { cmc: 4, colors: ['R'], color_identity: ['R'], power: 2, toughness: 2 },
  );
  const veyran = def(
    'magecraft_qa_veyran',
    'Veyran, Voice of Duality',
    'Legendary Creature - Efreet Wizard',
    '{1}{U}{R}',
    'Magecraft - Whenever you cast or copy an instant or sorcery spell, Veyran, Voice of Duality gets +1/+1 until end of turn.\nIf you casting or copying an instant or sorcery spell causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
    { cmc: 3, colors: ['U', 'R'], color_identity: ['U', 'R'], power: 2, toughness: 2 },
  );
  const island = def('magecraft_qa_island', 'Island', 'Basic Land - Island', '', '({T}: Add {U}.)', { card_types: ['land'] });
  const mountain = def('magecraft_qa_mountain', 'Mountain', 'Basic Land - Mountain', '', '({T}: Add {R}.)', { card_types: ['land'] });
  const forest = def('magecraft_qa_forest', 'Forest', 'Basic Land - Forest', '', '({T}: Add {G}.)', { card_types: ['land'] });
  const plains = def('magecraft_qa_plains', 'Plains', 'Basic Land - Plains', '', '({T}: Add {W}.)', { card_types: ['land'] });

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Magecraft QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'magecraft_qa_commander_1',
        commanderCastCount: 0,
        manaPool: pool({ U: 4 }),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Magecraft QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['magecraft_qa_commander_1', instance('magecraft_qa_commander_1', commander.id, 'human', 'battlefield', { isCommander: true })],
      ['magecraft_qa_opt_1', instance('magecraft_qa_opt_1', opt.id, 'human', 'hand')],
      ['magecraft_qa_archmage_1', instance('magecraft_qa_archmage_1', archmage.id, 'human', 'battlefield')],
      ['magecraft_qa_storm_kiln_1', instance('magecraft_qa_storm_kiln_1', stormKiln.id, 'human', 'battlefield')],
      ['magecraft_qa_veyran_1', instance('magecraft_qa_veyran_1', veyran.id, 'human', 'battlefield')],
      ['magecraft_qa_island_1', instance('magecraft_qa_island_1', island.id, 'human', 'library')],
      ['magecraft_qa_mountain_1', instance('magecraft_qa_mountain_1', mountain.id, 'human', 'library')],
      ['magecraft_qa_forest_1', instance('magecraft_qa_forest_1', forest.id, 'human', 'library')],
      ['magecraft_qa_plains_1', instance('magecraft_qa_plains_1', plains.id, 'human', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [commander.id, commander],
      [opt.id, opt],
      [archmage.id, archmage],
      [stormKiln.id, stormKiln],
      [veyran.id, veyran],
      [island.id, island],
      [mountain.id, mountain],
      [forest.id, forest],
      [plains.id, plains],
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

  let withTriggers = state;
  for (const id of ['magecraft_qa_commander_1', 'magecraft_qa_archmage_1', 'magecraft_qa_storm_kiln_1', 'magecraft_qa_veyran_1']) {
    withTriggers = registerBattlefieldAbilities(withTriggers, id);
  }

  return serializeGameState(withTriggers);
}

export function createComplexCombatQaState(): SerializedGameStateV1 {
  const tramplingCommander = def(
    'complex_combat_commander',
    'Trampling Commander',
    'Legendary Creature - Giant',
    '{5}{G}{G}',
    'Trample',
    { cmc: 7, colors: ['G'], color_identity: ['G'], power: 7, toughness: 7, keywords: ['Trample'] },
  );
  const twinHealer = def(
    'complex_combat_twin_healer',
    'Twin Healer',
    'Creature - Cleric',
    '{1}{W}',
    'Double strike, lifelink',
    { cmc: 2, colors: ['W'], color_identity: ['W'], power: 2, toughness: 2, keywords: ['Double Strike', 'Lifelink'] },
  );
  const venomCharger = def(
    'complex_combat_venom_charger',
    'Venom Charger',
    'Creature - Beast',
    '{1}{G}{G}',
    'Deathtouch, trample',
    { cmc: 3, colors: ['G'], color_identity: ['G'], power: 3, toughness: 3, keywords: ['Deathtouch', 'Trample'] },
  );
  const bearBlocker = def(
    'complex_combat_bear',
    'Bear Blocker',
    'Creature - Bear',
    '{1}{G}',
    '',
    { cmc: 2, colors: ['G'], color_identity: ['G'], power: 2, toughness: 2 },
  );
  const wallBlocker = def(
    'complex_combat_wall',
    'Wall Blocker',
    'Creature - Wall',
    '{3}',
    'Defender',
    { cmc: 3, power: 0, toughness: 4 },
  );
  const colossus = def(
    'complex_combat_colossus',
    'Large Blocker',
    'Creature - Giant',
    '{5}{G}',
    '',
    { cmc: 6, colors: ['G'], color_identity: ['G'], power: 6, toughness: 6 },
  );
  const observerCommander = def(
    'complex_combat_observer_commander',
    'Observer Commander',
    'Legendary Creature - Advisor',
    '{2}',
    '',
    { cmc: 2, power: 2, toughness: 2 },
  );

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Complex Combat QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'complex_combat_commander_1',
        commanderCastCount: 1,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Left Defender',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'complex_combat_observer_1',
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
      {
        id: 'ai-2',
        name: 'Middle Defender',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'complex_combat_observer_2',
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
      {
        id: 'ai-3',
        name: 'Right Defender',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'complex_combat_observer_3',
        commanderCastCount: 0,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['complex_combat_commander_1', instance('complex_combat_commander_1', tramplingCommander.id, 'human', 'battlefield', { isCommander: true })],
      ['complex_combat_twin_healer_1', instance('complex_combat_twin_healer_1', twinHealer.id, 'human', 'battlefield')],
      ['complex_combat_venom_charger_1', instance('complex_combat_venom_charger_1', venomCharger.id, 'human', 'battlefield')],
      ['complex_combat_bear_1', instance('complex_combat_bear_1', bearBlocker.id, 'ai-1', 'battlefield')],
      ['complex_combat_wall_1', instance('complex_combat_wall_1', wallBlocker.id, 'ai-1', 'battlefield')],
      ['complex_combat_colossus_1', instance('complex_combat_colossus_1', colossus.id, 'ai-3', 'battlefield')],
      ['complex_combat_observer_1', instance('complex_combat_observer_1', observerCommander.id, 'ai-1', 'command', { isCommander: true })],
      ['complex_combat_observer_2', instance('complex_combat_observer_2', observerCommander.id, 'ai-2', 'command', { isCommander: true })],
      ['complex_combat_observer_3', instance('complex_combat_observer_3', observerCommander.id, 'ai-3', 'command', { isCommander: true })],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [tramplingCommander.id, tramplingCommander],
      [twinHealer.id, twinHealer],
      [venomCharger.id, venomCharger],
      [bearBlocker.id, bearBlocker],
      [wallBlocker.id, wallBlocker],
      [colossus.id, colossus],
      [observerCommander.id, observerCommander],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'combat',
    step: 'combat_damage',
    turnNumber: 6,
    hasPriorityPassed: [false, false, false, false],
    stack: [],
    combat: {
      attackers: [
        { cardInstanceId: 'complex_combat_commander_1', defendingPlayerId: 'ai-1' },
        { cardInstanceId: 'complex_combat_twin_healer_1', defendingPlayerId: 'ai-2' },
        { cardInstanceId: 'complex_combat_venom_charger_1', defendingPlayerId: 'ai-3' },
      ],
      blockers: [
        { cardInstanceId: 'complex_combat_bear_1', blockingAttackerId: 'complex_combat_commander_1' },
        { cardInstanceId: 'complex_combat_wall_1', blockingAttackerId: 'complex_combat_commander_1' },
        { cardInstanceId: 'complex_combat_colossus_1', blockingAttackerId: 'complex_combat_venom_charger_1' },
      ],
      blockersDeclared: true,
      blockersDeclaredBy: ['ai-1', 'ai-2', 'ai-3'],
      damageAssignment: new Map(),
    },
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  return serializeGameState(state);
}

export function createGenerousGiftQaState(): SerializedGameStateV1 {
  const generousGift = def(
    'generous_gift_qa',
    'Generous Gift',
    'Instant',
    '{2}{W}',
    'Destroy target permanent. Its controller creates a 3/3 green Elephant creature token.',
    { cmc: 3, colors: ['W'], color_identity: ['W'] },
  );
  const trainingCleric = def(
    'training_cleric_qa',
    'Training Cleric',
    'Legendary Creature - Human Cleric',
    '{2}{W}',
    '',
    { cmc: 3, colors: ['W'], color_identity: ['W'], power: 2, toughness: 2 },
  );
  const counteredCommander = def(
    'countered_commander_qa',
    'Countered Commander',
    'Legendary Creature - Human Soldier',
    '{1}{G}',
    '',
    { cmc: 2, colors: ['G'], color_identity: ['G'], power: 2, toughness: 2 },
  );

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Removal QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'training_cleric_1',
        commanderCastCount: 0,
        manaPool: { ...pool({ W: 1 }), C: 2 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Removal QA Opponent',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'countered_commander_1',
        commanderCastCount: 1,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['training_cleric_1', instance('training_cleric_1', trainingCleric.id, 'human', 'command', { isCommander: true })],
      ['generous_gift_1', instance('generous_gift_1', generousGift.id, 'human', 'hand')],
      ['countered_commander_1', instance('countered_commander_1', counteredCommander.id, 'ai-1', 'battlefield', {
        isCommander: true,
        counters: { '+1/+1': 1 },
      })],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [generousGift.id, generousGift],
      [trainingCleric.id, trainingCleric],
      [counteredCommander.id, counteredCommander],
    ]),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    turnNumber: 3,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  return serializeGameState(state);
}

export function createDeclareBlockersQaState(): SerializedGameStateV1 {
  const sisay = def(
    'sisay_blocker',
    'Sisay, Weatherlight Captain',
    'Legendary Creature - Human Soldier',
    '{2}{W}',
    "Sisay, Weatherlight Captain gets +1/+1 for each color among other legendary permanents you control.\n{W}{U}{B}{R}{G}, {T}: Search your library for a legendary permanent card with mana value less than Sisay, Weatherlight Captain's power, put that card onto the battlefield, then shuffle.",
    { cmc: 3, colors: ['W'], color_identity: ['W', 'U', 'B', 'R', 'G'], power: 2, toughness: 2 },
  );
  const bodyLaunderer = def(
    'body_launderer',
    'Body Launderer',
    'Creature - Ogre Rogue',
    '{2}{B}{B}',
    'Deathtouch\nWhenever another nontoken creature you control dies, Body Launderer connives.\nWhen Body Launderer dies, return another target non-Rogue creature card with equal or lesser power from your graveyard to the battlefield.',
    { cmc: 4, colors: ['B'], color_identity: ['B'], power: 3, toughness: 3, keywords: ['Deathtouch'] },
  );
  const marchesa = def(
    'marchesa_dealer',
    'Marchesa, Dealer of Death',
    'Legendary Creature - Human Rogue',
    '{1}{U}{B}{R}',
    'Whenever you commit a crime, you may pay {1}. If you do, draw a card.',
    { cmc: 4, colors: ['U', 'B', 'R'], color_identity: ['U', 'B', 'R'], power: 3, toughness: 4 },
  );

  const state: GameState = {
    players: [
      {
        id: 'human',
        name: 'Sisay QA Pilot',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'sisay_blocker_1',
        commanderCastCount: 1,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
      {
        id: 'ai-1',
        name: 'Marchesa, Dealer of Death',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: 'marchesa_dealer_1',
        commanderCastCount: 1,
        manaPool: pool(),
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
    ],
    cards: new Map<string, CardInstance>([
      ['sisay_blocker_1', instance('sisay_blocker_1', sisay.id, 'human', 'battlefield', { isCommander: true })],
      ['body_launderer_1', instance('body_launderer_1', bodyLaunderer.id, 'ai-1', 'battlefield', { tapped: true })],
      ['marchesa_dealer_1', instance('marchesa_dealer_1', marchesa.id, 'ai-1', 'battlefield', { isCommander: true })],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [sisay.id, sisay],
      [bodyLaunderer.id, bodyLaunderer],
      [marchesa.id, marchesa],
    ]),
    activePlayerIndex: 1,
    priorityPlayerIndex: 1,
    phase: 'combat',
    step: 'declare_blockers',
    turnNumber: 5,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: {
      attackers: [{ cardInstanceId: 'body_launderer_1', defendingPlayerId: 'human' }],
      blockers: [],
      blockersDeclared: false,
      blockersDeclaredBy: [],
      damageAssignment: new Map(),
    },
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  return serializeGameState(state);
}
