"""Generate scorer training data: card-commander fit rating pairs.

v2 improvements:
  - Color identity violation negatives (scored 0) — teaches the model to reject
    cards outside the commander's color identity.
  - Popularity-based positive scores (7-10 gradient) — cards appearing in many
    decks for the same commander score higher than niche picks.
  - 40/30/30 split: positives / hard negatives (in-identity) / color violations.
"""

import json
import random
import logging
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List, Set

sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.functional_tags import detect_tags, get_primary_function

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent.parent / "data"
CARDS_PATH = Path(__file__).parent.parent / "mtg_data" / "cards_min.jsonl"
INPUT_FILE = DATA_DIR / "training_decks.jsonl"
OUTPUT_FILE = DATA_DIR / "scorer_train.jsonl"

SYSTEM_PROMPT = (
    "You are an MTG Commander deckbuilding expert. "
    "Rate how well a card fits in this commander's deck."
)


def load_card_database() -> Dict[str, Dict]:
    card_db = {}
    with open(CARDS_PATH) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            card = json.loads(line)
            card_db[card["name"]] = card
    return card_db


def card_colors_str(card: Dict) -> str:
    colors = card.get("color_identity", [])
    return "".join(sorted(colors)) if colors else "C"


def build_commander_card_counts(decks: List[Dict]) -> Dict[str, Counter]:
    """Count how many decks each card appears in, per commander."""
    counts: Dict[str, Counter] = {}
    for deck in decks:
        cmd = deck["commander"]
        all_cards = set(deck.get("cards", []) + deck.get("lands", []))
        if cmd not in counts:
            counts[cmd] = Counter()
        for card in all_cards:
            counts[cmd][card] += 1
    return counts


def score_from_popularity(card_name: str, commander: str,
                          cmd_card_counts: Dict[str, Counter],
                          cmd_deck_totals: Dict[str, int]) -> int:
    """Score 7-10 based on how often this card appears across decks for this commander."""
    total_decks = cmd_deck_totals.get(commander, 1)
    appearances = cmd_card_counts.get(commander, Counter()).get(card_name, 0)
    ratio = appearances / total_decks

    if ratio >= 0.5:
        return 10  # staple — in 50%+ of decks for this commander
    elif ratio >= 0.25:
        return 9
    elif ratio >= 0.10:
        return 8
    else:
        return 7   # niche inclusion


def generate_explanation(card: Dict, commander: Dict, score: int) -> str:
    """Generate a brief synergy explanation for training data."""
    card_name = card["name"]
    card_text = card.get("oracle_text", "")
    card_type = card.get("type_line", "")
    cmd_name = commander["name"]

    if score == 0:
        return f"0 - {card_name} has colors outside {cmd_name}'s color identity."

    card_tags = detect_tags(card_text, card_type, card.get("keywords", []))
    primary = get_primary_function(card_tags)

    if score <= 4:
        return (
            f"{score} - {card_name} doesn't synergize strongly "
            f"with {cmd_name}'s strategy."
        )

    role_desc = {
        "removal": "provides removal",
        "ramp": "accelerates mana development",
        "card-draw": "provides card advantage",
        "tutor": "increases consistency",
        "board-wipe": "provides board control",
        "counter": "provides counterspell protection",
        "protection": "protects key pieces",
        "recursion": "provides graveyard recursion",
        "token": "generates tokens",
        "lifegain": "provides life gain",
        "sacrifice": "enables sacrifice synergies",
    }
    role = role_desc.get(primary, "supports the deck's strategy")
    return f"{score} - {card_name} {role} in {cmd_name}."


def make_entry(card_name: str, card: Dict, commander: Dict,
               cmd_colors: str, bracket: int, score: int) -> Dict:
    explanation = generate_explanation(card, commander, score)
    user_msg = (
        f"Commander: {commander['name']} ({cmd_colors})\n"
        f"Bracket: {bracket}\n"
        f"Card: {card_name}\n"
        f"Type: {card.get('type_line', '')}\n"
        f"Cost: {card.get('mana_cost', '')}\n"
        f"Text: {card.get('oracle_text', '')}\n"
        f"Rate this card's fit from 0-10."
    )
    return {
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": explanation},
        ]
    }


def prepare_scorer_data(examples_per_deck: int = 15):
    """Generate scorer training pairs from cleaned deck data.

    Per deck produces up to:
      - 6 positive examples  (cards in the deck, scored 7-10 by popularity)
      - 5 hard negatives      (in color identity but not in deck, scored 1-4)
      - 4 color violations    (outside color identity, scored 0)
    """
    if not INPUT_FILE.exists():
        logger.error(
            "Input file not found: %s\n"
            "Run `python -m training.clean_and_enrich` first to generate it.",
            INPUT_FILE,
        )
        sys.exit(1)

    card_db = load_card_database()
    logger.info("Loaded %d cards from %s", len(card_db), CARDS_PATH)

    # Group cards by color identity for negative sampling
    cards_by_identity: Dict[str, List[str]] = {}
    all_card_names = list(card_db.keys())
    for name, card in card_db.items():
        identity_key = card_colors_str(card)
        cards_by_identity.setdefault(identity_key, []).append(name)

    # Load decks
    decks = []
    with open(INPUT_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                decks.append(json.loads(line))

    # Pre-compute popularity counts across all decks per commander
    cmd_card_counts = build_commander_card_counts(decks)
    cmd_deck_totals: Dict[str, int] = {}
    for deck in decks:
        cmd = deck["commander"]
        cmd_deck_totals[cmd] = cmd_deck_totals.get(cmd, 0) + 1

    logger.info("Generating scorer data from %d decks", len(decks))

    n_pos_target = 6
    n_hard_neg_target = 5
    n_color_viol_target = 4

    total = 0
    skipped = 0
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as out:
        for deck in decks:
            commander_name = deck["commander"]
            commander = card_db.get(commander_name)
            if not commander:
                skipped += 1
                continue

            cmd_identity = set(commander.get("color_identity", []))
            cmd_colors = "".join(sorted(cmd_identity)) if cmd_identity else "C"
            bracket = deck.get("bracket_estimate", 3)
            all_deck_cards = set(deck.get("cards", []) + deck.get("lands", []))

            # --- Positive samples: cards FROM the deck (scored 7-10) ----------
            deck_card_list = [c for c in all_deck_cards if c in card_db]
            n_pos = min(n_pos_target, len(deck_card_list))
            for card_name in random.sample(deck_card_list, n_pos):
                card = card_db[card_name]
                score = score_from_popularity(
                    card_name, commander_name,
                    cmd_card_counts, cmd_deck_totals,
                )
                entry = make_entry(card_name, card, commander,
                                   cmd_colors, bracket, score)
                out.write(json.dumps(entry) + "\n")
                total += 1

            # --- Hard negatives: in color identity, NOT in deck (scored 1-4) --
            eligible_negatives: List[str] = []
            for identity_key, card_names in cards_by_identity.items():
                identity_set = set(identity_key) - {"C"}
                if identity_set.issubset(cmd_identity):
                    eligible_negatives.extend(
                        n for n in card_names if n not in all_deck_cards
                    )

            n_neg = min(n_hard_neg_target, len(eligible_negatives))
            for card_name in random.sample(eligible_negatives, n_neg):
                card = card_db[card_name]
                score = random.randint(1, 4)
                entry = make_entry(card_name, card, commander,
                                   cmd_colors, bracket, score)
                out.write(json.dumps(entry) + "\n")
                total += 1

            # --- Color identity violations: wrong colors (scored 0) -----------
            violation_candidates: List[str] = []
            for identity_key, card_names in cards_by_identity.items():
                identity_set = set(identity_key) - {"C"}
                if identity_set and not identity_set.issubset(cmd_identity):
                    violation_candidates.extend(card_names)

            n_viol = min(n_color_viol_target, len(violation_candidates))
            if n_viol > 0:
                for card_name in random.sample(violation_candidates, n_viol):
                    card = card_db[card_name]
                    entry = make_entry(card_name, card, commander,
                                       cmd_colors, bracket, 0)
                    out.write(json.dumps(entry) + "\n")
                    total += 1

    logger.info(
        "Generated %d scorer training examples → %s  (skipped %d decks)",
        total, OUTPUT_FILE, skipped,
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%H:%M:%S",
    )
    prepare_scorer_data()
