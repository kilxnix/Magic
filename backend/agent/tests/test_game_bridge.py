"""Tests for the game-state bridge (game_bridge.py).

Covers all three public functions with representative sample data modelled
on the TypeScript engine's serialised JSON output.
"""

import pytest

from backend.agent.game_bridge import (
    format_decide_prompt,
    parse_action_choice,
    summarize_game_state,
)

# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

DEFINITIONS = {
    "def_sol_ring": {
        "id": "def_sol_ring",
        "name": "Sol Ring",
        "type_line": "Artifact",
        "oracle_text": "{T}: Add {C}{C}.",
        "mana_cost": "{1}",
        "cmc": 1,
        "colors": [],
        "color_identity": [],
        "keywords": [],
        "card_types": ["artifact"],
    },
    "def_llanowar": {
        "id": "def_llanowar",
        "name": "Llanowar Elves",
        "type_line": "Creature — Elf Druid",
        "oracle_text": "{T}: Add {G}.",
        "mana_cost": "{G}",
        "cmc": 1,
        "colors": ["G"],
        "color_identity": ["G"],
        "keywords": [],
        "power": 1,
        "toughness": 1,
        "card_types": ["creature"],
    },
    "def_forest": {
        "id": "def_forest",
        "name": "Forest",
        "type_line": "Basic Land — Forest",
        "oracle_text": "",
        "mana_cost": "",
        "cmc": 0,
        "colors": [],
        "color_identity": ["G"],
        "keywords": [],
        "card_types": ["land"],
    },
    "def_bolt": {
        "id": "def_bolt",
        "name": "Lightning Bolt",
        "type_line": "Instant",
        "oracle_text": "Lightning Bolt deals 3 damage to any target.",
        "mana_cost": "{R}",
        "cmc": 1,
        "colors": ["R"],
        "color_identity": ["R"],
        "keywords": [],
        "card_types": ["instant"],
    },
    "def_grizzly": {
        "id": "def_grizzly",
        "name": "Grizzly Bears",
        "type_line": "Creature — Bear",
        "oracle_text": "",
        "mana_cost": "{1}{G}",
        "cmc": 2,
        "colors": ["G"],
        "color_identity": ["G"],
        "keywords": [],
        "power": 2,
        "toughness": 2,
        "card_types": ["creature"],
    },
    "def_commander": {
        "id": "def_commander",
        "name": "Golos, Tireless Pilgrim",
        "type_line": "Legendary Artifact Creature — Scout",
        "oracle_text": "When Golos enters the battlefield, search your library for a land card, put it onto the battlefield tapped.",
        "mana_cost": "{5}",
        "cmc": 5,
        "colors": [],
        "color_identity": ["W", "U", "B", "R", "G"],
        "keywords": [],
        "power": 3,
        "toughness": 5,
        "card_types": ["artifact", "creature"],
    },
}

CARDS = {
    "inst_1": {
        "instanceId": "inst_1",
        "definitionId": "def_sol_ring",
        "ownerId": "p1",
        "zone": "battlefield",
        "tapped": False,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": False,
    },
    "inst_2": {
        "instanceId": "inst_2",
        "definitionId": "def_llanowar",
        "ownerId": "p1",
        "zone": "battlefield",
        "tapped": True,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": False,
    },
    "inst_3": {
        "instanceId": "inst_3",
        "definitionId": "def_forest",
        "ownerId": "p1",
        "zone": "battlefield",
        "tapped": False,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": False,
    },
    "inst_4": {
        "instanceId": "inst_4",
        "definitionId": "def_bolt",
        "ownerId": "p1",
        "zone": "hand",
        "tapped": False,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": False,
    },
    "inst_5": {
        "instanceId": "inst_5",
        "definitionId": "def_grizzly",
        "ownerId": "p2",
        "zone": "battlefield",
        "tapped": False,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": False,
    },
    "inst_6": {
        "instanceId": "inst_6",
        "definitionId": "def_forest",
        "ownerId": "p2",
        "zone": "hand",
        "tapped": False,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": False,
    },
    "inst_7": {
        "instanceId": "inst_7",
        "definitionId": "def_bolt",
        "ownerId": "p2",
        "zone": "hand",
        "tapped": False,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": False,
    },
    "inst_8": {
        "instanceId": "inst_8",
        "definitionId": "def_sol_ring",
        "ownerId": "p1",
        "zone": "graveyard",
        "tapped": False,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": False,
    },
    "inst_9": {
        "instanceId": "inst_9",
        "definitionId": "def_commander",
        "ownerId": "p1",
        "zone": "command",
        "tapped": False,
        "summoningSick": False,
        "counters": {},
        "damage": 0,
        "isCommander": True,
    },
}

STATE = {
    "players": [
        {
            "id": "p1",
            "name": "AI Player",
            "life": 38,
            "commanderDamage": {},
            "commanderTax": 0,
            "commanderInstanceId": "inst_9",
            "commanderCastCount": 0,
            "manaPool": {"W": 0, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0},
            "hasPlayedLand": False,
            "hasPriority": True,
            "hasLost": False,
        },
        {
            "id": "p2",
            "name": "Opponent",
            "life": 40,
            "commanderDamage": {},
            "commanderTax": 0,
            "commanderInstanceId": None,
            "commanderCastCount": 0,
            "manaPool": {"W": 0, "U": 0, "B": 0, "R": 0, "G": 0, "C": 0},
            "hasPlayedLand": False,
            "hasPriority": False,
            "hasLost": False,
        },
    ],
    "activePlayerIndex": 0,
    "priorityPlayerIndex": 0,
    "phase": "precombat_main",
    "step": "upkeep",
    "turnNumber": 3,
    "hasPriorityPassed": [False, False],
    "stack": [],
    "combat": None,
}


# ---------------------------------------------------------------------------
# TestSummarizeGameState
# ---------------------------------------------------------------------------
class TestSummarizeGameState:
    """Tests for summarize_game_state."""

    def test_contains_turn_info(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        assert "Turn 3" in result
        assert "precombat_main" in result

    def test_ai_hand_shows_card_names(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        assert "Lightning Bolt" in result

    def test_opponent_hand_shows_count_only(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        # Opponent has 2 cards in hand; we should NOT see their names
        assert "2 card(s)" in result
        # The opponent's bolt should not appear in the hand section.
        # We allow "Lightning Bolt" to appear if it is on our side, but not
        # labelled under the Opponent's hand line.
        lines = result.split("\n")
        opp_hand_line = [l for l in lines if "Hand:" in l and "2 card" in l]
        assert len(opp_hand_line) == 1
        assert "Lightning Bolt" not in opp_hand_line[0]

    def test_battlefield_shows_tapped(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        assert "(tapped)" in result
        assert "Llanowar Elves" in result

    def test_battlefield_creatures_have_pt(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        # Llanowar Elves 1/1
        assert "[1/1]" in result
        # Grizzly Bears 2/2
        assert "[2/2]" in result

    def test_player_life_totals(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        assert "Life: 38" in result
        assert "Life: 40" in result

    def test_graveyard_shown(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        assert "Graveyard" in result
        assert "Sol Ring" in result

    def test_you_tag_on_ai_player(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        assert "(you)" in result

    def test_command_zone_shown(self) -> None:
        result = summarize_game_state(STATE, CARDS, DEFINITIONS, "p1")
        assert "Command Zone" in result
        assert "Golos" in result

    def test_empty_battlefield(self) -> None:
        """Player with nothing on the battlefield shows (empty)."""
        empty_cards: dict = {
            "inst_x": {
                "instanceId": "inst_x",
                "definitionId": "def_bolt",
                "ownerId": "p1",
                "zone": "hand",
                "tapped": False,
                "summoningSick": False,
                "counters": {},
                "damage": 0,
                "isCommander": False,
            },
        }
        result = summarize_game_state(STATE, empty_cards, DEFINITIONS, "p1")
        assert "(empty)" in result


# ---------------------------------------------------------------------------
# TestFormatDecidePrompt
# ---------------------------------------------------------------------------
class TestFormatDecidePrompt:
    """Tests for format_decide_prompt."""

    ACTIONS = [
        {"kind": "CastSpell", "cardInstanceId": "inst_4", "targets": ["inst_5"]},
        {"kind": "PlayLand", "cardInstanceId": "inst_3"},
        {"kind": "PassPriority"},
    ]

    def test_prompt_contains_summary(self) -> None:
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, self.ACTIONS, "p1", "Aggressive",
        )
        assert "Turn 3" in prompt
        assert "Life: 38" in prompt

    def test_prompt_contains_personality(self) -> None:
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, self.ACTIONS, "p1", "Aggressive",
        )
        assert "Aggressive" in prompt

    def test_actions_numbered(self) -> None:
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, self.ACTIONS, "p1",
        )
        assert "[1]" in prompt
        assert "[2]" in prompt
        assert "[3]" in prompt

    def test_cast_spell_shows_card_and_target(self) -> None:
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, self.ACTIONS, "p1",
        )
        assert "Lightning Bolt" in prompt
        assert "Grizzly Bears" in prompt

    def test_play_land_shows_card_name(self) -> None:
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, self.ACTIONS, "p1",
        )
        assert "Forest" in prompt

    def test_pass_priority_listed(self) -> None:
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, self.ACTIONS, "p1",
        )
        assert "PassPriority" in prompt

    def test_pick_instruction(self) -> None:
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, self.ACTIONS, "p1",
        )
        assert "Pick an action by number" in prompt

    def test_declare_attackers_description(self) -> None:
        actions = [
            {
                "kind": "DeclareAttackers",
                "attacks": [
                    {"cardInstanceId": "inst_2", "defendingPlayerId": "p2"},
                ],
            },
        ]
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, actions, "p1",
        )
        assert "attack with" in prompt
        assert "Llanowar Elves" in prompt

    def test_activate_mana_ability_description(self) -> None:
        actions = [
            {"kind": "ActivateManaAbility", "cardInstanceId": "inst_3", "color": "G"},
        ]
        prompt = format_decide_prompt(
            STATE, CARDS, DEFINITIONS, actions, "p1",
        )
        assert "Forest" in prompt
        assert "{G}" in prompt


# ---------------------------------------------------------------------------
# TestParseActionChoice
# ---------------------------------------------------------------------------
class TestParseActionChoice:
    """Tests for parse_action_choice."""

    ACTIONS = [
        {"kind": "CastSpell", "cardInstanceId": "inst_4", "targets": []},
        {"kind": "PlayLand", "cardInstanceId": "inst_3"},
        {"kind": "PassPriority"},
    ]

    # -- Bracketed number --
    def test_bracketed_number(self) -> None:
        result = parse_action_choice("I'll go with [2] to play my land.", self.ACTIONS)
        assert result["kind"] == "PlayLand"

    def test_bracketed_number_first_action(self) -> None:
        result = parse_action_choice("[1] Bolt them!", self.ACTIONS)
        assert result["kind"] == "CastSpell"

    # -- Bare / prefixed number --
    def test_bare_number(self) -> None:
        result = parse_action_choice("Action 3 — let's pass.", self.ACTIONS)
        assert result["kind"] == "PassPriority"

    def test_plain_digit_start(self) -> None:
        result = parse_action_choice("2. Play a land.", self.ACTIONS)
        assert result["kind"] == "PlayLand"

    # -- Out-of-range numbers fallback --
    def test_out_of_range_number_falls_through(self) -> None:
        result = parse_action_choice("[99] sure", self.ACTIONS)
        # Falls to keyword or fallback
        assert result is not None

    # -- Keyword matching --
    def test_keyword_pass(self) -> None:
        result = parse_action_choice("I'll just pass priority for now.", self.ACTIONS)
        assert result["kind"] == "PassPriority"

    def test_keyword_cast(self) -> None:
        result = parse_action_choice("Let's cast something big!", self.ACTIONS)
        assert result["kind"] == "CastSpell"

    def test_keyword_play_land(self) -> None:
        result = parse_action_choice("Play a land seems wise.", self.ACTIONS)
        assert result["kind"] == "PlayLand"

    # -- Fallback --
    def test_fallback_to_pass_priority(self) -> None:
        """Gibberish should fallback to PassPriority when available."""
        result = parse_action_choice("xyzzy foobar", self.ACTIONS)
        assert result["kind"] == "PassPriority"

    def test_fallback_no_pass_returns_last(self) -> None:
        """Without PassPriority, fallback is the last action."""
        actions = [
            {"kind": "CastSpell", "cardInstanceId": "inst_4", "targets": []},
            {"kind": "PlayLand", "cardInstanceId": "inst_3"},
        ]
        result = parse_action_choice("xyzzy foobar", actions)
        assert result["kind"] == "PlayLand"

    def test_empty_actions_returns_pass(self) -> None:
        result = parse_action_choice("anything", [])
        assert result["kind"] == "PassPriority"

    def test_choose_prefix(self) -> None:
        result = parse_action_choice("I choose 1.", self.ACTIONS)
        assert result["kind"] == "CastSpell"

    def test_option_prefix(self) -> None:
        result = parse_action_choice("Option 2 looks great.", self.ACTIONS)
        assert result["kind"] == "PlayLand"

    # -- Edge: number in card name shouldn't mislead --
    def test_number_in_narration_only(self) -> None:
        """If the response has a number that is clearly a choice, use it."""
        result = parse_action_choice(
            "I pick [3] because passing is safest on turn 3.",
            self.ACTIONS,
        )
        assert result["kind"] == "PassPriority"
