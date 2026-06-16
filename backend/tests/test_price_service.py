# backend/tests/test_price_service.py
"""Tests for the price service module."""

import pytest
import socket
from unittest.mock import patch, MagicMock
from backend.price_service import (
    fetch_mtgjson_prices,
    fetch_card_prices_scryfall,
    get_card_prices,
    get_cheapest_price,
    get_price_category,
)

def _can_reach(host: str, port: int = 443, timeout_s: float = 1.0) -> bool:
    try:
        sock = socket.create_connection((host, port), timeout=timeout_s)
        sock.close()
        return True
    except OSError:
        return False


SCRYFALL_REACHABLE = _can_reach("api.scryfall.com")
requires_scryfall = pytest.mark.skipif(
    not SCRYFALL_REACHABLE,
    reason="Scryfall unreachable (offline/CI sandbox); skipping live-network price tests",
)


class TestFetchMtgjsonPrices:
    """Tests for fetch_mtgjson_prices function."""

    def test_fetch_mtgjson_prices_returns_dict(self):
        """Test that MTGJson price fetch returns a dictionary.

        Note: This test uses mocking because the real AllPrices.json
        file is ~1.4GB and impractical to download in tests.
        """
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "data": {
                "test-uuid-123": {
                    "paper": {
                        "tcgplayer": {
                            "retail": {
                                "normal": {"2026-01-20": 1.50}
                            }
                        }
                    }
                }
            }
        }
        mock_response.raise_for_status = MagicMock()

        with patch("backend.price_service.requests.get", return_value=mock_response):
            with patch("backend.price_service.PRICE_CACHE_PATH") as mock_path:
                mock_path.exists.return_value = False
                result = fetch_mtgjson_prices(force_refresh=True)

        assert isinstance(result, dict)
        assert len(result) > 0
        assert "test-uuid-123" in result


class TestFetchCardPricesScryfall:
    """Tests for Scryfall price fetching (uses real API)."""

    @requires_scryfall
    def test_fetch_scryfall_prices_returns_dict(self):
        """Test that Scryfall price fetch returns price data."""
        result = fetch_card_prices_scryfall("Sol Ring", force_refresh=True)
        assert isinstance(result, dict)
        # Scryfall returns prices with string values
        assert "usd" in result or "eur" in result

    @requires_scryfall
    def test_fetch_scryfall_nonexistent_card(self):
        """Test fetching a nonexistent card returns empty dict."""
        result = fetch_card_prices_scryfall("NonexistentCardXYZ12345", force_refresh=True)
        assert result == {}


class TestScryfallRequestHeaders:
    """Regression tests for the Scryfall 400/500 outage.

    Scryfall rejects the default ``python-requests`` (and empty) User-Agent with
    HTTP 400. That bubbled up unhandled and 500'd the whole alternatives feature.
    """

    def test_scryfall_request_sends_descriptive_user_agent(self):
        import requests as _requests

        captured = {}

        def fake_get(url, **kwargs):
            captured["headers"] = kwargs.get("headers")
            resp = MagicMock()
            resp.raise_for_status = MagicMock()
            resp.json.return_value = {"name": "Sol Ring", "prices": {"usd": "1.00"}}
            return resp

        with patch("backend.price_service.requests.get", side_effect=fake_get):
            with patch("backend.price_service._save_scryfall_cache"):
                fetch_card_prices_scryfall("Sol Ring", force_refresh=True)

        assert captured["headers"], "Scryfall request sent no headers"
        ua = captured["headers"].get("User-Agent", "")
        assert ua and "python-requests" not in ua.lower()

    def test_non_404_http_error_degrades_to_empty_dict(self):
        import requests as _requests

        def fake_get(url, **kwargs):
            resp = MagicMock()
            resp.status_code = 400
            err = _requests.exceptions.HTTPError(response=resp)
            resp.raise_for_status.side_effect = err
            return resp

        with patch("backend.price_service.requests.get", side_effect=fake_get):
            # Must NOT raise — a Scryfall 400 should degrade gracefully.
            result = fetch_card_prices_scryfall("Cultivate", force_refresh=True)
        assert result == {}

    def test_network_error_degrades_to_empty_dict(self):
        import requests as _requests

        def fake_get(url, **kwargs):
            raise _requests.exceptions.ConnectionError("boom")

        with patch("backend.price_service.requests.get", side_effect=fake_get):
            result = fetch_card_prices_scryfall("Cultivate", force_refresh=True)
        assert result == {}


class TestGetCardPrices:
    """Tests for get_card_prices function (uses real Scryfall API)."""

    @requires_scryfall
    def test_get_card_prices_returns_vendor_prices(self):
        """Test getting prices for a specific card."""
        prices = get_card_prices("Sol Ring")
        assert "tcgplayer" in prices or "cardkingdom" in prices
        # At least one vendor should have a USD price for Sol Ring
        assert any(
            p.get("usd") is not None
            for p in prices.values()
            if isinstance(p, dict)
        )

    @requires_scryfall
    def test_get_card_prices_structure(self):
        """Test that get_card_prices returns correct structure."""
        prices = get_card_prices("Lightning Bolt")
        assert "tcgplayer" in prices
        assert "cardkingdom" in prices
        assert "cardmarket" in prices
        assert "usd" in prices["tcgplayer"]
        assert "url" in prices["tcgplayer"]

    @requires_scryfall
    def test_get_card_prices_nonexistent_card(self):
        """Test getting prices for nonexistent card."""
        prices = get_card_prices("NonexistentCardXYZ12345")
        assert prices["tcgplayer"]["usd"] is None
        assert prices["cardkingdom"]["usd"] is None
        assert prices["cardmarket"]["eur"] is None


class TestGetCheapestPrice:
    """Tests for get_cheapest_price function."""

    @requires_scryfall
    def test_get_cheapest_price_sol_ring(self):
        """Test getting cheapest price for a common card."""
        price = get_cheapest_price("Sol Ring")
        assert price is not None
        assert isinstance(price, float)
        assert price > 0

    @requires_scryfall
    def test_get_cheapest_price_nonexistent(self):
        """Test cheapest price for nonexistent card is None."""
        price = get_cheapest_price("NonexistentCardXYZ12345")
        assert price is None


class TestGetPriceCategory:
    """Tests for get_price_category function."""

    def test_price_category_budget(self):
        assert get_price_category(0.50) == "Budget"
        assert get_price_category(0.99) == "Budget"

    def test_price_category_affordable(self):
        assert get_price_category(1.00) == "Affordable"
        assert get_price_category(4.99) == "Affordable"

    def test_price_category_moderate(self):
        assert get_price_category(5.00) == "Moderate"
        assert get_price_category(19.99) == "Moderate"

    def test_price_category_premium(self):
        assert get_price_category(20.00) == "Premium"
        assert get_price_category(49.99) == "Premium"

    def test_price_category_high_end(self):
        assert get_price_category(50.00) == "High-End"
        assert get_price_category(500.00) == "High-End"

    def test_price_category_none(self):
        assert get_price_category(None) == "Unknown"
