# Phase 1: Foundation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up SQLite deck storage, new API endpoints, and React Router for shareable deck pages.

**Architecture:** SQLite database stores generated decks with unique IDs. New endpoints fetch individual decks, recent decks for ticker, and batch fetch for history. Frontend uses react-router-dom for `/` and `/deck/:id` routes.

**Tech Stack:** Python/SQLite/FastAPI (backend), React/TypeScript/react-router-dom (frontend)

---

## Task 1: Create SQLite Database Module

**Files:**
- Create: `backend/database.py`

**Step 1: Create the database module**

```python
"""SQLite database for storing generated decks."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

DATABASE_PATH = Path(__file__).parent.parent / "data" / "decks.db"


def init_db():
    """Initialize the database and create tables if they don't exist."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS decks (
                id TEXT PRIMARY KEY,
                commander TEXT NOT NULL,
                colors TEXT NOT NULL,
                bracket INTEGER NOT NULL,
                bracket_name TEXT,
                theme TEXT,
                archetype TEXT,
                card_count INTEGER,
                estimated_price TEXT,
                cards TEXT NOT NULL,
                categories TEXT,
                legal_status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_decks_created
            ON decks(created_at DESC)
        """)
        conn.commit()


@contextmanager
def get_connection():
    """Get a database connection with context manager."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def save_deck(deck_data: dict) -> str:
    """Save a deck to the database. Returns the deck ID."""
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO decks (
                id, commander, colors, bracket, bracket_name, theme,
                archetype, card_count, estimated_price, cards, categories,
                legal_status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            deck_data['id'],
            deck_data['commander'],
            json.dumps(deck_data['colors']),
            deck_data['bracket'],
            deck_data.get('bracket_name', ''),
            deck_data.get('theme', ''),
            deck_data.get('archetype', ''),
            deck_data.get('card_count', 0),
            deck_data.get('estimated_price', ''),
            json.dumps(deck_data['list']),
            json.dumps(deck_data.get('categories', {})),
            deck_data.get('legal_status', ''),
            deck_data.get('timestamp', datetime.now().isoformat()),
        ))
        conn.commit()
    return deck_data['id']


def get_deck(deck_id: str) -> Optional[dict]:
    """Fetch a deck by ID. Returns None if not found."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM decks WHERE id = ?", (deck_id,)
        ).fetchone()

        if not row:
            return None

        return _row_to_deck(row)


def get_recent_decks(limit: int = 20) -> list[dict]:
    """Fetch the most recently created decks."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM decks ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()

        return [_row_to_deck(row) for row in rows]


def get_decks_by_ids(deck_ids: list[str]) -> list[dict]:
    """Fetch multiple decks by their IDs."""
    if not deck_ids:
        return []

    placeholders = ",".join("?" * len(deck_ids))
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM decks WHERE id IN ({placeholders})",
            deck_ids
        ).fetchall()

        # Return in the order requested
        deck_map = {_row_to_deck(row)['id']: _row_to_deck(row) for row in rows}
        return [deck_map[did] for did in deck_ids if did in deck_map]


def _row_to_deck(row: sqlite3.Row) -> dict:
    """Convert a database row to a deck dictionary."""
    return {
        'id': row['id'],
        'commander': row['commander'],
        'colors': json.loads(row['colors']),
        'bracket': row['bracket'],
        'bracket_name': row['bracket_name'] or '',
        'theme': row['theme'] or '',
        'archetype': row['archetype'] or '',
        'card_count': row['card_count'] or 0,
        'estimated_price': row['estimated_price'] or '',
        'list': json.loads(row['cards']),
        'categories': json.loads(row['categories']) if row['categories'] else {},
        'legal_status': row['legal_status'] or '',
        'timestamp': row['created_at'],
    }
```

**Step 2: Verify file created**

Run: `ls -la backend/database.py`
Expected: File exists

---

## Task 2: Add Database Initialization to Startup

**Files:**
- Modify: `backend/main.py`

**Step 1: Add import at top of file (after line 8)**

Add after the existing imports:

```python
from backend.database import init_db, save_deck, get_deck, get_recent_decks, get_decks_by_ids
```

**Step 2: Initialize database in startup event**

Modify the `startup_event` function to also init the database:

```python
@app.on_event("startup")
async def startup_event():
    """Pre-load the deck generator and initialize database."""
    logger.info("Initializing database...")
    init_db()
    logger.info("Loading deck generator...")
    try:
        generator = get_generator()
        logger.info(f"Loaded {len(generator.cards)} cards")
    except Exception as e:
        logger.error(f"Failed to load deck generator: {e}")
        raise
```

---

## Task 3: Modify generate_deck to Save to Database

**Files:**
- Modify: `backend/main.py`

**Step 1: Update generate_deck endpoint to save deck**

Replace the return statement section (around lines 145-159) with:

```python
    deck_response = DeckResponse(
        id=str(uuid.uuid4())[:8],
        commander=result["commander"],
        colors=result["colors"],
        archetype=result["archetype"],
        timestamp=datetime.now().isoformat(),
        legal_status=result["legal_status"],
        card_count=result["card_count"],
        estimated_price=result["estimated_price"],
        list=result["list"],
        bracket=result["bracket"],
        bracket_name=result["bracket_name"],
        theme=result["theme"],
        categories=result["categories"],
    )

    # Save to database
    save_deck(deck_response.model_dump())
    logger.info(f"Saved deck {deck_response.id} to database")

    return deck_response
```

---

## Task 4: Add New API Endpoints

**Files:**
- Modify: `backend/main.py`

**Step 1: Add DeckSummary model (add after BracketInfo class)**

```python
class DeckSummary(BaseModel):
    """Summary of a deck for listings."""
    id: str
    commander: str
    colors: List[str]
    bracket: int
    theme: str
    created_at: str
```

**Step 2: Add BatchRequest model**

```python
class BatchRequest(BaseModel):
    """Request for batch deck fetching."""
    ids: List[str] = Field(..., max_length=50, description="List of deck IDs")
```

**Step 3: Add GET /api/deck/{deck_id} endpoint (add before the if __name__ block)**

```python
@app.get("/api/deck/{deck_id}", response_model=DeckResponse)
async def get_deck_by_id(deck_id: str):
    """Fetch a saved deck by its ID."""
    deck = get_deck(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    return DeckResponse(**deck)
```

**Step 4: Add GET /api/recent-decks endpoint**

```python
@app.get("/api/recent-decks", response_model=List[DeckSummary])
async def list_recent_decks(limit: int = Query(20, le=50)):
    """Get the most recently generated decks (for ticker)."""
    decks = get_recent_decks(limit)
    return [
        DeckSummary(
            id=d['id'],
            commander=d['commander'],
            colors=d['colors'],
            bracket=d['bracket'],
            theme=d['theme'],
            created_at=d['timestamp'],
        )
        for d in decks
    ]
```

**Step 5: Add POST /api/decks/batch endpoint**

```python
@app.post("/api/decks/batch", response_model=List[DeckResponse])
async def get_decks_batch(request: BatchRequest):
    """Fetch multiple decks by their IDs (for history hydration)."""
    decks = get_decks_by_ids(request.ids)
    return [DeckResponse(**d) for d in decks]
```

---

## Task 5: Test Backend Endpoints

**Step 1: Start the backend**

Run: `cd /home/sheltron/Documents/Magic && source venv/bin/activate && python -m uvicorn backend.main:app --port 8000 &`

Wait for "Application startup complete"

**Step 2: Test health endpoint**

Run: `curl http://localhost:8000/api/health`
Expected: `{"status":"healthy"}`

**Step 3: Test generate deck (creates a saved deck)**

Run:
```bash
curl -X POST http://localhost:8000/api/generate-deck \
  -H "Content-Type: application/json" \
  -d '{"commander": "Atraxa", "bracket": 2}'
```
Expected: JSON response with deck data including an `id` field

**Step 4: Test fetch deck by ID**

Run: `curl http://localhost:8000/api/deck/<ID_FROM_STEP_3>`
Expected: Same deck data returned

**Step 5: Test recent decks**

Run: `curl http://localhost:8000/api/recent-decks`
Expected: Array with at least one deck summary

**Step 6: Stop backend**

Run: `pkill -f uvicorn`

---

## Task 6: Install React Router

**Files:**
- Modify: `frontend/package.json`

**Step 1: Install react-router-dom**

Run:
```bash
cd /home/sheltron/Documents/Magic/frontend && npm install react-router-dom
```

Expected: Package added to dependencies

---

## Task 7: Create Router Setup

**Files:**
- Create: `frontend/src/router.tsx`

**Step 1: Create router configuration**

```tsx
import { createBrowserRouter } from 'react-router-dom';
import { GeneratorPage } from './pages/GeneratorPage';
import { DeckViewerPage } from './pages/DeckViewerPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <GeneratorPage />,
  },
  {
    path: '/deck/:id',
    element: <DeckViewerPage />,
  },
]);
```

---

## Task 8: Create Pages Directory and GeneratorPage

**Files:**
- Create: `frontend/src/pages/GeneratorPage.tsx`

**Step 1: Create GeneratorPage (refactored from App.tsx)**

```tsx
import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Deck, Commander, Bracket, DeckRequest } from '../types';
import { DeckHistory } from '../components/DeckHistory';
import { DeckDisplay } from '../components/DeckDisplay';

// API functions
async function fetchCommanders(query: string = ''): Promise<Commander[]> {
  const url = query
    ? `/api/commanders?query=${encodeURIComponent(query)}&limit=20`
    : '/api/commanders?limit=20';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch commanders');
  return res.json();
}

async function fetchBrackets(): Promise<Bracket[]> {
  const res = await fetch('/api/brackets');
  if (!res.ok) throw new Error('Failed to fetch brackets');
  return res.json();
}

async function generateDeck(request: DeckRequest): Promise<Deck> {
  const res = await fetch('/api/generate-deck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || 'Failed to generate deck');
  }
  return res.json();
}

// localStorage helpers
const HISTORY_KEY = 'mtg_deck_history';

function loadHistory(): string[] {
  try {
    const data = localStorage.getItem(HISTORY_KEY);
    if (data) {
      const parsed = JSON.parse(data);
      return parsed.deckIds || [];
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
  return [];
}

function saveHistory(deckIds: string[]) {
  const data = {
    deckIds: deckIds.slice(0, 50), // Keep max 50
    lastUpdated: new Date().toISOString(),
  };
  localStorage.setItem(HISTORY_KEY, JSON.stringify(data));
}

async function hydrateHistory(deckIds: string[]): Promise<Deck[]> {
  if (deckIds.length === 0) return [];
  try {
    const res = await fetch('/api/decks/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: deckIds }),
    });
    if (!res.ok) return [];
    return res.json();
  } catch (e) {
    console.error('Failed to hydrate history:', e);
    return [];
  }
}

// Budget tier options
const BUDGET_TIERS = [
  { value: '', label: 'Any budget' },
  { value: 'budget', label: 'Budget (< $1 per card)' },
  { value: 'affordable', label: 'Affordable ($1-5 per card)' },
  { value: 'moderate', label: 'Moderate ($5-20 per card)' },
  { value: 'premium', label: 'Premium ($20-50 per card)' },
  { value: 'high_end', label: 'High-End (> $50 per card)' },
];

export function GeneratorPage() {
  const navigate = useNavigate();
  const [history, setHistory] = useState<Deck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);

  // Form state
  const [commanderSearch, setCommanderSearch] = useState('');
  const [commanders, setCommanders] = useState<Commander[]>([]);
  const [selectedCommander, setSelectedCommander] = useState<Commander | null>(null);
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [selectedBracket, setSelectedBracket] = useState(2);
  const [theme, setTheme] = useState('');
  const [budgetTier, setBudgetTier] = useState('');

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCommanderDropdown, setShowCommanderDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load history from localStorage on mount
  useEffect(() => {
    const deckIds = loadHistory();
    if (deckIds.length > 0) {
      hydrateHistory(deckIds).then(setHistory);
    }
  }, []);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCommanderDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load brackets on mount
  useEffect(() => {
    fetchBrackets()
      .then(setBrackets)
      .catch(err => console.error('Failed to load brackets:', err));
  }, []);

  // Search commanders when query changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (commanderSearch.length >= 1) {
        fetchCommanders(commanderSearch)
          .then((results) => {
            setCommanders(results);
            setShowCommanderDropdown(true);
          })
          .catch(err => console.error('Failed to search commanders:', err));
      } else {
        setCommanders([]);
        setShowCommanderDropdown(false);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [commanderSearch]);

  const handleGenerate = async () => {
    if (!selectedCommander) {
      setError('Please select a commander');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const deck = await generateDeck({
        commander: selectedCommander.name,
        bracket: selectedBracket,
        theme: theme || undefined,
        budget_tier: budgetTier || undefined,
      });

      // Update history (state and localStorage)
      setHistory(prev => {
        const newHistory = [deck, ...prev.filter(d => d.id !== deck.id)];
        saveHistory(newHistory.map(d => d.id));
        return newHistory;
      });
      setSelectedDeckId(deck.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate deck');
    } finally {
      setLoading(false);
    }
  };

  const handleCommanderSelect = (commander: Commander) => {
    setSelectedCommander(commander);
    setCommanderSearch(commander.name);
    setShowCommanderDropdown(false);
  };

  const handleViewDeck = (deckId: string) => {
    navigate(`/deck/${deckId}`);
  };

  const selectedDeck = history.find(d => d.id === selectedDeckId) || null;

  // Color identity display helper
  const colorSymbols: Record<string, string> = {
    W: 'text-amber-100 bg-amber-50',
    U: 'text-blue-500 bg-blue-100',
    B: 'text-gray-800 bg-gray-200',
    R: 'text-red-500 bg-red-100',
    G: 'text-green-600 bg-green-100',
  };

  return (
    <main className="flex flex-1 overflow-hidden flex-col md:flex-row">
      <DeckHistory
        history={history}
        selectedId={selectedDeckId}
        onSelect={(d) => setSelectedDeckId(d.id)}
        onViewFull={handleViewDeck}
      />

      {!selectedDeck ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 bg-stone-100">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-serif text-stone-800">Commander Deck Generator</h2>
              <p className="text-stone-500">Build decks following Command Zone rules</p>
            </div>

            {/* Commander Search */}
            <div className="relative" ref={dropdownRef}>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Commander
              </label>
              <input
                type="text"
                value={commanderSearch}
                onChange={(e) => {
                  setCommanderSearch(e.target.value);
                  if (!e.target.value) setSelectedCommander(null);
                }}
                onFocus={() => commanderSearch.length >= 1 && setShowCommanderDropdown(true)}
                placeholder="Start typing to search..."
                className="w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-stone-500 focus:border-stone-500"
              />
              {showCommanderDropdown && commanders.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-white border border-stone-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                  {commanders.map((c) => (
                    <button
                      key={c.name}
                      onClick={() => handleCommanderSelect(c)}
                      className="w-full px-3 py-2 text-left hover:bg-stone-100 flex items-center gap-2"
                    >
                      <span className="flex gap-0.5">
                        {c.colors.map(color => (
                          <span
                            key={color}
                            className={`w-4 h-4 rounded-full text-xs flex items-center justify-center ${colorSymbols[color] || 'bg-gray-300'}`}
                          >
                            {color}
                          </span>
                        ))}
                      </span>
                      <span className="font-medium">{c.name}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedCommander && (
                <div className="mt-1 text-xs text-stone-500">
                  {selectedCommander.type_line}
                </div>
              )}
            </div>

            {/* Bracket Selection */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Power Level Bracket
              </label>
              <select
                value={selectedBracket}
                onChange={(e) => setSelectedBracket(Number(e.target.value))}
                className="w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-stone-500 focus:border-stone-500"
              >
                {brackets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.id}. {b.name} (Power {b.power_level[0]}-{b.power_level[1]})
                  </option>
                ))}
              </select>
              {brackets.find(b => b.id === selectedBracket) && (
                <p className="mt-1 text-xs text-stone-500">
                  {brackets.find(b => b.id === selectedBracket)?.description}
                </p>
              )}
            </div>

            {/* Theme */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Theme / Strategy (optional)
              </label>
              <input
                type="text"
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="e.g., tokens, graveyard, +1/+1 counters..."
                className="w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-stone-500 focus:border-stone-500"
              />
            </div>

            {/* Budget Tier */}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">
                Budget
              </label>
              <select
                value={budgetTier}
                onChange={(e) => setBudgetTier(e.target.value)}
                className="w-full px-3 py-2 border border-stone-300 rounded-md shadow-sm focus:ring-stone-500 focus:border-stone-500"
              >
                {BUDGET_TIERS.map((tier) => (
                  <option key={tier.value} value={tier.value}>
                    {tier.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Error */}
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
                {error}
              </div>
            )}

            {/* Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={loading || !selectedCommander}
              className={`w-full px-6 py-3 text-sm font-medium rounded shadow-sm transition-colors
                ${loading || !selectedCommander
                  ? 'bg-stone-400 text-stone-200 cursor-not-allowed'
                  : 'bg-stone-900 text-stone-50 hover:bg-stone-800'
                }`}
            >
              {loading ? 'Generating...' : 'Generate Deck'}
            </button>

            {/* Rules Info */}
            <div className="text-xs text-stone-400 space-y-1">
              <p>Decks are built following Command Zone rules:</p>
              <ul className="list-disc list-inside pl-2">
                <li>Max 34 lands</li>
                <li>10+ ramp cards</li>
                <li>10+ card draw</li>
                <li>8+ removal spells</li>
                <li>2+ wincons</li>
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex justify-between items-center p-4 border-b border-stone-200 bg-white">
            <div className="text-sm text-stone-500">
              {selectedDeck.bracket_name && (
                <span className="font-medium">
                  Bracket {selectedDeck.bracket}: {selectedDeck.bracket_name}
                </span>
              )}
              {selectedDeck.theme && (
                <span className="ml-2">| Theme: {selectedDeck.theme}</span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleViewDeck(selectedDeck.id)}
                className="px-4 py-2 bg-stone-700 text-stone-50 text-xs font-medium rounded hover:bg-stone-600 transition-colors"
              >
                View Full Page
              </button>
              <button
                onClick={() => setSelectedDeckId(null)}
                className="px-4 py-2 bg-stone-900 text-stone-50 text-xs font-medium rounded hover:bg-stone-800 transition-colors"
              >
                Generate Another
              </button>
            </div>
          </div>
          <DeckDisplay deck={selectedDeck} />
        </div>
      )}
    </main>
  );
}
```

---

## Task 9: Create DeckViewerPage Placeholder

**Files:**
- Create: `frontend/src/pages/DeckViewerPage.tsx`

**Step 1: Create placeholder DeckViewerPage**

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Deck } from '../types';
import { DeckDisplay } from '../components/DeckDisplay';

async function fetchDeck(id: string): Promise<Deck> {
  const res = await fetch(`/api/deck/${id}`);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('Deck not found');
    }
    throw new Error('Failed to fetch deck');
  }
  return res.json();
}

export function DeckViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    setLoading(true);
    fetchDeck(id)
      .then(setDeck)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-stone-100">
        <div className="text-stone-500">Loading deck...</div>
      </div>
    );
  }

  if (error || !deck) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-stone-100 gap-4">
        <div className="text-red-600">{error || 'Deck not found'}</div>
        <Link
          to="/"
          className="px-4 py-2 bg-stone-900 text-stone-50 text-sm rounded hover:bg-stone-800"
        >
          Back to Generator
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex justify-between items-center p-4 border-b border-stone-200 bg-white">
        <div>
          <h1 className="text-xl font-serif text-stone-800">{deck.commander}</h1>
          <div className="text-sm text-stone-500">
            {deck.bracket_name && (
              <span>Bracket {deck.bracket}: {deck.bracket_name}</span>
            )}
            {deck.theme && (
              <span className="ml-2">| Theme: {deck.theme}</span>
            )}
          </div>
        </div>
        <Link
          to="/"
          className="px-4 py-2 bg-stone-900 text-stone-50 text-xs font-medium rounded hover:bg-stone-800 transition-colors"
        >
          Generate New Deck
        </Link>
      </div>

      {/* Placeholder for visual card view - will be enhanced in Phase 3 */}
      <DeckDisplay deck={deck} />
    </div>
  );
}
```

---

## Task 10: Update DeckHistory Component

**Files:**
- Modify: `frontend/src/components/DeckHistory.tsx`

**Step 1: Read current file to understand structure**

**Step 2: Add onViewFull prop for navigation**

Update the component to accept and use an `onViewFull` callback for the "View Full" button.

---

## Task 11: Update Main Entry Point

**Files:**
- Modify: `frontend/src/main.tsx`

**Step 1: Replace with RouterProvider**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
```

---

## Task 12: Update Types

**Files:**
- Modify: `frontend/src/types.ts`

**Step 1: Ensure Deck type has timestamp field**

Check and update if needed:

```typescript
export interface Deck {
  id: string;
  commander: string;
  colors: string[];
  archetype: string;
  timestamp: string;
  legal_status: string;
  card_count: number;
  estimated_price: string;
  list: string[];
  bracket: number;
  bracket_name: string;
  theme: string;
  categories: Record<string, string[]>;
}
```

---

## Task 13: Test Full Flow

**Step 1: Start backend**

Run:
```bash
cd /home/sheltron/Documents/Magic
source venv/bin/activate
python -m uvicorn backend.main:app --port 8000 &
```

**Step 2: Start frontend**

Run:
```bash
cd /home/sheltron/Documents/Magic/frontend
npm run dev &
```

**Step 3: Test in browser**

1. Open http://localhost:5173
2. Generate a deck
3. Note the deck ID
4. Navigate to http://localhost:5173/deck/{id}
5. Verify deck loads correctly
6. Refresh page - deck should still load (from database)
7. Go back to home, verify history persists

**Step 4: Cleanup**

Run: `pkill -f uvicorn && pkill -f vite`

---

## Summary

After completing all tasks:

- [x] SQLite database module created
- [x] Database initialized on startup
- [x] Decks saved to database on generation
- [x] GET /api/deck/:id endpoint
- [x] GET /api/recent-decks endpoint
- [x] POST /api/decks/batch endpoint
- [x] React Router installed and configured
- [x] GeneratorPage created (refactored from App.tsx)
- [x] DeckViewerPage created (placeholder)
- [x] localStorage history persistence
- [x] Navigation between pages working
