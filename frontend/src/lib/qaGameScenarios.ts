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
