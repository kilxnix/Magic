# Deck Viewer Enhancement Design

**Date:** 2026-01-19
**Status:** Approved

## Overview

Enhance the MTG Commander deck generator with shareable deck pages, card art viewing, persistent history, and ad placement infrastructure.

## Features

| Feature | Description |
|---------|-------------|
| Marquee ticker | CSS-animated horizontal scroll of recent site-wide decks |
| Routing | `/` generator, `/deck/:id` viewer |
| SQLite storage | Decks persist server-side, shareable via unique ID |
| localStorage history | User's deck IDs stored locally, hydrated on load |
| Deck viewer | Card images in piles grouped by category |
| Set selector | Global "prefer artwork from X" (free tier) |
| Per-card art | Individual card printing selection (paid tier hook) |
| Ad placeholders | Right sidebar (300x250) + below deck (728x90) |
| Mobile responsive | Single-column layout, hamburger menu for history |

---

## Database Schema

**SQLite** (`backend/decks.db`)

```sql
CREATE TABLE decks (
    id TEXT PRIMARY KEY,        -- 8-char unique ID (e.g., "a3f8c2b1")
    commander TEXT NOT NULL,
    colors TEXT NOT NULL,       -- JSON array: ["W", "U"]
    bracket INTEGER NOT NULL,
    bracket_name TEXT,
    theme TEXT,
    archetype TEXT,
    card_count INTEGER,
    estimated_price TEXT,
    cards TEXT NOT NULL,        -- JSON array of card names
    categories TEXT,            -- JSON object of categorized cards
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_decks_created ON decks(created_at DESC);
```

---

## API Endpoints

### Existing (Modified)

| Method | Endpoint | Change |
|--------|----------|--------|
| `POST` | `/api/generate-deck` | Now saves to SQLite before returning |

### New Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/deck/:id` | Fetch a saved deck by ID |
| `GET` | `/api/recent-decks` | Get last N decks for ticker (site-wide) |
| `POST` | `/api/decks/batch` | Fetch multiple decks by ID array (for history) |
| `GET` | `/api/card-printings/:name` | Get all printings/sets for a card |

---

## Frontend Structure

### Routes

```
/                    → GeneratorPage
/deck/:id            → DeckViewerPage
```

### File Structure

```
src/
├── pages/
│   ├── GeneratorPage.tsx    -- Form, history sidebar, generates decks
│   └── DeckViewerPage.tsx   -- Card art display, set selector, share
├── components/
│   ├── LiveRibbon.tsx       -- Marquee ticker (enhanced)
│   ├── DeckHistory.tsx      -- Left sidebar
│   ├── DeckDisplay.tsx      -- Text list view (existing)
│   ├── DeckVisualView.tsx   -- Card images in piles by category
│   ├── CardPile.tsx         -- Single category pile (overlapping)
│   ├── CardImage.tsx        -- Single card with hover enlarge
│   ├── SetSelector.tsx      -- Global "prefer set" dropdown
│   └── AdPlaceholder.tsx    -- Placeholder component for ads
├── layouts/
│   └── MainLayout.tsx       -- Shared layout (ticker, sidebar, ads)
```

---

## Layout: Desktop (≥1024px)

```
┌─────────────────────────────────────────────────────────────────┐
│  [Marquee ticker - scrolling recent decks]                      │
├──────────┬──────────────────────────────────────┬──────────────┤
│          │                                      │              │
│  History │      Generator / Deck Viewer         │  Ad Sidebar  │
│  Sidebar │           (center)                   │   300x250    │
│          │                                      │              │
│          ├──────────────────────────────────────┤              │
│          │        Bottom Ad (728x90)            │              │
└──────────┴──────────────────────────────────────┴──────────────┘
```

## Layout: Mobile (<768px)

```
┌─────────────────────────┐
│ [Marquee ticker]        │
├─────────────────────────┤
│ [☰ History]    [Logo]   │
├─────────────────────────┤
│                         │
│   Generator Form        │
│         or              │
│   Deck Viewer           │
│   (piles stack          │
│    vertically)          │
│                         │
├─────────────────────────┤
│     AD (300x250)        │
└─────────────────────────┘
```

---

## Marquee Ticker

**Behavior:**
- Continuous horizontal scroll, right-to-left
- Shows last 10-20 site-wide generated decks
- Each item: commander name + colors + "View" link
- Pauses on hover
- Seamless loop (content duplicated)
- CSS animation for 60fps performance
- Refreshes every 30 seconds

---

## Deck Viewer Page

**Header:**
- Commander name, colors, bracket, theme
- Global set selector dropdown
- Share/Copy/Export buttons

**Card Display:**
- Grouped by category: Commander, Creatures, Instants, Sorceries, Artifacts, Enchantments, Planeswalkers, Lands
- Visual pile layout (cards overlap ~30px horizontally)
- Hover: card rises up, shows full image
- Click: modal with large card (+ printing selector for paid users)

**Categories ordering:**
1. Commander (1)
2. Creatures
3. Instants
4. Sorceries
5. Artifacts
6. Enchantments
7. Planeswalkers
8. Lands

---

## Persistent History

**localStorage structure:**

```typescript
// Key: "mtg_deck_history"
{
  deckIds: ["a3f8c2b1", "x7y2z9q4", ...],
  maxItems: 50,
  lastUpdated: "2026-01-19T10:30:00Z"
}
```

**Flow:**
1. On generation: prepend ID to `deckIds`, save to localStorage
2. On page load: read `deckIds`, fetch summaries via `/api/decks/batch`
3. History sidebar shows user's decks
4. Ticker shows site-wide recent decks (different data source)

---

## Scryfall Integration

**Card images:**
```
https://api.scryfall.com/cards/named?exact={name}&format=image
```

**Card printings:**
```
https://api.scryfall.com/cards/search?q=!"Card Name"&unique=prints
```

**Backend proxy** (`/api/card-printings/:name`):
- Caches printings data
- Respects Scryfall rate limits (100ms delay)
- Avoids CORS issues

**Image loading:**
- Lazy load as cards scroll into view
- Card back placeholder while loading
- Aggressive caching

---

## Ad Placeholders

**Sizes:**
- Sidebar: 300x250 (medium rectangle)
- Bottom: 728x90 (leaderboard)

**Styling:**
- Dashed border, light gray background
- "Advertisement" label centered
- Fixed dimensions to prevent layout shift

**Placement:**
- Sidebar: always visible on desktop, below content on mobile
- Leaderboard: below deck display only (not on generator form)

---

## Mobile Adjustments

**Breakpoints:**
- Desktop: ≥1024px (3-column)
- Tablet: 768-1023px (2-column, history in hamburger)
- Mobile: <768px (single column)

**Deck viewer on mobile:**
- Card piles scroll horizontally within each category
- Tap card: full-screen modal
- Set selector: full-width dropdown

---

## Premium Feature Hook

**Free tier:**
- Global "prefer artwork from [Set]" selector
- Applies to all cards, fallback for missing

**Paid tier (future):**
- Per-card printing selector
- Click any card → choose specific printing
- UI built now, gated behind feature flag

---

## Out of Scope

- User accounts / authentication
- Payment integration
- Actual ad network code
- Open Graph meta tags for social sharing
- Rate limiting / abuse prevention

---

## Implementation Order

1. SQLite database setup + deck storage
2. New API endpoints (deck fetch, recent, batch, printings)
3. React Router setup
4. MainLayout with ad placeholders
5. Marquee ticker enhancement
6. localStorage history persistence
7. DeckViewerPage with card piles
8. Set selector (global)
9. Mobile responsive adjustments
10. Per-card selector UI (gated)
