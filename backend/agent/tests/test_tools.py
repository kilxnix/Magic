"""Tests for agent tool wrappers."""

import pytest

from backend.agent.tools import (
    TOOL_MAP,
    TOOL_REGISTRY,
    tool_check_rules,
    tool_detect_tags,
    tool_get_bracket_info,
)

EXPECTED_TOOL_NAMES = [
    "detect_tags",
    "get_bracket_info",
    "check_rules",
    "get_card",
    "search_cards",
    "score_card",
    "compose_deck",
    "find_alternatives",
]


# ---------------------------------------------------------------------------
# TestToolRegistry
# ---------------------------------------------------------------------------
class TestToolRegistry:
    """Verify TOOL_REGISTRY and TOOL_MAP are well-formed."""

    def test_registry_has_all_tools(self):
        names = [t["name"] for t in TOOL_REGISTRY]
        for expected in EXPECTED_TOOL_NAMES:
            assert expected in names, f"Missing tool: {expected}"

    def test_registry_count(self):
        assert len(TOOL_REGISTRY) == 8

    def test_each_entry_has_required_keys(self):
        for entry in TOOL_REGISTRY:
            assert "name" in entry, f"Entry missing 'name': {entry}"
            assert "description" in entry, f"{entry['name']} missing 'description'"
            assert "parameters" in entry, f"{entry['name']} missing 'parameters'"
            assert "function" in entry, f"{entry['name']} missing 'function'"

    def test_tool_map_matches_registry(self):
        assert len(TOOL_MAP) == len(TOOL_REGISTRY)
        for entry in TOOL_REGISTRY:
            assert entry["name"] in TOOL_MAP
            assert TOOL_MAP[entry["name"]] is entry["function"]

    def test_all_functions_are_callable(self):
        for entry in TOOL_REGISTRY:
            assert callable(entry["function"]), f"{entry['name']} function not callable"


# ---------------------------------------------------------------------------
# TestLightweightTools
# ---------------------------------------------------------------------------
class TestLightweightTools:
    """Test lightweight tools that don't require model loading."""

    def test_detect_tags_removal(self):
        result = tool_detect_tags("Destroy target creature.")
        assert "removal" in result["tags"]
        assert result["primary_function"] == "removal"

    def test_detect_tags_ramp(self):
        result = tool_detect_tags(
            "Search your library for a basic land card, put that card onto "
            "the battlefield tapped, then shuffle."
        )
        assert "ramp" in result["tags"]
        assert result["primary_function"] == "ramp"

    def test_detect_tags_card_draw(self):
        result = tool_detect_tags("Draw three cards.")
        assert "card-draw" in result["tags"]
        assert result["primary_function"] == "card-draw"

    def test_detect_tags_with_type_line(self):
        result = tool_detect_tags("Counter target spell.", type_line="Instant")
        assert "counter" in result["tags"]
        assert "instant-speed" in result["tags"]

    def test_detect_tags_with_keywords(self):
        result = tool_detect_tags("", keywords=["Flash", "Hexproof"])
        assert "instant-speed" in result["tags"]
        assert "protection" in result["tags"]

    def test_detect_tags_empty_text(self):
        result = tool_detect_tags("")
        assert result["tags"] == []
        assert result["primary_function"] == "utility"

    def test_detect_tags_returns_sorted(self):
        result = tool_detect_tags(
            "Destroy target creature. Draw a card.",
            type_line="Instant",
        )
        assert result["tags"] == sorted(result["tags"])

    def test_get_bracket_info_returns_dict(self):
        result = tool_get_bracket_info(3)
        assert isinstance(result, dict)
        assert "name" in result
        assert result["name"] == "Upgraded"

    def test_get_bracket_info_bracket_1(self):
        result = tool_get_bracket_info(1)
        assert result["name"] == "Exhibition"
        assert result["allow_combos"] is False

    def test_get_bracket_info_bracket_5(self):
        result = tool_get_bracket_info(5)
        assert result["name"] == "cEDH"
        assert result["allow_combos"] is True

    def test_get_bracket_info_has_power_level(self):
        result = tool_get_bracket_info(3)
        assert "power_level" in result

    def test_check_rules_banned_card(self):
        result = tool_check_rules("Black Lotus")
        assert result["banned"] is True
        assert result["card_name"] == "Black Lotus"

    def test_check_rules_legal_card(self):
        result = tool_check_rules("Sol Ring")
        assert result["banned"] is False

    def test_check_rules_includes_restrictions(self):
        result = tool_check_rules("Sol Ring", bracket=2)
        assert result["bracket"] == 2
        assert "restrictions" in result
        assert result["restrictions"]["name"] == "Core"
