// Test fixtures matching the REAL shapes from useShelectorGame:
//   SimpleCard (:201), SimplePlayer (:222), SimpleGameState (:247),
//   SimpleLegalAction (:283). Only the fields the selectors read need realistic
//   values; the rest get harmless defaults.
import type {
  SimpleCard,
  SimplePlayer,
  SimpleGameState,
  SimpleLegalAction,
} from '../../../src/hooks/useShelectorGame';

let cardSeq = 0;

export function makeCard(overrides: Partial<SimpleCard> = {}): SimpleCard {
  const id = overrides.instanceId ?? `card-${++cardSeq}`;
  return {
    instanceId: id,
    name: 'Test Card',
    manaCost: '',
    typeLine: '',
    oracleText: '',
    keywords: [],
    tapped: false,
    zone: 'battlefield',
    ownerId: 'human',
    cardTypes: [],
    isCommander: false,
    counters: {},
    damage: 0,
    isToken: false,
    ...overrides,
  };
}

export function makeCreature(overrides: Partial<SimpleCard> = {}): SimpleCard {
  return makeCard({
    name: 'Grizzly Bears',
    typeLine: 'Creature — Bear',
    cardTypes: ['creature'],
    power: 2,
    toughness: 2,
    ...overrides,
  });
}

export function makeLand(overrides: Partial<SimpleCard> = {}): SimpleCard {
  return makeCard({
    name: 'Forest',
    typeLine: 'Basic Land — Forest',
    oracleText: '({T}: Add {G}.)',
    cardTypes: ['land'],
    ...overrides,
  });
}

export function makePlayer(overrides: Partial<SimplePlayer> = {}): SimplePlayer {
  return {
    id: 'human',
    name: 'You',
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    playerCounters: {},
    handCount: 0,
    libraryCount: 99,
    ...overrides,
  };
}

type StackEntry = SimpleGameState['stack'][number];

export function makeStackItem(overrides: Partial<StackEntry> = {}): StackEntry {
  return {
    id: `stack-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'Spell',
    name: 'Lightning Bolt',
    casterId: 'human',
    targetNames: [],
    ...overrides,
  };
}

export function makeLegalAction(overrides: Partial<SimpleLegalAction> = {}): SimpleLegalAction {
  const kind = overrides.kind ?? 'PassPriority';
  return {
    kind,
    label: overrides.label ?? kind,
    // _engineAction.kind must mirror the SimpleLegalAction.kind for the selectors
    // that key off the engine action (e.g. the synthetic pass detection).
    _engineAction: ({ kind } as unknown) as SimpleLegalAction['_engineAction'],
    ...overrides,
  };
}

export function makeState(overrides: Partial<SimpleGameState> = {}): SimpleGameState {
  const human = overrides.humanPlayer ?? makePlayer();
  const firstAi =
    overrides.aiPlayers?.[0] ??
    makePlayer({ id: 'ai1', name: 'AI One', life: 40 });
  return {
    turnNumber: 1,
    phase: 'precombat_main',
    step: 'main',
    activePlayerId: 'human',
    priorityPlayerId: 'human',
    humanPlayer: human,
    humanCommander: 'Some Commander',
    humanHand: [],
    humanBattlefield: [],
    humanGraveyard: [],
    humanCommandZone: [],
    stack: [],
    gameOver: false,
    winnerId: null,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    diceRolls: [],
    lastDiceRoll: null,
    aiPlayers: [firstAi],
    aiHands: {},
    aiBattlefields: {},
    aiGraveyards: {},
    aiCommandZones: {},
    aiCommanderNames: { ai1: 'AI One' },
    aiPlayer: firstAi,
    aiCommander: 'AI One',
    aiHand: [],
    aiBattlefield: [],
    aiGraveyard: [],
    aiCommandZone: [],
    ...overrides,
  };
}
