"""Rules RAG — retrieval-augmented generation for MTG rules questions.

Two knowledge sources:
1. Comprehensive Rules (~940k chars) — indexed by rule number and keywords
2. Card-specific rulings (74k entries) — indexed by card name

When a rules question comes in, we search both sources and inject the
relevant text into the prompt so the model can read and interpret
rather than recall from memory.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

DATA_DIR = Path(__file__).parent.parent.parent / "data"
RULES_FILE = DATA_DIR / "comprehensive_rules.txt"
RULINGS_FILE = DATA_DIR / "rulings_by_card.json"

# Rule section titles for human-readable context
SECTION_NAMES = {
    "1": "Game Concepts",
    "2": "Parts of a Card",
    "3": "Card Types",
    "4": "Zones",
    "5": "Turn Structure",
    "6": "Spells, Abilities, and Effects",
    "7": "Additional Rules",
    "8": "Multiplayer Rules",
    "9": "Casual Variants",
}


class RulesRAG:
    """Search MTG comprehensive rules and card-specific rulings."""

    def __init__(self) -> None:
        self._rules_sections: Dict[str, str] = {}  # "605.1a" → rule text
        self._rules_keywords: Dict[str, List[str]] = {}  # keyword → [rule_numbers]
        self._card_rulings: Dict[str, List[str]] = {}  # card_name → [rulings]
        self._loaded = False

    def _load(self) -> None:
        if self._loaded:
            return
        self._load_comprehensive_rules()
        self._load_card_rulings()
        self._loaded = True

    def _load_comprehensive_rules(self) -> None:
        """Parse comprehensive rules into numbered sections."""
        if not RULES_FILE.exists():
            return

        with open(RULES_FILE, encoding="utf-8") as f:
            text = f.read()

        # Normalize line endings (file may have \r\r\n or \r\n)
        text = text.replace("\r", "")

        # Parse line by line — rules start with a number pattern like "605.1a "
        rule_re = re.compile(r"^(\d{3}\.\d+[a-z]?)\s+(.+)", re.DOTALL)
        current_num = None
        current_text = ""

        for line in text.split("\n"):
            line = line.strip()
            if not line:
                # Save accumulated rule
                if current_num and current_text:
                    self._rules_sections[current_num] = current_text.strip()
                current_num = None
                current_text = ""
                continue

            match = rule_re.match(line)
            if match:
                # Save previous rule
                if current_num and current_text:
                    self._rules_sections[current_num] = current_text.strip()
                current_num = match.group(1)
                current_text = match.group(2)
            elif current_num:
                # Continuation of current rule
                current_text += " " + line

        # Don't forget the last rule
        if current_num and current_text:
            self._rules_sections[current_num] = current_text.strip()

        # Build keyword index
        for rule_num, rule_text in self._rules_sections.items():
            words = set(re.findall(r"\b[a-z]{4,}\b", rule_text.lower()))
            for word in words:
                self._rules_keywords.setdefault(word, []).append(rule_num)

    def _load_card_rulings(self) -> None:
        """Load card-specific rulings from pre-built index."""
        if not RULINGS_FILE.exists():
            return
        with open(RULINGS_FILE, encoding="utf-8") as f:
            self._card_rulings = json.load(f)

    def stats(self) -> Dict[str, int]:
        """Return load stats for debugging."""
        self._load()
        return {
            "rules_sections": len(self._rules_sections),
            "keyword_entries": len(self._rules_keywords),
            "cards_with_rulings": len(self._card_rulings),
        }

    def search_rules(self, query: str, limit: int = 8) -> List[Tuple[str, str]]:
        """Search comprehensive rules by keyword.

        Returns list of (rule_number, rule_text) tuples.
        """
        self._load()

        query_lower = query.lower()
        words = set(re.findall(r"\b[a-z]{4,}\b", query_lower))

        # Score each rule by keyword overlap
        rule_scores: Dict[str, int] = {}
        for word in words:
            for rule_num in self._rules_keywords.get(word, []):
                rule_scores[rule_num] = rule_scores.get(rule_num, 0) + 1

        # Also do direct substring matching for phrases
        key_phrases = [
            "mana ability", "mana abilities", "the stack", "priority",
            "state-based", "legend rule", "legendary", "commander damage",
            "color identity", "combat damage", "first strike", "trample",
            "flash", "hexproof", "indestructible", "shroud", "deathtouch",
            "lifelink", "flying", "reach", "vigilance", "haste",
            "enters the battlefield", "dies", "exile", "graveyard",
            "sacrifice", "discard", "draw", "mulligan", "commander",
            "triggered ability", "activated ability", "static ability",
            "replacement effect", "continuous effect", "layer",
            "copy", "counter", "token", "emblem", "proliferate",
        ]
        for phrase in key_phrases:
            if phrase in query_lower:
                for rule_num, text in self._rules_sections.items():
                    if phrase in text.lower():
                        rule_scores[rule_num] = rule_scores.get(rule_num, 0) + 5

        # Sort by score, return top results
        sorted_rules = sorted(rule_scores.items(), key=lambda x: -x[1])
        results = []
        for rule_num, _score in sorted_rules[:limit]:
            results.append((rule_num, self._rules_sections[rule_num]))
        return results

    def search_by_rule_number(self, rule_num: str) -> Optional[str]:
        """Look up a specific rule by number (e.g., '605.1a')."""
        self._load()
        return self._rules_sections.get(rule_num)

    def search_card_rulings(self, card_name: str) -> List[str]:
        """Get all official rulings for a specific card."""
        self._load()
        return self._card_rulings.get(card_name, [])

    def search_all(self, query: str, card_names: Optional[List[str]] = None,
                   limit: int = 8) -> str:
        """Search both rules and card rulings, return formatted context string."""
        self._load()

        parts: List[str] = []

        # Search comprehensive rules
        rules_hits = self.search_rules(query, limit=limit)
        if rules_hits:
            parts.append("=== Official MTG Rules ===")
            for rule_num, text in rules_hits:
                # Get section name
                section = rule_num.split(".")[0] if "." in rule_num else rule_num[:1]
                section_name = SECTION_NAMES.get(section[:1], "")
                parts.append(f"Rule {rule_num} ({section_name}): {text}")

        # Search card-specific rulings
        if card_names:
            for name in card_names:
                card_rules = self.search_card_rulings(name)
                if card_rules:
                    parts.append(f"\n=== Official Rulings for {name} ===")
                    for ruling in card_rules:
                        parts.append(f"- {ruling}")

        return "\n".join(parts) if parts else ""


# Singleton
_rag: Optional[RulesRAG] = None


def get_rules_rag() -> RulesRAG:
    global _rag
    if _rag is None:
        _rag = RulesRAG()
    return _rag
