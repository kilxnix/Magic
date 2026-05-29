"""Tests for deck URL parser — detect site, extract ID, parse decklist text."""

import pytest
from backend import deck_url_parser
from backend.deck_url_parser import (
    detect_site,
    extract_deck_id,
    fetch_deck_from_url,
    fetch_mtggoldfish,
    parse_decklist_text,
)


class TestDetectSite:
    def test_moxfield(self):
        assert detect_site("https://www.moxfield.com/decks/abc123") == "moxfield"
        assert detect_site("https://moxfield.com/decks/xYz_456") == "moxfield"
        assert detect_site("moxfield.com/decks/xYz_456?foo=bar#deck") == "moxfield"

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
        assert detect_site("https://example.com/?next=https://moxfield.com/decks/abc123") is None
        assert detect_site("javascript:https://moxfield.com/decks/abc123") is None


class TestExtractDeckId:
    def test_moxfield(self):
        assert extract_deck_id("https://moxfield.com/decks/abc123?ref=share", "moxfield") == "abc123"

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

    def test_commander_section_stops_at_category_header(self):
        text = "\n".join([
            "Commander",
            "1 Atraxa, Praetors' Voice",
            "Creatures (2)",
            "1 Birds of Paradise (RVR) 135 *F* # ramp",
            "1x Esper Sentinel [MH2] 12",
            "Sideboard (1)",
            "1 Swords to Plowshares",
        ])
        result = parse_decklist_text(text)
        assert result["commander"] == "Atraxa, Praetors' Voice"
        assert result["cards"] == ["Birds of Paradise", "Esper Sentinel"]

    def test_ignores_companion_and_mtgo_set_prefixes(self):
        text = "\n".join([
            "Deck",
            "1 [C21:267] Sol Ring",
            "Companion",
            "1 Jegantha, the Wellspring",
        ])
        result = parse_decklist_text(text)
        assert result["cards"] == ["Sol Ring"]

    def test_mtggoldfish_one_line_export(self):
        text = "1 Sol Ring 1 Command Tower 1 Y'shtola, Night's Blessed"
        result = parse_decklist_text(text)
        assert result["cards"] == ["Sol Ring", "Command Tower", "Y'shtola, Night's Blessed"]


class TestFetchMTGGoldfish:
    def test_archetype_resolves_download_link_and_commander_hint(self, monkeypatch):
        class FakeResponse:
            def __init__(self, text):
                self.text = text

            def raise_for_status(self):
                return None

        calls = []
        archetype_url = "https://www.mtggoldfish.com/archetype/commander-y-shtola-night-s-blessed"
        download_url = "https://www.mtggoldfish.com/deck/download/7804834"

        def fake_get(url, timeout):
            calls.append(url)
            if url == archetype_url:
                return FakeResponse(
                    "<title>Y&#39;shtola, Night&#39;s Blessed Deck for Magic: the Gathering</title>"
                    '<a href="/deck/download/1111111">Download</a>'
                    '<a href="/deck/download/7804834">Text File (Default)</a>'
                    '<a href="/deck/download/7804834?output=mtggoldfish&amp;type=tabletop">'
                    "Exact Card Versions (Tabletop)</a>"
                )
            if url == download_url:
                return FakeResponse("1 Sol Ring 1 Command Tower 1 Y'shtola, Night's Blessed 1 Spell Pierce")
            raise AssertionError(f"unexpected URL: {url}")

        monkeypatch.setattr(deck_url_parser.requests, "get", fake_get)

        result = fetch_deck_from_url(
            "https://www.mtggoldfish.com/archetype/commander-y-shtola-night-s-blessed#paper"
        )

        assert calls == [archetype_url, download_url]
        assert result["commander"] == "Y'shtola, Night's Blessed"
        assert result["cards"] == ["Sol Ring", "Command Tower", "Spell Pierce"]

    def test_archetype_trims_commander_sideboard_overflow(self, monkeypatch):
        class FakeResponse:
            def __init__(self, text):
                self.text = text

            def raise_for_status(self):
                return None

        def fake_get(url, timeout):
            if "/archetype/" in url:
                return FakeResponse(
                    "<title>Quandrix, the Proof Deck for Magic: the Gathering</title>"
                    '<a href="/deck/download/7803808">Text File</a>'
                )
            if url.endswith("/deck/download/7803808"):
                return FakeResponse("\n".join(["1 Quandrix, the Proof", *[f"1 Testcard{index}" for index in range(1, 112)]]))
            raise AssertionError(f"unexpected URL: {url}")

        monkeypatch.setattr(deck_url_parser.requests, "get", fake_get)

        result = fetch_mtggoldfish("commander-quandrix-the-proof")

        assert result["commander"] == "Quandrix, the Proof"
        assert len(result["cards"]) == 99
        assert "Quandrix, the Proof" not in result["cards"]

    def test_flat_single_line_mtggoldfish_style(self):
        # MTGGoldfish exports are often a single line like:
        # "1 Sol Ring 1 Arcane Signet 10 Forest ..."
        text = "1 Sol Ring 1 Command Tower 2 Forest"
        result = parse_decklist_text(text)
        assert "Sol Ring" in result["cards"]
        assert "Command Tower" in result["cards"]
        assert result["cards"].count("Forest") == 2
