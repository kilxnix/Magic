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


def _resolve_card_name(name: str, card_db: dict) -> Tuple[Optional[str], Optional[str]]:
    """Try to find a card in the database, with fuzzy matching.

    Returns (resolved_name, warning_or_none).
    If not found at all, returns (None, error_message).
    """
    # Exact match
    if name in card_db:
        return name, None

    # Try common character substitutions
    for old, new in _NAME_SUBS:
        alt = name.replace(old, new)
        if alt in card_db:
            return alt, None

    # Case-insensitive match
    name_lower = name.lower()
    for db_name in card_db:
        if db_name.lower() == name_lower:
            return db_name, None

    # Fuzzy match using difflib (close matches from all card names)
    matches = get_close_matches(name, card_db.keys(), n=1, cutoff=0.85)
    if matches:
        return matches[0], f"'{name}' matched to '{matches[0]}' (fuzzy)"

    # Search with looser cutoff
    matches = get_close_matches(name, card_db.keys(), n=3, cutoff=0.6)
    if matches:
        return matches[0], f"'{name}' best guess: '{matches[0]}' (low confidence)"

    return None, f"Card '{name}' not found in card database"


def parse_decklist(text: str) -> dict:
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
    - Quantity > 1 is allowed only for basic lands

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

        # Duplicate check for non-basics
        if not is_basic:
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


def _strip_set_code(name: str) -> str:
    """Remove set code and collector number from a card name.

    Examples:
        'Sol Ring (EOC) 57'       -> 'Sol Ring'
        'Island (SNC) 264'        -> 'Island'
        'Nicol Bolas, Dragon-God (RVR) 205' -> 'Nicol Bolas, Dragon-God'
        'Sol Ring'                -> 'Sol Ring'
    """
    # Strip ANY trailing parenthesized set code + anything after it
    # Handles all formats: (EOC) 57, (PLST) TMP-294, (PECL) 267p, (SNC) 264,
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
    # Try "N Card Name" or "Nx Card Name"
    m = re.match(r"^(\d+)\s*[xX]?\s+(.+)$", line)
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

    # Support partner commanders stored as "Name A // Name B"
    commander_names: List[str] = parsed.get("commanders") or (commander.split(" // ") if commander else [])

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
                for c in (cmd_data.get("color_identity") or []):
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

    # Support partner commanders — look up each individually
    commander_names = parsed.get("commanders") or commander.split(" // ")
    commander_colors: Set[str] = set()
    oracle_parts: List[str] = []
    found_any = False
    for cmd_name in commander_names:
        cmd_data = card_db.get(cmd_name)
        if cmd_data:
            found_any = True
            commander_colors.update(cmd_data.get("color_identity") or [])
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
