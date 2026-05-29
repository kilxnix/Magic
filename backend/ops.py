"""Small production observability endpoints.

This keeps client diagnostics useful without collecting room passwords, player
tokens, decklists, or other sensitive gameplay payloads.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/ops", tags=["ops"])

CLIENT_EVENT_STORE_PATH = Path(os.getenv("CLIENT_EVENT_STORE", "/app/runtime/client_events.jsonl"))
MAX_CLIENT_EVENT_BYTES = int(os.getenv("CLIENT_EVENT_MAX_BYTES", str(5 * 1024 * 1024)))
CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
QUERY_OR_HASH_RE = re.compile(r"[?#].*$")
TOKENISH_RE = re.compile(r"(?i)(player[_-]?id|token|password|secret|key)=([^&\s]+)")
SENSITIVE_DETAIL_KEY_RE = re.compile(r"(?i)(token|password|secret|player[_-]?id|key)")
_lock = threading.RLock()
_started_at = datetime.now(timezone.utc)


class ClientEventRequest(BaseModel):
    kind: Literal[
        "frontend_error",
        "unhandled_rejection",
        "route_view",
        "api_error",
        "network",
        "recovery",
        "performance",
    ]
    severity: Literal["debug", "info", "warning", "error"] = "info"
    message: str = Field(..., min_length=1, max_length=800)
    page: Optional[str] = Field(None, max_length=300)
    request_id: Optional[str] = Field(None, max_length=80)
    component_stack: Optional[str] = Field(None, max_length=1600)
    details: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class ClientEventResponse(BaseModel):
    ok: bool
    id: str


class OpsStatusResponse(BaseModel):
    status: str
    started_at: str
    generated_at: str
    runtime_writable: bool
    client_event_store: str


def _clean_text(value: str | None, *, max_length: int) -> str | None:
    if value is None:
        return None
    cleaned = CONTROL_CHARS_RE.sub("", str(value))
    cleaned = TOKENISH_RE.sub(r"\1=[redacted]", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned.strip())
    if not cleaned:
        return None
    return cleaned[:max_length]


def _clean_page(value: str | None) -> str | None:
    cleaned = _clean_text(value, max_length=300)
    if not cleaned:
        return None
    cleaned = QUERY_OR_HASH_RE.sub("", cleaned)
    return cleaned[:300]


def _clean_details(details: dict[str, str | int | float | bool | None]) -> dict[str, str | int | float | bool | None]:
    safe: dict[str, str | int | float | bool | None] = {}
    for key, value in list(details.items())[:20]:
        clean_key = _clean_text(key, max_length=60)
        if not clean_key:
            continue
        if SENSITIVE_DETAIL_KEY_RE.search(clean_key):
            safe[clean_key] = "[redacted]"
            continue
        if isinstance(value, str):
            safe[clean_key] = _clean_text(value, max_length=240)
        elif isinstance(value, (int, float, bool)) or value is None:
            safe[clean_key] = value
    return safe


def _rotate_if_needed() -> None:
    if not CLIENT_EVENT_STORE_PATH.exists():
        return
    if CLIENT_EVENT_STORE_PATH.stat().st_size <= MAX_CLIENT_EVENT_BYTES:
        return
    rotated = CLIENT_EVENT_STORE_PATH.with_suffix(".jsonl.1")
    if rotated.exists():
        rotated.unlink()
    CLIENT_EVENT_STORE_PATH.replace(rotated)


@router.get("/status", response_model=OpsStatusResponse)
async def ops_status() -> OpsStatusResponse:
    runtime_writable = True
    try:
        CLIENT_EVENT_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
        probe = CLIENT_EVENT_STORE_PATH.parent / ".deckreps-write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError:
      runtime_writable = False

    return OpsStatusResponse(
        status="ok" if runtime_writable else "degraded",
        started_at=_started_at.isoformat(),
        generated_at=datetime.now(timezone.utc).isoformat(),
        runtime_writable=runtime_writable,
        client_event_store=str(CLIENT_EVENT_STORE_PATH),
    )


@router.post("/client-events", response_model=ClientEventResponse)
async def record_client_event(req: ClientEventRequest, request: Request) -> ClientEventResponse:
    event_id = secrets.token_urlsafe(8)
    record = {
        "id": event_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "kind": req.kind,
        "severity": req.severity,
        "message": _clean_text(req.message, max_length=800),
        "page": _clean_page(req.page),
        "request_id": _clean_text(req.request_id, max_length=80),
        "component_stack": _clean_text(req.component_stack, max_length=1600),
        "details": _clean_details(req.details),
        "user_agent": _clean_text(request.headers.get("user-agent"), max_length=240),
    }
    if not record["message"]:
        raise HTTPException(status_code=400, detail="Event message is required")

    with _lock:
        try:
            CLIENT_EVENT_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
            _rotate_if_needed()
            with CLIENT_EVENT_STORE_PATH.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            raise HTTPException(status_code=500, detail="Client event could not be saved")

    return ClientEventResponse(ok=True, id=event_id)
