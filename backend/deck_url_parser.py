"""Deck URL parser — fetch decklists from Moxfield, Archidekt, TappedOut, MTGGoldfish."""

import logging
import re
from html import unescape
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import unquote, urljoin, urlparse

import requests
import cloudscraper

from backend.agent.deck_import import parse_decklist

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# URL detection
# ---------------------------------------------------------------------------

_SITE_HOSTS = {
    "moxfield.com": "moxfield",
    "archidekt.com": "archidekt",
    "tappedout.net": "tappedout",
    "mtggoldfish.com": "mtggoldfish",
}


def _parse_supported_url(url: str):
    candidate = (url or "").strip()
    if not candidate:
        return None
    if not re.match(r"^[a-z][a-z0-9+.-]*://", candidate, re.IGNORECASE):
        candidate = f"https://{candidate}"
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    return parsed


def _normalise_host(hostname: str) -> str:
    host = hostname.lower().strip(".")
    return host[4:] if host.startswith("www.") else host


def detect_site(url: str) -> Optional[str]:
    """Return the site key for a recognised MTG deck URL, or None."""
    parsed = _parse_supported_url(url)
    if parsed is None:
        return None

    site = _SITE_HOSTS.get(_normalise_host(parsed.hostname or ""))
    if site is None:
        return None

    path = parsed.path.lower()
    if site in {"moxfield", "archidekt"}:
        return site if path.startswith("/decks/") else None
    if site == "tappedout":
        return site if path.startswith("/mtg-decks/") else None
    if site == "mtggoldfish":
        return site if path.startswith("/deck/") or path.startswith("/archetype/") else None
    return None


# ---------------------------------------------------------------------------
# Deck-ID / slug extraction
# ---------------------------------------------------------------------------

def extract_deck_id(url: str, site: str) -> Optional[str]:
    """Extract the deck slug/ID from *url* for the given *site*."""
    parsed = _parse_supported_url(url)
    if parsed is None or detect_site(url) != site:
        return None

    parts = [unquote(part) for part in parsed.path.split("/") if part]
    if site in {"moxfield", "archidekt"} and len(parts) >= 2 and parts[0].lower() == "decks":
        deck_id = parts[1]
        if site == "archidekt" and not deck_id.isdigit():
            return None
        return deck_id
    if site == "tappedout" and len(parts) >= 2 and parts[0].lower() == "mtg-decks":
        return parts[1]
    if site == "mtggoldfish" and len(parts) >= 2 and parts[0].lower() in {"deck", "archetype"}:
        return parts[1]
    return None


# ---------------------------------------------------------------------------
# Plain-text decklist parser
# ---------------------------------------------------------------------------

_MAX_FETCH_QUANTITY = 250
_ONE_LINE_CARD_START_RE = re.compile(r"(?<!\S)(\d{1,3})\s*[xX]?\s+(?:\[[^\]]+\]\s*)?")


def _normalise_one_line_plain_text_export(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) != 1:
        return text

    line = lines[0]
    matches = [
        match
        for match in _ONE_LINE_CARD_START_RE.finditer(line)
        if 0 < int(match.group(1)) <= _MAX_FETCH_QUANTITY
    ]
    if len(matches) < 2 or matches[0].start() != 0:
        return text

    split_lines: list[str] = []
    for index, match in enumerate(matches):
        next_start = matches[index + 1].start() if index + 1 < len(matches) else len(line)
        card_line = line[match.start():next_start].strip()
        if card_line:
            split_lines.append(card_line)

    return "\n".join(split_lines) if split_lines else text


def parse_decklist_text(text: str) -> dict:
    """Parse a plain-text decklist into ``{"commander": ..., "cards": [...]}``.

    Recognises section headers (Commander, Sideboard, etc.) and strips set
    codes / collector numbers from card lines.
    """
    parsed = parse_decklist(_normalise_one_line_plain_text_export(text), singleton=False)
    return {
        "commander": parsed.get("commander"),
        "cards": [*parsed.get("cards", []), *parsed.get("lands", [])],
    }


# ---------------------------------------------------------------------------
# Site-specific fetchers
# ---------------------------------------------------------------------------

_REQUEST_TIMEOUT = 15  # seconds


def _safe_quantity(value) -> int:
    try:
        qty = int(value)
    except (TypeError, ValueError):
        qty = 1
    return max(0, min(qty, _MAX_FETCH_QUANTITY))


def _append_quantity(target: list[str], name: str, quantity) -> None:
    clean_name = str(name or "").strip()
    if not clean_name:
        return
    target.extend([clean_name] * _safe_quantity(quantity))


def _category_name(category) -> str:
    if isinstance(category, dict):
        return str(category.get("name") or category.get("label") or "").lower()
    return str(category or "").lower()


class _MTGGoldfishDownloadLinkParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.text_file_hrefs: list[str] = []
        self.download_hrefs: list[str] = []
        self._active_href: Optional[str] = None
        self._active_text: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href and "/deck/download/" in href:
            self._active_href = href
            self._active_text = []

    def handle_data(self, data: str) -> None:
        if self._active_href is not None:
            self._active_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._active_href is None:
            return

        href = self._active_href
        text = " ".join("".join(self._active_text).split()).lower()
        self.download_hrefs.append(href)
        if "text file" in text:
            self.text_file_hrefs.append(href)
        self._active_href = None
        self._active_text = []


def _find_mtggoldfish_text_download_url(html: str, page_url: str) -> Optional[str]:
    parser = _MTGGoldfishDownloadLinkParser()
    parser.feed(html)

    hrefs = parser.text_file_hrefs or parser.download_hrefs
    if not hrefs:
        return None
    return urljoin(page_url, hrefs[0])


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

    for board_key in ("mainboard",):
        board = boards.get(board_key, {})
        for _card_id, entry in (board.get("cards") or {}).items():
            card_obj = entry.get("card", {})
            name = card_obj.get("name", "")
            _append_quantity(cards, name, entry.get("quantity", 1))

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
        categories = [_category_name(c) for c in entry.get("categories", [])]
        qty = entry.get("quantity", 1)

        if "commander" in categories:
            commander_names.append(name)
            continue

        if (
            "sideboard" in categories
            or "maybeboard" in categories
            or "maybe board" in categories
            or "companion" in categories
            or "tokens" in categories
        ):
            continue

        _append_quantity(cards, name, qty)

    commander = " // ".join(commander_names) if commander_names else None
    return {"commander": commander, "cards": cards}


def fetch_tappedout(deck_id: str) -> dict:
    """Fetch a deck from TappedOut via text export."""
    export_url = f"https://tappedout.net/mtg-decks/{deck_id}/?fmt=txt"
    resp = requests.get(export_url, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    return parse_decklist_text(resp.text)


def _infer_mtggoldfish_commander(html: str) -> Optional[str]:
    title_match = re.search(r"<title>\s*(.+?)\s+Deck for Magic", html, re.IGNORECASE | re.DOTALL)
    if not title_match:
        return None
    title = re.sub(r"\s+", " ", unescape(title_match.group(1))).strip()
    return title or None


def _mtggoldfish_download_url_from_archetype(deck_slug: str) -> tuple[str, Optional[str]]:
    archetype_url = f"https://www.mtggoldfish.com/archetype/{deck_slug}"
    resp = requests.get(archetype_url, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    download_url = _find_mtggoldfish_text_download_url(resp.text, archetype_url)
    if download_url is None:
        raise ValueError(f"Could not find MTGGoldfish Text File download link for archetype: {deck_slug}")
    return download_url, _infer_mtggoldfish_commander(resp.text)


def fetch_mtggoldfish(deck_id: str) -> dict:
    """Fetch a deck from MTGGoldfish via download link."""
    commander_hint: Optional[str] = None
    if not deck_id.isdigit():
        download_url, commander_hint = _mtggoldfish_download_url_from_archetype(deck_id)
    else:
        download_url = f"https://www.mtggoldfish.com/deck/download/{deck_id}"
    resp = requests.get(download_url, timeout=_REQUEST_TIMEOUT)
    resp.raise_for_status()
    parsed = parse_decklist_text(resp.text)
    if commander_hint and not parsed.get("commander"):
        cards = parsed.get("cards", [])
        parsed["commander"] = commander_hint
        parsed["cards"] = [card for card in cards if card.lower() != commander_hint.lower()][:99]
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
