# Standalone Game, Deck URL Import, PWA & Hosting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the Shelector game into a standalone page with deck URL importing from 4 major MTG sites, add a landing page hub, host publicly via Cloudflare Tunnel, verify PWA support, and verify/fix spell casting UX.

**Architecture:** New landing page at `/` routes to deck generation (`/generate`) or standalone game (`/play`). New `PlayPage` absorbs functionality from `ShelectorGamePage` with a streamlined pre-game flow (URL paste → opponent config → play). Backend gets a new deck URL parser that fetches from Moxfield, Archidekt, TappedOut, and MTGGoldfish APIs, normalizing into the existing `ImportDeckResponse` format. Production build served by FastAPI for single-port Cloudflare Tunnel deployment.

**Tech Stack:** React 18 + TypeScript + Tailwind CSS + Vite (frontend), FastAPI + Python (backend), vite-plugin-pwa (already installed), Cloudflare Tunnel (existing), commander-engine (game logic in browser)

---

## Task 1: Deck URL Parser Backend

**Files:**
- Create: `backend/deck_url_parser.py`
- Modify: `backend/main.py` (add endpoint)
- Create: `backend/tests/test_deck_url_parser.py`

- [ ] **Step 1: Write tests for URL detection**

```python
# backend/tests/test_deck_url_parser.py
import pytest
from backend.deck_url_parser import detect_site, extract_deck_id

class TestDetectSite:
    def test_moxfield(self):
        assert detect_site("https://www.moxfield.com/decks/abc123") == "moxfield"
        assert detect_site("https://moxfield.com/decks/xYz_456") == "moxfield"

    def test_archidekt(self):
        assert detect_site("https://archidekt.com/decks/12345") == "archidekt"
        assert detect_site("https://www.archidekt.com/decks/12345/my-deck") == "archidekt"

    def test_tappedout(self):
        assert detect_site("https://tappedout.net/mtg-decks/my-cool-deck/") == "tappedout"

    def test_mtggoldfish(self):
        assert detect_site("https://www.mtggoldfish.com/deck/6543210") == "mtggoldfish"
        assert detect_site("https://www.mtggoldfish.com/archetype/standard-mono-red") == "mtggoldfish"

    def test_unknown(self):
        assert detect_site("https://google.com/something") is None

class TestExtractDeckId:
    def test_moxfield(self):
        assert extract_deck_id("https://moxfield.com/decks/abc123", "moxfield") == "abc123"

    def test_archidekt(self):
        assert extract_deck_id("https://archidekt.com/decks/12345/my-deck", "archidekt") == "12345"

    def test_tappedout(self):
        assert extract_deck_id("https://tappedout.net/mtg-decks/my-cool-deck/", "tappedout") == "my-cool-deck"

    def test_mtggoldfish_deck(self):
        assert extract_deck_id("https://www.mtggoldfish.com/deck/6543210", "mtggoldfish") == "6543210"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic" && python -m pytest backend/tests/test_deck_url_parser.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'backend.deck_url_parser'`

- [ ] **Step 3: Implement URL detection and ID extraction**

```python
# backend/deck_url_parser.py
"""Fetch and parse MTG decklists from popular deckbuilding sites."""

import re
import logging
from typing import Optional

import requests

logger = logging.getLogger(__name__)

SITE_PATTERNS = {
    "moxfield": re.compile(r"moxfield\.com/decks/([A-Za-z0-9_-]+)"),
    "archidekt": re.compile(r"archidekt\.com/decks/(\d+)"),
    "tappedout": re.compile(r"tappedout\.net/mtg-decks/([A-Za-z0-9_-]+)"),
    "mtggoldfish": re.compile(r"mtggoldfish\.com/(?:deck|archetype)/([A-Za-z0-9_#-]+)"),
}


def detect_site(url: str) -> Optional[str]:
    """Detect which deckbuilding site a URL belongs to."""
    for site, pattern in SITE_PATTERNS.items():
        if pattern.search(url):
            return site
    return None


def extract_deck_id(url: str, site: str) -> Optional[str]:
    """Extract the deck identifier from a URL for a given site."""
    pattern = SITE_PATTERNS.get(site)
    if not pattern:
        return None
    match = pattern.search(url)
    return match.group(1) if match else None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic" && python -m pytest backend/tests/test_deck_url_parser.py -v`
Expected: PASS

- [ ] **Step 5: Write tests for deck text parsing (shared by TappedOut and MTGGoldfish)**

Add to `backend/tests/test_deck_url_parser.py`:

```python
from backend.deck_url_parser import parse_decklist_text

class TestParseDecklistText:
    def test_basic_list(self):
        text = "1 Sol Ring\n1 Command Tower\n1 Atraxa, Praetors' Voice"
        result = parse_decklist_text(text)
        assert "Sol Ring" in result["cards"]
        assert len(result["cards"]) >= 2  # Commander gets separated

    def test_with_commander_section(self):
        text = """1 Sol Ring
1 Command Tower

Commander
1 Atraxa, Praetors' Voice"""
        result = parse_decklist_text(text)
        assert result["commander"] == "Atraxa, Praetors' Voice"

    def test_ignores_sideboard(self):
        text = """1 Sol Ring
Sideboard
1 Swords to Plowshares"""
        result = parse_decklist_text(text)
        assert "Swords to Plowshares" not in result["cards"]

    def test_strips_set_codes(self):
        text = "1 Sol Ring (C21) 267"
        result = parse_decklist_text(text)
        assert "Sol Ring" in result["cards"]
```

- [ ] **Step 6: Implement `parse_decklist_text`**

Add to `backend/deck_url_parser.py`:

```python
def parse_decklist_text(text: str) -> dict:
    """Parse a plaintext decklist into commander + cards.
    
    Handles formats from TappedOut, MTGGoldfish, and generic text exports.
    Returns: {"commander": str | None, "cards": list[str]}
    """
    lines = text.strip().split("\n")
    commander = None
    cards: list[str] = []
    in_commander_section = False
    in_sideboard = False

    for raw_line in lines:
        line = raw_line.strip()
        lower = line.lower()

        # Section headers
        if lower in ("commander", "commanders", "command zone"):
            in_commander_section = True
            in_sideboard = False
            continue
        if lower in ("sideboard", "maybeboard", "considering", "tokens"):
            in_sideboard = True
            in_commander_section = False
            continue
        if lower in ("deck", "mainboard", "main", "creatures", "instants",
                      "sorceries", "artifacts", "enchantments", "planeswalkers",
                      "lands", ""):
            in_commander_section = False
            in_sideboard = False
            if lower == "":
                continue
            continue

        if in_sideboard:
            continue

        # Parse "1 Card Name (SET) 123" or "1x Card Name"
        match = re.match(r"^(\d+)x?\s+(.+?)(?:\s+\([A-Z0-9]+\).*)?$", line)
        if not match:
            continue

        count = int(match.group(1))
        name = match.group(2).strip()

        if in_commander_section:
            commander = name
            in_commander_section = False
        else:
            for _ in range(count):
                cards.append(name)

    return {"commander": commander, "cards": cards}
```

- [ ] **Step 7: Run tests**

Run: `cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic" && python -m pytest backend/tests/test_deck_url_parser.py -v`
Expected: PASS

- [ ] **Step 8: Implement site-specific fetchers**

Add to `backend/deck_url_parser.py`:

```python
HEADERS = {
    "User-Agent": "MagicBrains/1.0 (MTG deck testing tool)",
    "Accept": "application/json",
}


def fetch_moxfield(deck_id: str) -> dict:
    """Fetch deck from Moxfield API. Returns {"commander": str|None, "cards": list[str]}."""
    url = f"https://api2.moxfield.com/v3/decks/all/{deck_id}"
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    commander = None
    cards: list[str] = []

    # Commanders section
    for name, entry in data.get("commanders", {}).items():
        commander = name
        break

    # Mainboard
    for name, entry in data.get("mainboard", {}).items():
        qty = entry.get("quantity", 1)
        for _ in range(qty):
            cards.append(name)

    return {"commander": commander, "cards": cards}


def fetch_archidekt(deck_id: str) -> dict:
    """Fetch deck from Archidekt API. Returns {"commander": str|None, "cards": list[str]}."""
    url = f"https://archidekt.com/api/decks/{deck_id}/"
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    data = resp.json()

    commander = None
    cards: list[str] = []

    for entry in data.get("cards", []):
        card = entry.get("card", {})
        name = card.get("oracleCard", {}).get("name", card.get("name", ""))
        qty = entry.get("quantity", 1)
        categories = [c.lower() for c in entry.get("categories", [])]

        if "commander" in categories:
            commander = name
        else:
            for _ in range(qty):
                cards.append(name)

    return {"commander": commander, "cards": cards}


def fetch_tappedout(deck_slug: str) -> dict:
    """Fetch deck from TappedOut text export. Returns {"commander": str|None, "cards": list[str]}."""
    url = f"https://tappedout.net/mtg-decks/{deck_slug}/?fmt=txt"
    resp = requests.get(url, headers={**HEADERS, "Accept": "text/plain"}, timeout=15)
    resp.raise_for_status()
    return parse_decklist_text(resp.text)


def fetch_mtggoldfish(deck_id: str) -> dict:
    """Fetch deck from MTGGoldfish download. Returns {"commander": str|None, "cards": list[str]}."""
    url = f"https://www.mtggoldfish.com/deck/download/{deck_id}"
    resp = requests.get(url, headers={**HEADERS, "Accept": "text/plain"}, timeout=15)
    resp.raise_for_status()
    return parse_decklist_text(resp.text)


FETCHERS = {
    "moxfield": fetch_moxfield,
    "archidekt": fetch_archidekt,
    "tappedout": fetch_tappedout,
    "mtggoldfish": fetch_mtggoldfish,
}


def fetch_deck_from_url(url: str) -> dict:
    """Detect site, fetch deck, return {"commander": str|None, "cards": list[str]}.
    
    Raises ValueError if URL is not recognized.
    Raises requests.HTTPError if fetch fails.
    """
    site = detect_site(url)
    if not site:
        raise ValueError(
            f"Unrecognized URL. Supported sites: Moxfield, Archidekt, TappedOut, MTGGoldfish"
        )

    deck_id = extract_deck_id(url, site)
    if not deck_id:
        raise ValueError(f"Could not extract deck ID from URL: {url}")

    logger.info(f"Fetching deck from {site}: {deck_id}")
    fetcher = FETCHERS[site]
    return fetcher(deck_id)
```

- [ ] **Step 9: Add the `/api/parse-deck-url` endpoint to `main.py`**

Add to `backend/main.py`:

```python
# Near top imports:
from backend.deck_url_parser import fetch_deck_from_url

# New request/response models (near existing models):
class ParseDeckURLRequest(BaseModel):
    url: str = Field(..., description="URL from Moxfield, Archidekt, TappedOut, or MTGGoldfish")

class ParseDeckURLResponse(BaseModel):
    commander: Optional[str]
    cards: List[str]
    site: str
    error: Optional[str] = None

# New endpoint (near existing endpoints):
@app.post("/api/parse-deck-url")
async def parse_deck_url(req: ParseDeckURLRequest):
    """Fetch and parse a deck from a popular MTG deckbuilding site URL."""
    try:
        result = fetch_deck_from_url(req.url)
        site = detect_site(req.url)
        return ParseDeckURLResponse(
            commander=result.get("commander"),
            cards=result.get("cards", []),
            site=site or "unknown",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to fetch deck from URL: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch deck: {str(e)}")
```

Also add the import at the top of `main.py`:
```python
from backend.deck_url_parser import fetch_deck_from_url, detect_site
```

- [ ] **Step 10: Commit**

```bash
git add backend/deck_url_parser.py backend/tests/test_deck_url_parser.py backend/main.py
git commit -m "feat: add deck URL parser for Moxfield, Archidekt, TappedOut, MTGGoldfish"
```

---

## Task 2: Landing Page

**Files:**
- Create: `frontend/src/pages/LandingPage.tsx`
- Modify: `frontend/src/router.tsx`

- [ ] **Step 1: Create LandingPage component**

```tsx
// frontend/src/pages/LandingPage.tsx
import { Link } from 'react-router-dom';
import { Sparkles, Swords } from 'lucide-react';

export function LandingPage() {
  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold mb-3 text-amber-100">
          Magic Brains
        </h1>
        <p className="text-stone-400 text-lg">
          MTG Commander deck generation & AI playtesting
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl w-full">
        <Link
          to="/generate"
          className="group bg-stone-800 border border-stone-700 rounded-xl p-8 hover:border-amber-600 hover:bg-stone-800/80 transition-all"
        >
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="w-8 h-8 text-amber-400 group-hover:text-amber-300" />
            <h2 className="text-2xl font-semibold">Generate a Deck</h2>
          </div>
          <p className="text-stone-400 group-hover:text-stone-300">
            Build a Commander deck tailored to your style, power level, and budget.
          </p>
        </Link>

        <Link
          to="/play"
          className="group bg-stone-800 border border-stone-700 rounded-xl p-8 hover:border-red-600 hover:bg-stone-800/80 transition-all"
        >
          <div className="flex items-center gap-3 mb-4">
            <Swords className="w-8 h-8 text-red-400 group-hover:text-red-300" />
            <h2 className="text-2xl font-semibold">Play a Game</h2>
          </div>
          <p className="text-stone-400 group-hover:text-stone-300">
            Import your deck from Moxfield, Archidekt, or any popular site and battle an AI opponent.
          </p>
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update router**

Replace `frontend/src/router.tsx` with:

```tsx
import { createBrowserRouter } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { GeneratorPage } from './pages/GeneratorPage';
import { DeckViewerPage } from './pages/DeckViewerPage';
import { OptimizerPage } from './pages/OptimizerPage';
import { ShelectorPage } from './pages/ShelectorPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    path: '/generate',
    element: <GeneratorPage />,
  },
  {
    path: '/deck/:id',
    element: <DeckViewerPage />,
  },
  {
    path: '/optimizer',
    element: <OptimizerPage />,
  },
  {
    path: '/shelector',
    element: <ShelectorPage />,
  },
]);
```

Note: `/play` route will be added in Task 3 once PlayPage exists. The old `/game` and `/shelector/game` routes are removed.

- [ ] **Step 3: Verify it compiles**

Run: `cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend" && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to LandingPage or router

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LandingPage.tsx frontend/src/router.tsx
git commit -m "feat: add landing page hub, move generator to /generate"
```

---

## Task 3: PlayPage — Standalone Game

**Files:**
- Create: `frontend/src/pages/PlayPage.tsx`
- Modify: `frontend/src/router.tsx` (add `/play` route)

This is the largest task. PlayPage absorbs the deck import, opponent setup, and game flow from ShelectorGamePage, but with:
- URL import tab (calls new `/api/parse-deck-url` then pipes result through `/shelector-api/import-deck`)
- No chat panel — full-width GameBoard
- GameReview modal on game end

- [ ] **Step 1: Create PlayPage with pre-game flow**

```tsx
// frontend/src/pages/PlayPage.tsx
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ClipboardPaste, Loader2, Swords, Link as LinkIcon, History, Trash2, Shield } from 'lucide-react';
import { useShelectorGame } from '../hooks/useShelectorGame';
import type { SpawnOptions } from '../hooks/useShelectorGame';
import { GameBoard } from '../components/GameBoard';
import { GameReview } from '../components/GameReview';
import { cacheSet, cacheGet } from '../lib/cache';

interface DeckImportResult {
  commander: string | null;
  cards: string[];
  lands: string[];
  card_data: Record<string, any>;
  total: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  filled_cards: string[];
}

interface DeckHistoryEntry {
  commander: string;
  text: string;
  timestamp: number;
}

const DECK_HISTORY_MAX = 5;

const COLOR_BADGES: Record<string, string> = {
  W: 'bg-amber-100 text-amber-800',
  U: 'bg-blue-100 text-blue-800',
  B: 'bg-gray-300 text-gray-900',
  R: 'bg-red-100 text-red-800',
  G: 'bg-green-100 text-green-800',
};

const PERSONALITIES = ['Balanced', 'Aggressive', 'Greedy', 'Political'] as const;

export function PlayPage() {
  const {
    gameState,
    legalActions,
    isLoading,
    isHumanTurn,
    isGameOver,
    winner,
    opponentInfo,
    error,
    mulliganPhase,
    mulliganCount,
    discardPhase,
    discardCount,
    tutorPhase,
    tutorCards,
    tutorTitle,
    gameLog,
    spawnOpponent,
    startGame,
    submitAction,
    keepHand,
    mulligan,
    discardCard,
    resolveTutor,
    undosRemaining,
    undoAction,
    coachMode,
    setCoachMode,
    untapManaSource,
    untappableCardIds,
  } = useShelectorGame();

  // Pre-game state
  const [step, setStep] = useState<'import' | 'opponent' | 'game'>('import');
  const [importTab, setImportTab] = useState<'url' | 'text'>('url');
  const [deckUrl, setDeckUrl] = useState('');
  const [deckText, setDeckText] = useState('');
  const [importResult, setImportResult] = useState<DeckImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Opponent config
  const [spawnMode, setSpawnMode] = useState<'random' | 'counter' | 'pool'>('random');
  const [spawnBracket, setSpawnBracket] = useState(3);
  const [colorFilter, setColorFilter] = useState<Record<string, boolean>>({
    W: false, U: false, B: false, R: false, G: false,
  });
  const [personality, setPersonality] = useState<string>('Balanced');
  const [isSpawning, setIsSpawning] = useState(false);
  const [isGeneratingAIDeck, setIsGeneratingAIDeck] = useState(false);

  // Deck history
  const [deckHistory, setDeckHistory] = useState<DeckHistoryEntry[]>([]);
  const [showDeckHistory, setShowDeckHistory] = useState(false);

  // Review modal
  const [showReview, setShowReview] = useState(false);

  // Load saved deck data
  useEffect(() => {
    const savedText = cacheGet<string>('last_deck_text');
    if (savedText) setDeckText(savedText);
    const savedResult = cacheGet<DeckImportResult>('last_deck_result');
    if (savedResult) setImportResult(savedResult);
    const savedHistory = cacheGet<DeckHistoryEntry[]>('deck_history');
    if (savedHistory) setDeckHistory(savedHistory);
  }, []);

  // Show review when game ends
  useEffect(() => {
    if (isGameOver) setShowReview(true);
  }, [isGameOver]);

  const addToDeckHistory = (commander: string, text: string) => {
    setDeckHistory(prev => {
      const filtered = prev.filter(e => e.commander !== commander);
      const entry: DeckHistoryEntry = { commander, text, timestamp: Date.now() };
      const updated = [entry, ...filtered].slice(0, DECK_HISTORY_MAX);
      cacheSet('deck_history', updated, 30 * 24 * 60 * 60 * 1000);
      return updated;
    });
  };

  const handleImportFromUrl = async () => {
    if (!deckUrl.trim()) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      // Step 1: Fetch card list from URL
      const parseRes = await fetch('/api/parse-deck-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: deckUrl }),
      });
      if (!parseRes.ok) {
        const err = await parseRes.json().catch(() => ({}));
        throw new Error(err.detail || `Failed to fetch deck (${parseRes.status})`);
      }
      const parsed = await parseRes.json();

      // Step 2: Build decklist text and run through import-deck for validation
      const lines: string[] = [];
      if (parsed.commander) lines.push(`1 ${parsed.commander}`);
      for (const card of parsed.cards) lines.push(`1 ${card}`);
      const listText = lines.join('\n');

      const importRes = await fetch('/shelector-api/import-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: listText,
          bracket: spawnBracket,
          fill_missing: true,
        }),
      });
      if (!importRes.ok) throw new Error(`Import validation failed (${importRes.status})`);
      const data: DeckImportResult = await importRes.json();
      setImportResult(data);

      if (data.commander) {
        addToDeckHistory(data.commander, listText);
        cacheSet('last_deck_text', listText, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to import deck from URL');
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportFromText = async () => {
    if (!deckText.trim()) return;
    setIsImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch('/shelector-api/import-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decklist_text: deckText,
          bracket: spawnBracket,
          fill_missing: true,
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data: DeckImportResult = await res.json();
      setImportResult(data);

      if (data.commander) {
        addToDeckHistory(data.commander, deckText);
        cacheSet('last_deck_text', deckText, 30 * 24 * 60 * 60 * 1000);
        cacheSet('last_deck_result', data, 30 * 24 * 60 * 60 * 1000);
      }
    } catch (err: any) {
      setImportError(err.message || 'Failed to import deck');
    } finally {
      setIsImporting(false);
    }
  };

  const handleSpawnAndStart = async () => {
    if (!importResult?.valid) return;
    setIsSpawning(true);
    setImportError(null);
    try {
      const avoidColors = Object.entries(colorFilter)
        .filter(([, v]) => v)
        .map(([k]) => k);

      // Step 1: Spawn opponent — returns opponent info directly
      const spawnRes = await fetch('/shelector-api/spawn-opponent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: spawnMode,
          bracket: spawnBracket,
          avoid_colors: avoidColors,
          human_commander: importResult.commander || null,
          human_colors: importResult.card_data[importResult.commander || '']?.color_identity || [],
        }),
      });
      if (!spawnRes.ok) throw new Error(`Failed to spawn opponent (${spawnRes.status})`);
      const opponent = await spawnRes.json();

      // Step 2: Generate AI deck using spawned commander
      setIsGeneratingAIDeck(true);
      const aiRes = await fetch('/shelector-api/generate-ai-deck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          commander: opponent.commander,
          bracket: spawnBracket,
        }),
      });
      if (!aiRes.ok) throw new Error(`Failed to generate AI deck (${aiRes.status})`);
      const aiDeck = await aiRes.json();

      // Step 3: Start the game with both decks
      startGame(
        {
          commander: importResult.commander || '',
          cards: importResult.cards,
          lands: importResult.lands,
          cardData: importResult.card_data,
        },
        {
          commander: aiDeck.commander,
          cards: aiDeck.cards,
          lands: aiDeck.lands,
          cardData: aiDeck.card_data,
        }
      );
      setStep('game');
    } catch (err: any) {
      setImportError(err.message || 'Failed to start game');
    } finally {
      setIsSpawning(false);
      setIsGeneratingAIDeck(false);
    }
  };

  // ----- RENDER -----

  // Game view (full width, no chat)
  if (step === 'game' && gameState) {
    return (
      <div className="min-h-screen bg-stone-900 text-stone-100 flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-stone-800 border-b border-stone-700">
          <button
            onClick={() => setShowReview(true)}
            className="text-sm text-stone-400 hover:text-stone-200"
          >
            End Game
          </button>
          <span className="text-sm text-stone-500">
            Turn {gameState.turnNumber} &middot; {gameState.phase}
          </span>
        </div>

        {/* Full-width board */}
        <div className="flex-1">
          <GameBoard
            gameState={gameState}
            legalActions={legalActions}
            isHumanTurn={isHumanTurn}
            isLoading={isLoading}
            onAction={submitAction}
            mulliganPhase={mulliganPhase}
            mulliganCount={mulliganCount}
            onKeepHand={keepHand}
            onMulligan={mulligan}
            discardPhase={discardPhase}
            discardCount={discardCount}
            onDiscardCard={discardCard}
            tutorPhase={tutorPhase}
            tutorCards={tutorCards}
            tutorTitle={tutorTitle}
            onTutorPick={resolveTutor}
            undosRemaining={undosRemaining}
            onUndo={undoAction}
            coachMode={coachMode}
            onToggleCoach={setCoachMode}
            onUntapMana={untapManaSource}
            untappableCardIds={untappableCardIds}
          />
        </div>

        {/* Review modal */}
        {showReview && (
          <GameReview
            gameLog={gameLog}
            finalState={gameState}
            winner={winner}
            onClose={() => setShowReview(false)}
          />
        )}
      </div>
    );
  }

  // Pre-game view
  return (
    <div className="min-h-screen bg-stone-900 text-stone-100 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <Link to="/" className="text-stone-400 hover:text-stone-200">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-2xl font-bold">Play a Game</h1>
        </div>

        {/* Step 1: Import */}
        <div className="bg-stone-800 rounded-xl border border-stone-700 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <ClipboardPaste className="w-5 h-5 text-amber-400" />
            Import Your Deck
          </h2>

          {/* Tabs */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setImportTab('url')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                importTab === 'url'
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
              }`}
            >
              <LinkIcon className="w-4 h-4 inline mr-1" />
              Paste URL
            </button>
            <button
              onClick={() => setImportTab('text')}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                importTab === 'text'
                  ? 'bg-amber-600 text-white'
                  : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
              }`}
            >
              <ClipboardPaste className="w-4 h-4 inline mr-1" />
              Paste Decklist
            </button>

            {/* Deck history */}
            {deckHistory.length > 0 && (
              <button
                onClick={() => setShowDeckHistory(!showDeckHistory)}
                className="ml-auto px-3 py-2 rounded-lg text-sm bg-stone-700 text-stone-300 hover:bg-stone-600"
              >
                <History className="w-4 h-4 inline mr-1" />
                Recent
              </button>
            )}
          </div>

          {/* History dropdown */}
          {showDeckHistory && (
            <div className="mb-4 bg-stone-700/50 rounded-lg p-3 space-y-2">
              {deckHistory.map(entry => (
                <div key={entry.commander} className="flex items-center justify-between">
                  <button
                    onClick={() => {
                      setDeckText(entry.text);
                      setImportTab('text');
                      setShowDeckHistory(false);
                    }}
                    className="text-sm text-stone-200 hover:text-amber-300"
                  >
                    {entry.commander}
                  </button>
                  <button
                    onClick={() => {
                      setDeckHistory(prev => {
                        const updated = prev.filter(e => e.commander !== entry.commander);
                        cacheSet('deck_history', updated, 30 * 24 * 60 * 60 * 1000);
                        return updated;
                      });
                    }}
                    className="text-stone-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* URL input */}
          {importTab === 'url' && (
            <div>
              <input
                type="text"
                value={deckUrl}
                onChange={e => setDeckUrl(e.target.value)}
                placeholder="https://www.moxfield.com/decks/..."
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500 mb-3"
              />
              <p className="text-xs text-stone-500 mb-3">
                Supports Moxfield, Archidekt, TappedOut, and MTGGoldfish
              </p>
              <button
                onClick={handleImportFromUrl}
                disabled={isImporting || !deckUrl.trim()}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-medium transition-colors"
              >
                {isImporting ? (
                  <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Importing...</>
                ) : (
                  'Import Deck'
                )}
              </button>
            </div>
          )}

          {/* Text input */}
          {importTab === 'text' && (
            <div>
              <textarea
                value={deckText}
                onChange={e => setDeckText(e.target.value)}
                placeholder={"1 Atraxa, Praetors' Voice\n1 Sol Ring\n1 Command Tower\n..."}
                rows={8}
                className="w-full bg-stone-700 border border-stone-600 rounded-lg px-4 py-3 text-stone-100 placeholder-stone-500 focus:outline-none focus:border-amber-500 mb-3 font-mono text-sm"
              />
              <button
                onClick={handleImportFromText}
                disabled={isImporting || !deckText.trim()}
                className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-medium transition-colors"
              >
                {isImporting ? (
                  <><Loader2 className="w-4 h-4 inline mr-2 animate-spin" />Importing...</>
                ) : (
                  'Import Deck'
                )}
              </button>
            </div>
          )}

          {/* Import errors */}
          {importError && (
            <div className="mt-4 p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
              {importError}
            </div>
          )}

          {/* Import results */}
          {importResult && (
            <div className="mt-4 p-4 bg-stone-700/50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-amber-200">
                  {importResult.commander || 'Unknown Commander'}
                </span>
                <span className="text-sm text-stone-400">{importResult.total} cards</span>
              </div>
              {importResult.warnings.length > 0 && (
                <div className="text-xs text-amber-400 space-y-1">
                  {importResult.warnings.map((w, i) => <div key={i}>{w}</div>)}
                </div>
              )}
              {importResult.errors.length > 0 && (
                <div className="text-xs text-red-400 space-y-1 mt-1">
                  {importResult.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}
              {importResult.valid && (
                <button
                  onClick={() => setStep('opponent')}
                  className="mt-3 px-6 py-2.5 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors flex items-center gap-2"
                >
                  <Swords className="w-4 h-4" />
                  Choose Opponent
                </button>
              )}
            </div>
          )}
        </div>

        {/* Step 2: Opponent Setup */}
        {step === 'opponent' && importResult?.valid && (
          <div className="bg-stone-800 rounded-xl border border-stone-700 p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-5 h-5 text-red-400" />
              Opponent Setup
            </h2>

            {/* Bracket */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Power Level (Bracket)</label>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map(b => (
                  <button
                    key={b}
                    onClick={() => setSpawnBracket(b)}
                    className={`w-10 h-10 rounded-lg font-bold transition-colors ${
                      spawnBracket === b
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {b}
                  </button>
                ))}
              </div>
            </div>

            {/* Spawn mode */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Opponent Selection</label>
              <div className="flex gap-2 flex-wrap">
                {(['random', 'counter', 'pool'] as const).map(mode => (
                  <button
                    key={mode}
                    onClick={() => setSpawnMode(mode)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                      spawnMode === mode
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Color filter */}
            <div className="mb-4">
              <label className="text-sm text-stone-400 block mb-2">Exclude Colors</label>
              <div className="flex gap-2">
                {Object.entries(COLOR_BADGES).map(([color, badge]) => (
                  <button
                    key={color}
                    onClick={() => setColorFilter(prev => ({ ...prev, [color]: !prev[color] }))}
                    className={`w-9 h-9 rounded-full text-sm font-bold transition-all ${
                      colorFilter[color]
                        ? `${badge} ring-2 ring-offset-2 ring-offset-stone-800 ring-amber-500`
                        : 'bg-stone-700 text-stone-400'
                    }`}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>

            {/* Personality */}
            <div className="mb-6">
              <label className="text-sm text-stone-400 block mb-2">AI Personality</label>
              <div className="flex gap-2 flex-wrap">
                {PERSONALITIES.map(p => (
                  <button
                    key={p}
                    onClick={() => setPersonality(p)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      personality === p
                        ? 'bg-amber-600 text-white'
                        : 'bg-stone-700 text-stone-300 hover:bg-stone-600'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Opponent info (after spawn) */}
            {opponentInfo && (
              <div className="mb-4 p-3 bg-stone-700/50 rounded-lg">
                <span className="text-amber-200 font-semibold">{opponentInfo.commander}</span>
                <span className="text-stone-400 text-sm ml-2">
                  ({opponentInfo.personality} &middot; {opponentInfo.colors?.join('')})
                </span>
              </div>
            )}

            {/* Start button */}
            <button
              onClick={handleSpawnAndStart}
              disabled={isSpawning || isGeneratingAIDeck}
              className="w-full py-3 bg-red-600 hover:bg-red-500 disabled:bg-stone-600 disabled:text-stone-400 rounded-lg font-bold text-lg transition-colors flex items-center justify-center gap-2"
            >
              {isSpawning || isGeneratingAIDeck ? (
                <><Loader2 className="w-5 h-5 animate-spin" />Setting up game...</>
              ) : (
                <><Swords className="w-5 h-5" />Start Game</>
              )}
            </button>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add `/play` route to router**

Add to `frontend/src/router.tsx`:

```tsx
// Add import at top:
import { PlayPage } from './pages/PlayPage';

// Add route:
{
  path: '/play',
  element: <PlayPage />,
},
```

- [ ] **Step 3: Verify it compiles**

Run: `cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend" && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors related to PlayPage

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PlayPage.tsx frontend/src/router.tsx
git commit -m "feat: add standalone PlayPage with URL import and opponent setup"
```

---

## Task 4: Update DeckViewerPage and Remove Old Pages

**Files:**
- Modify: `frontend/src/pages/DeckViewerPage.tsx` (remove TestDeckModal, add link to /play)
- Delete references to: `GamePage.tsx`, `ShelectorGamePage.tsx`, `TestDeckModal.tsx`

- [ ] **Step 1: Update DeckViewerPage**

In `frontend/src/pages/DeckViewerPage.tsx`:
- Remove import and usage of `TestDeckModal`
- Remove `showTestModal` state
- Remove the "Test Deck" button that opens the modal
- Add a simple link to `/play`:

```tsx
// Replace the TestDeckModal button with:
<Link
  to="/play"
  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium flex items-center gap-2"
>
  <Swords className="w-4 h-4" />
  Play This Deck
</Link>
```

Add `Swords` to the lucide-react import and `Link` to the react-router-dom import if not already there.

- [ ] **Step 2: Verify it compiles**

Run: `cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend" && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors. Unused files (GamePage, ShelectorGamePage, TestDeckModal) may show warnings but won't break compilation.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/DeckViewerPage.tsx
git commit -m "refactor: replace TestDeckModal with link to /play in DeckViewerPage"
```

---

## Task 5: Spell Casting UX Verification and Fix

**Files:**
- Inspect: `frontend/src/hooks/useShelectorGame.ts` (lines ~780-850, ~2280-2340)
- Inspect: `frontend/src/components/GameBoard.tsx` (card rendering, action buttons)
- Potentially modify: `GameBoard.tsx` if cast buttons aren't clear enough

The auto-tap system already exists in `useShelectorGame.ts`:
- `findLandsToTap()` (line ~305) — greedy algorithm for land tapping
- `couldCastWithLands()` (line ~289) — checks if casting is possible
- `submitAction` CastSpell handler (line ~2280) — auto-taps lands before casting

- [ ] **Step 1: Verify auto-tap works end-to-end**

Read through the existing CastSpell flow in `useShelectorGame.ts` and `GameBoard.tsx` to confirm:
1. Castable spells appear in `legalActions` with `kind === 'CastSpell'`
2. GameBoard shows a visual indicator (highlight, button) for castable cards
3. Clicking a castable card calls `onAction()` which triggers auto-tap

If the flow is already working, document it and move on. If there's a gap (e.g., castable cards aren't highlighted, or auto-tap doesn't fire), fix it.

- [ ] **Step 2: Verify GameBoard shows mana cost info on castable cards**

Check that when a card is castable, the UI shows the mana cost and makes it obvious the card can be played. If not, add a visual indicator:

```tsx
// In the hand card rendering section of GameBoard.tsx, ensure castable cards are highlighted:
// The existing code should have playableIds set derived from legalActions.
// Verify cards with kind === 'CastSpell' are in playableIds and get the green ring / highlight.
```

- [ ] **Step 3: Add "Not enough mana" feedback if casting fails**

In the GameBoard, if a user taps a non-castable card, show a brief tooltip or flash message indicating they don't have enough mana. Check if this feedback already exists in the current code. If not, add it to the card click handler.

- [ ] **Step 4: Commit (if changes were needed)**

```bash
git add frontend/src/components/GameBoard.tsx frontend/src/hooks/useShelectorGame.ts
git commit -m "fix: verify and improve spell casting UX with auto-tap feedback"
```

---

## Task 6: Mobile Responsiveness Pass

**Files:**
- Modify: `frontend/src/pages/LandingPage.tsx` (if needed)
- Modify: `frontend/src/pages/PlayPage.tsx` (if needed)
- Modify: `frontend/src/components/GameBoard.tsx` (if needed)

- [ ] **Step 1: Audit LandingPage on mobile viewport**

Open Chrome DevTools, set viewport to 375x667 (iPhone SE). Check:
- Cards stack vertically (the `grid-cols-1 sm:grid-cols-2` should handle this)
- Text is readable, buttons are large enough (min 48px touch target)
- No horizontal overflow

Fix any issues found.

- [ ] **Step 2: Audit PlayPage pre-game on mobile viewport**

Check at 375x667:
- URL input is full width
- Tab buttons are reachable
- Opponent setup controls stack properly
- Start Game button is prominent and reachable

Fix any issues found.

- [ ] **Step 3: Audit GameBoard on mobile viewport**

Check at 375x667:
- Cards don't overlap or overflow
- Hand cards are scrollable horizontally
- Action buttons are large enough
- Phase bar text is readable
- Mana pool display is visible

Fix any issues found.

- [ ] **Step 4: Ensure GameReview modal is full-screen on mobile**

In `GameReview.tsx`, verify the modal uses `max-h-screen overflow-y-auto` on mobile. If not, add:

```tsx
// Wrapper div should have:
className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-2 sm:p-6"
// Inner panel should have:
className="bg-stone-800 rounded-xl w-full max-w-3xl max-h-[95vh] overflow-y-auto"
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LandingPage.tsx frontend/src/pages/PlayPage.tsx frontend/src/components/GameBoard.tsx frontend/src/components/GameReview.tsx
git commit -m "fix: mobile responsiveness for landing, play page, game board, and review"
```

---

## Task 7: PWA Verification

**Files:**
- Inspect: `frontend/vite.config.ts` (already has VitePWA configured)
- Inspect: `frontend/public/manifest.json` (already exists)
- Inspect: `frontend/index.html` (already has manifest link + theme-color)
- Potentially modify: `frontend/vite.config.ts` (add `/shelector-api` caching)

PWA is already configured with `vite-plugin-pwa`. Manifest exists. Service worker auto-registers.

- [ ] **Step 1: Verify PWA manifest and icons**

Check that `frontend/public/icon-192.png` and `frontend/public/icon-512.png` exist:

```bash
ls frontend/public/icon-*.png
```

If missing, create placeholder icons (solid color squares) so the PWA install prompt works.

- [ ] **Step 2: Add Shelector API caching to service worker config**

In `frontend/vite.config.ts`, add a runtime caching rule for `/shelector-api` alongside the existing `/api` rule:

```typescript
// Add after the existing /api caching rule:
{
  urlPattern: /\/shelector-api\/.*/i,
  handler: 'NetworkFirst',
  options: {
    cacheName: 'shelector-api-cache',
    expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 },
    cacheableResponse: { statuses: [0, 200] },
  },
},
```

- [ ] **Step 3: Build and verify service worker generates**

```bash
cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend" && npm run build 2>&1 | tail -10
ls dist/sw.js 2>/dev/null || ls dist/registerSW.js 2>/dev/null || echo "No service worker found"
```

- [ ] **Step 4: Commit**

```bash
git add frontend/vite.config.ts frontend/public/
git commit -m "chore: verify PWA config, add shelector-api caching"
```

---

## Task 8: Production Build & Static Serving from Backend

**Files:**
- Modify: `backend/main.py` (add static file serving + SPA fallback)

- [ ] **Step 1: Build the frontend**

```bash
cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend" && npm run build
```

Expected: `dist/` folder with `index.html`, JS bundles, assets.

- [ ] **Step 2: Add static file serving to FastAPI**

At the bottom of `backend/main.py` (after all API routes), add:

```python
import os
from pathlib import Path
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Serve frontend build (production only)
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    # Serve other static files (manifest, icons, sw)
    @app.get("/manifest.json")
    async def manifest():
        return FileResponse(str(FRONTEND_DIST / "manifest.json"))

    @app.get("/sw.js")
    async def service_worker():
        return FileResponse(str(FRONTEND_DIST / "sw.js"), media_type="application/javascript")

    @app.get("/registerSW.js")
    async def register_sw():
        path = FRONTEND_DIST / "registerSW.js"
        if path.exists():
            return FileResponse(str(path), media_type="application/javascript")
        raise HTTPException(status_code=404)

    # SPA fallback: any non-API, non-asset route serves index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        # Don't catch API routes
        if full_path.startswith("api/") or full_path.startswith("shelector-api/"):
            raise HTTPException(status_code=404)
        # Try to serve the file directly (for icons, etc.)
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        # Fallback to index.html for SPA routing
        return FileResponse(str(FRONTEND_DIST / "index.html"))
```

- [ ] **Step 3: Add Shelector API proxy to backend**

The frontend in production won't have Vite's proxy, so we need to forward `/shelector-api/*` requests from the backend to port 8100. Add to `backend/main.py`:

```python
# Proxy /shelector-api/* to the Shelector service (port 8100)
@app.api_route("/shelector-api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_shelector(path: str, request: Request):
    """Forward requests to the Shelector agent service."""
    import httpx
    async with httpx.AsyncClient() as client:
        target_url = f"http://localhost:8100/{path}"
        body = await request.body()
        resp = await client.request(
            method=request.method,
            url=target_url,
            headers={k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")},
            content=body,
            params=request.query_params,
            timeout=30.0,
        )
        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=dict(resp.headers),
        )
```

Add `from fastapi import Request, Response` to imports. Also add `httpx` to requirements:

```bash
pip install httpx && echo "httpx" >> backend/requirements.txt
```

Note: Put this route **before** the SPA fallback catch-all but **after** all `/api/*` routes.

- [ ] **Step 4: Update CORS to allow tunnel URL**

In `backend/main.py`, update the CORS middleware:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$|^https://.*\.trycloudflare\.com$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

The regex `.*\.trycloudflare\.com` covers Cloudflare quick tunnels. If using a custom domain, add it to `allow_origins`.

- [ ] **Step 5: Test the production setup locally**

```bash
cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic"
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# In a browser, visit http://localhost:8000
# Should see the landing page
# Navigate to /play — should work
# Navigate to /generate — should work
```

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/requirements.txt
git commit -m "feat: serve frontend production build from FastAPI with SPA routing and shelector proxy"
```

---

## Task 9: Cloudflare Tunnel Configuration

**Files:**
- Modify: Cloudflare Tunnel config (wherever the existing NBA tunnel config lives)

- [ ] **Step 1: Find existing tunnel config**

```bash
# Check common locations
cat ~/.cloudflared/config.yml 2>/dev/null || cat ~/.cloudflared/config.yaml 2>/dev/null || echo "Config not found in default location"
cloudflared tunnel list 2>/dev/null
```

- [ ] **Step 2: Add MTG service to tunnel config**

Add a new ingress rule for the MTG app. The exact config depends on the tunnel setup, but typically:

```yaml
# Add to the ingress section of config.yml:
- hostname: mtg.yourdomain.com  # or whatever subdomain
  service: http://localhost:8000
```

Or if using Cloudflare quick tunnel for testing:

```bash
# Simple quick tunnel (temporary URL):
cloudflared tunnel --url http://localhost:8000
```

- [ ] **Step 3: Add the public URL to CORS**

Once the tunnel URL is known, add it to `allow_origins` in `backend/main.py`:

```python
allow_origins=[
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "https://mtg.yourdomain.com",  # Add actual tunnel URL
],
```

- [ ] **Step 4: Test public access**

Open the tunnel URL on a phone or different device. Verify:
- Landing page loads
- Can navigate to /play
- Can paste a deck URL and import it
- Can start a game
- Game board renders properly

- [ ] **Step 5: Commit**

```bash
git add backend/main.py
git commit -m "feat: add Cloudflare Tunnel CORS and hosting config"
```

---

## Task 10: End-to-End Testing

- [ ] **Step 1: Start all services**

```bash
cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic" && ./start.sh
```

- [ ] **Step 2: Test landing page**

1. Open `http://localhost:5173` (dev) or `http://localhost:8000` (production)
2. Verify two cards render: "Generate a Deck" and "Play a Game"
3. Click "Generate a Deck" — should navigate to `/generate` with the full generator
4. Go back, click "Play a Game" — should navigate to `/play`

- [ ] **Step 3: Test deck URL import**

On `/play`:
1. Paste a Moxfield deck URL → click Import → verify commander and card count appear
2. Test with an Archidekt URL
3. Test with an invalid URL → verify error message appears
4. Switch to "Paste Decklist" tab → paste a text decklist → verify import works

- [ ] **Step 4: Test game flow**

1. After importing a deck, click "Choose Opponent"
2. Set bracket to 3, mode to random, click "Start Game"
3. Verify the game board appears full-width (no chat panel)
4. Verify you can see your hand, battlefield, and the opponent's board
5. Try casting a spell — verify auto-tap works (lands tap automatically, mana message appears)
6. Play a few turns to confirm turns advance

- [ ] **Step 5: Test game review**

1. Click "End Game" in the top bar
2. Verify GameReview modal opens
3. Close the modal

- [ ] **Step 6: Test mobile viewport**

1. Open Chrome DevTools → toggle device toolbar → select iPhone SE (375x667)
2. Check landing page — cards should stack vertically
3. Check `/play` — inputs should be full width, controls should stack
4. Start a game — board should be usable (cards visible, scrollable hand)

- [ ] **Step 7: Test production build**

```bash
cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic/frontend" && npm run build
cd "C:/Users/whate/Documents/AI Locally/Magic Brains/Magic" && python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
# Visit http://localhost:8000, repeat tests from steps 2-6
```
