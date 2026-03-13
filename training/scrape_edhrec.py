"""
EDHREC average deck scraper.

Fetches one curated "average deck" per commander from EDHREC and writes
results to data/raw_edhrec_decks.jsonl.

Usage:
    python -m training.scrape_edhrec

Features:
- Loads valid commanders from mtg_data/cards_min.jsonl
- Converts commander names to EDHREC URL slugs
- Fetches https://json.edhrec.com/pages/average-decks/{slug}.json
- Only keeps decks with 90+ cards
- Resumable via data/edhrec_progress.json
- 500ms rate limit between requests
"""

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

import requests

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CARDS_JSONL = PROJECT_ROOT / "mtg_data" / "cards_min.jsonl"
OUTPUT_JSONL = PROJECT_ROOT / "data" / "raw_edhrec_decks.jsonl"
PROGRESS_FILE = PROJECT_ROOT / "data" / "edhrec_progress.json"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

EDHREC_BASE = "https://json.edhrec.com/pages/average-decks"
REQUEST_DELAY = 0.5  # seconds between requests (EDHREC rate-limit courtesy)
MIN_CARDS = 90       # discard decks shorter than this
REQUEST_TIMEOUT = 15

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

LAND_TAGS = {"lands", "basics"}

# ---------------------------------------------------------------------------
# Slug conversion
# ---------------------------------------------------------------------------


def name_to_slug(name: str) -> str:
    """Convert a card name to an EDHREC URL slug.

    Examples:
        "Atraxa, Praetors' Voice" -> "atraxa-praetors-voice"
        "Zur the Enchanter"       -> "zur-the-enchanter"
        "Yuriko, the Tiger's Shadow" -> "yuriko-the-tigers-shadow"
    """
    slug = name.lower()
    # Remove apostrophes, commas, periods (and other punctuation that
    # EDHREC strips before hyphenating)
    slug = re.sub(r"[',.]", "", slug)
    # Replace any run of non-alphanumeric characters with a single hyphen
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    # Strip leading/trailing hyphens
    slug = slug.strip("-")
    return slug


# ---------------------------------------------------------------------------
# Commander loading
# ---------------------------------------------------------------------------


def load_commanders() -> list[str]:
    """Return names of all commander-legal Legendary Creatures/Planeswalkers."""
    commanders: list[str] = []
    with open(CARDS_JSONL, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                card = json.loads(line)
            except json.JSONDecodeError:
                continue
            type_line = card.get("type_line", "")
            legalities = card.get("legalities", {})
            if (
                "Legendary" in type_line
                and ("Creature" in type_line or "Planeswalker" in type_line)
                and legalities.get("commander") == "legal"
            ):
                commanders.append(card["name"])
    log.info("Loaded %d commander-legal cards from %s", len(commanders), CARDS_JSONL)
    return commanders


# ---------------------------------------------------------------------------
# Progress persistence
# ---------------------------------------------------------------------------


def load_progress() -> dict:
    """Load resume progress from disk (returns empty dict if absent)."""
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, encoding="utf-8") as fh:
                return json.load(fh)
        except (json.JSONDecodeError, OSError):
            pass
    return {"done": [], "skipped": []}


def save_progress(progress: dict) -> None:
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROGRESS_FILE, "w", encoding="utf-8") as fh:
        json.dump(progress, fh, indent=2)


# ---------------------------------------------------------------------------
# EDHREC fetching
# ---------------------------------------------------------------------------


def fetch_average_deck(slug: str) -> Optional[dict]:
    """Fetch and parse the EDHREC average-deck JSON for *slug*.

    Returns a parsed dict on success, or None if the deck is not found or
    the response is not usable (404, 403, malformed JSON, etc.).
    """
    url = f"{EDHREC_BASE}/{slug}.json"
    try:
        resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    except requests.RequestException as exc:
        log.warning("Request error for %s: %s", slug, exc)
        return None

    if resp.status_code in (403, 404):
        log.debug("Commander not on EDHREC (HTTP %d): %s", resp.status_code, slug)
        return None

    if resp.status_code != 200:
        log.warning("Unexpected HTTP %d for %s", resp.status_code, slug)
        return None

    try:
        return resp.json()
    except ValueError as exc:
        log.warning("JSON decode error for %s: %s", slug, exc)
        return None


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def parse_deck(data: dict, commander_name: str, slug: str) -> Optional[dict]:
    """Extract card/land lists from a raw EDHREC average-deck response.

    Returns a deck record dict or None if the deck is too short or malformed.
    """
    # ---- card lists from cardlists sections --------------------------------
    json_dict: dict = (
        data.get("container", {}).get("json_dict", {})
        if isinstance(data.get("container"), dict)
        else {}
    )
    cardlists: list = json_dict.get("cardlists", []) if isinstance(json_dict, dict) else []

    cards: list[str] = []
    lands: list[str] = []

    for section in cardlists:
        if not isinstance(section, dict):
            continue
        tag = section.get("tag", "")
        for cv in section.get("cardviews", []):
            if not isinstance(cv, dict):
                continue
            name = cv.get("name", "").strip()
            if not name:
                continue
            if tag in LAND_TAGS:
                lands.append(name)
            else:
                cards.append(name)

    # ---- deck list fallback ------------------------------------------------
    # EDHREC also exposes a flat "deck" list of strings like "1 Card Name".
    # Use this when cardlists is empty or when we need the full count.
    flat_deck: list[str] = data.get("deck", []) if isinstance(data.get("deck"), list) else []

    if not cards and not lands and flat_deck:
        # Parse names from "1 Card Name" strings; skip the commander entry
        for entry in flat_deck:
            entry = str(entry).strip()
            m = re.match(r"^\d+\s+(.+)$", entry)
            if m:
                name = m.group(1).strip()
                if name != commander_name:
                    cards.append(name)

    # ---- validation --------------------------------------------------------
    total = len(cards) + len(lands)
    if total < MIN_CARDS:
        log.debug(
            "Deck too short for %s (slug=%s): %d cards (need %d)",
            commander_name,
            slug,
            total,
            MIN_CARDS,
        )
        return None

    # ---- commander name from EDHREC metadata (may differ slightly) ---------
    card_meta: dict = json_dict.get("card", {}) if isinstance(json_dict, dict) else {}
    edhrec_name: str = (
        card_meta.get("name", commander_name)
        if isinstance(card_meta, dict)
        else commander_name
    )

    # ---- deck title --------------------------------------------------------
    header = data.get("header", "")
    deck_name = str(header) if header else f"Average {edhrec_name} Deck"

    return {
        "commander": edhrec_name,
        "partner": None,
        "cards": cards,
        "lands": lands,
        "total_cards": total,
        "source": "edhrec",
        "source_id": slug,
        "name": deck_name,
    }


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------


def append_deck(deck: dict) -> None:
    OUTPUT_JSONL.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSONL, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(deck, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------------------
# Main scraping loop
# ---------------------------------------------------------------------------


def scrape(commanders: Optional[list[str]] = None) -> None:
    if commanders is None:
        commanders = load_commanders()

    progress = load_progress()
    done_set: set[str] = set(progress.get("done", []))
    skip_set: set[str] = set(progress.get("skipped", []))

    already_done = len(done_set)
    log.info(
        "Resuming — %d done, %d skipped, %d remaining",
        already_done,
        len(skip_set),
        len(commanders) - already_done - len(skip_set),
    )

    total = len(commanders)
    saved = 0
    skipped_this_run = 0

    for idx, name in enumerate(commanders, start=1):
        slug = name_to_slug(name)

        if slug in done_set or slug in skip_set:
            continue

        log.info("[%d/%d] %s  (slug: %s)", idx, total, name, slug)

        data = fetch_average_deck(slug)

        if data is None:
            log.debug("Skipping %s — no data returned", slug)
            skip_set.add(slug)
            skipped_this_run += 1
        else:
            deck = parse_deck(data, name, slug)
            if deck is None:
                log.debug("Skipping %s — deck too short or unparseable", slug)
                skip_set.add(slug)
                skipped_this_run += 1
            else:
                append_deck(deck)
                done_set.add(slug)
                saved += 1
                log.info(
                    "  Saved: %d cards + %d lands = %d total",
                    len(deck["cards"]),
                    len(deck["lands"]),
                    deck["total_cards"],
                )

        # Persist progress after every commander
        progress = {"done": list(done_set), "skipped": list(skip_set)}
        save_progress(progress)

        time.sleep(REQUEST_DELAY)

    log.info(
        "Done. Saved %d decks this run, skipped %d. "
        "Output: %s",
        saved,
        skipped_this_run,
        OUTPUT_JSONL,
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


if __name__ == "__main__":
    scrape()
