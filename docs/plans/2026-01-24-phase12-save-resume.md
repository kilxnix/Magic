# Phase 12: Save/Resume — Implementation Plan

**Goal:** Serialize and persist full Commander game state locally and restore it reliably (mid-stack, mid-turn).

**Scope:**
- JSON serialization of `GameState`
- Local storage adapter (AsyncStorage or SQLite)
- Save slots + metadata
- Versioning + migrations
- Load tests to ensure determinism

**Depends on:** A relatively stable `GameState` schema from Phases 1–11.

---

## Task 1: Define Persistence Schema (Versioned)

**Files:**
- Create: `engine/src/persistence/schema.ts`
- Create: `engine/src/persistence/schema.test.ts`

**Design:**
- `export const SAVE_VERSION = 1` (increment on breaking changes)
- `export interface SaveGameV1 { version: 1; createdAt: string; updatedAt: string; state: SerializedGameStateV1 }`

**Commit:**
```bash
git add engine/src/persistence/schema.ts engine/src/persistence/schema.test.ts
git commit -m "feat(engine): add versioned save schema"
```

---

## Task 2: Serialize/Deserialize GameState

**Files:**
- Create: `engine/src/persistence/serialize.ts`
- Create: `engine/src/persistence/serialize.test.ts`

**Challenges:**
- Maps (e.g., `cards: Map`, `cardDefinitions: Map`, `battlefieldAbilities: Map`)
- Deterministic ordering

**Approach:**
- Convert Maps to arrays of `[key, value]`
- Use stable sorting when needed

**Tests:**
- Round-trip equality (serialize then deserialize gives equivalent state)

**Commit:**
```bash
git add engine/src/persistence/serialize.ts engine/src/persistence/serialize.test.ts
git commit -m "feat(engine): implement GameState serialization"
```

---

## Task 3: Save Slot Manager (Engine-side)

**Files:**
- Create: `engine/src/persistence/manager.ts`
- Create: `engine/src/persistence/manager.test.ts`

**API:**
- `saveGame(slotId, state)`
- `loadGame(slotId)`
- `listSaves()`
- `deleteSave(slotId)`

Engine should not pick storage; it exposes a storage interface:
- `StorageAdapter { get(key): string|null; set(key, value): void; remove(key): void; keys(prefix): string[] }`

**Commit:**
```bash
git add engine/src/persistence/manager.ts engine/src/persistence/manager.test.ts
git commit -m "feat(engine): add save slot manager"
```

---

## Task 4: Mobile Storage Adapter + UI

**Files:**
- Create: `frontend/mobile/src/persistence/adapter.ts`
- Create: `frontend/mobile/src/screens/LoadGameScreen.tsx`
- Create: `frontend/mobile/src/screens/SaveGameModal.tsx`

**Behavior:**
- Save button opens modal (choose slot name)
- Load screen lists saves + timestamps

**Commit:**
```bash
git add frontend/mobile/src/persistence frontend/mobile/src/screens
git commit -m "feat(mobile): add save/load UI and storage adapter"
```

---

## Task 5: Migration Framework

**Files:**
- Create: `engine/src/persistence/migrate.ts`
- Create: `engine/src/persistence/migrate.test.ts`

**Behavior:**
- `migrateSave(json): SaveGameLatest`
- For now, implement identity v1->v1

**Commit:**
```bash
git add engine/src/persistence/migrate.ts engine/src/persistence/migrate.test.ts
git commit -m "feat(engine): add save migration framework"
```

---

## Task 6: End-to-End Save/Resume Integration Test

**Files:**
- Create: `engine/src/persistence/e2e.test.ts`

**Test scenario:**
- Create a small state
- Cast a spell so stack has items
- Save
- Load
- Resolve and ensure same result as if uninterrupted

**Commit:**
```bash
git add engine/src/persistence/e2e.test.ts
git commit -m "test(engine): add save/resume end-to-end test"
```

---

## Acceptance Criteria (Phase 12 complete)

- ✅ Can save at any time (including mid-stack) and resume with equivalent state.
- ✅ Save slots list with metadata and can be deleted.
- ✅ Schema versioning exists and migrations run.
- ✅ Serialization round-trip tests pass.
- ✅ `cd engine && npx vitest run` passes.
