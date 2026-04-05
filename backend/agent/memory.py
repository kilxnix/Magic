"""Three-tier memory system for the MTG knowledge agent.

Tiers:
    WorkingMemory  — ephemeral, in-memory conversation buffer
    UserMemory     — per-user preferences persisted in SQLite
    WorldMemory    — shared MTG insights persisted in SQLite
"""

from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

# Resolve <project_root>/data regardless of cwd
DATA_DIR = Path(__file__).parent.parent.parent / "data"


# ---------------------------------------------------------------------------
# Tier 1 — Working Memory (ephemeral conversation context)
# ---------------------------------------------------------------------------

class WorkingMemory:
    """In-memory conversation buffer that auto-truncates to *max_messages*."""

    def __init__(self, max_messages: int = 40) -> None:
        self.max_messages = max_messages
        self._messages: list[dict[str, str]] = []

    # -- public API ---------------------------------------------------------

    def add(self, role: str, content: str) -> None:
        """Append a message and truncate the oldest if over capacity."""
        self._messages.append({"role": role, "content": content})
        if len(self._messages) > self.max_messages:
            self._messages = self._messages[-self.max_messages :]

    def get_messages(self) -> list[dict[str, str]]:
        """Return a copy of the current message buffer."""
        return list(self._messages)

    def get_context_string(self) -> str:
        """Return all messages as a single formatted string."""
        parts: list[str] = []
        for msg in self._messages:
            parts.append(f"{msg['role']}: {msg['content']}")
        return "\n".join(parts)

    def clear(self) -> None:
        """Drop every message in the buffer."""
        self._messages.clear()


# ---------------------------------------------------------------------------
# Tier 2 — User Memory (per-user prefs in SQLite)
# ---------------------------------------------------------------------------

class UserMemory:
    """Per-user preferences stored in SQLite.

    Default DB path: ``<project_root>/data/agent_memory.db``
    """

    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path = db_path or (DATA_DIR / "agent_memory.db")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._create_table()

    def _create_table(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_prefs (
                user_id  TEXT NOT NULL,
                key      TEXT NOT NULL,
                value    TEXT,
                updated  REAL,
                PRIMARY KEY (user_id, key)
            )
            """
        )
        self._conn.commit()

    # -- public API ---------------------------------------------------------

    def set(self, user_id: str, key: str, value: str) -> None:
        """Insert or update a preference for *user_id*."""
        self._conn.execute(
            """
            INSERT INTO user_prefs (user_id, key, value, updated)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, key) DO UPDATE
                SET value = excluded.value,
                    updated = excluded.updated
            """,
            (user_id, key, value, time.time()),
        )
        self._conn.commit()

    def get(self, user_id: str, key: str, default: Any = None) -> Any:
        """Retrieve a single preference, returning *default* if missing."""
        row = self._conn.execute(
            "SELECT value FROM user_prefs WHERE user_id = ? AND key = ?",
            (user_id, key),
        ).fetchone()
        return row[0] if row else default

    def get_all(self, user_id: str) -> dict[str, str]:
        """Return every preference for *user_id* as ``{key: value}``."""
        rows = self._conn.execute(
            "SELECT key, value FROM user_prefs WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {k: v for k, v in rows}

    def delete(self, user_id: str, key: str) -> None:
        """Remove a single preference."""
        self._conn.execute(
            "DELETE FROM user_prefs WHERE user_id = ? AND key = ?",
            (user_id, key),
        )
        self._conn.commit()

    def close(self) -> None:
        """Close the underlying database connection."""
        self._conn.close()


# ---------------------------------------------------------------------------
# Tier 3 — World Memory (shared MTG insights in SQLite)
# ---------------------------------------------------------------------------

class WorldMemory:
    """Shared MTG insights stored in SQLite.

    Default DB path: ``<project_root>/data/agent_world.db``
    """

    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path = db_path or (DATA_DIR / "agent_world.db")
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(self.db_path))
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._create_table()

    def _create_table(self) -> None:
        self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS insights (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                content  TEXT UNIQUE NOT NULL,
                category TEXT,
                tags     TEXT DEFAULT '[]',
                created  REAL
            )
            """
        )
        self._conn.commit()

    # -- public API ---------------------------------------------------------

    def add(self, content: str, category: str, tags: Optional[list[str]] = None) -> int:
        """Store an insight.  Returns the row id.

        Duplicate *content* is silently ignored (UNIQUE constraint).
        """
        tags_json = json.dumps(tags or [])
        try:
            cur = self._conn.execute(
                """
                INSERT INTO insights (content, category, tags, created)
                VALUES (?, ?, ?, ?)
                """,
                (content, category, tags_json, time.time()),
            )
            self._conn.commit()
            return cur.lastrowid  # type: ignore[return-value]
        except sqlite3.IntegrityError:
            # Duplicate content — return the existing row's id
            row = self._conn.execute(
                "SELECT id FROM insights WHERE content = ?", (content,)
            ).fetchone()
            return row[0]  # type: ignore[index]

    def search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """Simple substring search across *content* and *category*."""
        rows = self._conn.execute(
            """
            SELECT id, content, category, tags, created
            FROM insights
            WHERE content LIKE ? OR category LIKE ?
            ORDER BY created DESC
            LIMIT ?
            """,
            (f"%{query}%", f"%{query}%", limit),
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def search_by_tag(self, tag: str, limit: int = 10) -> list[dict[str, Any]]:
        """Return insights whose *tags* JSON array contains *tag*."""
        rows = self._conn.execute(
            """
            SELECT id, content, category, tags, created
            FROM insights
            WHERE tags LIKE ?
            ORDER BY created DESC
            LIMIT ?
            """,
            (f'%"{tag}"%', limit),
        ).fetchall()
        return [self._row_to_dict(r) for r in rows]

    def close(self) -> None:
        """Close the underlying database connection."""
        self._conn.close()

    # -- helpers ------------------------------------------------------------

    @staticmethod
    def _row_to_dict(row: tuple) -> dict[str, Any]:
        return {
            "id": row[0],
            "content": row[1],
            "category": row[2],
            "tags": json.loads(row[3]),
            "created": row[4],
        }
