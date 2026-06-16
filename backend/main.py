"""FastAPI backend for MTG Commander deck generation."""

import hashlib
import json
import logging
import os
import re
import secrets
import time
import unicodedata
from collections import defaultdict, deque
from pathlib import Path
from typing import List, Optional

import requests
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from backend.deck_generator import get_generator, reload_generator
from backend.rules import COMMANDER_BRACKETS, PRICE_TIERS, get_core_staples_for_colors
from backend.database import (
    init_db, save_deck, get_deck, get_recent_decks, get_decks_by_ids,
    init_images_db, get_card_image, get_image_stats, has_card_image,
    resolve_api_key, consume_api_key_quota, refresh_api_key_cache,
    refund_api_key_quota, get_api_key_status,
)
from backend.card_alternatives import get_alternative_finder, CardAlternative
from backend.price_service import get_card_prices, get_cheapest_price, get_price_category, SCRYFALL_HEADERS
from backend.deck_url_parser import fetch_deck_from_url, detect_site
from backend.draft import get_cards_for_draft_sets, get_draft_set_summaries
from backend.feedback import router as feedback_router
from backend.multiplayer import router as multiplayer_router
from backend.ops import router as ops_router
from backend.admin import router as admin_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

DEFAULT_ALLOWED_ORIGIN_REGEX = (
    r"^https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$"
    r"|^https://.*\.trycloudflare\.com$"
)


def _split_env_list(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


ALLOWED_ORIGINS = _split_env_list(os.getenv("ALLOWED_ORIGINS")) or DEFAULT_ALLOWED_ORIGINS
ALLOWED_ORIGIN_REGEX = os.getenv("ALLOWED_ORIGIN_REGEX", DEFAULT_ALLOWED_ORIGIN_REGEX).strip() or None
SHELECTOR_API_URL = os.getenv("SHELECTOR_API_URL", "http://localhost:8100").rstrip("/")
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN", "")
MAX_REQUEST_BODY_BYTES = int(os.getenv("MAX_REQUEST_BODY_BYTES", str(2 * 1024 * 1024)))
RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_ENABLED", "true").lower() == "true"
RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
RATE_LIMIT_DEFAULT = int(os.getenv("RATE_LIMIT_DEFAULT_PER_MINUTE", "240"))
RATE_LIMIT_QA_BYPASS_ENABLED = os.getenv("RATE_LIMIT_QA_BYPASS_ENABLED", "true").lower() == "true"
TRUST_PROXY_HEADERS = os.getenv("TRUST_PROXY_HEADERS", "true").lower() == "true"
# Number of trusted reverse-proxy hops in front of the app (Caddy = 1). The real
# client IP is this many entries from the RIGHT of X-Forwarded-For; reading the
# leftmost (client-supplied) value would let a caller spoof the header to rotate
# identities and bypass per-IP rate limits.
TRUSTED_PROXY_HOPS = max(1, int(os.getenv("TRUSTED_PROXY_HOPS", "1")))
RATE_LIMIT_MULTIPLAYER_DEFAULT = int(os.getenv("RATE_LIMIT_MULTIPLAYER_PER_MINUTE", "1200"))


def _parse_api_keys(raw: str) -> dict:
    """Parse a "key1:label1,key2,key3:label3" env string into {key: label}.

    Labels are optional and used only for human attribution in logs — never for
    rate-metering (that's keyed on a hash of the secret, so colliding/duplicate
    labels can't merge two licensees' quotas). Keys must not contain ':' (the
    label delimiter); tokens generated with secrets.token_urlsafe never do. A
    bare key gets a hash-derived fingerprint label that leaks no key bytes."""
    out: dict = {}
    for item in (raw or "").split(","):
        item = item.strip()
        if not item:
            continue
        if ":" in item:
            key, _, label = item.partition(":")
            key, label = key.strip(), label.strip()
        else:
            key, label = item, ""
        if key:
            out[key] = label or f"key-{hashlib.sha256(key.encode()).hexdigest()[:8]}"
    return out


# --- Card-support licensing API: auth + dedicated rate bucket -----------------
# Keys are issued to integrators. When CARD_SUPPORT_REQUIRE_AUTH is on, a valid
# key is required (401 otherwise); keyed callers are metered per key (so a
# licensee's quota can't be exhausted by someone spoofing their IP), while
# anonymous callers (when auth isn't required) get a stricter shared IP bucket.
CARD_SUPPORT_API_KEYS = _parse_api_keys(os.getenv("CARD_SUPPORT_API_KEYS", ""))
CARD_SUPPORT_REQUIRE_AUTH = os.getenv("CARD_SUPPORT_REQUIRE_AUTH", "false").lower() == "true"
CARD_SUPPORT_RATE_LIMIT = int(os.getenv("CARD_SUPPORT_RATE_LIMIT_PER_MINUTE", "600"))
CARD_SUPPORT_ANON_RATE_LIMIT = int(os.getenv("CARD_SUPPORT_ANON_RATE_LIMIT_PER_MINUTE", "60"))

RATE_LIMIT_RULES = [
    ("/api/generate-deck", int(os.getenv("RATE_LIMIT_DECK_GENERATION_PER_MINUTE", "6"))),
    ("/api/regenerate-deck", int(os.getenv("RATE_LIMIT_DECK_REGEN_PER_MINUTE", "10"))),
    ("/api/parse-deck-url", int(os.getenv("RATE_LIMIT_DECK_IMPORT_PER_MINUTE", "20"))),
    ("/api/cards-batch", int(os.getenv("RATE_LIMIT_CARD_BATCH_PER_MINUTE", "60"))),
    ("/api/deck/optimize", int(os.getenv("RATE_LIMIT_OPTIMIZER_PER_MINUTE", "20"))),
    ("/api/feedback", int(os.getenv("RATE_LIMIT_FEEDBACK_PER_MINUTE", "10"))),
    ("/api/admin", int(os.getenv("RATE_LIMIT_ADMIN_PER_MINUTE", "600"))),
    ("/api/ops/client-events", int(os.getenv("RATE_LIMIT_CLIENT_EVENTS_PER_MINUTE", "60"))),
    ("/api/multiplayer/events", RATE_LIMIT_MULTIPLAYER_DEFAULT),
    ("/api/multiplayer/rooms", RATE_LIMIT_MULTIPLAYER_DEFAULT),
    ("/shelector-api/generate-ai-deck", int(os.getenv("RATE_LIMIT_AI_DECK_PER_MINUTE", "10"))),
    ("/shelector-api/import-deck", int(os.getenv("RATE_LIMIT_DECK_IMPORT_PER_MINUTE", "20"))),
    ("/shelector-api/spawn-opponent", int(os.getenv("RATE_LIMIT_SPAWN_PER_MINUTE", "30"))),
    ("/shelector-api/decide", int(os.getenv("RATE_LIMIT_DECIDE_PER_MINUTE", "120"))),
    ("/shelector-api/chat", int(os.getenv("RATE_LIMIT_CHAT_PER_MINUTE", "60"))),
]

RATE_LIMIT_EXEMPT_PATHS = {
    "/api/health",
    "/api/readiness",
    "/manifest.json",
    "/manifest.webmanifest",
    "/robots.txt",
    "/sw.js",
    "/registerSW.js",
}

_rate_limit_buckets: dict[str, deque[float]] = defaultdict(deque)
# Periodic empty/stale bucket sweep so the dict can't grow without bound across
# many distinct client identities over time.
_rate_limit_gc = {"tick": 0}
_RATE_LIMIT_GC_EVERY = 5000

app = FastAPI(
    title="Magic Brains Commander Practice",
    description="Practice Commander decks with beta browser reps and post-game review",
    version="1.0.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)

app.include_router(multiplayer_router)
app.include_router(feedback_router)
app.include_router(ops_router)
app.include_router(admin_router)


def _client_ip(request: Request) -> str:
    if TRUST_PROXY_HEADERS:
        forwarded_for = request.headers.get("x-forwarded-for", "")
        if forwarded_for:
            # Each proxy APPENDS the address it received the request from, so the
            # genuine client is TRUSTED_PROXY_HOPS entries from the right end. If
            # the chain is shorter than expected, fall back to the RIGHTMOST
            # (closest-to-app, proxy-set) entry — never the spoofable leftmost.
            parts = [p.strip() for p in forwarded_for.split(",") if p.strip()]
            if parts:
                return parts[-min(TRUSTED_PROXY_HOPS, len(parts))]
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
    return request.client.host if request.client else "unknown"


def _rate_limit_for_path(path: str) -> tuple[str, int]:
    for prefix, limit in RATE_LIMIT_RULES:
        if path.startswith(prefix):
            return prefix, limit
    return "default", RATE_LIMIT_DEFAULT


def _admin_token_from_request(request: Request) -> str:
    auth_header = request.headers.get("authorization", "")
    bearer_token = auth_header.removeprefix("Bearer ").strip() if auth_header.startswith("Bearer ") else ""
    return request.headers.get("x-admin-token", "") or bearer_token


def _has_valid_admin_token(request: Request) -> bool:
    provided = _admin_token_from_request(request)
    return bool(ADMIN_TOKEN and provided and secrets.compare_digest(provided, ADMIN_TOKEN))


def _require_admin(request: Request) -> None:
    if not ADMIN_TOKEN:
        raise HTTPException(status_code=403, detail="Admin endpoint disabled until ADMIN_TOKEN is configured")

    if not _has_valid_admin_token(request):
        raise HTTPException(status_code=403, detail="Admin token required")


def _extract_api_key(request: Request) -> str:
    """Pull the presented key from `X-API-Key` or `Authorization: Bearer`."""
    provided = request.headers.get("x-api-key", "").strip()
    if not provided:
        auth = request.headers.get("authorization", "")
        if auth.startswith("Bearer "):
            provided = auth[len("Bearer "):].strip()
    return provided


def _resolve_card_support_key(request: Request) -> Optional[dict]:
    """Resolve a presented key to {key_id, source, rate_limit} or None.

    Checks the static env keys first (unlimited bootstrap keys), then the
    DB-backed keys (which carry depleting quotas, managed from the admin
    console). The key_id is a hash fingerprint — unique per key, no key bytes —
    used as the rate-metering bucket id. Env comparison is on UTF-8 bytes so a
    non-ASCII header byte denies cleanly instead of raising."""
    provided = _extract_api_key(request)
    if not provided:
        return None
    provided_bytes = provided.encode("utf-8", "ignore")
    for key in CARD_SUPPORT_API_KEYS:
        if secrets.compare_digest(provided_bytes, key.encode("utf-8")):
            return {
                "key_id": hashlib.sha256(key.encode("utf-8")).hexdigest()[:16],
                "source": "env",
                "rate_limit": None,
            }
    db_key = resolve_api_key(provided)
    if db_key is not None:
        return {
            "key_id": db_key["key_id"],
            "source": "db",
            "rate_limit": db_key.get("rate_limit_per_minute"),
        }
    return None


def _card_support_key_id(request: Request) -> Optional[str]:
    """The opaque rate-metering id for the valid key on this request, or None."""
    info = _resolve_card_support_key(request)
    return info["key_id"] if info else None


def require_card_support_access(request: Request) -> Optional[str]:
    """FastAPI dependency gating the card-support licensing API.

    Returns the caller's opaque key id (or None when auth isn't required). Raises
    401 when auth is required and no valid key is presented (or a DB key was
    revoked), or 403 when a valid DB key has exhausted its quota.

    For DB keys the quota is charged here (atomic), and the charge is recorded on
    request.state so `production_guardrails` can REFUND it if the response ends
    up an error — i.e. licensees are billed only for successful (2xx) calls."""
    info = _resolve_card_support_key(request)
    if info is None:
        if CARD_SUPPORT_REQUIRE_AUTH:
            raise HTTPException(
                status_code=401,
                detail="A valid API key is required. Send it in the 'X-API-Key' header.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return None
    if info["source"] == "db":
        if consume_api_key_quota(info["key_id"]):
            request.state.card_support_charged_key_id = info["key_id"]
        elif get_api_key_status(info["key_id"]) != "active":
            # Revoked between resolution and charge (e.g. stale cache) — not a
            # quota problem, so deny as unauthenticated.
            raise HTTPException(
                status_code=401,
                detail="API key is no longer valid.",
                headers={"WWW-Authenticate": "Bearer"},
            )
        else:
            raise HTTPException(
                status_code=403,
                detail="API key quota exhausted. Contact the operator to top up your key.",
            )
    return info["key_id"]


def _should_bypass_rate_limit(request: Request, path: str) -> bool:
    if not RATE_LIMIT_QA_BYPASS_ENABLED:
        return False
    if not path.startswith(("/api/multiplayer/rooms", "/api/multiplayer/replays", "/api/multiplayer/events")):
        return False
    requested = request.headers.get("x-qa-rate-limit-bypass", "").strip().lower()
    if requested not in {"1", "true", "yes"}:
        return False
    return _has_valid_admin_token(request)


@app.middleware("http")
async def production_guardrails(request: Request, call_next):
    path = request.url.path
    request_id = request.headers.get("x-request-id", "").strip()[:80] or secrets.token_hex(8)

    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > MAX_REQUEST_BODY_BYTES:
        return JSONResponse(
            status_code=413,
            headers={"X-Request-ID": request_id},
            content={"detail": f"Request body too large. Limit is {MAX_REQUEST_BODY_BYTES} bytes."},
        )

    if (
        RATE_LIMIT_ENABLED
        and request.method not in {"OPTIONS", "HEAD"}
        and not path.startswith("/assets/")
        and path not in RATE_LIMIT_EXEMPT_PATHS
        and not _should_bypass_rate_limit(request, path)
    ):
        if path.startswith("/api/card-support"):
            # Licensing API: meter authenticated callers by their API key
            # fingerprint (which can't be spoofed like an IP), anonymous callers
            # by real IP. ANON limit of 0 means "unlimited" (the `if limit > 0`
            # guard below) — to deny anonymous access entirely, set
            # CARD_SUPPORT_REQUIRE_AUTH=true, which 401s them at the route.
            bucket_name = "card-support"
            keyinfo = _resolve_card_support_key(request)
            if keyinfo is not None:
                identity = f"key:{keyinfo['key_id']}"
                # Explicit None check: a per-key limit of 0 means "deny", not
                # "use default" (which `or` would wrongly do).
                limit = (
                    CARD_SUPPORT_RATE_LIMIT
                    if keyinfo["rate_limit"] is None
                    else keyinfo["rate_limit"]
                )
            else:
                identity, limit = _client_ip(request), CARD_SUPPORT_ANON_RATE_LIMIT
        else:
            bucket_name, limit = _rate_limit_for_path(path)
            identity = _client_ip(request)
        if limit > 0:
            now = time.monotonic()
            bucket_key = f"{identity}:{bucket_name}"
            bucket = _rate_limit_buckets[bucket_key]
            cutoff = now - RATE_LIMIT_WINDOW_SECONDS
            while bucket and bucket[0] < cutoff:
                bucket.popleft()
            if len(bucket) >= limit:
                retry_after = max(1, int(RATE_LIMIT_WINDOW_SECONDS - (now - bucket[0])))
                return JSONResponse(
                    status_code=429,
                    headers={"Retry-After": str(retry_after), "X-Request-ID": request_id},
                    content={"detail": "Too many requests. Please wait and try again."},
                )
            bucket.append(now)

            _rate_limit_gc["tick"] += 1
            if _rate_limit_gc["tick"] >= _RATE_LIMIT_GC_EVERY:
                _rate_limit_gc["tick"] = 0
                stale = [
                    bk for bk, dq in _rate_limit_buckets.items()
                    if not dq or dq[-1] < cutoff
                ]
                for bk in stale:
                    _rate_limit_buckets.pop(bk, None)

    response = await call_next(request)
    # Refund a charged API-key request that ended in an error response, so
    # licensees pay only for successful (2xx/3xx) calls — not for our 5xx, their
    # 4xx validation errors, or 404 not-found lookups.
    charged_key_id = getattr(request.state, "card_support_charged_key_id", None)
    if charged_key_id and response.status_code >= 400:
        refund_api_key_quota(charged_key_id)
    response.headers["X-Request-ID"] = request_id
    return response


class DeckRequest(BaseModel):
    """Request model for deck generation."""
    commander: Optional[str] = Field(None, description="Commander name (required for Commander decks)")
    format: str = Field("commander", description="Deck format: commander or standard")
    colors: Optional[List[str]] = Field(None, description="Constructed deck colors, e.g. ['U', 'R']")
    archetype: Optional[str] = Field(None, description="Constructed archetype, e.g. aggro, control, midrange")
    bracket: int = Field(2, ge=1, le=5, description="Power level bracket (1-5)")
    theme: Optional[str] = Field(None, description="Optional deck theme/strategy")
    budget_tier: Optional[str] = Field(
        None,
        description="Budget tier: budget, affordable, moderate, premium, high_end"
    )
    use_ai: bool = Field(False, description="Use Shelector AI to re-rank card choices")


class RegenerateDeckRequest(BaseModel):
    """Request model for deck regeneration."""
    deck_id: str = Field(..., description="ID of the original deck")
    kept_card_names: List[str] = Field(..., description="Card names to keep")
    regeneration_number: int = Field(..., ge=1, le=5, description="Current regeneration (1-5)")


class RegenerateDeckResponse(BaseModel):
    """Response model for regenerated deck."""
    id: str
    commander: str
    colors: List[str]
    archetype: str
    timestamp: str
    legal_status: str
    card_count: int
    estimated_price: str
    list: List[str]
    bracket: int
    bracket_name: str
    theme: str
    categories: dict
    regenerations_remaining: int
    new_card_names: List[str]
    core_staples: List[str]
    parent_deck_id: str
    regeneration_number: int


class DeckResponse(BaseModel):
    """Response model for generated deck."""
    id: str
    commander: str
    colors: List[str]
    archetype: str
    timestamp: str
    legal_status: str
    card_count: int
    estimated_price: str
    list: List[str]
    bracket: int
    bracket_name: str
    theme: str
    categories: dict
    format: str = "commander"
    sideboard: List[str] = []
    generation_method: Optional[str] = None
    model_scoring: bool = False
    synergy_queries: List[str] = []
    ai_enhanced: bool = False
    ai_reasoning: Optional[str] = None


class CommanderInfo(BaseModel):
    """Commander information."""
    name: str
    colors: List[str]
    type_line: str
    mana_cost: Optional[str]
    oracle_text: Optional[str]


class SearchResult(BaseModel):
    """Search result for cards."""
    name: str
    type_line: str
    mana_cost: Optional[str]
    oracle_text: Optional[str]
    colors: List[str]
    score: float


class DraftSetSummary(BaseModel):
    """A set with enough local cards to synthesize draft boosters."""
    set_code: str
    set_name: str
    set_type: Optional[str] = None
    released_at: Optional[str] = None
    card_count: int
    rarities: dict


class DraftCardsRequest(BaseModel):
    """Request cards from one or more draft sets."""
    set_codes: List[str] = Field(..., min_length=1, description="Set codes for packs in this draft")


class BracketInfo(BaseModel):
    """Bracket information."""
    id: int
    name: str
    description: str
    power_level: tuple
    expected_turns: Optional[int] = None


class DeckSummary(BaseModel):
    """Summary of a deck for listings."""
    id: str
    commander: str
    colors: List[str]
    bracket: int
    theme: str
    created_at: str


class BatchRequest(BaseModel):
    """Request for batch deck fetching."""
    ids: List[str] = Field(..., max_length=50, description="List of deck IDs")


class CardsBatchRequest(BaseModel):
    """Request for batch card data fetching."""
    names: List[str] = Field(..., max_length=200, description="List of card names")


class CardFaceData(BaseModel):
    """A single face of a double-faced card."""
    name: str
    type_line: str = ""
    oracle_text: str = ""
    mana_cost: str = ""
    colors: List[str] = Field(default_factory=list)
    power: Optional[str] = None
    toughness: Optional[str] = None

class CardData(BaseModel):
    """Full card data for game engine use."""
    name: str
    type_line: str
    oracle_text: str
    mana_cost: str
    cmc: float
    colors: List[str]
    color_identity: List[str]
    keywords: List[str]
    power: Optional[str] = None
    toughness: Optional[str] = None
    layout: Optional[str] = None
    card_faces: Optional[List[CardFaceData]] = None


def _card_lookup_key(name: str) -> str:
    without_accents = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "", without_accents.lower())


def _find_card_by_requested_name(generator, name: str):
    card = generator.card_by_name.get(name)
    if card:
        return card
    lookup_key = _card_lookup_key(name)
    if not lookup_key:
        return None
    normalised = getattr(generator, "_card_by_lookup_key", None)
    if normalised is None:
        normalised = {}
        for candidate in generator.card_by_name.values():
            key = _card_lookup_key(candidate.get("name") or "")
            if key and key not in normalised:
                normalised[key] = candidate
            for face in candidate.get("card_faces") or []:
                face_key = _card_lookup_key(face.get("name") or "")
                if face_key and face_key not in normalised:
                    normalised[face_key] = candidate
        setattr(generator, "_card_by_lookup_key", normalised)
    return normalised.get(lookup_key)


class CardAlternativeResponse(BaseModel):
    """A card alternative with scoring details."""
    name: str
    oracle_text: str
    type_line: str
    mana_cost: str
    cmc: int
    color_identity: List[str]
    price_usd: Optional[float]
    price_category: str
    functional_tags: List[str]
    faiss_score: float
    gpt2_score: float
    qwen_score: float
    category_score: float
    final_score: float
    price_savings: float
    tradeoff_explanation: str
    purchase_links: dict


class AlternativesResponse(BaseModel):
    """Response for card alternatives lookup."""
    source_card: str
    source_price: Optional[float]
    alternatives: List[CardAlternativeResponse]


class DeckOptimizeRequest(BaseModel):
    """Request for deck optimization."""
    cards: List[str] = Field(..., description="List of card names in the deck")
    target_savings: Optional[float] = Field(None, description="Target dollar amount to save")
    max_swaps: int = Field(10, le=20, description="Maximum number of swaps to suggest")
    color_identity: Optional[List[str]] = Field(None, description="Commander color identity")


class SwapSuggestion(BaseModel):
    """A suggested card swap."""
    original_card: str
    original_price: float
    alternative: CardAlternativeResponse
    savings: float


class DeckOptimizeResponse(BaseModel):
    """Response for deck optimization."""
    total_savings: float
    swap_count: int
    suggestions: List[SwapSuggestion]


class CardPriceResponse(BaseModel):
    """Response for card price lookup."""
    name: str
    cheapest_usd: Optional[float]
    price_category: str
    vendors: dict


@app.on_event("startup")
async def startup_event():
    """Pre-load the deck generator and initialize databases."""
    logger.info("Initializing databases...")
    init_db()
    init_images_db()
    refresh_api_key_cache()
    logger.info("Loading deck generator...")
    try:
        generator = get_generator()
        logger.info(f"Loaded {len(generator.cards)} cards")
    except Exception as e:
        logger.error(f"Failed to load deck generator: {e}")
        raise


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.get("/api/readiness")
async def readiness_check():
    """Production readiness checks for static assets and local MTG data."""
    project_root = Path(__file__).parent.parent
    frontend_dist = project_root / "frontend" / "dist" / "index.html"
    mtg_data = project_root / "mtg_data"
    required_files = {
        "frontend_dist": frontend_dist,
        "cards_min": mtg_data / "cards_min.jsonl",
        "embeddings": mtg_data / "card_embeddings.npy",
        "embeddings_meta": mtg_data / "card_embeddings_meta.json",
        "faiss_index": mtg_data / "card_index.faiss",
        "ai_deck_pool": project_root / "data" / "ai_decks" / "deck_pool.json",
    }
    checks = {
        name: {
            "ok": path.exists(),
            "path": str(path),
        }
        for name, path in required_files.items()
    }
    ready = all(item["ok"] for item in checks.values())
    return {
        "status": "ready" if ready else "degraded",
        "checks": checks,
        "shelector_api_url": SHELECTOR_API_URL,
    }


def _shelector_rerank(
    commander: str,
    theme: str,
    bracket: int,
    card_list: list,
    categories: dict,
) -> tuple[list, dict, str]:
    """Call the Shelector /evaluate-cards endpoint to re-rank synergy cards.

    Returns (improved_list, improved_categories, reasoning).
    Falls back to originals on any error.
    """
    # Identify synergy/theme cards that are candidates for re-ranking.
    # We leave core staples (ramp, removal, draw, lands, commander) untouched.
    protected_categories = {"Ramp", "Card Draw", "Removal", "Lands", "Commander"}
    protected_cards: set = set()
    swappable_cards: list = []

    for cat, names in categories.items():
        if cat in protected_categories:
            protected_cards.update(names)
        else:
            swappable_cards.extend(names)

    if not swappable_cards:
        return card_list, categories, ""

    # Ask Shelector to rank the swappable cards
    try:
        resp = requests.post(
            f"{SHELECTOR_API_URL}/evaluate-cards",
            json={
                "commander": commander,
                "theme": theme,
                "bracket": bracket,
                "candidates": swappable_cards,
                "slots_needed": len(swappable_cards),
            },
            timeout=90,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.warning("Shelector rerank failed: %s", e)
        return card_list, categories, f"Shelector unavailable: {e}"

    ranked = data.get("ranked_cards", [])
    reasoning = data.get("reasoning", "")

    if not ranked:
        return card_list, categories, reasoning

    # Rebuild the card list using AI-ranked order for the swappable slots
    # while preserving protected cards in their original positions.
    ranked_set = set(ranked)
    # Keep all protected cards, replace swappable section with AI ranking
    new_list = [c for c in card_list if c in protected_cards]
    new_list.extend(ranked)
    # Add any swappable cards the Shelector didn't mention back
    for c in swappable_cards:
        if c not in ranked_set and c not in protected_cards:
            new_list.append(c)

    # Rebuild categories with AI-ranked order
    new_categories = {}
    for cat, names in categories.items():
        if cat in protected_categories:
            new_categories[cat] = names
        else:
            # Re-order this category's cards by their rank in the AI list
            rank_map = {name: i for i, name in enumerate(ranked)}
            sorted_names = sorted(
                names,
                key=lambda n: rank_map.get(n, len(ranked)),
            )
            new_categories[cat] = sorted_names

    return new_list, new_categories, reasoning


@app.post("/api/generate-deck", response_model=DeckResponse)
async def generate_deck(request: DeckRequest):
    """
    Generate a Commander or Standard deck.

    The deck follows Command Zone rules:
    - Max 34 lands
    - 10+ ramp cards
    - 10+ card draw
    - 8+ removal spells
    - 2+ wincons
    - Rest filled with synergy/theme cards

    Bracket restrictions are applied:
    - Bracket 1-2: No game changers, MLD, combos, extra turns
    - Bracket 3: Limited game changers (3), no MLD, limited combos
    - Bracket 4-5: No restrictions except banned list

    When use_ai=true, the Shelector brain re-ranks synergy/theme cards
    for better commander fit.
    """
    import uuid
    from datetime import datetime

    generator = get_generator()
    format_name = (request.format or "commander").lower()
    if format_name not in {"commander", "standard"}:
        raise HTTPException(status_code=400, detail="format must be 'commander' or 'standard'")

    # Validate budget tier if provided
    if request.budget_tier and request.budget_tier not in PRICE_TIERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid budget_tier. Must be one of: {list(PRICE_TIERS.keys())}"
        )

    if format_name == "standard":
        result = generator.generate_standard_deck(
            colors=request.colors or ["R"],
            archetype=request.archetype or request.theme or "midrange",
            theme=request.theme or "",
            budget_tier=request.budget_tier,
            use_model_scoring=request.use_ai,
        )
    else:
        if not request.commander:
            raise HTTPException(status_code=400, detail="Commander is required for Commander decks")
        result = generator.generate_deck(
            commander_name=request.commander,
            bracket=request.bracket,
            theme=request.theme or "",
            budget_tier=request.budget_tier,
            use_model_scoring=request.use_ai,
        )

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    ai_enhanced = False
    ai_reasoning = None

    # Optionally enhance with Shelector AI
    if request.use_ai and format_name == "commander":
        improved_list, improved_categories, reasoning = _shelector_rerank(
            commander=result["commander"],
            theme=result.get("theme", ""),
            bracket=result["bracket"],
            card_list=result["list"],
            categories=result["categories"],
        )
        result["list"] = improved_list
        result["categories"] = improved_categories
        ai_enhanced = True
        ai_reasoning = reasoning or "Shelector evaluated card choices for this deck."

    deck_response = DeckResponse(
        id=str(uuid.uuid4())[:8],
        commander=result["commander"],
        colors=result["colors"],
        archetype=result["archetype"],
        timestamp=datetime.now().isoformat(),
        legal_status=result["legal_status"],
        card_count=result["card_count"],
        estimated_price=result["estimated_price"],
        list=result["list"],
        bracket=result["bracket"],
        bracket_name=result["bracket_name"],
        theme=result["theme"],
        categories=result["categories"],
        format=result.get("format", format_name),
        sideboard=result.get("sideboard", []),
        generation_method=result.get("generation_method"),
        model_scoring=result.get("model_scoring", False),
        synergy_queries=result.get("synergy_queries", []),
        ai_enhanced=ai_enhanced,
        ai_reasoning=ai_reasoning,
    )

    # Save to database
    save_deck(deck_response.model_dump())
    logger.info(f"Saved deck {deck_response.id} to database")

    return deck_response


@app.post("/api/generate-deck-v2")
async def generate_deck_v2(request: DeckRequest):
    """Generate a deck using the Qwen3.5 model (falls back to FAISS if unavailable)."""
    if not request.commander:
        raise HTTPException(status_code=400, detail="Commander is required for Commander decks")
    generator = get_generator()
    result = generator.generate_deck_with_model(
        commander_name=request.commander,
        bracket=request.bracket,
        theme=request.theme or "",
        budget_tier=request.budget_tier,
    )
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@app.post("/api/regenerate-deck", response_model=RegenerateDeckResponse)
async def regenerate_deck(request: RegenerateDeckRequest):
    """
    Regenerate a deck while keeping specified cards.

    Users can regenerate up to 5 times per initial deck.
    Core staples are automatically kept and cannot be manually locked.
    """
    import uuid
    from datetime import datetime

    # Validate regeneration limit
    if request.regeneration_number > 5:
        raise HTTPException(
            status_code=400,
            detail="Maximum 5 regenerations per deck"
        )

    # Load the original deck
    original_deck = get_deck(request.deck_id)
    if not original_deck:
        raise HTTPException(status_code=404, detail="Original deck not found")
    if original_deck.get("format", "commander") != "commander":
        raise HTTPException(status_code=400, detail="Only Commander decks can be regenerated right now")

    # Check regeneration chain
    parent_id = original_deck.get('parent_deck_id') or request.deck_id

    generator = get_generator()

    # Get core staples for validation
    core_staples = get_core_staples_for_colors(original_deck['colors'])

    # Validate kept cards don't include core staples
    invalid_kept = [c for c in request.kept_card_names if c in core_staples]
    if invalid_kept:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot lock core staples (they're always kept): {invalid_kept}"
        )

    # Validate kept cards don't include commander
    if original_deck['commander'] in request.kept_card_names:
        raise HTTPException(
            status_code=400,
            detail="Cannot lock commander (it's always kept)"
        )

    # Calculate rejected cards (cards in original deck that user didn't lock)
    # These should not appear in the regenerated deck
    original_card_names = {
        line.replace(" *CMDR*", "").split("x ", 1)[-1].strip()
        for line in original_deck.get("list", [])
        if line and line != "Sideboard"
    }
    kept_set = set(request.kept_card_names)
    rejected_cards = list(
        original_card_names
        - kept_set
        - core_staples
        - {original_deck['commander']}
    )

    result = generator.regenerate_deck(
        commander_name=original_deck['commander'],
        kept_cards=request.kept_card_names,
        bracket=original_deck['bracket'],
        theme=original_deck.get('theme', ''),
        budget_tier=None,
        excluded_cards=rejected_cards,
    )

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    new_deck_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now().isoformat()

    deck_response = RegenerateDeckResponse(
        id=new_deck_id,
        commander=result["commander"],
        colors=result["colors"],
        archetype=result["archetype"],
        timestamp=timestamp,
        legal_status=result["legal_status"],
        card_count=result["card_count"],
        estimated_price=result["estimated_price"],
        list=result["list"],
        bracket=result["bracket"],
        bracket_name=result["bracket_name"],
        theme=result["theme"],
        categories=result["categories"],
        regenerations_remaining=5 - request.regeneration_number,
        new_card_names=result.get("new_cards", []),
        core_staples=result.get("core_staples", []),
        parent_deck_id=parent_id,
        regeneration_number=request.regeneration_number,
    )

    # Save to database
    save_deck({
        **deck_response.model_dump(),
        'parent_deck_id': parent_id,
        'regeneration_number': request.regeneration_number,
    })
    logger.info(f"Saved regenerated deck {new_deck_id} (regen #{request.regeneration_number})")

    return deck_response


@app.get("/api/commanders", response_model=List[CommanderInfo])
async def list_commanders(
    query: Optional[str] = Query(None, description="Search query for commander name"),
    limit: int = Query(50, le=200, description="Maximum results")
):
    """List available commanders, optionally filtered by search query."""
    generator = get_generator()
    commanders = generator.get_commanders()

    if query:
        query_lower = query.lower()
        commanders = [c for c in commanders if query_lower in c.get('name', '').lower()]

    commanders = commanders[:limit]

    return [
        CommanderInfo(
            name=c.get('name', ''),
            colors=c.get('color_identity', []) or [],
            type_line=c.get('type_line', ''),
            mana_cost=c.get('mana_cost'),
            oracle_text=c.get('oracle_text'),
        )
        for c in commanders
    ]


@app.get("/api/search-cards", response_model=List[SearchResult])
async def search_cards(
    query: str = Query(..., description="Semantic search query"),
    limit: int = Query(20, le=100, description="Maximum results")
):
    """Search for cards using semantic search."""
    generator = get_generator()
    results = generator.search_cards(query, k=limit)

    return [
        SearchResult(
            name=c.get('name', ''),
            type_line=c.get('type_line', ''),
            mana_cost=c.get('mana_cost'),
            oracle_text=c.get('oracle_text'),
            colors=c.get('color_identity', []) or [],
            score=c.get('score', 0.0),
        )
        for c in results
    ]


@app.get("/api/brackets", response_model=List[BracketInfo])
async def list_brackets():
    """List all available power level brackets."""
    return [
        BracketInfo(
            id=bracket_id,
            name=info['name'],
            description=info['description'],
            power_level=info['power_level'],
            expected_turns=info.get('expected_turns'),
        )
        for bracket_id, info in COMMANDER_BRACKETS.items()
    ]


@app.get("/api/budget-tiers")
async def list_budget_tiers():
    """List available budget tiers."""
    return {
        tier: {"min": low, "max": high if high != float('inf') else None}
        for tier, (low, high) in PRICE_TIERS.items()
    }


@app.get("/api/deck/{deck_id}", response_model=DeckResponse)
async def get_deck_by_id(deck_id: str):
    """Fetch a saved deck by its ID."""
    deck = get_deck(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    return DeckResponse(**deck)


@app.get("/api/recent-decks", response_model=List[DeckSummary])
async def list_recent_decks(limit: int = Query(20, le=50)):
    """Get the most recently generated decks (for ticker)."""
    decks = get_recent_decks(limit)
    return [
        DeckSummary(
            id=d['id'],
            commander=d['commander'],
            colors=d['colors'],
            bracket=d['bracket'],
            theme=d['theme'],
            created_at=d['timestamp'],
        )
        for d in decks
    ]


@app.post("/api/decks/batch", response_model=List[DeckResponse])
async def get_decks_batch(request: BatchRequest):
    """Fetch multiple decks by their IDs (for history hydration)."""
    decks = get_decks_by_ids(request.ids)
    return [DeckResponse(**d) for d in decks]


@app.post("/api/cards-batch", response_model=List[CardData])
async def get_cards_batch(request: CardsBatchRequest):
    """Fetch full card data for a list of card names (for game engine)."""
    generator = get_generator()
    results = []
    for name in request.names:
        card = _find_card_by_requested_name(generator, name)
        if card:
            # Parse power/toughness from card data
            power = card.get('power')
            toughness = card.get('toughness')
            # Build card_faces if present
            raw_faces = card.get('card_faces')
            faces = None
            if raw_faces and isinstance(raw_faces, list) and len(raw_faces) > 1:
                faces = [
                    CardFaceData(
                        name=f.get('name') or '',
                        type_line=f.get('type_line') or '',
                        oracle_text=f.get('oracle_text') or '',
                        mana_cost=f.get('mana_cost') or '',
                        colors=f.get('colors') or [],
                        power=str(f['power']) if f.get('power') is not None else None,
                        toughness=str(f['toughness']) if f.get('toughness') is not None else None,
                    )
                    for f in raw_faces
                ]

            results.append(CardData(
                name=card.get('name') or '',
                type_line=card.get('type_line') or '',
                oracle_text=card.get('oracle_text') or '',
                mana_cost=card.get('mana_cost') or '',
                cmc=float(card.get('cmc') or 0),
                colors=card.get('colors') or [],
                color_identity=card.get('color_identity') or [],
                keywords=card.get('keywords') or [],
                power=str(power) if power is not None else None,
                toughness=str(toughness) if toughness is not None else None,
                layout=card.get('layout'),
                card_faces=faces,
            ))
    return results


# Game launcher imports and endpoint
from backend.game_launcher import GameLaunchRequest, GameLaunchResponse, launch_game


@app.post("/api/launch-game", response_model=GameLaunchResponse)
async def launch_game_endpoint(request: GameLaunchRequest):
    """
    Launch a Commander game with the specified deck.

    This endpoint prepares a game session with:
    - The user's generated deck
    - 1-3 AI opponents with appropriate decks
    - Configurable difficulty and AI personalities

    Returns game setup info for the mobile app to initialize.
    """
    # Load the user's deck
    deck = get_deck(request.deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    # Launch the game
    try:
        response = launch_game(
            deck_data=deck,
            opponent_count=request.opponent_count,
            difficulty=request.difficulty,
            ai_personalities=request.ai_personalities,
        )
        return response
    except Exception as e:
        logger.error(f"Failed to launch game: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to launch game: {str(e)}")


# ---------------------------------------------------------------------------
# Per-card engine-support manifest API (licensing deliverable).
#
# Backed by mtg_data/card_support.json, produced by
# engine/scripts/build-support-manifest.cjs using the SAME honesty crediting as
# the parser-coverage audit. Lets bot integrators ask "is card X fully supported
# by the engine, and if not, which clauses aren't?".
# ---------------------------------------------------------------------------

CARD_SUPPORT_MANIFEST_PATH = Path(
    os.getenv(
        "CARD_SUPPORT_MANIFEST_PATH",
        str(Path(__file__).parent.parent / "mtg_data" / "card_support.json"),
    )
)
CARD_SUPPORT_BATCH_LIMIT = 500

# Hard caps applied BEFORE any regex runs over caller-supplied names. Real Magic
# card names are < 120 chars and real decklist lines < ~200 chars, so anything
# longer is never legitimate — capping bounds every normalization regex to a
# tiny input and is the load-bearing defense against ReDoS on these public,
# unauthenticated licensing endpoints.
_MAX_CARD_NAME_LEN = 256
_MAX_DECK_LINE_LEN = 512
_MAX_DECK_QTY = 1000

# Lazy module-level cache: manifest dict, normalized-name -> exact-name index,
# a content version (sha256 of the manifest file) for ETag/cache validation,
# and a memoized "not playable" feed.
_card_support_manifest: Optional[dict] = None
_card_support_name_index: Optional[dict] = None
_card_support_version: Optional[str] = None
_card_support_unsupported_cache: Optional[list] = None


class CardSupportFace(BaseModel):
    """Support status for a single card face."""
    name: str
    kind: str
    supported: bool
    unsupportedText: Optional[str] = None


class CardSupportEntry(BaseModel):
    """Engine-support manifest entry for a single card.

    `supported` = the engine parses/runs every ability. `playable` = the safe
    boolean a bot should gate on (supported AND not a known-manual card such as
    Chaos Orb, which parses but needs physical dexterity)."""
    name: str
    supported: bool
    playable: bool = True
    viaOverride: bool
    faces: List[CardSupportFace]
    knownManual: Optional[str] = None


class CardSupportMeta(BaseModel):
    """Overall manifest statistics."""
    generatedAt: Optional[str] = None
    engineCoveragePercent: Optional[float] = None
    totalCards: int
    supportedCards: int
    playableCards: Optional[int] = None
    source: Optional[str] = None
    # Stable content hash of the manifest. Changes iff the support data changes,
    # so integrators can poll this (or the ETag header) instead of re-syncing.
    version: Optional[str] = None


class CardSupportBatchRequest(BaseModel):
    """Request for batch card-support lookup."""
    names: List[str] = Field(..., description="Card names to look up (max 500).")


class CardSupportBatchSummary(BaseModel):
    requested: int
    supported: int
    playable: int = 0
    unsupported: int
    unknown: int


class CardSupportBatchResponse(BaseModel):
    results: dict
    summary: CardSupportBatchSummary


class DeckPreflightRequest(BaseModel):
    """Pre-flight a whole deck before a bot tries to play it.

    Supply EITHER a raw multi-line `decklist` (Moxfield/Archidekt/MTGO export
    text, with quantities, set codes and section headers — they're parsed and
    deduped) OR an explicit `names` list. If both are given, they're merged."""
    decklist: Optional[str] = Field(
        None, description="Raw decklist text, one card per line."
    )
    names: Optional[List[str]] = Field(
        None, description="Explicit card names (alternative to decklist text)."
    )


class DeckPreflightCard(BaseModel):
    """A single resolved deck entry the bot can't (or can) play."""
    name: str
    quantity: int
    reasons: List[str] = []
    knownManual: Optional[str] = None


class DeckPreflightSummary(BaseModel):
    totalCards: int          # sum of quantities across recognized lines
    uniqueCards: int         # distinct resolved names
    playableCards: int       # distinct names a bot can run end-to-end
    unsupportedCards: int    # distinct names the engine can't fully run
    unknownCards: int        # distinct names absent from the manifest


class DeckPreflightResponse(BaseModel):
    """Conservative, honest verdict: `deckPlayable` is True only when EVERY
    recognized card is playable AND none are unknown to the engine. A bot that
    wants to ignore unknowns can gate on `summary.unsupportedCards == 0`."""
    deckPlayable: bool
    summary: DeckPreflightSummary
    unsupported: List[DeckPreflightCard] = []
    unknown: List[DeckPreflightCard] = []
    engineCoveragePercent: Optional[float] = None
    generatedAt: Optional[str] = None


# Standalone lines in deck exports that are section headers, not cards.
_DECK_SECTION_HEADERS = frozenset({
    "commander", "commanders", "deck", "mainboard", "main", "sideboard",
    "maybeboard", "companion", "tokens", "token", "about", "lands", "land",
    "creatures", "creature", "instants", "instant", "sorceries", "sorcery",
    "artifacts", "artifact", "enchantments", "enchantment", "planeswalkers",
    "planeswalker", "battles", "battle", "other", "spells",
})
DECK_PREFLIGHT_MAX_CHARS = 200_000
DECK_PREFLIGHT_MAX_UNIQUE = 1000

# A deck line's leading quantity: "1 ", "2x ", "3 x [foo] ".
_DECK_QTY_RE = re.compile(r"^\s*(\d+)\s*x?\s+", re.IGNORECASE)
# Trailing "(12)" count Archidekt appends to category headers. Anchored at a
# literal "(" with no leading/trailing "\s*", so it can't backtrack on a long
# whitespace run (the line is already .strip()ped when this runs).
_TRAILING_COUNT_RE = re.compile(r"\(\d{1,9}\)$")
# Leading section prefix on a card line, e.g. MTGO "SB: 1 Card".
_DECK_LINE_PREFIX_RE = re.compile(
    r"^(?:sb|sideboard|cmdr|commander|mb|mainboard)\s*:\s*", re.IGNORECASE
)


def _parse_decklist_lines(decklist: str) -> "list[str]":
    """Parse raw decklist text into an ordered list of candidate card lines.

    Skips blank lines, comments (`//`/`#`), over-long lines, and section /
    Archidekt category headers, and strips MTGO "SB:"-style line prefixes. The
    leading quantity is NOT stripped here: the candidate is kept intact so the
    caller can try an EXACT manifest match first (preserving the honesty bar for
    real cards whose name ends in "(...)" or starts with a number)."""
    out: "list[str]" = []
    for raw_line in decklist.splitlines():
        if len(raw_line) > _MAX_DECK_LINE_LEN:
            continue  # never a real card line; also bounds regex cost
        line = raw_line.strip()
        if not line or line.startswith("//") or line.startswith("#"):
            continue
        line = _DECK_LINE_PREFIX_RE.sub("", line).strip()
        if not line:
            continue
        # Header detection only applies to quantity-less, decoration-free lines,
        # so a real card with a leading quantity ("1 Companion") is never
        # mistaken for a header.
        if not _DECK_QTY_RE.match(line):
            without_count = _TRAILING_COUNT_RE.sub("", line).strip()
            if without_count.lower() in _DECK_SECTION_HEADERS:
                continue
            # "<words> (N)" with no other parens => Archidekt category label.
            if without_count != line and "(" not in without_count:
                continue
        out.append(line)
    return out


def _normalize_card_support_name(raw: Optional[str]) -> str:
    """Lenient name normalization mirroring the frontend's
    normalizeCardNameForPreflight (frontend/src/lib/enginePreflight.ts), so a
    decklist line like "1 Sol Ring (LEA) 1" resolves to "Sol Ring"."""
    name = (raw or "")
    # Hard cap BEFORE any regex: bounds every pattern below to a tiny input so
    # none can blow up on a hostile token. A truncated over-long name simply
    # fails to match the manifest (reported unknown — the safe direction).
    if len(name) > _MAX_CARD_NAME_LEN:
        name = name[:_MAX_CARD_NAME_LEN]
    # Strip a trailing "# comment". Cutting at the literal "#" is linear; the
    # old `\s+#.*$` form was O(n^2) on a long whitespace run with no "#".
    hash_idx = name.find("#")
    if hash_idx != -1:
        name = name[:hash_idx]
    name = re.sub(r"^[*\-]\s*", "", name).strip()
    # Leading quantity: "1 ", "2x ", "3 x [foo] ".
    qty = re.match(r"^\s*\d+\s*x?\s*(?:\[[^\]]+\]\s*)?(.+)$", name, re.IGNORECASE)
    if qty:
        name = qty.group(1).strip()
    # Trailing *foil*-style annotations, all in one linear pass (the old
    # per-group `while` loop was O(groups * len)).
    name = re.sub(r"(?:\s+\*[^*]+\*)+\s*$", "", name).strip()
    # Trailing set bracket "[LEA]" / "[LEA] 123" and parenthetical "(LEA) 1".
    name = re.sub(r"\s+\[[^\]]+\](?:\s+\S+)?$", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\s+\([^)]+\).*$", "", name, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", name).strip()


def _load_card_support_manifest() -> Optional[dict]:
    """Load the support manifest once and cache it. Returns None if missing."""
    global _card_support_manifest, _card_support_name_index
    global _card_support_version, _card_support_unsupported_cache
    if _card_support_manifest is not None:
        return _card_support_manifest
    if not CARD_SUPPORT_MANIFEST_PATH.exists():
        return None
    raw_bytes = CARD_SUPPORT_MANIFEST_PATH.read_bytes()
    data = json.loads(raw_bytes.decode("utf-8"))
    # Pass 1: index every real manifest key under its normalized name.
    index: dict = {}
    for key in data:
        if key == "_meta":
            continue
        norm = _normalize_card_support_name(key).lower()
        if norm and norm not in index:
            index[norm] = key
    # Pass 2: add front-face aliases for "Front // Back" cards (DFC, modal-DFC,
    # split, adventure, aftermath) so a decklist line that names only the front
    # face resolves. Single-face cards already claimed their slot in pass 1 and
    # are never overwritten, so this can't shadow a real standalone card.
    for key in data:
        if key == "_meta" or " // " not in key:
            continue
        front = _normalize_card_support_name(key.split(" // ", 1)[0]).lower()
        if front and front not in index:
            index[front] = key
    _card_support_manifest = data
    _card_support_name_index = index
    _card_support_version = hashlib.sha256(raw_bytes).hexdigest()[:16]
    _card_support_unsupported_cache = None
    return _card_support_manifest


def _lookup_card_support(name: str) -> Optional[CardSupportEntry]:
    """Resolve a (possibly decorated) card name to its manifest entry, or None."""
    manifest = _load_card_support_manifest()
    if manifest is None:
        raise HTTPException(status_code=503, detail="support manifest not built")
    entry = manifest.get(name)
    if entry is None and _card_support_name_index is not None:
        exact = _card_support_name_index.get(_normalize_card_support_name(name).lower())
        if exact is not None:
            entry = manifest.get(exact)
            name = exact
    if entry is None:
        return None
    return CardSupportEntry(name=name, **entry)


def _resolve_deck_line(line: str) -> "tuple[Optional[CardSupportEntry], int, str]":
    """Resolve one candidate decklist line to (entry, quantity, display_name).

    Tries the whole line as an exact card name first — so a real card whose name
    starts with a number ("1996 World Champion") or ends in "(...)" isn't
    mis-parsed — then peels a leading quantity and resolves the remainder. Exact
    manifest keys always beat the lenient normalized index, upholding the
    honesty bar (a distinct unplayable card never collapses onto a playable
    namesake)."""
    manifest = _card_support_manifest
    if manifest is not None and line in manifest:
        return _lookup_card_support(line), 1, line
    qty = 1
    rest = line
    m = _DECK_QTY_RE.match(line)
    if m:
        qty = min(_MAX_DECK_QTY, max(1, int(m.group(1))))
        stripped = line[m.end():].strip()
        if stripped:
            rest = stripped
    entry = _lookup_card_support(rest)
    display = entry.name if entry is not None else (
        _normalize_card_support_name(rest) or rest
    )
    return entry, qty, display


@app.get(
    "/api/card-support",
    response_model=CardSupportMeta,
    tags=["card-support"],
    dependencies=[Depends(require_card_support_access)],
)
async def card_support_meta(request: Request, response: Response):
    """Return overall engine-support statistics (coverage %, counts, version).

    Emits an ETag (the manifest content version); a matching `If-None-Match`
    yields 304 so integrators can cheaply poll for changes rather than re-pull
    the whole manifest."""
    manifest = _load_card_support_manifest()
    if manifest is None:
        raise HTTPException(status_code=503, detail="support manifest not built")
    etag = f'"{_card_support_version}"' if _card_support_version else None
    if etag and request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag})
    if etag:
        response.headers["ETag"] = etag
    meta = dict(manifest.get("_meta", {"totalCards": 0, "supportedCards": 0}))
    meta["version"] = _card_support_version
    return CardSupportMeta(**meta)


@app.post(
    "/api/card-support/batch",
    response_model=CardSupportBatchResponse,
    tags=["card-support"],
    dependencies=[Depends(require_card_support_access)],
)
async def card_support_batch(request: CardSupportBatchRequest):
    """Look up engine support for up to 500 cards at once."""
    if _load_card_support_manifest() is None:
        raise HTTPException(status_code=503, detail="support manifest not built")
    if len(request.names) > CARD_SUPPORT_BATCH_LIMIT:
        raise HTTPException(
            status_code=400,
            detail=f"batch too large: max {CARD_SUPPORT_BATCH_LIMIT} names",
        )

    results: dict = {}
    supported = playable = unsupported = unknown = 0
    for raw_name in request.names:
        entry = _lookup_card_support(raw_name)
        results[raw_name] = entry.model_dump() if entry is not None else None
        if entry is None:
            unknown += 1
            continue
        if entry.supported:
            supported += 1
        else:
            unsupported += 1
        if entry.playable:
            playable += 1

    return CardSupportBatchResponse(
        results=results,
        summary=CardSupportBatchSummary(
            requested=len(request.names),
            supported=supported,
            playable=playable,
            unsupported=unsupported,
            unknown=unknown,
        ),
    )


@app.post(
    "/api/card-support/preflight",
    response_model=DeckPreflightResponse,
    tags=["card-support"],
    dependencies=[Depends(require_card_support_access)],
)
async def card_support_preflight(request: DeckPreflightRequest):
    """Pre-flight an entire deck: can a bot run every card, and if not, which?

    The bot-facing licensing endpoint. Accepts raw decklist text and/or an
    explicit name list, resolves and dedupes to distinct cards, and returns a
    conservative `deckPlayable` verdict plus the exact unplayable cards with
    reasons."""
    manifest = _load_card_support_manifest()
    if manifest is None:
        raise HTTPException(status_code=503, detail="support manifest not built")
    if not request.decklist and not request.names:
        raise HTTPException(
            status_code=400, detail="provide a decklist or a names list"
        )
    if request.decklist and len(request.decklist) > DECK_PREFLIGHT_MAX_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"decklist too large: max {DECK_PREFLIGHT_MAX_CHARS} chars",
        )

    candidates = _parse_decklist_lines(request.decklist or "")
    candidates.extend(n for n in (request.names or []) if n and n.strip())

    # Resolve each candidate, then dedupe by CANONICAL identity — the manifest's
    # own card name for known cards, the normalized lower-case name for unknowns
    # — so case/printing variants of the same card collapse to one distinct
    # entry and quantities sum.
    aggregated: dict = {}
    order: List[str] = []
    for cand in candidates:
        entry, qty, display = _resolve_deck_line(cand)
        key = entry.name if entry is not None else display.lower()
        if not key:
            continue
        if key not in aggregated:
            aggregated[key] = {"qty": 0, "entry": entry, "name": display}
            order.append(key)
            if len(aggregated) > DECK_PREFLIGHT_MAX_UNIQUE:
                raise HTTPException(
                    status_code=400,
                    detail=f"too many distinct cards: max {DECK_PREFLIGHT_MAX_UNIQUE}",
                )
        aggregated[key]["qty"] += qty

    total = playable = 0
    unsupported: List[DeckPreflightCard] = []
    unknown: List[DeckPreflightCard] = []
    for key in order:
        item = aggregated[key]
        qty = item["qty"]
        entry = item["entry"]
        total += qty
        if entry is None:
            unknown.append(DeckPreflightCard(name=item["name"], quantity=qty))
            continue
        if entry.playable:
            playable += 1
            continue
        # Not playable: collect the unsupported clause(s), or the manual reason.
        reasons = [
            face.unsupportedText
            for face in entry.faces
            if not face.supported and face.unsupportedText
        ]
        if not reasons and entry.knownManual:
            reasons = [entry.knownManual]
        unsupported.append(
            DeckPreflightCard(
                name=entry.name,
                quantity=qty,
                reasons=reasons,
                knownManual=entry.knownManual,
            )
        )

    meta = manifest.get("_meta", {})
    return DeckPreflightResponse(
        deckPlayable=not unsupported and not unknown,
        summary=DeckPreflightSummary(
            totalCards=total,
            uniqueCards=len(order),
            playableCards=playable,
            unsupportedCards=len(unsupported),
            unknownCards=len(unknown),
        ),
        unsupported=unsupported,
        unknown=unknown,
        engineCoveragePercent=meta.get("engineCoveragePercent"),
        generatedAt=meta.get("generatedAt"),
    )


class CardSupportListEntry(BaseModel):
    name: str
    supported: bool
    playable: bool
    knownManual: Optional[str] = None
    reasons: List[str] = []


class CardSupportListResponse(BaseModel):
    count: int          # total not-playable cards in the manifest
    returned: int       # cards in this page
    offset: int
    version: Optional[str] = None
    cards: List[CardSupportListEntry]


def _build_unsupported_feed() -> list:
    """Memoized list of every card a bot CANNOT run (not playable), sorted."""
    global _card_support_unsupported_cache
    if _card_support_unsupported_cache is not None:
        return _card_support_unsupported_cache
    manifest = _load_card_support_manifest()
    if manifest is None:
        raise HTTPException(status_code=503, detail="support manifest not built")
    feed: list = []
    for name, e in manifest.items():
        if name == "_meta":
            continue
        playable = bool(
            e.get("playable", e.get("supported") and not e.get("knownManual"))
        )
        if playable:
            continue
        reasons = [
            f.get("unsupportedText")
            for f in e.get("faces", [])
            if not f.get("supported") and f.get("unsupportedText")
        ]
        if not reasons and e.get("knownManual"):
            reasons = [e["knownManual"]]
        feed.append(
            CardSupportListEntry(
                name=name,
                supported=bool(e.get("supported")),
                playable=False,
                knownManual=e.get("knownManual"),
                reasons=reasons,
            )
        )
    feed.sort(key=lambda c: c.name)
    _card_support_unsupported_cache = feed
    return feed


@app.get(
    "/api/card-support/unsupported",
    response_model=CardSupportListResponse,
    tags=["card-support"],
    dependencies=[Depends(require_card_support_access)],
)
async def card_support_unsupported(
    offset: int = Query(0, ge=0),
    limit: int = Query(2000, ge=1, le=10000),
):
    """List every card a bot CANNOT run (unsupported or known-manual) with
    reasons, so integrators can pre-filter a card pool offline in one pass
    instead of paging the whole DB through the batch endpoint. Paginated."""
    feed = _build_unsupported_feed()
    page = feed[offset:offset + limit]
    return CardSupportListResponse(
        count=len(feed),
        returned=len(page),
        offset=offset,
        version=_card_support_version,
        cards=page,
    )


@app.get(
    "/api/card-support/{name:path}",
    response_model=CardSupportEntry,
    tags=["card-support"],
    dependencies=[Depends(require_card_support_access)],
)
async def card_support_lookup(name: str):
    """Return the engine-support manifest entry for a single card."""
    entry = _lookup_card_support(name)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"card not in manifest: {name}")
    return entry


class CardPrinting(BaseModel):
    """A single printing of a card."""
    id: str
    set_code: str
    set_name: str
    image_uri: Optional[str]
    collector_number: str


class CardPrintingsResponse(BaseModel):
    """Response for card printings lookup."""
    name: str
    printings: List[CardPrinting]


# Simple in-memory cache for card printings
_printings_cache: dict = {}


@app.get("/api/card-printings/{card_name:path}", response_model=CardPrintingsResponse)
async def get_card_printings(card_name: str):
    """
    Get all printings of a card from Scryfall.
    Results are cached to avoid hitting Scryfall rate limits.
    """
    import requests
    import time

    # Check cache first
    cache_key = card_name.lower()
    if cache_key in _printings_cache:
        cached = _printings_cache[cache_key]
        # Cache for 1 hour
        if time.time() - cached['timestamp'] < 3600:
            return CardPrintingsResponse(name=card_name, printings=cached['printings'])

    # Query Scryfall for all printings
    try:
        # Use exact name search with unique prints
        url = f"https://api.scryfall.com/cards/search"
        params = {
            "q": f'!"{card_name}"',
            "unique": "prints",
            "order": "released",
        }
        response = requests.get(url, params=params, headers=SCRYFALL_HEADERS, timeout=10)

        if response.status_code == 404:
            # No results found
            return CardPrintingsResponse(name=card_name, printings=[])

        response.raise_for_status()
        data = response.json()

        printings = []
        for card in data.get('data', []):
            # Get the best image URI available
            image_uri = None
            if 'image_uris' in card:
                image_uri = card['image_uris'].get('normal') or card['image_uris'].get('large')
            elif 'card_faces' in card and len(card['card_faces']) > 0:
                # Double-faced card - use front face
                face = card['card_faces'][0]
                if 'image_uris' in face:
                    image_uri = face['image_uris'].get('normal') or face['image_uris'].get('large')

            printings.append(CardPrinting(
                id=card['id'],
                set_code=card['set'],
                set_name=card['set_name'],
                image_uri=image_uri,
                collector_number=card.get('collector_number', ''),
            ))

        # Cache the results
        _printings_cache[cache_key] = {
            'timestamp': time.time(),
            'printings': printings,
        }

        return CardPrintingsResponse(name=card_name, printings=printings)

    except requests.RequestException as e:
        logger.error(f"Scryfall API error for {card_name}: {e}")
        raise HTTPException(status_code=502, detail="Failed to fetch card printings from Scryfall")


@app.get("/api/card-image/{card_name:path}")
async def serve_card_image(
    card_name: str,
    set_code: Optional[str] = Query(None, alias="set"),
    size: str = Query("normal", pattern="^(normal|small)$"),
):
    """
    Serve a card image from the local cache.
    Falls back to returning a Scryfall URL if not cached.
    """
    # Try to get from local cache first
    result = get_card_image(card_name, set_code, size)

    if result:
        image_data, content_type = result
        return Response(
            content=image_data,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=31536000",  # Cache for 1 year
                "X-Image-Source": "local-cache",
            }
        )

    # Not in cache - return redirect info to Scryfall
    # The frontend will handle falling back to Scryfall directly
    from urllib.parse import quote
    encoded_name = quote(card_name)

    if set_code:
        scryfall_url = f"https://api.scryfall.com/cards/named?exact={encoded_name}&set={set_code}&format=image&version={size}"
    else:
        scryfall_url = f"https://api.scryfall.com/cards/named?exact={encoded_name}&format=image&version={size}"

    return {
        "cached": False,
        "scryfall_url": scryfall_url,
    }


@app.get("/api/card-image-check/{card_name:path}")
async def check_card_image_cached(
    card_name: str,
    set_code: Optional[str] = Query(None, alias="set"),
    size: str = Query("normal", pattern="^(normal|small)$"),
):
    """Check if a card image is in the local cache."""
    if set_code:
        is_cached = has_card_image(card_name, set_code, size)
    else:
        # Check if any version exists
        result = get_card_image(card_name, None, size)
        is_cached = result is not None

    return {"cached": is_cached}


@app.get("/api/image-stats")
async def get_image_statistics():
    """Get statistics about the cached card images."""
    stats = get_image_stats()
    return stats


@app.get("/api/card/{card_name:path}/alternatives", response_model=AlternativesResponse)
async def get_card_alternatives(
    card_name: str,
    max_price: Optional[float] = Query(None, description="Maximum price for alternatives"),
    top_k: int = Query(5, le=10, description="Number of alternatives to return"),
    category: Optional[str] = Query(None, description="Filter to category (ramp, removal, etc.)"),
    color_identity: Optional[str] = Query(None, description="Color identity filter (e.g., 'W,U,B')"),
    use_models: bool = Query(True, description="Use GPT2/Qwen models for scoring (slower but better)"),
):
    """
    Find cheaper alternatives to a card using ensemble ranking.

    The ensemble ranking combines:
    - FAISS semantic search (30%) - text/effect similarity
    - GPT2 model score (25%) - MTG-specific quality fit
    - Qwen model score (25%) - Commander context relevance
    - Functional tag match (20%) - category overlap

    Returns alternatives sorted by final score with trade-off explanations.
    """
    finder = get_alternative_finder(use_gpt2=use_models, use_qwen=use_models)

    # Parse color identity
    colors = None
    if color_identity:
        colors = [c.strip().upper() for c in color_identity.split(',')]

    # Get source price for response
    source_price = get_cheapest_price(card_name)

    alternatives = finder.find_alternatives(
        card_name=card_name,
        max_price=max_price,
        top_k=top_k,
        explicit_category=category,
        color_identity=colors,
    )

    return AlternativesResponse(
        source_card=card_name,
        source_price=source_price,
        alternatives=[
            CardAlternativeResponse(
                name=alt.name,
                oracle_text=alt.oracle_text,
                type_line=alt.type_line,
                mana_cost=alt.mana_cost,
                cmc=alt.cmc,
                color_identity=alt.color_identity,
                price_usd=alt.price_usd,
                price_category=alt.price_category,
                functional_tags=alt.functional_tags,
                faiss_score=alt.faiss_score,
                gpt2_score=alt.gpt2_score,
                qwen_score=alt.qwen_score,
                category_score=alt.category_score,
                final_score=alt.final_score,
                price_savings=alt.price_savings,
                tradeoff_explanation=alt.tradeoff_explanation,
                purchase_links=alt.purchase_links,
            )
            for alt in alternatives
        ]
    )


@app.post("/api/deck/optimize", response_model=DeckOptimizeResponse)
async def optimize_deck(request: DeckOptimizeRequest):
    """
    Suggest card swaps to reduce deck cost.

    Analyzes the deck and suggests cheaper alternatives for expensive cards.
    Returns swaps sorted by savings amount.
    """
    finder = get_alternative_finder(use_gpt2=True, use_qwen=True)

    swaps = finder.optimize_deck(
        deck_cards=request.cards,
        target_savings=request.target_savings,
        max_swaps=request.max_swaps,
        color_identity=request.color_identity,
    )

    suggestions = []
    total_savings = 0.0

    for original_card, alternative, savings in swaps:
        original_price = get_cheapest_price(original_card) or 0.0
        total_savings += savings

        suggestions.append(SwapSuggestion(
            original_card=original_card,
            original_price=original_price,
            alternative=CardAlternativeResponse(
                name=alternative.name,
                oracle_text=alternative.oracle_text,
                type_line=alternative.type_line,
                mana_cost=alternative.mana_cost,
                cmc=alternative.cmc,
                color_identity=alternative.color_identity,
                price_usd=alternative.price_usd,
                price_category=alternative.price_category,
                functional_tags=alternative.functional_tags,
                faiss_score=alternative.faiss_score,
                gpt2_score=alternative.gpt2_score,
                qwen_score=alternative.qwen_score,
                category_score=alternative.category_score,
                final_score=alternative.final_score,
                price_savings=alternative.price_savings,
                tradeoff_explanation=alternative.tradeoff_explanation,
                purchase_links=alternative.purchase_links,
            ),
            savings=savings,
        ))

    return DeckOptimizeResponse(
        total_savings=total_savings,
        swap_count=len(suggestions),
        suggestions=suggestions,
    )


@app.get("/api/card/{card_name:path}/prices", response_model=CardPriceResponse)
async def get_card_price_info(card_name: str):
    """
    Get price information for a card from multiple vendors.

    Returns prices from TCGPlayer, CardKingdom, and Cardmarket with purchase links.
    """
    prices = get_card_prices(card_name)
    cheapest = get_cheapest_price(card_name)
    category = get_price_category(cheapest)

    return CardPriceResponse(
        name=card_name,
        cheapest_usd=cheapest,
        price_category=category,
        vendors=prices,
    )


@app.get("/api/update/status")
async def get_update_status():
    """Get the status of the last data update."""
    import json
    from pathlib import Path
    from data.data_pipeline import MTGDataPipeline

    stats_path = Path('data/last_update_stats.json')
    pipeline_status = MTGDataPipeline().status()
    if not stats_path.exists():
        return {
            "status": "never_run",
            "message": "No update has been run yet",
            "pipeline": pipeline_status,
        }

    try:
        with open(stats_path, 'r') as f:
            stats = json.load(f)
        return {
            "status": "completed",
            "last_update": stats,
            "pipeline": pipeline_status,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }


@app.post("/api/update/trigger")
async def trigger_update(
    request: Request,
    cards: bool = Query(False, description="Update cards and embeddings"),
    prices: bool = Query(False, description="Update prices"),
    images: bool = Query(False, description="Download new images"),
):
    """
    Manually trigger a data update.

    Note: This runs synchronously and may take several minutes.
    For production, consider using a background task queue.
    """
    _require_admin(request)

    from backend.daily_update import DailyUpdater

    updater = DailyUpdater(dry_run=False)

    if cards:
        new_cards = updater.update_cards()
        if new_cards > 0 or updater.stats.get('cards_changed'):
            updater.update_embeddings()
        reload_generator()
        return {"status": "completed", "new_cards": new_cards, "cards_changed": updater.stats.get('cards_changed', False)}
    elif prices:
        updated = updater.update_prices()
        reload_generator()
        return {"status": "completed", "updated_prices": updated}
    elif images:
        downloaded = updater.update_images(limit=100)
        return {"status": "completed", "new_images": downloaded}
    else:
        # Full update
        stats = updater.run_full_update()
        reload_generator()
        return {"status": "completed", "stats": stats}


class ParseDeckURLRequest(BaseModel):
    """Request model for deck URL parsing."""
    url: str = Field(
        ...,
        min_length=1,
        max_length=2048,
        description="URL from Moxfield, Archidekt, TappedOut, or MTGGoldfish",
    )


class ParseDeckURLResponse(BaseModel):
    """Response model for parsed deck URL."""
    commander: Optional[str]
    cards: List[str]
    site: str
    error: Optional[str] = None


@app.post("/api/parse-deck-url", response_model=ParseDeckURLResponse)
async def parse_deck_url(req: ParseDeckURLRequest):
    """
    Parse a deck URL from a supported MTG deck-building site.

    Supported sites: Moxfield, Archidekt, TappedOut, MTGGoldfish.
    Returns the commander (if detected), card list, and source site.
    """
    try:
        result = fetch_deck_from_url(req.url)
        site = detect_site(req.url)
        return ParseDeckURLResponse(
            commander=result.get("commander"),
            cards=result.get("cards", []),
            site=site or "unknown",
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to fetch deck from URL: {e}")
        raise HTTPException(status_code=502, detail=f"Failed to fetch deck: {str(e)}")


# ---------------------------------------------------------------------------
# Draft tournament endpoints
# ---------------------------------------------------------------------------

@app.get("/api/draft/sets", response_model=List[DraftSetSummary])
async def draft_sets():
    """Return local set codes suitable for draft tournament simulation."""
    return get_draft_set_summaries()


@app.post("/api/draft/cards")
async def draft_cards(req: DraftCardsRequest):
    """Return draftable cards from the requested local set code(s)."""
    cards = get_cards_for_draft_sets(req.set_codes)
    if not cards:
        raise HTTPException(status_code=404, detail="No draftable cards found for those set codes")
    return {"cards": cards}


# ---------------------------------------------------------------------------
# Shelector API proxy (forward to agent service on port 8100)
# ---------------------------------------------------------------------------
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse


@app.api_route("/shelector-api/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def proxy_shelector(path: str, request: Request):
    """Forward requests to the Shelector agent service."""
    import httpx
    async with httpx.AsyncClient() as client:
        target_url = f"{SHELECTOR_API_URL}/{path}"
        body = await request.body()
        resp = await client.request(
            method=request.method,
            url=target_url,
            headers={k: v for k, v in request.headers.items() if k.lower() not in ("host", "content-length")},
            content=body,
            params=request.query_params,
            timeout=30.0,
        )
        return StarletteResponse(
            content=resp.content,
            status_code=resp.status_code,
            headers=dict(resp.headers),
        )


# ---------------------------------------------------------------------------
# Static file serving & SPA fallback (MUST be last)
# ---------------------------------------------------------------------------
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

# Serve frontend production build
FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"
AUTO_ADS_UNSAFE_SPA_PREFIXES = (
    "play",
    "multiplayer",
    "shelector",
    "optimizer",
    "deck",
    "generate",
)
ADSENSE_LOADER_RE = re.compile(
    r"\s*<script\b[^>]*pagead2\.googlesyndication\.com/pagead/js/adsbygoogle\.js\?client=[^\"']+[^>]*>\s*</script>",
    re.IGNORECASE,
)


def _allows_auto_ads(full_path: str) -> bool:
    normalized = full_path.strip("/")
    if not normalized:
        return True
    return not any(
        normalized == prefix or normalized.startswith(f"{prefix}/")
        for prefix in AUTO_ADS_UNSAFE_SPA_PREFIXES
    )


def _spa_index_response(full_path: str):
    index_path = FRONTEND_DIST / "index.html"
    if _allows_auto_ads(full_path):
        return FileResponse(str(index_path))

    html = index_path.read_text(encoding="utf-8")
    html = ADSENSE_LOADER_RE.sub("", html)
    return HTMLResponse(html)

if FRONTEND_DIST.exists():
    # Serve static assets
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")

    @app.get("/manifest.json")
    async def manifest():
        return FileResponse(str(FRONTEND_DIST / "manifest.json"))

    @app.get("/manifest.webmanifest")
    async def manifest_webmanifest():
        return FileResponse(str(FRONTEND_DIST / "manifest.webmanifest"))

    @app.get("/sw.js")
    async def service_worker():
        return FileResponse(str(FRONTEND_DIST / "sw.js"), media_type="application/javascript")

    @app.get("/registerSW.js")
    async def register_sw():
        path = FRONTEND_DIST / "registerSW.js"
        if path.exists():
            return FileResponse(str(path), media_type="application/javascript")
        raise HTTPException(status_code=404)

    # SPA fallback: any unmatched route serves index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("shelector-api/"):
            raise HTTPException(status_code=404)
        file_path = FRONTEND_DIST / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        return _spa_index_response(full_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
# reload trigger
