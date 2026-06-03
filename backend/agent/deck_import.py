"""Deck import: parse, validate, and fill decklists for Commander."""

import re
from difflib import get_close_matches
from typing import Dict, List, Optional, Set, Tuple

from backend.rules import COMMANDER_BANNED_CARDS

# ---------------------------------------------------------------------------
# Flat decklist normalization (e.g., MTGGoldfish single-line exports)
# ---------------------------------------------------------------------------

_FLAT_ENTRY_START_RE = re.compile(r"(?:^|\s)(\d+)\s*[xX]?\s+")


def _normalize_flat_decklist(text: str) -> str:
    """Explode a single-line decklist like '1 Sol Ring 10 Forest ...' into many lines."""
    non_empty_lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(non_empty_lines) != 1:
        return text

    line = non_empty_lines[0].strip()
    if not line:
        return text

    # Split out common section markers that MTGGoldfish exports inline.
    # Example (Arena export): "Commander 1 X Deck 1 A ... Sideboard 1 B ..."
    # Only treat these as section markers when followed by a quantity.
    # This avoids splitting card names like "Commander's Sphere".
    line = re.sub(
        r"\b(Commander|Deck|Sideboard|Companion|Considering|Maybeboard)\b(?=\s+\d)",
        r"\n\1\n",
        line,
        flags=re.IGNORECASE,
    )

    out_lines: List[str] = []
    for segment in (seg.strip() for seg in line.splitlines() if seg.strip()):
        matches = list(_FLAT_ENTRY_START_RE.finditer(segment))
        if len(matches) <= 1:
            out_lines.append(segment)
            continue

        # Preserve any leading text before the first quantity (rare but can
        # happen if a marker wasn't split out for some reason).
        prefix = segment[:matches[0].start(1)].strip()
        if prefix:
            out_lines.append(prefix)

        for i, m in enumerate(matches):
            start = m.start(1)
            end = matches[i + 1].start(1) if i + 1 < len(matches) else len(segment)
            chunk = segment[start:end].strip()
            if chunk:
                out_lines.append(chunk)

    if len(out_lines) <= 1:
        return text

    return "\n".join(out_lines) + "\n"

# Basic lands that are allowed as duplicates
BASIC_LAND_NAMES: Set[str] = {
    "Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes",
    "Snow-Covered Plains", "Snow-Covered Island", "Snow-Covered Swamp",
    "Snow-Covered Mountain", "Snow-Covered Forest",
}

MAX_CARD_LINE_QUANTITY = 250
MAX_IMPORTED_CARD_ENTRIES = 300
COMMANDER_COLOR_ORDER = ["W", "U", "B", "R", "G"]

_COMMANDER_SECTION_HEADERS = {
    "commander",
    "commanders",
    "command zone",
}

_MAIN_SECTION_HEADERS = {
    "deck",
    "main",
    "main deck",
    "mainboard",
}

_SIDEBOARD_SECTION_HEADERS = {
    "sideboard",
    "side board",
}

_SKIP_SECTION_HEADERS = {
    "companion",
    "companions",
    "considering",
    "maybeboard",
    "maybe board",
    "tokens",
    "token",
    "attractions",
    "stickers",
    "planes",
    "schemes",
}

_CATEGORY_SECTION_HEADERS = {
    "artifacts",
    "battles",
    "creatures",
    "enchantments",
    "instants",
    "lands",
    "nonlands",
    "planeswalkers",
    "sorceries",
    "spells",
}

# Common character substitutions for card name resolution
_NAME_SUBS = [
    ("AE", "Æ"),
    ("Ae", "Æ"),
    ("ae", "æ"),
    ("'", "\u2019"),  # curly apostrophe
    ("'", "'"),       # reverse
    ("\u2019", "'"),
    ('"', '\u201c'),
    ('"', '\u201d'),
]


def _exact_card_name(name: str, card_db: dict) -> Optional[str]:
    """Resolve exact/case-insensitive card names without fuzzy matching."""
    if not name:
        return None

    if name in card_db:
        return name

    for old, new in _NAME_SUBS:
        alt = name.replace(old, new)
        if alt in card_db:
            return alt

    name_lower = name.lower()
    for db_name in card_db:
        if db_name.lower() == name_lower:
            return db_name

    return None


def _is_playable_printing(data: dict) -> bool:
    """Return True for real deck cards, false for art-card style extras."""
    layout = (data.get("layout") or "").lower()
    type_line = (data.get("type_line") or "").lower()
    if layout == "art_series":
        return False
    if type_line in {"card", "card // card"}:
        return False
    return True


def _face_match_priority(item: Tuple[str, dict]) -> tuple:
    """Prefer playable, Commander-legal printings when face names collide."""
    name, data = item
    legalities = data.get("legalities") or {}
    commander_status = legalities.get("commander")
    return (
        0 if _is_playable_printing(data) else 1,
        0 if commander_status == "legal" else 1,
        name,
    )


def _resolve_card_face_name(name: str, card_db: dict) -> Optional[str]:
    """Resolve an exact card-face name to its full Scryfall card name."""
    name_lower = name.lower()
    matches: List[Tuple[str, dict]] = []

    for db_name, data in card_db.items():
        for face in data.get("card_faces") or []:
            face_name = face.get("name")
            if face_name and face_name.lower() == name_lower:
                matches.append((db_name, data))
                break

    if not matches:
        return None

    matches.sort(key=_face_match_priority)
    return matches[0][0]


def _commander_name_parts(commander: Optional[str], commanders: Optional[List[str]]) -> List[str]:
    """Return raw commander names from parsed data."""
    if commanders:
        return [str(name).strip() for name in commanders if str(name).strip()]
    if commander:
        return [str(commander).strip()]
    return []


def _normalize_commander_names(
    commander: Optional[str],
    commanders: Optional[List[str]],
    card_db: dict,
) -> List[str]:
    """Distinguish partner commanders from double-faced card names."""
    names = _commander_name_parts(commander, commanders)
    if not names:
        return []

    if len(names) == 1:
        exact = _exact_card_name(names[0], card_db)
        if exact:
            return [exact]
        if " // " in names[0]:
            names = [part.strip() for part in names[0].split(" // ") if part.strip()]

    normalized: List[str] = []
    i = 0
    while i < len(names):
        matched_name: Optional[str] = None
        matched_end = i + 1

        # Longest adjacent "A // B" exact card name wins over partner splitting.
        for end in range(len(names), i + 1, -1):
            candidate = " // ".join(names[i:end])
            exact = _exact_card_name(candidate, card_db)
            if exact:
                matched_name = exact
                matched_end = end
                break

        if matched_name:
            normalized.append(matched_name)
            i = matched_end
        else:
            normalized.append(names[i])
            i += 1

    return normalized


def _effective_commander_color_identity(data: dict) -> List[str]:
    """Return color identity for a card when it is used as a commander.

    Some commander-legal cards choose a color before the game begins. In deck
    validation that choice can be any color, so the commander pair must be
    allowed to cover all five colors rather than whichever color a local card
    cache happened to store.
    """
    colors: List[str] = []
    for color in data.get("color_identity") or []:
        if color not in colors:
            colors.append(color)

    oracle_text = data.get("oracle_text") or ""
    if re.search(r"\bchoose a color before the game begins\b", oracle_text, re.IGNORECASE):
        for color in COMMANDER_COLOR_ORDER:
            if color not in colors:
                colors.append(color)

    return colors


def _remove_commanders_from_main_deck(parsed: dict, commander_names: List[str]) -> int:
    """Remove commander cards that were also imported in the main deck.

    URL sources can provide partner commanders in a commander field and still
    leave those same physical cards in the exported card list. Commander deck
    counts should count those cards once, in the command zone.
    """
    commander_keys = {name.strip().lower() for name in commander_names if name and name.strip()}
    if not commander_keys:
        return 0

    removed = 0
    for zone in ("cards", "lands"):
        kept: List[str] = []
        for name in parsed.get(zone, []):
            if str(name).strip().lower() in commander_keys:
                removed += 1
                continue
            kept.append(name)
        parsed[zone] = kept
    return removed


def _resolve_card_name(name: str, card_db: dict) -> Tuple[Optional[str], Optional[str]]:
    """Try to find a card in the database, with fuzzy matching.

    Returns (resolved_name, warning_or_none).
    If not found at all, returns (None, error_message).
    """
    exact = _exact_card_name(name, card_db)
    if exact:
        return exact, None

    face_match = _resolve_card_face_name(name, card_db)
    if face_match:
        return face_match, None

    # Fuzzy match using difflib (close matches from all card names)
    matches = get_close_matches(name, card_db.keys(), n=1, cutoff=0.85)
    if matches:
        return matches[0], f"'{name}' matched to '{matches[0]}' (fuzzy)"

    # Search with looser cutoff
    matches = get_close_matches(name, card_db.keys(), n=3, cutoff=0.6)
    if matches:
        return matches[0], f"'{name}' best guess: '{matches[0]}' (low confidence)"

    return None, f"Card '{name}' not found in card database"


def _strip_inline_comment(line: str) -> str:
    """Remove common end-of-line deck export notes."""
    return re.sub(r"\s+#.*$", "", line).strip()


def _normalize_section_header(line: str) -> str:
    """Return a normalized section header candidate."""
    header = _strip_inline_comment(line).strip().strip(":").strip()
    header = re.sub(r"\s*\([^)]*\)\s*$", "", header).strip()
    header = re.sub(r"\s+\d+\s*(?:cards?)?\s*$", "", header, flags=re.IGNORECASE).strip()
    header = re.sub(r"\s+", " ", header).lower()
    return header


def _is_metadata_line(line: str) -> bool:
    """Skip export chrome that is not a card line."""
    header = _normalize_section_header(line)
    if not header:
        return True
    if header in {"about", "card", "cards", "decklist", "export", "overview"}:
        return True
    if re.match(r"^(?:name|format|author|owner|created|updated|last modified)\s*[:：]", line, re.IGNORECASE):
        return True
    if re.match(r"^name\s+\S+", line, re.IGNORECASE):
        return True
    if re.match(
        r"^\d+\s+(?:cards?|commander|commanders|mainboard|sideboard|maybeboard)\b",
        header,
        re.IGNORECASE,
    ):
        return True
    return False


def _all_section_headers() -> Set[str]:
    return (
        _COMMANDER_SECTION_HEADERS
        | _MAIN_SECTION_HEADERS
        | _SIDEBOARD_SECTION_HEADERS
        | _SKIP_SECTION_HEADERS
        | _CATEGORY_SECTION_HEADERS
    )


def _parse_decklist_legacy(text: str, singleton: bool = True) -> dict:
    """Parse a pasted decklist text into structured data.

    Supported formats:
    - ``1 Sol Ring`` or ``1x Sol Ring`` (Moxfield / Archidekt)
    - ``Sol Ring`` (just card names, qty defaults to 1)
    - Lines containing ``*CMDR*`` or starting with ``Commander:`` mark the commander
    - ``//`` or ``#`` comment lines are ignored
    - Blank lines are ignored
    - Lines prefixed with ``SB:`` are treated as sideboard cards
    - Sideboard section (after a line containing "Sideboard" or after a double blank
      line) collects cards into the sideboard list
    - ``Companion``, ``Considering``, ``Maybeboard`` sections are skipped
    - For singleton formats, quantity > 1 is allowed only for basic lands

    Returns a dict with keys: commander, cards, lands, sideboard, total, errors.
    """
    text = _normalize_flat_decklist(text)
    commander: Optional[str] = None
    commander_names: List[str] = []
    cards: List[str] = []
    lands: List[str] = []
    sideboard: List[str] = []
    errors: List[str] = []

    # Track non-basic duplicates
    seen_names: Dict[str, int] = {}

    lines = text.splitlines()
    in_sideboard = False
    in_skip_section = False
    in_commander_section = False
    consecutive_blanks = 0

    for raw_line in lines:
        line = raw_line.strip()

        # Blank line tracking (double blank = sideboard separator)
        if not line:
            consecutive_blanks += 1
            if consecutive_blanks >= 2:
                in_sideboard = True
                in_skip_section = False
            continue
        consecutive_blanks = 0

        # Comment lines
        if line.startswith("//") or line.startswith("#"):
            continue

        # Sideboard header
        if re.match(r"^(?:Sideboard|SIDEBOARD)", line, re.IGNORECASE):
            in_sideboard = True
            in_skip_section = False
            continue

        # Companion / Considering / Maybeboard section headers — skip cards
        if re.match(r"^(Companion|Considering|Maybeboard)$", line, re.IGNORECASE):
            in_skip_section = True
            in_commander_section = False
            continue

        # Deck header resets skip sections back to main deck
        if re.match(r"^Deck$", line, re.IGNORECASE):
            in_skip_section = False
            in_sideboard = False
            in_commander_section = False
            continue

        if in_skip_section:
            continue

        # Handle SB: prefix — treat as sideboard regardless of current section
        sb_line = False
        if re.match(r"^SB:\s*", line, re.IGNORECASE):
            sb_line = True
            line = re.sub(r"^SB:\s*", "", line, flags=re.IGNORECASE).strip()

        # Collect sideboard cards (from section or SB: prefix)
        if in_sideboard or sb_line:
            qty, name = _parse_line(line)
            if name:
                for _ in range(qty):
                    sideboard.append(name)
            continue

        # Moxfield export section headers — skip non-card lines
        if re.match(r"^(About|Tokens?)$", line, re.IGNORECASE):
            in_commander_section = False
            continue
        # Moxfield "Name ..." line (deck name)
        if re.match(r"^Name\s+.+", line):
            continue
        # Moxfield "Commander" section header — next card line is the commander
        if re.match(r"^Commander$", line, re.IGNORECASE):
            in_commander_section = True
            continue

        # Detect commander markers
        is_commander = False
        if "*CMDR*" in line:
            is_commander = True
            line = line.replace("*CMDR*", "").strip()
        elif line.lower().startswith("commander:"):
            is_commander = True
            line = re.sub(r"^[Cc]ommander:\s*", "", line).strip()
        elif in_commander_section:
            is_commander = True
            # Don't reset in_commander_section — partners have multiple lines

        # Parse quantity and name
        qty, name = _parse_line(line)
        if not name:
            continue

        if is_commander:
            commander_names.append(name)
            continue

        # Check for basic land
        is_basic = name in BASIC_LAND_NAMES

        # Duplicate check for singleton formats
        if singleton and not is_basic:
            if qty > 1:
                errors.append(
                    f"Non-basic card '{name}' has quantity {qty} (only 1 allowed)"
                )
                qty = 1
            prev = seen_names.get(name, 0)
            if prev > 0:
                errors.append(f"Duplicate non-basic card: '{name}'")
                continue  # skip the duplicate
            seen_names[name] = 1

        # Classify as land or non-land
        # We treat basic lands as lands; other cards are classified later during
        # validation when we have card_db. For now, basic lands go to lands list.
        if is_basic:
            for _ in range(qty):
                lands.append(name)
        else:
            for _ in range(qty):
                cards.append(name)

    # Finalize commander — join partners with " // "
    if commander_names:
        commander = " // ".join(commander_names)
    commander_count = len(commander_names) if commander_names else (1 if commander else 0)
    total = commander_count + len(cards) + len(lands)

    return {
        "commander": commander,
        "commanders": commander_names if commander_names else ([commander] if commander else []),
        "cards": cards,
        "lands": lands,
        "sideboard": sideboard,
        "total": total,
        "errors": errors,
    }


def parse_decklist(text: str, singleton: bool = True) -> dict:
    """Parse a pasted decklist text into structured data.

    This accepts the legacy return shape while covering more real export formats.
    """
    text = _normalize_flat_decklist(text)
    commander: Optional[str] = None
    commander_names: List[str] = []
    cards: List[str] = []
    lands: List[str] = []
    sideboard: List[str] = []
    errors: List[str] = []
    seen_names: Dict[str, int] = {}

    in_sideboard = False
    in_skip_section = False
    in_commander_section = False
    consecutive_blanks = 0
    truncated_entries = False

    def entry_count() -> int:
        return len(commander_names) + len(cards) + len(lands) + len(sideboard)

    def append_entries(target: List[str], qty: int, name: str) -> None:
        nonlocal truncated_entries
        if qty <= 0:
            return
        if qty > MAX_CARD_LINE_QUANTITY:
            errors.append(
                f"Quantity for '{name}' is {qty}; capped at {MAX_CARD_LINE_QUANTITY}"
            )
            qty = MAX_CARD_LINE_QUANTITY

        remaining = MAX_IMPORTED_CARD_ENTRIES - entry_count()
        if remaining <= 0:
            if not truncated_entries:
                errors.append(
                    f"Decklist has more than {MAX_IMPORTED_CARD_ENTRIES} card entries; extra lines were ignored"
                )
                truncated_entries = True
            return

        if qty > remaining:
            if not truncated_entries:
                errors.append(
                    f"Decklist has more than {MAX_IMPORTED_CARD_ENTRIES} card entries; extra lines were ignored"
                )
                truncated_entries = True
            qty = remaining

        target.extend([name] * qty)

    for raw_line in text.splitlines():
        line = raw_line.strip().lstrip("\ufeff")

        if not line:
            consecutive_blanks += 1
            if consecutive_blanks >= 2:
                in_sideboard = True
                in_skip_section = False
                in_commander_section = False
            continue
        consecutive_blanks = 0

        if line.startswith("//") or line.startswith("#"):
            continue

        line = _strip_inline_comment(line)
        if not line:
            continue

        header = _normalize_section_header(line)

        if header in _SIDEBOARD_SECTION_HEADERS:
            in_sideboard = True
            in_skip_section = False
            in_commander_section = False
            continue

        if header in _SKIP_SECTION_HEADERS:
            in_skip_section = True
            in_commander_section = False
            continue

        if header in _MAIN_SECTION_HEADERS:
            in_skip_section = False
            in_sideboard = False
            in_commander_section = False
            continue

        if header in _CATEGORY_SECTION_HEADERS:
            in_commander_section = False
            continue

        if header in _COMMANDER_SECTION_HEADERS:
            in_commander_section = True
            in_sideboard = False
            in_skip_section = False
            continue

        if _is_metadata_line(line):
            in_commander_section = False
            continue

        if in_skip_section:
            continue

        sb_line = False
        if re.match(r"^(?:SB|Sideboard)\s*:?\s+", line, re.IGNORECASE):
            sb_line = True
            line = re.sub(r"^(?:SB|Sideboard)\s*:?\s+", "", line, flags=re.IGNORECASE).strip()

        if in_sideboard or sb_line:
            qty, name = _parse_line(line)
            if name:
                append_entries(sideboard, qty, name)
            continue

        is_commander = False
        if re.search(r"\*(?:CMDR|COMMANDER)\*", line, re.IGNORECASE):
            is_commander = True
            line = re.sub(r"\*(?:CMDR|COMMANDER)\*", "", line, flags=re.IGNORECASE).strip()
        elif re.match(r"^(?:Commander|Commanders|Command Zone)\s*:\s*", line, re.IGNORECASE):
            is_commander = True
            line = re.sub(r"^(?:Commander|Commanders|Command Zone)\s*:\s*", "", line, flags=re.IGNORECASE).strip()
        elif in_commander_section:
            is_commander = True

        qty, name = _parse_line(line)
        if not name:
            continue

        if name.lower() in _all_section_headers():
            in_commander_section = False
            continue

        if is_commander:
            if entry_count() >= MAX_IMPORTED_CARD_ENTRIES:
                if not truncated_entries:
                    errors.append(
                        f"Decklist has more than {MAX_IMPORTED_CARD_ENTRIES} card entries; extra lines were ignored"
                    )
                    truncated_entries = True
                continue
            commander_names.append(name)
            continue

        is_basic = name in BASIC_LAND_NAMES

        if singleton and not is_basic:
            if qty > 1:
                errors.append(
                    f"Non-basic card '{name}' has quantity {qty} (only 1 allowed)"
                )
                qty = 1
            prev = seen_names.get(name, 0)
            if prev > 0:
                errors.append(f"Duplicate non-basic card: '{name}'")
                continue
            seen_names[name] = 1

        if is_basic:
            append_entries(lands, qty, name)
        else:
            append_entries(cards, qty, name)

    if commander_names:
        commander = " // ".join(commander_names)
    commander_count = len(commander_names) if commander_names else (1 if commander else 0)
    total = commander_count + len(cards) + len(lands)

    return {
        "commander": commander,
        "commanders": commander_names if commander_names else ([commander] if commander else []),
        "cards": cards,
        "lands": lands,
        "sideboard": sideboard,
        "total": total,
        "errors": errors,
    }


def validate_constructed_deck(parsed: dict, card_db: dict, format_name: str = "standard") -> dict:
    """Validate a parsed deck against basic Constructed rules for a format.

    Currently used for Standard tournament deck registration:
    - Main deck minimum 60 cards
    - Sideboard maximum 15 cards
    - Up to four copies of a non-basic card across main + sideboard
    - Cards must be legal in the requested format according to Scryfall legalities
    """
    errors: List[str] = list(parsed.get("errors", []))
    warnings: List[str] = []
    format_key = format_name.lower()

    parsed["commander"] = None
    parsed["commanders"] = []

    def resolve_names(names: List[str], zone_name: str) -> List[str]:
        resolved_names: List[str] = []
        for name in names:
            if name in BASIC_LAND_NAMES:
                resolved_names.append(name)
                continue
            resolved, warning = _resolve_card_name(name, card_db)
            if resolved:
                if warning:
                    warnings.append(warning)
                resolved_names.append(resolved)
            else:
                errors.append(warning or f"Card '{name}' not found in {zone_name}")
                resolved_names.append(name)
        return resolved_names

    cards = resolve_names(parsed.get("cards", []), "main deck")
    lands = resolve_names(parsed.get("lands", []), "main deck")
    sideboard = resolve_names(parsed.get("sideboard", []), "sideboard")

    reclassified_cards: List[str] = []
    for name in cards:
        data = card_db.get(name)
        if data and "land" in (data.get("type_line") or "").lower():
            lands.append(name)
        else:
            reclassified_cards.append(name)

    parsed["cards"] = reclassified_cards
    parsed["lands"] = lands
    parsed["sideboard"] = sideboard

    main_total = len(reclassified_cards) + len(lands)
    parsed["total"] = main_total

    if main_total < 60:
        errors.append(f"Deck has only {main_total} main-deck cards (minimum is 60)")
    if len(sideboard) > 15:
        errors.append(f"Sideboard has {len(sideboard)} cards (maximum is 15)")

    all_registered = reclassified_cards + lands + sideboard
    counts: Dict[str, int] = {}
    for name in all_registered:
        if name in BASIC_LAND_NAMES:
            continue
        counts[name] = counts.get(name, 0) + 1

        data = card_db.get(name)
        if not data:
            continue
        if not _is_playable_printing(data):
            errors.append(f"Card '{name}' is not an authorized deck card")
        legalities = data.get("legalities") or {}
        if legalities.get(format_key) != "legal":
            errors.append(f"Card '{name}' is not legal in {format_name.title()}")

    for name, count in counts.items():
        if count > 4:
            errors.append(f"Card '{name}' has {count} copies across main deck and sideboard (maximum is 4)")

    color_identity: List[str] = []
    for name in all_registered:
        data = card_db.get(name)
        if not data:
            continue
        for color in data.get("color_identity") or []:
            if color not in color_identity:
                color_identity.append(color)

    return {
        "valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "missing_slots": max(0, 60 - main_total),
        "color_identity": color_identity,
    }


def _strip_set_code(name: str) -> str:
    """Remove set code and collector number from a card name.

    Examples:
        'Sol Ring (EOC) 57'       -> 'Sol Ring'
        'Island (SNC) 264'        -> 'Island'
        'Nicol Bolas, Dragon-God (RVR) 205' -> 'Nicol Bolas, Dragon-God'
        'Sol Ring'                -> 'Sol Ring'
    """
    name = _strip_inline_comment(name)
    name = re.sub(r"^[*\-]\s*", "", name).strip()
    name = re.sub(r"^\[[^\]]+\]\s*", "", name).strip()

    # Strip Moxfield-style trailing markers such as *F* or *CMDR*.
    while True:
        cleaned = re.sub(r"\s+\*[^*]+\*\s*$", "", name).strip()
        if cleaned == name:
            break
        name = cleaned

    # Strip trailing bracketed set info such as [C21] 267.
    name = re.sub(r"\s+\[[A-Za-z0-9_.:-]+\](?:\s+\S+)?$", "", name).strip()

    # Strip ANY trailing parenthesized set code + anything after it.
    # Handles formats: (EOC) 57, (PLST) TMP-294, (PECL) 267p, (SNC) 264,
    # (30A) 553, (H1R) 40, (2XM) 235, (PLST) E02-3, etc.
    return re.sub(r"\s*\([^)]+\)\s*.*$", "", name).strip()


def _parse_line(line: str) -> tuple:
    """Parse a single decklist line into (quantity, card_name).

    Handles formats:
    - ``1 Sol Ring``
    - ``1x Sol Ring``
    - ``1x Sol Ring (EOC) 57``
    - ``Sol Ring``
    """
    line = _strip_inline_comment(line).strip()
    line = re.sub(r"^[*\-]\s*", "", line).strip()

    # Try "N Card Name", "Nx Card Name", or MTGO "N [SET:CN] Card Name".
    m = re.match(r"^(\d+)(?:\s*[xX]\s+|\s+)(?:\[[^\]]+\]\s*)?(.+)$", line)
    if m:
        return int(m.group(1)), _strip_set_code(m.group(2).strip())

    # Just a card name (possibly with set code)
    if line:
        return 1, _strip_set_code(line.strip())

    return 0, ""


def validate_deck(parsed: dict, card_db: dict) -> dict:
    """Validate a parsed deck against Commander rules.

    Parameters
    ----------
    parsed : dict
        Output of :func:`parse_decklist`.
    card_db : dict
        Mapping of card name -> card data dict.  Each entry must have at least
        ``type_line`` and ``color_identity`` fields.

    Returns
    -------
    dict with keys: valid, errors, warnings, missing_slots, color_identity.
    """
    errors: List[str] = list(parsed.get("errors", []))
    warnings: List[str] = []
    commander = parsed.get("commander")
    cards = parsed.get("cards", [])
    lands = parsed.get("lands", [])

    # If card_db isn't available (e.g., mtg_data/cards_min.jsonl missing),
    # fall back to structural validation so import workflows can still run.
    if not card_db:
        commander_names: List[str] = parsed.get("commanders") or (commander.split(" // ") if commander else [])
        if not commander_names:
            errors.append("No commander specified")

        commander_count = len(commander_names) if commander_names else 0
        removed_commanders = _remove_commanders_from_main_deck(parsed, commander_names)
        if removed_commanders:
            cards = parsed.get("cards", [])
            lands = parsed.get("lands", [])
            warnings.append(
                f"Removed {removed_commanders} commander card"
                f"{'' if removed_commanders == 1 else 's'} from the main deck count"
            )
        total = commander_count + len(cards) + len(lands)
        parsed["total"] = total

        missing_slots = 0
        if total < 100:
            missing_slots = 100 - total
            warnings.append(f"Deck has only {total} cards ({missing_slots} slots to fill)")
        elif total > 100:
            errors.append(f"Deck has {total} cards (maximum is 100)")

        warnings.append(
            "Card database unavailable; skipping commander legality, card resolution, and color identity checks."
        )

        return {
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "missing_slots": missing_slots,
            "color_identity": [],
        }

    # ── Auto-detect commander if not specified ───────────────────────
    # If no commander was marked, check if the first card is legendary
    if not commander and cards:
        first_card = cards[0]
        resolved, _ = _resolve_card_name(first_card, card_db)
        if resolved:
            data = card_db[resolved]
            type_line = (data.get("type_line") or "").lower()
            if "legendary" in type_line and ("creature" in type_line or "can be your commander" in (data.get("oracle_text") or "").lower()):
                commander = resolved
                parsed["commander"] = resolved
                cards = cards[1:]  # Remove from card list
                parsed["cards"] = cards
                warnings.append(f"Auto-detected commander: {resolved} (first card in list)")

    # ── Commander checks ──────────────────────────────────────────────
    color_identity: List[str] = []

    commander_names = _normalize_commander_names(
        commander,
        parsed.get("commanders"),
        card_db,
    )

    if not commander_names:
        errors.append("No commander specified")
    else:
        resolved_names: List[str] = []
        for cmd_name in commander_names:
            resolved_cmd, cmd_warning = _resolve_card_name(cmd_name, card_db)
            if resolved_cmd:
                if cmd_warning:
                    warnings.append(cmd_warning)
                resolved_names.append(resolved_cmd)
                cmd_data = card_db[resolved_cmd]
                type_line = (cmd_data.get("type_line") or "").lower()
                oracle_text = (cmd_data.get("oracle_text") or "").lower()
                if "legendary" not in type_line:
                    errors.append(
                        f"Commander '{resolved_cmd}' is not legendary"
                    )
                if "creature" not in type_line and "can be your commander" not in oracle_text:
                    errors.append(
                        f"Commander '{resolved_cmd}' is not a creature "
                        "(and does not have 'can be your commander')"
                    )
                # Union color identities from all commanders (partners)
                for c in _effective_commander_color_identity(cmd_data):
                    if c not in color_identity:
                        color_identity.append(c)
            else:
                errors.append(cmd_warning or f"Commander '{cmd_name}' not found")
                resolved_names.append(cmd_name)

            if cmd_name in COMMANDER_BANNED_CARDS or (resolved_cmd and resolved_cmd in COMMANDER_BANNED_CARDS):
                errors.append(f"Commander '{cmd_name}' is banned in Commander")

        # Update parsed with resolved names
        commander = " // ".join(resolved_names)
        parsed["commander"] = commander
        parsed["commanders"] = resolved_names

    # ── Card existence and colour identity ────────────────────────────
    commander_colors = set(color_identity)

    # Resolve all card names with fuzzy matching, updating lists in place
    resolved_cards: List[str] = []
    for name in cards:
        if name in BASIC_LAND_NAMES:
            resolved_cards.append(name)
            continue
        resolved, warning = _resolve_card_name(name, card_db)
        if resolved:
            if warning:
                warnings.append(warning)
            resolved_cards.append(resolved)
        else:
            errors.append(warning or f"Card '{name}' not found")
            resolved_cards.append(name)  # keep original for reporting
    parsed["cards"] = resolved_cards
    cards = resolved_cards

    resolved_lands: List[str] = []
    for name in lands:
        if name in BASIC_LAND_NAMES:
            resolved_lands.append(name)
            continue
        resolved, warning = _resolve_card_name(name, card_db)
        if resolved:
            if warning:
                warnings.append(warning)
            resolved_lands.append(resolved)
        else:
            errors.append(warning or f"Card '{name}' not found")
            resolved_lands.append(name)
    parsed["lands"] = resolved_lands
    lands = resolved_lands

    removed_commanders = _remove_commanders_from_main_deck(parsed, parsed.get("commanders") or commander_names)
    if removed_commanders:
        warnings.append(
            f"Removed {removed_commanders} commander card"
            f"{'' if removed_commanders == 1 else 's'} from the main deck count"
        )
        cards = parsed.get("cards", [])
        lands = parsed.get("lands", [])

    all_card_names = cards + lands
    for name in all_card_names:
        if name in BASIC_LAND_NAMES:
            continue
        data = card_db.get(name)
        if data is None:
            continue  # already reported above
        # Color identity check
        card_colors = set(data.get("color_identity") or [])
        if not card_colors.issubset(commander_colors):
            errors.append(
                f"Card '{name}' color identity {sorted(card_colors)} "
                f"is outside commander's identity {sorted(commander_colors)}"
            )
        # Banned check
        if name in COMMANDER_BANNED_CARDS:
            errors.append(f"Card '{name}' is banned in Commander")

    # ── Reclassify non-basic lands ────────────────────────────────────
    # Move cards from the "cards" list to "lands" if their type_line says Land
    reclassified_cards: List[str] = []
    for name in cards:
        data = card_db.get(name)
        if data and "land" in (data.get("type_line") or "").lower():
            lands.append(name)
        else:
            reclassified_cards.append(name)
    parsed["cards"] = reclassified_cards
    parsed["lands"] = lands
    cards = reclassified_cards

    # ── Total count ───────────────────────────────────────────────────
    commander_count = len(commander_names) if commander_names else 0
    total = commander_count + len(cards) + len(lands)
    parsed["total"] = total

    missing_slots = 0
    if total < 100:
        missing_slots = 100 - total
        warnings.append(f"Deck has only {total} cards ({missing_slots} slots to fill)")
    elif total > 100:
        errors.append(f"Deck has {total} cards (maximum is 100)")

    valid = len(errors) == 0

    return {
        "valid": valid,
        "errors": errors,
        "warnings": warnings,
        "missing_slots": missing_slots,
        "color_identity": color_identity,
    }


def fill_missing_slots(parsed: dict, card_db: dict, bracket: int = 3) -> dict:
    """Fill remaining deck slots using FAISS semantic search.

    Uses the deck generator's search to find cards that synergize with the
    commander's oracle text, filtering by colour identity and avoiding
    duplicates.

    Parameters
    ----------
    parsed : dict
        Output of :func:`parse_decklist` (may be mutated).
    card_db : dict
        Card name -> card data mapping.
    bracket : int
        Power level bracket (1-5).

    Returns
    -------
    Updated ``parsed`` dict with additional cards filled in.  Also adds a
    ``filled_cards`` key listing the names that were auto-added.
    """
    from backend.deck_generator import get_generator

    commander = parsed.get("commander")
    if not commander:
        parsed["filled_cards"] = []
        return parsed

    # Support partner commanders while preserving exact double-faced names.
    commander_names = _normalize_commander_names(
        commander,
        parsed.get("commanders"),
        card_db,
    )
    parsed["commander"] = " // ".join(commander_names)
    parsed["commanders"] = commander_names
    commander_colors: Set[str] = set()
    oracle_parts: List[str] = []
    found_any = False
    for cmd_name in commander_names:
        cmd_data = card_db.get(cmd_name)
        if cmd_data:
            found_any = True
            commander_colors.update(_effective_commander_color_identity(cmd_data))
            oracle_parts.append(cmd_data.get("oracle_text") or cmd_data.get("name", ""))

    if not found_any:
        parsed["filled_cards"] = []
        return parsed

    oracle_text = " ".join(oracle_parts)

    # How many non-commander cards do we need?
    current_count = len(parsed.get("cards", [])) + len(parsed.get("lands", []))
    needed = (100 - len(commander_names)) - current_count
    if needed <= 0:
        parsed["filled_cards"] = []
        return parsed

    # Already-used names
    existing_names: Set[str] = set(parsed.get("cards", []))
    existing_names.update(parsed.get("lands", []))
    existing_names.update(commander_names)

    gen = get_generator()
    # Search with a generous k so we have room to filter
    results = gen.search_cards(oracle_text, k=needed * 4)

    filled: List[str] = []
    for card in results:
        if len(filled) >= needed:
            break
        name = card.get("name", "")
        if not name or name in existing_names:
            continue
        # Color identity filter — use card_db for authoritative data
        db_card = card_db.get(name)
        card_colors = set((db_card or card).get("color_identity") or [])
        if not card_colors.issubset(commander_colors):
            continue
        # Banned check
        if name in COMMANDER_BANNED_CARDS:
            continue
        # Skip basic lands in fill (user should add those explicitly)
        if name in BASIC_LAND_NAMES:
            continue
        # Skip lands in fill results - we want nonland cards
        type_line = (card.get("type_line") or "").lower()
        if "land" in type_line:
            continue
        # Skip token cards — not real cards for decks
        if "token" in type_line:
            continue

        existing_names.add(name)
        filled.append(name)
        parsed["cards"].append(name)

    # Recalculate total
    parsed["total"] = len(commander_names) + len(parsed["cards"]) + len(parsed["lands"])
    parsed["filled_cards"] = filled

    return parsed
