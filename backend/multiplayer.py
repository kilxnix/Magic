"""In-memory multiplayer room lobby for private Commander tables.

This is the first multiplayer slice: room discovery, passwords, seating,
ready checks, and chat. The actual shared game engine should be attached to
the room once the server-authoritative gameplay layer is ready.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, List, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/multiplayer", tags=["multiplayer"])

RoomStatus = Literal["waiting", "in_game", "closed"]
RoomTier = Literal["free", "tournament"]
RoomNamespace = Literal["public", "qa"]
GameStatus = Literal["playing", "finished"]
GamePhase = Literal["beginning", "main", "combat", "ending"]
EventFormat = Literal["swiss", "single_elim", "round_robin", "league", "draft", "sealed"]
EventStatus = Literal["setup", "running", "complete"]
GameAction = Literal[
    "draw_card",
    "play_permanent",
    "remove_permanent",
    "gain_life",
    "lose_life",
    "set_phase",
    "pass_turn",
    "concede",
    "note",
    "player_note",
    "commander_damage",
    "commander_tax",
    "poison",
    "adjust_counter",
    "set_monarch",
    "clear_monarch",
    "set_initiative",
    "clear_initiative",
    "create_token",
    "add_board_object",
    "add_object_counter",
    "tap_object",
    "move_to_graveyard",
    "move_to_exile",
    "move_to_command",
    "discard_card",
    "exile_from_hand",
    "return_to_hand",
    "return_to_battlefield",
    "undo",
]
PublicZone = Literal["graveyard", "exile", "command"]

MAX_FREE_PLAYERS = 4
MAX_TAGS = 5
MAX_CHAT_MESSAGES = 100
MAX_GAME_LOG = 200
MAX_REPLAY_EVENTS = 500
MAX_REPLAY_ANNOTATIONS = 80
MAX_DECK_CARDS = 120
MAX_PENDING_REAL_ACTIONS = 80
MAX_REAL_GAME_ACTION_BYTES = int(os.getenv("MULTIPLAYER_MAX_ACTION_BYTES", "4000"))
MAX_REAL_GAME_VIEW_BYTES = int(os.getenv("MULTIPLAYER_MAX_VIEW_BYTES", "120000"))
MAX_SPECTATORS = int(os.getenv("MULTIPLAYER_MAX_SPECTATORS", "12"))
REAL_AUTHORITY_STALE_SECONDS = int(os.getenv("MULTIPLAYER_AUTHORITY_STALE_SECONDS", "30"))
MAX_EVENT_PLAYERS = int(os.getenv("MULTIPLAYER_MAX_EVENT_PLAYERS", "64"))
MAX_EVENT_ANNOUNCEMENTS = 80
ROOM_EXPIRY = timedelta(hours=12)
REAL_AUTHORITY_STALE_AFTER = timedelta(seconds=REAL_AUTHORITY_STALE_SECONDS)
ROOM_STORE_PATH = Path(os.getenv("MULTIPLAYER_ROOM_STORE", "/app/runtime/multiplayer_rooms.json"))
EVENT_STORE_PATH = Path(os.getenv("MULTIPLAYER_EVENT_STORE", "/app/runtime/multiplayer_events.json"))
ENGINE_UNSUPPORTED_CARD_NAMES = {
    "Chaos Orb",
    "Falling Star",
    "Shahrazad",
}
ROOM_LINK_RE = re.compile(
    r"(?i)(?:"
    r"https?://|"
    r"www\.|"
    r"\b(?:discord\.gg|t\.me|bit\.ly|tinyurl\.com)\b|"
    r"\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?"
    r"(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*"
    r"\.[a-z]{2,24}(?:[/?#]\S*)?"
    r")"
)
CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
SAFE_ACTION_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,96}$")
ROOM_MODERATION_MESSAGE = "Message removed by room moderation."
SEXUAL_CONTENT_RE = re.compile(
    r"(?i)\b("
    r"sex|sexual|sext|porn|porno|nude|nudes|naked|nsfw|"
    r"penis|dick|cock|vagina|pussy|boob|boobs|tits|"
    r"blowjob|handjob|cum|semen|orgasm|masturbat(?:e|ion)|fetish|rape"
    r")\b"
)
HARASSMENT_RE = re.compile(
    r"(?i)("
    r"\b(?:kill\s+yourself|kys|go\s+die|die\s+in\s+a\s+fire)\b|"
    r"\b(?:retard|retarded|faggot|fag|tranny|cunt|nigger|nigga|kike|spic|chink|gook|wetback)\b|"
    r"\b(?:worthless|subhuman)\b"
    r")"
)
REPEATED_CHARACTER_RE = re.compile(r"(.)\1{11,}")

_rooms: dict[str, dict] = {}
_events: dict[str, dict] = {}
_lock = threading.RLock()


def _default_room_settings() -> dict[str, Any]:
    return {
        "spectators_allowed": True,
        "spectator_delay_seconds": 0,
        "scheduled_for": None,
        "table_note": "",
    }


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | str) -> str:
    if isinstance(value, str):
        return value
    return value.isoformat()


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def _json_room(room: dict) -> dict:
    def convert(value):
        if isinstance(value, datetime):
            return _iso(value)
        if isinstance(value, list):
            return [convert(item) for item in value]
        if isinstance(value, dict):
            return {key: convert(item) for key, item in value.items()}
        return value

    return convert(room)


def _load_rooms_from_disk() -> None:
    if not ROOM_STORE_PATH.exists():
        return
    try:
        raw_rooms = json.loads(ROOM_STORE_PATH.read_text(encoding="utf-8"))
        for room_id, room in raw_rooms.items():
            room["created_at"] = _parse_datetime(room["created_at"])
            room["updated_at"] = _parse_datetime(room["updated_at"])
            room.setdefault("settings", _default_room_settings())
            room["settings"] = {**_default_room_settings(), **(room.get("settings") or {})}
            room.setdefault("spectators", [])
            for spectator in room.get("spectators", []):
                spectator["joined_at"] = _parse_datetime(spectator["joined_at"])
            for message in room.get("chat", []):
                message["created_at"] = _parse_datetime(message["created_at"])
            game = room.get("game")
            if game:
                game["created_at"] = _parse_datetime(game["created_at"])
                game["updated_at"] = _parse_datetime(game["updated_at"])
                for entry in game.get("log", []):
                    entry["created_at"] = _parse_datetime(entry["created_at"])
                for event in game.get("replay_events", []):
                    event["created_at"] = _parse_datetime(event["created_at"])
                for annotation in game.get("replay_annotations", []):
                    annotation["created_at"] = _parse_datetime(annotation["created_at"])
            real_game = room.get("real_game")
            if real_game:
                real_game["created_at"] = _parse_datetime(real_game["created_at"])
                real_game["updated_at"] = _parse_datetime(real_game["updated_at"])
                if real_game.get("authority_last_seen_at"):
                    real_game["authority_last_seen_at"] = _parse_datetime(real_game["authority_last_seen_at"])
                for action in real_game.get("pending_actions", []):
                    action["created_at"] = _parse_datetime(action["created_at"])
                for action in real_game.get("resolved_actions", []):
                    action["created_at"] = _parse_datetime(action["created_at"])
                    if action.get("resolved_at"):
                        action["resolved_at"] = _parse_datetime(action["resolved_at"])
                for entry in real_game.get("log", []):
                    entry["created_at"] = _parse_datetime(entry["created_at"])
            _rooms[room_id] = room
    except Exception:
        _rooms.clear()


def _save_rooms_locked() -> None:
    try:
        ROOM_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({room_id: _json_room(room) for room_id, room in _rooms.items()})
        tmp_path = ROOM_STORE_PATH.with_suffix(f"{ROOM_STORE_PATH.suffix}.tmp")
        backup_path = ROOM_STORE_PATH.with_suffix(f"{ROOM_STORE_PATH.suffix}.bak")
        if ROOM_STORE_PATH.exists():
            try:
                backup_path.write_text(ROOM_STORE_PATH.read_text(encoding="utf-8"), encoding="utf-8")
            except Exception:
                pass
        tmp_path.write_text(
            payload,
            encoding="utf-8",
        )
        tmp_path.replace(ROOM_STORE_PATH)
    except Exception:
        # Lobby persistence should never make a room action fail.
        pass


def _load_events_from_disk() -> None:
    if not EVENT_STORE_PATH.exists():
        return
    try:
        raw_events = json.loads(EVENT_STORE_PATH.read_text(encoding="utf-8"))
        for event_id, event in raw_events.items():
            event["created_at"] = _parse_datetime(event["created_at"])
            event["updated_at"] = _parse_datetime(event["updated_at"])
            if event.get("started_at"):
                event["started_at"] = _parse_datetime(event["started_at"])
            if event.get("completed_at"):
                event["completed_at"] = _parse_datetime(event["completed_at"])
            for player in event.get("players", []):
                player["registered_at"] = _parse_datetime(player["registered_at"])
            for announcement in event.get("announcements", []):
                announcement["created_at"] = _parse_datetime(announcement["created_at"])
            for highlight in event.get("highlights", []):
                highlight["created_at"] = _parse_datetime(highlight["created_at"])
            _events[event_id] = event
    except Exception:
        _events.clear()


def _save_events_locked() -> None:
    try:
        EVENT_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps({event_id: _json_room(event) for event_id, event in _events.items()})
        tmp_path = EVENT_STORE_PATH.with_suffix(f"{EVENT_STORE_PATH.suffix}.tmp")
        backup_path = EVENT_STORE_PATH.with_suffix(f"{EVENT_STORE_PATH.suffix}.bak")
        if EVENT_STORE_PATH.exists():
            try:
                backup_path.write_text(EVENT_STORE_PATH.read_text(encoding="utf-8"), encoding="utf-8")
            except Exception:
                pass
        tmp_path.write_text(payload, encoding="utf-8")
        tmp_path.replace(EVENT_STORE_PATH)
    except Exception:
        # Event persistence should not make organizer actions fail.
        pass


def _reject_links(value: str, *, field_name: str) -> None:
    if ROOM_LINK_RE.search(value):
        raise HTTPException(status_code=400, detail=f"{field_name} cannot contain links")


def _clean_public_text(value: str, *, field_name: str, max_length: int, min_length: int = 1) -> str:
    cleaned = CONTROL_CHARS_RE.sub("", str(value))
    cleaned = re.sub(r"\s+", " ", cleaned.strip())
    if len(cleaned) < min_length:
        raise HTTPException(status_code=400, detail=f"{field_name} must be at least {min_length} characters")
    if len(cleaned) > max_length:
        raise HTTPException(status_code=400, detail=f"{field_name} must be {max_length} characters or fewer")
    _reject_links(cleaned, field_name=field_name)
    return cleaned


def _reject_room_chat_for_moderation(message: str) -> None:
    if ROOM_LINK_RE.search(message):
        raise HTTPException(status_code=400, detail=ROOM_MODERATION_MESSAGE)
    if SEXUAL_CONTENT_RE.search(message):
        raise HTTPException(status_code=400, detail=ROOM_MODERATION_MESSAGE)
    if HARASSMENT_RE.search(message):
        raise HTTPException(status_code=400, detail=ROOM_MODERATION_MESSAGE)
    compact = re.sub(r"\s+", "", message.lower())
    if REPEATED_CHARACTER_RE.search(compact):
        raise HTTPException(status_code=400, detail=ROOM_MODERATION_MESSAGE)
    tokens = re.findall(r"[a-z0-9]{2,}", message.lower())
    if tokens:
        run_token = tokens[0]
        run_length = 0
        for token in tokens:
            if token == run_token:
                run_length += 1
            else:
                run_token = token
                run_length = 1
            if run_length >= 6:
                raise HTTPException(status_code=400, detail=ROOM_MODERATION_MESSAGE)


def _clean_chat_message(value: str) -> str:
    cleaned = CONTROL_CHARS_RE.sub("", str(value))
    cleaned = re.sub(r"\s+", " ", cleaned.strip())
    if len(cleaned) < 1:
        raise HTTPException(status_code=400, detail="Message must be at least 1 characters")
    if len(cleaned) > 500:
        raise HTTPException(status_code=400, detail="Message must be 500 characters or fewer")
    _reject_room_chat_for_moderation(cleaned)
    return cleaned


def _clean_name(value: str, *, field_name: str, max_length: int) -> str:
    return _clean_public_text(value, field_name=field_name, max_length=max_length, min_length=2)


def _clean_tags(tags: list[str]) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for tag in tags[:MAX_TAGS]:
        _reject_links(str(tag), field_name="Room tag")
        normalized = re.sub(r"[^a-zA-Z0-9 -]", "", str(tag)).strip().lower().replace(" ", "-")
        normalized = re.sub(r"-+", "-", normalized)
        if not normalized or normalized in seen:
            continue
        if len(normalized) > 18:
            normalized = normalized[:18].rstrip("-")
        cleaned.append(normalized)
        seen.add(normalized)
    return cleaned


def _make_room_id() -> str:
    while True:
        room_id = secrets.token_urlsafe(5).replace("_", "").replace("-", "")[:8].lower()
        if room_id not in _rooms:
            return room_id


def _hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode("utf-8")).hexdigest()


def _password_record(password: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    if not password:
        return None, None
    if len(password) < 4 or len(password) > 64:
        raise HTTPException(status_code=400, detail="Room password must be 4-64 characters")
    salt = secrets.token_hex(16)
    return salt, _hash_password(password, salt)


def _check_password(room: dict, password: Optional[str]) -> None:
    expected = room.get("password_hash")
    salt = room.get("password_salt")
    if not expected:
        return
    if not password or not salt:
        raise HTTPException(status_code=403, detail="Room password required")
    if not secrets.compare_digest(_hash_password(password, salt), expected):
        raise HTTPException(status_code=403, detail="Incorrect room password")


def _cleanup_rooms_locked() -> None:
    cutoff = _now() - ROOM_EXPIRY
    expired = [
        room_id
        for room_id, room in _rooms.items()
        if room["updated_at"] < cutoff or room["status"] == "closed"
    ]
    for room_id in expired:
        _rooms.pop(room_id, None)
    if expired:
        _save_rooms_locked()


def _occupied_seats(room: dict) -> list[dict]:
    return [seat for seat in room["seats"] if seat.get("player_id")]


def _find_room(room_id: str) -> dict:
    with _lock:
        _cleanup_rooms_locked()
        room = _rooms.get(room_id)
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        return room


def _find_player(room: dict, player_id: str) -> dict:
    for seat in room["seats"]:
        if seat.get("player_id") == player_id:
            return seat
    raise HTTPException(status_code=403, detail="Player is not seated in this room")


def _add_chat(room: dict, player_name: str, message: str, *, system: bool = False) -> None:
    room["chat"].append(
        {
            "id": secrets.token_urlsafe(8),
            "player_name": player_name,
            "message": message,
            "system": system,
            "created_at": _now(),
        }
    )
    room["chat"] = room["chat"][-MAX_CHAT_MESSAGES:]
    room["updated_at"] = _now()


def _occupied_game_players(room: dict) -> list[dict]:
    return [
        {
            "player_id": seat["player_id"],
            "seat": seat["seat"],
            "name": seat["name"],
            "deck_name": seat.get("deck_name"),
            "commander": seat.get("commander"),
            "life": 40,
            "hand_count": 7,
            "library_count": 92,
            "battlefield_count": 0,
            "graveyard_count": 0,
            "exile_count": 0,
            "command_zone_count": 1 if seat.get("commander") else 0,
            "commander_tax": 0,
            "poison_count": 0,
            "commander_damage": {},
            "custom_counters": {"energy": 0, "experience": 0, "ring": 0},
            "battlefield_objects": [],
            "notes": [],
            "conceded": False,
        }
        for seat in _occupied_seats(room)
    ]


def _make_game_object_id() -> str:
    return secrets.token_urlsafe(6).replace("_", "").replace("-", "")[:10]


def _normalize_game_player(player: dict) -> dict:
    player.setdefault("commander_tax", 0)
    player.setdefault("poison_count", 0)
    player.setdefault("graveyard_count", 0)
    player.setdefault("exile_count", 0)
    player.setdefault("command_zone_count", 1 if player.get("commander") else 0)
    player.setdefault("commander_damage", {})
    player.setdefault("custom_counters", {"energy": 0, "experience": 0, "ring": 0})
    player.setdefault("battlefield_objects", [])
    player.setdefault("notes", [])
    player["battlefield_count"] = sum(max(1, int(obj.get("count", 1))) for obj in player.get("battlefield_objects", [])) or player.get("battlefield_count", 0)
    return player


def _target_game_player(room: dict, target_player_id: Optional[str], target_seat: Optional[int], fallback_player_id: str) -> dict:
    if target_player_id:
        return _find_game_player(room, target_player_id)
    if target_seat is not None:
        game = room.get("game") or {}
        for player in game.get("players", []):
            if player.get("seat") == target_seat:
                return player
        raise HTTPException(status_code=400, detail="Target seat is not in this shared game")
    return _find_game_player(room, fallback_player_id)


def _find_game_object(player: dict, object_id: Optional[str]) -> Optional[dict]:
    objects = player.setdefault("battlefield_objects", [])
    if object_id:
        return next((item for item in objects if item.get("id") == object_id), None)
    return objects[-1] if objects else None


def _zone_count_key(zone: PublicZone) -> str:
    return {
        "graveyard": "graveyard_count",
        "exile": "exile_count",
        "command": "command_zone_count",
    }[zone]


def _zone_label(zone: PublicZone) -> str:
    return {
        "graveyard": "graveyard",
        "exile": "exile",
        "command": "command zone",
    }[zone]


def _remove_board_object(player: dict, object_id: Optional[str], fallback_name: str) -> tuple[str, int, str]:
    obj = _find_game_object(player, object_id)
    if not obj and player["battlefield_count"] <= 0:
        raise HTTPException(status_code=400, detail="No permanents to move")
    if obj:
        player["battlefield_objects"] = [item for item in player["battlefield_objects"] if item.get("id") != obj.get("id")]
        removed_name = obj.get("name") or "permanent"
        removed_count = max(1, int(obj.get("count", 1)))
        removed_kind = str(obj.get("kind") or "permanent")
    else:
        removed_name = fallback_name or "permanent"
        removed_count = 1
        removed_kind = "permanent"
    player["battlefield_count"] = max(0, player["battlefield_count"] - removed_count)
    return removed_name, removed_count, removed_kind


def _move_board_object_to_zone(player: dict, object_id: Optional[str], note: str, destination: PublicZone) -> tuple[str, int]:
    removed_name, removed_count, removed_kind = _remove_board_object(player, object_id, note)
    zone_increment = 0 if removed_kind == "token" else removed_count
    if zone_increment:
        key = _zone_count_key(destination)
        player[key] = min(999, int(player.get(key, 0)) + zone_increment)
    return removed_name, removed_count


def _clean_counter_type(value: Optional[str]) -> str:
    raw = (value or "custom").strip()
    cleaned = re.sub(r"[^a-zA-Z0-9 +/:-]", "", raw)[:32].strip().lower()
    return cleaned or "custom"


def _game_snapshot(game: dict) -> dict:
    return _json_room({key: value for key, value in game.items() if key != "history"})


def _active_game_player_name(game: dict) -> str:
    active = next((player for player in game.get("players", []) if player.get("player_id") == game.get("active_player_id")), None)
    return active["name"] if active else "Unknown"


def _public_replay_state(game: dict) -> dict:
    return {
        "status": game.get("status", "playing"),
        "turn_number": game.get("turn_number", 1),
        "phase": game.get("phase", "beginning"),
        "active_player_name": _active_game_player_name(game),
        "winner_name": game.get("winner_name"),
        "monarch_player_name": next(
            (player["name"] for player in game.get("players", []) if player.get("player_id") == game.get("monarch_player_id")),
            None,
        ),
        "initiative_player_name": next(
            (player["name"] for player in game.get("players", []) if player.get("player_id") == game.get("initiative_player_id")),
            None,
        ),
        "players": [
            {
                "seat": player["seat"],
                "name": player["name"],
                "deck_name": player.get("deck_name"),
                "commander": player.get("commander"),
                "life": player["life"],
                "hand_count": player["hand_count"],
                "library_count": player["library_count"],
                "battlefield_count": player["battlefield_count"],
                "graveyard_count": player.get("graveyard_count", 0),
                "exile_count": player.get("exile_count", 0),
                "command_zone_count": player.get("command_zone_count", 0),
                "commander_tax": player.get("commander_tax", 0),
                "poison_count": player.get("poison_count", 0),
                "commander_damage": player.get("commander_damage", {}),
                "custom_counters": player.get("custom_counters", {}),
                "battlefield_objects": player.get("battlefield_objects", []),
                "notes": player.get("notes", []),
                "conceded": bool(player.get("conceded")),
                "is_active": player.get("player_id") == game.get("active_player_id"),
            }
            for player in game.get("players", [])
        ],
    }


def _record_replay_event(room: dict, log_entry: dict) -> None:
    game = room.get("game")
    if not game:
        return
    events = game.setdefault("replay_events", [])
    events.append(
        {
            "id": log_entry["id"],
            "index": len(events),
            "turn_number": game.get("turn_number", 1),
            "phase": game.get("phase", "beginning"),
            "active_player_name": _active_game_player_name(game),
            "player_name": log_entry["player_name"],
            "message": log_entry["message"],
            "created_at": log_entry["created_at"],
            "state": _public_replay_state(game),
        }
    )
    game["replay_events"] = events[-MAX_REPLAY_EVENTS:]
    for index, event in enumerate(game["replay_events"]):
        event["index"] = index


def _push_game_history(game: dict) -> None:
    history = game.setdefault("history", [])
    history.append(_game_snapshot(game))
    game["history"] = history[-25:]


def _restore_game_snapshot(game: dict) -> bool:
    history = game.get("history") or []
    if not history:
        return False
    snapshot = history.pop()
    game.clear()
    game.update(snapshot)
    game["history"] = history
    return True


def _add_game_log(room: dict, player_name: str, message: str) -> None:
    game = room.get("game")
    if not game:
        return
    log_entry = {
        "id": secrets.token_urlsafe(8),
        "player_name": player_name,
        "message": message,
        "created_at": _now(),
    }
    game["log"].append(log_entry)
    game["log"] = game["log"][-MAX_GAME_LOG:]
    _record_replay_event(room, log_entry)
    game["updated_at"] = _now()
    room["updated_at"] = _now()


def _add_real_game_log(room: dict, player_name: str, message: str) -> None:
    real_game = room.get("real_game")
    if not real_game:
        return
    real_game.setdefault("log", []).append(
        {
            "id": secrets.token_urlsafe(8),
            "player_name": player_name,
            "message": message,
            "created_at": _now(),
        }
    )
    real_game["log"] = real_game["log"][-MAX_GAME_LOG:]
    real_game["updated_at"] = _now()
    room["updated_at"] = _now()


def _real_authority_seat(room: dict) -> Optional[dict]:
    real_game = room.get("real_game")
    if not real_game:
        return None
    return next(
        (seat for seat in room["seats"] if seat.get("player_id") == real_game.get("authority_player_id")),
        None,
    )


def _real_authority_is_stale(real_game: dict) -> bool:
    last_seen = real_game.get("authority_last_seen_at") or real_game.get("updated_at")
    if not last_seen:
        return True
    try:
        return _parse_datetime(last_seen) < _now() - REAL_AUTHORITY_STALE_AFTER
    except Exception:
        return True


def _touch_real_authority(room: dict, player_id: str) -> None:
    real_game = room.get("real_game")
    if not real_game or real_game.get("authority_player_id") != player_id:
        return
    real_game["authority_last_seen_at"] = _now()
    real_game["updated_at"] = _now()
    room["updated_at"] = _now()


def _ensure_real_game_authority_locked(room: dict) -> None:
    real_game = room.get("real_game")
    if not real_game:
        return
    authority = _real_authority_seat(room)
    authority_missing = not authority or bool(authority.get("disconnected"))
    authority_stale = _real_authority_is_stale(real_game)
    if not authority_missing and not authority_stale:
        return

    candidates = [seat for seat in _occupied_seats(room) if not seat.get("disconnected")]
    if authority_stale and authority and not authority_missing:
        candidates = [seat for seat in candidates if seat.get("player_id") != authority.get("player_id")] + [
            seat for seat in candidates if seat.get("player_id") == authority.get("player_id")
        ]
    if not candidates:
        return
    next_authority = candidates[0]
    if authority and authority.get("player_id") == next_authority.get("player_id") and not authority_missing:
        real_game["authority_last_seen_at"] = _now()
        return

    real_game["authority_player_id"] = next_authority["player_id"]
    real_game["authority_last_seen_at"] = _now()
    if isinstance(real_game.get("start_payload"), dict):
        real_game["start_payload"]["authorityPlayerId"] = next_authority["player_id"]
    real_game["revision"] = max(0, int(real_game.get("revision", 0)))
    real_game.setdefault("pending_actions", [])
    _add_real_game_log(room, "System", f"Authority moved to {next_authority['name']} after reconnect/failover.")


def _settings_for_room(room: dict) -> dict[str, Any]:
    settings = {**_default_room_settings(), **(room.get("settings") or {})}
    room["settings"] = settings
    return settings


def _public_settings(room: dict) -> dict[str, Any]:
    settings = _settings_for_room(room)
    return {
        "spectators_allowed": bool(settings.get("spectators_allowed", True)),
        "spectator_delay_seconds": max(0, min(600, int(settings.get("spectator_delay_seconds") or 0))),
        "scheduled_for": settings.get("scheduled_for"),
        "table_note": settings.get("table_note") or "",
    }


def _redact_spectator_view(view: Optional[dict[str, Any]]) -> Optional[dict[str, Any]]:
    if not view:
        return None
    redacted = json.loads(json.dumps(view))
    redacted["viewerId"] = "spectator"
    for player in redacted.get("players", []):
        zones = player.get("zones") or {}
        for zone_name in ("hand", "library"):
            zone = zones.get(zone_name)
            if isinstance(zone, dict):
                zone.pop("cards", None)
    return redacted


def _locked_deck_from_seat(seat: dict) -> dict:
    deck = seat.get("deck")
    if not deck:
        raise HTTPException(status_code=400, detail=f"{seat['name']} needs to lock a full deck before starting")
    commander = _clean_name(deck.get("commander") or seat.get("commander") or "", field_name="Commander", max_length=80)
    raw_list = deck.get("list") or []
    if not isinstance(raw_list, list):
        raise HTTPException(status_code=400, detail=f"{seat['name']} has an invalid deck list")
    card_list = [
        _clean_public_text(card, field_name="Deck card", max_length=120, min_length=1)
        for card in raw_list[:MAX_DECK_CARDS]
        if str(card).strip()
    ]
    if not card_list:
        raise HTTPException(status_code=400, detail=f"{seat['name']} needs at least one non-commander card")
    colors = [
        str(color).strip().upper()
        for color in (deck.get("colors") or [])
        if str(color).strip().upper() in {"W", "U", "B", "R", "G", "C"}
    ][:6]
    return {
        "commander": commander,
        "list": card_list,
        "colors": colors,
    }


def _engine_unsupported_cards(deck: dict) -> list[str]:
    names = [deck.get("commander") or "", *(deck.get("list") or [])]
    found = []
    for name in names:
        clean = str(name).strip()
        if clean in ENGINE_UNSUPPORTED_CARD_NAMES and clean not in found:
            found.append(clean)
    return found


def _safe_json_size(value: Any, *, max_bytes: int, field_name: str) -> None:
    try:
        size = len(json.dumps(value, ensure_ascii=False, default=str).encode("utf-8"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail=f"{field_name} must be JSON serializable")
    if size > max_bytes:
        raise HTTPException(status_code=413, detail=f"{field_name} is too large")


def _reject_links_in_json(value: Any, *, field_name: str, depth: int = 0) -> None:
    if depth > 10:
        raise HTTPException(status_code=400, detail=f"{field_name} is too deeply nested")
    if isinstance(value, str):
        if len(value) > 4000:
            raise HTTPException(status_code=400, detail=f"{field_name} contains text that is too long")
        _reject_links(value, field_name=field_name)
        return
    if isinstance(value, list):
        for item in value:
            _reject_links_in_json(item, field_name=field_name, depth=depth + 1)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(key, str):
                _reject_links(key, field_name=field_name)
            _reject_links_in_json(item, field_name=field_name, depth=depth + 1)
        return
    if value is None or isinstance(value, (bool, int, float)):
        return
    raise HTTPException(status_code=400, detail=f"{field_name} contains unsupported JSON")


def _clean_real_game_action(raw_action: dict[str, Any]) -> dict[str, Any]:
    _safe_json_size(raw_action, max_bytes=MAX_REAL_GAME_ACTION_BYTES, field_name="Real engine action")
    kind = _clean_public_text(raw_action.get("kind") or "", field_name="Action kind", max_length=40, min_length=1)
    payload = raw_action.get("payload") or {}
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Action payload must be an object")

    def clean_id(value: Any, field_name: str = "Card instance id") -> str:
        card_instance_id = str(value or "").strip()
        if not SAFE_ACTION_ID_RE.match(card_instance_id):
            raise HTTPException(status_code=400, detail=f"Invalid {field_name.lower()}")
        return card_instance_id

    def clean_targets(value: Any, *, max_items: int = 12) -> list[str]:
        if value is None:
            return []
        if not isinstance(value, list) or len(value) > max_items:
            raise HTTPException(status_code=400, detail="Targets must be a short list")
        return [clean_id(item, "Target id") for item in value]

    if kind == "pass_priority":
        return {"kind": "pass_priority"}
    if kind == "play_land":
        return {"kind": "play_land", "payload": {"card_instance_id": clean_id(payload.get("card_instance_id"))}}
    if kind == "tap_mana":
        color = str(payload.get("color") or "").strip().upper()
        if color not in {"W", "U", "B", "R", "G", "C"}:
            raise HTTPException(status_code=400, detail="Invalid mana color")
        return {"kind": "tap_mana", "payload": {"card_instance_id": clean_id(payload.get("card_instance_id")), "color": color}}
    if kind == "cast_spell":
        return {
            "kind": "cast_spell",
            "payload": {
                "card_instance_id": clean_id(payload.get("card_instance_id")),
                "targets": clean_targets(payload.get("targets")),
            },
        }
    if kind == "declare_attackers":
        attackers = payload.get("attackers") or []
        if not isinstance(attackers, list) or len(attackers) > 20:
            raise HTTPException(status_code=400, detail="Attackers must be a short list")
        return {
            "kind": "declare_attackers",
            "payload": {
                "attackers": [
                    {
                        "cardInstanceId": clean_id(item.get("cardInstanceId") if isinstance(item, dict) else None, "Attacker id"),
                        "defendingPlayerId": clean_id(item.get("defendingPlayerId") if isinstance(item, dict) else None, "Defending player id"),
                    }
                    for item in attackers
                ],
            },
        }
    if kind == "declare_blockers":
        blockers = payload.get("blockers") or []
        if not isinstance(blockers, list) or len(blockers) > 20:
            raise HTTPException(status_code=400, detail="Blockers must be a short list")
        return {
            "kind": "declare_blockers",
            "payload": {
                "blockers": [
                    {
                        "cardInstanceId": clean_id(item.get("cardInstanceId") if isinstance(item, dict) else None, "Blocker id"),
                        "blockingAttackerId": clean_id(item.get("blockingAttackerId") if isinstance(item, dict) else None, "Attacker id"),
                    }
                    for item in blockers
                ],
            },
        }
    if kind == "adjust_counters":
        delta = payload.get("delta")
        if not isinstance(delta, int) or delta == 0 or abs(delta) > 99:
            raise HTTPException(status_code=400, detail="Counter delta must be a non-zero integer from -99 to 99")
        return {
            "kind": "adjust_counters",
            "payload": {
                "card_instance_id": clean_id(payload.get("card_instance_id")),
                "counter_type": _clean_counter_type(str(payload.get("counter_type") or "+1/+1")),
                "delta": delta,
            },
        }
    raise HTTPException(status_code=400, detail="Unsupported real engine action for this slice")


def _real_game_payload(room: dict, authority_player_id: str) -> dict:
    players = []
    for seat in _occupied_seats(room):
        players.append(
            {
                "id": seat["player_id"],
                "name": seat["name"],
                "seat": seat["seat"],
                "deck": _locked_deck_from_seat(seat),
            }
        )
    return {
        "roomId": room["id"],
        "players": players,
        "firstPlayerId": players[0]["id"] if players else None,
        "startingLife": 40,
        "authorityPlayerId": authority_player_id,
    }


def _init_real_game(room: dict, authority_player_id: str) -> dict:
    payload = _real_game_payload(room, authority_player_id)
    now = _now()
    authority = _find_player(room, authority_player_id)
    real_game = {
        "status": "starting",
        "authority_player_id": authority_player_id,
        "authority_last_seen_at": now,
        "start_payload": payload,
        "revision": 0,
        "views": {},
        "pending_actions": [],
        "resolved_actions": [],
        "log": [],
        "created_at": now,
        "updated_at": now,
    }
    room["real_game"] = real_game
    _add_real_game_log(room, "System", f"Real engine session created. {authority['name']} is authority.")
    return real_game


def _init_game(room: dict) -> dict:
    players = _occupied_game_players(room)
    now = _now()
    game = {
        "status": "playing",
        "turn_number": 1,
        "active_player_id": players[0]["player_id"],
        "phase": "beginning",
        "players": players,
        "winner_name": None,
        "monarch_player_id": None,
        "initiative_player_id": None,
        "log": [],
        "history": [],
        "replay_events": [],
        "replay_annotations": [],
        "created_at": now,
        "updated_at": now,
    }
    room["game"] = game
    _add_game_log(room, "System", f"Shared table started. {players[0]['name']} takes the first turn.")
    return game


def _find_game_player(room: dict, player_id: str) -> dict:
    game = room.get("game")
    if not game:
        raise HTTPException(status_code=409, detail="The shared game has not started")
    for player in game["players"]:
        if player["player_id"] == player_id:
            return player
    raise HTTPException(status_code=403, detail="Player is not in this shared game")


def _active_game_player(room: dict) -> dict:
    game = room["game"]
    return next(player for player in game["players"] if player["player_id"] == game["active_player_id"])


def _advance_turn(room: dict) -> None:
    game = room["game"]
    active_players = [player for player in game["players"] if not player.get("conceded") and player["life"] > 0]
    if len(active_players) <= 1:
        game["status"] = "finished"
        game["winner_name"] = active_players[0]["name"] if active_players else None
        _add_game_log(room, "System", f"{game['winner_name']} wins the table." if game["winner_name"] else "The table ended with no winner.")
        return
    current_index = next(
        (index for index, player in enumerate(active_players) if player["player_id"] == game["active_player_id"]),
        -1,
    )
    next_player = active_players[(current_index + 1) % len(active_players)]
    game["turn_number"] += 1
    game["active_player_id"] = next_player["player_id"]
    game["phase"] = "beginning"
    _add_game_log(room, "System", f"Turn {game['turn_number']}: {next_player['name']} is active.")


class SeatInfo(BaseModel):
    seat: int
    name: Optional[str] = None
    ready: bool = False
    deck_name: Optional[str] = None
    commander: Optional[str] = None
    deck_locked: bool = False
    deck_card_count: int = 0
    is_host: bool = False
    disconnected: bool = False


class ChatMessage(BaseModel):
    id: str
    player_name: str
    message: str
    system: bool
    created_at: str


class GamePlayerState(BaseModel):
    seat: int
    name: str
    deck_name: Optional[str] = None
    commander: Optional[str] = None
    life: int
    hand_count: int
    library_count: int
    battlefield_count: int
    graveyard_count: int
    exile_count: int = 0
    command_zone_count: int = 0
    commander_tax: int = 0
    poison_count: int = 0
    commander_damage: dict[str, int] = Field(default_factory=dict)
    custom_counters: dict[str, int] = Field(default_factory=dict)
    battlefield_objects: list[dict[str, Any]] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    conceded: bool = False
    is_active: bool = False


class GameLogEntry(BaseModel):
    id: str
    player_name: str
    message: str
    created_at: str


class SharedGameState(BaseModel):
    status: GameStatus
    turn_number: int
    active_player_name: str
    phase: GamePhase
    players: list[GamePlayerState]
    winner_name: Optional[str] = None
    monarch_player_name: Optional[str] = None
    initiative_player_name: Optional[str] = None
    can_undo: bool = False
    log: list[GameLogEntry]
    created_at: str
    updated_at: str


class LockedDeck(BaseModel):
    commander: str = Field(..., min_length=2, max_length=80)
    list: List[str] = Field(default_factory=list, max_length=MAX_DECK_CARDS)
    colors: List[str] = Field(default_factory=list, max_length=6)


class StartRealGamePlayer(BaseModel):
    id: str
    name: str
    seat: int
    deck: LockedDeck


class StartRealGamePayload(BaseModel):
    roomId: str
    players: list[StartRealGamePlayer]
    firstPlayerId: Optional[str] = None
    startingLife: int = 40
    authorityPlayerId: str


class PendingRealGameAction(BaseModel):
    id: str
    player_id: str
    player_name: str
    action: dict[str, Any]
    created_at: str


class RealGameLogEntry(BaseModel):
    id: str
    player_name: str
    message: str
    created_at: str


class RealGameSummary(BaseModel):
    status: str
    authority_player_id: str
    authority_player_name: str
    authority_last_seen_at: Optional[str] = None
    revision: int
    pending_action_count: int
    players: list[dict[str, Any]]
    log: list[RealGameLogEntry]
    created_at: str
    updated_at: str


class RealGameViewResponse(BaseModel):
    status: str
    revision: int
    authority_player_id: str
    authority_player_name: str
    authority_last_seen_at: Optional[str] = None
    view: Optional[dict[str, Any]] = None
    pending_action_count: int
    log: list[RealGameLogEntry]


class RoomSettings(BaseModel):
    spectators_allowed: bool = True
    spectator_delay_seconds: int = Field(0, ge=0, le=600)
    scheduled_for: Optional[str] = Field(None, max_length=64)
    table_note: str = Field("", max_length=160)


class RoomSummary(BaseModel):
    id: str
    name: str
    tags: list[str]
    namespace: RoomNamespace = "public"
    status: RoomStatus
    tier: RoomTier
    player_count: int
    max_players: int
    has_password: bool
    is_private: bool
    host_name: str
    spectator_count: int = 0
    settings: RoomSettings = Field(default_factory=RoomSettings)
    created_at: str
    updated_at: str


class RoomDetail(RoomSummary):
    seats: list[SeatInfo]
    chat: list[ChatMessage]
    game: Optional[SharedGameState] = None
    real_game: Optional[RealGameSummary] = None


class RoomWithPlayer(BaseModel):
    room: RoomDetail
    player_id: str


class RoomWithSpectator(BaseModel):
    room: RoomDetail
    spectator_id: str


class CreateRoomRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=48)
    host_name: str = Field(..., min_length=2, max_length=24)
    tags: list[str] = Field(default_factory=list, max_length=MAX_TAGS)
    password: Optional[str] = Field(None, max_length=64)
    is_private: bool = False
    tier: RoomTier = "free"
    namespace: RoomNamespace = "public"


class JoinRoomRequest(BaseModel):
    player_name: str = Field(..., min_length=2, max_length=24)
    password: Optional[str] = Field(None, max_length=64)


class SpectateRoomRequest(BaseModel):
    spectator_name: str = Field(..., min_length=2, max_length=24)
    password: Optional[str] = Field(None, max_length=64)


class RoomSettingsRequest(BaseModel):
    player_id: str
    spectators_allowed: Optional[bool] = None
    spectator_delay_seconds: Optional[int] = Field(None, ge=0, le=600)
    scheduled_for: Optional[str] = Field(None, max_length=64)
    table_note: Optional[str] = Field(None, max_length=160)


class SeatUpdateRequest(BaseModel):
    player_id: str
    ready: bool
    deck_name: Optional[str] = Field(None, max_length=80)
    commander: Optional[str] = Field(None, max_length=80)
    deck: Optional[LockedDeck] = None


class ChatRequest(BaseModel):
    player_id: str
    message: str = Field(..., min_length=1, max_length=500)


class PlayerActionRequest(BaseModel):
    player_id: str


class GameActionRequest(BaseModel):
    player_id: str
    action: GameAction
    amount: int = Field(1, ge=1, le=99)
    phase: Optional[GamePhase] = None
    note: Optional[str] = Field(None, max_length=160)
    target_player_id: Optional[str] = None
    target_seat: Optional[int] = Field(None, ge=1, le=MAX_FREE_PLAYERS)
    object_id: Optional[str] = None
    counter_type: Optional[str] = Field(None, max_length=32)
    tapped: Optional[bool] = None
    zone: Optional[PublicZone] = None


class SubmitRealGameActionRequest(BaseModel):
    player_id: str
    action: dict[str, Any]
    view_revision: Optional[int] = Field(None, ge=0)


class RealGameAuthorityRequest(BaseModel):
    player_id: str


class RealGameSnapshotRequest(BaseModel):
    player_id: str
    revision: int = Field(..., ge=0)
    views: dict[str, dict[str, Any]] = Field(default_factory=dict)
    completed_action_ids: list[str] = Field(default_factory=list, max_length=MAX_PENDING_REAL_ACTIONS)
    rejected_actions: dict[str, str] = Field(default_factory=dict)
    events: list[str] = Field(default_factory=list, max_length=20)


class ReplayAnnotationRequest(BaseModel):
    player_id: Optional[str] = None
    display_name: Optional[str] = Field(None, max_length=40)
    event_id: Optional[str] = Field(None, max_length=96)
    message: str = Field(..., min_length=1, max_length=500)


class ReplaySummary(BaseModel):
    room_id: str
    room_name: str
    status: str
    winner_name: Optional[str] = None
    turn_number: int
    event_count: int
    annotation_count: int
    player_names: list[str]
    commander_names: list[str]
    grade: str
    review_confidence: int
    created_at: str
    updated_at: str


class ReplayReport(BaseModel):
    schema_version: int = 1
    room_id: str
    room_name: str
    share_url_path: str
    summary: dict[str, Any]
    events: list[dict[str, Any]]
    decisions: list[dict[str, Any]]
    player_insights: list[dict[str, Any]]
    annotations: list[dict[str, Any]]
    review: dict[str, Any]


class EventSettings(BaseModel):
    rounds: int = Field(3, ge=1, le=12)
    match_wins_required: int = Field(2, ge=1, le=3)
    round_minutes: int = Field(50, ge=10, le=180)
    max_players: int = Field(16, ge=2, le=MAX_EVENT_PLAYERS)
    allow_spectators: bool = True
    prize_note: str = Field("", max_length=300)
    recurring_rule: str = Field("", max_length=160)


class EventPlayer(BaseModel):
    id: str
    name: str
    deck_name: Optional[str] = None
    dropped: bool = False
    registered_at: str


class EventMatch(BaseModel):
    id: str
    round: int
    table: int
    player1_id: str
    player2_id: Optional[str] = None
    player1_name: str
    player2_name: Optional[str] = None
    status: str = "open"
    is_bye: bool = False
    game_wins: dict[str, int] = Field(default_factory=dict)
    game_draws: int = 0
    winner_id: Optional[str] = None
    room_id: Optional[str] = None
    replay_room_id: Optional[str] = None
    highlight: Optional[str] = None


class EventStanding(BaseModel):
    rank: int
    player_id: str
    player_name: str
    match_wins: int
    match_losses: int
    match_draws: int
    match_points: int
    game_wins: int
    game_losses: int
    game_draws: int
    omw: float
    gwp: float
    ogw: float


class EventSummary(BaseModel):
    id: str
    name: str
    format: EventFormat
    status: EventStatus
    player_count: int
    current_round: int
    total_rounds: int
    public: bool
    organizer_name: str
    created_at: str
    updated_at: str


class EventDetail(EventSummary):
    settings: EventSettings
    players: list[EventPlayer]
    matches: list[EventMatch]
    standings: list[EventStanding]
    announcements: list[dict[str, Any]]
    draft_pods: list[dict[str, Any]]
    sealed_pools: list[dict[str, Any]]
    highlights: list[dict[str, Any]]


class CreateEventRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=80)
    organizer_name: str = Field(..., min_length=2, max_length=40)
    format: EventFormat = "swiss"
    public: bool = True
    settings: EventSettings = Field(default_factory=EventSettings)


class EventWithOrganizer(BaseModel):
    event: EventDetail
    organizer_token: str


class RegisterEventPlayerRequest(BaseModel):
    player_name: str = Field(..., min_length=2, max_length=40)
    deck_name: Optional[str] = Field(None, max_length=80)


class OrganizerEventRequest(BaseModel):
    organizer_token: str


class ReportEventMatchRequest(BaseModel):
    organizer_token: str
    player1_wins: int = Field(0, ge=0, le=5)
    player2_wins: int = Field(0, ge=0, le=5)
    game_draws: int = Field(0, ge=0, le=5)
    replay_room_id: Optional[str] = Field(None, max_length=16)
    highlight: Optional[str] = Field(None, max_length=300)


class EventAnnouncementRequest(BaseModel):
    organizer_token: str
    message: str = Field(..., min_length=1, max_length=500)


def _game_detail(room: dict) -> Optional[SharedGameState]:
    game = room.get("game")
    if not game:
        return None
    for player in game.get("players", []):
        _normalize_game_player(player)
    active = next((player for player in game["players"] if player["player_id"] == game["active_player_id"]), None)
    monarch = next((player for player in game["players"] if player["player_id"] == game.get("monarch_player_id")), None)
    initiative = next((player for player in game["players"] if player["player_id"] == game.get("initiative_player_id")), None)
    return SharedGameState(
        status=game["status"],
        turn_number=game["turn_number"],
        active_player_name=active["name"] if active else "Unknown",
        phase=game["phase"],
        players=[
            GamePlayerState(
                seat=player["seat"],
                name=player["name"],
                deck_name=player.get("deck_name"),
                commander=player.get("commander"),
                life=player["life"],
                hand_count=player["hand_count"],
                library_count=player["library_count"],
                battlefield_count=player["battlefield_count"],
                graveyard_count=player["graveyard_count"],
                exile_count=player.get("exile_count", 0),
                command_zone_count=player.get("command_zone_count", 0),
                commander_tax=player.get("commander_tax", 0),
                poison_count=player.get("poison_count", 0),
                commander_damage=player.get("commander_damage", {}),
                custom_counters=player.get("custom_counters", {}),
                battlefield_objects=player.get("battlefield_objects", []),
                notes=player.get("notes", []),
                conceded=bool(player.get("conceded")),
                is_active=player["player_id"] == game["active_player_id"],
            )
            for player in game["players"]
        ],
        winner_name=game.get("winner_name"),
        monarch_player_name=monarch["name"] if monarch else None,
        initiative_player_name=initiative["name"] if initiative else None,
        can_undo=bool(game.get("history")),
        log=[
            GameLogEntry(
                id=entry["id"],
                player_name=entry["player_name"],
                message=entry["message"],
                created_at=_iso(entry["created_at"]),
            )
            for entry in game["log"]
        ],
        created_at=_iso(game["created_at"]),
        updated_at=_iso(game["updated_at"]),
    )


def _real_game_detail(room: dict) -> Optional[RealGameSummary]:
    real_game = room.get("real_game")
    if not real_game:
        return None
    authority = _real_authority_seat(room)
    players = []
    for seat in _occupied_seats(room):
        deck = seat.get("deck") or {}
        players.append(
            {
                "id": seat["player_id"],
                "name": seat["name"],
                "seat": seat["seat"],
                "deck_locked": bool(seat.get("deck")),
                "deck_card_count": len(deck.get("list") or []),
                "commander": deck.get("commander") or seat.get("commander"),
            }
        )
    return RealGameSummary(
        status=real_game["status"],
        authority_player_id=real_game.get("authority_player_id") or "",
        authority_player_name=authority["name"] if authority else "Unknown",
        authority_last_seen_at=_iso(real_game["authority_last_seen_at"]) if real_game.get("authority_last_seen_at") else None,
        revision=real_game.get("revision", 0),
        pending_action_count=len(real_game.get("pending_actions", [])),
        players=players,
        log=[
            RealGameLogEntry(
                id=entry["id"],
                player_name=entry["player_name"],
                message=entry["message"],
                created_at=_iso(entry["created_at"]),
            )
            for entry in real_game.get("log", [])
        ],
        created_at=_iso(real_game["created_at"]),
        updated_at=_iso(real_game["updated_at"]),
    )


def _replay_action_type(message: str) -> str:
    lower = message.lower()
    if lower.startswith("drew "):
        return "draw"
    if lower.startswith("played a permanent"):
        return "play_permanent"
    if lower.startswith("created "):
        return "create_token"
    if lower.startswith("added "):
        return "add_board_object"
    if lower.startswith("moved "):
        return "zone_move"
    if lower.startswith("discarded ") or lower.startswith("exiled "):
        return "hand_management"
    if "gained" in lower or "lost" in lower or "commander damage" in lower or "poison" in lower:
        return "life_pressure"
    if lower.startswith("passed the turn"):
        return "pass_turn"
    if lower.startswith("set phase"):
        return "phase"
    if lower.startswith("conceded"):
        return "concede"
    if lower.startswith("player note"):
        return "note"
    if lower.startswith("turn ") or "wins the table" in lower or "shared table started" in lower:
        return "system"
    return "note"


def _available_options_for_event(event: dict) -> list[str]:
    state = event.get("state") or {}
    player = next((item for item in state.get("players", []) if item.get("name") == event.get("player_name")), None)
    options = ["Add a note for context", "Adjust life/counters if a manual correction is needed"]
    if state.get("status") == "playing":
        options.extend(["Pass the turn", "Advance or correct the phase"])
    if player:
        if player.get("library_count", 0) > 0:
            options.append("Draw a card")
        if player.get("hand_count", 0) > 0:
            options.extend(["Play a permanent", "Discard or move a card from hand"])
        if player.get("battlefield_count", 0) > 0:
            options.extend(["Tap, move, or add counters to a board object", "Record commander damage"])
        if player.get("life", 0) <= 10:
            options.append("Prioritize survival or mark a defensive note")
    return list(dict.fromkeys(options))[:8]


def _review_decision_for_event(event: dict) -> Optional[dict[str, Any]]:
    action_type = _replay_action_type(event.get("message", ""))
    if action_type == "system":
        return None
    message = event.get("message", "")
    state = event.get("state") or {}
    player = next((item for item in state.get("players", []) if item.get("name") == event.get("player_name")), None)
    rating = "good"
    confidence = "medium"
    coaching_note = "Tracked as a normal table action."
    better_line = "No clearly stronger manual-tracker line was visible from the public state."
    score_delta = 0.8

    if action_type == "draw":
        rating = "good"
        coaching_note = "Maintained resources before committing more cards."
        score_delta = 0.6
    elif action_type == "play_permanent":
        board_count = int(player.get("battlefield_count", 0)) if player else 0
        if board_count >= 8:
            rating = "okay"
            score_delta = 2.6
            coaching_note = "This grew the board, but the review flags possible overextension."
            better_line = "Consider holding a card back or adding a note if you were playing around a wipe."
        else:
            rating = "good"
            coaching_note = "Advanced board presence without an obvious public-state warning."
    elif action_type == "create_token":
        rating = "good"
        coaching_note = "Token creation was captured with board state so future reviews can replay the board."
    elif action_type == "zone_move":
        rating = "excellent"
        score_delta = 0.2
        confidence = "high"
        coaching_note = "Zone movement was explicitly tracked, which makes the replay much easier to audit."
    elif action_type == "hand_management":
        rating = "good"
        coaching_note = "Hand and zone counts stayed synchronized for replay review."
    elif action_type == "life_pressure":
        rating = "good"
        confidence = "high"
        coaching_note = "Pressure and alternate-loss tracking are high-value replay markers."
    elif action_type == "pass_turn":
        hand_count = int(player.get("hand_count", 0)) if player else 0
        if hand_count >= 8:
            rating = "bad"
            score_delta = 6.5
            coaching_note = "Passing with a large hand can indicate missed development or cleanup pressure."
            better_line = "Review whether a land, mana rock, discard, or board entry should have been recorded before passing."
        else:
            rating = "okay"
            score_delta = 2.0
            coaching_note = "Passing is reasonable when resources and board state do not show a clear missed action."
    elif action_type == "concede":
        rating = "okay"
        confidence = "low"
        score_delta = 1.5
        coaching_note = "The replay can show the final state, but concession quality depends on hidden hand context."
    elif action_type == "note":
        rating = "excellent"
        score_delta = 0.1
        confidence = "high"
        coaching_note = "Annotation during play improves post-game learning quality."

    return {
        "id": event["id"],
        "event_id": event["id"],
        "turn_number": event.get("turn_number", 1),
        "phase": event.get("phase", "beginning"),
        "player_name": event.get("player_name", "Unknown"),
        "action_type": action_type,
        "selected_line": message,
        "rating": rating,
        "score_delta": score_delta,
        "confidence": confidence,
        "coaching_note": coaching_note,
        "available_options": _available_options_for_event(event),
        "better_line": better_line,
    }


def _rating_points(rating: str) -> int:
    return {
        "excellent": 100,
        "good": 82,
        "okay": 64,
        "bad": 42,
        "blunder": 18,
    }.get(rating, 60)


def _grade_from_confidence(score: int) -> str:
    if score >= 90:
        return "A"
    if score >= 80:
        return "B"
    if score >= 65:
        return "C"
    if score >= 50:
        return "D"
    return "F"


def _build_player_insights(game: dict, decisions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    insights: list[dict[str, Any]] = []
    for player in game.get("players", []):
        name = player["name"]
        player_decisions = [decision for decision in decisions if decision.get("player_name") == name]
        if not player_decisions:
            continue
        played = sum(1 for decision in player_decisions if decision.get("action_type") == "play_permanent")
        tokens = sum(1 for decision in player_decisions if decision.get("action_type") == "create_token")
        notes = sum(1 for decision in player_decisions if decision.get("action_type") == "note")
        pass_warnings = [decision for decision in player_decisions if decision.get("action_type") == "pass_turn" and decision.get("rating") in {"bad", "blunder"}]
        if played + tokens >= 4:
            insights.append(
                {
                    "player_name": name,
                    "category": "Board Development",
                    "message": "You committed several board pieces. In review, check whether you were protected from wipes or overextending.",
                    "evidence_event_ids": [decision["event_id"] for decision in player_decisions if decision.get("action_type") in {"play_permanent", "create_token"}][:5],
                }
            )
        if pass_warnings:
            insights.append(
                {
                    "player_name": name,
                    "category": "Turn Conversion",
                    "message": "At least one pass looked suspicious from public state. Replay that turn and ask whether another available action should have been taken.",
                    "evidence_event_ids": [decision["event_id"] for decision in pass_warnings[:3]],
                }
            )
        if notes == 0 and len(player_decisions) >= 4:
            insights.append(
                {
                    "player_name": name,
                    "category": "Review Quality",
                    "message": "No in-game notes were recorded. Add short notes for hidden information, tutor choices, or why you passed so the replay can grade with more context.",
                    "evidence_event_ids": [decision["event_id"] for decision in player_decisions[:3]],
                }
            )
    return insights[:12]


def _build_replay_report(room: dict) -> ReplayReport:
    game = room.get("game")
    if not game:
        raise HTTPException(status_code=409, detail="The shared tracker has not started")
    for player in game.get("players", []):
        _normalize_game_player(player)
    events = game.get("replay_events") or []
    if not events:
        for entry in game.get("log", []):
            _record_replay_event(room, entry)
        events = game.get("replay_events") or []

    decisions = [decision for event in events if (decision := _review_decision_for_event(event))]
    reviewable = [decision for decision in decisions if decision.get("rating")]
    review_confidence = int(sum(_rating_points(decision["rating"]) for decision in reviewable) / max(1, len(reviewable)))
    grade = _grade_from_confidence(review_confidence)
    annotations = [
        {
            **annotation,
            "created_at": _iso(annotation["created_at"]),
        }
        for annotation in game.get("replay_annotations", [])
    ]
    summary = {
        "room_id": room["id"],
        "room_name": room["name"],
        "status": game.get("status", "playing"),
        "winner_name": game.get("winner_name"),
        "turn_number": game.get("turn_number", 1),
        "event_count": len(events),
        "decision_count": len(decisions),
        "annotation_count": len(annotations),
        "player_names": [player["name"] for player in game.get("players", [])],
        "commander_names": [player.get("commander") for player in game.get("players", []) if player.get("commander")],
        "grade": grade,
        "review_confidence": review_confidence,
        "created_at": _iso(game["created_at"]),
        "updated_at": _iso(game["updated_at"]),
    }
    return ReplayReport(
        room_id=room["id"],
        room_name=room["name"],
        share_url_path=f"/multiplayer/{room['id']}?review=1",
        summary=summary,
        events=[
            {
                **event,
                "created_at": _iso(event["created_at"]),
            }
            for event in events
        ],
        decisions=decisions,
        player_insights=_build_player_insights(game, decisions),
        annotations=annotations,
        review={
            "evaluator": "shared-tracker-heuristic-v1",
            "grade": grade,
            "review_confidence": review_confidence,
            "review_confidence_label": "heuristic",
            "llm_assist_status": "ready_for_optional_summarizer",
            "coaching_summary": (
                "Replay review is based on public tracker state, action order, and annotations. "
                "Hidden cards and table talk are only included when players add notes."
            ),
            "search_terms": [
                room["name"],
                *(player["name"] for player in game.get("players", [])),
                *(player.get("commander") for player in game.get("players", []) if player.get("commander")),
            ],
        },
    )


def _replay_summary(room: dict) -> ReplaySummary:
    report = _build_replay_report(room)
    summary = report.summary
    return ReplaySummary(
        room_id=report.room_id,
        room_name=report.room_name,
        status=summary["status"],
        winner_name=summary.get("winner_name"),
        turn_number=summary["turn_number"],
        event_count=summary["event_count"],
        annotation_count=summary["annotation_count"],
        player_names=summary["player_names"],
        commander_names=summary["commander_names"],
        grade=summary["grade"],
        review_confidence=summary["review_confidence"],
        created_at=summary["created_at"],
        updated_at=summary["updated_at"],
    )


def _make_event_id() -> str:
    while True:
        event_id = secrets.token_urlsafe(5).replace("_", "").replace("-", "")[:8].lower()
        if event_id not in _events:
            return event_id


def _find_event(event_id: str) -> dict:
    event = _events.get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def _require_event_organizer(event: dict, token: str) -> None:
    if not token or not secrets.compare_digest(str(event.get("organizer_token", "")), token):
        raise HTTPException(status_code=403, detail="Organizer token required")


def _event_player_name(event: dict, player_id: str | None) -> Optional[str]:
    if not player_id:
        return None
    player = next((item for item in event.get("players", []) if item["id"] == player_id), None)
    return player["name"] if player else None


def _event_active_players(event: dict) -> list[dict]:
    return [player for player in event.get("players", []) if not player.get("dropped")]


def _event_has_played(event: dict, player_a: str, player_b: str) -> bool:
    for match in event.get("matches", []):
        if not match.get("player2_id"):
            continue
        if {match["player1_id"], match["player2_id"]} == {player_a, player_b}:
            return True
    return False


def _event_percentage(points: int, possible: int) -> float:
    if possible <= 0:
        return 0.33
    return round(max(0.33, points / possible), 4)


def _event_standings(event: dict) -> list[EventStanding]:
    records: dict[str, dict[str, Any]] = {}
    for player in event.get("players", []):
        records[player["id"]] = {
            "player": player,
            "match_wins": 0,
            "match_losses": 0,
            "match_draws": 0,
            "match_points": 0,
            "game_wins": 0,
            "game_losses": 0,
            "game_draws": 0,
            "game_points": 0,
            "matches_played": 0,
            "games_played": 0,
            "opponents": [],
            "omw": 0.33,
            "gwp": 0.33,
            "ogw": 0.33,
            "mwp": 0.33,
        }

    for match in event.get("matches", []):
        if match.get("status") != "reported":
            continue
        p1 = records.get(match["player1_id"])
        if not p1:
            continue
        if match.get("is_bye") or not match.get("player2_id"):
            p1["match_wins"] += 1
            p1["match_points"] += 3
            p1["matches_played"] += 1
            p1["game_wins"] += max(2, int(match.get("game_wins", {}).get(match["player1_id"], 2)))
            p1["game_points"] += p1["game_wins"] * 3
            p1["games_played"] += 2
            continue

        p2 = records.get(match["player2_id"])
        if not p2:
            continue
        p1_wins = int(match.get("game_wins", {}).get(match["player1_id"], 0))
        p2_wins = int(match.get("game_wins", {}).get(match["player2_id"], 0))
        draws = int(match.get("game_draws") or 0)
        games_played = p1_wins + p2_wins + draws

        p1["matches_played"] += 1
        p2["matches_played"] += 1
        p1["opponents"].append(match["player2_id"])
        p2["opponents"].append(match["player1_id"])
        p1["game_wins"] += p1_wins
        p1["game_losses"] += p2_wins
        p1["game_draws"] += draws
        p1["game_points"] += p1_wins * 3 + draws
        p1["games_played"] += games_played
        p2["game_wins"] += p2_wins
        p2["game_losses"] += p1_wins
        p2["game_draws"] += draws
        p2["game_points"] += p2_wins * 3 + draws
        p2["games_played"] += games_played

        if p1_wins == p2_wins:
            p1["match_draws"] += 1
            p2["match_draws"] += 1
            p1["match_points"] += 1
            p2["match_points"] += 1
        elif p1_wins > p2_wins:
            p1["match_wins"] += 1
            p2["match_losses"] += 1
            p1["match_points"] += 3
        else:
            p2["match_wins"] += 1
            p1["match_losses"] += 1
            p2["match_points"] += 3

    for record in records.values():
        record["mwp"] = _event_percentage(record["match_points"], record["matches_played"] * 3)
        record["gwp"] = _event_percentage(record["game_points"], record["games_played"] * 3)

    for record in records.values():
        opponents = [records[opponent_id] for opponent_id in record["opponents"] if opponent_id in records]
        if opponents:
            record["omw"] = round(sum(opponent["mwp"] for opponent in opponents) / len(opponents), 4)
            record["ogw"] = round(sum(opponent["gwp"] for opponent in opponents) / len(opponents), 4)

    ranked = sorted(
        records.values(),
        key=lambda item: (
            -item["match_points"],
            -item["omw"],
            -item["gwp"],
            -item["ogw"],
            item["player"]["name"].lower(),
        ),
    )
    return [
        EventStanding(
            rank=index + 1,
            player_id=record["player"]["id"],
            player_name=record["player"]["name"],
            match_wins=record["match_wins"],
            match_losses=record["match_losses"],
            match_draws=record["match_draws"],
            match_points=record["match_points"],
            game_wins=record["game_wins"],
            game_losses=record["game_losses"],
            game_draws=record["game_draws"],
            omw=record["omw"],
            gwp=record["gwp"],
            ogw=record["ogw"],
        )
        for index, record in enumerate(ranked)
    ]


def _event_match_model(event: dict, match: dict) -> EventMatch:
    return EventMatch(
        id=match["id"],
        round=match["round"],
        table=match["table"],
        player1_id=match["player1_id"],
        player2_id=match.get("player2_id"),
        player1_name=_event_player_name(event, match["player1_id"]) or "Unknown",
        player2_name=_event_player_name(event, match.get("player2_id")),
        status=match.get("status", "open"),
        is_bye=bool(match.get("is_bye")),
        game_wins=match.get("game_wins") or {},
        game_draws=int(match.get("game_draws") or 0),
        winner_id=match.get("winner_id"),
        room_id=match.get("room_id"),
        replay_room_id=match.get("replay_room_id"),
        highlight=match.get("highlight"),
    )


def _event_summary(event: dict) -> EventSummary:
    return EventSummary(
        id=event["id"],
        name=event["name"],
        format=event["format"],
        status=event["status"],
        player_count=len(event.get("players", [])),
        current_round=event.get("current_round", 0),
        total_rounds=event["settings"]["rounds"],
        public=event.get("public", True),
        organizer_name=event["organizer_name"],
        created_at=_iso(event["created_at"]),
        updated_at=_iso(event["updated_at"]),
    )


def _event_detail(event: dict) -> EventDetail:
    summary = _event_summary(event)
    return EventDetail(
        **summary.model_dump(),
        settings=EventSettings(**event["settings"]),
        players=[
            EventPlayer(
                id=player["id"],
                name=player["name"],
                deck_name=player.get("deck_name"),
                dropped=bool(player.get("dropped")),
                registered_at=_iso(player["registered_at"]),
            )
            for player in event.get("players", [])
        ],
        matches=[_event_match_model(event, match) for match in event.get("matches", [])],
        standings=_event_standings(event),
        announcements=[
            {**announcement, "created_at": _iso(announcement["created_at"])}
            for announcement in event.get("announcements", [])
        ],
        draft_pods=event.get("draft_pods", []),
        sealed_pools=event.get("sealed_pools", []),
        highlights=[
            {**highlight, "created_at": _iso(highlight["created_at"])}
            for highlight in event.get("highlights", [])
        ],
    )


def _event_match_id(event: dict, round_number: int, table: int, player1_id: str, player2_id: str | None) -> str:
    suffix = player2_id or "bye"
    return f"{event['id']}-r{round_number}-t{table}-{player1_id[:4]}-{suffix[:4]}"


def _event_add_pairing(event: dict, round_number: int, table: int, player1: dict, player2: dict | None) -> dict:
    match = {
        "id": _event_match_id(event, round_number, table, player1["id"], player2["id"] if player2 else None),
        "round": round_number,
        "table": table,
        "player1_id": player1["id"],
        "player2_id": player2["id"] if player2 else None,
        "status": "reported" if player2 is None else "open",
        "is_bye": player2 is None,
        "game_wins": {player1["id"]: 2} if player2 is None else {player1["id"]: 0, player2["id"]: 0},
        "game_draws": 0,
        "winner_id": player1["id"] if player2 is None else None,
    }
    event.setdefault("matches", []).append(match)
    return match


def _event_pair_round(event: dict) -> None:
    active_players = _event_active_players(event)
    if len(active_players) < 2:
        raise HTTPException(status_code=400, detail="At least two active players are required")

    round_number = int(event.get("current_round") or 0) + 1
    if round_number > event["settings"]["rounds"] and event["format"] != "league":
        event["status"] = "complete"
        event["completed_at"] = _now()
        return

    previous_open = [
        match for match in event.get("matches", [])
        if match.get("round") == event.get("current_round") and match.get("status") != "reported"
    ]
    if previous_open:
        raise HTTPException(status_code=400, detail="Report all current-round matches before pairing the next round")

    standings = _event_standings(event)
    by_id = {player["id"]: player for player in active_players}
    if event["format"] == "single_elim" and event.get("matches"):
        advancing_ids = [
            match["winner_id"]
            for match in event.get("matches", [])
            if match.get("round") == event.get("current_round") and match.get("winner_id")
        ]
        ordered = [by_id[player_id] for player_id in advancing_ids if player_id in by_id]
        if len(ordered) <= 1:
            event["status"] = "complete"
            event["completed_at"] = _now()
            return
    elif event["format"] in {"round_robin"}:
        remaining_pairs: list[tuple[dict, dict]] = []
        for index, player1 in enumerate(active_players):
            for player2 in active_players[index + 1:]:
                if not _event_has_played(event, player1["id"], player2["id"]):
                    remaining_pairs.append((player1, player2))
        if not remaining_pairs:
            event["status"] = "complete"
            event["completed_at"] = _now()
            return
        used: set[str] = set()
        ordered_pairs: list[tuple[dict, dict]] = []
        for player1, player2 in remaining_pairs:
            if player1["id"] in used or player2["id"] in used:
                continue
            used.add(player1["id"])
            used.add(player2["id"])
            ordered_pairs.append((player1, player2))
        event["current_round"] = round_number
        for table, (player1, player2) in enumerate(ordered_pairs, start=1):
            _event_add_pairing(event, round_number, table, player1, player2)
        return
    else:
        ordered = [
            by_id[standing.player_id]
            for standing in standings
            if standing.player_id in by_id
        ] or active_players
        if round_number == 1:
            ordered = active_players[:]

    pairable = ordered[:]
    event["current_round"] = round_number
    table = 1
    if len(pairable) % 2 == 1:
        previous_byes = {match["player1_id"] for match in event.get("matches", []) if match.get("is_bye")}
        bye = next((player for player in reversed(pairable) if player["id"] not in previous_byes), pairable[-1])
        pairable.remove(bye)
        _event_add_pairing(event, round_number, table, bye, None)
        table += 1

    while pairable:
        player1 = pairable.pop(0)
        opponent_index = next(
            (index for index, candidate in enumerate(pairable) if not _event_has_played(event, player1["id"], candidate["id"])),
            0,
        )
        player2 = pairable.pop(opponent_index)
        _event_add_pairing(event, round_number, table, player1, player2)
        table += 1


def _event_prepare_limited(event: dict) -> None:
    players = _event_active_players(event)
    pod_size = 8 if event["format"] == "draft" else 6
    event["draft_pods"] = []
    event["sealed_pools"] = []
    for index in range(0, len(players), pod_size):
        pod_players = players[index:index + pod_size]
        pod = {
            "id": f"pod-{len(event['draft_pods']) + 1}",
            "name": f"Pod {len(event['draft_pods']) + 1}",
            "player_ids": [player["id"] for player in pod_players],
            "player_names": [player["name"] for player in pod_players],
            "status": "drafting" if event["format"] == "draft" else "building",
            "packs_per_player": 3 if event["format"] == "draft" else 0,
            "seeding_note": "Table order follows event registration.",
        }
        event["draft_pods"].append(pod)
        if event["format"] == "sealed":
            for player in pod_players:
                event["sealed_pools"].append({
                    "player_id": player["id"],
                    "player_name": player["name"],
                    "pool_label": "6 booster sealed pool",
                    "status": "building",
                })


def _event_find_match(event: dict, match_id: str) -> dict:
    match = next((item for item in event.get("matches", []) if item["id"] == match_id), None)
    if not match:
        raise HTTPException(status_code=404, detail="Event match not found")
    return match


def _event_create_match_room(event: dict, match: dict) -> dict:
    if match.get("is_bye") or not match.get("player2_id"):
        raise HTTPException(status_code=400, detail="Cannot create a room for a bye")
    if match.get("room_id") and match["room_id"] in _rooms:
        return _rooms[match["room_id"]]

    player1_name = _event_player_name(event, match["player1_id"]) or "Player 1"
    player2_name = _event_player_name(event, match["player2_id"]) or "Player 2"
    host_id = secrets.token_urlsafe(18)
    guest_id = secrets.token_urlsafe(18)
    room_id = _make_room_id()
    room = {
        "id": room_id,
        "name": f"{event['name']} R{match['round']} Table {match['table']}",
        "tags": _clean_tags(["event", event["format"], event["id"]]),
        "namespace": "public",
        "status": "waiting",
        "tier": "free",
        "max_players": MAX_FREE_PLAYERS,
        "is_private": False,
        "password_salt": None,
        "password_hash": None,
        "host_player_id": host_id,
        "created_at": _now(),
        "updated_at": _now(),
        "settings": {
            **_default_room_settings(),
            "spectators_allowed": bool(event["settings"].get("allow_spectators", True)),
            "table_note": f"Event {event['id']} - report result in the Event Center.",
        },
        "spectators": [],
        "seats": [
            {"seat": 1, "player_id": host_id, "name": player1_name, "ready": False, "deck_name": None, "commander": None, "deck": None, "disconnected": False},
            {"seat": 2, "player_id": guest_id, "name": player2_name, "ready": False, "deck_name": None, "commander": None, "deck": None, "disconnected": False},
            {"seat": 3, "player_id": None, "name": None, "ready": False, "deck_name": None, "commander": None, "deck": None, "disconnected": False},
            {"seat": 4, "player_id": None, "name": None, "ready": False, "deck_name": None, "commander": None, "deck": None, "disconnected": False},
        ],
        "chat": [],
    }
    _add_chat(room, "System", f"Event table created for {player1_name} vs {player2_name}.", system=True)
    _rooms[room_id] = room
    match["room_id"] = room_id
    match["host_player_id"] = host_id
    match["guest_player_id"] = guest_id
    return room


def _room_summary(room: dict) -> RoomSummary:
    occupied = _occupied_seats(room)
    host = next((seat for seat in occupied if seat["player_id"] == room["host_player_id"]), None)
    return RoomSummary(
        id=room["id"],
        name=room["name"],
        tags=room["tags"],
        namespace=room.get("namespace", "public"),
        status=room["status"],
        tier=room["tier"],
        player_count=len(occupied),
        max_players=room["max_players"],
        has_password=bool(room.get("password_hash")),
        is_private=room["is_private"],
        host_name=host["name"] if host else "Open host",
        spectator_count=len(room.get("spectators") or []),
        settings=RoomSettings(**_public_settings(room)),
        created_at=_iso(room["created_at"]),
        updated_at=_iso(room["updated_at"]),
    )


def _room_detail(room: dict) -> RoomDetail:
    summary = _room_summary(room)
    return RoomDetail(
        **summary.model_dump(),
        seats=[
            SeatInfo(
                seat=seat["seat"],
                name=seat.get("name"),
                ready=bool(seat.get("ready")),
                deck_name=seat.get("deck_name"),
                commander=seat.get("commander"),
                deck_locked=bool(seat.get("deck")),
                deck_card_count=len((seat.get("deck") or {}).get("list") or []),
                is_host=seat.get("player_id") == room["host_player_id"],
                disconnected=bool(seat.get("disconnected")),
            )
            for seat in room["seats"]
        ],
        chat=[
            ChatMessage(
                id=message["id"],
                player_name=message["player_name"],
                message=message["message"],
                system=message["system"],
                created_at=_iso(message["created_at"]),
            )
            for message in room["chat"]
        ],
        game=_game_detail(room),
        real_game=_real_game_detail(room),
    )


_load_rooms_from_disk()
_load_events_from_disk()


@router.get("/events", response_model=list[EventSummary])
async def list_events(
    include_private: bool = Query(False, description="Include unlisted organizer events"),
    status: Optional[EventStatus] = Query(None, description="Optional event status filter"),
):
    with _lock:
        events = []
        for event in _events.values():
            if not include_private and not event.get("public", True):
                continue
            if status and event.get("status") != status:
                continue
            events.append(_event_summary(event))
        events.sort(key=lambda item: item.updated_at, reverse=True)
        return events


@router.post("/events", response_model=EventWithOrganizer)
async def create_event(req: CreateEventRequest):
    event_name = _clean_name(req.name, field_name="Event name", max_length=80)
    organizer_name = _clean_name(req.organizer_name, field_name="Organizer name", max_length=40)
    settings = req.settings.model_dump()
    if req.format in {"draft", "sealed"} and settings["max_players"] < 4:
        settings["max_players"] = 4
    organizer_token = secrets.token_urlsafe(24)
    with _lock:
        event_id = _make_event_id()
        event = {
            "id": event_id,
            "name": event_name,
            "format": req.format,
            "status": "setup",
            "public": req.public,
            "organizer_name": organizer_name,
            "organizer_token": organizer_token,
            "settings": settings,
            "players": [],
            "matches": [],
            "announcements": [
                {
                    "id": secrets.token_urlsafe(8),
                    "message": f"{organizer_name} created the event.",
                    "created_at": _now(),
                    "system": True,
                }
            ],
            "draft_pods": [],
            "sealed_pools": [],
            "highlights": [],
            "current_round": 0,
            "created_at": _now(),
            "updated_at": _now(),
            "started_at": None,
            "completed_at": None,
        }
        _events[event_id] = event
        _save_events_locked()
        return EventWithOrganizer(event=_event_detail(event), organizer_token=organizer_token)


@router.get("/events/{event_id}", response_model=EventDetail)
async def get_event(event_id: str):
    with _lock:
        return _event_detail(_find_event(event_id))


@router.post("/events/{event_id}/players", response_model=EventDetail)
async def register_event_player(event_id: str, req: RegisterEventPlayerRequest):
    player_name = _clean_name(req.player_name, field_name="Player name", max_length=40)
    deck_name = _clean_public_text(req.deck_name or "", field_name="Deck name", max_length=80, min_length=0) if req.deck_name else None
    with _lock:
        event = _find_event(event_id)
        if event["status"] != "setup":
            raise HTTPException(status_code=400, detail="Registration is closed after the event starts")
        if len(event.get("players", [])) >= event["settings"]["max_players"]:
            raise HTTPException(status_code=400, detail="Event is full")
        if any(player["name"].lower() == player_name.lower() for player in event.get("players", [])):
            raise HTTPException(status_code=400, detail="That player name is already registered")
        event["players"].append({
            "id": secrets.token_urlsafe(12),
            "name": player_name,
            "deck_name": deck_name,
            "dropped": False,
            "registered_at": _now(),
        })
        event["updated_at"] = _now()
        _save_events_locked()
        return _event_detail(event)


@router.post("/events/{event_id}/start", response_model=EventDetail)
async def start_event(event_id: str, req: OrganizerEventRequest):
    with _lock:
        event = _find_event(event_id)
        _require_event_organizer(event, req.organizer_token)
        if event["status"] != "setup":
            raise HTTPException(status_code=400, detail="Event has already started")
        if len(_event_active_players(event)) < 2:
            raise HTTPException(status_code=400, detail="Register at least two players before starting")
        event["status"] = "running"
        event["started_at"] = _now()
        if event["format"] in {"draft", "sealed"}:
            _event_prepare_limited(event)
        _event_pair_round(event)
        event["announcements"].append({
            "id": secrets.token_urlsafe(8),
            "message": f"Round {event['current_round']} pairings are posted.",
            "created_at": _now(),
            "system": True,
        })
        event["updated_at"] = _now()
        _save_events_locked()
        return _event_detail(event)


@router.post("/events/{event_id}/pair-next", response_model=EventDetail)
async def pair_next_event_round(event_id: str, req: OrganizerEventRequest):
    with _lock:
        event = _find_event(event_id)
        _require_event_organizer(event, req.organizer_token)
        if event["status"] != "running":
            raise HTTPException(status_code=400, detail="Event is not running")
        _event_pair_round(event)
        if event["status"] == "complete":
            event["announcements"].append({
                "id": secrets.token_urlsafe(8),
                "message": "Event complete. Final standings are locked.",
                "created_at": _now(),
                "system": True,
            })
        else:
            event["announcements"].append({
                "id": secrets.token_urlsafe(8),
                "message": f"Round {event['current_round']} pairings are posted.",
                "created_at": _now(),
                "system": True,
            })
        event["updated_at"] = _now()
        _save_events_locked()
        return _event_detail(event)


@router.post("/events/{event_id}/matches/{match_id}/result", response_model=EventDetail)
async def report_event_match(event_id: str, match_id: str, req: ReportEventMatchRequest):
    with _lock:
        event = _find_event(event_id)
        _require_event_organizer(event, req.organizer_token)
        match = _event_find_match(event, match_id)
        if match.get("is_bye"):
            raise HTTPException(status_code=400, detail="Bye matches are reported automatically")
        if not match.get("player2_id"):
            raise HTTPException(status_code=400, detail="Match has no opponent")
        game_draws = req.game_draws
        if req.player1_wins == req.player2_wins and game_draws == 0:
            # Intentional draws are legal, but require at least one drawn game for clarity in this UI.
            game_draws = 1
        match["game_wins"] = {
            match["player1_id"]: req.player1_wins,
            match["player2_id"]: req.player2_wins,
        }
        match["game_draws"] = game_draws
        match["status"] = "reported"
        match["winner_id"] = None if req.player1_wins == req.player2_wins else (
            match["player1_id"] if req.player1_wins > req.player2_wins else match["player2_id"]
        )
        if req.replay_room_id:
            room = _find_room(req.replay_room_id)
            match["replay_room_id"] = room["id"]
        if req.highlight:
            _reject_room_chat_for_moderation(req.highlight)
            match["highlight"] = req.highlight
            event.setdefault("highlights", []).append({
                "id": secrets.token_urlsafe(8),
                "match_id": match_id,
                "round": match["round"],
                "table": match["table"],
                "message": req.highlight,
                "replay_room_id": req.replay_room_id,
                "created_at": _now(),
            })
        event["updated_at"] = _now()
        _save_events_locked()
        return _event_detail(event)


@router.post("/events/{event_id}/announcements", response_model=EventDetail)
async def post_event_announcement(event_id: str, req: EventAnnouncementRequest):
    message = _clean_chat_message(req.message)
    with _lock:
        event = _find_event(event_id)
        _require_event_organizer(event, req.organizer_token)
        event.setdefault("announcements", []).append({
            "id": secrets.token_urlsafe(8),
            "message": message,
            "created_at": _now(),
            "system": False,
        })
        event["announcements"] = event["announcements"][-MAX_EVENT_ANNOUNCEMENTS:]
        event["updated_at"] = _now()
        _save_events_locked()
        return _event_detail(event)


@router.post("/events/{event_id}/matches/{match_id}/room")
async def create_event_match_room(event_id: str, match_id: str, req: OrganizerEventRequest):
    with _lock:
        event = _find_event(event_id)
        _require_event_organizer(event, req.organizer_token)
        match = _event_find_match(event, match_id)
        room = _event_create_match_room(event, match)
        event["updated_at"] = _now()
        _save_rooms_locked()
        _save_events_locked()
        return {
            "event": _event_detail(event).model_dump(),
            "room": _room_detail(room).model_dump(),
            "room_id": room["id"],
            "host_player_id": match.get("host_player_id"),
            "guest_player_id": match.get("guest_player_id"),
        }


@router.get("/rooms", response_model=list[RoomSummary])
async def list_rooms(
    tag: Optional[str] = Query(None, description="Optional tag filter"),
    include_private: bool = Query(False, description="Include unlisted private rooms"),
    namespace: RoomNamespace = Query("public", description="Room namespace to discover"),
):
    with _lock:
        _cleanup_rooms_locked()
        normalized_tag = _clean_tags([tag])[0] if tag else None
        rooms = []
        for room in _rooms.values():
            if room["status"] != "waiting":
                continue
            if room.get("namespace", "public") != namespace:
                continue
            if room["is_private"]:
                continue
            if normalized_tag and normalized_tag not in room["tags"]:
                continue
            rooms.append(_room_summary(room))
        rooms.sort(key=lambda item: item.updated_at, reverse=True)
        return rooms


@router.post("/rooms", response_model=RoomWithPlayer)
async def create_room(req: CreateRoomRequest):
    if req.tier == "tournament":
        raise HTTPException(status_code=402, detail="Tournament rooms need billing/tokens before they can be created")

    host_name = _clean_name(req.host_name, field_name="Host name", max_length=24)
    room_name = _clean_name(req.name, field_name="Room name", max_length=48)
    tags = _clean_tags(req.tags)
    password_salt, password_hash = _password_record(req.password)
    player_id = secrets.token_urlsafe(18)

    with _lock:
        room_id = _make_room_id()
        room = {
            "id": room_id,
            "name": room_name,
            "tags": tags,
            "namespace": req.namespace,
            "status": "waiting",
            "tier": "free",
            "max_players": MAX_FREE_PLAYERS,
            "is_private": req.is_private,
            "password_salt": password_salt,
            "password_hash": password_hash,
            "host_player_id": player_id,
            "created_at": _now(),
            "updated_at": _now(),
            "settings": _default_room_settings(),
            "spectators": [],
            "seats": [
                {
                    "seat": index + 1,
                    "player_id": player_id if index == 0 else None,
                    "name": host_name if index == 0 else None,
                    "ready": False,
                    "deck_name": None,
                    "commander": None,
                    "deck": None,
                    "disconnected": False,
                }
                for index in range(MAX_FREE_PLAYERS)
            ],
            "chat": [],
        }
        _add_chat(room, "System", f"{host_name} created the room.", system=True)
        _rooms[room_id] = room
        _save_rooms_locked()
        return RoomWithPlayer(room=_room_detail(room), player_id=player_id)


@router.get("/rooms/{room_id}", response_model=RoomDetail)
async def get_room(room_id: str):
    with _lock:
        room = _find_room(room_id)
        _ensure_real_game_authority_locked(room)
        _save_rooms_locked()
        return _room_detail(room)


@router.get("/replays", response_model=list[ReplaySummary])
async def list_public_replays(q: str = Query("", max_length=80), limit: int = Query(20, ge=1, le=50)):
    query = (q or "").strip().lower()
    with _lock:
        summaries: list[ReplaySummary] = []
        for room in _rooms.values():
            if room.get("is_private") or room.get("namespace") == "qa":
                continue
            game = room.get("game")
            if not game or game.get("status") != "finished":
                continue
            summary = _replay_summary(room)
            haystack = " ".join(
                [
                    summary.room_name,
                    summary.winner_name or "",
                    *summary.player_names,
                    *summary.commander_names,
                ]
            ).lower()
            if query and query not in haystack:
                continue
            summaries.append(summary)
        summaries.sort(key=lambda item: item.updated_at, reverse=True)
        return summaries[:limit]


@router.get("/rooms/{room_id}/replay", response_model=ReplayReport)
async def get_room_replay(room_id: str):
    with _lock:
        room = _find_room(room_id)
        return _build_replay_report(room)


@router.post("/rooms/{room_id}/replay/annotations", response_model=ReplayReport)
async def add_room_replay_annotation(room_id: str, req: ReplayAnnotationRequest):
    with _lock:
        room = _find_room(room_id)
        game = room.get("game")
        if not game:
            raise HTTPException(status_code=409, detail="The shared tracker has not started")
        if req.event_id and not SAFE_ACTION_ID_RE.match(req.event_id):
            raise HTTPException(status_code=400, detail="Replay event id is invalid")
        if req.event_id and not any(event.get("id") == req.event_id for event in game.get("replay_events", [])):
            raise HTTPException(status_code=404, detail="Replay event not found")
        if req.player_id:
            author = _find_player(room, req.player_id)["name"]
        else:
            author = _clean_public_text(req.display_name or "Replay Viewer", field_name="Annotation name", max_length=40, min_length=2)
        message = CONTROL_CHARS_RE.sub("", req.message)
        message = re.sub(r"\s+", " ", message.strip())
        _reject_room_chat_for_moderation(message)
        message = _clean_public_text(message, field_name="Replay annotation", max_length=500, min_length=1)
        annotation = {
            "id": secrets.token_urlsafe(8),
            "event_id": req.event_id,
            "author_name": author,
            "message": message,
            "created_at": _now(),
        }
        annotations = game.setdefault("replay_annotations", [])
        annotations.append(annotation)
        game["replay_annotations"] = annotations[-MAX_REPLAY_ANNOTATIONS:]
        game["updated_at"] = _now()
        room["updated_at"] = _now()
        _save_rooms_locked()
        return _build_replay_report(room)


@router.post("/rooms/{room_id}/join", response_model=RoomWithPlayer)
async def join_room(room_id: str, req: JoinRoomRequest):
    player_name = _clean_name(req.player_name, field_name="Player name", max_length=24)
    with _lock:
        room = _find_room(room_id)
        _check_password(room, req.password)
        existing_seat = next(
            (
                seat
                for seat in room["seats"]
                if seat.get("player_id") and (seat.get("name") or "").strip().lower() == player_name.lower()
            ),
            None,
        )
        if existing_seat:
            existing_seat["disconnected"] = False
            _add_chat(room, "System", f"{player_name} rejoined the room.", system=True)
            _ensure_real_game_authority_locked(room)
            _save_rooms_locked()
            return RoomWithPlayer(room=_room_detail(room), player_id=existing_seat["player_id"])
        if room["status"] != "waiting":
            raise HTTPException(status_code=409, detail="Room has already started. Rejoin with an existing seat name.")
        open_seat = next((seat for seat in room["seats"] if not seat.get("player_id")), None)
        if not open_seat:
            raise HTTPException(status_code=409, detail="Room is full")
        player_id = secrets.token_urlsafe(18)
        open_seat.update(
            {
                "player_id": player_id,
                "name": player_name,
                "ready": False,
                "deck_name": None,
                "commander": None,
                "deck": None,
                "disconnected": False,
            }
        )
        _add_chat(room, "System", f"{player_name} joined the room.", system=True)
        _save_rooms_locked()
        return RoomWithPlayer(room=_room_detail(room), player_id=player_id)


@router.post("/rooms/{room_id}/spectate", response_model=RoomWithSpectator)
async def spectate_room(room_id: str, req: SpectateRoomRequest):
    spectator_name = _clean_name(req.spectator_name, field_name="Spectator name", max_length=24)
    with _lock:
        room = _find_room(room_id)
        _check_password(room, req.password)
        settings = _settings_for_room(room)
        if not settings.get("spectators_allowed", True):
            raise HTTPException(status_code=403, detail="Spectators are disabled for this room")
        spectators = room.setdefault("spectators", [])
        existing = next(
            (spectator for spectator in spectators if spectator.get("name", "").strip().lower() == spectator_name.lower()),
            None,
        )
        if existing:
            existing["joined_at"] = _now()
            _save_rooms_locked()
            return RoomWithSpectator(room=_room_detail(room), spectator_id=existing["spectator_id"])
        if len(spectators) >= MAX_SPECTATORS:
            raise HTTPException(status_code=409, detail="Spectator seats are full")
        spectator_id = secrets.token_urlsafe(18)
        spectators.append({"spectator_id": spectator_id, "name": spectator_name, "joined_at": _now()})
        _add_chat(room, "System", f"{spectator_name} is watching the table.", system=True)
        _save_rooms_locked()
        return RoomWithSpectator(room=_room_detail(room), spectator_id=spectator_id)


@router.post("/rooms/{room_id}/settings", response_model=RoomDetail)
async def update_room_settings(room_id: str, req: RoomSettingsRequest):
    with _lock:
        room = _find_room(room_id)
        if req.player_id != room["host_player_id"]:
            raise HTTPException(status_code=403, detail="Only the host can update room settings")
        settings = _settings_for_room(room)
        if req.spectators_allowed is not None:
            settings["spectators_allowed"] = req.spectators_allowed
        if req.spectator_delay_seconds is not None:
            settings["spectator_delay_seconds"] = req.spectator_delay_seconds
        if req.scheduled_for is not None:
            settings["scheduled_for"] = _clean_public_text(
                req.scheduled_for,
                field_name="Scheduled time",
                max_length=64,
                min_length=0,
            )
        if req.table_note is not None:
            settings["table_note"] = _clean_public_text(
                req.table_note,
                field_name="Table note",
                max_length=160,
                min_length=0,
            )
        room["updated_at"] = _now()
        _save_rooms_locked()
        return _room_detail(room)


@router.post("/rooms/{room_id}/seat", response_model=RoomDetail)
async def update_seat(room_id: str, req: SeatUpdateRequest):
    with _lock:
        room = _find_room(room_id)
        if room["status"] != "waiting":
            raise HTTPException(status_code=409, detail="Room has already started")
        seat = _find_player(room, req.player_id)
        seat["ready"] = req.ready
        seat["deck_name"] = _clean_name(req.deck_name, field_name="Deck name", max_length=80) if req.deck_name else None
        seat["commander"] = _clean_name(req.commander, field_name="Commander", max_length=80) if req.commander else None
        if req.deck:
            deck_data = req.deck.model_dump()
            cleaned_list = [
                _clean_public_text(card, field_name="Deck card", max_length=120, min_length=1)
                for card in deck_data["list"][:MAX_DECK_CARDS]
                if card.strip()
            ]
            if req.ready and not cleaned_list:
                raise HTTPException(status_code=400, detail="Ready players need to lock a deck list")
            commander = _clean_name(deck_data["commander"], field_name="Commander", max_length=80)
            colors = [
                color.strip().upper()
                for color in deck_data.get("colors", [])[:6]
                if color.strip().upper() in {"W", "U", "B", "R", "G", "C"}
            ]
            seat["deck"] = {"commander": commander, "list": cleaned_list, "colors": colors}
            seat["commander"] = commander
        room["updated_at"] = _now()
        _save_rooms_locked()
        return _room_detail(room)


@router.post("/rooms/{room_id}/chat", response_model=RoomDetail)
async def send_chat(room_id: str, req: ChatRequest):
    message = _clean_chat_message(req.message)
    with _lock:
        room = _find_room(room_id)
        seat = _find_player(room, req.player_id)
        _add_chat(room, seat["name"], message)
        _save_rooms_locked()
        return _room_detail(room)


@router.post("/rooms/{room_id}/start", response_model=RoomDetail)
async def start_room(room_id: str, req: PlayerActionRequest):
    with _lock:
        room = _find_room(room_id)
        if req.player_id != room["host_player_id"]:
            raise HTTPException(status_code=403, detail="Only the host can start the room")
        occupied = _occupied_seats(room)
        if len(occupied) < 2:
            raise HTTPException(status_code=400, detail="At least 2 players are needed to start")
        if any(not seat.get("ready") for seat in occupied):
            raise HTTPException(status_code=400, detail="Every seated player must be ready")
        room["status"] = "in_game"
        _init_game(room)
        _add_chat(room, "System", "The host started the shared table.", system=True)
        _save_rooms_locked()
        return _room_detail(room)


@router.post("/rooms/{room_id}/rematch", response_model=RoomDetail)
async def rematch_room(room_id: str, req: PlayerActionRequest):
    with _lock:
        room = _find_room(room_id)
        if req.player_id != room["host_player_id"]:
            raise HTTPException(status_code=403, detail="Only the host can start a new shared table")
        occupied = _occupied_seats(room)
        if len(occupied) < 2:
            raise HTTPException(status_code=400, detail="At least 2 players are needed to start")
        room["status"] = "in_game"
        room["real_game"] = None
        _init_game(room)
        _add_chat(room, "System", "The host started a new shared table.", system=True)
        _save_rooms_locked()
        return _room_detail(room)


@router.post("/rooms/{room_id}/start-real-game", response_model=RoomDetail)
async def start_real_game(room_id: str, req: PlayerActionRequest):
    with _lock:
        room = _find_room(room_id)
        if req.player_id != room["host_player_id"]:
            raise HTTPException(status_code=403, detail="Only the host can start the real engine session")
        occupied = _occupied_seats(room)
        if len(occupied) < 2:
            raise HTTPException(status_code=400, detail="At least 2 players are needed to start")
        if any(not seat.get("ready") for seat in occupied):
            raise HTTPException(status_code=400, detail="Every seated player must be ready")
        unsupported_by_seat = []
        for seat in occupied:
            deck = _locked_deck_from_seat(seat)
            unsupported = _engine_unsupported_cards(deck)
            if unsupported:
                unsupported_by_seat.append(f"{seat['name']}: {', '.join(unsupported)}")
        if unsupported_by_seat:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Engine Beta does not automate these unsupported cards yet: "
                    + "; ".join(unsupported_by_seat)
                    + ". Use Shared Table for this room."
                ),
            )
        room["status"] = "in_game"
        room["game"] = None
        _init_real_game(room, req.player_id)
        _add_chat(room, "System", "The host started the real engine session.", system=True)
        _save_rooms_locked()
        return _room_detail(room)


@router.get("/rooms/{room_id}/real-game/start-payload", response_model=StartRealGamePayload)
async def get_real_game_start_payload(room_id: str, player_id: str = Query(...)):
    with _lock:
        room = _find_room(room_id)
        real_game = room.get("real_game")
        if not real_game:
            raise HTTPException(status_code=409, detail="The real engine session has not started")
        _ensure_real_game_authority_locked(room)
        if player_id != real_game["authority_player_id"]:
            raise HTTPException(status_code=403, detail="Only the authority player can fetch the full start payload")
        _touch_real_authority(room, player_id)
        _save_rooms_locked()
        return StartRealGamePayload(**real_game["start_payload"])


@router.get("/rooms/{room_id}/real-game/actions", response_model=list[PendingRealGameAction])
async def get_pending_real_game_actions(room_id: str, player_id: str = Query(...)):
    with _lock:
        room = _find_room(room_id)
        real_game = room.get("real_game")
        if not real_game:
            raise HTTPException(status_code=409, detail="The real engine session has not started")
        _ensure_real_game_authority_locked(room)
        if player_id != real_game["authority_player_id"]:
            raise HTTPException(status_code=403, detail="Only the authority player can fetch pending actions")
        _touch_real_authority(room, player_id)
        _save_rooms_locked()
        return [
            PendingRealGameAction(
                id=action["id"],
                player_id=action["player_id"],
                player_name=action["player_name"],
                action=action["action"],
                created_at=_iso(action["created_at"]),
            )
            for action in real_game.get("pending_actions", [])
        ]


@router.post("/rooms/{room_id}/real-game/action", response_model=PendingRealGameAction)
async def submit_real_game_action(room_id: str, req: SubmitRealGameActionRequest):
    with _lock:
        room = _find_room(room_id)
        real_game = room.get("real_game")
        if not real_game:
            raise HTTPException(status_code=409, detail="The real engine session has not started")
        _ensure_real_game_authority_locked(room)
        seat = _find_player(room, req.player_id)
        clean_action = _clean_real_game_action(req.action)
        kind = clean_action["kind"]
        pending = real_game.setdefault("pending_actions", [])
        if len(pending) >= MAX_PENDING_REAL_ACTIONS:
            raise HTTPException(status_code=429, detail="Too many pending actions; wait for authority sync")
        action = {
            "id": secrets.token_urlsafe(8),
            "player_id": req.player_id,
            "player_name": seat["name"],
            "action": clean_action,
            "created_at": _now(),
        }
        pending.append(action)
        _add_real_game_log(room, seat["name"], f"Submitted {kind.replace('_', ' ')}.")
        _save_rooms_locked()
        return PendingRealGameAction(
            id=action["id"],
            player_id=action["player_id"],
            player_name=action["player_name"],
            action=action["action"],
            created_at=_iso(action["created_at"]),
        )


@router.post("/rooms/{room_id}/real-game/snapshot", response_model=RoomDetail)
async def publish_real_game_snapshot(room_id: str, req: RealGameSnapshotRequest):
    with _lock:
        room = _find_room(room_id)
        real_game = room.get("real_game")
        if not real_game:
            raise HTTPException(status_code=409, detail="The real engine session has not started")
        _ensure_real_game_authority_locked(room)
        if req.player_id != real_game["authority_player_id"]:
            raise HTTPException(status_code=403, detail="Only the authority player can publish engine snapshots")
        _touch_real_authority(room, req.player_id)
        _safe_json_size(req.views, max_bytes=MAX_REAL_GAME_VIEW_BYTES, field_name="Real engine views")
        _reject_links_in_json(req.views, field_name="Real engine views")
        real_game["revision"] = max(real_game.get("revision", 0), req.revision)
        real_game["views"] = req.views
        completed_ids = set(req.completed_action_ids)
        if any(not SAFE_ACTION_ID_RE.match(str(action_id)) for action_id in completed_ids):
            raise HTTPException(status_code=400, detail="Completed action ids are invalid")
        rejected = {
            str(action_id): _clean_public_text(reason, field_name="Rejected action reason", max_length=240, min_length=1)
            for action_id, reason in req.rejected_actions.items()
            if SAFE_ACTION_ID_RE.match(str(action_id))
        }
        if len(rejected) != len(req.rejected_actions):
            raise HTTPException(status_code=400, detail="Rejected action ids are invalid")
        if completed_ids or rejected:
            remaining = []
            for action in real_game.get("pending_actions", []):
                action_id = action["id"]
                if action_id in completed_ids or action_id in rejected:
                    resolved = {
                        **action,
                        "ok": action_id in completed_ids,
                        "error": rejected.get(action_id),
                        "resolved_at": _now(),
                    }
                    real_game.setdefault("resolved_actions", []).append(resolved)
                    if action_id in rejected:
                        action_kind = str((action.get("action") or {}).get("kind") or "action").replace("_", " ")
                        _add_real_game_log(
                            room,
                            "Engine",
                            f"{action['player_name']}'s {action_kind} failed: {rejected[action_id]}",
                        )
                else:
                    remaining.append(action)
            real_game["pending_actions"] = remaining[-MAX_PENDING_REAL_ACTIONS:]
            real_game["resolved_actions"] = real_game.get("resolved_actions", [])[-MAX_GAME_LOG:]
        for event in req.events[:20]:
            if not str(event).strip():
                continue
            event_text = _clean_public_text(event, field_name="Engine event", max_length=240, min_length=1)
            _add_real_game_log(room, "Engine", event_text)
        real_game["status"] = "playing"
        real_game["updated_at"] = _now()
        room["updated_at"] = _now()
        _save_rooms_locked()
        return _room_detail(room)


@router.get("/rooms/{room_id}/real-game/view", response_model=RealGameViewResponse)
async def get_real_game_view(room_id: str, player_id: str = Query(...)):
    with _lock:
        room = _find_room(room_id)
        real_game = room.get("real_game")
        if not real_game:
            raise HTTPException(status_code=409, detail="The real engine session has not started")
        _ensure_real_game_authority_locked(room)
        _find_player(room, player_id)
        authority = _real_authority_seat(room)
        _save_rooms_locked()
        return RealGameViewResponse(
            status=real_game["status"],
            revision=real_game.get("revision", 0),
            authority_player_id=real_game.get("authority_player_id") or "",
            authority_player_name=authority["name"] if authority else "Unknown",
            authority_last_seen_at=_iso(real_game["authority_last_seen_at"]) if real_game.get("authority_last_seen_at") else None,
            view=(real_game.get("views") or {}).get(player_id),
            pending_action_count=len(real_game.get("pending_actions", [])),
            log=[
                RealGameLogEntry(
                    id=entry["id"],
                    player_name=entry["player_name"],
                    message=entry["message"],
                    created_at=_iso(entry["created_at"]),
                )
                for entry in real_game.get("log", [])
            ],
        )


@router.get("/rooms/{room_id}/real-game/spectator-view", response_model=RealGameViewResponse)
async def get_real_game_spectator_view(room_id: str, spectator_id: str = Query(...)):
    with _lock:
        room = _find_room(room_id)
        real_game = room.get("real_game")
        if not real_game:
            raise HTTPException(status_code=409, detail="The real engine session has not started")
        if not any(spectator.get("spectator_id") == spectator_id for spectator in room.get("spectators") or []):
            raise HTTPException(status_code=403, detail="Spectator is not registered for this room")
        _ensure_real_game_authority_locked(room)
        authority = _real_authority_seat(room)
        source_view = next(iter((real_game.get("views") or {}).values()), None)
        _save_rooms_locked()
        return RealGameViewResponse(
            status=real_game["status"],
            revision=real_game.get("revision", 0),
            authority_player_id=real_game.get("authority_player_id") or "",
            authority_player_name=authority["name"] if authority else "Unknown",
            authority_last_seen_at=_iso(real_game["authority_last_seen_at"]) if real_game.get("authority_last_seen_at") else None,
            view=_redact_spectator_view(source_view),
            pending_action_count=len(real_game.get("pending_actions", [])),
            log=[
                RealGameLogEntry(
                    id=entry["id"],
                    player_name=entry["player_name"],
                    message=entry["message"],
                    created_at=_iso(entry["created_at"]),
                )
                for entry in real_game.get("log", [])
            ],
        )


@router.post("/rooms/{room_id}/game/action", response_model=RoomDetail)
async def apply_game_action(room_id: str, req: GameActionRequest):
    with _lock:
        room = _find_room(room_id)
        if room["status"] != "in_game":
            raise HTTPException(status_code=409, detail="Room is not in game")
        if room.get("real_game") and not room.get("game"):
            raise HTTPException(status_code=409, detail="This room is running Engine Beta, not the shared tracker")
        game = room.get("game")
        if not game:
            raise HTTPException(status_code=409, detail="The shared tracker has not started")
        if game["status"] == "finished" and req.action != "undo":
            raise HTTPException(status_code=409, detail="The shared game has finished")
        player = _find_game_player(room, req.player_id)
        _normalize_game_player(player)
        player_name = player["name"]
        note = _clean_public_text(req.note, field_name="Game note", max_length=160, min_length=1) if req.note else ""

        if req.action == "draw_card":
            _push_game_history(game)
            drawn = min(req.amount, player["library_count"])
            player["library_count"] -= drawn
            player["hand_count"] += drawn
            _add_game_log(room, player_name, f"Drew {drawn} card{'s' if drawn != 1 else ''}.")
        elif req.action == "play_permanent":
            if player["hand_count"] <= 0:
                raise HTTPException(status_code=400, detail="No cards in hand to play")
            _push_game_history(game)
            player["hand_count"] -= 1
            object_name = note or "Permanent"
            player.setdefault("battlefield_objects", []).append(
                {
                    "id": _make_game_object_id(),
                    "name": object_name,
                    "kind": "permanent",
                    "count": 1,
                    "counters": {},
                    "tapped": False,
                }
            )
            player["battlefield_count"] = sum(int(item.get("count", 1)) for item in player["battlefield_objects"])
            suffix = f": {object_name}" if object_name else ""
            _add_game_log(room, player_name, f"Played a permanent{suffix}.")
        elif req.action == "remove_permanent":
            _push_game_history(game)
            removed_name, removed_count, removed_kind = _remove_board_object(player, req.object_id, note)
            if removed_kind != "token":
                player["graveyard_count"] = min(999, int(player.get("graveyard_count", 0)) + removed_count)
            suffix = f": {removed_name}" if removed_name else ""
            _add_game_log(room, player_name, f"Moved a permanent to graveyard{suffix}.")
        elif req.action in {"move_to_graveyard", "move_to_exile", "move_to_command"}:
            destination: PublicZone = {
                "move_to_graveyard": "graveyard",
                "move_to_exile": "exile",
                "move_to_command": "command",
            }[req.action]
            _push_game_history(game)
            moved_name, moved_count = _move_board_object_to_zone(player, req.object_id, note, destination)
            suffix = f": {moved_name}" if moved_name else ""
            _add_game_log(room, player_name, f"Moved {moved_count} permanent{'s' if moved_count != 1 else ''} to {_zone_label(destination)}{suffix}.")
        elif req.action in {"discard_card", "exile_from_hand"}:
            if player["hand_count"] < req.amount:
                raise HTTPException(status_code=400, detail="Not enough cards in hand")
            destination: PublicZone = "exile" if req.action == "exile_from_hand" else "graveyard"
            _push_game_history(game)
            player["hand_count"] -= req.amount
            player[_zone_count_key(destination)] = min(999, int(player.get(_zone_count_key(destination), 0)) + req.amount)
            named = f": {note}" if note else ""
            verb = "Exiled" if destination == "exile" else "Discarded"
            _add_game_log(room, player_name, f"{verb} {req.amount} card{'s' if req.amount != 1 else ''} to {_zone_label(destination)}{named}.")
        elif req.action == "return_to_hand":
            source: PublicZone = req.zone or "graveyard"
            source_key = _zone_count_key(source)
            if int(player.get(source_key, 0)) < req.amount:
                raise HTTPException(status_code=400, detail=f"Not enough cards in {_zone_label(source)}")
            _push_game_history(game)
            player[source_key] = max(0, int(player.get(source_key, 0)) - req.amount)
            player["hand_count"] = min(99, int(player.get("hand_count", 0)) + req.amount)
            named = f": {note}" if note else ""
            _add_game_log(room, player_name, f"Returned {req.amount} card{'s' if req.amount != 1 else ''} from {_zone_label(source)} to hand{named}.")
        elif req.action == "return_to_battlefield":
            source: PublicZone = req.zone or "graveyard"
            source_key = _zone_count_key(source)
            if int(player.get(source_key, 0)) < req.amount:
                raise HTTPException(status_code=400, detail=f"Not enough cards in {_zone_label(source)}")
            _push_game_history(game)
            player[source_key] = max(0, int(player.get(source_key, 0)) - req.amount)
            object_name = note or f"{_zone_label(source).title()} card"
            player.setdefault("battlefield_objects", []).append(
                {
                    "id": _make_game_object_id(),
                    "name": object_name,
                    "kind": "manual",
                    "count": req.amount,
                    "counters": {},
                    "tapped": False,
                }
            )
            player["battlefield_count"] = sum(int(item.get("count", 1)) for item in player["battlefield_objects"])
            _add_game_log(room, player_name, f"Returned {req.amount} {object_name} from {_zone_label(source)} to battlefield.")
        elif req.action == "gain_life":
            target = _target_game_player(room, req.target_player_id, req.target_seat, req.player_id)
            _push_game_history(game)
            target["life"] = min(999, target["life"] + req.amount)
            _add_game_log(room, player_name, f"{target['name']} gained {req.amount} life.")
        elif req.action == "lose_life":
            target = _target_game_player(room, req.target_player_id, req.target_seat, req.player_id)
            _push_game_history(game)
            target["life"] = max(0, target["life"] - req.amount)
            _add_game_log(room, player_name, f"{target['name']} lost {req.amount} life.")
            if target["life"] == 0:
                target["conceded"] = True
                _add_game_log(room, "System", f"{target['name']} is out of the game.")
                _advance_turn(room)
        elif req.action == "commander_damage":
            target = _target_game_player(room, req.target_player_id, req.target_seat, req.player_id)
            source = player.get("commander") or f"{player_name}'s commander"
            _push_game_history(game)
            damage = target.setdefault("commander_damage", {})
            damage[source] = min(999, int(damage.get(source, 0)) + req.amount)
            _add_game_log(room, player_name, f"{target['name']} took {req.amount} commander damage from {source} ({damage[source]} total).")
            if damage[source] >= 21:
                target["life"] = 0
                target["conceded"] = True
                _add_game_log(room, "System", f"{target['name']} is out by commander damage.")
                _advance_turn(room)
        elif req.action == "commander_tax":
            _push_game_history(game)
            player["commander_tax"] = min(99, int(player.get("commander_tax", 0)) + req.amount)
            _add_game_log(room, player_name, f"Commander tax is now {player['commander_tax']}.")
        elif req.action == "poison":
            target = _target_game_player(room, req.target_player_id, req.target_seat, req.player_id)
            _push_game_history(game)
            target["poison_count"] = min(99, int(target.get("poison_count", 0)) + req.amount)
            _add_game_log(room, player_name, f"{target['name']} has {target['poison_count']} poison counter{'s' if target['poison_count'] != 1 else ''}.")
            if target["poison_count"] >= 10:
                target["life"] = 0
                target["conceded"] = True
                _add_game_log(room, "System", f"{target['name']} is out by poison.")
                _advance_turn(room)
        elif req.action == "adjust_counter":
            target = _target_game_player(room, req.target_player_id, req.target_seat, req.player_id)
            counter_type = _clean_counter_type(req.counter_type)
            _push_game_history(game)
            counters = target.setdefault("custom_counters", {})
            counters[counter_type] = min(999, int(counters.get(counter_type, 0)) + req.amount)
            _add_game_log(room, player_name, f"{target['name']} has {counters[counter_type]} {counter_type} counter{'s' if counters[counter_type] != 1 else ''}.")
        elif req.action == "set_monarch":
            target = _target_game_player(room, req.target_player_id, req.target_seat, req.player_id)
            _push_game_history(game)
            game["monarch_player_id"] = target["player_id"]
            _add_game_log(room, player_name, f"{target['name']} became the monarch.")
        elif req.action == "clear_monarch":
            _push_game_history(game)
            game["monarch_player_id"] = None
            _add_game_log(room, player_name, "Cleared the monarch.")
        elif req.action == "set_initiative":
            target = _target_game_player(room, req.target_player_id, req.target_seat, req.player_id)
            _push_game_history(game)
            game["initiative_player_id"] = target["player_id"]
            _add_game_log(room, player_name, f"{target['name']} took the initiative.")
        elif req.action == "clear_initiative":
            _push_game_history(game)
            game["initiative_player_id"] = None
            _add_game_log(room, player_name, "Cleared the initiative.")
        elif req.action == "create_token":
            token_name = note or "Token"
            _push_game_history(game)
            player.setdefault("battlefield_objects", []).append(
                {
                    "id": _make_game_object_id(),
                    "name": token_name,
                    "kind": "token",
                    "count": req.amount,
                    "counters": {},
                    "tapped": False,
                }
            )
            player["battlefield_count"] = sum(int(item.get("count", 1)) for item in player["battlefield_objects"])
            _add_game_log(room, player_name, f"Created {req.amount} {token_name} token{'s' if req.amount != 1 else ''}.")
        elif req.action == "add_board_object":
            object_name = note or "Board entry"
            _push_game_history(game)
            player.setdefault("battlefield_objects", []).append(
                {
                    "id": _make_game_object_id(),
                    "name": object_name,
                    "kind": "manual",
                    "count": req.amount,
                    "counters": {},
                    "tapped": False,
                }
            )
            player["battlefield_count"] = sum(int(item.get("count", 1)) for item in player["battlefield_objects"])
            _add_game_log(room, player_name, f"Added {req.amount} {object_name} board entr{'ies' if req.amount != 1 else 'y'}.")
        elif req.action == "add_object_counter":
            obj = _find_game_object(player, req.object_id)
            if not obj:
                raise HTTPException(status_code=400, detail="Board object not found")
            counter_type = _clean_counter_type(req.counter_type or "+1/+1")
            _push_game_history(game)
            counters = obj.setdefault("counters", {})
            counters[counter_type] = min(999, int(counters.get(counter_type, 0)) + req.amount)
            _add_game_log(room, player_name, f"Put {req.amount} {counter_type} counter{'s' if req.amount != 1 else ''} on {obj.get('name', 'object')}.")
        elif req.action == "tap_object":
            obj = _find_game_object(player, req.object_id)
            if not obj:
                raise HTTPException(status_code=400, detail="Board object not found")
            _push_game_history(game)
            obj["tapped"] = bool(req.tapped) if req.tapped is not None else not bool(obj.get("tapped"))
            _add_game_log(room, player_name, f"{'Tapped' if obj['tapped'] else 'Untapped'} {obj.get('name', 'object')}.")
        elif req.action == "set_phase":
            if not req.phase:
                raise HTTPException(status_code=400, detail="Phase is required")
            _push_game_history(game)
            game["phase"] = req.phase
            _add_game_log(room, player_name, f"Set phase to {req.phase.replace('_', ' ')}.")
        elif req.action == "pass_turn":
            if game["active_player_id"] != req.player_id:
                raise HTTPException(status_code=403, detail="Only the active player can pass the turn")
            _push_game_history(game)
            _add_game_log(room, player_name, "Passed the turn.")
            _advance_turn(room)
        elif req.action == "concede":
            _push_game_history(game)
            player["life"] = 0
            player["conceded"] = True
            _add_game_log(room, player_name, "Conceded the game.")
            if game["active_player_id"] == req.player_id:
                _advance_turn(room)
            else:
                _advance_turn(room)
        elif req.action == "player_note":
            if not note:
                raise HTTPException(status_code=400, detail="Note cannot be empty")
            _push_game_history(game)
            player.setdefault("notes", []).append(note)
            player["notes"] = player["notes"][-10:]
            _add_game_log(room, player_name, f"Player note: {note}")
        elif req.action == "note":
            if not note:
                raise HTTPException(status_code=400, detail="Note cannot be empty")
            _push_game_history(game)
            _add_game_log(room, player_name, note)
        elif req.action == "undo":
            if not _restore_game_snapshot(game):
                raise HTTPException(status_code=409, detail="Nothing to undo")
            _add_game_log(room, player_name, "Undid the last tracker action.")

        game["updated_at"] = _now()
        room["updated_at"] = _now()
        _save_rooms_locked()
        return _room_detail(room)


@router.post("/rooms/{room_id}/leave", response_model=RoomDetail)
async def leave_room(room_id: str, req: PlayerActionRequest):
    with _lock:
        room = _find_room(room_id)
        seat = _find_player(room, req.player_id)
        player_name = seat["name"]
        if room["status"] == "in_game":
            seat["disconnected"] = True
            _add_chat(room, "System", f"{player_name} left the table view and can rejoin by invite.", system=True)
            _ensure_real_game_authority_locked(room)
            _save_rooms_locked()
            return _room_detail(room)
        seat.update({"player_id": None, "name": None, "ready": False, "deck_name": None, "commander": None, "deck": None, "disconnected": False})
        occupied = _occupied_seats(room)
        if not occupied:
            room["status"] = "closed"
        elif req.player_id == room["host_player_id"]:
            room["host_player_id"] = occupied[0]["player_id"]
            _add_chat(room, "System", f"{occupied[0]['name']} is now the host.", system=True)
        _add_chat(room, "System", f"{player_name} left the room.", system=True)
        _save_rooms_locked()
        return _room_detail(room)


@router.post("/rooms/{room_id}/close", response_model=RoomDetail)
async def close_room(room_id: str, req: PlayerActionRequest):
    with _lock:
        room = _find_room(room_id)
        if req.player_id != room["host_player_id"]:
            raise HTTPException(status_code=403, detail="Only the host can close the room")
        room["status"] = "closed"
        _add_chat(room, "System", "The host closed the room.", system=True)
        _save_rooms_locked()
        return _room_detail(room)
