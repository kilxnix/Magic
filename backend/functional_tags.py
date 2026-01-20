"""Detect functional tags from card oracle text."""

import re
from typing import List, Set

FUNCTIONAL_PATTERNS = {
    "removal": [
        r"destroy target (?:creature|artifact|enchantment|permanent|planeswalker)",
        r"destroy all (?:creature|artifact|enchantment|permanent)s",
        r"exile target (?:creature|artifact|enchantment|permanent|planeswalker)",
        r"deals? \d+ damage to (?:target|any|each)",
        r"-\d+/-\d+ until end of turn",
        r"(?:target|that) (?:creature|permanent) gets -\d+/-\d+",
    ],
    "exile": [
        r"exile target",
        r"exile all",
        r"exiles? (?:it|them|that|the)",
    ],
    "ramp": [
        r"add \{[wubrgc]\}",
        r"add \{.\}\{.\}",
        r"add (?:one|two|three|\d+) mana",
        r"add mana of any (?:color|type)",
        r"search your library for (?:a|up to \w+) (?:basic )?land",
        r"put (?:a|that) land (?:card )?(?:onto|into) the battlefield",
        r"you may play an additional land",
    ],
    "card-draw": [
        r"draw (?:a|two|three|\d+) cards?",
        r"draws? (?:a|two|three|\d+) cards?",
        r"look at the top .* put .* (?:into|in) your hand",
    ],
    "tutor": [
        r"search your library for (?:a|an) (?!land)",
        r"search your library for a card",
    ],
    "counter": [
        r"counter target (?:spell|activated ability|triggered ability)",
    ],
    "board-wipe": [
        r"destroy all creatures",
        r"destroy all (?:nonland )?permanents",
        r"exile all creatures",
        r"(?:each|all) creatures? get -\d+/-\d+",
        r"deals? \d+ damage to each creature",
    ],
    "protection": [
        r"hexproof",
        r"indestructible",
        r"shroud",
        r"protection from",
        r"can't be (?:countered|targeted|blocked)",
    ],
    "recursion": [
        r"return (?:target|a) .* from (?:your|a) graveyard",
        r"put .* from (?:your|a) graveyard .* (?:onto|into)",
    ],
    "sacrifice": [
        r"sacrifice (?:a|an|target)",
        r"(?:target|each) player sacrifices",
    ],
    "lifegain": [
        r"gain (?:\d+|x) life",
        r"gains? life equal to",
        r"lifelink",
    ],
    "token": [
        r"create (?:a|\d+|x) .* tokens?",
        r"put (?:a|\d+|x) .* tokens? onto the battlefield",
    ],
    "instant-speed": [
        r"flash",
        # Note: This tag is also set based on card type "Instant"
    ],
}


def detect_tags(oracle_text: str, type_line: str = "", keywords: List[str] = None) -> Set[str]:
    """
    Detect functional tags from a card's oracle text and type line.

    Args:
        oracle_text: The card's oracle text
        type_line: The card's type line (e.g., "Instant", "Creature — Elf")
        keywords: List of keywords from the card

    Returns:
        Set of functional tag strings
    """
    tags = set()
    text_lower = oracle_text.lower()
    type_lower = type_line.lower()
    keywords = keywords or []

    # Check each pattern category
    for tag, patterns in FUNCTIONAL_PATTERNS.items():
        for pattern in patterns:
            if re.search(pattern, text_lower, re.IGNORECASE):
                tags.add(tag)
                break

    # Add instant-speed tag for instants
    if "instant" in type_lower:
        tags.add("instant-speed")

    # Check keywords
    keyword_tags = {
        "flash": "instant-speed",
        "lifelink": "lifegain",
        "hexproof": "protection",
        "indestructible": "protection",
    }
    for kw in keywords:
        kw_lower = kw.lower()
        if kw_lower in keyword_tags:
            tags.add(keyword_tags[kw_lower])

    return tags


def get_primary_function(tags: Set[str]) -> str:
    """Get the primary function of a card from its tags."""
    # Priority order for primary function
    priority = [
        "board-wipe", "removal", "counter", "ramp",
        "card-draw", "tutor", "recursion", "token",
        "protection", "lifegain", "sacrifice"
    ]

    for func in priority:
        if func in tags:
            return func

    return "utility"
