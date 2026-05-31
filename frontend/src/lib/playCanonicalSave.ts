import {
  createSaveGame,
  deserializeGameState,
  loadFromSaveGame,
  saveGameFromJson,
  saveGameToJson,
  serializeGameState,
  stateFingerprint,
  type SaveMetadata,
  type SerializedGameStateV1,
} from 'commander-engine';

export interface PlayCanonicalEngineSave {
  schema: 'commander-engine-save-v1';
  slotId: string;
  saveJson: string;
  metadata: SaveMetadata;
  fingerprint: string;
  createdAt: number;
}

export interface BuildCanonicalPlaySaveInput {
  slot: number;
  name: string;
  humanPlayerId: string;
  serializedState: SerializedGameStateV1;
  createdAt?: number;
}

export interface CanonicalPlaySaveAudit {
  ok: boolean;
  message: string;
  fingerprint?: string;
}

export function buildCanonicalPlayEngineSave(input: BuildCanonicalPlaySaveInput): PlayCanonicalEngineSave | undefined {
  try {
    const createdAt = input.createdAt || Date.now();
    const state = deserializeGameState(input.serializedState);
    const save = createSaveGame(state, input.name, input.humanPlayerId);
    const slotId = `play_slot_${input.slot}`;
    save.metadata.id = slotId;
    save.metadata.name = input.name;
    save.metadata.createdAt = new Date(createdAt).toISOString();
    save.metadata.updatedAt = new Date(createdAt).toISOString();

    return {
      schema: 'commander-engine-save-v1',
      slotId,
      saveJson: saveGameToJson(save),
      metadata: save.metadata,
      fingerprint: stateFingerprint(state),
      createdAt,
    };
  } catch {
    return undefined;
  }
}

export function auditCanonicalPlayEngineSave(payload: PlayCanonicalEngineSave | null | undefined): CanonicalPlaySaveAudit {
  if (!payload) {
    return { ok: false, message: 'Canonical save missing' };
  }

  try {
    const save = saveGameFromJson(payload.saveJson);
    const restored = loadFromSaveGame(save);
    const fingerprint = stateFingerprint(restored);
    if (fingerprint !== payload.fingerprint) {
      return {
        ok: false,
        message: 'Canonical save fingerprint mismatch',
        fingerprint,
      };
    }

    return {
      ok: true,
      message: 'Canonical save OK',
      fingerprint,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Canonical save failed',
    };
  }
}

export function restoreCanonicalPlayEngineState(payload: PlayCanonicalEngineSave | null | undefined): SerializedGameStateV1 | null {
  const audit = auditCanonicalPlayEngineSave(payload);
  if (!payload || !audit.ok) return null;

  try {
    const save = saveGameFromJson(payload.saveJson);
    const restored = loadFromSaveGame(save);
    return serializeGameState(restored);
  } catch {
    return null;
  }
}
