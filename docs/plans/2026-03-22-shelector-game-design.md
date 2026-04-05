# Shelector Game Integration — Design Spec

## Goal

Let the Shelector play Commander games against the user through a hybrid chat + visual board UI, using the existing TypeScript game engine for rules enforcement.

## Architecture

```
Browser (React, port 5173)
  ├── ShelectorGamePage (split panel)
  │     ├── Left: Game Board (battlefield, hand, stack, phases)
  │     └── Right: Chat Panel (Shelector narration + player messages)
  │
  └── useShelectorGame hook
        ├── Initializes game via existing engine (TypeScript, in-browser)
        ├── Human has priority → waits for UI interaction (click card, declare attackers)
        ├── AI has priority → POST /decide to Shelector API
        └── Applies returned action to game state, appends narration to chat

Shelector API (Python, port 8100)
  └── POST /decide
        ├── Input: serialized game state + legal actions list
        ├── Brain reads board state, uses RAG for card knowledge
        ├── Picks best action from legal actions
        └── Output: { action, narration, reasoning }
```

## Components

### 1. `/decide` Endpoint (Python — backend/agent/server.py)

New endpoint on the existing Shelector server (port 8100).

**Request:**
```json
{
  "game_state": { ... serialized GameState ... },
  "legal_actions": [ { "kind": "CastSpell", "cardInstanceId": "abc", ... }, ... ],
  "player_id": "shelector",
  "difficulty": 3,
  "personality": "Balanced"
}
```

**Response:**
```json
{
  "action": { "kind": "CastSpell", "cardInstanceId": "abc", "targets": ["def"] },
  "narration": "I'll remove your Atraxa before she gets out of hand.",
  "reasoning": "Opponent's commander enables proliferate which will snowball."
}
```

**How the brain decides:**
1. Receive legal actions list (already computed by the TypeScript engine in browser)
2. Serialize the board state into a readable summary (who has what, life totals, cards in hand)
3. Format as a prompt: "You are playing MTG Commander. Here's the board. Pick from these actions."
4. The 3B model picks an action and generates narration
5. Return the action object (unchanged from the legal actions list) + narration

### 2. useShelectorGame Hook (TypeScript — frontend)

Extends the existing `useGameEngine` pattern:

- Initializes game with human deck + Shelector deck (from AI deck pool)
- On each priority check:
  - If human → enable UI interactions (click to play land, cast spell, etc.)
  - If Shelector → call `/decide`, apply returned action, append narration to chat log
- Manages chat message history (narration from Shelector + optional human messages)
- Handles game over detection

### 3. ShelectorGamePage (React — frontend)

Split-panel layout:
- **Left (70%):** Game board — battlefield zones (your side, Shelector's side), hand (bottom), stack, phase indicator, life totals
- **Right (30%):** Chat panel — Shelector's narration scrolls like a chat, with personality and commentary on each play

Route: `/shelector/game`

### 4. Game Board Component

Reuses concepts from the existing GamePage but simplified for 1v1:
- Your battlefield (bottom): creatures, artifacts, enchantments, lands
- Shelector's battlefield (top): same zones
- Hand (bottom bar): your cards, clickable when you have priority
- Stack (overlay): shows spells being cast
- Phase indicator: current phase/step
- Life totals: both players

Cards rendered as small rectangles with name + P/T, hoverable for full details.

## Data Flow

1. **Game Start:** User picks a deck (from generated decks or prebuilt). Shelector picks from AI deck pool based on bracket. Game initializes via `initGameFromDecks()`.

2. **Human Turn:** Engine grants priority → UI enables → player clicks a card → `applyAction()` → state updates → check if AI gets priority next.

3. **Shelector Turn:** Engine grants priority → hook calls `POST /decide` with state + legal actions → Shelector returns action + narration → `applyAction()` → narration appears in chat → state updates.

4. **Game Over:** Life reaches 0, commander damage threshold, or player concedes. Chat shows final message from Shelector.

### 5. Opponent Spawning

The Shelector acts as host/narrator and can spawn different opponent personas:

- User requests a game (via chat or UI button) with their deck + bracket
- Shelector picks an appropriate opponent from the AI deck pool (`data/ai_decks/deck_pool.json`) based on bracket and color variety
- Shelector plays AS that opponent persona, adapting narration style (e.g., aggressive Krenko player talks differently than a control Talrand player)
- Opponent persona is displayed in the UI (name, commander, personality)

**Deck Pool (existing):** 10 prebuilt decks with `minBracket`/`maxBracket` ranges, covering aggro, control, combo, and midrange archetypes.

## What We're NOT Building (YAGNI)

- Multiplayer (1v1 only for now)
- Save/resume game state
- Full card art rendering (text-based cards are fine)
- Mobile layout
- Spectator mode

## Success Criteria

- User can play a full Commander game against the Shelector
- Shelector makes legal moves (enforced by engine, not the model)
- Shelector narrates its decisions in chat
- Board state is visually readable (whose turn, what's on the field, your hand)
