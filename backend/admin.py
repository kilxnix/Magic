"""Protected site-wide admin console API.

These endpoints intentionally sit outside the public room organizer tools. They
use ADMIN_TOKEN and operate on rooms, events, diagnostics, and moderation state
for the whole DeckReps instance.
"""

from __future__ import annotations

import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from backend import multiplayer, ops


router = APIRouter(prefix="/api/admin", tags=["admin"])

ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
ADMIN_AUDIT_STORE_PATH = Path(os.getenv("ADMIN_AUDIT_STORE", "/app/runtime/admin_audit.jsonl"))
MAX_ADMIN_AUDIT_BYTES = int(os.getenv("ADMIN_AUDIT_MAX_BYTES", str(3 * 1024 * 1024)))
_audit_lock = threading.RLock()


class AdminActionRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=240)


class AdminAnnouncementRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=500)


class AdminAuthResponse(BaseModel):
    ok: bool


class AdminOverviewResponse(BaseModel):
    status: str
    generated_at: str
    room_count: int
    active_room_count: int
    event_count: int
    running_event_count: int
    rooms: list[dict[str, Any]]
    events: list[dict[str, Any]]
    client_events: list[dict[str, Any]]
    audit_events: list[dict[str, Any]]


def _token_from_request(request: Request) -> str:
    auth = request.headers.get("authorization", "")
    bearer = auth.removeprefix("Bearer ").strip() if auth.lower().startswith("bearer ") else ""
    return request.headers.get("x-admin-token", "") or bearer


def _require_admin(request: Request) -> None:
    provided = _token_from_request(request)
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Admin console disabled until ADMIN_TOKEN is configured")
    if not provided or not secrets.compare_digest(provided, ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="Admin token required")


def _iso(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _redacted_room_summary(room: dict) -> dict[str, Any]:
    game = room.get("game") or {}
    real_game = room.get("real_game") or {}
    return {
        "id": room["id"],
        "name": room.get("name"),
        "status": room.get("status"),
        "namespace": room.get("namespace", "public"),
        "is_private": bool(room.get("is_private")),
        "has_password": bool(room.get("password_hash")),
        "host_player_id": room.get("host_player_id"),
        "host_name": next((seat.get("name") for seat in room.get("seats", []) if seat.get("player_id") == room.get("host_player_id")), None),
        "player_count": len([seat for seat in room.get("seats", []) if seat.get("player_id")]),
        "spectator_count": len(room.get("spectators") or []),
        "chat_count": len(room.get("chat") or []),
        "muted_player_count": len(room.get("muted_player_ids") or []),
        "banned_player_count": max(len(room.get("banned_player_ids") or []), len(room.get("banned_player_names") or [])),
        "game_status": game.get("status"),
        "real_game_status": real_game.get("status"),
        "created_at": _iso(room.get("created_at")),
        "updated_at": _iso(room.get("updated_at")),
        "seats": [
            {
                "seat": seat.get("seat"),
                "player_id": seat.get("player_id"),
                "name": seat.get("name"),
                "ready": bool(seat.get("ready")),
                "commander": seat.get("commander"),
                "deck_locked": bool(seat.get("deck")),
                "disconnected": bool(seat.get("disconnected")),
                "muted": seat.get("player_id") in set(room.get("muted_player_ids") or []),
                "banned": (
                    seat.get("player_id") in set(room.get("banned_player_ids") or [])
                    or multiplayer._normalized_player_name(seat.get("name")) in {
                        multiplayer._normalized_player_name(name)
                        for name in (room.get("banned_player_names") or [])
                    }
                ),
                "is_host": seat.get("player_id") == room.get("host_player_id"),
            }
            for seat in room.get("seats", [])
        ],
        "chat": [
            {
                "id": message.get("id"),
                "player_name": message.get("player_name"),
                "message": message.get("message"),
                "system": bool(message.get("system")),
                "created_at": _iso(message.get("created_at")),
            }
            for message in (room.get("chat") or [])[-20:]
        ],
    }


def _redacted_event_summary(event: dict) -> dict[str, Any]:
    return {
        "id": event["id"],
        "name": event.get("name"),
        "format": event.get("format"),
        "status": event.get("status"),
        "public": bool(event.get("public", True)),
        "organizer_name": event.get("organizer_name"),
        "player_count": len(event.get("players") or []),
        "match_count": len(event.get("matches") or []),
        "created_at": _iso(event.get("created_at")),
        "updated_at": _iso(event.get("updated_at")),
    }


def _rotate_audit_if_needed() -> None:
    if not ADMIN_AUDIT_STORE_PATH.exists():
        return
    if ADMIN_AUDIT_STORE_PATH.stat().st_size <= MAX_ADMIN_AUDIT_BYTES:
        return
    rotated = ADMIN_AUDIT_STORE_PATH.with_suffix(".jsonl.1")
    if rotated.exists():
        rotated.unlink()
    ADMIN_AUDIT_STORE_PATH.replace(rotated)


def _append_audit(action: str, target_type: str, target_id: str, detail: dict[str, Any] | None = None) -> dict[str, Any]:
    record = {
        "id": secrets.token_urlsafe(8),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "detail": detail or {},
    }
    with _audit_lock:
        ADMIN_AUDIT_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _rotate_audit_if_needed()
        with ADMIN_AUDIT_STORE_PATH.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


def _read_jsonl(path: Path, limit: int) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()[-limit:]
    except OSError:
        return []
    records: list[dict[str, Any]] = []
    for line in lines:
        try:
            records.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return records


def _room_or_404(room_id: str) -> dict:
    room = multiplayer._rooms.get(room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")
    return room


def _event_or_404(event_id: str) -> dict:
    event = multiplayer._events.get(event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("/auth-check", response_model=AdminAuthResponse)
async def auth_check(request: Request) -> AdminAuthResponse:
    _require_admin(request)
    return AdminAuthResponse(ok=True)


@router.get("/overview", response_model=AdminOverviewResponse)
async def overview(request: Request) -> AdminOverviewResponse:
    _require_admin(request)
    with multiplayer._lock:
        rooms = sorted(
            [_redacted_room_summary(room) for room in multiplayer._rooms.values()],
            key=lambda item: item.get("updated_at") or "",
            reverse=True,
        )
        events = sorted(
            [_redacted_event_summary(event) for event in multiplayer._events.values()],
            key=lambda item: item.get("updated_at") or "",
            reverse=True,
        )
    return AdminOverviewResponse(
        status="ok",
        generated_at=datetime.now(timezone.utc).isoformat(),
        room_count=len(rooms),
        active_room_count=len([room for room in rooms if room.get("status") != "closed"]),
        event_count=len(events),
        running_event_count=len([event for event in events if event.get("status") == "running"]),
        rooms=rooms[:100],
        events=events[:100],
        client_events=_read_jsonl(ops.CLIENT_EVENT_STORE_PATH, 60),
        audit_events=_read_jsonl(ADMIN_AUDIT_STORE_PATH, 80),
    )


@router.post("/rooms/{room_id}/close")
async def close_room(room_id: str, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        room = _room_or_404(room_id)
        room["status"] = "closed"
        room["updated_at"] = multiplayer._now()
        message = "Admin closed the room."
        if req.reason:
            message = f"{message} Reason: {req.reason}"
        multiplayer._add_chat(room, "System", message, system=True)
        multiplayer._save_rooms_locked()
        audit = _append_audit("close_room", "room", room_id, {"reason": req.reason})
        return {"ok": True, "room": _redacted_room_summary(room), "audit": audit}


@router.delete("/rooms/{room_id}")
async def delete_room(room_id: str, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        _room_or_404(room_id)
        multiplayer._rooms.pop(room_id, None)
        multiplayer._save_rooms_locked()
        audit = _append_audit("delete_room", "room", room_id, {"reason": req.reason})
        return {"ok": True, "audit": audit}


@router.post("/rooms/{room_id}/seats/{seat}/kick")
async def kick_room_seat(room_id: str, seat: int, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        room = _room_or_404(room_id)
        target = next((item for item in room.get("seats", []) if int(item.get("seat", 0)) == seat), None)
        if not target or not target.get("player_id"):
            raise HTTPException(status_code=404, detail="Seat is empty")
        kicked_player_id = target.get("player_id")
        kicked_name = target.get("name") or f"Seat {seat}"
        if room.get("game") or room.get("real_game"):
            target["disconnected"] = True
            if room.get("game"):
                for player in room["game"].get("players", []):
                    if player.get("player_id") == kicked_player_id:
                        player["conceded"] = True
        else:
            for key in ["player_id", "name", "deck_name", "commander", "deck"]:
                target[key] = None
            target["ready"] = False
            target["disconnected"] = False
        if room.get("host_player_id") == kicked_player_id:
            replacement = next((item for item in room.get("seats", []) if item.get("player_id") and item is not target), None)
            room["host_player_id"] = replacement.get("player_id") if replacement else None
        room["updated_at"] = multiplayer._now()
        multiplayer._add_chat(room, "System", f"Admin removed {kicked_name} from the room.", system=True)
        multiplayer._save_rooms_locked()
        audit = _append_audit("kick_seat", "room", room_id, {"seat": seat, "player_name": kicked_name, "reason": req.reason})
        return {"ok": True, "room": _redacted_room_summary(room), "audit": audit}


@router.post("/rooms/{room_id}/seats/{seat}/mute")
async def mute_room_seat(room_id: str, seat: int, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        room = _room_or_404(room_id)
        target = next((item for item in room.get("seats", []) if int(item.get("seat", 0)) == seat), None)
        if not target or not target.get("player_id"):
            raise HTTPException(status_code=404, detail="Seat is empty")
        muted = room.setdefault("muted_player_ids", [])
        if target["player_id"] not in muted:
            muted.append(target["player_id"])
        room["updated_at"] = multiplayer._now()
        multiplayer._add_chat(room, "System", f"Admin muted {target.get('name') or f'Seat {seat}'} in room chat.", system=True)
        multiplayer._save_rooms_locked()
        audit = _append_audit("mute_seat", "room", room_id, {"seat": seat, "player_name": target.get("name"), "reason": req.reason})
        return {"ok": True, "room": _redacted_room_summary(room), "audit": audit}


@router.post("/rooms/{room_id}/seats/{seat}/unmute")
async def unmute_room_seat(room_id: str, seat: int, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        room = _room_or_404(room_id)
        target = next((item for item in room.get("seats", []) if int(item.get("seat", 0)) == seat), None)
        if not target or not target.get("player_id"):
            raise HTTPException(status_code=404, detail="Seat is empty")
        room["muted_player_ids"] = [
            player_id for player_id in (room.get("muted_player_ids") or [])
            if player_id != target["player_id"]
        ]
        room["updated_at"] = multiplayer._now()
        multiplayer._add_chat(room, "System", f"Admin unmuted {target.get('name') or f'Seat {seat}'} in room chat.", system=True)
        multiplayer._save_rooms_locked()
        audit = _append_audit("unmute_seat", "room", room_id, {"seat": seat, "player_name": target.get("name"), "reason": req.reason})
        return {"ok": True, "room": _redacted_room_summary(room), "audit": audit}


@router.post("/rooms/{room_id}/seats/{seat}/ban")
async def ban_room_seat(room_id: str, seat: int, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        room = _room_or_404(room_id)
        target = next((item for item in room.get("seats", []) if int(item.get("seat", 0)) == seat), None)
        if not target or not target.get("player_id"):
            raise HTTPException(status_code=404, detail="Seat is empty")
        banned_ids = room.setdefault("banned_player_ids", [])
        banned_names = room.setdefault("banned_player_names", [])
        if target["player_id"] not in banned_ids:
            banned_ids.append(target["player_id"])
        name = target.get("name") or f"Seat {seat}"
        if name and name not in banned_names:
            banned_names.append(name)
        if room.get("game") or room.get("real_game"):
            target["disconnected"] = True
            if room.get("game"):
                for player in room["game"].get("players", []):
                    if player.get("player_id") == target["player_id"]:
                        player["conceded"] = True
        else:
            for key in ["player_id", "name", "deck_name", "commander", "deck"]:
                target[key] = None
            target["ready"] = False
            target["disconnected"] = False
        if room.get("host_player_id") in banned_ids:
            replacement = next((item for item in room.get("seats", []) if item.get("player_id")), None)
            room["host_player_id"] = replacement.get("player_id") if replacement else None
        room["updated_at"] = multiplayer._now()
        multiplayer._add_chat(room, "System", f"Admin banned {name} from the room.", system=True)
        multiplayer._save_rooms_locked()
        audit = _append_audit("ban_seat", "room", room_id, {"seat": seat, "player_name": name, "reason": req.reason})
        return {"ok": True, "room": _redacted_room_summary(room), "audit": audit}


@router.delete("/rooms/{room_id}/chat/{message_id}")
async def remove_room_chat(room_id: str, message_id: str, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        room = _room_or_404(room_id)
        before = len(room.get("chat") or [])
        removed = next((message for message in room.get("chat", []) if message.get("id") == message_id), None)
        room["chat"] = [message for message in room.get("chat", []) if message.get("id") != message_id]
        if len(room["chat"]) == before:
            raise HTTPException(status_code=404, detail="Chat message not found")
        room["updated_at"] = multiplayer._now()
        multiplayer._add_chat(room, "System", "Admin removed a chat message.", system=True)
        multiplayer._save_rooms_locked()
        audit = _append_audit(
            "remove_chat",
            "room",
            room_id,
            {"message_id": message_id, "player_name": removed.get("player_name") if removed else None, "reason": req.reason},
        )
        return {"ok": True, "room": _redacted_room_summary(room), "audit": audit}


@router.post("/rooms/{room_id}/announce")
async def announce_room(room_id: str, req: AdminAnnouncementRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        room = _room_or_404(room_id)
        multiplayer._add_chat(room, "Admin", req.message, system=True)
        room["updated_at"] = multiplayer._now()
        multiplayer._save_rooms_locked()
        audit = _append_audit("announce_room", "room", room_id, {"message": req.message[:120]})
        return {"ok": True, "room": _redacted_room_summary(room), "audit": audit}


@router.post("/events/{event_id}/close")
async def close_event(event_id: str, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        event = _event_or_404(event_id)
        event["status"] = "complete"
        event["updated_at"] = multiplayer._now()
        event.setdefault("announcements", []).append(
            {
                "id": secrets.token_urlsafe(8),
                "created_at": multiplayer._now(),
                "message": f"Admin closed the event.{f' Reason: {req.reason}' if req.reason else ''}",
            }
        )
        multiplayer._save_events_locked()
        audit = _append_audit("close_event", "event", event_id, {"reason": req.reason})
        return {"ok": True, "event": _redacted_event_summary(event), "audit": audit}


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, req: AdminActionRequest, request: Request) -> dict[str, Any]:
    _require_admin(request)
    with multiplayer._lock:
        _event_or_404(event_id)
        multiplayer._events.pop(event_id, None)
        multiplayer._save_events_locked()
        audit = _append_audit("delete_event", "event", event_id, {"reason": req.reason})
        return {"ok": True, "audit": audit}
