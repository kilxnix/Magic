"""
Training data cleaning and enrichment pipeline.

Loads raw Commander decklists from Moxfield, Archidekt, and EDHREC scrapers,
validates and cleans each deck, enriches with bracket estimates and functional
tags, deduplicates similar decks, and writes to data/training_decks.jsonl.

Usage:
    python -m training.clean_and_enrich
"""

import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Allow imports from project root (backend/)
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.functional_tags import detect_tags, get_primary_function
from backend.rules import (
    COMMANDER_BANNED_CARDS,
    COMBO_CARDS,
    EXTRA_TURN_SPELLS,
    GAME_CHANGER_CARDS,
    TUTOR_CARDS,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CARDS_JSONL = PROJECT_ROOT / "mtg_data" / "cards_min.jsonl"
OUTPUT_JSONL = PROJECT_ROOT / "data" / "training_decks.jsonl"

RAW_SOURCES: List[Tuple[str, Path]] = [
    ("moxfield", PROJECT_ROOT / "data" / "raw_moxfield_decks.jsonl"),
    ("archidekt", PROJECT_ROOT / "data" / "raw_archidekt_decks.jsonl"),
    ("edhrec", PROJECT_ROOT / "data" / "raw_edhrec_decks.jsonl"),
]

# Deduplication threshold: decks with Jaccard similarity above this are dupes
JACCARD_THRESHOLD = 0.90

# Minimum fraction of card names that must resolve in the card database
MIN_RESOLUTION_RATE = 0.95

# Minimum total card count (cards + lands) to accept a deck
MIN_TOTAL_CARDS = 98

# Fast-mana cards used in bracket estimation
FAST_MANA_CARDS: Set[str] = {
    "Sol Ring", "Mana Crypt", "Mana Vault", "Grim Monolith",
    "Chrome Mox", "Mox Diamond", "Jeweled Lotus", "Lion's Eye Diamond",
    "Mox Emerald", "Mox Jet", "Mox Pearl", "Mox Ruby", "Mox Sapphire",
    "Ancient Tomb", "Mishra's Workshop", "Lotus Petal",
}

# ---------------------------------------------------------------------------
# Card database loading
# ---------------------------------------------------------------------------


def load_card_database(path: Path) -> Tuple[Dict[str, dict], Set[str]]:
    """
    Load cards_min.jsonl and return:
      - card_db: mapping of lowercased name -> card dict
      - valid_commanders: set of canonical card names that are Legendary
        Creatures or Legendary Planeswalkers (commander-legal)
    """
    card_db: Dict[str, dict] = {}
    valid_commanders: Set[str] = set()

    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            card = json.loads(line)
            name: str = card.get("name", "")
            if not name:
                continue

            card_db[name.lower()] = card

            type_line: str = card.get("type_line", "")
            is_legendary = "Legendary" in type_line
            is_creature = "Creature" in type_line
            is_planeswalker = "Planeswalker" in type_line

            if is_legendary and (is_creature or is_planeswalker):
                valid_commanders.add(name)

    return card_db, valid_commanders


# ---------------------------------------------------------------------------
# Deck loading
# ---------------------------------------------------------------------------


def load_raw_decks(sources: List[Tuple[str, Path]]) -> List[dict]:
    """Load decks from all raw JSONL files, skipping files that don't exist."""
    decks: List[dict] = []
    for source_name, path in sources:
        if not path.exists():
            print(f"  [skip] {path.name} — file not found")
            continue
        count = 0
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                deck = json.loads(line)
                # Ensure source field is set correctly
                deck.setdefault("source", source_name)
                decks.append(deck)
                count += 1
        print(f"  [load] {path.name}: {count} decks")
    return decks


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def validate_deck(
    deck: dict,
    card_db: Dict[str, dict],
    valid_commanders: Set[str],
) -> Tuple[bool, str]:
    """
    Validate a raw deck record.

    Returns (is_valid, reason_if_invalid).
    """
    commander: Optional[str] = deck.get("commander")
    if not commander:
        return False, "missing commander"

    # Commander must be in the valid commanders set
    if commander not in valid_commanders:
        return False, f"invalid commander: {commander!r}"

    # Commander must not be banned
    if commander in COMMANDER_BANNED_CARDS:
        return False, f"banned commander: {commander!r}"

    cards: List[str] = deck.get("cards", [])
    lands: List[str] = deck.get("lands", [])
    total = len(cards) + len(lands)

    if total < MIN_TOTAL_CARDS:
        return False, f"too few cards: {total} < {MIN_TOTAL_CARDS}"

    # Check card resolution rate against database
    all_cards = cards + lands
    if all_cards:
        resolved = sum(1 for c in all_cards if c.lower() in card_db)
        resolution_rate = resolved / len(all_cards)
        if resolution_rate < MIN_RESOLUTION_RATE:
            return False, (
                f"low card resolution: {resolution_rate:.1%} "
                f"({resolved}/{len(all_cards)})"
            )

    return True, ""


# ---------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------


def clean_deck(deck: dict, card_db: Dict[str, dict]) -> dict:
    """
    Remove cards not present in the card database.
    Returns a new deck dict with cleaned card lists.
    """
    cleaned_cards = [c for c in deck.get("cards", []) if c.lower() in card_db]
    cleaned_lands = [c for c in deck.get("lands", []) if c.lower() in card_db]
    return {**deck, "cards": cleaned_cards, "lands": cleaned_lands}


# ---------------------------------------------------------------------------
# Bracket estimation
# ---------------------------------------------------------------------------


def estimate_bracket(deck: dict, card_db: Dict[str, dict]) -> int:
    """
    Estimate the power bracket (1-5) of a deck based on its contents.

    Scoring heuristic:
      +1 per game changer (max 3 pts)
      +1 per tutor (max 2 pts)
      +1 if combo pieces are present (two or more matching combo partners)
      +1 per extra-turn spell (max 1 pt)
      +1 per fast-mana card (max 2 pts)
      +0.1 per CMC point below 3.5 average (for avg CMC < 3.5)

    Score -> bracket:
      0-1   -> 1
      2-3   -> 2
      4-5   -> 3
      6-7   -> 4
      8+    -> 5
    """
    all_cards = set(deck.get("cards", [])) | set(deck.get("lands", []))
    score = 0.0

    # Game changers (cap at 3)
    gc_count = sum(1 for c in all_cards if c in GAME_CHANGER_CARDS)
    score += min(gc_count, 3)

    # Tutors (cap at 2)
    tutor_count = sum(1 for c in all_cards if c in TUTOR_CARDS)
    score += min(tutor_count, 2)

    # Combo presence: count distinct combo pairs present in deck
    combo_found = False
    for card_name, partners in COMBO_CARDS.items():
        if card_name in all_cards:
            for partner in partners:
                if partner in all_cards:
                    combo_found = True
                    break
        if combo_found:
            break
    if combo_found:
        score += 1

    # Extra turns (cap at 1)
    et_count = sum(1 for c in all_cards if c in EXTRA_TURN_SPELLS)
    score += min(et_count, 1)

    # Fast mana (cap at 2)
    fast_count = sum(1 for c in all_cards if c in FAST_MANA_CARDS)
    score += min(fast_count, 2)

    # Average CMC bonus: low avg CMC suggests a fast, optimized deck
    cmcs = []
    for card_name in all_cards:
        card_data = card_db.get(card_name.lower())
        if card_data:
            try:
                cmcs.append(float(card_data.get("cmc", 0)))
            except (TypeError, ValueError):
                pass
    if cmcs:
        avg_cmc = sum(cmcs) / len(cmcs)
        if avg_cmc < 3.5:
            score += (3.5 - avg_cmc) * 0.1

    # Map score to bracket
    if score < 2:
        return 1
    elif score < 4:
        return 2
    elif score < 6:
        return 3
    elif score < 8:
        return 4
    else:
        return 5


# ---------------------------------------------------------------------------
# Tag enrichment
# ---------------------------------------------------------------------------


def build_tags(deck: dict, card_db: Dict[str, dict]) -> Dict[str, int]:
    """
    Count cards by their primary functional role.

    Returns a dict like {"ramp": 12, "removal": 8, "card-draw": 7, ...}
    """
    tag_counts: Dict[str, int] = defaultdict(int)
    all_cards = deck.get("cards", []) + deck.get("lands", [])

    for card_name in all_cards:
        card_data = card_db.get(card_name.lower())
        if not card_data:
            continue
        oracle_text = card_data.get("oracle_text", "") or ""
        type_line = card_data.get("type_line", "") or ""
        keywords = card_data.get("keywords", []) or []

        tags = detect_tags(oracle_text, type_line, keywords)
        primary = get_primary_function(tags)
        tag_counts[primary] += 1

    return dict(tag_counts)


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------


def jaccard_similarity(set_a: Set[str], set_b: Set[str]) -> float:
    """Compute Jaccard similarity between two card sets."""
    if not set_a and not set_b:
        return 1.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union else 0.0


def deduplicate_decks(decks: List[dict]) -> Tuple[List[dict], int]:
    """
    Remove decks that are >90% Jaccard-similar to an already-kept deck.

    Returns (deduplicated_decks, number_removed).
    """
    kept: List[dict] = []
    kept_card_sets: List[Set[str]] = []
    removed_count = 0

    for deck in decks:
        card_set = set(deck.get("cards", [])) | set(deck.get("lands", []))
        is_duplicate = False
        for existing_set in kept_card_sets:
            if jaccard_similarity(card_set, existing_set) > JACCARD_THRESHOLD:
                is_duplicate = True
                break
        if is_duplicate:
            removed_count += 1
        else:
            kept.append(deck)
            kept_card_sets.append(card_set)

    return kept, removed_count


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def run_pipeline() -> None:
    print("=" * 60)
    print("Commander Training Data: Clean & Enrich Pipeline")
    print("=" * 60)

    # 1. Load card database
    print(f"\nLoading card database from {CARDS_JSONL.name}...")
    card_db, valid_commanders = load_card_database(CARDS_JSONL)
    print(f"  {len(card_db):,} cards loaded, {len(valid_commanders):,} valid commanders")

    # 2. Load raw decks from all sources
    print("\nLoading raw decks...")
    raw_decks = load_raw_decks(RAW_SOURCES)
    print(f"  Total raw decks: {len(raw_decks)}")

    # 3. Validate and clean
    print("\nValidating and cleaning decks...")
    filtered_reasons: Dict[str, int] = defaultdict(int)
    cleaned_decks: List[dict] = []

    for deck in raw_decks:
        is_valid, reason = validate_deck(deck, card_db, valid_commanders)
        if not is_valid:
            # Bucket the reason by first word for summary
            bucket = reason.split(":")[0].strip()
            filtered_reasons[bucket] += 1
            continue
        cleaned_decks.append(clean_deck(deck, card_db))

    n_filtered = len(raw_decks) - len(cleaned_decks)
    print(f"  Passed validation: {len(cleaned_decks)} / {len(raw_decks)}")
    if filtered_reasons:
        print("  Filter breakdown:")
        for reason, count in sorted(filtered_reasons.items(), key=lambda x: -x[1]):
            print(f"    {reason}: {count}")

    # 4. Enrich with bracket estimates and tags
    print("\nEnriching decks with brackets and functional tags...")
    enriched_decks: List[dict] = []
    for deck in cleaned_decks:
        bracket = estimate_bracket(deck, card_db)
        tags = build_tags(deck, card_db)
        enriched = {
            "commander": deck.get("commander"),
            "partner": deck.get("partner"),
            "cards": deck.get("cards", []),
            "lands": deck.get("lands", []),
            "tags": tags,
            "bracket_estimate": bracket,
            "source": deck.get("source", "unknown"),
        }
        enriched_decks.append(enriched)

    # 5. Deduplicate
    print("\nDeduplicating similar decks (Jaccard > 90%)...")
    final_decks, n_dupes = deduplicate_decks(enriched_decks)
    print(f"  Removed {n_dupes} duplicate decks")
    print(f"  Final deck count: {len(final_decks)}")

    # 6. Write output
    OUTPUT_JSONL.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_JSONL, "w", encoding="utf-8") as fh:
        for deck in final_decks:
            fh.write(json.dumps(deck, ensure_ascii=False) + "\n")
    print(f"\nWrote {len(final_decks)} decks to {OUTPUT_JSONL}")

    # 7. Summary statistics
    print("\n" + "=" * 60)
    print("Summary Statistics")
    print("=" * 60)
    print(f"  Raw decks loaded:      {len(raw_decks):>6}")
    print(f"  Failed validation:     {n_filtered:>6}")
    print(f"  Duplicates removed:    {n_dupes:>6}")
    print(f"  Final training decks:  {len(final_decks):>6}")

    # Bracket distribution
    bracket_dist: Dict[int, int] = defaultdict(int)
    for deck in final_decks:
        bracket_dist[deck["bracket_estimate"]] += 1
    print("\n  Bracket distribution:")
    bracket_names = {1: "Exhibition", 2: "Core", 3: "Upgraded", 4: "Optimized", 5: "cEDH"}
    for b in range(1, 6):
        count = bracket_dist.get(b, 0)
        pct = 100 * count / len(final_decks) if final_decks else 0
        bar = "#" * (count // max(1, len(final_decks) // 40))
        print(f"    Bracket {b} ({bracket_names[b]:<10}): {count:>5}  ({pct:5.1f}%)  {bar}")

    # Source distribution
    source_dist: Dict[str, int] = defaultdict(int)
    for deck in final_decks:
        source_dist[deck["source"]] += 1
    print("\n  Source distribution:")
    for source, count in sorted(source_dist.items(), key=lambda x: -x[1]):
        pct = 100 * count / len(final_decks) if final_decks else 0
        print(f"    {source:<12}: {count:>5}  ({pct:5.1f}%)")

    print("=" * 60)


if __name__ == "__main__":
    run_pipeline()
