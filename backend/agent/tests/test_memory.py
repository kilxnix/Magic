"""Tests for the three-tier memory system."""

from __future__ import annotations

import os
import unittest
from pathlib import Path

from backend.agent.memory import DATA_DIR, UserMemory, WorkingMemory, WorldMemory


# ---------------------------------------------------------------------------
# Tier 1 — WorkingMemory
# ---------------------------------------------------------------------------

class TestWorkingMemory(unittest.TestCase):
    """Tests for the in-memory conversation buffer."""

    def test_add_and_retrieve(self) -> None:
        wm = WorkingMemory()
        wm.add("user", "hello")
        wm.add("assistant", "hi there")
        msgs = wm.get_messages()
        self.assertEqual(len(msgs), 2)
        self.assertEqual(msgs[0], {"role": "user", "content": "hello"})
        self.assertEqual(msgs[1], {"role": "assistant", "content": "hi there"})

    def test_truncation_at_max_messages(self) -> None:
        wm = WorkingMemory(max_messages=3)
        for i in range(5):
            wm.add("user", f"msg-{i}")
        msgs = wm.get_messages()
        self.assertEqual(len(msgs), 3)
        # Oldest two should have been dropped
        self.assertEqual(msgs[0]["content"], "msg-2")
        self.assertEqual(msgs[2]["content"], "msg-4")

    def test_clear(self) -> None:
        wm = WorkingMemory()
        wm.add("user", "a")
        wm.clear()
        self.assertEqual(wm.get_messages(), [])

    def test_get_context_string(self) -> None:
        wm = WorkingMemory()
        wm.add("user", "What is Brainstorm?")
        wm.add("assistant", "A powerful blue instant.")
        ctx = wm.get_context_string()
        self.assertIn("user: What is Brainstorm?", ctx)
        self.assertIn("assistant: A powerful blue instant.", ctx)


# ---------------------------------------------------------------------------
# Tier 2 — UserMemory
# ---------------------------------------------------------------------------

class TestUserMemory(unittest.TestCase):
    """Tests for per-user SQLite preferences."""

    DB_PATH = DATA_DIR / "test_agent_memory.db"

    def setUp(self) -> None:
        # Ensure a fresh database for every test
        if self.DB_PATH.exists():
            os.remove(self.DB_PATH)
        self.mem = UserMemory(db_path=self.DB_PATH)

    def tearDown(self) -> None:
        self.mem.close()
        if self.DB_PATH.exists():
            os.remove(self.DB_PATH)
        # Also clean up any WAL/SHM files
        for suffix in ("-wal", "-shm"):
            p = Path(str(self.DB_PATH) + suffix)
            if p.exists():
                os.remove(p)

    def test_set_and_get(self) -> None:
        self.mem.set("u1", "format", "commander")
        self.assertEqual(self.mem.get("u1", "format"), "commander")

    def test_missing_returns_default(self) -> None:
        self.assertIsNone(self.mem.get("u1", "nope"))
        self.assertEqual(self.mem.get("u1", "nope", "fallback"), "fallback")

    def test_get_all(self) -> None:
        self.mem.set("u1", "format", "modern")
        self.mem.set("u1", "color", "blue")
        prefs = self.mem.get_all("u1")
        self.assertEqual(prefs, {"format": "modern", "color": "blue"})

    def test_update_overwrites(self) -> None:
        self.mem.set("u1", "format", "standard")
        self.mem.set("u1", "format", "legacy")
        self.assertEqual(self.mem.get("u1", "format"), "legacy")

    def test_delete(self) -> None:
        self.mem.set("u1", "format", "pauper")
        self.mem.delete("u1", "format")
        self.assertIsNone(self.mem.get("u1", "format"))


# ---------------------------------------------------------------------------
# Tier 3 — WorldMemory
# ---------------------------------------------------------------------------

class TestWorldMemory(unittest.TestCase):
    """Tests for shared MTG insights in SQLite."""

    DB_PATH = DATA_DIR / "test_agent_world.db"

    def setUp(self) -> None:
        if self.DB_PATH.exists():
            os.remove(self.DB_PATH)
        self.mem = WorldMemory(db_path=self.DB_PATH)

    def tearDown(self) -> None:
        self.mem.close()
        if self.DB_PATH.exists():
            os.remove(self.DB_PATH)
        for suffix in ("-wal", "-shm"):
            p = Path(str(self.DB_PATH) + suffix)
            if p.exists():
                os.remove(p)

    def test_add_and_search(self) -> None:
        self.mem.add("Lightning Bolt is premium red removal", "strategy")
        results = self.mem.search("Lightning")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["category"], "strategy")
        self.assertIn("Lightning Bolt", results[0]["content"])

    def test_add_with_tags_and_search_by_tag(self) -> None:
        self.mem.add(
            "Counterspell is the gold standard of countermagic",
            "strategy",
            tags=["blue", "control", "instant"],
        )
        results = self.mem.search_by_tag("control")
        self.assertEqual(len(results), 1)
        self.assertIn("control", results[0]["tags"])

    def test_dedup(self) -> None:
        id1 = self.mem.add("Unique insight", "meta")
        id2 = self.mem.add("Unique insight", "meta")
        self.assertEqual(id1, id2)
        # Only one row should exist
        results = self.mem.search("Unique insight")
        self.assertEqual(len(results), 1)


if __name__ == "__main__":
    unittest.main()
