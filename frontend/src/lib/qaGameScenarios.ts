import {
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
      ['scalding_tarn_board_1', instance('scalding_tarn_board_1', scaldingTarn.id, 'human', 'battlefield')],
      ['steam_vents_library_1', instance('steam_vents_library_1', steamVents.id, 'human', 'library')],
      ['island_library_1', instance('island_library_1', island.id, 'human', 'library')],
      ['forest_library_1', instance('forest_library_1', forest.id, 'human', 'library')],
      ['arcane_signet_library_1', instance('arcane_signet_library_1', arcaneSignet.id, 'human', 'library')],
    ]),
    cardDefinitions: new Map<string, CardDefinition>([
      [commander.id, commander],
      [stompingGround.id, stompingGround],
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
