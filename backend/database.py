"""SQLite database for storing generated decks and card images."""

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

DATABASE_PATH = Path(__file__).parent.parent / "data" / "decks.db"
IMAGES_DATABASE_PATH = Path(__file__).parent.parent / "data" / "card_images.db"
PRICE_HISTORY_PATH = Path(__file__).parent.parent / "data" / "price_history.db"


def init_db():
    """Initialize the database and create tables if they don't exist."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS decks (
                id TEXT PRIMARY KEY,
                commander TEXT NOT NULL,
                colors TEXT NOT NULL,
                bracket INTEGER NOT NULL,
                bracket_name TEXT,
                theme TEXT,
                archetype TEXT,
                card_count INTEGER,
                estimated_price TEXT,
                cards TEXT NOT NULL,
                categories TEXT,
                format TEXT DEFAULT 'commander',
                sideboard TEXT DEFAULT '[]',
                generation_method TEXT,
                model_scoring INTEGER DEFAULT 0,
                synergy_queries TEXT DEFAULT '[]',
                legal_status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                parent_deck_id TEXT,
                regeneration_number INTEGER DEFAULT 0
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_decks_created
            ON decks(created_at DESC)
        """)
        # Migration: add new columns if they don't exist
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN parent_deck_id TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN regeneration_number INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Column already exists
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN format TEXT DEFAULT 'commander'")
        except sqlite3.OperationalError:
            pass  # Column already exists
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN sideboard TEXT DEFAULT '[]'")
        except sqlite3.OperationalError:
            pass  # Column already exists
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN generation_method TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN model_scoring INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Column already exists
        try:
            conn.execute("ALTER TABLE decks ADD COLUMN synergy_queries TEXT DEFAULT '[]'")
        except sqlite3.OperationalError:
            pass  # Column already exists
        conn.commit()


def init_images_db():
    """Initialize the card images database."""
    IMAGES_DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_images_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS card_images (
                card_name TEXT NOT NULL,
                set_code TEXT NOT NULL,
                size TEXT NOT NULL,
                image_data BLOB NOT NULL,
                content_type TEXT DEFAULT 'image/jpeg',
                downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (card_name, set_code, size)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_card_images_name
            ON card_images(card_name)
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS download_progress (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                total_cards INTEGER DEFAULT 0,
                downloaded_cards INTEGER DEFAULT 0,
                last_card_name TEXT,
                started_at TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.commit()


@contextmanager
def get_images_connection():
    """Get a connection to the images database."""
    conn = sqlite3.connect(IMAGES_DATABASE_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def get_connection():
    """Get a database connection with context manager."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def save_deck(deck_data: dict) -> str:
    """Save a deck to the database. Returns the deck ID."""
    with get_connection() as conn:
        conn.execute("""
            INSERT INTO decks (
                id, commander, colors, bracket, bracket_name, theme,
                archetype, card_count, estimated_price, cards, categories,
                format, sideboard, generation_method, model_scoring,
                synergy_queries, legal_status, created_at, parent_deck_id,
                regeneration_number
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            deck_data['id'],
            deck_data['commander'],
            json.dumps(deck_data['colors']),
            deck_data['bracket'],
            deck_data.get('bracket_name', ''),
            deck_data.get('theme', ''),
            deck_data.get('archetype', ''),
            deck_data.get('card_count', 0),
            deck_data.get('estimated_price', ''),
            json.dumps(deck_data['list']),
            json.dumps(deck_data.get('categories', {})),
            deck_data.get('format', 'commander'),
            json.dumps(deck_data.get('sideboard', [])),
            deck_data.get('generation_method'),
            1 if deck_data.get('model_scoring') else 0,
            json.dumps(deck_data.get('synergy_queries', [])),
            deck_data.get('legal_status', ''),
            deck_data.get('timestamp', datetime.now().isoformat()),
            deck_data.get('parent_deck_id'),
            deck_data.get('regeneration_number', 0),
        ))
        conn.commit()
    return deck_data['id']


def get_deck(deck_id: str) -> Optional[dict]:
    """Fetch a deck by ID. Returns None if not found."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT * FROM decks WHERE id = ?", (deck_id,)
        ).fetchone()

        if not row:
            return None

        return _row_to_deck(row)


def get_recent_decks(limit: int = 20) -> list[dict]:
    """Fetch the most recently created decks."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM decks ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()

        return [_row_to_deck(row) for row in rows]


def get_decks_by_ids(deck_ids: list[str]) -> list[dict]:
    """Fetch multiple decks by their IDs."""
    if not deck_ids:
        return []

    placeholders = ",".join("?" * len(deck_ids))
    with get_connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM decks WHERE id IN ({placeholders})",
            deck_ids
        ).fetchall()

        # Return in the order requested
        deck_map = {_row_to_deck(row)['id']: _row_to_deck(row) for row in rows}
        return [deck_map[did] for did in deck_ids if did in deck_map]


def _row_to_deck(row: sqlite3.Row) -> dict:
    """Convert a database row to a deck dictionary."""
    return {
        'id': row['id'],
        'commander': row['commander'],
        'colors': json.loads(row['colors']),
        'bracket': row['bracket'],
        'bracket_name': row['bracket_name'] or '',
        'theme': row['theme'] or '',
        'archetype': row['archetype'] or '',
        'card_count': row['card_count'] or 0,
        'estimated_price': row['estimated_price'] or '',
        'list': json.loads(row['cards']),
        'categories': json.loads(row['categories']) if row['categories'] else {},
        'format': row['format'] if 'format' in row.keys() else 'commander',
        'sideboard': json.loads(row['sideboard']) if 'sideboard' in row.keys() and row['sideboard'] else [],
        'generation_method': row['generation_method'] if 'generation_method' in row.keys() else None,
        'model_scoring': bool(row['model_scoring']) if 'model_scoring' in row.keys() else False,
        'synergy_queries': json.loads(row['synergy_queries']) if 'synergy_queries' in row.keys() and row['synergy_queries'] else [],
        'legal_status': row['legal_status'] or '',
        'timestamp': row['created_at'],
        'parent_deck_id': row['parent_deck_id'] if 'parent_deck_id' in row.keys() else None,
        'regeneration_number': row['regeneration_number'] if 'regeneration_number' in row.keys() else 0,
    }


# Card Image Functions

def save_card_image(card_name: str, set_code: str, size: str, image_data: bytes, content_type: str = 'image/jpeg'):
    """Save a card image to the database."""
    with get_images_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO card_images (card_name, set_code, size, image_data, content_type, downloaded_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (card_name.lower(), set_code.lower(), size, image_data, content_type, datetime.now().isoformat()))
        conn.commit()


def get_card_image(card_name: str, set_code: Optional[str] = None, size: str = 'normal') -> Optional[tuple[bytes, str]]:
    """
    Get a card image from the database.
    Returns (image_data, content_type) or None if not found.
    If set_code is None, returns any available printing.
    """
    with get_images_connection() as conn:
        if set_code:
            row = conn.execute("""
                SELECT image_data, content_type FROM card_images
                WHERE card_name = ? AND set_code = ? AND size = ?
            """, (card_name.lower(), set_code.lower(), size)).fetchone()
        else:
            row = conn.execute("""
                SELECT image_data, content_type FROM card_images
                WHERE card_name = ? AND size = ?
                LIMIT 1
            """, (card_name.lower(), size)).fetchone()

        if row:
            return (row['image_data'], row['content_type'])
        return None


def get_card_printings_from_cache(card_name: str) -> list[str]:
    """Get all cached set codes for a card."""
    with get_images_connection() as conn:
        rows = conn.execute("""
            SELECT DISTINCT set_code FROM card_images
            WHERE card_name = ? AND size = 'normal'
            ORDER BY downloaded_at DESC
        """, (card_name.lower(),)).fetchall()
        return [row['set_code'] for row in rows]


def has_card_image(card_name: str, set_code: str, size: str = 'normal') -> bool:
    """Check if a card image exists in the database."""
    with get_images_connection() as conn:
        row = conn.execute("""
            SELECT 1 FROM card_images
            WHERE card_name = ? AND set_code = ? AND size = ?
        """, (card_name.lower(), set_code.lower(), size)).fetchone()
        return row is not None


def get_image_stats() -> dict:
    """Get statistics about the image database."""
    with get_images_connection() as conn:
        total = conn.execute("SELECT COUNT(*) as count FROM card_images").fetchone()['count']
        unique_cards = conn.execute("SELECT COUNT(DISTINCT card_name) as count FROM card_images").fetchone()['count']
        normal_count = conn.execute("SELECT COUNT(*) as count FROM card_images WHERE size = 'normal'").fetchone()['count']
        small_count = conn.execute("SELECT COUNT(*) as count FROM card_images WHERE size = 'small'").fetchone()['count']

        # Get progress if download is in progress
        progress = conn.execute("SELECT * FROM download_progress WHERE id = 1").fetchone()

        return {
            'total_images': total,
            'unique_cards': unique_cards,
            'normal_images': normal_count,
            'small_images': small_count,
            'download_progress': {
                'total_cards': progress['total_cards'] if progress else 0,
                'downloaded_cards': progress['downloaded_cards'] if progress else 0,
                'last_card': progress['last_card_name'] if progress else None,
                'started_at': progress['started_at'] if progress else None,
            } if progress else None
        }


def update_download_progress(total: int, downloaded: int, last_card: str):
    """Update the download progress tracker."""
    with get_images_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO download_progress (id, total_cards, downloaded_cards, last_card_name, started_at, updated_at)
            VALUES (1, ?, ?, ?, COALESCE((SELECT started_at FROM download_progress WHERE id = 1), ?), ?)
        """, (total, downloaded, last_card, datetime.now().isoformat(), datetime.now().isoformat()))
        conn.commit()


# Price History Functions

def init_price_history_db():
    """Initialize the price history database."""
    PRICE_HISTORY_PATH.parent.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(PRICE_HISTORY_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            card_name TEXT NOT NULL,
            source TEXT NOT NULL,
            price_usd REAL,
            recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_price_card_source
        ON price_history(card_name, source)
    """)
    conn.commit()
    conn.close()


@contextmanager
def get_price_history_connection():
    """Get a connection to the price history database."""
    conn = sqlite3.connect(PRICE_HISTORY_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def save_price_history(card_name: str, source: str, price_usd: float):
    """Save a price entry to history."""
    with get_price_history_connection() as conn:
        conn.execute("""
            INSERT INTO price_history (card_name, source, price_usd)
            VALUES (?, ?, ?)
        """, (card_name.lower(), source.lower(), price_usd))
        conn.commit()


def get_price_history(card_name: str, source: str = None, limit: int = 30) -> list:
    """Get price history for a card."""
    with get_price_history_connection() as conn:
        if source:
            rows = conn.execute("""
                SELECT source, price_usd, recorded_at
                FROM price_history
                WHERE card_name = ? AND source = ?
                ORDER BY recorded_at DESC
                LIMIT ?
            """, (card_name.lower(), source.lower(), limit)).fetchall()
        else:
            rows = conn.execute("""
                SELECT source, price_usd, recorded_at
                FROM price_history
                WHERE card_name = ?
                ORDER BY recorded_at DESC
                LIMIT ?
            """, (card_name.lower(), limit)).fetchall()

        return [dict(row) for row in rows]


def get_latest_prices(card_name: str) -> dict:
    """Get the most recent price from each source for a card."""
    with get_price_history_connection() as conn:
        rows = conn.execute("""
            SELECT source, price_usd, recorded_at
            FROM price_history p1
            WHERE card_name = ?
            AND recorded_at = (
                SELECT MAX(recorded_at)
                FROM price_history p2
                WHERE p2.card_name = p1.card_name AND p2.source = p1.source
            )
        """, (card_name.lower(),)).fetchall()

        return {row['source']: {'usd': row['price_usd'], 'updated': row['recorded_at']} for row in rows}
