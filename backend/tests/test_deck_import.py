"""Tests for Commander deck import parsing/validation helpers."""

from backend.agent.deck_import import parse_decklist, validate_deck


def test_parse_decklist_accepts_flat_single_line_exports():
    # MTGGoldfish exports are frequently a single line.
    text = "Commander 1 Test Commander Deck 1 Sol Ring 98 Forest"
    parsed = parse_decklist(text)

    assert parsed["commander"] == "Test Commander"
    assert parsed["cards"] == ["Sol Ring"]
    assert len(parsed["lands"]) == 98
    assert parsed["total"] == 100


def test_validate_deck_minimal_mode_without_card_db():
    text = "Commander 1 Test Commander Deck 1 Sol Ring 98 Forest"
    parsed = parse_decklist(text)
    result = validate_deck(parsed, card_db={})

    assert result["valid"] is True
    assert result["missing_slots"] == 0
    assert any("Card database unavailable" in w for w in result["warnings"])

