"""
Game Launcher

Handles launching Commander games from generated decks.
Bridges the deck generator with the game engine.
"""

import json
import uuid
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field

# AI deck pool data location
AI_DECKS_PATH = Path(__file__).parent.parent / "data" / "ai_decks" / "deck_pool.json"


class GameLaunchRequest(BaseModel):
    """Request to launch a new game."""
    deck_id: str = Field(..., description="ID of the generated deck to use")
    opponent_count: int = Field(1, ge=1, le=3, description="Number of AI opponents (1-3)")
    difficulty: int = Field(3, ge=1, le=5, description="AI difficulty bracket (1-5)")
    ai_personalities: Optional[list[str]] = Field(
        None,
        description="Personality for each AI (Aggressive, Greedy, Political, Balanced)"
    )


class GameLaunchResponse(BaseModel):
    """Response after launching a game."""
    game_id: str
    player_count: int
    human_deck: str
    ai_decks: list[str]
    difficulty: int
    message: str


class PrebuiltDeck(BaseModel):
    """Prebuilt AI deck from the deck pool."""
    id: str
    commander: str
    list: list[str]
    colors: list[str]
    bracket: int
    minBracket: int
    maxBracket: int
    theme: str
    description: str


def load_ai_deck_pool() -> list[PrebuiltDeck]:
    """Load the AI deck pool from JSON file."""
    if not AI_DECKS_PATH.exists():
        return []

    with open(AI_DECKS_PATH) as f:
        data = json.load(f)

    return [PrebuiltDeck(**deck) for deck in data.get("decks", [])]


def get_decks_for_bracket(decks: list[PrebuiltDeck], bracket: int) -> list[PrebuiltDeck]:
    """Filter decks suitable for the given bracket."""
    return [
        deck for deck in decks
        if deck.minBracket <= bracket <= deck.maxBracket
    ]


def select_ai_decks(
    bracket: int,
    count: int,
    avoid_colors: Optional[list[str]] = None
) -> list[PrebuiltDeck]:
    """
    Select AI decks for a game.

    Args:
        bracket: Difficulty bracket (1-5)
        count: Number of decks to select
        avoid_colors: Colors to avoid if possible (for variety)

    Returns:
        List of selected prebuilt decks
    """
    all_decks = load_ai_deck_pool()
    suitable = get_decks_for_bracket(all_decks, bracket)

    if not suitable:
        return []

    # If avoiding colors, prefer decks without those colors
    if avoid_colors:
        avoid_set = set(c.upper() for c in avoid_colors)
        preferred = [
            deck for deck in suitable
            if not any(c.upper() in avoid_set for c in deck.colors)
        ]
        if preferred:
            suitable = preferred

    # Shuffle and select
    import random
    random.shuffle(suitable)

    return suitable[:count]


def launch_game(
    deck_data: dict,
    opponent_count: int = 1,
    difficulty: int = 3,
    ai_personalities: Optional[list[str]] = None,
) -> GameLaunchResponse:
    """
    Launch a new Commander game.

    Args:
        deck_data: The human player's deck data from the deck generator
        opponent_count: Number of AI opponents (1-3)
        difficulty: AI difficulty bracket (1-5)
        ai_personalities: Optional list of AI personalities

    Returns:
        GameLaunchResponse with game details
    """
    # Generate game ID
    game_id = str(uuid.uuid4())[:12]

    # Get human deck info
    human_commander = deck_data.get("commander", "Unknown")
    human_colors = deck_data.get("colors", [])

    # Select AI decks
    ai_decks = select_ai_decks(
        bracket=difficulty,
        count=opponent_count,
        avoid_colors=human_colors
    )

    # Validate we have enough decks
    if len(ai_decks) < opponent_count:
        # Fall back to any available decks
        all_decks = load_ai_deck_pool()
        ai_decks = all_decks[:opponent_count]

    ai_commanders = [deck.commander for deck in ai_decks]

    # Validate personalities
    valid_personalities = {"Aggressive", "Greedy", "Political", "Balanced"}
    if ai_personalities:
        ai_personalities = [
            p if p in valid_personalities else "Balanced"
            for p in ai_personalities[:opponent_count]
        ]
        # Pad with Balanced if not enough
        while len(ai_personalities) < opponent_count:
            ai_personalities.append("Balanced")
    else:
        ai_personalities = ["Balanced"] * opponent_count

    return GameLaunchResponse(
        game_id=game_id,
        player_count=opponent_count + 1,
        human_deck=human_commander,
        ai_decks=ai_commanders,
        difficulty=difficulty,
        message=f"Game ready: {human_commander} vs {', '.join(ai_commanders)}"
    )
