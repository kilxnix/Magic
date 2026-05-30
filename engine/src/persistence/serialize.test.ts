import { describe, it, expect } from 'vitest';
import {
  serializeGameState,
  deserializeGameState,
  createSaveGame,
  loadFromSaveGame,
  saveGameToJson,
  saveGameFromJson,
} from './serialize';
import { SAVE_VERSION } from './schema';
import { GameState, createPlayer, Phase, Step, CardDefinition, CardInstance } from '../types';
import { initGrudgeTracking, recordDamage } from '../ai/grudges';

// Helper to create minimal game state
function createTestState(playerCount: number = 2): GameState {
  const players = [];
  for (let i = 1; i <= playerCount; i++) {
    players.push({ ...createPlayer(`p${i}`, `Player ${i}`), hasPriority: i === 1 });
  }

  return {
    players,
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'upkeep' as Step,
    turnNumber: 5,
    hasPriorityPassed: players.map(() => false),
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// Helper to add a card
function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command' | 'stack',
  def: Partial<CardDefinition>,
  options: { tapped?: boolean; isCommander?: boolean; damage?: number; choices?: CardInstance['choices']; activeFaceName?: string } = {},
): void {
  const fullDef: CardDefinition = {
    id: def.id ?? instanceId,
    name: def.name ?? 'Test Card',
    type_line: def.type_line ?? 'Creature',
    oracle_text: def.oracle_text ?? '',
    mana_cost: def.mana_cost ?? '{1}{G}',
    cmc: def.cmc ?? 2,
    colors: def.colors ?? ['G'],
    color_identity: def.color_identity ?? ['G'],
    keywords: def.keywords ?? [],
    card_types: def.card_types ?? ['creature'],
    power: def.power ?? 2,
    toughness: def.toughness ?? 2,
    faces: def.faces,
  };

  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: options.tapped ?? false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: options.damage ?? 0,
    isCommander: options.isCommander ?? false,
    choices: options.choices,
    activeFaceName: options.activeFaceName,
  });
}

describe('serializeGameState / deserializeGameState', () => {
  it('round-trips empty state correctly', () => {
    const state = createTestState();

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.players.length).toBe(state.players.length);
    expect(deserialized.turnNumber).toBe(state.turnNumber);
    expect(deserialized.phase).toBe(state.phase);
    expect(deserialized.step).toBe(state.step);
  });

  it('round-trips player data correctly', () => {
    const state = createTestState();
    state.players[0].life = 35;
    state.players[0].hasPlayedLand = true;
    state.players[0].manaPool = { W: 1, U: 0, B: 0, R: 0, G: 2, C: 0 };
    state.players[1].hasLost = true;

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.players[0].life).toBe(35);
    expect(deserialized.players[0].hasPlayedLand).toBe(true);
    expect(deserialized.players[0].manaPool.G).toBe(2);
    expect(deserialized.players[1].hasLost).toBe(true);
  });

  it('round-trips cards correctly', () => {
    const state = createTestState();

    addCard(state, 'bear1', 'p1', 'battlefield', {
      name: 'Grizzly Bears',
      power: 2,
      toughness: 2,
    }, { tapped: true, damage: 1 });

    addCard(state, 'forest1', 'p1', 'battlefield', {
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.cards.size).toBe(2);

    const bear = deserialized.cards.get('bear1');
    expect(bear).toBeDefined();
    expect(bear!.tapped).toBe(true);
    expect(bear!.damage).toBe(1);
    expect(bear!.zone).toBe('battlefield');

    const forest = deserialized.cards.get('forest1');
    expect(forest).toBeDefined();
    expect(forest!.zone).toBe('battlefield');
  });

  it('round-trips card definitions correctly', () => {
    const state = createTestState();

    addCard(state, 'bear1', 'p1', 'hand', {
      name: 'Grizzly Bears',
      mana_cost: '{1}{G}',
      cmc: 2,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      power: 2,
      toughness: 2,
    });

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    const def = deserialized.cardDefinitions.get('bear1');
    expect(def).toBeDefined();
    expect(def!.name).toBe('Grizzly Bears');
    expect(def!.mana_cost).toBe('{1}{G}');
    expect(def!.power).toBe(2);
  });

  it('round-trips stack items correctly', () => {
    const state = createTestState();

    addCard(state, 'spell1', 'p1', 'stack', {
      name: 'Lightning Bolt',
      card_types: ['instant'],
    });

    state.stack.push({
      kind: 'Spell',
      id: 'stack_1',
      cardInstanceId: 'spell1',
      casterId: 'p1',
      targets: ['p2'],
    });

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.stack.length).toBe(1);
    expect(deserialized.stack[0].kind).toBe('Spell');
    if (deserialized.stack[0].kind === 'Spell') {
      expect(deserialized.stack[0].targets).toEqual(['p2']);
    }
  });

  it('round-trips combat state correctly', () => {
    const state = createTestState();

    addCard(state, 'attacker1', 'p1', 'battlefield', {
      name: 'Bear',
      card_types: ['creature'],
    });

    state.combat = {
      attackers: [{ cardInstanceId: 'attacker1', defendingPlayerId: 'p2' }],
      blockers: [],
      damageAssignment: new Map([['attacker1', 2]]),
    };

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.combat).not.toBeNull();
    expect(deserialized.combat!.attackers.length).toBe(1);
    expect(deserialized.combat!.damageAssignment.get('attacker1')).toBe(2);
  });

  it('round-trips grudge data correctly', () => {
    let state = initGrudgeTracking(createTestState());
    state = recordDamage(state, 'p2', 'p1', 10);
    state = recordDamage(state, 'p2', 'p1', 5);

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect('damageHistory' in deserialized).toBe(true);
    const history = (deserialized as any).damageHistory;
    expect(history.length).toBe(2);
    expect(history[0].amount).toBe(10);
  });

  it('preserves commander data', () => {
    const state = createTestState();

    addCard(state, 'commander1', 'p1', 'command', {
      name: 'Test Commander',
      card_types: ['creature'],
    }, { isCommander: true });

    state.players[0].commanderInstanceId = 'commander1';
    state.players[0].commanderInstanceIds = ['commander1', 'commander2'];
    state.players[0].commanderCastCount = 2;
    state.players[0].commanderCastCounts = { commander1: 2, commander2: 1 };
    state.players[0].commanderTax = 4;
    state.players[1].commanderDamage = { commander1: 15 };

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.players[0].commanderInstanceId).toBe('commander1');
    expect(deserialized.players[0].commanderInstanceIds).toEqual(['commander1', 'commander2']);
    expect(deserialized.players[0].commanderCastCount).toBe(2);
    expect(deserialized.players[0].commanderCastCounts).toEqual({ commander1: 2, commander2: 1 });
    expect(deserialized.players[0].commanderTax).toBe(4);
    expect(deserialized.players[1].commanderDamage['commander1']).toBe(15);

    const cmd = deserialized.cards.get('commander1');
    expect(cmd!.isCommander).toBe(true);
    expect(cmd!.zone).toBe('command');
  });

  it('round-trips permanent choices and restricted mana metadata', () => {
    const state = createTestState();
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
    state.players[0].restrictedMana = [
      {
        color: 'G',
        amount: 1,
        restriction: 'creatureTypeSpell',
        creatureType: 'Elf',
        sourceInstanceId: 'cavern1',
      },
    ];

    addCard(state, 'cavern1', 'p1', 'battlefield', {
      name: 'Cavern of Souls',
      type_line: 'Land',
      card_types: ['land'],
      oracle_text: 'As Cavern of Souls enters, choose a creature type.',
    }, { choices: { chosenCreatureType: 'Elf' } });

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);

    expect(deserialized.cards.get('cavern1')?.choices).toEqual({ chosenCreatureType: 'Elf' });
    expect(deserialized.players[0].restrictedMana).toEqual([
      {
        color: 'G',
        amount: 1,
        restriction: 'creatureTypeSpell',
        creatureType: 'Elf',
        sourceInstanceId: 'cavern1',
      },
    ]);
  });

  it('round-trips multi-face definitions, active permanent faces, and split-face stack choices', () => {
    const state = createTestState();
    addCard(state, 'modal1', 'p1', 'battlefield', {
      id: 'modal-def',
      name: 'Front // Back',
      type_line: 'Creature // Artifact',
      oracle_text: 'Front text',
      card_types: ['creature'],
      faces: [
        {
          id: 'modal-def:face:0',
          name: 'Front',
          type_line: 'Creature',
          oracle_text: 'Front text',
          mana_cost: '{1}{G}',
          cmc: 2,
          colors: ['G'],
          keywords: [],
          card_types: ['creature'],
          power: 2,
          toughness: 2,
        },
        {
          id: 'modal-def:face:1',
          name: 'Back',
          type_line: 'Artifact',
          oracle_text: 'Back text',
          mana_cost: '{2}',
          cmc: 2,
          colors: [],
          keywords: [],
          card_types: ['artifact'],
        },
      ],
    }, { activeFaceName: 'Back' });
    state.stack.push({
      kind: 'Spell',
      id: 'stack-modal',
      cardInstanceId: 'modal1',
      casterId: 'p1',
      targets: [],
      faceName: 'Back',
      xValue: 2,
    });

    const serialized = serializeGameState(state);
    const deserialized = deserializeGameState(serialized);
    const def = deserialized.cardDefinitions.get('modal-def');
    expect(def?.faces?.map(face => face.name)).toEqual(['Front', 'Back']);
    expect(deserialized.cards.get('modal1')?.activeFaceName).toBe('Back');
    expect(deserialized.stack[0]).toMatchObject({ kind: 'Spell', faceName: 'Back', xValue: 2 });
  });
});

describe('createSaveGame / loadFromSaveGame', () => {
  it('creates save with correct version', () => {
    const state = createTestState();
    const save = createSaveGame(state, 'Test Save', 'p1');

    expect(save.version).toBe(SAVE_VERSION);
  });

  it('creates save with metadata', () => {
    const state = createTestState();
    state.turnNumber = 10;

    const save = createSaveGame(state, 'My Game', 'p1');

    expect(save.metadata.name).toBe('My Game');
    expect(save.metadata.turnNumber).toBe(10);
    expect(save.metadata.playerCount).toBe(2);
    expect(save.metadata.humanPlayerName).toBe('Player 1');
    expect(save.metadata.id).toMatch(/^save_/);
    expect(save.metadata.createdAt).toBeDefined();
  });

  it('loads state from save', () => {
    const state = createTestState();
    state.turnNumber = 15;
    state.players[0].life = 25;

    const save = createSaveGame(state, 'Test', 'p1');
    const loaded = loadFromSaveGame(save);

    expect(loaded.turnNumber).toBe(15);
    expect(loaded.players[0].life).toBe(25);
  });
});

describe('saveGameToJson / saveGameFromJson', () => {
  it('round-trips through JSON string', () => {
    const state = createTestState();
    addCard(state, 'bear1', 'p1', 'battlefield', { name: 'Bear' });

    const save = createSaveGame(state, 'JSON Test', 'p1');
    const json = saveGameToJson(save);
    const parsed = saveGameFromJson(json);

    expect(parsed.version).toBe(SAVE_VERSION);
    expect(parsed.metadata.name).toBe('JSON Test');

    const loaded = loadFromSaveGame(parsed);
    expect(loaded.cards.has('bear1')).toBe(true);
  });

  it('throws on invalid JSON', () => {
    expect(() => saveGameFromJson('not json')).toThrow();
  });

  it('throws on missing version', () => {
    const badSave = JSON.stringify({ metadata: {}, state: {} });
    expect(() => saveGameFromJson(badSave)).toThrow('missing version');
  });

  it('throws on wrong version', () => {
    const badSave = JSON.stringify({ version: 999, metadata: {}, state: {} });
    expect(() => saveGameFromJson(badSave)).toThrow('Unsupported save version');
  });
});
