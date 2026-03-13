"""
Evaluation script for the MTG Commander deck composer model.

Measures model quality against holdout deck data (last 5% of training_decks.jsonl).

Usage:
    python -m training.evaluate

Metrics computed per generated deck vs reference:
    - card_existence:   % of generated card names that exist in the card DB
    - color_compliance: % of generated cards legal for the commander's color identity
    - role_coverage:    does the deck cover ramp, card-draw, and removal?
    - jaccard_overlap:  Jaccard similarity between generated and reference card sets
    - deck_size:        total number of valid cards generated
"""

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Ensure project root is on the path
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.functional_tags import detect_tags

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

CARDS_PATH = Path(__file__).parent.parent / "mtg_data" / "cards_min.jsonl"
TRAINING_DECKS_PATH = Path(__file__).parent.parent / "data" / "training_decks.jsonl"

# ---------------------------------------------------------------------------
# Data loading helpers
# ---------------------------------------------------------------------------


def load_card_db(path: Path) -> Dict[str, dict]:
    """Load cards_min.jsonl into a name -> card-data mapping."""
    db: Dict[str, dict] = {}
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                card = json.loads(line)
            except json.JSONDecodeError:
                continue
            name = card.get("name")
            if name:
                db[name] = card
    return db


def load_training_decks(path: Path) -> List[dict]:
    """Load all deck records from a .jsonl file."""
    decks: List[dict] = []
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                deck = json.loads(line)
            except json.JSONDecodeError:
                continue
            decks.append(deck)
    return decks


# ---------------------------------------------------------------------------
# Metric helpers
# ---------------------------------------------------------------------------


def compute_card_existence(generated_names: List[str], card_db: Dict[str, dict]) -> float:
    """Return fraction of generated names that exist in the card DB."""
    if not generated_names:
        return 0.0
    found = sum(1 for n in generated_names if n in card_db)
    return found / len(generated_names)


def compute_color_compliance(
    generated_names: List[str],
    commander_identity: Set[str],
    card_db: Dict[str, dict],
) -> float:
    """Return fraction of generated cards (that exist in DB) that comply with color identity."""
    existing = [n for n in generated_names if n in card_db]
    if not existing:
        return 0.0
    compliant = 0
    for name in existing:
        card = card_db[name]
        card_identity = set(card.get("color_identity") or [])
        if card_identity.issubset(commander_identity):
            compliant += 1
    return compliant / len(existing)


def compute_role_coverage(
    generated_names: List[str],
    card_db: Dict[str, dict],
) -> bool:
    """Return True if the deck has at least one card for each of ramp, card-draw, removal."""
    required_roles = {"ramp", "card-draw", "removal"}
    covered: Set[str] = set()
    for name in generated_names:
        card = card_db.get(name)
        if card is None:
            continue
        tags = detect_tags(
            oracle_text=card.get("oracle_text", ""),
            type_line=card.get("type_line", ""),
            keywords=card.get("keywords") or [],
        )
        covered |= tags & required_roles
        if covered == required_roles:
            return True
    return False


def compute_jaccard(set_a: Set[str], set_b: Set[str]) -> float:
    """Compute Jaccard similarity between two sets."""
    if not set_a and not set_b:
        return 1.0
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)
    return intersection / union if union > 0 else 0.0


# ---------------------------------------------------------------------------
# Deck generation
# ---------------------------------------------------------------------------


def generate_deck_for_record(
    deck_record: dict,
    card_db: Dict[str, dict],
) -> Optional[List[str]]:
    """
    Generate a deck for a single training record using the model composer.

    Returns a flat list of generated card names (cards + lands), or None on failure.
    """
    from backend.model_composer import get_composer

    commander_name: str = deck_record.get("commander", "")
    bracket: int = deck_record.get("bracket", 2)
    theme: str = deck_record.get("theme", "")

    # Resolve commander color identity from card DB
    commander_card = card_db.get(commander_name)
    colors: List[str] = []
    if commander_card:
        colors = commander_card.get("color_identity") or []

    composer = get_composer()
    try:
        cards, lands = composer.compose_deck(
            commander_name=commander_name,
            colors=colors,
            bracket=bracket,
            theme=theme,
            card_db=card_db,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"  [warn] compose_deck raised {type(exc).__name__}: {exc}")
        return None

    return cards + lands


# ---------------------------------------------------------------------------
# Reference card set extraction
# ---------------------------------------------------------------------------


def reference_card_set(deck_record: dict) -> Set[str]:
    """Extract the set of non-commander card names from a deck record."""
    cards: List[str] = deck_record.get("cards") or []
    lands: List[str] = deck_record.get("lands") or []
    # Some records store a flat 'list' key instead
    if not cards and not lands:
        flat = deck_record.get("list")
        if isinstance(flat, list):
            return set(flat)
        elif isinstance(flat, dict):
            return set(flat.keys())
    return set(cards) | set(lands)


# ---------------------------------------------------------------------------
# Main evaluation loop
# ---------------------------------------------------------------------------


def run_evaluation(max_decks: int = 100) -> None:
    """Run evaluation on the last 5% of training_decks.jsonl."""

    # ── Load card DB ──────────────────────────────────────────────────────
    if not CARDS_PATH.exists():
        print(f"[error] Card database not found at {CARDS_PATH}")
        print("Run: python -m data.data_pipeline download extract embed index")
        sys.exit(1)

    print(f"Loading card database from {CARDS_PATH} ...")
    card_db = load_card_db(CARDS_PATH)
    print(f"  Loaded {len(card_db):,} cards.")

    # ── Load training decks ───────────────────────────────────────────────
    if not TRAINING_DECKS_PATH.exists():
        print(f"[error] Training decks not found at {TRAINING_DECKS_PATH}")
        print("Run the scraping pipeline to generate training_decks.jsonl first.")
        sys.exit(1)

    print(f"Loading training decks from {TRAINING_DECKS_PATH} ...")
    all_decks = load_training_decks(TRAINING_DECKS_PATH)
    total = len(all_decks)
    print(f"  Loaded {total:,} total deck records.")

    # ── Take last 5% as test set ──────────────────────────────────────────
    cutoff = max(1, int(total * 0.05))
    test_decks = all_decks[-cutoff:]
    print(f"  Using last {len(test_decks):,} decks as test set (5%).")

    # Limit to first max_decks for tractable evaluation
    eval_decks = test_decks[:max_decks]
    print(f"  Evaluating first {len(eval_decks)} test decks.\n")

    # ── Try to import the composer ────────────────────────────────────────
    try:
        from backend.model_composer import get_composer  # noqa: F401
        # Trigger a dry-run import to check availability
        _ = get_composer()
    except (ImportError, FileNotFoundError) as exc:
        print("[error] Model not available for evaluation.")
        print(f"  Reason: {exc}")
        print(
            "\nTo use this script, first train and export the Qwen composer model, then "
            "place the GGUF file at:\n"
            "  models/Qwen35/mtg-composer-gguf/*.gguf\n\n"
            "See training/train_composer.py for instructions."
        )
        sys.exit(1)

    # ── Evaluate each deck ────────────────────────────────────────────────
    metrics_list: List[Dict] = []

    for idx, record in enumerate(eval_decks, start=1):
        commander_name = record.get("commander", "<unknown>")
        print(f"[{idx:3d}/{len(eval_decks)}] Commander: {commander_name}")

        # Resolve color identity
        commander_card = card_db.get(commander_name)
        commander_identity: Set[str] = set(
            (commander_card.get("color_identity") or []) if commander_card else []
        )

        # Generate deck using model
        generated = generate_deck_for_record(record, card_db)
        if generated is None:
            print("         [skip] generation failed")
            continue

        # Reference card set
        ref_set = reference_card_set(record)

        # Compute metrics
        existence = compute_card_existence(generated, card_db)
        compliance = compute_color_compliance(generated, commander_identity, card_db)
        coverage = compute_role_coverage(generated, card_db)
        jaccard = compute_jaccard(set(generated), ref_set)
        size = len(generated)

        metrics_list.append(
            {
                "commander": commander_name,
                "card_existence": existence,
                "color_compliance": compliance,
                "role_coverage": coverage,
                "jaccard_overlap": jaccard,
                "deck_size": size,
            }
        )

        print(
            f"         existence={existence:.2%}  compliance={compliance:.2%}  "
            f"coverage={'yes' if coverage else 'no'}  "
            f"jaccard={jaccard:.4f}  size={size}"
        )

    # ── Print summary ─────────────────────────────────────────────────────
    if not metrics_list:
        print("\n[warn] No decks were successfully evaluated.")
        return

    n = len(metrics_list)
    avg_existence = sum(m["card_existence"] for m in metrics_list) / n
    avg_compliance = sum(m["color_compliance"] for m in metrics_list) / n
    avg_coverage = sum(1 for m in metrics_list if m["role_coverage"]) / n
    avg_jaccard = sum(m["jaccard_overlap"] for m in metrics_list) / n
    avg_size = sum(m["deck_size"] for m in metrics_list) / n

    print("\n" + "=" * 60)
    print(f"Evaluation summary  ({n} decks evaluated)")
    print("=" * 60)
    print(f"  card_existence   (avg): {avg_existence:.2%}")
    print(f"  color_compliance (avg): {avg_compliance:.2%}")
    print(f"  role_coverage    (avg): {avg_coverage:.2%}")
    print(f"  jaccard_overlap  (avg): {avg_jaccard:.4f}")
    print(f"  deck_size        (avg): {avg_size:.1f}")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    run_evaluation()
