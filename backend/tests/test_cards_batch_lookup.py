"""Tests for browser-engine card lookup aliases."""

from backend.main import _card_lookup_key, _find_card_by_requested_name


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
