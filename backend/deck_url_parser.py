"""Deck URL parser — fetch decklists from Moxfield, Archidekt, TappedOut, MTGGoldfish."""

import logging
import re
from typing import Optional
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# URL detection
# ---------------------------------------------------------------------------

_SITE_PATTERNS = {
    "moxfield": re.compile(r"(?:www\.)?moxfield\.com/decks/"),
    "archidekt": re.compile(r"(?:www\.)?archidekt\.com/decks/"),
    "tappedout": re.compile(r"(?:www\.)?tappedout\.net/mtg-decks/"),
    "mtggoldfish": re.compile(r"(?:www\.)?mtggoldfish\.com/(?:deck|archetype)/"),
}


def detect_site(url: str) -> Optional[str]:
    """Return the site key for a recognised MTG deck URL, or None."""
    for site, pattern in _SITE_PATTERNS.items():
        if pattern.search(url):
            return site
    return None


# ---------------------------------------------------------------------------
# Deck-ID / slug extraction
# ---------------------------------------------------------------------------

_EXTRACT_PATTERNS = {
    "moxfield": re.compile(r"moxfield\.com/decks/([^/?#]+)"),
    "archidekt": re.compile(r"archidekt\.com/decks/(\d+)"),
    "tappedout": re.compile(r"tappedout\.net/mtg-decks/([^/?#]+?)/?(?:[?#]|$)"),
    "mtggoldfish": re.compile(r"mtggoldfish\.com/(?:deck|archetype)/([^/?#]+)"),
}


def extract_deck_id(url: str, site: str) -> Optional[str]:
    """Extract the deck slug/ID from *url* for the given *site*."""
    pattern = _EXTRACT_PATTERNS.get(site)
    if pattern is None:
        return None
    m = pattern.search(url)
    return m.group(1) if m else None


# ---------------------------------------------------------------------------
# Plain-text decklist parser
# ---------------------------------------------------------------------------

# Matches "1 Sol Ring", "1x Sol Ring", "1 Sol Ring (C21) 267", etc.
_CARD_LINE_RE = re.compile(
    r"^\s*(\d+)\s*x?\s+"   # quantity
    r"(.+?)"               # card name (non-greedy)
    r"(?:\s+\([A-Z0-9]+\)"  # optional set code in parens
    r"(?:\s+\d+)?)?"       # optional collector number
    r"\s*$"
)

_SECTION_HEADERS = {
    "commander", "companion", "sideboard", "maybeboard",
    "tokens", "command zone",
}

_IGNORED_SECTIONS = {"sideboard", "maybeboard", "tokens"}


def parse_decklist_text(text: str) -> dict:
    """Parse a plain-text decklist into ``{"commander": ..., "cards": [...]}``.

    Recognises section headers (Commander, Sideboard, etc.) and strips set
    codes / collector numbers from card lines.
    """
    cards: list[str] = []
    commander: Optional[str] = None
    current_section: Optional[str] = None

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        # Check for section header (case-insensitive, no leading number)
        lower = line.lower()
        if lower in _SECTION_HEADERS or lower.rstrip(":") in _SECTION_HEADERS:
            current_section = lower.rstrip(":")
            continue

        m = _CARD_LINE_RE.match(line)
        if not m:
            continue

        card_name = m.group(2).strip()

        # Strip trailing set code / collector number that the non-greedy
        # group may have captured.
        card_name = re.sub(r"\s+\([A-Z0-9]+\)(?:\s+\d+)?$", "", card_name)

        if current_section == "commander" or current_section == "command zone":
            commander = card_name
            # The commander is also part of the deck, but we track it
            # separately; do NOT add it to the main cards list so consumers
            # can decide how to handle it.
            continue

        if current_section in _IGNORED_SECTIONS:
            continue

        qty = int(m.group(1))
        for _ in range(qty):
            cards.append(card_name)

    return {"commander": commander, "cards": cards}


# ---------------------------------------------------------------------------
# Site-specific fetchers
# ---------------------------------------------------------------------------

_REQUEST_TIMEOUT = 15  # seconds


def fetch_moxfield(deck_id: str) -> dict:
    """Fetch a deck from Moxfield's public API."""
    api_url = f"https://api2.moxfield.com/v3/decks/all/{deck_id}"
    headers = {
        "User-Agent": "MagicBrains/1.0",
        "Accept": "application/json",
    }
    resp = requests.get(api_url, headers=headers, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()

    cards: list[str] = []
    commander: Optional[str] = None

    # Moxfield nests cards under board keys: mainboard, commanders, etc.
    for board_key in ("mainboard", "companions"):
        board = data.get(board_key, {})
        for card_name, _info in board.items():
            qty = _info.get("quantity", 1) if isinstance(_info, dict) else 1
            for _ in range(qty):
                cards.append(card_name)

    commanders_board = data.get("commanders", {})
    for card_name, _info in commanders_board.items():
        commander = card_name  # last one wins; usually only 1 or 2
        # Don't add commander to the main cards list (same as text parser)

    return {"commander": commander, "cards": cards}


def fetch_archidekt(deck_id: str) -> dict:
    """Fetch a deck from Archidekt's public API."""
    api_url = f"https://archidekt.com/api/decks/{deck_id}/"
    resp = requests.get(api_url, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()

    cards: list[str] = []
    commander: Optional[str] = None

    for entry in data.get("cards", []):
        card = entry.get("card", {})
        name = card.get("oracleCard", {}).get("name") or card.get("name", "")
        categories = [c.lower() for c in entry.get("categories", [])]
        qty = entry.get("quantity", 1)

        if "commander" in categories:
            commander = name
            continue

        if "sideboard" in categories or "maybeboard" in categories:
            continue

        for _ in range(qty):
            cards.append(name)

    return {"commander": commander, "cards": cards}


def fetch_tappedout(deck_id: str) -> dict:
    """Fetch a deck from TappedOut via text export."""
    export_url = f"https://tappedout.net/mtg-decks/{deck_id}/?fmt=txt"
    resp = requests.get(export_url, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return parse_decklist_text(resp.text)


def fetch_mtggoldfish(deck_id: str) -> dict:
    """Fetch a deck from MTGGoldfish via download link."""
    download_url = f"https://www.mtggoldfish.com/deck/download/{deck_id}"
    resp = requests.get(download_url, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return parse_decklist_text(resp.text)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

_FETCHERS = {
    "moxfield": fetch_moxfield,
    "archidekt": fetch_archidekt,
    "tappedout": fetch_tappedout,
    "mtggoldfish": fetch_mtggoldfish,
}


def fetch_deck_from_url(url: str) -> dict:
    """Detect the site, extract the deck ID, and fetch the decklist.

    Returns ``{"commander": str | None, "cards": [str, ...]}``.

    Raises ``ValueError`` for unrecognised URLs or missing IDs.
    """
    site = detect_site(url)
    if site is None:
        raise ValueError(
            f"Unrecognised deck URL: {url}. "
            "Supported sites: Moxfield, Archidekt, TappedOut, MTGGoldfish."
        )

    deck_id = extract_deck_id(url, site)
    if deck_id is None:
        raise ValueError(f"Could not extract deck ID from URL: {url}")

    fetcher = _FETCHERS[site]
    logger.info("Fetching deck from %s (id=%s)", site, deck_id)
    return fetcher(deck_id)
