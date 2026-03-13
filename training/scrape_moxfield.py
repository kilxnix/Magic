"""
Moxfield deck scraper for Commander format training data.

Fetches Commander decks from Moxfield's public API, sorted by views,
and writes them to data/raw_moxfield_decks.jsonl (one JSON per line).

Resumable: progress tracked in data/moxfield_progress.json

AUTHENTICATION
--------------
Moxfield's API is behind Cloudflare bot protection. Direct unauthenticated
requests return 403. To use this scraper you need a Moxfield session cookie
obtained from your browser:

  1. Log in to moxfield.com in your browser.
  2. Open DevTools -> Network tab -> reload the page.
  3. Find any request to api2.moxfield.com, right-click -> Copy as cURL.
  4. Extract the value of the `Cookie:` header (the full string).
  5. Pass it via --cookie or the MOXFIELD_COOKIE environment variable.

Usage:
    python -m training.scrape_moxfield --cookie "<your cookie string>"
    MOXFIELD_COOKIE="<cookie>" python -m training.scrape_moxfield
    python -m training.scrape_moxfield --pages 10 --page-size 64
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Optional

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = "https://api2.moxfield.com/v3"
SEARCH_ENDPOINT = f"{BASE_URL}/decks/search"
DECK_ENDPOINT = f"{BASE_URL}/decks/all"

OUTPUT_FILE = Path("data/raw_moxfield_decks.jsonl")
PROGRESS_FILE = Path("data/moxfield_progress.json")

RATE_LIMIT_SECONDS = 0.2  # 200 ms between requests
MIN_CARDS = 98             # Only keep near-complete decks

# Base headers — cookie is added at runtime if provided
BASE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.moxfield.com/",
    "Origin": "https://www.moxfield.com",
}


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _build_headers(cookie: Optional[str] = None) -> dict:
    headers = dict(BASE_HEADERS)
    if cookie:
        headers["Cookie"] = cookie
    return headers


def _get(
    url: str,
    params: Optional[dict] = None,
    cookie: Optional[str] = None,
    retries: int = 3,
) -> dict:
    """GET with retries and rate-limit back-off."""
    headers = _build_headers(cookie)
    for attempt in range(retries):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=15)
            if resp.status_code == 403:
                # Cloudflare block — no point retrying without a valid cookie
                raise requests.HTTPError(
                    "403 Forbidden — Cloudflare is blocking the request. "
                    "Provide a session cookie via --cookie or $MOXFIELD_COOKIE. "
                    "See module docstring for instructions.",
                    response=resp,
                )
            if resp.status_code == 429:
                wait = 2 ** attempt * 2
                print(f"  429 rate-limited, waiting {wait}s …", flush=True)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        except requests.HTTPError:
            raise  # propagate immediately; no retry for 4xx (except 429 above)
        except requests.RequestException as exc:
            if attempt == retries - 1:
                raise
            wait = 2 ** attempt
            print(f"  Request error ({exc}), retry in {wait}s …", flush=True)
            time.sleep(wait)
    return {}


def fetch_deck_list(
    page_number: int,
    page_size: int = 64,
    cookie: Optional[str] = None,
) -> dict:
    """
    Fetch one page of Commander decks from the Moxfield search API.

    Returns the parsed JSON response (contains 'data' list and pagination info).

    Args:
        page_number: 1-based page index.
        page_size:   Number of results per page (max 64).
        cookie:      Moxfield session cookie string (required in production).
    """
    params = {
        "pageNumber": page_number,
        "pageSize": page_size,
        "sortType": "views",
        "sortDirection": "Descending",
        "fmt": "commander",
        "board": "mainboard",
    }
    return _get(SEARCH_ENDPOINT, params=params, cookie=cookie)


def fetch_deck_detail(public_id: str, cookie: Optional[str] = None) -> dict:
    """Fetch full deck detail for a single deck by publicId."""
    url = f"{DECK_ENDPOINT}/{public_id}"
    return _get(url, cookie=cookie)


# ---------------------------------------------------------------------------
# Data extraction
# ---------------------------------------------------------------------------

def _is_land(type_line: str) -> bool:
    return "Land" in type_line


def extract_deck_record(detail: dict) -> Optional[dict]:
    """
    Convert a raw Moxfield deck-detail response into our training record.

    Returns None if the deck is incomplete (< MIN_CARDS) or has no commander.
    """
    boards = detail.get("boards") or {}

    # --- Commanders ---
    commander_board = boards.get("commanders", {})
    commander_cards = commander_board.get("cards") or {}
    commander_names = [
        entry["card"]["name"]
        for entry in commander_cards.values()
        if entry.get("card", {}).get("name")
    ]
    if not commander_names:
        return None

    commander = commander_names[0]
    partner = commander_names[1] if len(commander_names) > 1 else None

    # --- Mainboard: split into lands vs non-lands ---
    mainboard = boards.get("mainboard", {})
    lands: list[str] = []
    non_lands: list[str] = []

    for entry in (mainboard.get("cards") or {}).values():
        card_obj = entry.get("card") or {}
        name = card_obj.get("name", "")
        type_line = card_obj.get("type_line", "")
        qty = entry.get("quantity", 1)
        if not name:
            continue
        names = [name] * qty
        if _is_land(type_line):
            lands.extend(names)
        else:
            non_lands.extend(names)

    total_cards = len(non_lands) + len(lands) + len(commander_names)

    if total_cards < MIN_CARDS:
        return None

    return {
        "commander": commander,
        "partner": partner,
        "cards": non_lands,
        "lands": lands,
        "total_cards": total_cards,
        "source": "moxfield",
        "source_id": detail.get("publicId", ""),
        "name": detail.get("name", ""),
    }


# ---------------------------------------------------------------------------
# Progress tracking
# ---------------------------------------------------------------------------

def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        try:
            with PROGRESS_FILE.open() as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return {"last_page": 0, "seen_ids": [], "total_written": 0}


def save_progress(progress: dict) -> None:
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with PROGRESS_FILE.open("w") as f:
        json.dump(progress, f)


# ---------------------------------------------------------------------------
# Main scrape loop
# ---------------------------------------------------------------------------

def scrape(
    max_pages: int = 50,
    page_size: int = 64,
    cookie: Optional[str] = None,
) -> None:
    """
    Scrape Commander decks from Moxfield and append to OUTPUT_FILE.

    Args:
        max_pages:  Maximum number of search-result pages to process.
        page_size:  Number of decks per search page (max 64).
        cookie:     Moxfield session cookie (required; see module docstring).
    """
    if not cookie:
        print(
            "WARNING: No session cookie provided. "
            "Moxfield will likely return 403 (Cloudflare block).\n"
            "Pass --cookie or set $MOXFIELD_COOKIE. "
            "See `python -m training.scrape_moxfield --help`.",
            flush=True,
        )

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    progress = load_progress()
    seen_ids: set[str] = set(progress.get("seen_ids", []))
    start_page = progress.get("last_page", 0) + 1
    total_written = progress.get("total_written", 0)

    print(
        f"Starting scrape from page {start_page}. "
        f"Already written: {total_written} decks. "
        f"Seen IDs: {len(seen_ids)}",
        flush=True,
    )

    with OUTPUT_FILE.open("a", encoding="utf-8") as out_f:
        for page in range(start_page, start_page + max_pages):
            print(f"[Page {page}] fetching deck list …", flush=True)
            try:
                search_result = fetch_deck_list(page, page_size=page_size, cookie=cookie)
            except requests.RequestException as exc:
                print(f"  Failed to fetch page {page}: {exc}", flush=True)
                break

            decks = search_result.get("data") or []
            if not decks:
                print("  No more decks, stopping.", flush=True)
                break

            page_written = 0
            for deck_stub in decks:
                public_id = deck_stub.get("publicId", "")
                if not public_id or public_id in seen_ids:
                    continue

                time.sleep(RATE_LIMIT_SECONDS)

                try:
                    detail = fetch_deck_detail(public_id, cookie=cookie)
                except requests.RequestException as exc:
                    print(f"    Skipping {public_id}: {exc}", flush=True)
                    seen_ids.add(public_id)
                    continue

                record = extract_deck_record(detail)
                seen_ids.add(public_id)

                if record is None:
                    print(
                        f"    Skipped {public_id} (incomplete or no commander)",
                        flush=True,
                    )
                    continue

                out_f.write(json.dumps(record, ensure_ascii=False) + "\n")
                out_f.flush()
                total_written += 1
                page_written += 1
                print(
                    f"    Wrote [{total_written}] "
                    f"{record['commander']!r} — {record['name']!r} "
                    f"({record['total_cards']} cards)",
                    flush=True,
                )

                time.sleep(RATE_LIMIT_SECONDS)

            print(f"  Page {page}: {page_written} decks written.", flush=True)

            # Save progress after each page
            progress = {
                "last_page": page,
                "seen_ids": list(seen_ids),
                "total_written": total_written,
            }
            save_progress(progress)

    print(f"\nDone. Total decks written: {total_written}", flush=True)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Scrape Commander decks from Moxfield for training data.",
        epilog=(
            "Authentication: Moxfield requires a browser session cookie.\n"
            "Log in to moxfield.com, copy the Cookie header from DevTools,\n"
            "and pass it via --cookie or $MOXFIELD_COOKIE."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--pages",
        type=int,
        default=50,
        help="Maximum number of search pages to fetch (default: 50).",
    )
    parser.add_argument(
        "--page-size",
        type=int,
        default=64,
        help="Decks per search page, max 64 (default: 64).",
    )
    parser.add_argument(
        "--cookie",
        type=str,
        default=None,
        help=(
            "Moxfield session cookie string. "
            "Overrides $MOXFIELD_COOKIE env var."
        ),
    )
    args = parser.parse_args()

    cookie = args.cookie or os.environ.get("MOXFIELD_COOKIE")
    scrape(max_pages=args.pages, page_size=args.page_size, cookie=cookie)


if __name__ == "__main__":
    main()
