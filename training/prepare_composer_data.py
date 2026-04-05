"""Generate composer training data: full deck generation sequences.

v2 improvements:
  - Theme/strategy derived from the deck's dominant functional tags and
    commander keywords — matches the inference prompt format.
  - User prompt now includes Theme/Strategy field so the model learns
    to condition on it.
"""

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

# Maps MTG keywords found in commander oracle text to human-readable themes.
KEYWORD_THEMES = {
    "proliferate": "+1/+1 counters and proliferate",
    "counter": "+1/+1 counters",
    "+1/+1": "+1/+1 counters",
    "token": "tokens and go-wide",
    "graveyard": "graveyard recursion",
    "sacrifice": "aristocrats and sacrifice",
    "life": "lifegain and drain",
    "mill": "mill",
    "discard": "discard and hand disruption",
    "flash": "flash and instant-speed",
    "flying": "evasion and flying",
    "equipment": "equipment and Voltron",
    "enchant": "enchantress",
    "artifact": "artifacts",
    "tribal": "tribal synergy",
    "enters the battlefield": "ETB triggers and blink",
    "leaves the battlefield": "blink and flicker",
    "whenever": "triggered abilities",
    "combat": "combat tricks",
    "commander damage": "Voltron",
    "spell": "spellslinger",
    "instant": "spellslinger",
    "sorcery": "spellslinger",
    "land": "landfall",
    "landfall": "landfall",
}

# Fallback themes based on dominant functional tag in the deck.
TAG_THEMES = {
    "token": "tokens and go-wide",
    "sacrifice": "aristocrats and sacrifice",
    "recursion": "graveyard recursion",
    "lifegain": "lifegain and drain",
    "counter": "control and counterspells",
    "removal": "removal-heavy control",
    "tutor": "combo and consistency",
    "protection": "pillowfort and protection",
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


def derive_theme(deck: Dict, commander: Dict) -> str:
    """Derive a theme/strategy string from commander text and deck composition."""
    # Try to match commander oracle text to a known theme keyword
    oracle = (commander.get("oracle_text", "") or "").lower()
    for keyword, theme in KEYWORD_THEMES.items():
        if keyword in oracle:
            return theme

    # Fall back to the deck's dominant functional tag (excluding staple roles)
    tags = deck.get("tags", {})
    staple_roles = {"ramp", "card-draw", "removal", "board-wipe", "utility"}
    non_staple = {k: v for k, v in tags.items() if k not in staple_roles and v > 0}

    if non_staple:
        dominant = max(non_staple, key=non_staple.get)
        if dominant in TAG_THEMES:
            return TAG_THEMES[dominant]

    # Fall back to commander type line
    type_line = (commander.get("type_line", "") or "").lower()
    creature_types = type_line.split("—")[-1].strip() if "—" in type_line else ""
    if creature_types and len(creature_types.split()) <= 3:
        return f"{creature_types} synergy"

    return "goodstuff"


def format_deck_output(cards: List[str], lands: List[str], card_db: Dict[str, Dict]) -> str:
    """Format a deck as a grouped card list for training."""
    by_role: Dict[str, List[str]] = {}

    for name in cards:
        card = card_db.get(name)
        if not card:
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
                skipped += 1
                continue

            cmd_identity = commander.get("color_identity", [])
            cmd_colors = "".join(sorted(cmd_identity)) if cmd_identity else "C"
            bracket = deck.get("bracket_estimate", 3)
            theme = derive_theme(deck, commander)

            cards = deck.get("cards", [])
            lands = deck.get("lands", [])

            deck_output = format_deck_output(cards, lands, card_db)

            user_msg = (
                f"Build a 99-card Commander deck for {commander_name}.\n"
                f"Colors: {cmd_colors}\n"
                f"Power Level (Bracket): {bracket}\n"
                f"Theme/Strategy: {theme}\n\n"
                "List cards grouped by category using '## Category (N)' headers. "
                "End with '## Lands (N)' for the land base. "
                "One card per line."
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
        total, OUTPUT_FILE, skipped,
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-8s  %(message)s",
        datefmt="%H:%M:%S",
    )
    prepare_composer_data()
