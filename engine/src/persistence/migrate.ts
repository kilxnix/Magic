/**
 * Save Migration Framework
 *
 * Handles upgrading old save formats to the current version.
 */

import type { SaveGame, SaveGameV1, SaveGameLatest } from './schema';
import { SAVE_VERSION } from './schema';

/**
 * Migration function type.
 */
type MigrationFn = (save: unknown) => unknown;

/**
 * Registry of migrations from version N to N+1.
 */
const migrations: Record<number, MigrationFn> = {
  // Example for future migrations:
  // 1: (save: SaveGameV1) => migrateV1ToV2(save),
};

/**
 * Check if a save needs migration.
 */
export function needsMigration(save: SaveGame): boolean {
  return save.version < SAVE_VERSION;
}

/**
 * Get the version of a save (or unknown data).
 */
export function getSaveVersion(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.version !== 'number') return null;
  return obj.version;
}

/**
 * Migrate a save to the latest version.
 *
 * @param save - Save game data (possibly old version)
 * @returns Migrated save game at latest version
 * @throws Error if migration fails or version is unsupported
 */
export function migrateSave(save: SaveGame): SaveGameLatest {
  let current: unknown = save;
  let version = getSaveVersion(current);

  if (version === null) {
    throw new Error('Cannot migrate: invalid save format');
  }

  if (version > SAVE_VERSION) {
    throw new Error(`Cannot migrate: save version ${version} is newer than supported ${SAVE_VERSION}`);
  }

  // Apply migrations sequentially
  while (version < SAVE_VERSION) {
    const migrateFn = migrations[version];
    if (!migrateFn) {
      throw new Error(`No migration path from version ${version} to ${version + 1}`);
    }

    current = migrateFn(current);
    version = getSaveVersion(current);

    if (version === null) {
      throw new Error('Migration produced invalid save');
    }
  }

  return current as SaveGameLatest;
}

/**
 * Try to migrate a save, returning null on failure.
 */
export function tryMigrateSave(save: unknown): SaveGameLatest | null {
  try {
    const version = getSaveVersion(save);
    if (version === null) return null;

    return migrateSave(save as SaveGame);
  } catch {
    return null;
  }
}

/**
 * Check if data is a valid save game (any version).
 */
export function isValidSave(data: unknown): data is SaveGame {
  const version = getSaveVersion(data);
  if (version === null) return false;
  if (version < 1 || version > SAVE_VERSION) return false;

  const obj = data as Record<string, unknown>;
  return (
    typeof obj.metadata === 'object' &&
    obj.metadata !== null &&
    typeof obj.state === 'object' &&
    obj.state !== null
  );
}

/**
 * Parse JSON and migrate if needed.
 */
export function parseAndMigrateSave(json: string): SaveGameLatest {
  const parsed = JSON.parse(json);

  if (!isValidSave(parsed)) {
    throw new Error('Invalid save game format');
  }

  if (needsMigration(parsed)) {
    return migrateSave(parsed);
  }

  return parsed as SaveGameLatest;
}

// Export for testing
export { migrations as _migrations };
