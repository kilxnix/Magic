import { describe, expect, it } from 'vitest';
import { createPlayer, type GameState } from '../types';
import { BrowserLocalStorageAdapter } from './local-storage';
import { createSaveManager } from './manager';

class FakeStorage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }
}

function state(): GameState {
  return {
    players: [createPlayer('p1', 'Pilot')],
    cards: new Map(),
    cardDefinitions: new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'draw',
    turnNumber: 7,
    hasPriorityPassed: [false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

describe('BrowserLocalStorageAdapter', () => {
  it('persists SaveManager saves outside the memory-only adapter', async () => {
    const adapter = new BrowserLocalStorageAdapter(new FakeStorage());
    const manager = createSaveManager(adapter);

    const metadata = await manager.saveGame('slot_1', state(), 'Practice Slot');
    expect(metadata.id).toBe('slot_1');
    expect(metadata.turnNumber).toBe(7);

    const saves = await manager.listSaves();
    expect(saves).toHaveLength(1);
    expect(saves[0].name).toBe('Practice Slot');

    const restored = await manager.loadGame('slot_1');
    expect(restored?.turnNumber).toBe(7);
    expect(restored?.players[0].name).toBe('Pilot');
  });
});
