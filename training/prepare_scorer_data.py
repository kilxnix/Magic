"""Generate scorer training data: card-commander fit rating pairs."""

import json
import random
import logging
import sys
from pathlib import Path
from typing import Dict, List

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
    return "".join(colors) if colors else "C"


def generate_explanation(card: Dict, commander: Dict, is_positive: bool) -> str:
    """Generate a brief synergy explanation for training data."""
    card_name = card["name"]
    card_text = card.get("oracle_text", "")
    card_type = card.get("type_line", "")
    cmd_name = commander["name"]

    card_tags = detect_tags(card_text, card_type, card.get("keywords", []))
    primary = get_primary_function(card_tags)

    if not is_positive:
        card_identity = set(card.get("color_identity", []))
        cmd_identity = set(commander.get("color_identity", []))
        if not card_identity.issubset(cmd_identity):
            return f"0 - {card_name} has colors outside {cmd_name}'s color identity."
        return (
            f"{random.randint(1, 4)} - "
            f"{card_name} doesn't synergize strongly with {cmd_name}'s strategy."
        )

    score = random.randint(7, 10)
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


def prepare_scorer_data(examples_per_deck: int = 10):
    """Generate scorer training pairs from cleaned deck data."""
    if not INPUT_FILE.exists():
        logger.error(
            "Input file not found: %s\n"
            "Run `python -m training.clean_and_enrich` first to generate it.",
            INPUT_FILE,
        )
        sys.exit(1)

    card_db = load_card_database()
    logger.info("Loaded %d cards from %s", len(card_db), CARDS_PATH)

    # Group cards by color identity string for negative sampling.
    # Key is a sorted string of color letters, e.g. "BGU", or "C" for colorless.
    cards_by_identity: Dict[str, List[str]] = {}
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

    logger.info("Generating scorer data from %d decks", len(decks))

    total = 0
    skipped = 0
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as out:
        for deck in decks:
            commander_name = deck["commander"]
            commander = card_db.get(commander_name)
            if not commander:
                logger.debug("Commander not found in card DB: %s", commander_name)
                skipped += 1
                continue

            cmd_identity = set(commander.get("color_identity", []))
            cmd_colors = "".join(sorted(cmd_identity)) if cmd_identity else "C"
            bracket = deck.get("bracket_estimate", 3)

            all_deck_cards = set(deck.get("cards", []) + deck.get("lands", []))

            # --- Positive samples: cards FROM the deck -----------------------
            deck_card_list = list(all_deck_cards)
            n_pos = min(examples_per_deck // 2, len(deck_card_list))
            pos_samples = random.sample(deck_card_list, n_pos)

            for card_name in pos_samples:
                card = card_db.get(card_name)
                if not card:
                    continue

                explanation = generate_explanation(card, commander, is_positive=True)
                user_msg = (
                    f"Commander: {commander_name} ({cmd_colors})\n"
                    f"Bracket: {bracket}\n"
                    f"Card: {card_name}\n"
                    f"Type: {card.get('type_line', '')}\n"
                    f"Cost: {card.get('mana_cost', '')}\n"
                    f"Text: {card.get('oracle_text', '')}\n"
                    f"Rate this card's fit from 0-10."
                )

                entry = {
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                        {"role": "assistant", "content": explanation},
                    ]
                }
                out.write(json.dumps(entry) + "\n")
                total += 1

            # --- Hard negatives: same color identity, NOT in deck ------------
            eligible_negatives: List[str] = []
            for identity_key, card_names in cards_by_identity.items():
                # Parse the identity key back into a set of colour letters.
                # "C" means colorless — issubset of any identity.
                identity_set = set(identity_key) - {"C"}
                if identity_set.issubset(cmd_identity):
                    eligible_negatives.extend(
                        n for n in card_names if n not in all_deck_cards
                    )

            n_neg = min(examples_per_deck // 2, len(eligible_negatives))
            neg_samples = random.sample(eligible_negatives, n_neg)

            for card_name in neg_samples:
                card = card_db.get(card_name)
                if not card:
                    continue

                explanation = generate_explanation(card, commander, is_positive=False)
                user_msg = (
                    f"Commander: {commander_name} ({cmd_colors})\n"
                    f"Bracket: {bracket}\n"
                    f"Card: {card_name}\n"
                    f"Type: {card.get('type_line', '')}\n"
                    f"Cost: {card.get('mana_cost', '')}\n"
                    f"Text: {card.get('oracle_text', '')}\n"
                    f"Rate this card's fit from 0-10."
                )

                entry = {
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                        {"role": "assistant", "content": explanation},
                    ]
                }
                out.write(json.dumps(entry) + "\n")
                total += 1

    logger.info(
        "Generated %d scorer training examples → %s  (skipped %d decks)",
        total,
        OUTPUT_FILE,
        skipped,
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%H:%M:%S",
    )
    prepare_scorer_data()
