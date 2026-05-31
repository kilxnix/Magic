/**
 * Persistence Module
 *
 * Save and load Commander game state.
 */

// Schema
export {
  SAVE_VERSION,
  generateSaveId,
  createSaveMetadata,
  updateSaveMetadata,
} from './schema';

export type {
  SaveMetadata,
  SerializedPlayerV1,
  SerializedCardInstanceV1,
  SerializedCardDefinitionV1,
  SerializedStackItemV1,
  SerializedCombatStateV1,
  SerializedDamageRecordV1,
  SerializedGameStateV1,
  SaveGameV1,
  SaveGame,
  SaveGameLatest,
} from './schema';

// Serialization
export {
  serializeGameState,
  deserializeGameState,
  createSaveGame,
  loadFromSaveGame,
  saveGameToJson,
  saveGameFromJson,
} from './serialize';

// Manager
export {
  SaveManager,
  MemoryStorageAdapter,
  createSaveManager,
} from './manager';

export type { StorageAdapter } from './manager';

export {
  BrowserLocalStorageAdapter,
} from './local-storage';

export type { KeyValueStorageLike } from './local-storage';

// Migration
export {
  needsMigration,
  getSaveVersion,
  migrateSave,
  tryMigrateSave,
  isValidSave,
  parseAndMigrateSave,
} from './migrate';
