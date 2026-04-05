# MTG Agent Brain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an autonomous MTG knowledge agent that uses fine-tuned models, FAISS retrieval, and rules knowledge as tools — with layered memory and tone-matching — exposed as a standalone API.

**Architecture:** RAG-Agent hybrid. The fine-tuned scorer model doubles as the conversational brain (it's still a capable Qwen3-4B). Card knowledge comes from retrieval (FAISS + card DB), not memorization. The composer model loads on-demand for deck generation. Three-tier memory: working (conversation context), user (cross-session preferences), world (accumulated MTG insights). Standalone FastAPI server on its own port.

**Tech Stack:** Python 3.12, FastAPI, torch + transformers (Qwen3-4B), FAISS, SQLite, sentence-transformers

---

## File Structure

```
backend/agent/
├── __init__.py          — Package marker + version
├── server.py            — Standalone FastAPI server (port 8100)
├── brain.py             — Agent orchestration: intent → tools → response
├── tools.py             — Tool wrappers around existing components
├── memory.py            — Three-tier memory system
├── prompts.py           — System prompts, tool descriptions, tone templates
└── tests/
    ├── __init__.py
    ├── test_memory.py   — Memory CRUD and retrieval tests
    ├── test_tools.py    — Tool wrapper tests
    └── test_brain.py    — Agent loop + integration tests
```

---

### Task 1: Memory System

**Files:**
- Create: `backend/agent/__init__.py`
- Create: `backend/agent/memory.py`
- Create: `backend/agent/tests/__init__.py`
- Create: `backend/agent/tests/test_memory.py`

Three tiers:
- **Working**: list of messages for current conversation (in-memory, per session)
- **User**: preferences persisted to SQLite keyed by user_id (budget pref, bracket pref, play style, disliked mechanics)
- **World**: shared MTG insights persisted to SQLite (combo notes, meta observations, card reputation)

- [ ] **Step 1: Write failing tests for working memory**

```python
# backend/agent/tests/test_memory.py
import pytest
from backend.agent.memory import WorkingMemory, UserMemory, WorldMemory

class TestWorkingMemory:
    def test_add_and_retrieve_messages(self):
        wm = WorkingMemory()
        wm.add("user", "Build me an Atraxa deck")
        wm.add("assistant", "Sure, what theme?")
        msgs = wm.get_messages()
        assert len(msgs) == 2
        assert msgs[0] == {"role": "user", "content": "Build me an Atraxa deck"}

    def test_context_window_truncation(self):
        wm = WorkingMemory(max_messages=4)
        for i in range(6):
            wm.add("user", f"msg {i}")
        msgs = wm.get_messages()
        assert len(msgs) == 4
        assert msgs[0]["content"] == "msg 2"

    def test_clear(self):
        wm = WorkingMemory()
        wm.add("user", "hello")
        wm.clear()
        assert wm.get_messages() == []

    def test_get_summary_context(self):
        wm = WorkingMemory()
        wm.add("user", "Build Atraxa counters deck")
        wm.add("assistant", "Here's a counters deck...")
        ctx = wm.get_context_string()
        assert "Atraxa" in ctx
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

Run: `cd Magic && python -m pytest backend/agent/tests/test_memory.py::TestWorkingMemory -v`

- [ ] **Step 3: Implement WorkingMemory**

```python
# backend/agent/memory.py
"""Three-tier memory system for the MTG agent brain."""

from __future__ import annotations

import json
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

DATA_DIR = Path(__file__).parent.parent.parent / "data"


# ── Tier 1: Working Memory (conversation context) ──────────────────────

class WorkingMemory:
    """In-memory conversation buffer for a single session."""

    def __init__(self, max_messages: int = 40):
        self._messages: List[Dict[str, str]] = []
        self._max = max_messages

    def add(self, role: str, content: str) -> None:
        self._messages.append({"role": role, "content": content})
        if len(self._messages) > self._max:
            self._messages = self._messages[-self._max:]

    def get_messages(self) -> List[Dict[str, str]]:
        return list(self._messages)

    def get_context_string(self) -> str:
        return "\n".join(
            f"{m['role']}: {m['content']}" for m in self._messages
        )

    def clear(self) -> None:
        self._messages.clear()
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd Magic && python -m pytest backend/agent/tests/test_memory.py::TestWorkingMemory -v`

- [ ] **Step 5: Write failing tests for UserMemory**

```python
# append to test_memory.py
class TestUserMemory:
    def setup_method(self):
        self.db_path = DATA_DIR / "test_agent_memory.db"
        self.um = UserMemory(db_path=self.db_path)

    def teardown_method(self):
        self.db_path.unlink(missing_ok=True)

    def test_set_and_get_preference(self):
        self.um.set("user1", "budget_pref", "affordable")
        assert self.um.get("user1", "budget_pref") == "affordable"

    def test_get_missing_returns_default(self):
        assert self.um.get("user1", "missing", default="none") == "none"

    def test_get_all_prefs(self):
        self.um.set("user1", "bracket", "3")
        self.um.set("user1", "style", "casual")
        prefs = self.um.get_all("user1")
        assert prefs["bracket"] == "3"
        assert prefs["style"] == "casual"

    def test_update_overwrites(self):
        self.um.set("user1", "budget_pref", "budget")
        self.um.set("user1", "budget_pref", "premium")
        assert self.um.get("user1", "budget_pref") == "premium"

    def test_delete(self):
        self.um.set("user1", "temp", "value")
        self.um.delete("user1", "temp")
        assert self.um.get("user1", "temp") is None
```

- [ ] **Step 6: Implement UserMemory**

```python
# append to memory.py

# ── Tier 2: User Memory (cross-session preferences) ────────────────────

class UserMemory:
    """Per-user preferences persisted in SQLite."""

    def __init__(self, db_path: Optional[Path] = None):
        self._db = db_path or (DATA_DIR / "agent_memory.db")
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._db) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS user_prefs (
                    user_id   TEXT NOT NULL,
                    key       TEXT NOT NULL,
                    value     TEXT NOT NULL,
                    updated   REAL NOT NULL,
                    PRIMARY KEY (user_id, key)
                )
            """)

    def set(self, user_id: str, key: str, value: str) -> None:
        with sqlite3.connect(self._db) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO user_prefs VALUES (?, ?, ?, ?)",
                (user_id, key, value, time.time()),
            )

    def get(self, user_id: str, key: str, default: Any = None) -> Optional[str]:
        with sqlite3.connect(self._db) as conn:
            row = conn.execute(
                "SELECT value FROM user_prefs WHERE user_id=? AND key=?",
                (user_id, key),
            ).fetchone()
        return row[0] if row else default

    def get_all(self, user_id: str) -> Dict[str, str]:
        with sqlite3.connect(self._db) as conn:
            rows = conn.execute(
                "SELECT key, value FROM user_prefs WHERE user_id=?",
                (user_id,),
            ).fetchall()
        return dict(rows)

    def delete(self, user_id: str, key: str) -> None:
        with sqlite3.connect(self._db) as conn:
            conn.execute(
                "DELETE FROM user_prefs WHERE user_id=? AND key=?",
                (user_id, key),
            )
```

- [ ] **Step 7: Run tests — expect PASS**

Run: `cd Magic && python -m pytest backend/agent/tests/test_memory.py::TestUserMemory -v`

- [ ] **Step 8: Write failing tests for WorldMemory**

```python
# append to test_memory.py
class TestWorldMemory:
    def setup_method(self):
        self.db_path = DATA_DIR / "test_agent_world.db"
        self.wm = WorldMemory(db_path=self.db_path)

    def teardown_method(self):
        self.db_path.unlink(missing_ok=True)

    def test_add_and_search_insight(self):
        self.wm.add("Rhystic Study gets hated off the table in casual pods", "meta")
        results = self.wm.search("Rhystic Study")
        assert len(results) >= 1
        assert "Rhystic Study" in results[0]["content"]

    def test_add_with_tags(self):
        self.wm.add("Doubling Season + Atraxa is a staple combo", "combo",
                     tags=["Atraxa", "Doubling Season"])
        results = self.wm.search_by_tag("Atraxa")
        assert len(results) >= 1

    def test_dedup_similar(self):
        self.wm.add("Sol Ring is the best card in Commander", "meta")
        self.wm.add("Sol Ring is the best card in Commander", "meta")
        results = self.wm.search("Sol Ring best card")
        assert len(results) == 1
```

- [ ] **Step 9: Implement WorldMemory**

```python
# append to memory.py

# ── Tier 3: World Memory (accumulated MTG knowledge) ───────────────────

class WorldMemory:
    """Shared MTG insights persisted in SQLite with text search."""

    def __init__(self, db_path: Optional[Path] = None):
        self._db = db_path or (DATA_DIR / "agent_world.db")
        self._db.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._db) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS insights (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    content   TEXT NOT NULL UNIQUE,
                    category  TEXT NOT NULL,
                    tags      TEXT DEFAULT '[]',
                    created   REAL NOT NULL
                )
            """)

    def add(self, content: str, category: str,
            tags: Optional[List[str]] = None) -> None:
        with sqlite3.connect(self._db) as conn:
            try:
                conn.execute(
                    "INSERT INTO insights (content, category, tags, created) "
                    "VALUES (?, ?, ?, ?)",
                    (content, category, json.dumps(tags or []), time.time()),
                )
            except sqlite3.IntegrityError:
                pass  # duplicate

    def search(self, query: str, limit: int = 5) -> List[Dict]:
        with sqlite3.connect(self._db) as conn:
            rows = conn.execute(
                "SELECT content, category, tags, created FROM insights "
                "WHERE content LIKE ? ORDER BY created DESC LIMIT ?",
                (f"%{query}%", limit),
            ).fetchall()
        return [
            {"content": r[0], "category": r[1],
             "tags": json.loads(r[2]), "created": r[3]}
            for r in rows
        ]

    def search_by_tag(self, tag: str, limit: int = 10) -> List[Dict]:
        with sqlite3.connect(self._db) as conn:
            rows = conn.execute(
                "SELECT content, category, tags, created FROM insights "
                "WHERE tags LIKE ? ORDER BY created DESC LIMIT ?",
                (f'%"{tag}"%', limit),
            ).fetchall()
        return [
            {"content": r[0], "category": r[1],
             "tags": json.loads(r[2]), "created": r[3]}
            for r in rows
        ]
```

- [ ] **Step 10: Run all memory tests — expect PASS**

Run: `cd Magic && python -m pytest backend/agent/tests/test_memory.py -v`

- [ ] **Step 11: Commit**

```bash
git add backend/agent/
git commit -m "feat(agent): add three-tier memory system (working, user, world)"
```

---

### Task 2: Tool Definitions

**Files:**
- Create: `backend/agent/tools.py`
- Create: `backend/agent/tests/test_tools.py`

Thin wrappers around existing components. Each tool returns a structured dict the brain can reason about.

- [ ] **Step 1: Write failing tests for tool wrappers**

```python
# backend/agent/tests/test_tools.py
import pytest
from backend.agent.tools import (
    TOOL_REGISTRY,
    tool_search_cards,
    tool_get_card,
    tool_check_rules,
    tool_detect_tags,
    tool_get_bracket_info,
)

class TestToolRegistry:
    def test_registry_has_all_tools(self):
        names = [t["name"] for t in TOOL_REGISTRY]
        assert "search_cards" in names
        assert "get_card" in names
        assert "check_rules" in names
        assert "detect_tags" in names
        assert "get_bracket_info" in names
        assert "score_card" in names
        assert "compose_deck" in names
        assert "find_alternatives" in names

    def test_each_tool_has_description_and_params(self):
        for tool in TOOL_REGISTRY:
            assert "name" in tool
            assert "description" in tool
            assert "parameters" in tool

class TestLightweightTools:
    """Tests for tools that don't require model loading."""

    def test_get_bracket_info(self):
        result = tool_get_bracket_info(bracket=3)
        assert result["name"] == "Upgraded"
        assert "game_changers" in str(result).lower() or "max_game_changers" in result

    def test_detect_tags_removal(self):
        result = tool_detect_tags(
            oracle_text="Destroy target creature.",
            type_line="Instant"
        )
        assert "removal" in result["tags"]

    def test_detect_tags_ramp(self):
        result = tool_detect_tags(
            oracle_text="Search your library for a basic land card and put it onto the battlefield tapped.",
            type_line="Sorcery"
        )
        assert "ramp" in result["tags"]
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd Magic && python -m pytest backend/agent/tests/test_tools.py::TestToolRegistry -v`

- [ ] **Step 3: Implement tools.py**

```python
# backend/agent/tools.py
"""Tool wrappers that expose existing backend components to the agent brain.

Each tool function takes simple arguments and returns a dict.
TOOL_REGISTRY provides the schema the brain uses for tool selection.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure project root is importable
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.functional_tags import detect_tags as _detect_tags, get_primary_function
from backend.rules import (
    BRACKET_DEFINITIONS,
    COMMANDER_BANNED_CARDS,
    get_bracket_restrictions,
    is_card_banned,
)


# ── Lightweight tools (no model loading) ────────────────────────────────

def tool_search_cards(query: str, k: int = 20) -> Dict[str, Any]:
    """Semantic search for MTG cards using FAISS."""
    from backend.deck_generator import get_generator
    gen = get_generator()
    results = gen.search_cards(query, k=k)
    return {
        "cards": [
            {"name": c["name"], "type": c.get("type_line", ""),
             "cost": c.get("mana_cost", ""), "text": c.get("oracle_text", "")[:200],
             "colors": c.get("color_identity", []), "score": round(c.get("score", 0), 3)}
            for c in results
        ],
        "count": len(results),
    }


def tool_get_card(name: str) -> Dict[str, Any]:
    """Look up a card by exact name."""
    from backend.deck_generator import get_generator
    gen = get_generator()
    card = gen.card_by_name.get(name)
    if not card:
        return {"found": False, "name": name}
    return {
        "found": True,
        "name": card["name"],
        "type_line": card.get("type_line", ""),
        "mana_cost": card.get("mana_cost", ""),
        "cmc": card.get("cmc", 0),
        "oracle_text": card.get("oracle_text", ""),
        "color_identity": card.get("color_identity", []),
        "keywords": card.get("keywords", []),
        "rarity": card.get("rarity", ""),
    }


def tool_check_rules(card_name: str, bracket: int = 3) -> Dict[str, Any]:
    """Check if a card is legal in a given bracket."""
    banned = is_card_banned(card_name)
    restrictions = get_bracket_restrictions(bracket)
    return {
        "card_name": card_name,
        "bracket": bracket,
        "banned": banned,
        "restrictions": restrictions,
    }


def tool_detect_tags(oracle_text: str, type_line: str = "",
                     keywords: Optional[List[str]] = None) -> Dict[str, Any]:
    """Detect functional tags for a card."""
    tags = _detect_tags(oracle_text, type_line, keywords or [])
    primary = get_primary_function(tags)
    return {"tags": sorted(tags), "primary_function": primary}


def tool_get_bracket_info(bracket: int) -> Dict[str, Any]:
    """Get bracket power level details."""
    if bracket < 1 or bracket > 5:
        return {"error": f"Invalid bracket {bracket}. Must be 1-5."}
    info = BRACKET_DEFINITIONS[bracket - 1]
    restrictions = get_bracket_restrictions(bracket)
    return {**info, **restrictions}


# ── Heavy tools (require model loading) ─────────────────────────────────

def tool_score_card(card_name: str, commander_name: str,
                    card_text: str = "", commander_text: str = "",
                    commander_colors: str = "") -> Dict[str, Any]:
    """Score how well a card fits a commander's deck (0-1)."""
    from backend.model_scorers import get_qwen35_scorer
    scorer = get_qwen35_scorer()
    score = scorer.score_similarity(
        source_card=commander_name,
        candidate_card=card_name,
        source_text=commander_text,
        candidate_text=card_text,
        commander_name=commander_name,
        commander_colors=commander_colors,
    )
    return {"card": card_name, "commander": commander_name, "score": round(score, 2)}


def tool_compose_deck(commander_name: str, colors: List[str],
                      bracket: int = 3, theme: str = "goodstuff") -> Dict[str, Any]:
    """Generate a full deck using the composer model + FAISS backfill."""
    from backend.deck_generator import get_generator
    gen = get_generator()
    result = gen.generate_deck_with_model(
        commander_name=commander_name,
        bracket=bracket,
        theme=theme,
    )
    return result


def tool_find_alternatives(card_name: str, max_price: Optional[float] = None,
                           top_k: int = 5,
                           color_identity: Optional[List[str]] = None) -> Dict[str, Any]:
    """Find budget-friendly alternatives to a card."""
    from backend.card_alternatives import get_alternative_finder
    finder = get_alternative_finder()
    alts = finder.find_alternatives(
        card_name=card_name,
        max_price=max_price,
        top_k=top_k,
        color_identity=color_identity,
    )
    return {
        "source_card": card_name,
        "alternatives": [
            {"name": a.name, "price": a.price_usd,
             "score": round(a.final_score, 2),
             "tradeoff": a.tradeoff_explanation}
            for a in alts
        ],
    }


# ── Tool Registry (schema for the brain) ────────────────────────────────

TOOL_REGISTRY = [
    {
        "name": "search_cards",
        "description": "Semantic search for MTG cards by keyword, ability, or strategy. Returns matching cards with names and oracle text.",
        "parameters": {"query": "str", "k": "int (default 20)"},
        "function": tool_search_cards,
    },
    {
        "name": "get_card",
        "description": "Look up a specific card by exact name. Returns full card details.",
        "parameters": {"name": "str"},
        "function": tool_get_card,
    },
    {
        "name": "score_card",
        "description": "Rate how well a card fits in a commander's deck. Returns 0-1 score.",
        "parameters": {"card_name": "str", "commander_name": "str",
                       "card_text": "str", "commander_text": "str",
                       "commander_colors": "str"},
        "function": tool_score_card,
    },
    {
        "name": "compose_deck",
        "description": "Generate a full 99-card Commander deck for a given commander, bracket, and theme.",
        "parameters": {"commander_name": "str", "colors": "List[str]",
                       "bracket": "int", "theme": "str"},
        "function": tool_compose_deck,
    },
    {
        "name": "find_alternatives",
        "description": "Find cheaper or better substitutes for a card, respecting color identity.",
        "parameters": {"card_name": "str", "max_price": "float (optional)",
                       "top_k": "int", "color_identity": "List[str] (optional)"},
        "function": tool_find_alternatives,
    },
    {
        "name": "check_rules",
        "description": "Check if a card is banned or restricted in a given bracket.",
        "parameters": {"card_name": "str", "bracket": "int"},
        "function": tool_check_rules,
    },
    {
        "name": "detect_tags",
        "description": "Detect functional roles of a card (removal, ramp, draw, etc.) from its oracle text.",
        "parameters": {"oracle_text": "str", "type_line": "str"},
        "function": tool_detect_tags,
    },
    {
        "name": "get_bracket_info",
        "description": "Get details about a Commander power level bracket (1-5).",
        "parameters": {"bracket": "int"},
        "function": tool_get_bracket_info,
    },
]

TOOL_MAP = {t["name"]: t["function"] for t in TOOL_REGISTRY}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd Magic && python -m pytest backend/agent/tests/test_tools.py -v`

- [ ] **Step 5: Commit**

```bash
git add backend/agent/tools.py backend/agent/tests/test_tools.py
git commit -m "feat(agent): add tool wrappers for FAISS, rules, tags, scorer, composer"
```

---

### Task 3: Prompts and Tone System

**Files:**
- Create: `backend/agent/prompts.py`

- [ ] **Step 1: Write prompts.py**

```python
# backend/agent/prompts.py
"""System prompts, tool descriptions, and tone templates for the agent brain."""

SYSTEM_PROMPT = """You are the MTG Brain — a living Magic: The Gathering knowledge entity.
You know cards, combos, rules, deckbuilding strategy, and the Commander metagame.

You have tools to look up cards, search for synergies, score card-commander fit,
generate full decks, find budget alternatives, and check rules/legality.

ALWAYS use tools to retrieve card data — never guess card names or abilities from memory.
When a user asks about a card, look it up first. When building a deck, use compose_deck.
When answering rules questions, check_rules and get_card for the relevant cards.

Respond naturally. Match the user's energy — if they're frustrated, be empathetic and
direct. If they're excited, share their enthusiasm. If they're analytical, be precise.

You remember past conversations with each user and learn from the community over time.

Available tools:
{tool_descriptions}

User preferences:
{user_context}

Relevant knowledge:
{world_context}
"""


def build_tool_descriptions() -> str:
    """Format tool registry into a string for the system prompt."""
    from backend.agent.tools import TOOL_REGISTRY
    lines = []
    for t in TOOL_REGISTRY:
        params = ", ".join(f"{k}: {v}" for k, v in t["parameters"].items())
        lines.append(f"- {t['name']}({params}): {t['description']}")
    return "\n".join(lines)


def build_system_prompt(user_context: str = "None",
                        world_context: str = "None") -> str:
    """Build the full system prompt with tool descriptions and context."""
    return SYSTEM_PROMPT.format(
        tool_descriptions=build_tool_descriptions(),
        user_context=user_context,
        world_context=world_context,
    )


# Tool-call format the brain should use
TOOL_CALL_FORMAT = """To use a tool, respond with:
<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>

You may call multiple tools. After receiving tool results, synthesize your answer.
If no tool is needed, just respond directly."""
```

- [ ] **Step 2: Commit**

```bash
git add backend/agent/prompts.py
git commit -m "feat(agent): add system prompts and tone-matching templates"
```

---

### Task 4: Agent Brain

**Files:**
- Create: `backend/agent/brain.py`
- Create: `backend/agent/tests/test_brain.py`

The core orchestration loop: receive message → build context from memory → call LLM → parse tool calls → execute tools → synthesize response → update memory.

- [ ] **Step 1: Write failing test for brain message handling**

```python
# backend/agent/tests/test_brain.py
import pytest
from backend.agent.brain import AgentBrain

class TestBrainParsing:
    def test_parse_tool_call(self):
        text = '''Let me look that up.
<tool_call>
{"name": "get_card", "arguments": {"name": "Sol Ring"}}
</tool_call>'''
        brain = AgentBrain.__new__(AgentBrain)  # skip __init__
        calls = brain._parse_tool_calls(text)
        assert len(calls) == 1
        assert calls[0]["name"] == "get_card"
        assert calls[0]["arguments"]["name"] == "Sol Ring"

    def test_parse_multiple_tool_calls(self):
        text = '''<tool_call>
{"name": "get_card", "arguments": {"name": "Sol Ring"}}
</tool_call>
<tool_call>
{"name": "detect_tags", "arguments": {"oracle_text": "Tap: Add two colorless mana.", "type_line": "Artifact"}}
</tool_call>'''
        brain = AgentBrain.__new__(AgentBrain)
        calls = brain._parse_tool_calls(text)
        assert len(calls) == 2

    def test_parse_no_tool_calls(self):
        text = "Sol Ring is a great card for any deck."
        brain = AgentBrain.__new__(AgentBrain)
        calls = brain._parse_tool_calls(text)
        assert len(calls) == 0

    def test_strip_tool_calls_from_response(self):
        text = '''Here's what I found:
<tool_call>
{"name": "get_card", "arguments": {"name": "Sol Ring"}}
</tool_call>
Pretty neat right?'''
        brain = AgentBrain.__new__(AgentBrain)
        clean = brain._strip_tool_calls(text)
        assert "<tool_call>" not in clean
        assert "Here's what I found:" in clean
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd Magic && python -m pytest backend/agent/tests/test_brain.py::TestBrainParsing -v`

- [ ] **Step 3: Implement AgentBrain**

```python
# backend/agent/brain.py
"""Core agent orchestration: intent → tools → response."""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

import torch

from backend.agent.memory import WorkingMemory, UserMemory, WorldMemory
from backend.agent.prompts import build_system_prompt, TOOL_CALL_FORMAT
from backend.agent.tools import TOOL_MAP, TOOL_REGISTRY

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 3  # prevent infinite tool loops


class AgentBrain:
    """The MTG Brain — orchestrates conversation, tools, and memory."""

    def __init__(self, model_path: Optional[str] = None):
        from pathlib import Path
        self._model_path = model_path or str(
            Path(__file__).parent.parent.parent / "models" / "Qwen35" / "mtg-scorer-gguf"
        )
        self._model = None
        self._tokenizer = None
        self.user_memory = UserMemory()
        self.world_memory = WorldMemory()
        self._sessions: Dict[str, WorkingMemory] = {}

    def _get_session(self, session_id: str) -> WorkingMemory:
        if session_id not in self._sessions:
            self._sessions[session_id] = WorkingMemory()
        return self._sessions[session_id]

    def _load_model(self):
        if self._model is not None:
            return
        from transformers import AutoModelForCausalLM, AutoTokenizer
        logger.info(f"Loading agent brain from {self._model_path}")
        self._tokenizer = AutoTokenizer.from_pretrained(
            self._model_path, trust_remote_code=True
        )
        self._model = AutoModelForCausalLM.from_pretrained(
            self._model_path, dtype=torch.bfloat16,
            device_map="auto", trust_remote_code=True,
        )
        self._model.eval()

    def _generate(self, messages: List[Dict[str, str]],
                  max_tokens: int = 1024) -> str:
        self._load_model()
        text = self._tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
            enable_thinking=False,
        )
        inputs = self._tokenizer(text, return_tensors="pt").to(self._model.device)
        with torch.no_grad():
            out = self._model.generate(
                **inputs, max_new_tokens=max_tokens,
                temperature=0.7, do_sample=True, repetition_penalty=1.1,
                pad_token_id=self._tokenizer.pad_token_id
                    or self._tokenizer.eos_token_id,
            )
        new_tokens = out[0][inputs["input_ids"].shape[1]:]
        return self._tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

    def _parse_tool_calls(self, text: str) -> List[Dict[str, Any]]:
        calls = []
        for match in re.finditer(
            r"<tool_call>\s*(\{.*?\})\s*</tool_call>", text, re.DOTALL
        ):
            try:
                calls.append(json.loads(match.group(1)))
            except json.JSONDecodeError:
                continue
        return calls

    def _strip_tool_calls(self, text: str) -> str:
        return re.sub(
            r"<tool_call>.*?</tool_call>", "", text, flags=re.DOTALL
        ).strip()

    def _execute_tools(self, calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        results = []
        for call in calls:
            name = call.get("name", "")
            args = call.get("arguments", {})
            fn = TOOL_MAP.get(name)
            if fn is None:
                results.append({"tool": name, "error": f"Unknown tool: {name}"})
                continue
            try:
                result = fn(**args)
                results.append({"tool": name, "result": result})
            except Exception as e:
                results.append({"tool": name, "error": str(e)})
        return results

    def chat(self, message: str, session_id: str = "default",
             user_id: str = "anon") -> str:
        """Process a user message and return the agent's response."""
        wm = self._get_session(session_id)

        # Build context from memory
        user_prefs = self.user_memory.get_all(user_id)
        user_ctx = json.dumps(user_prefs) if user_prefs else "No preferences stored yet."

        # Search world memory for relevant insights
        world_hits = self.world_memory.search(message, limit=3)
        world_ctx = "\n".join(h["content"] for h in world_hits) if world_hits else "None"

        system = build_system_prompt(user_ctx, world_ctx) + "\n\n" + TOOL_CALL_FORMAT

        # Add user message to working memory
        wm.add("user", message)

        # Build messages for the LLM
        messages = [{"role": "system", "content": system}] + wm.get_messages()

        # Agent loop: generate → parse tools → execute → feed results back
        for _ in range(MAX_TOOL_ROUNDS):
            response_text = self._generate(messages)
            tool_calls = self._parse_tool_calls(response_text)

            if not tool_calls:
                # No tools needed — this is the final answer
                break

            # Execute tools and feed results back
            tool_results = self._execute_tools(tool_calls)
            prose = self._strip_tool_calls(response_text)

            # Add assistant's tool-calling turn + results
            messages.append({"role": "assistant", "content": response_text})
            messages.append({
                "role": "user",
                "content": f"Tool results:\n{json.dumps(tool_results, indent=2)}\n\nNow answer based on these results."
            })

        # Clean final response
        final = self._strip_tool_calls(response_text)
        wm.add("assistant", final)
        return final
```

- [ ] **Step 4: Run parsing tests — expect PASS**

Run: `cd Magic && python -m pytest backend/agent/tests/test_brain.py::TestBrainParsing -v`

- [ ] **Step 5: Commit**

```bash
git add backend/agent/brain.py backend/agent/tests/test_brain.py
git commit -m "feat(agent): add agent brain with tool-call loop and memory integration"
```

---

### Task 5: Standalone API Server

**Files:**
- Create: `backend/agent/server.py`

- [ ] **Step 1: Implement server.py**

```python
# backend/agent/server.py
"""Standalone FastAPI server for the MTG Agent Brain.

Run:  python -m backend.agent.server
Listens on port 8100.
"""

import logging
import uuid
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.agent.brain import AgentBrain

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="MTG Brain", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

brain = AgentBrain()


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    user_id: str = "anon"


class ChatResponse(BaseModel):
    response: str
    session_id: str


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())
    response = brain.chat(
        message=req.message,
        session_id=session_id,
        user_id=req.user_id,
    )
    return ChatResponse(response=response, session_id=session_id)


@app.post("/session/{session_id}/clear")
async def clear_session(session_id: str):
    wm = brain._get_session(session_id)
    wm.clear()
    return {"cleared": session_id}


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": brain._model is not None}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8100)
```

- [ ] **Step 2: Test server starts**

Run: `cd Magic && python -m backend.agent.server &` then `curl http://localhost:8100/health`
Expected: `{"status": "ok", "model_loaded": false}`

- [ ] **Step 3: Test chat endpoint**

```bash
curl -X POST http://localhost:8100/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is Sol Ring?", "user_id": "test"}'
```

Expected: JSON response with the agent's answer about Sol Ring.

- [ ] **Step 4: Commit**

```bash
git add backend/agent/server.py
git commit -m "feat(agent): add standalone FastAPI server on port 8100"
```

---

### Task 6: Init File and Integration

**Files:**
- Create: `backend/agent/__init__.py`

- [ ] **Step 1: Write __init__.py**

```python
# backend/agent/__init__.py
"""MTG Agent Brain — autonomous MTG knowledge entity."""

__version__ = "0.1.0"
```

- [ ] **Step 2: Run full test suite**

Run: `cd Magic && python -m pytest backend/agent/tests/ -v`

- [ ] **Step 3: Final commit**

```bash
git add backend/agent/__init__.py
git commit -m "feat(agent): complete MTG agent brain v0.1 — memory, tools, brain, API"
```

---

## Startup Command

```bash
# Activate venv and start the agent
source Magic/.venv/Scripts/activate
cd Magic
python -m backend.agent.server
# → Listening on http://localhost:8100
```

## Future Extensions (not in this plan)
- WebSocket streaming for real-time responses
- Frontend "Ask the Brain" chat panel
- Discord bot connector
- Cloud deployment with GPU rental
- Fine-tune the brain model on conversation data
- Embed world memory with FAISS for semantic search (not just LIKE queries)
