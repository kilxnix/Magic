# Deck Regeneration & Card Locking Design

**Date:** 2026-01-26
**Status:** Approved

## Overview

Two related features for the deck generator:

1. **Card Keep/Lock Feature** - Users can lock cards they like, then regenerate the rest of the deck (up to 5 times per initial generation)
2. **Deck Uniqueness Fix** - Add randomness and boost synergy weighting so same-color commanders produce different decks

## Requirements

### Card Locking Rules
- Commander: Always locked (cannot be selected)
- Core staples: Always locked (Sol Ring, Command Tower, etc.)
- Everything else: Eligible for user to lock or regenerate

### Regeneration Limits
- 5 regenerations max per initial deck
- Hard limit with "Start Fresh" reset option
- "Start Fresh" returns to GeneratorPage with same commander pre-selected

### UI Behavior
- Primary: Click card to toggle lock (shows lock icon + blue border)
- Fallback: Checkbox mode if click detection fails
- New cards highlighted with green glow/badge for 10 seconds after regeneration

## Backend API

### New Endpoint: `POST /api/regenerate-deck`

**Request:**
```json
{
  "deck_id": "uuid-of-original-deck",
  "kept_card_names": ["Rhystic Study", "Cyclonic Rift"],
  "regeneration_number": 2
}
```

**Response:**
```json
{
  "deck": { ... },
  "regenerations_remaining": 3,
  "new_card_names": ["Ponder", "Brainstorm"],
  "core_staples": ["Sol Ring", "Arcane Signet"],
  "commander_name": "Atraxa, Praetors' Voice"
}
```

**Validation:**
- Reject if `regeneration_number > 5`
- Reject if deck_id doesn't exist
- Reject if kept cards include commander or core staples

### Database Schema Changes

```sql
ALTER TABLE decks ADD COLUMN parent_deck_id TEXT;
ALTER TABLE decks ADD COLUMN regeneration_number INTEGER DEFAULT 0;
```

## Deck Uniqueness Fix

### Problem
`_select_best_cards()` sorts by score and takes top N - completely deterministic. Same color identity = same cards every time.

### Solution 1: Controlled Randomness

Modify `_select_best_cards()` in `deck_generator.py`:

```python
def _select_best_cards(self, candidates, count, ..., randomness=0.15):
    scored = [(self._score_card(card, ...), card) for card in candidates]
    scored.sort(key=lambda x: x[0], reverse=True)

    # Take top 3x candidates, add random noise
    pool_size = min(count * 3, len(scored))
    pool = scored[:pool_size]

    randomized = [(score * random.uniform(1 - randomness, 1 + randomness), card)
                  for score, card in pool]
    randomized.sort(key=lambda x: x[0], reverse=True)

    return [card for _, card in randomized[:count]]
```

### Solution 2: Boost Synergy Weight

In `_score_card()`, change weights:
- FAISS semantic similarity: 30% → **50%**
- Staple bonus: +3 → **+1.5**

## Core Staples Definition

Small hardcoded list in `rules.py` (EDHREC integration planned for future):

```python
CORE_STAPLES = {
    "Sol Ring", "Arcane Signet", "Mind Stone", "Thought Vessel",
    "Command Tower", "Exotic Orchard", "Path of Ancestry",
}

def get_core_staples_for_colors(colors: list[str]) -> set[str]:
    staples = set(CORE_STAPLES)
    if "W" in colors:
        staples.update(["Swords to Plowshares", "Path to Exile"])
    if "U" in colors:
        staples.update(["Counterspell", "Rhystic Study"])
    if "B" in colors:
        staples.update(["Demonic Tutor", "Toxic Deluge"])
    if "R" in colors:
        staples.update(["Chaos Warp", "Deflecting Swat"])
    if "G" in colors:
        staples.update(["Cultivate", "Beast Within"])
    return staples
```

## Frontend UI

### State Management (DeckViewerPage.tsx)

```typescript
const [lockedCards, setLockedCards] = useState<Set<string>>(new Set());
const [regenerationsRemaining, setRegenerationsRemaining] = useState(5);
const [newCards, setNewCards] = useState<Set<string>>(new Set());
const [selectionMode, setSelectionMode] = useState(true);
const [useCheckboxFallback, setUseCheckboxFallback] = useState(false);
```

### Card Visual States

| State | Appearance |
|-------|------------|
| Unlocked (will regenerate) | Normal appearance |
| Locked (will keep) | Blue border + lock icon |
| Core staple/Commander | Gray lock icon, cursor: not-allowed |
| Newly generated | Green glow/badge, fades after 10s |

### New UI Elements
- "Regenerate Deck" button (disabled when remaining = 0)
- Counter: "4 of 5 regenerations remaining"
- "Start Fresh" button
- "Switch to checkboxes" link
- Selected count: "12 cards locked"

## User Flow

1. User generates deck → lands on DeckViewerPage
2. Selection mode activates automatically
3. User clicks cards to lock → shows lock icon
4. User clicks "Regenerate Deck"
5. Backend generates new deck keeping locked cards
6. Frontend shows new cards with highlight, decrements counter
7. Repeat up to 5 times
8. After 5th: "Regenerate" disabled, "Start Fresh" shown

## Implementation Order

1. Backend: Core staples definition in `rules.py`
2. Backend: Randomness + synergy weight changes in `deck_generator.py`
3. Backend: `regenerate_deck()` method
4. Backend: `/api/regenerate-deck` endpoint + DB schema
5. Frontend: Types and API call
6. Frontend: Card locking UI (click + checkbox fallback)
7. Frontend: Regeneration button, counter, "Start Fresh"
8. Frontend: New card highlighting
9. Testing: End-to-end flow

## Files to Modify

| File | Changes |
|------|---------|
| `backend/rules.py` | Add `CORE_STAPLES`, `get_core_staples_for_colors()` |
| `backend/deck_generator.py` | Add `regenerate_deck()`, randomness, boost synergy weight |
| `backend/main.py` | Add `POST /api/regenerate-deck` endpoint |
| `backend/database.py` | Add `parent_deck_id`, `regeneration_number` columns |
| `frontend/src/pages/DeckViewerPage.tsx` | Locking UI, regeneration, highlighting |
| `frontend/src/types.ts` | Add request/response types |

## Future Enhancements

- EDHREC integration for community-driven staple lists
- Regeneration history (view previous versions)
- "Undo" to revert last regeneration
