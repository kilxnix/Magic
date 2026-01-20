# backend/tests/test_functional_tags.py
import pytest
from backend.functional_tags import detect_tags, FUNCTIONAL_PATTERNS

def test_detect_removal_tag():
    """Destroy target creature should be tagged as removal."""
    oracle_text = "Destroy target creature."
    tags = detect_tags(oracle_text)
    assert "removal" in tags

def test_detect_ramp_tag_mana():
    """Add {G} should be tagged as ramp."""
    oracle_text = "{T}: Add {G}."
    tags = detect_tags(oracle_text)
    assert "ramp" in tags

def test_detect_ramp_tag_search_land():
    """Search library for land should be tagged as ramp."""
    oracle_text = "Search your library for a basic land card and put it onto the battlefield tapped."
    tags = detect_tags(oracle_text)
    assert "ramp" in tags

def test_detect_card_draw():
    """Draw a card should be tagged as card-draw."""
    oracle_text = "Target player draws two cards."
    tags = detect_tags(oracle_text)
    assert "card-draw" in tags

def test_detect_multiple_tags():
    """Card with multiple effects gets multiple tags."""
    oracle_text = "Destroy target creature. Draw a card."
    tags = detect_tags(oracle_text)
    assert "removal" in tags
    assert "card-draw" in tags

def test_detect_exile_removal():
    """Exile target should be tagged as removal and exile."""
    oracle_text = "Exile target creature."
    tags = detect_tags(oracle_text)
    assert "removal" in tags
    assert "exile" in tags
