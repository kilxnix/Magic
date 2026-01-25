# Phase 13: Deck Generator Integration — Implementation Plan

**Goal:** Connect the deck generator to the game engine so users can click "Test this deck" and immediately play a Commander game with their generated deck against AI opponents.

**Depends on:** Phase 9 (mobile UI), Phase 8 (basic AI), Phase 12 (save/resume).

---

## Task 1: Deck Format Conversion (Generator → Engine)

**Files:**
- Create: `engine/src/cards/deck-loader.ts`
- Create: `engine/src/cards/deck-loader.test.ts`

**Problem:**
- Deck generator outputs: `{ commander: CardData, cards: CardData[] }` with Scryfall-style objects
- Engine needs: `CardDefinition[]` with parsed oracle text, plus deck instance IDs

**Implementation:**
- `convertGeneratedDeck(generatedDeck): { commander: CardDefinition; library: CardDefinition[] }`
- Map Scryfall fields to engine fields:
  - `oracle_text` → `oracleText`
  - `mana_cost` → `manaCost`
  - `type_line` → `typeLine`
  - `color_identity` → `colorIdentity`
- Validate 99 cards + 1 commander

**Tests:**
- Convert a sample generated deck and verify field mapping
- Reject deck with wrong card count

**Commit:**
```bash
git add engine/src/cards/deck-loader.ts engine/src/cards/deck-loader.test.ts
git commit -m "feat(engine): add deck format converter for generator output"
```

---

## Task 2: Game Initialization from Generated Deck

**Files:**
- Modify: `engine/src/game-state.ts`
- Create: `engine/src/game-init.ts`
- Create: `engine/src/game-init.test.ts`

**API:**
```ts
export function initGameFromDecks(config: {
  humanDeck: GeneratedDeck;
  aiDecks: GeneratedDeck[];  // 1-3 AI opponents
  aiDifficulty: number;      // bracket 1-5
  aiPersonalities?: ('Aggressive' | 'Greedy' | 'Political' | 'Balanced')[];
}): GameState
```

**Behavior:**
- Convert all decks via `convertGeneratedDeck`
- Create `PlayerState` for human (index 0) and each AI
- Shuffle libraries, draw opening hands (7 cards each)
- Place commanders in command zone
- Set turn order (human goes first, or random option)

**Tests:**
- 2-player game initializes correctly
- 4-player game initializes correctly
- Commanders start in command zone

**Commit:**
```bash
git add engine/src/game-init.ts engine/src/game-init.test.ts engine/src/game-state.ts
git commit -m "feat(engine): initialize game from generated decks"
```

---

## Task 3: AI Deck Selection (Prebuilt or Random)

**Files:**
- Create: `engine/src/ai/deck-pool.ts`
- Create: `data/ai_decks/` directory with 5-10 prebuilt deck JSONs

**Problem:**
- When user tests their deck, AI needs decks too
- Options: (a) use prebuilt decks, (b) generate on-the-fly, (c) let user pick

**Implementation (v0):**
- Ship 5-10 prebuilt AI decks at various brackets
- `selectAIDeck(bracket: number): GeneratedDeck` picks appropriate deck
- Later: option to generate AI decks dynamically

**Prebuilt deck criteria:**
- Cover brackets 1-5 (2 decks per bracket)
- Diverse color identities
- Include popular commanders

**Commit:**
```bash
git add engine/src/ai/deck-pool.ts data/ai_decks/
git commit -m "feat(engine): add prebuilt AI deck pool"
```

---

## Task 4: Backend API Endpoint for Game Launch

**Files:**
- Modify: `backend/main.py`
- Create: `backend/game_launcher.py`

**New endpoint:**
```
POST /api/launch-game
{
  "deck_id": "uuid",           // from /api/generate-deck
  "opponent_count": 1-3,
  "difficulty": 1-5,
  "ai_personalities": ["Balanced", "Aggressive", ...]  // optional
}

Response:
{
  "game_id": "uuid",
  "initial_state": { ... }     // serialized GameState for mobile
}
```

**Behavior:**
- Load deck from `decks.db` by ID
- Select AI decks from pool
- Call engine's `initGameFromDecks`
- Serialize and return

**Commit:**
```bash
git add backend/main.py backend/game_launcher.py
git commit -m "feat(backend): add /api/launch-game endpoint"
```

---

## Task 5: Frontend "Test This Deck" Button

**Files:**
- Modify: `frontend/src/pages/DeckViewerPage.tsx`
- Create: `frontend/src/components/TestDeckModal.tsx`

**UI Flow:**
1. User views generated deck
2. Clicks "Test This Deck" button
3. Modal opens: select opponent count (1-3), difficulty (bracket 1-5)
4. Click "Start Game"
5. POST to `/api/launch-game`
6. Redirect to mobile app (deep link) or show QR code

**Deep link format:**
```
mtgcommander://game/{game_id}
```

**Commit:**
```bash
git add frontend/src/pages/DeckViewerPage.tsx frontend/src/components/TestDeckModal.tsx
git commit -m "feat(frontend): add 'Test This Deck' button and modal"
```

---

## Task 6: Mobile App Deep Link Handler

**Files:**
- Modify: `frontend/mobile/App.tsx`
- Create: `frontend/mobile/src/linking.ts`

**Behavior:**
- Register `mtgcommander://` scheme
- Parse `game/{game_id}` route
- Fetch game state from backend (or receive via deep link payload)
- Navigate to `GameScreen` with loaded state

**Commit:**
```bash
git add frontend/mobile/App.tsx frontend/mobile/src/linking.ts
git commit -m "feat(mobile): handle deep links to launch games"
```

---

## Task 7: Game State Sync (Optional Cloud Save)

**Files:**
- Create: `backend/game_sync.py`
- Modify: `frontend/mobile/src/persistence/adapter.ts`

**Behavior (optional, for cross-device):**
- Save game state to Supabase (if configured)
- Mobile can fetch latest state on launch
- Fallback to local-only if no cloud

**Commit:**
```bash
git add backend/game_sync.py frontend/mobile/src/persistence/adapter.ts
git commit -m "feat: add optional cloud game sync"
```

---

## Task 8: End-to-End Integration Test

**Files:**
- Create: `tests/integration/test_deck_to_game.py`

**Test scenario:**
1. Generate a deck via `/api/generate-deck`
2. Launch game via `/api/launch-game`
3. Verify returned `GameState` has:
   - Correct commander in command zone
   - 99 cards in library (minus 7 in hand)
   - AI opponents initialized
4. Simulate a few turns (engine-side) to verify playability

**Commit:**
```bash
git add tests/integration/test_deck_to_game.py
git commit -m "test: add deck-to-game end-to-end integration test"
```

---

## Acceptance Criteria (Phase 13 complete)

- User can generate a deck and click "Test This Deck"
- Game launches with their deck vs 1-3 AI opponents
- AI decks are selected appropriately for the bracket
- Mobile app receives and loads the game state
- Game is playable through to completion
- (Optional) Game state syncs to cloud for cross-device resume
