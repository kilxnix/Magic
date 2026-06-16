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

        def fake_get(url, timeout=None, headers=None):
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


class _FakeMoxResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError("raise_for_status called on error response")

    def json(self):
        return self._payload


_MOX_OK_PAYLOAD = {
    "boards": {
        "mainboard": {"cards": {"a": {"quantity": 2, "card": {"name": "Sol Ring"}},
                                 "b": {"quantity": 1, "card": {"name": "Command Tower"}}}},
        "commanders": {"cards": {"c": {"card": {"name": "Atraxa, Praetors' Voice"}}}},
    }
}


class TestFetchMoxfieldRetry:
    """Moxfield's Cloudflare intermittently 403s datacenter IPs; the fetch must
    retry through transient 403s instead of failing on the first one."""

    def test_retries_through_transient_403_then_succeeds(self, monkeypatch):
        monkeypatch.setattr(deck_url_parser.time, "sleep", lambda *_a, **_k: None)
        # First two attempts (cloudscraper, then requests) get 403; third succeeds.
        seq = [_FakeMoxResponse(403), _FakeMoxResponse(403),
               _FakeMoxResponse(200, _MOX_OK_PAYLOAD)]
        calls = {"n": 0}

        def next_resp():
            resp = seq[min(calls["n"], len(seq) - 1)]
            calls["n"] += 1
            return resp

        class FakeScraper:
            def get(self, *_a, **_k):
                return next_resp()

        monkeypatch.setattr(deck_url_parser.cloudscraper, "create_scraper", lambda *a, **k: FakeScraper())
        monkeypatch.setattr(deck_url_parser.requests, "get", lambda *a, **k: next_resp())

        result = deck_url_parser.fetch_moxfield("deckid")
        assert calls["n"] >= 3  # retried past the two 403s
        assert result["commander"] == "Atraxa, Praetors' Voice"
        assert result["cards"] == ["Sol Ring", "Sol Ring", "Command Tower"]

    def test_raises_friendly_error_when_all_attempts_blocked(self, monkeypatch):
        monkeypatch.setattr(deck_url_parser.time, "sleep", lambda *_a, **_k: None)

        class BlockedScraper:
            def get(self, *_a, **_k):
                return _FakeMoxResponse(403)

        monkeypatch.setattr(deck_url_parser.cloudscraper, "create_scraper", lambda *a, **k: BlockedScraper())
        monkeypatch.setattr(deck_url_parser.requests, "get", lambda *a, **k: _FakeMoxResponse(403))

        with pytest.raises(ValueError, match="Moxfield blocked this request"):
            deck_url_parser.fetch_moxfield("deckid")

    def test_archetype_trims_commander_sideboard_overflow(self, monkeypatch):
        class FakeResponse:
            def __init__(self, text):
                self.text = text

            def raise_for_status(self):
                return None

        def fake_get(url, timeout=None, headers=None):
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

    def test_deck_partner_commanders_are_removed_from_download_cards(self, monkeypatch):
        class FakeResponse:
            def __init__(self, text):
                self.text = text

            def raise_for_status(self):
                return None

        def fake_get(url, timeout=None, headers=None):
            if url == "https://www.mtggoldfish.com/deck/download/7767508":
                return FakeResponse(
                    "1 Dargo, the Shipwrecker 1 Tymna the Weaver 1 Sol Ring 1 Arcane Signet 97 Swamp"
                )
            if url == "https://www.mtggoldfish.com/deck/7767508":
                return FakeResponse(
                    "Archetype: <a href=\"/archetype/test\">Dargo, the Shipwrecker // Tymna the Weaver</a>"
                )
            raise AssertionError(f"unexpected URL: {url}")

        monkeypatch.setattr(deck_url_parser.requests, "get", fake_get)

        result = fetch_deck_from_url("https://www.mtggoldfish.com/deck/7767508#paper")

        assert result["commander"] == "Dargo, the Shipwrecker // Tymna the Weaver"
        assert "Dargo, the Shipwrecker" not in result["cards"]
        assert "Tymna the Weaver" not in result["cards"]
        assert "Sol Ring" in result["cards"]

    def test_flat_single_line_mtggoldfish_style(self):
        # MTGGoldfish exports are often a single line like:
        # "1 Sol Ring 1 Arcane Signet 10 Forest ..."
        text = "1 Sol Ring 1 Command Tower 2 Forest"
        result = parse_decklist_text(text)
        assert "Sol Ring" in result["cards"]
        assert "Command Tower" in result["cards"]
        assert result["cards"].count("Forest") == 2
