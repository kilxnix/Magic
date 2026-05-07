# Standalone Game, Deck URL Import, PWA & Hosting

**Date:** 2026-04-02
**Status:** Approved

## Goal

Separate the Shelector game from deck generation into a standalone experience. Allow users to paste deck URLs from popular MTG sites and jump straight into a game. Make the app publicly accessible via Cloudflare Tunnel for 5 concurrent testers. Add PWA support and fix the spell casting UX.

---

## 1. Route Structure

| Route | Page | Notes |
|-------|------|-------|
| `/` | Landing page | Hub with two paths |
| `/generate` | GeneratorPage | Moved from `/` |
| `/deck/:id` | DeckViewerPage | Unchanged |
| `/optimizer` | OptimizerPage | Unchanged |
| `/play` | PlayPage (new) | Standalone game |
| `/shelector` | ShelectorPage | Chat UI, not linked from landing |

**Removed routes:**
- `/game` — removed (was the old TestDeckModal target)
- `/shelector/game` — removed (replaced by `/play`)

**DeckViewerPage change:** Remove "Test This Deck" button/modal. Replace with a simple link: "Play this deck" that navigates to `/play` with the deck data (via query param or state).

---

## 2. Landing Page (`/`)

Dark theme matching the existing stone/dark palette. Centered layout.

**Structure:**
- Project title/branding at top
- Two large cards side by side (stack vertically on mobile):
  - **Generate a Deck** — icon, brief description ("Build a Commander deck tailored to your style"), links to `/generate`
  - **Play a Game** — icon, brief description ("Import your deck and battle an AI opponent"), links to `/play`
- Simple footer (optional)

**Mobile:** Cards stack vertically, full-width, large touch targets.

---

## 3. Deck URL Parser

### Backend Endpoint

`POST /api/parse-deck-url`

**Request:**
```json
{
  "url": "https://www.moxfield.com/decks/abc123"
}
```

**Response:** Same `DeckImportResult` shape as existing `/import-deck`:
```json
{
  "commander": "Atraxa, Praetors' Voice",
  "cards": ["Card Name 1", ...],
  "lands": ["Command Tower", ...],
  "card_data": { "Card Name": { ...card object } },
  "total": 100,
  "valid": true,
  "errors": [],
  "warnings": ["2 cards not found in database"],
  "filled_cards": []
}
```

### Site-Specific Parsing

**Moxfield:**
- URL pattern: `moxfield.com/decks/{slug}`
- API: `GET https://api2.moxfield.com/v3/decks/all/{slug}`
- Extract mainboard + commanders from JSON response

**Archidekt:**
- URL pattern: `archidekt.com/decks/{id}` or `archidekt.com/decks/{id}/{slug}`
- API: `GET https://archidekt.com/api/decks/{id}/`
- Extract cards from `cards` array in response, filter by category for commander

**TappedOut:**
- URL pattern: `tappedout.net/mtg-decks/{slug}/`
- Fetch: `GET https://tappedout.net/mtg-decks/{slug}/?fmt=txt`
- Parse plain text export (same format as existing text import)

**MTGGoldfish:**
- URL pattern: `mtggoldfish.com/deck/{id}` or `mtggoldfish.com/archetype/{slug}`
- Fetch: `GET https://www.mtggoldfish.com/deck/download/{id}`
- Parse plain text download

### Parsing Pipeline

1. Regex-match URL to detect site
2. Extract deck ID/slug from URL
3. Fetch via site-specific method
4. Normalize all card names against local card database (existing fuzzy match logic)
5. Identify commander (from API metadata or heuristics)
6. Return unified `DeckImportResult`
7. On failure: return error message suggesting manual paste fallback

### New Backend File

`backend/deck_url_parser.py` — all URL parsing logic lives here. Imported by `main.py` for the endpoint.

---

## 4. Play Page (`/play`)

### Pre-Game Flow (3 linear steps)

**Step 1: Import Deck**
- Two tabs: "Paste URL" (default) | "Paste Decklist" (fallback)
- URL tab: single text input + "Import" button
- Decklist tab: textarea (existing flow from ShelectorGamePage)
- Shows validation results: commander name, card count, warnings/errors
- Deck history dropdown (existing, carried over)

**Step 2: Opponent Setup**
- Appears after successful deck import (slide/transition)
- Bracket selector (1-5, default 3)
- Spawn mode: Random / Counter / Pool (existing logic)
- Color filter checkboxes (W/U/B/R/G)
- AI personality: Aggressive / Balanced / Political / Greedy
- "Start Game" button

**Step 3: Game**
- Full-width GameBoard (no chat panel — removes the old 70/30 split)
- Phase bar, hand, battlefield, stack, mana pool — all existing components
- "End Game" button available to trigger review early
- On game end (winner declared or manual end): GameReview modal opens

### What's Removed from Game UI
- In-game chat panel (the Shelector narration sidebar)
- Mobile chat toggle button
- All `/decide` endpoint calls during gameplay

### What Stays
- GameReview modal (post-game analysis)
- GameBoard component and all sub-components
- Mulligan, tutor, discard phases
- Undo system
- Coach mode toggle

---

## 5. Mobile Responsiveness

### Landing Page
- Cards stack vertically on screens < 640px
- Large touch targets (min 48px)
- Text scales appropriately

### Play Page Pre-Game
- Full-width inputs and buttons
- Tab bar for URL/Decklist toggle is touch-friendly
- Opponent setup controls stack vertically

### Game Board
- Already has mobile handling: compact cards, horizontal scroll hand, touch-friendly buttons
- **Verify and fix:** card overlapping, button sizing, text readability on small screens
- Review modal goes full-screen on mobile (max-h-screen, overflow-y-auto)

---

## 6. PWA Support

### Service Worker
- Register in `main.tsx`
- Cache strategy: network-first for API calls, cache-first for static assets (JS, CSS, images)
- Precache the built assets on install

### Web App Manifest (`manifest.json`)
- App name: "Magic Brains" (or project name)
- Short name: "MTG Game"
- Theme color matching dark palette
- Icons at 192x192 and 512x512
- Display: standalone
- Start URL: `/`

### Offline Behavior
- Landing page and game page shells load offline
- Card images cached progressively (cache on first view)
- Game engine runs entirely in-browser — games in progress work offline
- API calls (deck import, opponent spawn) require network — show clear offline messaging

---

## 7. Spell Casting UX Fix

### Current Problem
Users can't cast spells because the UI doesn't guide mana activation. You need to tap lands for mana before casting, but there's no indication of this.

### Solution: Auto-Tap on Cast

When a user clicks a spell to cast it:
1. Check if they have enough untapped mana sources to pay the cost
2. If yes: automatically tap the optimal combination of lands/mana sources, add mana to pool, and cast the spell in one action
3. If no: show a message like "Not enough mana — you need {cost}" with the specific colors/amounts
4. If ambiguous (multiple ways to pay with different color combinations): show a quick picker for which lands to tap

### Implementation Location
- `useShelectorGame.ts` — add an `autoCastSpell(cardInstanceId)` function
- Calls into the engine's mana system to find valid payment combinations
- Uses greedy algorithm: tap lands that produce only the needed colors first, save flexible lands for later

### Fallback
- Keep manual land-tapping as an option (for advanced players who want to float mana)
- Auto-tap is the default behavior when clicking a castable spell

---

## 8. Cloudflare Tunnel & Hosting

### Production Build
- `cd frontend && npm run build` produces `dist/`
- Serve `dist/` via a lightweight static server (e.g., `npx serve dist -l 3000`) or have the FastAPI backend serve it

### Recommended: Backend Serves Frontend
- Mount `dist/` as static files in `main.py`
- Single port (8000) serves both API and frontend
- Simpler tunnel config (one origin)
- Add fallback route: all non-`/api` routes serve `index.html` (SPA routing)

### Cloudflare Tunnel Config
- Add new public hostname entry pointing to `localhost:8000`
- The Shelector service (8100) stays internal — proxied through the main backend or frontend proxy config

### CORS Update
- Add the public tunnel URL to `allow_origins` in `main.py`
- Keep existing localhost origins for development

### Concurrency
- Game engine runs in-browser: zero server load per active game
- Backend handles only: deck URL parsing, deck import, opponent spawning — all lightweight
- 5 concurrent users is trivially handled

---

## Out of Scope (Future)

- Multiplayer (human vs human)
- Deck saving/accounts
- Leaderboards
- Additional site parsers beyond the 4 specified
- Advanced AI difficulty tuning

---

## File Changes Summary

### New Files
- `backend/deck_url_parser.py` — URL detection, fetching, parsing for 4 sites
- `frontend/src/pages/LandingPage.tsx` — hub page
- `frontend/src/pages/PlayPage.tsx` — standalone game page
- `frontend/public/manifest.json` — PWA manifest
- `frontend/src/sw.ts` — service worker (or use vite-plugin-pwa)

### Modified Files
- `frontend/src/router.tsx` — new route structure
- `backend/main.py` — new `/api/parse-deck-url` endpoint, static file serving, CORS update
- `frontend/src/main.tsx` — service worker registration
- `frontend/src/hooks/useShelectorGame.ts` — `autoCastSpell()` function
- `frontend/src/components/GameBoard.tsx` — wire up auto-cast, mobile fixes
- `frontend/src/pages/DeckViewerPage.tsx` — remove TestDeckModal, add link to `/play`
- `frontend/index.html` — manifest link, theme-color meta tag

### Removed/Deprecated
- `frontend/src/pages/ShelectorGamePage.tsx` — functionality absorbed into PlayPage
- `frontend/src/pages/GamePage.tsx` — removed
- `frontend/src/components/TestDeckModal.tsx` — removed
