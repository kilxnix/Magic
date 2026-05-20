"""Deck URL parser — fetch decklists from Moxfield, Archidekt, TappedOut, MTGGoldfish."""

import logging
import re
from typing import Optional
from urllib.parse import urlparse

import requests
import cloudscraper

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# MTGGoldfish / flat decklist normalization
# ---------------------------------------------------------------------------

# MTGGoldfish's "Text File (Default)" export is frequently a single line like:
#   "1 Sol Ring 1 Arcane Signet 10 Forest ..."
# Normalize this into one entry per line so the rest of the parser can work.
_FLAT_ENTRY_START_RE = re.compile(r"(?:^|\s)(\d+)\s*x?\s+")
_MTGGOLDFISH_ARCHETYPE_RE = re.compile(r"Archetype:\s*(?:<a[^>]*>)?\s*([^<\r\n]+)")


def _normalize_flat_decklist(text: str) -> str:
    """If *text* looks like a single-line decklist, explode it into many lines."""
    # Keep existing multi-line decklists unchanged.
    non_empty_lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(non_empty_lines) != 1:
        return text

    line = non_empty_lines[0].strip()
    if not line:
        return text

    # MTGGoldfish sometimes inlines section markers ("Commander", "Deck", "Sideboard")
    # in the same line as card entries.
    # Only treat these as section markers when followed by a quantity.
    # This avoids splitting card names like "Commander's Sphere".
    line = re.sub(
        r"\b(Commander|Deck|Sideboard|Companion|Considering|Maybeboard)\b(?=\s+\d)",
        r"\n\1\n",
        line,
        flags=re.IGNORECASE,
    )

    out_lines: list[str] = []
    for segment in (seg.strip() for seg in line.splitlines() if seg.strip()):
        matches = list(_FLAT_ENTRY_START_RE.finditer(segment))
        # If there's only one quantity marker, it's probably already a single entry.
        if len(matches) <= 1:
            out_lines.append(segment)
            continue

        # Preserve any leading non-quantity text before the first entry.
        prefix = segment[:matches[0].start(1)].strip()
        if prefix:
            out_lines.append(prefix)

        for i, m in enumerate(matches):
            start = m.start(1)  # start of the quantity digits
            end = matches[i + 1].start(1) if i + 1 < len(matches) else len(segment)
            chunk = segment[start:end].strip()
            if chunk:
                out_lines.append(chunk)

    # If we failed to split into something meaningful, keep the original.
    if len(out_lines) <= 1:
        return text

    return "\n".join(out_lines) + "\n"


def _extract_mtggoldfish_commander_from_html(html: str) -> Optional[str]:
    """Best-effort extraction of the Commander/archetype name from an MTGGoldfish deck page."""
    m = _MTGGOLDFISH_ARCHETYPE_RE.search(html)
    if not m:
        return None
    name = m.group(1).strip()
    return name or None

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
    text = _normalize_flat_decklist(text)
    cards: list[str] = []
    commander_names: list[str] = []
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
            commander_names.append(card_name)
            continue

        if current_section in _IGNORED_SECTIONS:
            continue

        qty = int(m.group(1))
        for _ in range(qty):
            cards.append(card_name)

    commander = " // ".join(commander_names) if commander_names else None
    return {"commander": commander, "cards": cards}


# ---------------------------------------------------------------------------
# Site-specific fetchers
# ---------------------------------------------------------------------------

_REQUEST_TIMEOUT = 15  # seconds


def fetch_moxfield(deck_id: str) -> dict:
    """Fetch a deck from Moxfield's public API using cloudscraper to bypass Cloudflare.

    Moxfield's API is behind Cloudflare bot protection. We use cloudscraper
    which solves JS challenges automatically.
    """
    api_url = f"https://api2.moxfield.com/v3/decks/all/{deck_id}"
    scraper = cloudscraper.create_scraper()
    resp = scraper.get(api_url, timeout=_REQUEST_TIMEOUT)

    if resp.status_code == 403:
        raise ValueError(
            "Moxfield blocked this request (bot protection). "
            "Please use Moxfield's Export button to copy your decklist, "
            "then paste it in the 'Paste Decklist' tab instead."
        )

    resp.raise_for_status()
    data = resp.json()

    cards: list[str] = []
    commander: Optional[str] = None

    # Moxfield v3 API nests cards under boards.{boardName}.cards
    boards = data.get("boards", {})

    for board_key in ("mainboard", "companions"):
        board = boards.get(board_key, {})
        for _card_id, entry in (board.get("cards") or {}).items():
            card_obj = entry.get("card", {})
            name = card_obj.get("name", "")
            qty = entry.get("quantity", 1)
            if name:
                for _ in range(qty):
                    cards.append(name)

    commanders_board = boards.get("commanders", {})
    commander_names: list[str] = []
    for _card_id, entry in (commanders_board.get("cards") or {}).items():
        card_obj = entry.get("card", {})
        name = card_obj.get("name", "")
        if name:
            commander_names.append(name)

    if commander_names:
        commander = " // ".join(commander_names) if len(commander_names) > 1 else commander_names[0]

    return {"commander": commander, "cards": cards}


def fetch_archidekt(deck_id: str) -> dict:
    """Fetch a deck from Archidekt's public API."""
    api_url = f"https://archidekt.com/api/decks/{deck_id}/"
    resp = requests.get(api_url, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()

    cards: list[str] = []
    commander_names: list[str] = []

    for entry in data.get("cards", []):
        card = entry.get("card", {})
        name = card.get("oracleCard", {}).get("name") or card.get("name", "")
        categories = [c.lower() for c in entry.get("categories", [])]
        qty = entry.get("quantity", 1)

        if "commander" in categories:
            commander_names.append(name)
            continue

        if "sideboard" in categories or "maybeboard" in categories:
            continue

        for _ in range(qty):
            cards.append(name)

    commander = " // ".join(commander_names) if commander_names else None
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
    parsed = parse_decklist_text(resp.text)

    # MTGGoldfish's download endpoint often omits commander section headers.
    # For Commander decks, the deck page includes an "Archetype:" field that
    # typically matches the commander. Use it as a best-effort hint.
    try:
        page_url = f"https://www.mtggoldfish.com/deck/{deck_id}"
        page_resp = requests.get(page_url, timeout=_REQUEST_TIMEOUT)
        page_resp.raise_for_status()
        commander = _extract_mtggoldfish_commander_from_html(page_resp.text)
        if commander:
            parsed["commander"] = commander
    except Exception as e:
        logger.info("MTGGoldfish commander extraction failed (id=%s): %s", deck_id, e)

    return parsed


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
