"""Local draft-pool helpers for Limited draft simulation."""

from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parent.parent
CARDS_MIN_PATH = PROJECT_ROOT / "mtg_data" / "cards_min.jsonl"
DRAFT_CARDS_PATH = PROJECT_ROOT / "mtg_data" / "draft_cards.jsonl"
SETS_METADATA_PATH = PROJECT_ROOT / "mtg_data" / "scryfall_sets.json"

NON_GAME_LAYOUTS = {
    "art_series",
    "augment",
    "emblem",
    "host",
    "planar",
    "scheme",
    "token",
    "vanguard",
}

DRAFT_SET_TYPES = {
    "core",
    "draft_innovation",
    "expansion",
    "funny",
    "masters",
}

BASIC_LANDS = {"Plains", "Island", "Swamp", "Mountain", "Forest"}


def _is_draftable_card(card: dict[str, Any]) -> bool:
    name = card.get("name") or ""
    type_line = (card.get("type_line") or "").lower()
    layout = (card.get("layout") or "").lower()
    rarity = (card.get("rarity") or "").lower()
    set_code = card.get("set") or ""

    if not name or not set_code or rarity not in {"common", "uncommon", "rare", "mythic"}:
        return False
    if card.get("booster") is False:
        return False
    if card.get("digital") is True:
        return False
    if layout in NON_GAME_LAYOUTS:
        return False
    if "token" in type_line or "card" == type_line:
        return False
    return True


def _source_path() -> Path:
    return DRAFT_CARDS_PATH if DRAFT_CARDS_PATH.exists() else CARDS_MIN_PATH


def _cache_key(path: Path) -> tuple[str, int]:
    return (str(path), path.stat().st_mtime_ns)


@lru_cache(maxsize=4)
def _load_draft_cards_cached(path: str, _mtime_ns: int) -> list[dict[str, Any]]:
    cards: list[dict[str, Any]] = []
    with Path(path).open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            card = json.loads(line)
            if _is_draftable_card(card):
                cards.append(card)
    return cards


def load_draft_cards() -> list[dict[str, Any]]:
    """Load local set-printing cards suitable for draft pools."""
    return _load_draft_cards_cached(*_cache_key(_source_path()))


@lru_cache(maxsize=4)
def _load_set_metadata_cached(path: str, _mtime_ns: int) -> dict[str, dict[str, Any]]:
    with Path(path).open("r", encoding="utf-8") as handle:
        sets = json.load(handle)
    return {str(item.get("code", "")).lower(): item for item in sets if item.get("code")}


def load_set_metadata() -> dict[str, dict[str, Any]]:
    if not SETS_METADATA_PATH.exists():
        return {}
    return _load_set_metadata_cached(*_cache_key(SETS_METADATA_PATH))


def _is_released(released_at: str | None) -> bool:
    if not released_at:
        return True
    try:
        return date.fromisoformat(released_at) <= date.today()
    except ValueError:
        return True


def _face_join(card: dict[str, Any], key: str, separator: str) -> str:
    faces = card.get("card_faces") or []
    values = [str(face.get(key) or "").strip() for face in faces if face.get(key)]
    return separator.join(values)


def _display_value(card: dict[str, Any], key: str, separator: str = " // ") -> str:
    value = card.get(key)
    if value:
        return str(value)
    return _face_join(card, key, separator)


def get_draft_set_summaries() -> list[dict[str, Any]]:
    """Return set codes with enough rarity spread to synthesize draft boosters."""
    metadata = load_set_metadata()
    per_set: dict[str, Counter[str]] = defaultdict(Counter)
    set_names: dict[str, str] = {}

    for card in load_draft_cards():
        set_code = str(card.get("set", "")).lower()
        if not set_code:
            continue
        per_set[set_code][str(card.get("rarity", "")).lower()] += 1
        if card.get("set_name"):
            set_names[set_code] = str(card["set_name"])

    summaries: list[dict[str, Any]] = []
    for set_code, counts in per_set.items():
        meta = metadata.get(set_code, {})
        set_type = str(meta.get("set_type") or "").lower()
        if meta:
            if set_type not in DRAFT_SET_TYPES:
                continue
            if meta.get("digital") is True:
                continue
            if not _is_released(meta.get("released_at")):
                continue

        rare_slots = counts["rare"] + counts["mythic"]
        card_count = sum(counts.values())
        if card_count < 80 or counts["common"] < 30 or counts["uncommon"] < 15 or rare_slots < 8:
            continue
        summaries.append({
            "set_code": set_code,
            "set_name": meta.get("name") or set_names.get(set_code, set_code.upper()),
            "set_type": meta.get("set_type") or set_type or "unknown",
            "released_at": meta.get("released_at") or "",
            "card_count": card_count,
            "rarities": dict(counts),
        })

    summaries.sort(key=lambda item: (item["released_at"], item["set_code"]), reverse=True)
    return summaries


def get_cards_for_draft_sets(set_codes: list[str]) -> list[dict[str, Any]]:
    """Return draftable cards from the requested set codes."""
    wanted = {code.lower().strip() for code in set_codes if code.strip()}
    if not wanted:
        return []

    result: list[dict[str, Any]] = []
    for card in load_draft_cards():
        if str(card.get("set", "")).lower() not in wanted:
            continue
        result.append({
            "id": card.get("id", ""),
            "name": card.get("name", ""),
            "set": card.get("set", ""),
            "set_name": card.get("set_name", ""),
            "released_at": card.get("released_at", ""),
            "rarity": card.get("rarity", ""),
            "type_line": _display_value(card, "type_line"),
            "oracle_text": _display_value(card, "oracle_text", "\n//\n"),
            "mana_cost": _display_value(card, "mana_cost"),
            "cmc": card.get("cmc", 0),
            "colors": card.get("colors") or [],
            "color_identity": card.get("color_identity") or [],
            "keywords": card.get("keywords") or [],
            "power": card.get("power"),
            "toughness": card.get("toughness"),
            "image_uris": card.get("image_uris") or {},
            "card_faces": card.get("card_faces") or [],
            "is_basic_land": card.get("name") in BASIC_LANDS,
        })
    return result
