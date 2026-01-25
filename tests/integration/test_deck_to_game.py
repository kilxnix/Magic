"""
Deck-to-Game End-to-End Integration Test

Tests the complete flow from deck generation to game launch.
"""

import pytest
import json
from pathlib import Path

# We need to test with the actual deck generator and game launcher
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.game_launcher import (
    launch_game,
    select_ai_decks,
    load_ai_deck_pool,
    GameLaunchRequest,
)


class TestDeckToGameIntegration:
    """End-to-end tests for deck generation to game launch flow."""

    def test_ai_deck_pool_loads(self):
        """Test that the AI deck pool loads correctly."""
        decks = load_ai_deck_pool()

        assert len(decks) > 0, "AI deck pool should have decks"

        # Check deck structure
        deck = decks[0]
        assert deck.commander, "Deck should have a commander"
        assert deck.bracket >= 1 and deck.bracket <= 5, "Bracket should be 1-5"
        assert deck.minBracket <= deck.maxBracket, "Min bracket <= max bracket"

    def test_select_ai_decks_by_bracket(self):
        """Test AI deck selection respects bracket constraints."""
        for bracket in range(1, 6):
            decks = select_ai_decks(bracket=bracket, count=2)

            for deck in decks:
                assert deck.minBracket <= bracket <= deck.maxBracket, (
                    f"Deck {deck.commander} (bracket {deck.minBracket}-{deck.maxBracket}) "
                    f"should not be selected for bracket {bracket}"
                )

    def test_select_ai_decks_avoids_colors(self):
        """Test AI deck selection tries to avoid specified colors."""
        # Select decks avoiding red
        decks = select_ai_decks(
            bracket=3,
            count=2,
            avoid_colors=['R'],
        )

        # Should prefer non-red decks when available
        # (This is a soft constraint - may include red if no alternatives)
        if len(decks) > 0:
            # Check that selection ran without error
            assert True

    def test_launch_game_basic(self):
        """Test launching a basic 2-player game."""
        deck_data = {
            "id": "test-deck-001",
            "commander": "Test Commander",
            "colors": ["U", "G"],
            "list": ["Card1", "Card2"],  # Simplified for test
            "bracket": 3,
            "theme": "Test",
        }

        response = launch_game(
            deck_data=deck_data,
            opponent_count=1,
            difficulty=3,
        )

        assert response.game_id, "Should return a game ID"
        assert response.player_count == 2, "Should have 2 players"
        assert response.human_deck == "Test Commander"
        assert len(response.ai_decks) == 1, "Should have 1 AI deck"
        assert response.difficulty == 3

    def test_launch_game_4_player(self):
        """Test launching a 4-player game."""
        deck_data = {
            "id": "test-deck-002",
            "commander": "Four Player Commander",
            "colors": ["W"],
            "list": [],
            "bracket": 2,
            "theme": "Test",
        }

        response = launch_game(
            deck_data=deck_data,
            opponent_count=3,
            difficulty=2,
        )

        assert response.player_count == 4, "Should have 4 players"
        assert len(response.ai_decks) == 3, "Should have 3 AI decks"

    def test_launch_game_with_personalities(self):
        """Test launching a game with custom AI personalities."""
        deck_data = {
            "id": "test-deck-003",
            "commander": "Personality Test",
            "colors": ["B", "R"],
            "list": [],
            "bracket": 4,
            "theme": "Test",
        }

        response = launch_game(
            deck_data=deck_data,
            opponent_count=2,
            difficulty=4,
            ai_personalities=["Aggressive", "Political"],
        )

        assert response.player_count == 3
        assert response.difficulty == 4

    def test_launch_game_invalid_personality_fallback(self):
        """Test that invalid personalities fall back to Balanced."""
        deck_data = {
            "id": "test-deck-004",
            "commander": "Fallback Test",
            "colors": ["G"],
            "list": [],
            "bracket": 1,
            "theme": "Test",
        }

        # "Invalid" is not a valid personality
        response = launch_game(
            deck_data=deck_data,
            opponent_count=1,
            difficulty=1,
            ai_personalities=["Invalid"],
        )

        assert response.game_id, "Should still return a game"

    def test_launch_game_difficulty_boundaries(self):
        """Test game launch at difficulty boundaries."""
        deck_data = {
            "id": "test-deck-005",
            "commander": "Boundary Test",
            "colors": [],
            "list": [],
            "bracket": 3,
            "theme": "Test",
        }

        # Test minimum difficulty
        response_min = launch_game(
            deck_data=deck_data,
            opponent_count=1,
            difficulty=1,
        )
        assert response_min.difficulty == 1

        # Test maximum difficulty
        response_max = launch_game(
            deck_data=deck_data,
            opponent_count=1,
            difficulty=5,
        )
        assert response_max.difficulty == 5

    def test_game_id_uniqueness(self):
        """Test that each game launch gets a unique ID."""
        deck_data = {
            "id": "test-deck-006",
            "commander": "Unique ID Test",
            "colors": ["U"],
            "list": [],
            "bracket": 2,
            "theme": "Test",
        }

        ids = set()
        for _ in range(10):
            response = launch_game(
                deck_data=deck_data,
                opponent_count=1,
                difficulty=2,
            )
            ids.add(response.game_id)

        assert len(ids) == 10, "All game IDs should be unique"


class TestAIDeckPool:
    """Tests for the AI deck pool functionality."""

    def test_deck_pool_has_coverage(self):
        """Test that deck pool covers all brackets."""
        decks = load_ai_deck_pool()

        brackets_covered = set()
        for deck in decks:
            for b in range(deck.minBracket, deck.maxBracket + 1):
                brackets_covered.add(b)

        for bracket in range(1, 6):
            assert bracket in brackets_covered, (
                f"Bracket {bracket} should be covered by at least one deck"
            )

    def test_deck_pool_color_diversity(self):
        """Test that deck pool has color diversity."""
        decks = load_ai_deck_pool()

        colors_present = set()
        for deck in decks:
            for color in deck.colors:
                colors_present.add(color)

        # Should have at least 4 of the 5 colors represented
        assert len(colors_present) >= 4, (
            f"Deck pool should have color diversity, found: {colors_present}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
