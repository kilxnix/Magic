import { describe, it, expect, beforeEach } from 'vitest';
import { SaveManager, MemoryStorageAdapter, createSaveManager } from './manager';
import { GameState, createPlayer, Phase, Step, CardDefinition } from '../types';

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
  zone: 'hand' | 'battlefield',
  def: Partial<CardDefinition>,
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
  };

  state.cardDefinitions.set(fullDef.id, fullDef);
  state.cards.set(instanceId, {
    instanceId,
    definitionId: fullDef.id,
    ownerId,
    zone,
    tapped: false,
    summoningSick: zone === 'battlefield',
    counters: {},
    damage: 0,
    isCommander: false,
  });
}

describe('MemoryStorageAdapter', () => {
  it('stores and retrieves values', () => {
    const storage = new MemoryStorageAdapter();

    storage.set('key1', 'value1');
    expect(storage.get('key1')).toBe('value1');
  });

  it('returns null for missing keys', () => {
    const storage = new MemoryStorageAdapter();
    expect(storage.get('nonexistent')).toBeNull();
  });

  it('removes values', () => {
    const storage = new MemoryStorageAdapter();

    storage.set('key1', 'value1');
    storage.remove('key1');
    expect(storage.get('key1')).toBeNull();
  });

  it('lists keys with prefix', () => {
    const storage = new MemoryStorageAdapter();

    storage.set('prefix_a', '1');
    storage.set('prefix_b', '2');
    storage.set('other_c', '3');

    const keys = storage.keys('prefix_');
    expect(keys).toHaveLength(2);
    expect(keys).toContain('prefix_a');
    expect(keys).toContain('prefix_b');
  });
});

describe('SaveManager', () => {
  let manager: SaveManager;
  let storage: MemoryStorageAdapter;

  beforeEach(() => {
    storage = new MemoryStorageAdapter();
    manager = createSaveManager(storage);
  });

  describe('saveGame / loadGame', () => {
    it('saves and loads a game', async () => {
      const state = createTestState();
      state.turnNumber = 10;
      state.players[0].life = 35;

      await manager.saveGame('slot1', state, 'My Save');
      const loaded = await manager.loadGame('slot1');

      expect(loaded).not.toBeNull();
      expect(loaded!.turnNumber).toBe(10);
      expect(loaded!.players[0].life).toBe(35);
    });

    it('saves and loads cards', async () => {
      const state = createTestState();
      addCard(state, 'bear1', 'p1', 'battlefield', { name: 'Grizzly Bears' });

      await manager.saveGame('slot1', state, 'Save with cards');
      const loaded = await manager.loadGame('slot1');

      expect(loaded).not.toBeNull();
      expect(loaded!.cards.has('bear1')).toBe(true);
      expect(loaded!.cards.get('bear1')!.zone).toBe('battlefield');
    });

    it('returns null for nonexistent slot', async () => {
      const loaded = await manager.loadGame('nonexistent');
      expect(loaded).toBeNull();
    });

    it('updates existing save', async () => {
      const state1 = createTestState();
      state1.turnNumber = 5;
      await manager.saveGame('slot1', state1, 'Original');

      const state2 = createTestState();
      state2.turnNumber = 15;
      await manager.saveGame('slot1', state2);

      const loaded = await manager.loadGame('slot1');
      expect(loaded!.turnNumber).toBe(15);

      // Name should be preserved
      const meta = await manager.getMetadata('slot1');
      expect(meta!.name).toBe('Original');
    });
  });

  describe('getMetadata', () => {
    it('returns metadata for saved game', async () => {
      const state = createTestState();
      state.turnNumber = 7;

      await manager.saveGame('slot1', state, 'Test Game');
      const meta = await manager.getMetadata('slot1');

      expect(meta).not.toBeNull();
      expect(meta!.name).toBe('Test Game');
      expect(meta!.turnNumber).toBe(7);
      expect(meta!.playerCount).toBe(2);
    });

    it('returns null for nonexistent slot', async () => {
      const meta = await manager.getMetadata('nonexistent');
      expect(meta).toBeNull();
    });
  });

  describe('listSaves', () => {
    it('lists all saves sorted by date', async () => {
      const state = createTestState();

      await manager.saveGame('slot1', state, 'Save 1');
      // Small delay to ensure different timestamps
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.saveGame('slot2', state, 'Save 2');
      await new Promise(resolve => setTimeout(resolve, 10));
      await manager.saveGame('slot3', state, 'Save 3');

      const saves = await manager.listSaves();

      expect(saves).toHaveLength(3);
      expect(saves[0].name).toBe('Save 3'); // Most recent first
      expect(saves[2].name).toBe('Save 1'); // Oldest last
    });

    it('returns empty array when no saves', async () => {
      const saves = await manager.listSaves();
      expect(saves).toEqual([]);
    });
  });

  describe('deleteSave', () => {
    it('deletes existing save', async () => {
      const state = createTestState();
      await manager.saveGame('slot1', state, 'To Delete');

      const result = await manager.deleteSave('slot1');

      expect(result).toBe(true);
      expect(await manager.loadGame('slot1')).toBeNull();
      expect(await manager.getMetadata('slot1')).toBeNull();
    });

    it('returns false for nonexistent slot', async () => {
      const result = await manager.deleteSave('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('hasSave', () => {
    it('returns true for existing save', async () => {
      const state = createTestState();
      await manager.saveGame('slot1', state, 'Exists');

      expect(await manager.hasSave('slot1')).toBe(true);
    });

    it('returns false for nonexistent save', async () => {
      expect(await manager.hasSave('nonexistent')).toBe(false);
    });
  });

  describe('quickSave / quickLoad', () => {
    it('quick saves to default slot', async () => {
      const state = createTestState();
      state.turnNumber = 20;

      await manager.quickSave(state);
      const loaded = await manager.quickLoad();

      expect(loaded).not.toBeNull();
      expect(loaded!.turnNumber).toBe(20);
    });

    it('quick load returns null when no quick save', async () => {
      const loaded = await manager.quickLoad();
      expect(loaded).toBeNull();
    });
  });

  describe('autoSave', () => {
    it('auto saves to rotating slots', async () => {
      const state1 = createTestState();
      state1.turnNumber = 1;
      const state2 = createTestState();
      state2.turnNumber = 2;
      const state3 = createTestState();
      state3.turnNumber = 3;
      const state4 = createTestState();
      state4.turnNumber = 4;
      const state5 = createTestState();
      state5.turnNumber = 5;

      await manager.autoSave(state1, 0); // autosave_0
      await manager.autoSave(state2, 1); // autosave_1
      await manager.autoSave(state3, 2); // autosave_2
      await manager.autoSave(state4, 3); // autosave_3
      await manager.autoSave(state5, 4); // autosave_0 (overwrites)

      const slot0 = await manager.loadGame('autosave_0');
      const slot1 = await manager.loadGame('autosave_1');
      const slot2 = await manager.loadGame('autosave_2');
      const slot3 = await manager.loadGame('autosave_3');

      expect(slot0!.turnNumber).toBe(5); // Overwritten after four slots
      expect(slot1!.turnNumber).toBe(2);
      expect(slot2!.turnNumber).toBe(3);
      expect(slot3!.turnNumber).toBe(4);
    });
  });

  describe('createSlotId', () => {
    it('generates unique IDs', () => {
      const id1 = manager.createSlotId();
      const id2 = manager.createSlotId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^save_/);
    });
  });
});
