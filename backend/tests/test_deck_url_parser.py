"""Tests for deck URL parser — detect site, extract ID, parse decklist text."""

import pytest
from backend.deck_url_parser import detect_site, extract_deck_id, parse_decklist_text


class TestDetectSite:
    def test_moxfield(self):
        assert detect_site("https://www.moxfield.com/decks/abc123") == "moxfield"
        assert detect_site("https://moxfield.com/decks/xYz_456") == "moxfield"

    def test_archidekt(self):
        assert detect_site("https://archidekt.com/decks/12345") == "archidekt"
        assert detect_site("https://www.archidekt.com/decks/12345/my-deck") == "archidekt"

    def test_tappedout(self):
        assert detect_site("https://tappedout.net/mtg-decks/my-cool-deck/") == "tappedout"

    def test_mtggoldfish(self):
        assert detect_site("https://www.mtggoldfish.com/deck/6543210") == "mtggoldfish"
        assert detect_site("https://www.mtggoldfish.com/archetype/standard-mono-red") == "mtggoldfish"

    def test_unknown(self):
        assert detect_site("https://google.com/something") is None


class TestExtractDeckId:
    def test_moxfield(self):
        assert extract_deck_id("https://moxfield.com/decks/abc123", "moxfield") == "abc123"

    def test_archidekt(self):
        assert extract_deck_id("https://archidekt.com/decks/12345/my-deck", "archidekt") == "12345"

    def test_tappedout(self):
        assert extract_deck_id("https://tappedout.net/mtg-decks/my-cool-deck/", "tappedout") == "my-cool-deck"

    def test_mtggoldfish_deck(self):
        assert extract_deck_id("https://www.mtggoldfish.com/deck/6543210", "mtggoldfish") == "6543210"


class TestParseDecklistText:
    def test_basic_list(self):
        text = "1 Sol Ring\n1 Command Tower\n1 Atraxa, Praetors' Voice"
        result = parse_decklist_text(text)
        assert "Sol Ring" in result["cards"]
        assert len(result["cards"]) >= 2

    def test_with_commander_section(self):
        text = "1 Sol Ring\n1 Command Tower\n\nCommander\n1 Atraxa, Praetors' Voice"
        result = parse_decklist_text(text)
        assert result["commander"] == "Atraxa, Praetors' Voice"

    def test_ignores_sideboard(self):
        text = "1 Sol Ring\nSideboard\n1 Swords to Plowshares"
        result = parse_decklist_text(text)
        assert "Swords to Plowshares" not in result["cards"]

    def test_strips_set_codes(self):
        text = "1 Sol Ring (C21) 267"
        result = parse_decklist_text(text)
        assert "Sol Ring" in result["cards"]
