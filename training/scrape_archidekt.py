"""
Archidekt deck scraper for Commander training data.

Scrapes public Commander decks from Archidekt's API, extracts card lists,
and writes them to data/raw_archidekt_decks.jsonl for model training.

API notes (verified 2026-03):
  - Search:      GET /api/decks/v3/?formats=3&orderBy=-viewCount&page=N
                 Returns ~60 results per page, total up to 1000 (API cap).
                 Pagination uses 'page' param (1-indexed); 'offset'/'pageSize'
                 are ignored by the current API version.
  - Deck detail: GET /api/decks/{id}/
                 Returns full deck with 'cards' array. Each card entry has:
                   entry.categories          list — includes "Commander" for commanders
                   entry.quantity            int
                   entry.card.oracleCard.name        str
                   entry.card.oracleCard.types       list  (e.g. ['Land'], ['Creature'])
                   entry.card.oracleCard.typeLine    None  (not populated in this API)

Usage:
    python -m training.scrape_archidekt
    python -m training.scrape_archidekt --max-decks 1000
    python -m training.scrape_archidekt --reset   # clear progress and restart
"""

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Optional

import requests

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_FILE = DATA_DIR / "raw_archidekt_decks.jsonl"
PROGRESS_FILE = DATA_DIR / "archidekt_progress.json"

# ---------------------------------------------------------------------------
# API constants
# ---------------------------------------------------------------------------

BASE_URL = "https://archidekt.com/api"
# Note: API path is /decks/v3/ — the older /decks/cards/ endpoint returns 404
SEARCH_PATH = "/decks/v3/"
COMMANDER_FORMAT_ID = 3
# API returns ~60 results per page regardless of pageSize param; page is 1-indexed
RESULTS_PER_PAGE = 60
RATE_LIMIT_SECONDS = 0.2  # 200 ms between requests
MIN_CARDS = 98  # only keep "complete" decks

HEADERS = {
    "User-Agent": "MTGDeckTrainer/1.0 (training data collection; contact via GitHub)",
    "Accept": "application/json",
}

# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------


def _get(url: str, params: dict | None = None, retries: int = 3) -> dict:
    """GET with retry/backoff. Returns parsed JSON or raises on failure."""
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, headers=HEADERS, timeout=15)
            if resp.status_code == 429:
                wait = 2 ** (attempt + 2)
                print(f"  [rate-limit] 429 — waiting {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(
                f"  [retry {attempt + 1}/{retries}] {exc} — waiting {wait}s",
                file=sys.stderr,
            )
            time.sleep(wait)
    raise RuntimeError(f"Failed to GET {url} after {retries} retries")


def fetch_deck_search(offset: int, page_size: int = RESULTS_PER_PAGE) -> dict:
    """
    Fetch a page of Commander decks sorted by view count.

    Args:
        offset:    Logical record offset (converted to 1-indexed page number
                   internally; the Archidekt v3 API uses page=N, not offset).
        page_size: Hint for how many results per page. The Archidekt API
                   returns ~60 per page regardless, so this only affects the
                   page number calculation when offset is non-zero.

    Returns the raw API response dict with 'count', 'next', and 'results' keys.

    Note: The API always returns ~60 results per page. The 'pageSize' query
    parameter is silently ignored by the current API version. Callers should
    use offset=0 for the first page, offset=60 for the second, etc.
    """
    effective_page_size = page_size if page_size > 0 else RESULTS_PER_PAGE
    # Convert offset to 1-indexed page (API uses page=, not offset=)
    page = (offset // effective_page_size) + 1
    url = f"{BASE_URL}{SEARCH_PATH}"
    params = {
        "formats": COMMANDER_FORMAT_ID,
        "orderBy": "-viewCount",
        "page": page,
    }
    return _get(url, params=params)


def fetch_deck_detail(deck_id: int | str) -> dict:
    """Fetch full deck detail by ID."""
    url = f"{BASE_URL}/decks/{deck_id}/"
    return _get(url)


# ---------------------------------------------------------------------------
# Deck parsing
# ---------------------------------------------------------------------------


def _is_land(types: list) -> bool:
    """Check if a card is a land from its types list (e.g. ['Land'])."""
    return "Land" in (types or [])


def parse_deck(deck_data: dict) -> Optional[dict]:
    """
    Parse a raw Archidekt deck detail response into our training format.

    Returns None if the deck doesn't meet quality criteria (too few cards,
    no identified commander).

    Output format:
        {
            "commander": "Name",
            "partner": null | "Name",
            "cards": [...],   # non-land, non-commander cards (expanded by qty)
            "lands": [...],   # land cards (expanded by qty)
            "total_cards": 99,
            "source": "archidekt",
            "source_id": "12345",
            "name": "deck name"
        }
    """
    deck_id = str(deck_data.get("id", ""))
    deck_name = deck_data.get("name", "").strip()

    raw_cards = deck_data.get("cards", [])
    if not raw_cards:
        return None

    commanders: list[str] = []
    cards: list[str] = []
    lands: list[str] = []
    total_cards = 0

    for entry in raw_cards:
        card_obj = entry.get("card", {})
        oracle = card_obj.get("oracleCard", {})
        name = oracle.get("name", "").strip()
        # Archidekt uses a 'types' list (e.g. ['Land', 'Creature']).
        # The 'typeLine' field is None in API responses; do not use it.
        types = oracle.get("types", []) or []
        quantity = int(entry.get("quantity", 1))
        categories = entry.get("categories", []) or []

        if not name:
            continue

        # Identify commanders (Archidekt marks them with "Commander" in categories)
        if "Commander" in categories:
            commanders.append(name)
            continue  # commanders are counted separately, not in total_cards

        # Count toward deck size
        total_cards += quantity

        if _is_land(types):
            for _ in range(quantity):
                lands.append(name)
        else:
            for _ in range(quantity):
                cards.append(name)

    # Quality gate: skip incomplete or commanderless decks
    if total_cards < MIN_CARDS:
        return None
    if not commanders:
        return None

    commander = commanders[0]
    partner = commanders[1] if len(commanders) >= 2 else None

    return {
        "commander": commander,
        "partner": partner,
        "cards": cards,
        "lands": lands,
        "total_cards": total_cards,
        "source": "archidekt",
        "source_id": deck_id,
        "name": deck_name,
    }


# ---------------------------------------------------------------------------
# Progress tracking
# ---------------------------------------------------------------------------


def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with PROGRESS_FILE.open() as f:
            return json.load(f)
    return {"page": 1, "seen_ids": [], "total_written": 0}


def save_progress(progress: dict) -> None:
    with PROGRESS_FILE.open("w") as f:
        json.dump(progress, f)


# ---------------------------------------------------------------------------
# Main scraping loop
# ---------------------------------------------------------------------------


def scrape(max_decks: int = 5000) -> None:
    """
    Scrape Commander decks from Archidekt and append to OUTPUT_FILE.

    Args:
        max_decks: Stop after writing this many decks (0 = unlimited).
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    progress = load_progress()
    page: int = progress.get("page", 1)
    seen_ids: set[str] = set(progress.get("seen_ids", []))
    total_written: int = progress.get("total_written", 0)

    print(f"Starting scrape. Already written: {total_written}. Next page: {page}")

    with OUTPUT_FILE.open("a", encoding="utf-8") as out_f:
        while True:
            if max_decks and total_written >= max_decks:
                print(f"Reached max_decks={max_decks}. Stopping.")
                break

            # --- Fetch search page ---
            # Pass offset=(page-1)*RESULTS_PER_PAGE so fetch_deck_search maps to
            # the correct 1-indexed page number.
            offset = (page - 1) * RESULTS_PER_PAGE
            print(f"Fetching search page={page} (offset={offset}) …", end=" ", flush=True)
            try:
                search_result = fetch_deck_search(offset)
            except Exception as exc:
                print(f"\nERROR fetching search page {page}: {exc}", file=sys.stderr)
                break

            results = search_result.get("results", [])
            total_available = search_result.get("count", 0)
            has_next = search_result.get("next") is not None
            print(f"{len(results)} results (total available: {total_available})")

            if not results:
                print("No more results. Scrape complete.")
                break

            time.sleep(RATE_LIMIT_SECONDS)

            # --- Fetch each deck detail ---
            for item in results:
                if max_decks and total_written >= max_decks:
                    break

                deck_id = str(item.get("id", ""))
                if not deck_id or deck_id in seen_ids:
                    continue

                try:
                    deck_data = fetch_deck_detail(deck_id)
                except Exception as exc:
                    print(
                        f"  SKIP deck {deck_id}: error fetching detail: {exc}",
                        file=sys.stderr,
                    )
                    seen_ids.add(deck_id)
                    time.sleep(RATE_LIMIT_SECONDS)
                    continue

                time.sleep(RATE_LIMIT_SECONDS)

                parsed = parse_deck(deck_data)
                if parsed is None:
                    print(f"  SKIP deck {deck_id}: failed quality check")
                    seen_ids.add(deck_id)
                    continue

                out_f.write(json.dumps(parsed) + "\n")
                out_f.flush()
                total_written += 1
                seen_ids.add(deck_id)

                print(
                    f"  [{total_written}] {parsed['commander']!r} — "
                    f"{parsed['total_cards']} cards — {parsed['name']!r}"
                )

            # --- Advance to next page ---
            if not has_next:
                print("No next page. Scrape complete.")
                break

            page += 1

            # --- Save progress after each page ---
            progress = {
                "page": page,
                "seen_ids": list(seen_ids),
                "total_written": total_written,
            }
            save_progress(progress)

    # Final progress save
    progress = {
        "page": page,
        "seen_ids": list(seen_ids),
        "total_written": total_written,
    }
    save_progress(progress)
    print(f"\nDone. Total decks written: {total_written}")
    print(f"Output: {OUTPUT_FILE}")
    print(f"Progress: {PROGRESS_FILE}")


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape Commander decks from Archidekt for training data."
    )
    parser.add_argument(
        "--max-decks",
        type=int,
        default=5000,
        help="Maximum number of decks to write (0 = unlimited). Default: 5000",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Clear progress file and output file, then start from scratch.",
    )
    args = parser.parse_args()

    if args.reset:
        if PROGRESS_FILE.exists():
            PROGRESS_FILE.unlink()
            print("Progress file cleared.")
        if OUTPUT_FILE.exists():
            OUTPUT_FILE.unlink()
            print("Output file cleared.")

    scrape(max_decks=args.max_decks)


if __name__ == "__main__":
    main()
