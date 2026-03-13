# backend/tests/test_model_composer.py
"""Tests for the DeckComposer module."""

import pytest

from backend.model_composer import DeckComposer


class TestParseModelOutput:
    """Tests for DeckComposer._parse_model_output (static method)."""

    def test_parse_model_output_valid(self):
        """Parse well-formed output with ## section headers."""
        output = (
            "## Ramp (5)\n"
            "Sol Ring\n"
            "Arcane Signet\n"
            "Cultivate\n"
            "Kodama's Reach\n"
            "Farseek\n"
            "## Removal (3)\n"
            "Swords to Plowshares\n"
            "Path to Exile\n"
            "Counterspell\n"
            "## Lands (3)\n"
            "Command Tower\n"
            "Exotic Orchard\n"
            "Forest\n"
        )

        cards, lands = DeckComposer._parse_model_output(output)

        assert "Sol Ring" in cards
        assert "Arcane Signet" in cards
        assert "Cultivate" in cards
        assert "Kodama's Reach" in cards
        assert "Farseek" in cards
        assert "Swords to Plowshares" in cards
        assert "Path to Exile" in cards
        assert "Counterspell" in cards

        assert "Command Tower" in lands
        assert "Exotic Orchard" in lands
        assert "Forest" in lands

        # Nothing should bleed across lists
        assert "Command Tower" not in cards
        assert "Sol Ring" not in lands

    def test_parse_model_output_handles_junk(self):
        """Ignore non-card lines: headers, bullets, long lines, numbered prefixes."""
        output = (
            "## Creatures (2)\n"
            "1. Elvish Mystic\n"            # numbered prefix stripped
            "2. Birds of Paradise\n"        # numbered prefix stripped
            "* This is a note\n"            # bullet — skipped
            "- Another note\n"              # dash — skipped
            "This line is way too long and should be skipped because it "
            "exceeds eighty characters in total length and is clearly not a card name.\n"
            "## Lands (1)\n"
            "1) Breeding Pool\n"            # numbered with ) stripped
        )

        cards, lands = DeckComposer._parse_model_output(output)

        assert "Elvish Mystic" in cards
        assert "Birds of Paradise" in cards
        assert "Breeding Pool" in lands

        # Junk lines must not appear
        for item in cards + lands:
            assert not item.startswith("*")
            assert not item.startswith("-")
            assert len(item) <= 80


class TestValidateCards:
    """Tests for DeckComposer._validate_cards (static method)."""

    def test_validate_cards_filters_invalid(self):
        """Remove cards not in card_db or with wrong color identity."""
        card_db = {
            "Sol Ring": {"color_identity": []},
            "Lightning Bolt": {"color_identity": ["R"]},
            "Counterspell": {"color_identity": ["U"]},
            "Breeding Pool": {"color_identity": []},
            "Unknown Island": None,  # not in db at all
        }
        # Rebuild as a proper lookup (None values mean absent)
        card_db = {k: v for k, v in card_db.items() if v is not None}

        commander_identity = ["R"]  # Mono-red commander

        cards = [
            "Sol Ring",         # colorless — valid
            "Lightning Bolt",   # R — valid
            "Counterspell",     # U — INVALID (not in R identity)
            "Ghost Card",       # not in db — INVALID
        ]
        lands = [
            "Breeding Pool",    # in db — valid (lands skip identity check)
            "Missing Land",     # not in db — INVALID
        ]

        valid_cards, valid_lands = DeckComposer._validate_cards(
            cards, lands, card_db, commander_identity
        )

        assert "Sol Ring" in valid_cards
        assert "Lightning Bolt" in valid_cards
        assert "Counterspell" not in valid_cards
        assert "Ghost Card" not in valid_cards

        assert "Breeding Pool" in valid_lands
        assert "Missing Land" not in valid_lands


class TestBuildPrompt:
    """Tests for DeckComposer._build_prompt (static method)."""

    def test_build_prompt(self):
        """Verify prompt contains commander, colors, bracket, and theme."""
        prompt = DeckComposer._build_prompt(
            commander_name="Atraxa, Praetors' Voice",
            colors=["W", "U", "B", "G"],
            bracket=3,
            theme="proliferate counters",
        )

        assert "Atraxa, Praetors' Voice" in prompt
        assert "WUBG" in prompt
        assert "3" in prompt
        assert "proliferate counters" in prompt
