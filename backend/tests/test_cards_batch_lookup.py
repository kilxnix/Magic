"""Tests for browser-engine card lookup aliases."""

import json

from backend.main import _card_lookup_key, _find_card_by_requested_name
from backend.deck_generator import DeckGenerator, CARDS_JSONL_PATH


class FakeGenerator:
    def __init__(self):
        self.card_by_name = {
            "Séance Board": {"name": "Séance Board"},
            "Spring // Mind": {"name": "Spring // Mind"},
            "Waterlogged Teachings // Inundated Archive": {
                "name": "Waterlogged Teachings // Inundated Archive",
                "card_faces": [{"name": "Waterlogged Teachings"}, {"name": "Inundated Archive"}],
            },
        }


def test_card_lookup_key_strips_accents_and_punctuation():
    assert _card_lookup_key("Séance Board") == "seanceboard"
    assert _card_lookup_key("Spring/Mind") == "springmind"


def test_find_card_by_requested_name_matches_goldfish_export_aliases():
    generator = FakeGenerator()

    assert _find_card_by_requested_name(generator, "Seance Board")["name"] == "Séance Board"
    assert _find_card_by_requested_name(generator, "Spring/Mind")["name"] == "Spring // Mind"
    assert _find_card_by_requested_name(generator, "Waterlogged Teachings")["name"] == "Waterlogged Teachings // Inundated Archive"


# --- Regression: token printings must never shadow the real card ---------------
# A "Llanowar Elves" token printing (layout=token, empty mana cost) shadowing the
# real {G} creature caused the engine to load it as a free-to-cast token and
# desync game state. The name index must always prefer the non-token printing.

REAL_LLANOWAR = {
    "name": "Llanowar Elves",
    "layout": "normal",
    "type_line": "Creature — Elf Druid",
    "mana_cost": "{G}",
}
TOKEN_LLANOWAR = {
    "name": "Llanowar Elves",
    "layout": "token",
    "type_line": "Token Creature — Elf Druid",
    "mana_cost": "",
}


def test_build_card_by_name_prefers_real_card_when_token_listed_last():
    index = DeckGenerator._build_card_by_name([REAL_LLANOWAR, TOKEN_LLANOWAR])
    chosen = index["Llanowar Elves"]
    assert chosen["layout"] == "normal"
    assert chosen["mana_cost"] == "{G}"


def test_build_card_by_name_prefers_real_card_when_token_listed_first():
    index = DeckGenerator._build_card_by_name([TOKEN_LLANOWAR, REAL_LLANOWAR])
    chosen = index["Llanowar Elves"]
    assert chosen["layout"] == "normal"
    assert chosen["mana_cost"] == "{G}"


def test_real_card_database_resolves_llanowar_to_castable_creature():
    """Against the shipped card DB, every name that also has a token printing
    must resolve to a real, castable (non-token) card."""
    cards = [json.loads(line) for line in CARDS_JSONL_PATH.open(encoding="utf-8")]
    index = DeckGenerator._build_card_by_name(cards)

    llanowar = index["Llanowar Elves"]
    assert not DeckGenerator._is_token_card(llanowar), "Llanowar Elves resolved to a token printing"
    assert llanowar["mana_cost"] == "{G}"

    # No name that has a real printing should resolve to a token.
    real_names = {c["name"] for c in cards if c.get("name") and not DeckGenerator._is_token_card(c)}
    shadowed = [n for n in real_names if DeckGenerator._is_token_card(index[n])]
    assert shadowed == [], f"{len(shadowed)} real cards shadowed by token printings: {shadowed[:10]}"
