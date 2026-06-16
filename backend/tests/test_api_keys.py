"""Tests for the DB-backed card-support API keys (issuance, quota, revocation)
and their enforcement through the request-path auth dependency."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.datastructures import Headers

from backend import database, main


class _FakeRequest:
    def __init__(self, headers=None):
        self.headers = Headers(headers or {})
        self.client = None
        self.state = SimpleNamespace()


@pytest.fixture
def temp_db(monkeypatch, tmp_path):
    """Point the DB at a temp file, reset the key cache, init the schema."""
    db = tmp_path / "test.db"
    monkeypatch.setattr(database, "DATABASE_PATH", db)
    monkeypatch.setattr(database, "_api_key_cache", {})
    monkeypatch.setattr(database, "_api_key_cache_loaded_at", 0.0)
    database.init_db()
    # No env keys, auth required — so the DB key is the only thing under test.
    monkeypatch.setattr(main, "CARD_SUPPORT_API_KEYS", {})
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", True)
    return db


# --- DB layer ----------------------------------------------------------------

def test_create_returns_secret_and_stores_only_hash(temp_db):
    created = database.create_api_key(label="acme", quota=100)
    assert created["secret"].startswith("csk_")
    assert len(created["keyId"]) == 16
    assert created["quota"] == 100 and created["remaining"] == 100
    with database.get_connection() as conn:
        row = conn.execute(
            "SELECT key_hash FROM api_keys WHERE key_id=?", (created["keyId"],)
        ).fetchone()
    # The raw secret is never stored — only its 64-char sha256 hex.
    assert row["key_hash"] != created["secret"]
    assert len(row["key_hash"]) == 64


def test_resolve_valid_invalid_and_empty(temp_db):
    created = database.create_api_key(label="x", quota=10)
    info = database.resolve_api_key(created["secret"])
    assert info and info["key_id"] == created["keyId"]
    assert database.resolve_api_key("csk_not_a_real_key") is None
    assert database.resolve_api_key("") is None


def test_quota_depletes_and_blocks(temp_db):
    kid = database.create_api_key(label="x", quota=2)["keyId"]
    assert database.consume_api_key_quota(kid) is True
    assert database.consume_api_key_quota(kid) is True
    assert database.consume_api_key_quota(kid) is False  # exhausted
    row = {k["keyId"]: k for k in database.list_api_keys()}[kid]
    assert row["requestsUsed"] == 2 and row["remaining"] == 0


def test_unlimited_quota_never_blocks(temp_db):
    kid = database.create_api_key(label="x", quota=None)["keyId"]
    for _ in range(5):
        assert database.consume_api_key_quota(kid) is True
    row = {k["keyId"]: k for k in database.list_api_keys()}[kid]
    assert row["remaining"] is None


def test_revoke_blocks_resolution_and_consume(temp_db):
    created = database.create_api_key(label="x", quota=10)
    assert database.revoke_api_key(created["keyId"]) is True
    assert database.resolve_api_key(created["secret"]) is None
    assert database.consume_api_key_quota(created["keyId"]) is False


def test_topup_increases_quota_and_reactivates(temp_db):
    created = database.create_api_key(label="x", quota=1)
    kid = created["keyId"]
    database.consume_api_key_quota(kid)
    assert database.consume_api_key_quota(kid) is False
    updated = database.topup_api_key(kid, add_quota=5)
    assert updated["quota"] == 6 and updated["status"] == "active"
    assert database.consume_api_key_quota(kid) is True


def test_topup_unlimited_stays_unlimited(temp_db):
    created = database.create_api_key(label="x", quota=None)
    assert database.topup_api_key(created["keyId"], add_quota=100)["quota"] is None


def test_topup_missing_key_returns_none(temp_db):
    assert database.topup_api_key("does-not-exist", add_quota=5) is None


def test_list_excludes_secret(temp_db):
    database.create_api_key(label="a", quota=10)
    database.create_api_key(label="b", quota=20)
    keys = database.list_api_keys()
    assert {k["label"] for k in keys} == {"a", "b"}
    assert all("secret" not in k for k in keys)


# --- Enforcement through the request-path dependency -------------------------

def test_db_key_authenticates_then_quota_exhausts(temp_db):
    secret = database.create_api_key(label="acme", quota=2)["secret"]
    req = _FakeRequest({"x-api-key": secret})
    assert main.require_card_support_access(req) is not None   # charge 1
    assert main.require_card_support_access(req) is not None   # charge 2
    with pytest.raises(HTTPException) as exc:                  # exhausted
        main.require_card_support_access(req)
    assert exc.value.status_code == 403


def test_db_key_via_bearer_header(temp_db):
    secret = database.create_api_key(label="acme", quota=5)["secret"]
    req = _FakeRequest({"authorization": f"Bearer {secret}"})
    assert main.require_card_support_access(req) is not None


def test_revoked_db_key_is_401(temp_db):
    created = database.create_api_key(label="x", quota=10)
    database.revoke_api_key(created["keyId"])
    with pytest.raises(HTTPException) as exc:
        main.require_card_support_access(_FakeRequest({"x-api-key": created["secret"]}))
    assert exc.value.status_code == 401  # revoked → not a valid key → auth required


def test_middleware_resolution_does_not_charge_quota(temp_db):
    # _resolve_card_support_key (used by the rate-limit middleware) must NOT
    # consume quota — only the dependency does, exactly once per request.
    created = database.create_api_key(label="x", quota=3)
    secret = created["secret"]
    for _ in range(10):
        info = main._resolve_card_support_key(_FakeRequest({"x-api-key": secret}))
        assert info and info["source"] == "db"
    row = {k["keyId"]: k for k in database.list_api_keys()}[created["keyId"]]
    assert row["requestsUsed"] == 0  # resolution alone never charges


def test_revoked_via_stale_cache_is_401_not_403(temp_db):
    # Revoke directly in the DB WITHOUT refreshing the cache (simulates a stale
    # cache on another worker): resolve still cache-hits, the atomic consume
    # fails on status, and the dependency must return 401 (invalid), not 403.
    created = database.create_api_key(label="x", quota=10)
    with database.get_connection() as conn:
        conn.execute("UPDATE api_keys SET status='revoked' WHERE key_id=?", (created["keyId"],))
        conn.commit()
    with pytest.raises(HTTPException) as exc:
        main.require_card_support_access(_FakeRequest({"x-api-key": created["secret"]}))
    assert exc.value.status_code == 401


def test_new_key_validates_without_cache_refresh(temp_db):
    # DB-fallback-on-miss: insert a key directly and clear the cache (simulating
    # a key minted on another worker). resolve must still find it via the DB.
    secret = database.generate_api_key_secret()
    key_hash = database._hash_api_key(secret)
    with database.get_connection() as conn:
        conn.execute(
            "INSERT INTO api_keys (key_id, key_hash, label, quota) VALUES (?,?,?,?)",
            (key_hash[:16], key_hash, "other-worker", 5),
        )
        conn.commit()
    database._api_key_cache.clear()  # this worker never saw the insert
    assert database.resolve_api_key(secret) is not None


# --- Refund on error responses (charge only successful calls) ----------------

_REFUND_MANIFEST = {
    "_meta": {"totalCards": 1, "supportedCards": 1, "playableCards": 1},
    "Sol Ring": {
        "supported": True, "playable": True, "viaOverride": False,
        "faces": [{"name": "Sol Ring", "kind": "Activated", "supported": True}],
        "knownManual": None,
    },
}


def _used(key_id):
    return {k["keyId"]: k for k in database.list_api_keys()}[key_id]["requestsUsed"]


def test_error_responses_refund_quota(temp_db, monkeypatch, tmp_path):
    """A charged request that ends in a 404 must be refunded; a 200 must not."""
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient
    import json

    manifest = tmp_path / "cs.json"
    manifest.write_text(json.dumps(_REFUND_MANIFEST), encoding="utf-8")
    monkeypatch.setattr(main, "CARD_SUPPORT_MANIFEST_PATH", manifest)
    monkeypatch.setattr(main, "_card_support_manifest", None)
    monkeypatch.setattr(main, "_card_support_name_index", None)
    monkeypatch.setattr(main, "_card_support_version", None)
    monkeypatch.setattr(main, "RATE_LIMIT_ENABLED", True)
    main._rate_limit_buckets.clear()

    created = database.create_api_key(label="acme", quota=5)
    headers = {"X-API-Key": created["secret"]}

    app = FastAPI()
    app.middleware("http")(main.production_guardrails)
    app.add_api_route(
        "/api/card-support/{name:path}", main.card_support_lookup,
        methods=["GET"], dependencies=[Depends(main.require_card_support_access)],
    )
    client = TestClient(app)

    # 404 unknown card -> charged then refunded -> usage stays 0.
    assert client.get("/api/card-support/Nonexistent Card", headers=headers).status_code == 404
    assert _used(created["keyId"]) == 0

    # 200 success -> charged and kept.
    assert client.get("/api/card-support/Sol Ring", headers=headers).status_code == 200
    assert _used(created["keyId"]) == 1
