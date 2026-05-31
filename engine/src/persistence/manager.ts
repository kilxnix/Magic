/**
 * Save Slot Manager
 *
 * Manages save game slots using a pluggable storage adapter.
 */

import { GameState } from '../types';
import type { SaveGameV1, SaveMetadata } from './schema';
import { createSaveGame, loadFromSaveGame, saveGameToJson, saveGameFromJson } from './serialize';
import { updateSaveMetadata, generateSaveId } from './schema';

/**
 * Storage adapter interface.
 * Implementations can use localStorage, AsyncStorage, SQLite, etc.
 */
export interface StorageAdapter {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
  keys(prefix: string): string[] | Promise<string[]>;
}

/**
 * In-memory storage adapter for testing.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private store: Map<string, string> = new Map();

  get(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  remove(key: string): void {
    this.store.delete(key);
  }

  keys(prefix: string): string[] {
    return Array.from(this.store.keys()).filter(k => k.startsWith(prefix));
  }

  clear(): void {
    this.store.clear();
  }
}

const SAVE_KEY_PREFIX = 'mtg_save_';
const METADATA_KEY_PREFIX = 'mtg_meta_';
const AUTOSAVE_SLOT_COUNT = 4;

/**
 * Save game manager.
 */
export class SaveManager {
  constructor(private storage: StorageAdapter) {}

  /**
   * Save a game to a slot.
   */
  async saveGame(slotId: string, state: GameState, name?: string, humanPlayerId: string = 'p1'): Promise<SaveMetadata> {
    const existingMeta = await this.getMetadata(slotId);

    let save: SaveGameV1;
    if (existingMeta) {
      // Update existing save
      save = createSaveGame(state, existingMeta.name, humanPlayerId);
      save.metadata = updateSaveMetadata({
        ...existingMeta,
        turnNumber: state.turnNumber,
      });
    } else {
      // New save
      save = createSaveGame(state, name ?? `Save ${slotId}`, humanPlayerId);
      save.metadata.id = slotId;
    }

    const json = saveGameToJson(save);
    await this.storage.set(SAVE_KEY_PREFIX + slotId, json);
    await this.storage.set(METADATA_KEY_PREFIX + slotId, JSON.stringify(save.metadata));

    return save.metadata;
  }

  /**
   * Load a game from a slot.
   */
  async loadGame(slotId: string): Promise<GameState | null> {
    const json = await this.storage.get(SAVE_KEY_PREFIX + slotId);
    if (!json) return null;

    const save = saveGameFromJson(json);
    return loadFromSaveGame(save);
  }

  /**
   * Get metadata for a save slot.
   */
  async getMetadata(slotId: string): Promise<SaveMetadata | null> {
    const json = await this.storage.get(METADATA_KEY_PREFIX + slotId);
    if (!json) return null;

    try {
      return JSON.parse(json) as SaveMetadata;
    } catch {
      return null;
    }
  }

  /**
   * List all saved games.
   */
  async listSaves(): Promise<SaveMetadata[]> {
    const keys = await this.storage.keys(METADATA_KEY_PREFIX);
    const saves: SaveMetadata[] = [];

    for (const key of keys) {
      const json = await this.storage.get(key);
      if (json) {
        try {
          saves.push(JSON.parse(json) as SaveMetadata);
        } catch {
          // Skip invalid metadata
        }
      }
    }

    // Sort by updated date descending
    return saves.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  /**
   * Delete a saved game.
   */
  async deleteSave(slotId: string): Promise<boolean> {
    const exists = await this.storage.get(SAVE_KEY_PREFIX + slotId);
    if (!exists) return false;

    await this.storage.remove(SAVE_KEY_PREFIX + slotId);
    await this.storage.remove(METADATA_KEY_PREFIX + slotId);
    return true;
  }

  /**
   * Check if a save exists.
   */
  async hasSave(slotId: string): Promise<boolean> {
    const json = await this.storage.get(SAVE_KEY_PREFIX + slotId);
    return json !== null;
  }

  /**
   * Create a new save slot ID.
   */
  createSlotId(): string {
    return generateSaveId();
  }

  /**
   * Quick save to a default slot.
   */
  async quickSave(state: GameState): Promise<SaveMetadata> {
    return this.saveGame('quicksave', state, 'Quick Save');
  }

  /**
   * Quick load from the default slot.
   */
  async quickLoad(): Promise<GameState | null> {
    return this.loadGame('quicksave');
  }

  /**
   * Auto-save to a rotating slot.
   */
  async autoSave(state: GameState, slotIndex: number = 0): Promise<SaveMetadata> {
    const slotId = `autosave_${slotIndex % AUTOSAVE_SLOT_COUNT}`;
    return this.saveGame(slotId, state, `Auto Save ${slotIndex + 1}`);
  }
}

/**
 * Create a save manager with the given storage adapter.
 */
export function createSaveManager(storage: StorageAdapter): SaveManager {
  return new SaveManager(storage);
}
