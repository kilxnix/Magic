"""Generate composer training data: full deck generation sequences."""

import json
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
OUTPUT_FILE = DATA_DIR / "composer_train.jsonl"

SYSTEM_PROMPT = (
    "You are an expert MTG Commander deckbuilder. "
    "Build a 99-card deck for the given commander."
)

# Functional role display order (lands are always appended last)
ROLE_ORDER = [
    "ramp",
    "card-draw",
    "removal",
    "board-wipe",
    "counter",
    "tutor",
    "recursion",
    "protection",
    "token",
    "lifegain",
    "sacrifice",
    "utility",
]

ROLE_DISPLAY = {
    "ramp": "Ramp",
    "card-draw": "Card Draw",
    "removal": "Removal",
    "board-wipe": "Board Wipes",
    "counter": "Counterspells",
    "tutor": "Tutors",
    "recursion": "Recursion",
    "protection": "Protection",
    "token": "Token Generators",
    "lifegain": "Lifegain",
    "sacrifice": "Sacrifice",
    "utility": "Synergy / Utility",
}


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


def format_deck_output(cards: List[str], lands: List[str], card_db: Dict[str, Dict]) -> str:
    """Format a deck as a grouped card list for training.

    Non-land cards are categorised by primary functional role using detect_tags /
    get_primary_function.  Cards without a specific role fall into "utility"
    (displayed as "Synergy / Utility").  Cards are sorted alphabetically within
    each section.  Lands form a final section at the end.
    """
    by_role: Dict[str, List[str]] = {}

    for name in cards:
        card = card_db.get(name)
        if not card:
            # Card not found in DB — treat as utility
            by_role.setdefault("utility", []).append(name)
            continue

        oracle = card.get("oracle_text", "")
        type_line = card.get("type_line", "")
        keywords = card.get("keywords", [])
        tags = detect_tags(oracle, type_line, keywords)
        role = get_primary_function(tags)
        by_role.setdefault(role, []).append(name)

    sections: List[str] = []

    for role in ROLE_ORDER:
        card_list = sorted(by_role.get(role, []))
        if card_list:
            display = ROLE_DISPLAY.get(role, role.title())
            sections.append(f"## {display} ({len(card_list)})")
            sections.extend(card_list)

    # Lands section — always last
    sorted_lands = sorted(lands)
    sections.append(f"## Lands ({len(sorted_lands)})")
    sections.extend(sorted_lands)

    return "\n".join(sections)


def prepare_composer_data():
    """Generate composer training sequences from cleaned deck data."""
    if not INPUT_FILE.exists():
        logger.error(
            "Input file not found: %s\n"
            "Run `python -m training.clean_and_enrich` first to generate it.",
            INPUT_FILE,
        )
        sys.exit(1)

    card_db = load_card_database()
    logger.info("Loaded %d cards from %s", len(card_db), CARDS_PATH)

    decks = []
    with open(INPUT_FILE) as f:
        for line in f:
            line = line.strip()
            if line:
                decks.append(json.loads(line))

    logger.info("Generating composer data from %d decks", len(decks))

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

            cmd_identity = commander.get("color_identity", [])
            cmd_colors = "".join(sorted(cmd_identity)) if cmd_identity else "C"
            bracket = deck.get("bracket_estimate", 3)

            cards = deck.get("cards", [])
            lands = deck.get("lands", [])

            deck_output = format_deck_output(cards, lands, card_db)

            user_msg = (
                f"Commander: {commander_name}\n"
                f"Colors: {cmd_colors}\n"
                f"Bracket: {bracket}"
            )

            entry = {
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                    {"role": "assistant", "content": deck_output},
                ]
            }
            out.write(json.dumps(entry) + "\n")
            total += 1

    logger.info(
        "Generated %d composer training examples → %s  (skipped %d decks)",
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
    prepare_composer_data()
