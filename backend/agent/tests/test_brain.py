"""Tests for AgentBrain parsing helpers (no model loading required)."""

import pytest

from backend.agent.brain import AgentBrain


def _make_brain() -> AgentBrain:
    """Create an AgentBrain instance without running __init__ (skips model path, DB setup)."""
    return AgentBrain.__new__(AgentBrain)


class TestBrainParsing:
    """Tests for _parse_tool_calls and _strip_tool_calls."""

    def test_parse_tool_call(self) -> None:
        """Single <tool_call> block is correctly parsed."""
        brain = _make_brain()
        text = (
            'Let me look that up.\n'
            '<tool_call>\n'
            '{"name": "get_card", "arguments": {"name": "Sol Ring"}}\n'
            '</tool_call>'
        )
        calls = brain._parse_tool_calls(text)
        assert len(calls) == 1
        assert calls[0]["name"] == "get_card"
        assert calls[0]["arguments"] == {"name": "Sol Ring"}

    def test_parse_multiple_tool_calls(self) -> None:
        """Two <tool_call> blocks are both extracted."""
        brain = _make_brain()
        text = (
            '<tool_call>\n'
            '{"name": "get_card", "arguments": {"name": "Lightning Bolt"}}\n'
            '</tool_call>\n'
            'Some text in between.\n'
            '<tool_call>\n'
            '{"name": "check_rules", "arguments": {"card_name": "Lightning Bolt", "bracket": 3}}\n'
            '</tool_call>'
        )
        calls = brain._parse_tool_calls(text)
        assert len(calls) == 2
        assert calls[0]["name"] == "get_card"
        assert calls[0]["arguments"]["name"] == "Lightning Bolt"
        assert calls[1]["name"] == "check_rules"
        assert calls[1]["arguments"]["card_name"] == "Lightning Bolt"
        assert calls[1]["arguments"]["bracket"] == 3

    def test_parse_no_tool_calls(self) -> None:
        """Plain text with no tool_call blocks returns an empty list."""
        brain = _make_brain()
        text = "Sure, Sol Ring is a great card for any Commander deck!"
        calls = brain._parse_tool_calls(text)
        assert calls == []

    def test_strip_tool_calls_from_response(self) -> None:
        """Tool call blocks are removed; surrounding text is preserved."""
        brain = _make_brain()
        text = (
            'Here is my analysis.\n'
            '<tool_call>\n'
            '{"name": "get_card", "arguments": {"name": "Sol Ring"}}\n'
            '</tool_call>\n'
            'And here is more text.'
        )
        stripped = brain._strip_tool_calls(text)
        assert "<tool_call>" not in stripped
        assert "</tool_call>" not in stripped
        assert "Here is my analysis." in stripped
        assert "And here is more text." in stripped
