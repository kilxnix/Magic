# Qwen3.5-4B Deck Composer — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Train a Qwen3.5-4B model with two LoRA adapters (scorer + composer) to generate human-like Commander decklists, replacing the current FAISS-only card selection.

**Architecture:** Two-stage pipeline — FAISS narrows 300 candidates, model composes final 99, validation layer catches hallucinations. Scrape 40k+ decklists from Moxfield/Archidekt/EDHREC. Train on Colab Pro A100. Serve locally on 5070 Ti via llama-cpp-python.

**Tech Stack:** Python, Unsloth, QLoRA, llama-cpp-python, Qwen3.5-4B-Instruct, GGUF quantization, requests (scraping)

**Design doc:** `docs/plans/2026-03-12-qwen35-deck-composer-design.md`

---

## Task 1: Deck Scraper — Moxfield

**Files:**
- Create: `training/scrape_moxfield.py`
- Create: `training/__init__.py`
- Test: manual run — verify JSON output

**Step 1: Create the scraper module**

```python
# training/scrape_moxfield.py
"""Scrape public Commander decklists from Moxfield."""

import json
import time
import logging
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = DATA_DIR / "raw_moxfield_decks.jsonl"
PROGRESS_FILE = DATA_DIR / "moxfield_progress.json"

# Moxfield public API
BASE_URL = "https://api2.moxfield.com/v3"
SEARCH_URL = f"{BASE_URL}/decks/search"
DECK_URL = f"{BASE_URL}/decks/all"  # GET /v3/decks/all/{publicId}

HEADERS = {
    "User-Agent": "MTGDeckTrainer/1.0 (research; contact@example.com)",
    "Accept": "application/json",
}

RATE_LIMIT_SECONDS = 0.2


def load_progress() -> dict:
    """Load scraping progress for resumability."""
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"page": 1, "total_scraped": 0, "seen_ids": []}


def save_progress(progress: dict):
    """Save scraping progress."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


def fetch_deck_list(page: int, page_size: int = 64) -> Optional[dict]:
    """Fetch a page of Commander deck search results."""
    params = {
        "pageNumber": page,
        "pageSize": page_size,
        "sortType": "views",
        "sortDirection": "Descending",
        "fmt": "commander",
        "board": "mainboard",
    }
    try:
        resp = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch page {page}: {e}")
        return None


def fetch_deck_detail(public_id: str) -> Optional[dict]:
    """Fetch full deck details by public ID."""
    url = f"{DECK_URL}/{public_id}"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch deck {public_id}: {e}")
        return None


def extract_deck_data(detail: dict) -> Optional[dict]:
    """Extract structured deck data from Moxfield API response."""
    # Get commander(s) from commanders board
    commanders_board = detail.get("boards", {}).get("commanders", {}).get("cards", {})
    commanders = [card_data["card"]["name"] for card_data in commanders_board.values()]

    if not commanders:
        return None

    commander = commanders[0]
    partner = commanders[1] if len(commanders) > 1 else None

    # Get mainboard cards
    mainboard = detail.get("boards", {}).get("mainboard", {}).get("cards", {})
    cards = []
    lands = []
    for card_data in mainboard.values():
        card_info = card_data["card"]
        name = card_info["name"]
        type_line = card_info.get("type_line", "")
        qty = card_data.get("quantity", 1)
        for _ in range(qty):
            if "Land" in type_line:
                lands.append(name)
            else:
                cards.append(name)

    # Total should be ~99 (excluding commander)
    total = len(cards) + len(lands)

    return {
        "commander": commander,
        "partner": partner,
        "cards": cards,
        "lands": lands,
        "total_cards": total,
        "source": "moxfield",
        "source_id": detail.get("publicId", ""),
        "name": detail.get("name", ""),
    }


def scrape(target: int = 45000, max_pages: int = 2000):
    """
    Scrape Commander decklists from Moxfield.

    Args:
        target: Target number of decks to scrape.
        max_pages: Maximum search pages to iterate.
    """
    progress = load_progress()
    page = progress["page"]
    total = progress["total_scraped"]
    seen_ids = set(progress["seen_ids"])

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    mode = "a" if OUTPUT_FILE.exists() else "w"

    logger.info(f"Resuming from page {page}, {total} decks scraped so far")

    with open(OUTPUT_FILE, mode) as out:
        while page <= max_pages and total < target:
            result = fetch_deck_list(page)
            time.sleep(RATE_LIMIT_SECONDS)

            if not result:
                logger.warning(f"Empty result at page {page}, retrying...")
                time.sleep(2)
                continue

            decks = result.get("data", [])
            if not decks:
                logger.info(f"No more decks at page {page}, stopping.")
                break

            for deck_summary in decks:
                public_id = deck_summary.get("publicId")
                if not public_id or public_id in seen_ids:
                    continue

                # Fetch full deck
                detail = fetch_deck_detail(public_id)
                time.sleep(RATE_LIMIT_SECONDS)

                if not detail:
                    continue

                deck_data = extract_deck_data(detail)
                if not deck_data:
                    continue

                # Only keep complete decks (98-100 cards total)
                if deck_data["total_cards"] < 98:
                    continue

                out.write(json.dumps(deck_data) + "\n")
                out.flush()
                seen_ids.add(public_id)
                total += 1

                if total % 100 == 0:
                    logger.info(f"Scraped {total} decks (page {page})")
                    progress["page"] = page
                    progress["total_scraped"] = total
                    progress["seen_ids"] = list(seen_ids)
                    save_progress(progress)

            page += 1

    # Final save
    progress["page"] = page
    progress["total_scraped"] = total
    progress["seen_ids"] = list(seen_ids)
    save_progress(progress)
    logger.info(f"Done. Total decks scraped: {total}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    scrape()
```

**Step 2: Create empty `__init__.py`**

```python
# training/__init__.py
```

**Step 3: Run a test scrape (first 10 decks)**

Run:
```bash
cd /home/sheltron/Documents/Magic
python -c "
import logging; logging.basicConfig(level=logging.INFO)
from training.scrape_moxfield import fetch_deck_list, fetch_deck_detail, extract_deck_data
result = fetch_deck_list(1, page_size=5)
if result and result.get('data'):
    deck = result['data'][0]
    print('Search result:', deck.get('publicId'), deck.get('name'))
    detail = fetch_deck_detail(deck['publicId'])
    if detail:
        data = extract_deck_data(detail)
        import json; print(json.dumps(data, indent=2))
"
```

Expected: Prints a structured deck with commander, cards, lands, and total_cards ~99.

**Step 4: Commit**

```bash
git add training/__init__.py training/scrape_moxfield.py
git commit -m "feat(training): add Moxfield deck scraper with resumable progress"
```

---

## Task 2: Deck Scraper — Archidekt

**Files:**
- Create: `training/scrape_archidekt.py`
- Test: manual run — verify JSON output

**Step 1: Create the Archidekt scraper**

```python
# training/scrape_archidekt.py
"""Scrape public Commander decklists from Archidekt."""

import json
import time
import logging
from pathlib import Path
from typing import Optional

import requests

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = DATA_DIR / "raw_archidekt_decks.jsonl"
PROGRESS_FILE = DATA_DIR / "archidekt_progress.json"

# Archidekt public API
BASE_URL = "https://archidekt.com/api"
SEARCH_URL = f"{BASE_URL}/decks/cards/"
DECK_URL = f"{BASE_URL}/decks"

HEADERS = {
    "User-Agent": "MTGDeckTrainer/1.0 (research; contact@example.com)",
    "Accept": "application/json",
}

RATE_LIMIT_SECONDS = 0.2


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"offset": 0, "total_scraped": 0, "seen_ids": []}


def save_progress(progress: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


def fetch_deck_search(offset: int = 0, page_size: int = 50) -> Optional[dict]:
    """Fetch a page of Commander deck search results from Archidekt."""
    params = {
        "formats": 3,  # 3 = Commander
        "orderBy": "-viewCount",
        "offset": offset,
        "pageSize": page_size,
    }
    try:
        resp = requests.get(SEARCH_URL, params=params, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch offset {offset}: {e}")
        return None


def fetch_deck_detail(deck_id: int) -> Optional[dict]:
    """Fetch full deck details by ID."""
    url = f"{DECK_URL}/{deck_id}/"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch deck {deck_id}: {e}")
        return None


def extract_deck_data(detail: dict) -> Optional[dict]:
    """Extract structured deck data from Archidekt API response."""
    cards_data = detail.get("cards", [])
    if not cards_data:
        return None

    commander = None
    partner = None
    cards = []
    lands = []

    for entry in cards_data:
        card_info = entry.get("card", {})
        name = card_info.get("oracleCard", {}).get("name", "")
        categories = entry.get("categories", [])
        type_line = card_info.get("oracleCard", {}).get("typeLine", "")
        qty = entry.get("quantity", 1)

        if "Commander" in categories:
            if commander is None:
                commander = name
            else:
                partner = name
            continue

        for _ in range(qty):
            if "Land" in type_line:
                lands.append(name)
            else:
                cards.append(name)

    if not commander:
        return None

    total = len(cards) + len(lands)

    return {
        "commander": commander,
        "partner": partner,
        "cards": cards,
        "lands": lands,
        "total_cards": total,
        "source": "archidekt",
        "source_id": str(detail.get("id", "")),
        "name": detail.get("name", ""),
    }


def scrape(target: int = 20000, max_offset: int = 100000):
    """Scrape Commander decklists from Archidekt."""
    progress = load_progress()
    offset = progress["offset"]
    total = progress["total_scraped"]
    seen_ids = set(progress["seen_ids"])

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    mode = "a" if OUTPUT_FILE.exists() else "w"

    logger.info(f"Resuming from offset {offset}, {total} decks scraped so far")

    with open(OUTPUT_FILE, mode) as out:
        while offset < max_offset and total < target:
            result = fetch_deck_search(offset)
            time.sleep(RATE_LIMIT_SECONDS)

            if not result:
                time.sleep(2)
                offset += 50
                continue

            decks = result.get("results", [])
            if not decks:
                logger.info(f"No more decks at offset {offset}, stopping.")
                break

            for deck_summary in decks:
                deck_id = deck_summary.get("id")
                if not deck_id or deck_id in seen_ids:
                    continue

                detail = fetch_deck_detail(deck_id)
                time.sleep(RATE_LIMIT_SECONDS)

                if not detail:
                    continue

                deck_data = extract_deck_data(detail)
                if not deck_data or deck_data["total_cards"] < 98:
                    continue

                out.write(json.dumps(deck_data) + "\n")
                out.flush()
                seen_ids.add(deck_id)
                total += 1

                if total % 100 == 0:
                    logger.info(f"Scraped {total} decks (offset {offset})")
                    progress["offset"] = offset
                    progress["total_scraped"] = total
                    progress["seen_ids"] = list(seen_ids)
                    save_progress(progress)

            offset += 50

    progress["offset"] = offset
    progress["total_scraped"] = total
    progress["seen_ids"] = list(seen_ids)
    save_progress(progress)
    logger.info(f"Done. Total decks scraped: {total}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    scrape()
```

**Step 2: Test with a small fetch**

Run:
```bash
cd /home/sheltron/Documents/Magic
python -c "
import logging; logging.basicConfig(level=logging.INFO)
from training.scrape_archidekt import fetch_deck_search
result = fetch_deck_search(0, page_size=5)
if result:
    for d in result.get('results', [])[:3]:
        print(d.get('id'), d.get('name'))
"
```

Expected: Prints 3 deck IDs and names.

**Step 3: Commit**

```bash
git add training/scrape_archidekt.py
git commit -m "feat(training): add Archidekt deck scraper"
```

---

## Task 3: Deck Scraper — EDHREC Average Decks

**Files:**
- Create: `training/scrape_edhrec.py`
- Test: manual run — verify JSON output

**Step 1: Create the EDHREC scraper**

```python
# training/scrape_edhrec.py
"""Scrape average Commander decklists from EDHREC."""

import json
import time
import logging
from pathlib import Path
from typing import Optional, List

import requests

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
OUTPUT_FILE = DATA_DIR / "raw_edhrec_decks.jsonl"
PROGRESS_FILE = DATA_DIR / "edhrec_progress.json"

HEADERS = {
    "User-Agent": "MTGDeckTrainer/1.0 (research; contact@example.com)",
    "Accept": "application/json",
}

RATE_LIMIT_SECONDS = 0.5  # EDHREC is more sensitive


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {"completed_commanders": [], "total_scraped": 0}


def save_progress(progress: dict):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f)


def get_commander_list() -> List[str]:
    """Get list of all valid commanders from our card database."""
    cards_path = Path(__file__).parent.parent / "mtg_data" / "cards_min.jsonl"
    commanders = []
    with open(cards_path) as f:
        for line in f:
            card = json.loads(line)
            type_line = card.get("type_line", "")
            if "Legendary" in type_line and ("Creature" in type_line or "Planeswalker" in type_line):
                legalities = card.get("legalities", {})
                if legalities.get("commander") == "legal":
                    commanders.append(card["name"])
    return sorted(commanders)


def commander_to_slug(name: str) -> str:
    """Convert commander name to EDHREC URL slug."""
    # "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
    slug = name.lower()
    slug = slug.replace("'", "").replace(",", "").replace(".", "")
    slug = slug.replace(" ", "-")
    # Remove consecutive hyphens
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")


def fetch_average_deck(commander_slug: str) -> Optional[dict]:
    """Fetch average deck for a commander from EDHREC JSON API."""
    url = f"https://json.edhrec.com/pages/average-decks/{commander_slug}.json"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=30)
        if resp.status_code == 404:
            return None  # Commander not on EDHREC
        resp.raise_for_status()
        return resp.json()
    except requests.RequestException as e:
        logger.debug(f"Failed to fetch {commander_slug}: {e}")
        return None


def extract_deck_data(edhrec_data: dict, commander_name: str) -> Optional[dict]:
    """Extract deck data from EDHREC average deck response."""
    # EDHREC average deck structure varies — adapt to actual response
    header = edhrec_data.get("header", {})
    card_lists = edhrec_data.get("cardlists", [])

    cards = []
    lands = []

    for section in card_lists:
        tag = section.get("tag", "")
        for card_entry in section.get("cardviews", []):
            name = card_entry.get("name", "")
            if not name or name == commander_name:
                continue
            type_line = card_entry.get("type_line", "")
            if "Land" in type_line:
                lands.append(name)
            else:
                cards.append(name)

    total = len(cards) + len(lands)
    if total < 90:  # EDHREC average decks may be shorter
        return None

    return {
        "commander": commander_name,
        "partner": None,
        "cards": cards,
        "lands": lands,
        "total_cards": total,
        "source": "edhrec",
        "source_id": commander_to_slug(commander_name),
        "name": f"Average {commander_name} Deck",
    }


def scrape():
    """Scrape average decklists from EDHREC for all known commanders."""
    progress = load_progress()
    completed = set(progress["completed_commanders"])
    total = progress["total_scraped"]

    commanders = get_commander_list()
    remaining = [c for c in commanders if c not in completed]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    mode = "a" if OUTPUT_FILE.exists() else "w"

    logger.info(f"Scraping {len(remaining)} commanders ({total} already done)")

    with open(OUTPUT_FILE, mode) as out:
        for i, commander_name in enumerate(remaining):
            slug = commander_to_slug(commander_name)
            data = fetch_average_deck(slug)
            time.sleep(RATE_LIMIT_SECONDS)

            if data:
                deck = extract_deck_data(data, commander_name)
                if deck:
                    out.write(json.dumps(deck) + "\n")
                    out.flush()
                    total += 1

            completed.add(commander_name)

            if (i + 1) % 50 == 0:
                logger.info(f"Processed {i+1}/{len(remaining)} commanders, {total} decks found")
                progress["completed_commanders"] = list(completed)
                progress["total_scraped"] = total
                save_progress(progress)

    progress["completed_commanders"] = list(completed)
    progress["total_scraped"] = total
    save_progress(progress)
    logger.info(f"Done. Total EDHREC decks: {total}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    scrape()
```

**Step 2: Test with one commander**

Run:
```bash
cd /home/sheltron/Documents/Magic
python -c "
from training.scrape_edhrec import commander_to_slug, fetch_average_deck, extract_deck_data
slug = commander_to_slug('Atraxa, Praetors\\' Voice')
print('Slug:', slug)
data = fetch_average_deck(slug)
if data:
    deck = extract_deck_data(data, 'Atraxa, Praetors\\' Voice')
    if deck:
        print(f'Commander: {deck[\"commander\"]}')
        print(f'Cards: {len(deck[\"cards\"])}, Lands: {len(deck[\"lands\"])}')
        print(f'Total: {deck[\"total_cards\"]}')
    else:
        print('extract_deck_data returned None — inspect EDHREC response format')
        import json; print(json.dumps(data, indent=2)[:2000])
else:
    print('No data from EDHREC for this slug')
"
```

Expected: Commander name, card/land counts. If EDHREC format differs from expected, adapt `extract_deck_data` to match the actual response structure.

**Step 3: Commit**

```bash
git add training/scrape_edhrec.py
git commit -m "feat(training): add EDHREC average deck scraper"
```

---

## Task 4: Data Cleaning & Enrichment Pipeline

**Files:**
- Create: `training/clean_and_enrich.py`
- Test: manual run on sample data

**Step 1: Create the cleaning/enrichment pipeline**

```python
# training/clean_and_enrich.py
"""Clean, validate, enrich, and deduplicate scraped decklists."""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.functional_tags import detect_tags, get_primary_function
from backend.rules import (
    COMMANDER_BANNED_CARDS, GAME_CHANGER_CARDS, TUTOR_CARDS,
    COMBO_CARDS, EXTRA_TURN_SPELLS,
)

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
CARDS_PATH = Path(__file__).parent.parent / "mtg_data" / "cards_min.jsonl"
OUTPUT_FILE = DATA_DIR / "training_decks.jsonl"


def load_card_database() -> Tuple[Dict[str, Dict], Set[str]]:
    """Load card DB and set of valid commander names."""
    card_db = {}
    valid_commanders = set()
    with open(CARDS_PATH) as f:
        for line in f:
            card = json.loads(line)
            card_db[card["name"]] = card
            type_line = card.get("type_line", "")
            if "Legendary" in type_line and ("Creature" in type_line or "Planeswalker" in type_line):
                valid_commanders.add(card["name"])
    return card_db, valid_commanders


def estimate_bracket(cards: List[str], card_db: Dict[str, Dict]) -> int:
    """Estimate power bracket from deck composition."""
    game_changers = sum(1 for c in cards if c in GAME_CHANGER_CARDS)
    tutors = sum(1 for c in cards if c in TUTOR_CARDS)
    combos = sum(1 for c in cards if c in COMBO_CARDS)
    extra_turns = sum(1 for c in cards if c in EXTRA_TURN_SPELLS)

    # Fast mana detection
    fast_mana = {"Sol Ring", "Mana Vault", "Chrome Mox", "Mox Diamond",
                 "Jeweled Lotus", "Ancient Tomb", "Grim Monolith"}
    fast_mana_count = sum(1 for c in cards if c in fast_mana)

    # Scoring
    score = 0
    score += min(game_changers * 1.5, 6)
    score += min(tutors * 1.0, 5)
    score += combos * 2.0
    score += extra_turns * 1.5
    score += fast_mana_count * 1.0

    # Average CMC (lower = more competitive)
    cmcs = []
    for c in cards:
        if c in card_db:
            cmc = card_db[c].get("cmc", 0)
            type_line = card_db[c].get("type_line", "")
            if "Land" not in type_line:
                cmcs.append(float(cmc))
    avg_cmc = sum(cmcs) / len(cmcs) if cmcs else 3.5
    if avg_cmc < 2.5:
        score += 3
    elif avg_cmc < 3.0:
        score += 1

    if score >= 12:
        return 5  # cEDH
    elif score >= 8:
        return 4  # Optimized
    elif score >= 4:
        return 3  # Upgraded
    elif score >= 1:
        return 2  # Core
    else:
        return 1  # Exhibition


def categorize_cards(cards: List[str], card_db: Dict[str, Dict]) -> Dict[str, int]:
    """Count cards by functional role."""
    tags_count: Dict[str, int] = {}
    for card_name in cards:
        card = card_db.get(card_name)
        if not card:
            continue
        oracle = card.get("oracle_text", "")
        type_line = card.get("type_line", "")
        keywords = card.get("keywords", [])
        tags = detect_tags(oracle, type_line, keywords)
        primary = get_primary_function(tags)
        tags_count[primary] = tags_count.get(primary, 0) + 1
    return tags_count


def deck_fingerprint(cards: List[str]) -> frozenset:
    """Create a fingerprint for deduplication."""
    return frozenset(cards)


def jaccard_similarity(a: frozenset, b: frozenset) -> float:
    """Jaccard similarity between two card sets."""
    if not a and not b:
        return 1.0
    intersection = len(a & b)
    union = len(a | b)
    return intersection / union if union > 0 else 0.0


def clean_and_enrich(dedup_threshold: float = 0.90):
    """
    Load raw scraped decks, clean, validate, enrich, deduplicate,
    and write to training_decks.jsonl.
    """
    card_db, valid_commanders = load_card_database()
    logger.info(f"Loaded {len(card_db)} cards, {len(valid_commanders)} valid commanders")

    # Load all raw decks
    raw_files = [
        DATA_DIR / "raw_moxfield_decks.jsonl",
        DATA_DIR / "raw_archidekt_decks.jsonl",
        DATA_DIR / "raw_edhrec_decks.jsonl",
    ]

    raw_decks = []
    for path in raw_files:
        if path.exists():
            with open(path) as f:
                for line in f:
                    if line.strip():
                        raw_decks.append(json.loads(line))
            logger.info(f"Loaded {path.name}")

    logger.info(f"Total raw decks: {len(raw_decks)}")

    # Validate and enrich
    valid_decks = []
    stats = {"total": len(raw_decks), "invalid_commander": 0, "incomplete": 0,
             "bad_cards": 0, "banned_commander": 0}

    for deck in raw_decks:
        commander = deck.get("commander", "")

        # Validate commander
        if commander not in valid_commanders:
            stats["invalid_commander"] += 1
            continue

        if commander in COMMANDER_BANNED_CARDS:
            stats["banned_commander"] += 1
            continue

        # Validate card count
        all_cards = deck.get("cards", []) + deck.get("lands", [])
        if len(all_cards) < 98:
            stats["incomplete"] += 1
            continue

        # Validate all cards exist in DB
        resolved = [c for c in all_cards if c in card_db]
        if len(resolved) < len(all_cards) * 0.95:  # Allow 5% unresolved
            stats["bad_cards"] += 1
            continue

        # Only keep cards that resolve
        clean_cards = [c for c in deck.get("cards", []) if c in card_db]
        clean_lands = [c for c in deck.get("lands", []) if c in card_db]

        # Enrich
        bracket = estimate_bracket(clean_cards + clean_lands, card_db)
        tags = categorize_cards(clean_cards, card_db)

        enriched = {
            "commander": commander,
            "partner": deck.get("partner"),
            "cards": clean_cards,
            "lands": clean_lands,
            "tags": tags,
            "bracket_estimate": bracket,
            "source": deck.get("source", "unknown"),
        }
        valid_decks.append(enriched)

    logger.info(f"Valid decks after filtering: {len(valid_decks)}")
    logger.info(f"Stats: {stats}")

    # Deduplicate
    fingerprints: List[frozenset] = []
    deduped = []
    for deck in valid_decks:
        fp = deck_fingerprint(deck["cards"] + deck["lands"])
        is_dup = False
        # Only check recent fingerprints (performance optimization)
        for existing_fp in fingerprints[-1000:]:
            if jaccard_similarity(fp, existing_fp) > dedup_threshold:
                is_dup = True
                break
        if not is_dup:
            deduped.append(deck)
            fingerprints.append(fp)

    logger.info(f"After deduplication: {len(deduped)} (removed {len(valid_decks) - len(deduped)})")

    # Write output
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        for deck in deduped:
            f.write(json.dumps(deck) + "\n")

    logger.info(f"Written to {OUTPUT_FILE}")

    # Print summary stats
    brackets = {}
    sources = {}
    for d in deduped:
        b = d["bracket_estimate"]
        brackets[b] = brackets.get(b, 0) + 1
        s = d["source"]
        sources[s] = sources.get(s, 0) + 1

    logger.info(f"By bracket: {dict(sorted(brackets.items()))}")
    logger.info(f"By source: {sources}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    clean_and_enrich()
```

**Step 2: Test with small sample**

Create a few test entries in `data/raw_moxfield_decks.jsonl` (from Task 1 test), then run:

```bash
cd /home/sheltron/Documents/Magic
python -m training.clean_and_enrich
```

Expected: Prints validation stats, bracket distribution, and writes `data/training_decks.jsonl`.

**Step 3: Commit**

```bash
git add training/clean_and_enrich.py
git commit -m "feat(training): add data cleaning and enrichment pipeline"
```

---

## Task 5: Scorer Training Data Preparation

**Files:**
- Create: `training/prepare_scorer_data.py`
- Test: manual run — verify JSONL output

**Step 1: Create scorer data preparation script**

```python
# training/prepare_scorer_data.py
"""Generate scorer training data: card-commander fit rating pairs."""

import json
import random
import logging
import sys
from pathlib import Path
from typing import Dict, List, Set

sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.functional_tags import detect_tags, get_primary_function

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
CARDS_PATH = Path(__file__).parent.parent / "mtg_data" / "cards_min.jsonl"
INPUT_FILE = DATA_DIR / "training_decks.jsonl"
OUTPUT_FILE = DATA_DIR / "scorer_train.jsonl"

SYSTEM_PROMPT = "You are an MTG Commander deckbuilding expert. Rate how well a card fits in this commander's deck."


def load_card_database() -> Dict[str, Dict]:
    card_db = {}
    with open(CARDS_PATH) as f:
        for line in f:
            card = json.loads(line)
            card_db[card["name"]] = card
    return card_db


def card_colors_str(card: Dict) -> str:
    colors = card.get("color_identity", [])
    return "".join(colors) if colors else "C"


def generate_explanation(card: Dict, commander: Dict, is_positive: bool) -> str:
    """Generate a brief synergy explanation for training data."""
    card_name = card["name"]
    card_text = card.get("oracle_text", "")
    card_type = card.get("type_line", "")
    cmd_name = commander["name"]
    cmd_text = commander.get("oracle_text", "")

    card_tags = detect_tags(card_text, card_type, card.get("keywords", []))
    primary = get_primary_function(card_tags)

    if not is_positive:
        reasons = []
        card_identity = set(card.get("color_identity", []))
        cmd_identity = set(commander.get("color_identity", []))
        if not card_identity.issubset(cmd_identity):
            return f"0 - {card_name} has colors outside {cmd_name}'s color identity."
        return f"{random.randint(1, 4)} - {card_name} doesn't synergize strongly with {cmd_name}'s strategy."

    score = random.randint(7, 10)
    role_desc = {
        "removal": "provides removal",
        "ramp": "accelerates mana development",
        "card-draw": "provides card advantage",
        "tutor": "increases consistency",
        "board-wipe": "provides board control",
        "counter": "provides counterspell protection",
        "protection": "protects key pieces",
        "recursion": "provides graveyard recursion",
        "token": "generates tokens",
        "lifegain": "provides life gain",
        "sacrifice": "enables sacrifice synergies",
    }
    role = role_desc.get(primary, "supports the deck's strategy")
    return f"{score} - {card_name} {role} in {cmd_name}."


def prepare_scorer_data(examples_per_deck: int = 10):
    """Generate scorer training pairs from cleaned deck data."""
    card_db = load_card_database()

    # Group cards by color identity for negative sampling
    cards_by_identity: Dict[str, List[str]] = {}
    for name, card in card_db.items():
        identity = card_colors_str(card)
        if identity not in cards_by_identity:
            cards_by_identity[identity] = []
        cards_by_identity[identity].append(name)

    # Load decks
    decks = []
    with open(INPUT_FILE) as f:
        for line in f:
            if line.strip():
                decks.append(json.loads(line))

    logger.info(f"Generating scorer data from {len(decks)} decks")

    total = 0
    with open(OUTPUT_FILE, "w") as out:
        for deck in decks:
            commander_name = deck["commander"]
            commander = card_db.get(commander_name)
            if not commander:
                continue

            cmd_identity = set(commander.get("color_identity", []))
            cmd_colors = "".join(sorted(cmd_identity)) if cmd_identity else "C"
            bracket = deck.get("bracket_estimate", 3)

            all_deck_cards = set(deck.get("cards", []) + deck.get("lands", []))

            # Sample positive cards
            deck_card_list = list(all_deck_cards)
            pos_samples = random.sample(deck_card_list, min(examples_per_deck // 2, len(deck_card_list)))

            for card_name in pos_samples:
                card = card_db.get(card_name)
                if not card:
                    continue

                explanation = generate_explanation(card, commander, is_positive=True)
                user_msg = (
                    f"Commander: {commander_name} ({cmd_colors})\n"
                    f"Bracket: {bracket}\n"
                    f"Card: {card_name}\n"
                    f"Type: {card.get('type_line', '')}\n"
                    f"Cost: {card.get('mana_cost', '')}\n"
                    f"Text: {card.get('oracle_text', '')}\n"
                    f"Rate this card's fit from 0-10."
                )

                entry = {
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                        {"role": "assistant", "content": explanation},
                    ]
                }
                out.write(json.dumps(entry) + "\n")
                total += 1

            # Sample hard negatives (same colors, not in deck)
            eligible_negatives = []
            for identity_key, card_names in cards_by_identity.items():
                identity_set = set(identity_key) - {"C"}
                if identity_set.issubset(cmd_identity):
                    eligible_negatives.extend(
                        [n for n in card_names if n not in all_deck_cards]
                    )

            neg_samples = random.sample(
                eligible_negatives,
                min(examples_per_deck // 2, len(eligible_negatives))
            )

            for card_name in neg_samples:
                card = card_db.get(card_name)
                if not card:
                    continue

                explanation = generate_explanation(card, commander, is_positive=False)
                user_msg = (
                    f"Commander: {commander_name} ({cmd_colors})\n"
                    f"Bracket: {bracket}\n"
                    f"Card: {card_name}\n"
                    f"Type: {card.get('type_line', '')}\n"
                    f"Cost: {card.get('mana_cost', '')}\n"
                    f"Text: {card.get('oracle_text', '')}\n"
                    f"Rate this card's fit from 0-10."
                )

                entry = {
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                        {"role": "assistant", "content": explanation},
                    ]
                }
                out.write(json.dumps(entry) + "\n")
                total += 1

    logger.info(f"Generated {total} scorer training examples → {OUTPUT_FILE}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    prepare_scorer_data()
```

**Step 2: Commit**

```bash
git add training/prepare_scorer_data.py
git commit -m "feat(training): add scorer training data preparation"
```

---

## Task 6: Composer Training Data Preparation

**Files:**
- Create: `training/prepare_composer_data.py`
- Test: manual run — verify JSONL output

**Step 1: Create composer data preparation script**

```python
# training/prepare_composer_data.py
"""Generate composer training data: full deck generation sequences."""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, List

sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.functional_tags import detect_tags, get_primary_function

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
CARDS_PATH = Path(__file__).parent.parent / "mtg_data" / "cards_min.jsonl"
INPUT_FILE = DATA_DIR / "training_decks.jsonl"
OUTPUT_FILE = DATA_DIR / "composer_train.jsonl"

SYSTEM_PROMPT = "You are an expert MTG Commander deckbuilder. Build a 99-card deck for the given commander."

# Functional role display order
ROLE_ORDER = [
    "ramp", "card-draw", "removal", "board-wipe", "counter", "tutor",
    "recursion", "protection", "token", "lifegain", "sacrifice", "utility",
]

ROLE_DISPLAY = {
    "ramp": "Ramp",
    "card-draw": "Card Draw",
    "removal": "Removal",
    "board-wipe": "Board Wipes",
    "counter": "Counterspells",
    "tutor": "Tutors",
    "recursion": "Recursion",
    "protection": "Protection",
    "token": "Token Generators",
    "lifegain": "Lifegain",
    "sacrifice": "Sacrifice",
    "utility": "Synergy / Utility",
}


def load_card_database() -> Dict[str, Dict]:
    card_db = {}
    with open(CARDS_PATH) as f:
        for line in f:
            card = json.loads(line)
            card_db[card["name"]] = card
    return card_db


def format_deck_output(cards: List[str], lands: List[str], card_db: Dict[str, Dict]) -> str:
    """Format a deck as grouped card list for training."""
    # Categorize non-land cards by functional role
    by_role: Dict[str, List[str]] = {}
    for name in cards:
        card = card_db.get(name)
        if not card:
            continue
        oracle = card.get("oracle_text", "")
        type_line = card.get("type_line", "")
        keywords = card.get("keywords", [])
        tags = detect_tags(oracle, type_line, keywords)
        role = get_primary_function(tags)
        if role not in by_role:
            by_role[role] = []
        by_role[role].append(name)

    # Build output
    sections = []
    for role in ROLE_ORDER:
        if role in by_role and by_role[role]:
            display = ROLE_DISPLAY.get(role, role.title())
            card_list = sorted(by_role[role])
            sections.append(f"## {display} ({len(card_list)})")
            sections.extend(card_list)

    # Lands section
    sorted_lands = sorted(lands)
    sections.append(f"## Lands ({len(sorted_lands)})")
    sections.extend(sorted_lands)

    return "\n".join(sections)


def prepare_composer_data():
    """Generate composer training sequences from cleaned deck data."""
    card_db = load_card_database()

    decks = []
    with open(INPUT_FILE) as f:
        for line in f:
            if line.strip():
                decks.append(json.loads(line))

    logger.info(f"Generating composer data from {len(decks)} decks")

    total = 0
    with open(OUTPUT_FILE, "w") as out:
        for deck in decks:
            commander_name = deck["commander"]
            commander = card_db.get(commander_name)
            if not commander:
                continue

            cmd_identity = commander.get("color_identity", [])
            cmd_colors = "".join(sorted(cmd_identity)) if cmd_identity else "C"
            bracket = deck.get("bracket_estimate", 3)

            cards = deck.get("cards", [])
            lands = deck.get("lands", [])

            # Format the deck output
            deck_output = format_deck_output(cards, lands, card_db)

            user_msg = (
                f"Commander: {commander_name}\n"
                f"Colors: {cmd_colors}\n"
                f"Bracket: {bracket}"
            )

            entry = {
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                    {"role": "assistant", "content": deck_output},
                ]
            }
            out.write(json.dumps(entry) + "\n")
            total += 1

    logger.info(f"Generated {total} composer training examples → {OUTPUT_FILE}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    prepare_composer_data()
```

**Step 2: Commit**

```bash
git add training/prepare_composer_data.py
git commit -m "feat(training): add composer training data preparation"
```

---

## Task 7: Colab Notebook — Scorer Training

**Files:**
- Create: `training/train_scorer.ipynb`

**Step 1: Create the Colab notebook for scorer adapter training**

The notebook should contain these cells (create as a standard .ipynb or a Python script that can be uploaded to Colab):

```python
# training/train_scorer.py
"""
Colab training script for mtg-scorer LoRA adapter.
Upload this + scorer_train.jsonl to Colab, then run.

Requires: pip install unsloth
GPU: A100 (Colab Pro)
"""

# Cell 1: Install dependencies
# !pip install unsloth

# Cell 2: Load model
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="Qwen/Qwen3.5-4B-Instruct",
    max_seq_length=512,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    lora_alpha=32,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_dropout=0.05,
    bias="none",
    use_gradient_checkpointing="unsloth",
)

# Cell 3: Load dataset
from datasets import load_dataset

dataset = load_dataset("json", data_files="scorer_train.jsonl", split="train")
print(f"Dataset size: {len(dataset)}")

# Cell 4: Format for chat
def format_chat(example):
    messages = example["messages"]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    return {"text": text}

dataset = dataset.map(format_chat)

# Cell 5: Train
from trl import SFTTrainer
from transformers import TrainingArguments

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=512,
    args=TrainingArguments(
        output_dir="./mtg-scorer-output",
        per_device_train_batch_size=16,
        gradient_accumulation_steps=2,
        warmup_ratio=0.05,
        num_train_epochs=3,
        learning_rate=2e-4,
        fp16=not False,  # Use bf16 on A100
        bf16=True,
        logging_steps=50,
        save_strategy="epoch",
        seed=42,
    ),
)

trainer.train()

# Cell 6: Save adapter
model.save_pretrained("mtg-scorer-adapter")
tokenizer.save_pretrained("mtg-scorer-adapter")

# Cell 7: Merge and export to GGUF
model.save_pretrained_merged(
    "mtg-scorer-merged",
    tokenizer,
    save_method="merged_16bit",
)

# Export GGUF Q8
model.save_pretrained_gguf(
    "mtg-scorer-gguf",
    tokenizer,
    quantization_method="q8_0",
)

print("Done! Download mtg-scorer-gguf/ for local inference.")
```

**Step 2: Commit**

```bash
git add training/train_scorer.py
git commit -m "feat(training): add scorer LoRA training script for Colab"
```

---

## Task 8: Colab Notebook — Composer Training

**Files:**
- Create: `training/train_composer.py`

**Step 1: Create the Colab script for composer adapter training**

```python
# training/train_composer.py
"""
Colab training script for mtg-composer LoRA adapter.
Upload this + composer_train.jsonl to Colab, then run.

Requires: pip install unsloth
GPU: A100 (Colab Pro)
"""

# Cell 1: Install dependencies
# !pip install unsloth

# Cell 2: Load model
from unsloth import FastLanguageModel

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="Qwen/Qwen3.5-4B-Instruct",
    max_seq_length=4096,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=32,
    lora_alpha=64,
    target_modules=[
        "q_proj", "k_proj", "v_proj", "o_proj",
        "gate_proj", "up_proj", "down_proj",
    ],
    lora_dropout=0.05,
    bias="none",
    use_gradient_checkpointing="unsloth",
)

# Cell 3: Load dataset
from datasets import load_dataset

dataset = load_dataset("json", data_files="composer_train.jsonl", split="train")
print(f"Dataset size: {len(dataset)}")

# Cell 4: Format for chat
def format_chat(example):
    messages = example["messages"]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    return {"text": text}

dataset = dataset.map(format_chat)

# Cell 5: Train
from trl import SFTTrainer
from transformers import TrainingArguments

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=4096,
    args=TrainingArguments(
        output_dir="./mtg-composer-output",
        per_device_train_batch_size=4,
        gradient_accumulation_steps=8,
        warmup_ratio=0.05,
        num_train_epochs=5,
        learning_rate=1e-4,
        bf16=True,
        logging_steps=25,
        save_strategy="epoch",
        seed=42,
    ),
)

trainer.train()

# Cell 6: Save adapter
model.save_pretrained("mtg-composer-adapter")
tokenizer.save_pretrained("mtg-composer-adapter")

# Cell 7: Merge and export to GGUF
model.save_pretrained_merged(
    "mtg-composer-merged",
    tokenizer,
    save_method="merged_16bit",
)

model.save_pretrained_gguf(
    "mtg-composer-gguf",
    tokenizer,
    quantization_method="q8_0",
)

print("Done! Download mtg-composer-gguf/ for local inference.")
```

**Step 2: Commit**

```bash
git add training/train_composer.py
git commit -m "feat(training): add composer LoRA training script for Colab"
```

---

## Task 9: Model Composer Backend Integration

**Files:**
- Create: `backend/model_composer.py`
- Test: `backend/tests/test_model_composer.py`

**Step 1: Write failing test**

```python
# backend/tests/test_model_composer.py
"""Tests for model_composer deck generation."""

import pytest
from unittest.mock import MagicMock, patch


class TestDeckComposer:
    """Tests for the DeckComposer class."""

    def test_parse_model_output_valid(self):
        """Parse a well-formed model output into card lists."""
        from backend.model_composer import DeckComposer

        output = """## Ramp (3)
Sol Ring
Arcane Signet
Fellwar Stone
## Removal (2)
Swords to Plowshares
Path to Exile
## Lands (2)
Command Tower
Plains"""

        cards, lands = DeckComposer._parse_model_output(output)
        assert "Sol Ring" in cards
        assert "Arcane Signet" in cards
        assert "Swords to Plowshares" in cards
        assert "Command Tower" in lands
        assert "Plains" in lands
        assert len(cards) == 5
        assert len(lands) == 2

    def test_parse_model_output_handles_junk(self):
        """Ignore lines that aren't card names."""
        from backend.model_composer import DeckComposer

        output = """## Ramp (1)
Sol Ring
Some random text the model hallucinated
## Lands (1)
Command Tower"""

        cards, lands = DeckComposer._parse_model_output(output)
        # Should get at least the valid-looking card names
        assert len(cards) + len(lands) >= 2

    def test_validate_deck_filters_invalid_cards(self):
        """Validation removes cards not in the card database."""
        from backend.model_composer import DeckComposer

        mock_card_db = {
            "Sol Ring": {"name": "Sol Ring", "color_identity": [], "type_line": "Artifact"},
            "Command Tower": {"name": "Command Tower", "color_identity": [], "type_line": "Land"},
        }

        cards = ["Sol Ring", "Fake Card Name"]
        lands = ["Command Tower", "Nonexistent Land"]

        valid_cards, valid_lands = DeckComposer._validate_cards(
            cards, lands, mock_card_db, commander_identity=set()
        )
        assert valid_cards == ["Sol Ring"]
        assert valid_lands == ["Command Tower"]

    def test_build_prompt(self):
        """Prompt includes commander, colors, and bracket."""
        from backend.model_composer import DeckComposer

        prompt = DeckComposer._build_prompt(
            commander_name="Atraxa, Praetors' Voice",
            colors="BGUW",
            bracket=3,
            theme="Superfriends",
        )
        assert "Atraxa" in prompt
        assert "BGUW" in prompt
        assert "3" in prompt
        assert "Superfriends" in prompt
```

**Step 2: Run test to verify it fails**

```bash
cd /home/sheltron/Documents/Magic
python -m pytest backend/tests/test_model_composer.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'backend.model_composer'`

**Step 3: Write implementation**

```python
# backend/model_composer.py
"""Deck composition using fine-tuned Qwen3.5-4B model."""

import logging
import re
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

MODELS_DIR = Path(__file__).parent.parent / "models"
COMPOSER_MODEL_PATH = MODELS_DIR / "Qwen35" / "mtg-composer-gguf"
SCORER_MODEL_PATH = MODELS_DIR / "Qwen35" / "mtg-scorer-gguf"

COMPOSER_SYSTEM = "You are an expert MTG Commander deckbuilder. Build a 99-card deck for the given commander."


class DeckComposer:
    """Generate Commander decklists using fine-tuned Qwen3.5-4B."""

    def __init__(self):
        self.llm = None

    def _load_model(self):
        """Lazy-load the GGUF model."""
        if self.llm is not None:
            return

        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError(
                "llama-cpp-python required for DeckComposer. "
                "Install with: pip install llama-cpp-python"
            )

        # Find the GGUF file
        gguf_files = list(COMPOSER_MODEL_PATH.glob("*.gguf"))
        if not gguf_files:
            raise FileNotFoundError(f"No GGUF model found in {COMPOSER_MODEL_PATH}")

        self.llm = Llama(
            model_path=str(gguf_files[0]),
            n_ctx=4096,
            n_gpu_layers=-1,  # Offload all layers to GPU
            n_threads=4,
            verbose=False,
        )

    @staticmethod
    def _build_prompt(
        commander_name: str,
        colors: str,
        bracket: int,
        theme: str = "",
    ) -> str:
        """Build the user prompt for deck generation."""
        parts = [
            f"Commander: {commander_name}",
            f"Colors: {colors}",
            f"Bracket: {bracket}",
        ]
        if theme:
            parts.append(f"Theme: {theme}")
        return "\n".join(parts)

    @staticmethod
    def _parse_model_output(output: str) -> Tuple[List[str], List[str]]:
        """
        Parse model output into card lists.

        Expected format:
        ## Category (N)
        Card Name 1
        Card Name 2
        ...
        ## Lands (N)
        Land Name 1
        ...
        """
        cards = []
        lands = []
        in_lands = False

        for line in output.strip().split("\n"):
            line = line.strip()
            if not line:
                continue

            # Section header
            if line.startswith("## "):
                in_lands = "land" in line.lower()
                continue

            # Skip lines that look like commentary, not card names
            if line.startswith("#") or line.startswith("-") or line.startswith("*"):
                continue
            if len(line) > 80:  # Card names aren't this long
                continue
            if ":" in line and not "," in line:  # Looks like "Key: value"
                # But allow card names with commas like "Atraxa, Praetors' Voice"
                if line.index(":") < 3:  # e.g., "1: Sol Ring" — skip numbering
                    line = line.split(":", 1)[1].strip()

            # Strip leading numbers like "1. Sol Ring"
            line = re.sub(r"^\d+\.\s*", "", line)

            if in_lands:
                lands.append(line)
            else:
                cards.append(line)

        return cards, lands

    @staticmethod
    def _validate_cards(
        cards: List[str],
        lands: List[str],
        card_db: Dict[str, Dict],
        commander_identity: Set[str],
    ) -> Tuple[List[str], List[str]]:
        """Validate card names against database and color identity."""
        valid_cards = []
        valid_lands = []

        for name in cards:
            card = card_db.get(name)
            if not card:
                continue
            card_identity = set(card.get("color_identity", []) or [])
            if card_identity.issubset(commander_identity):
                valid_cards.append(name)

        for name in lands:
            if name in card_db:
                valid_lands.append(name)

        return valid_cards, valid_lands

    def compose_deck(
        self,
        commander_name: str,
        colors: str,
        bracket: int,
        theme: str = "",
        card_db: Optional[Dict[str, Dict]] = None,
    ) -> Tuple[List[str], List[str]]:
        """
        Generate a 99-card decklist using the model.

        Args:
            commander_name: Commander name
            colors: Color identity string (e.g., "WUBG")
            bracket: Power bracket (1-5)
            theme: Optional theme
            card_db: Card database for validation

        Returns:
            Tuple of (non-land cards, lands)
        """
        self._load_model()

        prompt = self._build_prompt(commander_name, colors, bracket, theme)

        full_prompt = (
            f"<|im_start|>system\n{COMPOSER_SYSTEM}<|im_end|>\n"
            f"<|im_start|>user\n{prompt}<|im_end|>\n"
            f"<|im_start|>assistant\n"
        )

        output = self.llm(
            full_prompt,
            max_tokens=3000,
            temperature=0.7,
            top_p=0.9,
            stop=["<|im_end|>"],
        )

        raw_text = output["choices"][0]["text"]
        cards, lands = self._parse_model_output(raw_text)

        # Validate if card_db provided
        if card_db:
            commander_identity = set(colors)
            cards, lands = self._validate_cards(cards, lands, card_db, commander_identity)

        return cards, lands


# Singleton
_composer: Optional[DeckComposer] = None


def get_composer() -> DeckComposer:
    global _composer
    if _composer is None:
        _composer = DeckComposer()
    return _composer
```

**Step 4: Run tests**

```bash
cd /home/sheltron/Documents/Magic
python -m pytest backend/tests/test_model_composer.py -v
```

Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add backend/model_composer.py backend/tests/test_model_composer.py
git commit -m "feat: add DeckComposer for model-based deck generation"
```

---

## Task 10: Update DeckGenerator to Use Model Composer

**Files:**
- Modify: `backend/deck_generator.py`
- Test: existing tests still pass

**Step 1: Add model-based composition path to `generate_deck`**

In `backend/deck_generator.py`, add a new method `generate_deck_with_model` that wraps the model composer with FAISS candidate narrowing and validation. Also update `generate_deck` to optionally use the model path.

Add to the `DeckGenerator` class:

```python
def generate_deck_with_model(
    self,
    commander_name: str,
    bracket: int = 2,
    theme: str = "",
    budget_tier: Optional[str] = None,
) -> Dict:
    """
    Generate a deck using the Qwen3.5 model composer with FAISS + validation.

    Falls back to the standard generate_deck if model is unavailable.
    """
    if not self._loaded:
        self.load()

    # Find commander
    commander = self.find_commander(commander_name)
    if not commander:
        return {"error": f"Commander not found: {commander_name}"}

    commander_identity = commander.get('color_identity', []) or []
    colors = "".join(sorted(commander_identity)) if commander_identity else "C"

    # Try model-based generation
    try:
        from backend.model_composer import get_composer
        composer = get_composer()
        model_cards, model_lands = composer.compose_deck(
            commander_name=commander.get('name', commander_name),
            colors=colors,
            bracket=bracket,
            theme=theme,
            card_db=self.card_by_name,
        )

        # Validate and repair
        deck = {}
        type_categories = {
            'Commander': [], 'Creatures': [], 'Instants': [], 'Sorceries': [],
            'Artifacts': [], 'Enchantments': [], 'Planeswalkers': [], 'Lands': [], 'Other': []
        }

        # Add valid model cards
        for name in model_cards:
            if name not in deck and name in self.card_by_name:
                if not is_card_banned(name):
                    deck[name] = 1
                    self._add_card_to_type_category(name, type_categories)

        for name in model_lands:
            if name not in deck and name in self.card_by_name:
                deck[name] = 1
                type_categories['Lands'].append(name)

        # Backfill if model didn't produce enough cards
        current_count = sum(deck.values())
        if current_count < 90:
            logger.warning(
                f"Model only produced {current_count} valid cards, "
                f"falling back to standard generation"
            )
            return self.generate_deck(commander_name, bracket, theme, budget_tier)

        # Fill remaining slots from FAISS if needed
        if current_count < 99:
            remaining = 99 - current_count
            synergy_queries = self._extract_synergy_keywords(commander)
            if theme:
                synergy_queries.insert(0, theme)

            backfill_cards = {}
            for query in synergy_queries:
                for card in self.search_cards(query, k=30):
                    name = card.get('name', '')
                    if name and name not in deck and name not in backfill_cards:
                        card_identity = set(card.get('color_identity', []) or [])
                        if card_identity.issubset(set(commander_identity)):
                            if not is_card_banned(name) and not self._is_land(card):
                                backfill_cards[name] = card

            for name in list(backfill_cards.keys())[:remaining]:
                deck[name] = 1
                self._add_card_to_type_category(name, type_categories)

        # Build response
        total = sum(deck.values())
        commander_data = {
            'name': commander.get('name'),
            'mana_cost': commander.get('mana_cost', ''),
            'color_identity': commander_identity,
            'type_line': commander.get('type_line', ''),
            'oracle_text': commander.get('oracle_text', ''),
        }

        return {
            'commander': commander_data,
            'cards': deck,
            'type_categories': type_categories,
            'total_cards': total + 1,  # +1 for commander
            'bracket': bracket,
            'theme': theme,
            'generation_method': 'model',
        }

    except Exception as e:
        logger.warning(f"Model generation failed: {e}, falling back to standard")
        return self.generate_deck(commander_name, bracket, theme, budget_tier)
```

**Step 2: Run existing tests**

```bash
cd /home/sheltron/Documents/Magic
python -m pytest backend/tests/ -v --timeout=60
```

Expected: All existing tests PASS (new method doesn't break anything since it's additive).

**Step 3: Commit**

```bash
git add backend/deck_generator.py
git commit -m "feat: add model-based deck generation path with FAISS backfill"
```

---

## Task 11: Update Model Scorers for Qwen3.5

**Files:**
- Modify: `backend/model_scorers.py`
- Test: existing tests still pass

**Step 1: Add Qwen35Scorer class**

Add to `backend/model_scorers.py`, after the existing `QwenScorer` class:

```python
QWEN35_SCORER_PATH = MODELS_DIR / "Qwen35" / "mtg-scorer-gguf"


class Qwen35Scorer:
    """Score card-commander fit using fine-tuned Qwen3.5-4B."""

    def __init__(self):
        self.llm = None
        self._load_model()

    def _load_model(self):
        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError(
                "llama-cpp-python required for Qwen35Scorer. "
                "Install with: pip install llama-cpp-python"
            )

        gguf_files = list(QWEN35_SCORER_PATH.glob("*.gguf"))
        if not gguf_files:
            raise FileNotFoundError(f"No GGUF model found in {QWEN35_SCORER_PATH}")

        self.llm = Llama(
            model_path=str(gguf_files[0]),
            n_ctx=512,
            n_gpu_layers=-1,
            n_threads=4,
            verbose=False,
        )

    def score_similarity(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str,
        commander_name: str = "",
        commander_colors: str = "",
    ) -> float:
        prompt = f"""<|im_start|>system
You are an MTG Commander deckbuilding expert. Rate how well a card fits in this commander's deck.<|im_end|>
<|im_start|>user
Commander: {commander_name} ({commander_colors})
Card: {candidate_card}
Text: {candidate_text}
Rate this card's fit from 0-10.<|im_end|>
<|im_start|>assistant
"""
        output = self.llm(
            prompt,
            max_tokens=50,
            temperature=0.1,
            stop=["<|im_end|>"],
        )

        response = output["choices"][0]["text"].strip()
        try:
            score = float(response.split()[0])
            return min(1.0, max(0.0, score / 10.0))
        except (ValueError, IndexError):
            return 0.5

    def generate_tradeoff_explanation(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str,
        source_price: float,
        candidate_price: float,
        source_cmc: int,
        candidate_cmc: int,
    ) -> str:
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
            stop=["<|im_end|>", "\n\n"],
        )
        return output["choices"][0]["text"].strip()
```

Also add the singleton:

```python
_qwen35_scorer: Optional[Qwen35Scorer] = None

def get_qwen35_scorer() -> Qwen35Scorer:
    global _qwen35_scorer
    if _qwen35_scorer is None:
        _qwen35_scorer = Qwen35Scorer()
    return _qwen35_scorer
```

**Step 2: Run existing tests**

```bash
cd /home/sheltron/Documents/Magic
python -m pytest backend/tests/test_model_scorers.py -v
```

Expected: Existing tests still PASS (new class is additive, old classes unchanged).

**Step 3: Commit**

```bash
git add backend/model_scorers.py
git commit -m "feat: add Qwen35Scorer for card-commander fit scoring"
```

---

## Task 12: Evaluation Script

**Files:**
- Create: `training/evaluate.py`

**Step 1: Create evaluation metrics script**

```python
# training/evaluate.py
"""Evaluate trained model quality against holdout deck data."""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, List, Set

sys.path.insert(0, str(Path(__file__).parent.parent))

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
CARDS_PATH = Path(__file__).parent.parent / "mtg_data" / "cards_min.jsonl"


def load_card_database() -> Dict[str, Dict]:
    card_db = {}
    with open(CARDS_PATH) as f:
        for line in f:
            card = json.loads(line)
            card_db[card["name"]] = card
    return card_db


def load_test_decks(test_file: str = "training_decks.jsonl", split_pct: float = 0.05) -> List[Dict]:
    """Load the last 5% of decks as test set."""
    decks = []
    with open(DATA_DIR / test_file) as f:
        for line in f:
            if line.strip():
                decks.append(json.loads(line))
    split_idx = int(len(decks) * (1 - split_pct))
    return decks[split_idx:]


def evaluate_color_identity_compliance(
    generated_cards: List[str],
    commander_colors: Set[str],
    card_db: Dict[str, Dict],
) -> float:
    """What % of generated cards are legal for the commander's color identity?"""
    if not generated_cards:
        return 0.0
    legal = 0
    for name in generated_cards:
        card = card_db.get(name)
        if card:
            card_identity = set(card.get("color_identity", []) or [])
            if card_identity.issubset(commander_colors):
                legal += 1
    return legal / len(generated_cards)


def evaluate_card_existence(generated_cards: List[str], card_db: Dict[str, Dict]) -> float:
    """What % of generated card names actually exist?"""
    if not generated_cards:
        return 0.0
    return sum(1 for c in generated_cards if c in card_db) / len(generated_cards)


def evaluate_role_coverage(
    generated_cards: List[str],
    card_db: Dict[str, Dict],
) -> Dict[str, bool]:
    """Check if the deck has ramp, draw, and removal."""
    from backend.functional_tags import detect_tags

    has = {"ramp": False, "card-draw": False, "removal": False}
    for name in generated_cards:
        card = card_db.get(name)
        if not card:
            continue
        tags = detect_tags(
            card.get("oracle_text", ""),
            card.get("type_line", ""),
            card.get("keywords", []),
        )
        if "ramp" in tags:
            has["ramp"] = True
        if "card-draw" in tags:
            has["card-draw"] = True
        if "removal" in tags:
            has["removal"] = True
    return has


def evaluate_jaccard_overlap(
    generated: List[str],
    reference: List[str],
) -> float:
    """Jaccard similarity between generated and reference deck."""
    gen_set = set(generated)
    ref_set = set(reference)
    if not gen_set and not ref_set:
        return 1.0
    intersection = len(gen_set & ref_set)
    union = len(gen_set | ref_set)
    return intersection / union if union > 0 else 0.0


def run_evaluation():
    """Run all evaluation metrics. Requires model to be available."""
    card_db = load_card_database()
    test_decks = load_test_decks()

    logger.info(f"Evaluating on {len(test_decks)} test decks")

    try:
        from backend.model_composer import get_composer
        composer = get_composer()
    except Exception as e:
        logger.error(f"Cannot load model for evaluation: {e}")
        logger.info("Run this after training and placing GGUF files in models/Qwen35/")
        return

    results = {
        "card_existence": [],
        "color_compliance": [],
        "role_coverage": [],
        "jaccard_overlap": [],
        "deck_size": [],
    }

    for i, deck in enumerate(test_decks[:100]):  # Evaluate on first 100 test decks
        commander = deck["commander"]
        cmd_data = card_db.get(commander, {})
        colors = "".join(sorted(cmd_data.get("color_identity", [])))
        bracket = deck.get("bracket_estimate", 3)

        gen_cards, gen_lands = composer.compose_deck(
            commander_name=commander,
            colors=colors,
            bracket=bracket,
            card_db=card_db,
        )

        all_generated = gen_cards + gen_lands
        all_reference = deck.get("cards", []) + deck.get("lands", [])
        cmd_colors = set(cmd_data.get("color_identity", []))

        results["card_existence"].append(evaluate_card_existence(all_generated, card_db))
        results["color_compliance"].append(
            evaluate_color_identity_compliance(all_generated, cmd_colors, card_db)
        )
        results["role_coverage"].append(evaluate_role_coverage(gen_cards, card_db))
        results["jaccard_overlap"].append(evaluate_jaccard_overlap(all_generated, all_reference))
        results["deck_size"].append(len(all_generated))

        if (i + 1) % 10 == 0:
            logger.info(f"Evaluated {i+1} decks...")

    # Print summary
    print("\n=== Model Evaluation Results ===\n")
    print(f"Card existence rate:     {sum(results['card_existence'])/len(results['card_existence']):.1%}")
    print(f"Color identity compliance: {sum(results['color_compliance'])/len(results['color_compliance']):.1%}")
    print(f"Avg Jaccard overlap:     {sum(results['jaccard_overlap'])/len(results['jaccard_overlap']):.1%}")
    print(f"Avg deck size:           {sum(results['deck_size'])/len(results['deck_size']):.1f}")

    # Role coverage
    ramp_pct = sum(1 for r in results["role_coverage"] if r["ramp"]) / len(results["role_coverage"])
    draw_pct = sum(1 for r in results["role_coverage"] if r["card-draw"]) / len(results["role_coverage"])
    removal_pct = sum(1 for r in results["role_coverage"] if r["removal"]) / len(results["role_coverage"])
    print(f"Has ramp:                {ramp_pct:.1%}")
    print(f"Has card draw:           {draw_pct:.1%}")
    print(f"Has removal:             {removal_pct:.1%}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_evaluation()
```

**Step 2: Commit**

```bash
git add training/evaluate.py
git commit -m "feat(training): add evaluation metrics for model quality"
```

---

## Task 13: Add API Endpoint for Model-Based Generation

**Files:**
- Modify: `backend/main.py`
- Test: manual API call

**Step 1: Add endpoint**

In `backend/main.py`, add a new endpoint alongside the existing `/api/generate-deck`:

```python
@app.post("/api/generate-deck-v2")
async def generate_deck_v2(request: DeckRequest):
    """Generate a deck using the Qwen3.5 model (falls back to FAISS if unavailable)."""
    generator = get_generator()
    result = generator.generate_deck_with_model(
        commander_name=request.commander,
        bracket=request.bracket,
        theme=request.theme or "",
        budget_tier=request.budget_tier,
    )
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
```

**Step 2: Test**

```bash
curl -X POST http://localhost:8000/api/generate-deck-v2 \
  -H "Content-Type: application/json" \
  -d '{"commander": "Atraxa", "bracket": 3, "theme": "Superfriends"}'
```

Expected: Returns deck JSON. If model not available yet, falls back to standard generation.

**Step 3: Commit**

```bash
git add backend/main.py
git commit -m "feat(api): add /api/generate-deck-v2 endpoint for model-based generation"
```

---

## Execution Order Summary

| Task | Description | Dependencies | Time |
|------|------------|-------------|------|
| 1 | Moxfield scraper | None | 15 min code, 4-6h run |
| 2 | Archidekt scraper | None | 15 min code, 2-3h run |
| 3 | EDHREC scraper | None | 15 min code, 30min run |
| 4 | Clean & enrich pipeline | 1, 2, 3 (data) | 20 min |
| 5 | Scorer data prep | 4 | 10 min |
| 6 | Composer data prep | 4 | 10 min |
| 7 | Scorer training script | 5 | 10 min code, 1h train |
| 8 | Composer training script | 6 | 10 min code, 3-4h train |
| 9 | DeckComposer backend | None (needs GGUF later) | 30 min |
| 10 | DeckGenerator model path | 9 | 20 min |
| 11 | Qwen35Scorer | None (needs GGUF later) | 15 min |
| 12 | Evaluation script | 9 (needs GGUF) | 15 min |
| 13 | API endpoint | 10 | 10 min |

**Tasks 1-3** can run in parallel (scraping).
**Tasks 5-6** can run in parallel (data prep).
**Tasks 9-11** can run in parallel (backend code, no model dependency).
**Tasks 7-8** run on Colab after data prep.

**Total code time:** ~3 hours
**Total scraping time:** ~6 hours (background, parallel)
**Total training time:** ~5 hours (Colab)
