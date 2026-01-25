/**
 * End-to-End Save/Resume Test
 *
 * Tests the complete save/resume workflow including mid-game state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SaveManager, MemoryStorageAdapter, createSaveManager } from './manager';
import { GameState, createPlayer, Phase, Step, CardDefinition } from '../types';
import { castSpell, resolveTopOfStack } from '../stack';
import { initGrudgeTracking, recordDamage, GameStateWithGrudges } from '../ai/grudges';

// Helper to create a realistic game state
function createGameState(): GameState {
  const players = [
    { ...createPlayer('human', 'Human Player'), hasPriority: true, life: 35 },
    { ...createPlayer('ai1', 'AI Opponent 1'), hasPriority: false, life: 38 },
    { ...createPlayer('ai2', 'AI Opponent 2'), hasPriority: false, life: 40 },
  ];

  const state: GameState = {
    players,
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main' as Phase,
    step: 'upkeep' as Step,
    turnNumber: 8,
    hasPriorityPassed: [false, false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };

  // Add some cards
  addCard(state, 'forest1', 'human', 'battlefield', {
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    card_types: ['land'],
    mana_cost: '',
    cmc: 0,
  });

  addCard(state, 'forest2', 'human', 'battlefield', {
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    card_types: ['land'],
    mana_cost: '',
    cmc: 0,
  });

  addCard(state, 'bear1', 'human', 'battlefield', {
    name: 'Grizzly Bears',
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  }, { tapped: true, damage: 1 });

  addCard(state, 'bolt1', 'human', 'hand', {
    name: 'Lightning Bolt',
    card_types: ['instant'],
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  });

  addCard(state, 'giant1', 'ai1', 'battlefield', {
    name: 'Hill Giant',
    card_types: ['creature'],
    power: 3,
    toughness: 3,
  });

  // Set up commander tracking
  addCard(state, 'commander_human', 'human', 'command', {
    name: 'Human Commander',
    card_types: ['creature', 'legendary'],
    power: 4,
    toughness: 4,
  }, { isCommander: true });

  state.players[0].commanderInstanceId = 'commander_human';
  state.players[0].commanderCastCount = 1;
  state.players[1].commanderDamage = { commander_human: 8 };

  // Give human some mana
  state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 2, C: 0 };
  state.players[0].hasPlayedLand = true;

  return state;
}

function addCard(
  state: GameState,
  instanceId: string,
  ownerId: string,
  zone: 'hand' | 'battlefield' | 'library' | 'graveyard' | 'command' | 'stack',
  def: Partial<CardDefinition>,
  options: { tapped?: boolean; damage?: number; isCommander?: boolean } = {},
): void {
  const fullDef: CardDefinition = {
    id: def.id ?? instanceId,
    name: def.name ?? 'Test Card',
    type_line: def.type_line ?? 'Creature',
    oracle_text: def.oracle_text ?? '',
    mana_cost: def.mana_cost ?? '{1}{G}',
    cmc: def.cmc ?? 2,
    colors: def.colors ?? [],
    color_identity: def.color_identity ?? [],
    keywords: def.keywords ?? [],
    card_types: def.card_types ?? ['creature'],
    power: def.power,
    toughness: def.toughness,
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
  });
}

describe('End-to-End Save/Resume', () => {
  let manager: SaveManager;
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    manager = createSaveManager(storage);
  });

  it('saves and resumes mid-game state', async () => {
    // Create initial state
    const originalState = createGameState();

    // Save the game
    await manager.saveGame('test_slot', originalState, 'Mid-Game Save');

    // Load the game
    const loadedState = await manager.loadGame('test_slot');

    // Verify core state
    expect(loadedState).not.toBeNull();
    expect(loadedState!.turnNumber).toBe(8);
    expect(loadedState!.phase).toBe('precombat_main');
    expect(loadedState!.activePlayerIndex).toBe(0);

    // Verify players
    expect(loadedState!.players.length).toBe(3);
    expect(loadedState!.players[0].life).toBe(35);
    expect(loadedState!.players[0].hasPlayedLand).toBe(true);
    expect(loadedState!.players[0].manaPool.R).toBe(1);
    expect(loadedState!.players[0].manaPool.G).toBe(2);

    // Verify commander data
    expect(loadedState!.players[0].commanderInstanceId).toBe('commander_human');
    expect(loadedState!.players[0].commanderCastCount).toBe(1);
    expect(loadedState!.players[1].commanderDamage['commander_human']).toBe(8);

    // Verify cards
    expect(loadedState!.cards.size).toBe(6);

    const bear = loadedState!.cards.get('bear1');
    expect(bear).toBeDefined();
    expect(bear!.tapped).toBe(true);
    expect(bear!.damage).toBe(1);
    expect(bear!.zone).toBe('battlefield');

    const commander = loadedState!.cards.get('commander_human');
    expect(commander!.isCommander).toBe(true);
    expect(commander!.zone).toBe('command');

    // Verify definitions
    expect(loadedState!.cardDefinitions.size).toBe(6);
    const bearDef = loadedState!.cardDefinitions.get('bear1');
    expect(bearDef!.name).toBe('Grizzly Bears');
  });

  it('saves and resumes with spell on stack', async () => {
    const state = createGameState();

    // Put a spell on the stack
    state.stack.push({
      kind: 'Spell',
      id: 'stack_1',
      cardInstanceId: 'bolt1',
      casterId: 'human',
      targets: ['ai1'],
    });
    state.cards.get('bolt1')!.zone = 'stack';

    // Save
    await manager.saveGame('stack_test', state, 'Stack Save');

    // Load
    const loaded = await manager.loadGame('stack_test');

    // Verify stack
    expect(loaded!.stack.length).toBe(1);
    expect(loaded!.stack[0].kind).toBe('Spell');
    if (loaded!.stack[0].kind === 'Spell') {
      expect(loaded!.stack[0].cardInstanceId).toBe('bolt1');
      expect(loaded!.stack[0].targets).toEqual(['ai1']);
    }

    // Verify card zone
    expect(loaded!.cards.get('bolt1')!.zone).toBe('stack');
  });

  it('saves and resumes with combat state', async () => {
    const state = createGameState();

    // Set up combat
    state.phase = 'combat';
    state.step = 'declare_blockers';
    state.combat = {
      attackers: [
        { cardInstanceId: 'bear1', defendingPlayerId: 'ai1' },
      ],
      blockers: [
        { cardInstanceId: 'giant1', blockingAttackerId: 'bear1' },
      ],
      damageAssignment: new Map([['bear1', 2]]),
    };

    // Untap the bear for attack
    state.cards.get('bear1')!.tapped = false;

    // Save
    await manager.saveGame('combat_test', state, 'Combat Save');

    // Load
    const loaded = await manager.loadGame('combat_test');

    // Verify combat state
    expect(loaded!.combat).not.toBeNull();
    expect(loaded!.combat!.attackers.length).toBe(1);
    expect(loaded!.combat!.attackers[0].cardInstanceId).toBe('bear1');
    expect(loaded!.combat!.blockers.length).toBe(1);
    expect(loaded!.combat!.blockers[0].cardInstanceId).toBe('giant1');
    expect(loaded!.combat!.damageAssignment.get('bear1')).toBe(2);
  });

  it('saves and resumes with grudge tracking', async () => {
    let state = initGrudgeTracking(createGameState());

    // Record some damage
    state = recordDamage(state, 'ai1', 'human', 5);
    state = recordDamage(state, 'ai2', 'human', 3);

    // Save
    await manager.saveGame('grudge_test', state, 'Grudge Save');

    // Load
    const loaded = await manager.loadGame('grudge_test');

    // Verify grudge data
    expect('damageHistory' in loaded!).toBe(true);
    const history = (loaded as GameStateWithGrudges).damageHistory;
    expect(history.length).toBe(2);
    expect(history[0].sourcePlayerId).toBe('ai1');
    expect(history[0].amount).toBe(5);
  });

  it('can continue gameplay after resume', async () => {
    const state = createGameState();

    // Save
    await manager.saveGame('continue_test', state, 'Continue Save');

    // Load
    let loaded = await manager.loadGame('continue_test');
    expect(loaded).not.toBeNull();

    // The loaded state should be playable
    // For example, we could advance turns, cast spells, etc.
    // Here we just verify the state is valid for gameplay

    expect(loaded!.players[loaded!.activePlayerIndex].id).toBe('human');
    expect(loaded!.cards.get('bolt1')!.zone).toBe('hand');
    expect(loaded!.players[0].manaPool.R).toBe(1);
  });

  it('handles multiple save slots', async () => {
    const state1 = createGameState();
    state1.turnNumber = 5;

    const state2 = createGameState();
    state2.turnNumber = 15;

    const state3 = createGameState();
    state3.turnNumber = 25;

    // Save to different slots
    await manager.saveGame('slot_a', state1, 'Early Game');
    await manager.saveGame('slot_b', state2, 'Mid Game');
    await manager.saveGame('slot_c', state3, 'Late Game');

    // List saves
    const saves = await manager.listSaves();
    expect(saves.length).toBe(3);

    // Load specific saves
    const loadedA = await manager.loadGame('slot_a');
    const loadedB = await manager.loadGame('slot_b');
    const loadedC = await manager.loadGame('slot_c');

    expect(loadedA!.turnNumber).toBe(5);
    expect(loadedB!.turnNumber).toBe(15);
    expect(loadedC!.turnNumber).toBe(25);

    // Delete one
    await manager.deleteSave('slot_b');

    const savesAfterDelete = await manager.listSaves();
    expect(savesAfterDelete.length).toBe(2);
  });
});
