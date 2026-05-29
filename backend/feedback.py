"""Lightweight user feedback intake for launch-alpha reports."""

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


router = APIRouter(prefix="/api/feedback", tags=["feedback"])

FEEDBACK_STORE_PATH = Path(os.getenv("FEEDBACK_STORE", "/app/runtime/feedback.jsonl"))
FEEDBACK_LINK_RE = re.compile(
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
EMAIL_RE = re.compile(r"^[^@\s]{1,80}@[^@\s]{1,120}\.[^@\s]{2,24}$")
_lock = threading.RLock()


class FeedbackRequest(BaseModel):
    category: Literal["bug", "improvement", "rules", "room", "other"] = "improvement"
    message: str = Field(..., min_length=10, max_length=1200)
    email: Optional[str] = Field(None, max_length=160)
    page: Optional[str] = Field(None, max_length=300)


class FeedbackResponse(BaseModel):
    ok: bool
    id: str
    message: str


def _clean_text(
    value: str,
    *,
    field_name: str,
    max_length: int,
    min_length: int = 0,
    block_links: bool = True,
) -> str:
    cleaned = CONTROL_CHARS_RE.sub("", str(value))
    cleaned = re.sub(r"\s+", " ", cleaned.strip())
    if len(cleaned) < min_length:
        raise HTTPException(status_code=400, detail=f"{field_name} must be at least {min_length} characters")
    if len(cleaned) > max_length:
        raise HTTPException(status_code=400, detail=f"{field_name} must be {max_length} characters or fewer")
    if block_links and FEEDBACK_LINK_RE.search(cleaned):
        raise HTTPException(status_code=400, detail=f"{field_name} cannot contain links")
    return cleaned


@router.post("", response_model=FeedbackResponse)
async def submit_feedback(req: FeedbackRequest, request: Request) -> FeedbackResponse:
    message = _clean_text(req.message, field_name="Feedback", max_length=1200, min_length=10)
    page = _clean_text(req.page or "", field_name="Page", max_length=300) or None
    email = _clean_text(req.email or "", field_name="Email", max_length=160, block_links=False) or None
    if email and not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Email must be valid or left blank")

    feedback_id = secrets.token_urlsafe(10)
    record = {
        "id": feedback_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "category": req.category,
        "message": message,
        "email": email,
        "page": page,
        "user_agent": request.headers.get("user-agent", "")[:240],
    }

    with _lock:
        try:
            FEEDBACK_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with FEEDBACK_STORE_PATH.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            raise HTTPException(status_code=500, detail="Feedback could not be saved")

    return FeedbackResponse(
        ok=True,
        id=feedback_id,
        message="Thanks. Your feedback was saved for review.",
    )
