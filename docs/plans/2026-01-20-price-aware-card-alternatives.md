# Price-Aware Card Alternatives Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an ensemble ranking system that finds cheaper card alternatives using FAISS, GPT2, and Qwen models with daily auto-updates.

**Architecture:** FAISS finds semantically similar cards, GPT2 and Qwen models score candidates, ensemble ranker combines scores with category matching, Qwen generates trade-off explanations. Daily cron job updates prices from MTGJson and card data from Scryfall.

**Tech Stack:** Python, FastAPI, FAISS, sentence-transformers, transformers (GPT2), llama-cpp-python (Qwen GGUF), SQLite, React/TypeScript

---

## Phase 1: Price Service & Data Model

### Task 1: Create Price Service Module

**Files:**
- Create: `backend/price_service.py`
- Test: `backend/tests/test_price_service.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_price_service.py
import pytest
from backend.price_service import fetch_mtgjson_prices, get_card_prices

def test_fetch_mtgjson_prices_returns_dict():
    """Test that MTGJson price fetch returns a dictionary."""
    # This will fail initially - function doesn't exist
    result = fetch_mtgjson_prices()
    assert isinstance(result, dict)
    assert len(result) > 0

def test_get_card_prices_returns_vendor_prices():
    """Test getting prices for a specific card."""
    prices = get_card_prices("Sol Ring")
    assert "tcgplayer" in prices or "cardkingdom" in prices
    assert any(p.get("usd") is not None for p in prices.values())
```

**Step 2: Run test to verify it fails**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_price_service.py -v`
Expected: FAIL with "ModuleNotFoundError" or "cannot import name"

**Step 3: Create tests directory if needed**

```bash
mkdir -p backend/tests
touch backend/tests/__init__.py
```

**Step 4: Write minimal implementation**

```python
# backend/price_service.py
"""Service for fetching card prices from MTGJson."""

import json
import requests
from typing import Dict, Optional
from pathlib import Path
from datetime import datetime

MTGJSON_PRICES_URL = "https://mtgjson.com/api/v5/AllPrices.json"
PRICE_CACHE_PATH = Path(__file__).parent.parent / "data" / "price_cache.json"

_price_cache: Optional[Dict] = None
_cache_timestamp: Optional[datetime] = None


def fetch_mtgjson_prices(force_refresh: bool = False) -> Dict:
    """
    Fetch all card prices from MTGJson.
    Caches results to avoid repeated downloads.
    """
    global _price_cache, _cache_timestamp

    # Return cached if available and fresh (< 1 hour)
    if not force_refresh and _price_cache is not None:
        if _cache_timestamp and (datetime.now() - _cache_timestamp).seconds < 3600:
            return _price_cache

    # Try loading from disk cache first
    if not force_refresh and PRICE_CACHE_PATH.exists():
        try:
            with open(PRICE_CACHE_PATH, 'r') as f:
                cached = json.load(f)
                if cached.get('timestamp'):
                    cache_time = datetime.fromisoformat(cached['timestamp'])
                    # Use disk cache if less than 24 hours old
                    if (datetime.now() - cache_time).days < 1:
                        _price_cache = cached.get('data', {})
                        _cache_timestamp = cache_time
                        return _price_cache
        except (json.JSONDecodeError, KeyError):
            pass

    # Fetch from MTGJson
    print("Fetching prices from MTGJson (this may take a moment)...")
    response = requests.get(MTGJSON_PRICES_URL, timeout=120)
    response.raise_for_status()

    data = response.json()
    _price_cache = data.get('data', {})
    _cache_timestamp = datetime.now()

    # Save to disk cache
    PRICE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PRICE_CACHE_PATH, 'w') as f:
        json.dump({
            'timestamp': _cache_timestamp.isoformat(),
            'data': _price_cache
        }, f)

    return _price_cache


def get_card_prices(card_name: str, card_uuid: Optional[str] = None) -> Dict:
    """
    Get prices for a specific card from multiple vendors.

    Returns:
        {
            "tcgplayer": {"usd": 2.50, "url": "https://..."},
            "cardkingdom": {"usd": 2.99, "url": "https://..."},
            "cardmarket": {"eur": 1.80, "url": "https://..."}
        }
    """
    prices_data = fetch_mtgjson_prices()

    result = {
        "tcgplayer": {"usd": None, "url": None},
        "cardkingdom": {"usd": None, "url": None},
        "cardmarket": {"eur": None, "url": None}
    }

    # MTGJson uses UUIDs as keys, we need to search
    # For now, we'll also accept looking up by name from Scryfall prices
    # which are already in our card data

    # Search through price data for matching card
    for uuid, card_prices in prices_data.items():
        if card_uuid and uuid == card_uuid:
            _extract_prices(card_prices, result, card_name)
            break

    return result


def _extract_prices(card_prices: Dict, result: Dict, card_name: str) -> None:
    """Extract vendor prices from MTGJson price data."""
    paper_prices = card_prices.get('paper', {})

    # TCGPlayer
    tcg = paper_prices.get('tcgplayer', {}).get('retail', {}).get('normal', {})
    if tcg:
        # Get most recent price
        latest_date = max(tcg.keys()) if tcg else None
        if latest_date:
            result['tcgplayer']['usd'] = tcg[latest_date]
            result['tcgplayer']['url'] = f"https://www.tcgplayer.com/search/magic/product?q={card_name.replace(' ', '+')}"

    # Card Kingdom
    ck = paper_prices.get('cardkingdom', {}).get('retail', {}).get('normal', {})
    if ck:
        latest_date = max(ck.keys()) if ck else None
        if latest_date:
            result['cardkingdom']['usd'] = ck[latest_date]
            result['cardkingdom']['url'] = f"https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D={card_name.replace(' ', '+')}"

    # Cardmarket
    cm = paper_prices.get('cardmarket', {}).get('retail', {}).get('normal', {})
    if cm:
        latest_date = max(cm.keys()) if cm else None
        if latest_date:
            result['cardmarket']['eur'] = cm[latest_date]
            result['cardmarket']['url'] = f"https://www.cardmarket.com/en/Magic/Products/Search?searchString={card_name.replace(' ', '+')}"


def get_cheapest_price(card_name: str, card_uuid: Optional[str] = None) -> Optional[float]:
    """Get the cheapest USD price across all vendors."""
    prices = get_card_prices(card_name, card_uuid)

    usd_prices = []
    if prices['tcgplayer']['usd']:
        usd_prices.append(prices['tcgplayer']['usd'])
    if prices['cardkingdom']['usd']:
        usd_prices.append(prices['cardkingdom']['usd'])
    if prices['cardmarket']['eur']:
        # Rough EUR to USD conversion
        usd_prices.append(prices['cardmarket']['eur'] * 1.1)

    return min(usd_prices) if usd_prices else None
```

**Step 5: Run test to verify it passes**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_price_service.py -v`
Expected: PASS (may take time on first run to fetch prices)

**Step 6: Commit**

```bash
git add backend/price_service.py backend/tests/
git commit -m "feat: add price service for MTGJson price fetching"
```

---

### Task 2: Create Functional Tags Module

**Files:**
- Create: `backend/functional_tags.py`
- Test: `backend/tests/test_functional_tags.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_functional_tags.py
import pytest
from backend.functional_tags import detect_tags, FUNCTIONAL_PATTERNS

def test_detect_removal_tag():
    """Destroy target creature should be tagged as removal."""
    oracle_text = "Destroy target creature."
    tags = detect_tags(oracle_text)
    assert "removal" in tags

def test_detect_ramp_tag_mana():
    """Add {G} should be tagged as ramp."""
    oracle_text = "{T}: Add {G}."
    tags = detect_tags(oracle_text)
    assert "ramp" in tags

def test_detect_ramp_tag_search_land():
    """Search library for land should be tagged as ramp."""
    oracle_text = "Search your library for a basic land card and put it onto the battlefield tapped."
    tags = detect_tags(oracle_text)
    assert "ramp" in tags

def test_detect_card_draw():
    """Draw a card should be tagged as card-draw."""
    oracle_text = "Target player draws two cards."
    tags = detect_tags(oracle_text)
    assert "card-draw" in tags

def test_detect_multiple_tags():
    """Card with multiple effects gets multiple tags."""
    oracle_text = "Destroy target creature. Draw a card."
    tags = detect_tags(oracle_text)
    assert "removal" in tags
    assert "card-draw" in tags

def test_detect_exile_removal():
    """Exile target should be tagged as removal and exile."""
    oracle_text = "Exile target creature."
    tags = detect_tags(oracle_text)
    assert "removal" in tags
    assert "exile" in tags
```

**Step 2: Run test to verify it fails**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_functional_tags.py -v`
Expected: FAIL with "cannot import name"

**Step 3: Write minimal implementation**

```python
# backend/functional_tags.py
"""Detect functional tags from card oracle text."""

import re
from typing import List, Set

FUNCTIONAL_PATTERNS = {
    "removal": [
        r"destroy target (?:creature|artifact|enchantment|permanent|planeswalker)",
        r"destroy all (?:creature|artifact|enchantment|permanent)s",
        r"exile target (?:creature|artifact|enchantment|permanent|planeswalker)",
        r"deals? \d+ damage to (?:target|any|each)",
        r"-\d+/-\d+ until end of turn",
        r"(?:target|that) (?:creature|permanent) gets -\d+/-\d+",
    ],
    "exile": [
        r"exile target",
        r"exile all",
        r"exiles? (?:it|them|that|the)",
    ],
    "ramp": [
        r"add \{[wubrgc]\}",
        r"add \{.\}\{.\}",
        r"add (?:one|two|three|\d+) mana",
        r"add mana of any (?:color|type)",
        r"search your library for (?:a|up to \w+) (?:basic )?land",
        r"put (?:a|that) land (?:card )?(?:onto|into) the battlefield",
        r"you may play an additional land",
    ],
    "card-draw": [
        r"draw (?:a|two|three|\d+) cards?",
        r"draws? (?:a|two|three|\d+) cards?",
        r"look at the top .* put .* (?:into|in) your hand",
    ],
    "tutor": [
        r"search your library for (?:a|an) (?!land)",
        r"search your library for a card",
    ],
    "counter": [
        r"counter target (?:spell|activated ability|triggered ability)",
    ],
    "board-wipe": [
        r"destroy all creatures",
        r"destroy all (?:nonland )?permanents",
        r"exile all creatures",
        r"(?:each|all) creatures? get -\d+/-\d+",
        r"deals? \d+ damage to each creature",
    ],
    "protection": [
        r"hexproof",
        r"indestructible",
        r"shroud",
        r"protection from",
        r"can't be (?:countered|targeted|blocked)",
    ],
    "recursion": [
        r"return (?:target|a) .* from (?:your|a) graveyard",
        r"put .* from (?:your|a) graveyard .* (?:onto|into)",
    ],
    "sacrifice": [
        r"sacrifice (?:a|an|target)",
        r"(?:target|each) player sacrifices",
    ],
    "lifegain": [
        r"gain (?:\d+|x) life",
        r"gains? life equal to",
        r"lifelink",
    ],
    "token": [
        r"create (?:a|\d+|x) .* tokens?",
        r"put (?:a|\d+|x) .* tokens? onto the battlefield",
    ],
    "instant-speed": [
        r"flash",
        # Note: This tag is also set based on card type "Instant"
    ],
}


def detect_tags(oracle_text: str, type_line: str = "", keywords: List[str] = None) -> Set[str]:
    """
    Detect functional tags from a card's oracle text and type line.

    Args:
        oracle_text: The card's oracle text
        type_line: The card's type line (e.g., "Instant", "Creature — Elf")
        keywords: List of keywords from the card

    Returns:
        Set of functional tag strings
    """
    tags = set()
    text_lower = oracle_text.lower()
    type_lower = type_line.lower()
    keywords = keywords or []

    # Check each pattern category
    for tag, patterns in FUNCTIONAL_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                tags.add(tag)
                break

    # Add instant-speed tag for instants
    if "instant" in type_lower:
        tags.add("instant-speed")

    # Check keywords
    keyword_tags = {
        "flash": "instant-speed",
        "lifelink": "lifegain",
        "hexproof": "protection",
        "indestructible": "protection",
    }
    for kw in keywords:
        kw_lower = kw.lower()
        if kw_lower in keyword_tags:
            tags.add(keyword_tags[kw_lower])

    return tags


def get_primary_function(tags: Set[str]) -> str:
    """Get the primary function of a card from its tags."""
    # Priority order for primary function
    priority = [
        "board-wipe", "removal", "counter", "ramp",
        "card-draw", "tutor", "recursion", "token",
        "protection", "lifegain", "sacrifice"
    ]

    for func in priority:
        if func in tags:
            return func

    return "utility"
```

**Step 4: Run test to verify it passes**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_functional_tags.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/functional_tags.py backend/tests/test_functional_tags.py
git commit -m "feat: add functional tag detection from oracle text"
```

---

### Task 3: Create Price History Database Table

**Files:**
- Modify: `backend/database.py`
- Test: `backend/tests/test_database_prices.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_database_prices.py
import pytest
from backend.database import (
    init_price_history_db,
    save_price_history,
    get_price_history,
    get_latest_prices
)

def test_save_and_retrieve_price_history():
    """Test saving and retrieving price history."""
    init_price_history_db()

    save_price_history("Sol Ring", "tcgplayer", 2.50)
    save_price_history("Sol Ring", "cardkingdom", 2.99)

    history = get_price_history("Sol Ring", "tcgplayer", limit=10)
    assert len(history) >= 1
    assert history[0]['price_usd'] == 2.50

def test_get_latest_prices():
    """Test getting latest prices for a card."""
    init_price_history_db()

    save_price_history("Lightning Bolt", "tcgplayer", 1.50)
    save_price_history("Lightning Bolt", "cardkingdom", 1.75)

    latest = get_latest_prices("Lightning Bolt")
    assert "tcgplayer" in latest
    assert "cardkingdom" in latest
```

**Step 2: Run test to verify it fails**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_database_prices.py -v`
Expected: FAIL with "cannot import name"

**Step 3: Add to database.py**

Add the following to `backend/database.py`:

```python
# Add after existing imports and constants
PRICE_HISTORY_PATH = Path(__file__).parent.parent / "data" / "price_history.db"


def init_price_history_db():
    """Initialize the price history database."""
    PRICE_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(PRICE_HISTORY_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_name TEXT NOT NULL,
            source TEXT NOT NULL,
            price_usd REAL,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_price_card_source
        ON price_history(card_name, source)
    """)
    conn.commit()
    conn.close()


@contextmanager
def get_price_history_connection():
    """Get a connection to the price history database."""
    conn = sqlite3.connect(PRICE_HISTORY_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def save_price_history(card_name: str, source: str, price_usd: float):
    """Save a price entry to history."""
    with get_price_history_connection() as conn:
        conn.execute("""
            INSERT INTO price_history (card_name, source, price_usd)
            VALUES (?, ?, ?)
        """, (card_name.lower(), source.lower(), price_usd))
        conn.commit()


def get_price_history(card_name: str, source: str = None, limit: int = 30) -> list:
    """Get price history for a card."""
    with get_price_history_connection() as conn:
        if source:
            rows = conn.execute("""
                SELECT source, price_usd, recorded_at
                FROM price_history
                WHERE card_name = ? AND source = ?
                ORDER BY recorded_at DESC
                LIMIT ?
            """, (card_name.lower(), source.lower(), limit)).fetchall()
        else:
            rows = conn.execute("""
                SELECT source, price_usd, recorded_at
                FROM price_history
                WHERE card_name = ?
                ORDER BY recorded_at DESC
                LIMIT ?
            """, (card_name.lower(), limit)).fetchall()

        return [dict(row) for row in rows]


def get_latest_prices(card_name: str) -> dict:
    """Get the most recent price from each source for a card."""
    with get_price_history_connection() as conn:
        rows = conn.execute("""
            SELECT source, price_usd, recorded_at
            FROM price_history p1
            WHERE card_name = ?
            AND recorded_at = (
                SELECT MAX(recorded_at)
                FROM price_history p2
                WHERE p2.card_name = p1.card_name AND p2.source = p1.source
            )
        """, (card_name.lower(),)).fetchall()

        return {row['source']: {'usd': row['price_usd'], 'updated': row['recorded_at']} for row in rows}
```

**Step 4: Run test to verify it passes**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_database_prices.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/database.py backend/tests/test_database_prices.py
git commit -m "feat: add price history database table and functions"
```

---

## Phase 2: Model Scorers

### Task 4: Create GPT2 Model Scorer

**Files:**
- Create: `backend/model_scorers.py`
- Test: `backend/tests/test_model_scorers.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_model_scorers.py
import pytest
from backend.model_scorers import GPT2Scorer, score_card_pair

def test_gpt2_scorer_loads():
    """Test that GPT2 model loads successfully."""
    scorer = GPT2Scorer()
    assert scorer.model is not None
    assert scorer.tokenizer is not None

def test_score_card_pair_returns_float():
    """Test scoring a pair of cards returns a float 0-1."""
    scorer = GPT2Scorer()
    score = scorer.score_similarity(
        source_card="Swords to Plowshares",
        candidate_card="Path to Exile",
        source_text="Exile target creature. Its controller gains life equal to its power.",
        candidate_text="Exile target creature. Its controller searches their library for a basic land card, puts that card onto the battlefield tapped, then shuffles."
    )
    assert isinstance(score, float)
    assert 0.0 <= score <= 1.0
```

**Step 2: Run test to verify it fails**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_model_scorers.py::test_gpt2_scorer_loads -v`
Expected: FAIL with "cannot import name"

**Step 3: Write minimal implementation**

```python
# backend/model_scorers.py
"""Model-based scorers for card similarity using GPT2 and Qwen."""

import torch
from pathlib import Path
from typing import Optional, Tuple
from transformers import GPT2LMHeadModel, GPT2Tokenizer

# Model paths
MODELS_DIR = Path(__file__).parent.parent / "models"
GPT2_MODEL_PATH = MODELS_DIR / "GPT2 Model"
QWEN_MODEL_PATH = MODELS_DIR / "QWEN Model"


class GPT2Scorer:
    """Score card similarity using fine-tuned GPT2 model."""

    def __init__(self):
        self.model: Optional[GPT2LMHeadModel] = None
        self.tokenizer: Optional[GPT2Tokenizer] = None
        self._load_model()

    def _load_model(self):
        """Load the GPT2 model and tokenizer."""
        if not GPT2_MODEL_PATH.exists():
            raise FileNotFoundError(f"GPT2 model not found at {GPT2_MODEL_PATH}")

        self.tokenizer = GPT2Tokenizer.from_pretrained(str(GPT2_MODEL_PATH))
        self.model = GPT2LMHeadModel.from_pretrained(str(GPT2_MODEL_PATH))
        self.model.eval()

        # Set pad token if not set
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

    def score_similarity(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str
    ) -> float:
        """
        Score how similar/substitutable two cards are.

        Uses perplexity-based scoring: if the model finds the candidate
        a natural continuation/replacement in MTG context, score is higher.

        Returns: float between 0 and 1
        """
        # Create a prompt that asks the model to evaluate substitutability
        prompt = f"""In Magic: The Gathering Commander, comparing cards:
Card A: {source_card} - {source_text}
Card B: {candidate_card} - {candidate_text}
These cards are similar because they both"""

        # Tokenize
        inputs = self.tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=512
        )

        # Get model output
        with torch.no_grad():
            outputs = self.model(**inputs, labels=inputs["input_ids"])
            loss = outputs.loss.item()

        # Convert loss to similarity score (lower loss = higher similarity)
        # Typical loss range is 2-6, map to 0-1
        score = max(0.0, min(1.0, 1.0 - (loss - 2.0) / 4.0))

        return score

    def batch_score(
        self,
        source_card: str,
        source_text: str,
        candidates: list[Tuple[str, str]]  # [(name, text), ...]
    ) -> list[float]:
        """Score multiple candidates against a source card."""
        scores = []
        for cand_name, cand_text in candidates:
            score = self.score_similarity(source_card, cand_name, source_text, cand_text)
            scores.append(score)
        return scores


class QwenScorer:
    """Score card similarity using Qwen GGUF model."""

    def __init__(self):
        self.llm = None
        self._load_model()

    def _load_model(self):
        """Load the Qwen GGUF model using llama-cpp-python."""
        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError("llama-cpp-python required. Install with: pip install llama-cpp-python")

        model_file = QWEN_MODEL_PATH / "mtg_brain_card_knowledge.Q4_K_M.gguf"
        if not model_file.exists():
            raise FileNotFoundError(f"Qwen model not found at {model_file}")

        self.llm = Llama(
            model_path=str(model_file),
            n_ctx=2048,
            n_threads=4,
            verbose=False
        )

    def score_similarity(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str
    ) -> float:
        """
        Score similarity using Qwen model.

        Returns: float between 0 and 1
        """
        prompt = f"""<|im_start|>system
You are an MTG expert. Rate card similarity from 0-10.<|im_end|>
<|im_start|>user
How similar is "{candidate_card}" to "{source_card}" as a substitute?
{source_card}: {source_text}
{candidate_card}: {candidate_text}
Reply with just a number 0-10.<|im_end|>
<|im_start|>assistant
"""

        output = self.llm(
            prompt,
            max_tokens=10,
            temperature=0.1,
            stop=["<|im_end|>"]
        )

        # Parse the number from response
        response = output['choices'][0]['text'].strip()
        try:
            score = float(response.split()[0])
            return min(1.0, max(0.0, score / 10.0))
        except (ValueError, IndexError):
            return 0.5  # Default middle score if parsing fails

    def generate_tradeoff_explanation(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str,
        source_price: float,
        candidate_price: float,
        source_cmc: int,
        candidate_cmc: int
    ) -> str:
        """Generate a natural language explanation of the trade-offs."""
        price_diff = source_price - candidate_price
        cmc_diff = candidate_cmc - source_cmc

        prompt = f"""<|im_start|>system
You are an MTG deck building advisor. Give brief, helpful card comparisons.<|im_end|>
<|im_start|>user
Compare these cards as substitutes:
Original: {source_card} (${source_price:.2f}, {source_cmc} CMC) - {source_text}
Alternative: {candidate_card} (${candidate_price:.2f}, {candidate_cmc} CMC) - {candidate_text}

Give a one-sentence trade-off summary.<|im_end|>
<|im_start|>assistant
"""

        output = self.llm(
            prompt,
            max_tokens=100,
            temperature=0.7,
            stop=["<|im_end|>", "\n\n"]
        )

        return output['choices'][0]['text'].strip()


# Singleton instances
_gpt2_scorer: Optional[GPT2Scorer] = None
_qwen_scorer: Optional[QwenScorer] = None


def get_gpt2_scorer() -> GPT2Scorer:
    """Get or create the GPT2 scorer singleton."""
    global _gpt2_scorer
    if _gpt2_scorer is None:
        _gpt2_scorer = GPT2Scorer()
    return _gpt2_scorer


def get_qwen_scorer() -> QwenScorer:
    """Get or create the Qwen scorer singleton."""
    global _qwen_scorer
    if _qwen_scorer is None:
        _qwen_scorer = QwenScorer()
    return _qwen_scorer


def score_card_pair(
    source_card: str,
    candidate_card: str,
    source_text: str,
    candidate_text: str,
    use_gpt2: bool = True,
    use_qwen: bool = True
) -> dict:
    """
    Score a card pair using available models.

    Returns: {"gpt2": float, "qwen": float}
    """
    scores = {}

    if use_gpt2:
        try:
            gpt2 = get_gpt2_scorer()
            scores["gpt2"] = gpt2.score_similarity(
                source_card, candidate_card, source_text, candidate_text
            )
        except Exception as e:
            print(f"GPT2 scoring failed: {e}")
            scores["gpt2"] = 0.5

    if use_qwen:
        try:
            qwen = get_qwen_scorer()
            scores["qwen"] = qwen.score_similarity(
                source_card, candidate_card, source_text, candidate_text
            )
        except Exception as e:
            print(f"Qwen scoring failed: {e}")
            scores["qwen"] = 0.5

    return scores
```

**Step 4: Run test to verify it passes**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_model_scorers.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/model_scorers.py backend/tests/test_model_scorers.py
git commit -m "feat: add GPT2 and Qwen model scorers for card similarity"
```

---

## Phase 3: Ensemble Ranker

### Task 5: Create Card Alternatives Module

**Files:**
- Create: `backend/card_alternatives.py`
- Test: `backend/tests/test_card_alternatives.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_card_alternatives.py
import pytest
from backend.card_alternatives import find_alternatives, AlternativeResult

def test_find_alternatives_returns_results():
    """Test finding alternatives for a card."""
    results = find_alternatives(
        card_name="Swords to Plowshares",
        max_price=2.00,
        limit=5
    )
    assert isinstance(results, list)
    # May be empty if no cheaper alternatives exist

def test_alternative_result_structure():
    """Test that results have expected structure."""
    results = find_alternatives(
        card_name="Rhystic Study",  # Expensive card
        max_price=10.00,
        limit=3
    )
    if results:
        result = results[0]
        assert hasattr(result, 'card_name')
        assert hasattr(result, 'price')
        assert hasattr(result, 'score')
        assert hasattr(result, 'explanation')
```

**Step 2: Run test to verify it fails**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_card_alternatives.py -v`
Expected: FAIL with "cannot import name"

**Step 3: Write minimal implementation**

```python
# backend/card_alternatives.py
"""Find cheaper card alternatives using ensemble ranking."""

from dataclasses import dataclass
from typing import List, Optional, Set
import numpy as np

from backend.deck_generator import get_generator
from backend.functional_tags import detect_tags, get_primary_function
from backend.model_scorers import get_gpt2_scorer, get_qwen_scorer


@dataclass
class AlternativeResult:
    """A card alternative with scoring details."""
    card_name: str
    price: float
    price_savings: float
    score: float
    faiss_score: float
    gpt2_score: float
    qwen_score: float
    category_score: float
    shared_tags: List[str]
    explanation: str
    prices: dict  # Multi-vendor prices
    cmc: int
    mana_cost: str
    type_line: str


# Ensemble weights
WEIGHTS = {
    "faiss": 0.30,
    "gpt2": 0.25,
    "qwen": 0.25,
    "category": 0.20
}


def find_alternatives(
    card_name: str,
    max_price: Optional[float] = None,
    limit: int = 5,
    color_identity: Optional[List[str]] = None,
    required_tags: Optional[List[str]] = None,
    use_models: bool = True
) -> List[AlternativeResult]:
    """
    Find cheaper alternatives to a card using ensemble ranking.

    Args:
        card_name: Name of the source card
        max_price: Maximum price for alternatives (default: source card price)
        limit: Number of results to return
        color_identity: Filter by color identity (for Commander)
        required_tags: Only return cards with these functional tags
        use_models: Whether to use GPT2/Qwen scoring (slower but better)

    Returns:
        List of AlternativeResult sorted by score descending
    """
    generator = get_generator()

    # Find source card
    source_card = generator.card_by_name.get(card_name)
    if not source_card:
        return []

    source_text = source_card.get('oracle_text', '')
    source_price = _get_price(source_card)
    source_cmc = int(source_card.get('cmc', 0))
    source_tags = detect_tags(
        source_text,
        source_card.get('type_line', ''),
        source_card.get('keywords', [])
    )

    # Set max price to source price if not specified
    if max_price is None:
        max_price = source_price

    # Use FAISS to find semantically similar cards
    similar_cards = generator.search_cards(source_text, k=50)

    # Filter candidates
    candidates = []
    for card in similar_cards:
        cand_name = card.get('name', '')

        # Skip source card
        if cand_name.lower() == card_name.lower():
            continue

        # Skip if over max price
        cand_price = _get_price(card)
        if cand_price is None or cand_price >= max_price:
            continue

        # Filter by color identity if specified
        if color_identity:
            cand_colors = set(card.get('color_identity', []))
            if not cand_colors.issubset(set(color_identity)):
                continue

        # Get candidate tags
        cand_text = card.get('oracle_text', '')
        cand_tags = detect_tags(
            cand_text,
            card.get('type_line', ''),
            card.get('keywords', [])
        )

        # Filter by required tags
        if required_tags:
            if not any(tag in cand_tags for tag in required_tags):
                continue

        candidates.append({
            'card': card,
            'faiss_score': card.get('score', 0.5),
            'tags': cand_tags,
            'price': cand_price
        })

    if not candidates:
        return []

    # Score candidates
    results = []

    # Load scorers if using models
    gpt2_scorer = None
    qwen_scorer = None
    if use_models:
        try:
            gpt2_scorer = get_gpt2_scorer()
        except Exception:
            pass
        try:
            qwen_scorer = get_qwen_scorer()
        except Exception:
            pass

    for cand in candidates:
        card = cand['card']
        cand_name = card.get('name', '')
        cand_text = card.get('oracle_text', '')
        cand_tags = cand['tags']
        cand_price = cand['price']
        cand_cmc = int(card.get('cmc', 0))

        # FAISS score (already have)
        faiss_score = cand['faiss_score']

        # Category score
        shared_tags = source_tags & cand_tags
        category_score = min(1.0, len(shared_tags) * 0.3)
        if required_tags and any(t in cand_tags for t in required_tags):
            category_score += 0.5
        category_score = min(1.0, category_score)

        # Model scores
        gpt2_score = 0.5
        qwen_score = 0.5

        if gpt2_scorer:
            try:
                gpt2_score = gpt2_scorer.score_similarity(
                    card_name, cand_name, source_text, cand_text
                )
            except Exception:
                pass

        if qwen_scorer:
            try:
                qwen_score = qwen_scorer.score_similarity(
                    card_name, cand_name, source_text, cand_text
                )
            except Exception:
                pass

        # Ensemble score
        final_score = (
            WEIGHTS["faiss"] * faiss_score +
            WEIGHTS["gpt2"] * gpt2_score +
            WEIGHTS["qwen"] * qwen_score +
            WEIGHTS["category"] * category_score
        )

        # Generate explanation
        explanation = _generate_explanation(
            card_name, cand_name,
            source_price, cand_price,
            source_cmc, cand_cmc,
            source_text, cand_text,
            qwen_scorer
        )

        results.append(AlternativeResult(
            card_name=cand_name,
            price=cand_price,
            price_savings=source_price - cand_price,
            score=final_score,
            faiss_score=faiss_score,
            gpt2_score=gpt2_score,
            qwen_score=qwen_score,
            category_score=category_score,
            shared_tags=list(shared_tags),
            explanation=explanation,
            prices=_get_multi_vendor_prices(card),
            cmc=cand_cmc,
            mana_cost=card.get('mana_cost', ''),
            type_line=card.get('type_line', '')
        ))

    # Sort by score and return top results
    results.sort(key=lambda x: x.score, reverse=True)
    return results[:limit]


def _get_price(card: dict) -> Optional[float]:
    """Get USD price from card data."""
    prices = card.get('prices', {})
    usd = prices.get('usd')
    if usd:
        try:
            return float(usd)
        except (ValueError, TypeError):
            pass
    return None


def _get_multi_vendor_prices(card: dict) -> dict:
    """Get prices from multiple vendors."""
    prices = card.get('prices', {})
    name = card.get('name', '')

    return {
        'tcgplayer': {
            'usd': float(prices.get('usd', 0)) if prices.get('usd') else None,
            'url': f"https://www.tcgplayer.com/search/magic/product?q={name.replace(' ', '+')}"
        },
        'cardkingdom': {
            'usd': None,  # Would come from MTGJson
            'url': f"https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D={name.replace(' ', '+')}"
        },
        'cardmarket': {
            'eur': float(prices.get('eur', 0)) if prices.get('eur') else None,
            'url': f"https://www.cardmarket.com/en/Magic/Products/Search?searchString={name.replace(' ', '+')}"
        }
    }


def _generate_explanation(
    source_name: str,
    cand_name: str,
    source_price: float,
    cand_price: float,
    source_cmc: int,
    cand_cmc: int,
    source_text: str,
    cand_text: str,
    qwen_scorer
) -> str:
    """Generate a trade-off explanation."""
    # Try Qwen first
    if qwen_scorer:
        try:
            return qwen_scorer.generate_tradeoff_explanation(
                source_name, cand_name,
                source_text, cand_text,
                source_price, cand_price,
                source_cmc, cand_cmc
            )
        except Exception:
            pass

    # Fallback to simple explanation
    price_diff = source_price - cand_price
    cmc_diff = cand_cmc - source_cmc

    parts = [f"{cand_name} saves ${price_diff:.2f}"]

    if cmc_diff > 0:
        parts.append(f"but costs {cmc_diff} more mana")
    elif cmc_diff < 0:
        parts.append(f"and costs {-cmc_diff} less mana")

    return ", ".join(parts) + "."


def optimize_deck_prices(
    deck_list: List[str],
    budget_target: Optional[float] = None,
    color_identity: Optional[List[str]] = None
) -> dict:
    """
    Analyze a deck and suggest swaps to reduce total cost.

    Args:
        deck_list: List of card names in the deck
        budget_target: Target total budget (optional)
        color_identity: Commander color identity for filtering

    Returns:
        {
            "current_total": float,
            "optimized_total": float,
            "savings": float,
            "suggestions": [
                {
                    "original": str,
                    "replacement": AlternativeResult,
                    "savings": float
                }
            ]
        }
    """
    generator = get_generator()

    suggestions = []
    current_total = 0.0

    # Analyze each card
    for card_name in deck_list:
        # Clean card name
        clean_name = card_name.replace('*CMDR*', '').strip()
        if clean_name.startswith('1x '):
            clean_name = clean_name[3:]

        card = generator.card_by_name.get(clean_name)
        if not card:
            continue

        price = _get_price(card)
        if price:
            current_total += price

        # Skip cheap cards (not worth optimizing)
        if price is None or price < 2.0:
            continue

        # Find alternatives
        alternatives = find_alternatives(
            clean_name,
            max_price=price * 0.7,  # At least 30% cheaper
            limit=1,
            color_identity=color_identity,
            use_models=False  # Faster for bulk analysis
        )

        if alternatives:
            best = alternatives[0]
            suggestions.append({
                "original": clean_name,
                "original_price": price,
                "replacement": best,
                "savings": price - best.price
            })

    # Sort by savings
    suggestions.sort(key=lambda x: x['savings'], reverse=True)

    # Calculate optimized total
    optimized_total = current_total
    for sug in suggestions:
        optimized_total -= sug['savings']

    return {
        "current_total": current_total,
        "optimized_total": optimized_total,
        "savings": current_total - optimized_total,
        "suggestions": suggestions
    }
```

**Step 4: Run test to verify it passes**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_card_alternatives.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/card_alternatives.py backend/tests/test_card_alternatives.py
git commit -m "feat: add ensemble ranking card alternatives finder"
```

---

## Phase 4: Daily Update Job

### Task 6: Create Daily Update Script

**Files:**
- Create: `backend/daily_update.py`
- Create: `backend/tests/test_daily_update.py`

**Step 1: Write the failing test**

```python
# backend/tests/test_daily_update.py
import pytest
from backend.daily_update import (
    fetch_new_cards,
    update_prices,
    DailyUpdateResult
)

def test_fetch_new_cards_structure():
    """Test that fetch_new_cards returns expected structure."""
    result = fetch_new_cards(dry_run=True)
    assert isinstance(result, dict)
    assert 'new_cards' in result
    assert 'updated_cards' in result

def test_daily_update_result():
    """Test DailyUpdateResult dataclass."""
    result = DailyUpdateResult(
        success=True,
        new_cards=5,
        updated_prices=100,
        new_images=5,
        errors=[]
    )
    assert result.success
    assert result.new_cards == 5
```

**Step 2: Run test to verify it fails**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_daily_update.py -v`
Expected: FAIL with "cannot import name"

**Step 3: Write implementation**

```python
# backend/daily_update.py
#!/usr/bin/env python3
"""Daily update job for card data, prices, and images."""

import json
import logging
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Set

import requests

# Setup path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import (
    init_images_db,
    save_card_image,
    has_card_image,
    init_price_history_db,
    save_price_history
)
from backend.functional_tags import detect_tags
from backend.price_service import fetch_mtgjson_prices

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Paths
DATA_DIR = Path(__file__).parent.parent / "mtg_data"
CARDS_PATH = DATA_DIR / "cards_min.jsonl"
EMBEDDINGS_PATH = DATA_DIR / "card_embeddings.npy"
FAISS_INDEX_PATH = DATA_DIR / "card_index.faiss"

# API URLs
SCRYFALL_BULK_API = "https://api.scryfall.com/bulk-data"
RATE_LIMIT_MS = 100


@dataclass
class DailyUpdateResult:
    """Result of the daily update job."""
    success: bool
    new_cards: int = 0
    updated_prices: int = 0
    new_images: int = 0
    new_embeddings: int = 0
    errors: List[str] = field(default_factory=list)
    started_at: datetime = field(default_factory=datetime.now)
    completed_at: Optional[datetime] = None


def fetch_new_cards(dry_run: bool = False) -> dict:
    """
    Fetch new/updated cards from Scryfall.

    Returns:
        {
            'new_cards': [...],
            'updated_cards': [...],
            'total_fetched': int
        }
    """
    logger.info("Fetching bulk data from Scryfall...")

    # Get bulk data URL
    response = requests.get(SCRYFALL_BULK_API, timeout=30)
    response.raise_for_status()

    bulk_data = response.json()
    oracle_url = None
    for item in bulk_data['data']:
        if item['type'] == 'oracle_cards':
            oracle_url = item['download_uri']
            break

    if not oracle_url:
        raise ValueError("Could not find Oracle Cards bulk data")

    time.sleep(RATE_LIMIT_MS / 1000)

    # Download bulk data
    logger.info("Downloading card data...")
    response = requests.get(oracle_url, timeout=120)
    response.raise_for_status()

    all_cards = response.json()
    logger.info(f"Downloaded {len(all_cards)} total cards")

    # Load existing cards
    existing_cards = {}
    if CARDS_PATH.exists():
        with open(CARDS_PATH, 'r') as f:
            for line in f:
                card = json.loads(line)
                existing_cards[card['name']] = card

    # Find new and updated cards
    new_cards = []
    updated_cards = []

    for card in all_cards:
        # Filter to Commander-legal only
        legalities = card.get('legalities', {})
        if legalities.get('commander') not in ('legal', 'restricted'):
            continue

        # Skip tokens, etc.
        layout = card.get('layout', '')
        if layout in ('token', 'emblem', 'art_series', 'double_faced_token'):
            continue

        name = card.get('name', '')

        if name not in existing_cards:
            new_cards.append(card)
        else:
            # Check if card was updated (compare oracle text or prices)
            existing = existing_cards[name]
            if card.get('oracle_text') != existing.get('oracle_text'):
                updated_cards.append(card)

    logger.info(f"Found {len(new_cards)} new cards, {len(updated_cards)} updated cards")

    return {
        'new_cards': new_cards,
        'updated_cards': updated_cards,
        'total_fetched': len(all_cards),
        'all_cards': all_cards if not dry_run else []
    }


def update_prices() -> int:
    """
    Update prices from MTGJson and save to history.

    Returns: Number of prices updated
    """
    logger.info("Updating prices from MTGJson...")

    init_price_history_db()
    prices_data = fetch_mtgjson_prices(force_refresh=True)

    updated = 0

    # Load current cards
    if not CARDS_PATH.exists():
        logger.warning("No cards file found, skipping price update")
        return 0

    with open(CARDS_PATH, 'r') as f:
        cards = [json.loads(line) for line in f]

    # Update each card's prices
    for card in cards:
        name = card.get('name', '')

        # Get current Scryfall prices (TCGPlayer)
        scryfall_prices = card.get('prices', {})

        if scryfall_prices.get('usd'):
            try:
                price = float(scryfall_prices['usd'])
                save_price_history(name, 'tcgplayer', price)
                updated += 1
            except (ValueError, TypeError):
                pass

        if scryfall_prices.get('eur'):
            try:
                price = float(scryfall_prices['eur'])
                save_price_history(name, 'cardmarket', price)
                updated += 1
            except (ValueError, TypeError):
                pass

    logger.info(f"Updated {updated} price entries")
    return updated


def update_card_file(cards_to_add: List[dict], cards_to_update: List[dict]) -> None:
    """Update the cards JSONL file with new/updated cards."""
    if not cards_to_add and not cards_to_update:
        return

    logger.info(f"Updating card file with {len(cards_to_add)} new, {len(cards_to_update)} updated...")

    # Load existing
    existing = {}
    if CARDS_PATH.exists():
        with open(CARDS_PATH, 'r') as f:
            for line in f:
                card = json.loads(line)
                existing[card['name']] = card

    # Add/update cards
    update_names = {c['name'] for c in cards_to_update}

    for card in cards_to_add + cards_to_update:
        # Minimize card data
        min_card = _minimize_card(card)
        existing[card['name']] = min_card

    # Write back
    with open(CARDS_PATH, 'w') as f:
        for card in existing.values():
            f.write(json.dumps(card) + '\n')

    logger.info("Card file updated")


def _minimize_card(card: dict) -> dict:
    """Extract only needed fields from a card."""
    return {
        'id': card.get('id'),
        'name': card.get('name'),
        'layout': card.get('layout'),
        'type_line': card.get('type_line'),
        'oracle_text': card.get('oracle_text'),
        'mana_cost': card.get('mana_cost'),
        'cmc': card.get('cmc'),
        'colors': card.get('colors'),
        'color_identity': card.get('color_identity'),
        'keywords': card.get('keywords'),
        'legalities': card.get('legalities'),
        'rarity': card.get('rarity'),
        'prices': card.get('prices'),
        'set': card.get('set'),
        'collector_number': card.get('collector_number'),
        'image_uris': card.get('image_uris'),
        'card_faces': card.get('card_faces'),
    }


def regenerate_embeddings(new_cards: List[dict]) -> int:
    """
    Generate embeddings for new cards and update FAISS index.

    Returns: Number of embeddings generated
    """
    if not new_cards:
        return 0

    logger.info(f"Generating embeddings for {len(new_cards)} new cards...")

    try:
        import faiss
        import numpy as np
        from sentence_transformers import SentenceTransformer
    except ImportError as e:
        logger.error(f"Missing dependency for embeddings: {e}")
        return 0

    # Load model
    model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

    # Generate text for embedding
    texts = []
    for card in new_cards:
        text = f"{card.get('name', '')} {card.get('type_line', '')} {card.get('oracle_text', '')}"
        texts.append(text)

    # Generate embeddings
    new_embeddings = model.encode(texts, normalize_embeddings=True)

    # Load existing embeddings and index
    if EMBEDDINGS_PATH.exists() and FAISS_INDEX_PATH.exists():
        existing_embeddings = np.load(str(EMBEDDINGS_PATH))
        all_embeddings = np.vstack([existing_embeddings, new_embeddings])
    else:
        all_embeddings = new_embeddings

    # Save embeddings
    np.save(str(EMBEDDINGS_PATH), all_embeddings)

    # Rebuild FAISS index
    dimension = all_embeddings.shape[1]
    index = faiss.IndexFlatIP(dimension)
    index.add(all_embeddings.astype('float32'))
    faiss.write_index(index, str(FAISS_INDEX_PATH))

    logger.info(f"Generated {len(new_cards)} embeddings, index now has {index.ntotal} vectors")
    return len(new_cards)


def download_new_images(new_cards: List[dict]) -> int:
    """
    Download images for new cards.

    Returns: Number of images downloaded
    """
    if not new_cards:
        return 0

    logger.info(f"Downloading images for {len(new_cards)} new cards...")

    init_images_db()
    downloaded = 0

    for card in new_cards:
        name = card.get('name', '')
        set_code = card.get('set', 'unknown')

        # Get image URL
        image_url = None
        if card.get('image_uris'):
            image_url = card['image_uris'].get('normal')
        elif card.get('card_faces'):
            face = card['card_faces'][0]
            if face.get('image_uris'):
                image_url = face['image_uris'].get('normal')

        if not image_url:
            continue

        # Skip if already have it
        if has_card_image(name, set_code, 'normal'):
            continue

        # Download
        try:
            response = requests.get(image_url, timeout=30)
            response.raise_for_status()

            content_type = response.headers.get('content-type', 'image/jpeg')
            save_card_image(name, set_code, 'normal', response.content, content_type)
            downloaded += 1

            time.sleep(RATE_LIMIT_MS / 1000)
        except Exception as e:
            logger.warning(f"Failed to download image for {name}: {e}")

    logger.info(f"Downloaded {downloaded} new images")
    return downloaded


def run_daily_update() -> DailyUpdateResult:
    """Run the complete daily update job."""
    result = DailyUpdateResult(success=False)

    try:
        # Step 1: Fetch new cards
        card_data = fetch_new_cards()
        new_cards = card_data['new_cards']
        updated_cards = card_data['updated_cards']
        result.new_cards = len(new_cards)

        # Step 2: Update card file
        update_card_file(new_cards, updated_cards)

        # Step 3: Update prices
        result.updated_prices = update_prices()

        # Step 4: Regenerate embeddings for new cards
        result.new_embeddings = regenerate_embeddings(new_cards)

        # Step 5: Download images for new cards
        result.new_images = download_new_images(new_cards)

        result.success = True

    except Exception as e:
        logger.error(f"Daily update failed: {e}")
        result.errors.append(str(e))

    result.completed_at = datetime.now()

    # Log summary
    duration = (result.completed_at - result.started_at).total_seconds()
    logger.info(f"""
Daily Update Complete:
  Status: {'SUCCESS' if result.success else 'FAILED'}
  Duration: {duration:.1f} seconds
  New cards: {result.new_cards}
  Updated prices: {result.updated_prices}
  New embeddings: {result.new_embeddings}
  New images: {result.new_images}
  Errors: {len(result.errors)}
""")

    return result


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Run daily MTG data update')
    parser.add_argument('--dry-run', action='store_true', help='Check for updates without applying')
    parser.add_argument('--prices-only', action='store_true', help='Only update prices')
    args = parser.parse_args()

    if args.dry_run:
        result = fetch_new_cards(dry_run=True)
        print(f"Would update {len(result['new_cards'])} new cards")
        print(f"Would update {len(result['updated_cards'])} changed cards")
    elif args.prices_only:
        init_price_history_db()
        count = update_prices()
        print(f"Updated {count} prices")
    else:
        result = run_daily_update()
        sys.exit(0 if result.success else 1)
```

**Step 4: Run test to verify it passes**

Run: `cd /home/sheltron/Documents/Magic && ./venv/bin/pytest backend/tests/test_daily_update.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/daily_update.py backend/tests/test_daily_update.py
git commit -m "feat: add daily update job for cards, prices, and images"
```

---

## Phase 5: API Endpoints

### Task 7: Add API Endpoints

**Files:**
- Modify: `backend/main.py`

**Step 1: Add imports and endpoints**

Add the following to `backend/main.py` after existing imports:

```python
# Add to imports
from backend.card_alternatives import find_alternatives, optimize_deck_prices, AlternativeResult
from backend.price_service import get_card_prices
from backend.daily_update import run_daily_update, DailyUpdateResult

# Add new models
class AlternativeResponse(BaseModel):
    """Response for card alternatives."""
    card_name: str
    price: float
    price_savings: float
    score: float
    shared_tags: List[str]
    explanation: str
    prices: dict
    cmc: int
    mana_cost: str
    type_line: str


class AlternativesRequest(BaseModel):
    """Request for card alternatives."""
    card_name: str
    max_price: Optional[float] = None
    limit: int = 5
    color_identity: Optional[List[str]] = None


class DeckOptimizeRequest(BaseModel):
    """Request for deck optimization."""
    deck_list: List[str]
    budget_target: Optional[float] = None
    color_identity: Optional[List[str]] = None


class PriceResponse(BaseModel):
    """Response for card prices."""
    card_name: str
    prices: dict


# Add endpoints

@app.post("/api/card/alternatives", response_model=List[AlternativeResponse])
async def get_card_alternatives(request: AlternativesRequest):
    """
    Find cheaper alternatives to a card using ensemble ranking.
    """
    results = find_alternatives(
        card_name=request.card_name,
        max_price=request.max_price,
        limit=request.limit,
        color_identity=request.color_identity,
        use_models=True
    )

    return [
        AlternativeResponse(
            card_name=r.card_name,
            price=r.price,
            price_savings=r.price_savings,
            score=r.score,
            shared_tags=r.shared_tags,
            explanation=r.explanation,
            prices=r.prices,
            cmc=r.cmc,
            mana_cost=r.mana_cost,
            type_line=r.type_line
        )
        for r in results
    ]


@app.get("/api/card/{card_name}/prices", response_model=PriceResponse)
async def get_prices(card_name: str):
    """Get prices for a card from multiple vendors."""
    prices = get_card_prices(card_name)
    return PriceResponse(card_name=card_name, prices=prices)


@app.post("/api/deck/optimize")
async def optimize_deck(request: DeckOptimizeRequest):
    """
    Analyze a deck and suggest swaps to reduce total cost.
    """
    result = optimize_deck_prices(
        deck_list=request.deck_list,
        budget_target=request.budget_target,
        color_identity=request.color_identity
    )

    # Convert AlternativeResult objects to dicts
    for sug in result['suggestions']:
        if isinstance(sug['replacement'], AlternativeResult):
            sug['replacement'] = {
                'card_name': sug['replacement'].card_name,
                'price': sug['replacement'].price,
                'explanation': sug['replacement'].explanation,
                'prices': sug['replacement'].prices
            }

    return result


@app.post("/api/update/trigger")
async def trigger_update():
    """Manually trigger a data update (admin only)."""
    # In production, add authentication here
    result = run_daily_update()
    return {
        "success": result.success,
        "new_cards": result.new_cards,
        "updated_prices": result.updated_prices,
        "errors": result.errors
    }


@app.get("/api/update/status")
async def get_update_status():
    """Get the status of the last update."""
    # Would read from a status file in production
    return {"status": "ok", "last_update": "unknown"}
```

**Step 2: Commit**

```bash
git add backend/main.py
git commit -m "feat: add API endpoints for card alternatives and deck optimization"
```

---

## Phase 6: Cron Setup

### Task 8: Create Cron Job

**Files:**
- Create: `scripts/setup_cron.sh`

**Step 1: Create setup script**

```bash
#!/bin/bash
# scripts/setup_cron.sh
# Sets up the daily update cron job

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"

# Create logs directory
mkdir -p "$LOG_DIR"

# Create cron entry
CRON_CMD="0 3 * * * cd $PROJECT_DIR && ./venv/bin/python backend/daily_update.py >> $LOG_DIR/daily_update.log 2>&1"

# Check if already exists
if crontab -l 2>/dev/null | grep -q "daily_update.py"; then
    echo "Cron job already exists"
else
    # Add to crontab
    (crontab -l 2>/dev/null; echo "$CRON_CMD") | crontab -
    echo "Cron job added: runs daily at 3 AM"
fi

echo "Cron job setup complete"
echo "Logs will be written to: $LOG_DIR/daily_update.log"
```

**Step 2: Make executable and commit**

```bash
mkdir -p scripts
chmod +x scripts/setup_cron.sh
git add scripts/setup_cron.sh
git commit -m "feat: add cron setup script for daily updates"
```

---

## Summary

**Phase 1:** Price service + functional tags + database (Tasks 1-3)
**Phase 2:** Model scorers for GPT2 and Qwen (Task 4)
**Phase 3:** Ensemble ranking card alternatives (Task 5)
**Phase 4:** Daily update job (Task 6)
**Phase 5:** API endpoints (Task 7)
**Phase 6:** Cron setup (Task 8)

Total: 8 tasks
Estimated time: 2-3 hours

---

## Post-Implementation

After completing all tasks:

1. Run full test suite: `./venv/bin/pytest backend/tests/ -v`
2. Test API manually: `curl -X POST localhost:8000/api/card/alternatives -H "Content-Type: application/json" -d '{"card_name": "Rhystic Study"}'`
3. Set up cron: `./scripts/setup_cron.sh`
4. Test daily update: `./venv/bin/python backend/daily_update.py --dry-run`
