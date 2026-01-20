# backend/tests/test_database_prices.py
"""Tests for price history database functions."""

import pytest
from backend.database import (
    init_price_history_db,
    save_price_history,
    get_price_history,
    get_latest_prices
)


def test_save_and_retrieve_price_history():
    """Test saving and retrieving price history."""
    init_price_history_db()

    save_price_history("Sol Ring", "tcgplayer", 2.50)
    save_price_history("Sol Ring", "cardkingdom", 2.99)

    history = get_price_history("Sol Ring", "tcgplayer", limit=10)
    assert len(history) >= 1
    assert history[0]['price_usd'] == 2.50


def test_get_latest_prices():
    """Test getting latest prices for a card."""
    init_price_history_db()

    save_price_history("Lightning Bolt", "tcgplayer", 1.50)
    save_price_history("Lightning Bolt", "cardkingdom", 1.75)

    latest = get_latest_prices("Lightning Bolt")
    assert "tcgplayer" in latest
    assert "cardkingdom" in latest
