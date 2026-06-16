"""Tests for the per-card engine-support manifest API.

Hermetic: a tiny fixture manifest is written to a temp file and the loader is
pointed at it, so these tests never depend on the full ~30k card_support.json.
"""

import json
from pathlib import Path

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from starlette.datastructures import Headers

from backend import main


class _FakeRequest:
    """Minimal stand-in exposing the .headers / .client / .state a handler reads."""

    def __init__(self, headers=None, client_host=None):
        self.headers = Headers(headers or {})
        self.client = type("C", (), {"host": client_host})() if client_host else None
        self.state = __import__("types").SimpleNamespace()


# A minimal manifest covering every case the endpoints must handle:
#   - a fully supported card
#   - an unsupported card (a face the engine can't run)
#   - a known-manual card (knownManual set)
FIXTURE_MANIFEST = {
    "_meta": {
        "generatedAt": "2026-06-14T00:00:00Z",
        "engineCoveragePercent": 82.06,
        "totalCards": 3,
        "supportedCards": 2,
        "source": "mtg_data/cards_min.jsonl",
    },
    "Sol Ring": {
        "supported": True,
        "playable": True,
        "viaOverride": False,
        "faces": [{"name": "Sol Ring", "kind": "Activated", "supported": True}],
        "knownManual": None,
    },
    "Shahrazad": {
        "supported": False,
        "playable": False,
        "viaOverride": False,
        "faces": [
            {
                "name": "Shahrazad",
                "kind": "Unparsed",
                "supported": False,
                "unsupportedText": "Players play a Magic subgame...",
            }
        ],
        "knownManual": "Manual dexterity / subgame not automated",
    },
    "Chaos Orb": {
        "supported": True,
        "playable": False,
        "viaOverride": False,
        "faces": [{"name": "Chaos Orb", "kind": "Activated", "supported": True}],
        "knownManual": "Manual dexterity / subgame not automated",
    },
    # A double-faced card: a decklist names only the front ("Westvale Abbey").
    "Westvale Abbey // Ormendahl, Profane Prince": {
        "supported": True,
        "playable": True,
        "viaOverride": False,
        "faces": [
            {"name": "Westvale Abbey", "kind": "Activated", "supported": True},
            {"name": "Ormendahl, Profane Prince", "kind": "Spell", "supported": True},
        ],
        "knownManual": None,
    },
    # A parenthetical-named unplayable card with a playable plain namesake — the
    # over-lenient-normalization honesty trap.
    "Need for Speed (Not the Odyssey One)": {
        "supported": False,
        "playable": False,
        "viaOverride": False,
        "faces": [
            {
                "name": "Need for Speed (Not the Odyssey One)",
                "kind": "Unparsed",
                "supported": False,
                "unsupportedText": "Play a minigame...",
            }
        ],
        "knownManual": None,
    },
    "Need for Speed": {
        "supported": True,
        "playable": True,
        "viaOverride": False,
        "faces": [{"name": "Need for Speed", "kind": "Spell", "supported": True}],
        "knownManual": None,
    },
    # A real card whose name starts with a number (must not be read as quantity).
    "1996 World Champion": {
        "supported": True,
        "playable": True,
        "viaOverride": False,
        "faces": [{"name": "1996 World Champion", "kind": "Spell", "supported": True}],
        "knownManual": None,
    },
}


@pytest.fixture
def client(monkeypatch, tmp_path):
    """A TestClient backed by the fixture manifest, with the loader cache reset."""
    manifest_path = tmp_path / "card_support.json"
    manifest_path.write_text(json.dumps(FIXTURE_MANIFEST), encoding="utf-8")

    monkeypatch.setattr(main, "CARD_SUPPORT_MANIFEST_PATH", Path(manifest_path))
    # Reset the lazy module-level cache so the loader re-reads our fixture.
    monkeypatch.setattr(main, "_card_support_manifest", None)
    monkeypatch.setattr(main, "_card_support_name_index", None)
    monkeypatch.setattr(main, "_card_support_version", None)
    monkeypatch.setattr(main, "_card_support_unsupported_cache", None)

    app = FastAPI()
    # Register only the card-support routes (avoid startup side effects).
    app.add_api_route("/api/card-support", main.card_support_meta, methods=["GET"])
    app.add_api_route(
        "/api/card-support/batch", main.card_support_batch, methods=["POST"]
    )
    app.add_api_route(
        "/api/card-support/preflight", main.card_support_preflight, methods=["POST"]
    )
    app.add_api_route(
        "/api/card-support/unsupported",
        main.card_support_unsupported,
        methods=["GET"],
    )
    app.add_api_route(
        "/api/card-support/{name:path}", main.card_support_lookup, methods=["GET"]
    )
    return TestClient(app)


# --- Single lookup -----------------------------------------------------------

def test_lookup_supported_card(client):
    resp = client.get("/api/card-support/Sol Ring")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Sol Ring"
    assert body["supported"] is True
    assert body["knownManual"] is None
    assert body["faces"][0]["kind"] == "Activated"


def test_lookup_known_manual_card(client):
    resp = client.get("/api/card-support/Chaos Orb")
    assert resp.status_code == 200
    body = resp.json()
    assert body["knownManual"] == "Manual dexterity / subgame not automated"


def test_lookup_unsupported_card_reports_unsupported_text(client):
    resp = client.get("/api/card-support/Shahrazad")
    assert resp.status_code == 200
    body = resp.json()
    assert body["supported"] is False
    assert body["faces"][0]["unsupportedText"].startswith("Players play")


def test_lookup_404_for_unknown_card(client):
    resp = client.get("/api/card-support/Totally Made Up Card")
    assert resp.status_code == 404


def test_lookup_normalizes_decorated_name(client):
    # Quantity + set-code decoration must resolve to the bare card name.
    resp = client.get("/api/card-support/1 Sol Ring (LEA) 1")
    assert resp.status_code == 200
    assert resp.json()["supported"] is True


# --- Batch -------------------------------------------------------------------

def test_batch_mixed_results_and_summary(client):
    resp = client.post(
        "/api/card-support/batch",
        json={"names": ["Sol Ring", "Shahrazad", "No Such Card"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    results = body["results"]
    assert results["Sol Ring"]["supported"] is True
    assert results["Shahrazad"]["supported"] is False
    assert results["No Such Card"] is None

    summary = body["summary"]
    assert summary["requested"] == 3
    assert summary["supported"] == 1
    assert summary["unsupported"] == 1
    assert summary["unknown"] == 1


def test_batch_rejects_oversized_request(client):
    names = [f"Card {i}" for i in range(main.CARD_SUPPORT_BATCH_LIMIT + 1)]
    resp = client.post("/api/card-support/batch", json={"names": names})
    assert resp.status_code == 400


# --- Meta --------------------------------------------------------------------

def test_meta_endpoint(client):
    resp = client.get("/api/card-support")
    assert resp.status_code == 200
    body = resp.json()
    assert body["totalCards"] == 3
    assert body["supportedCards"] == 2
    assert body["engineCoveragePercent"] == 82.06


# --- Deck pre-flight ---------------------------------------------------------

def test_preflight_clean_deck_is_playable(client):
    resp = client.post(
        "/api/card-support/preflight",
        json={"decklist": "1 Sol Ring\n3 Sol Ring (LEA) 1"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deckPlayable"] is True
    # Same resolved name on two lines: quantities sum, one distinct card.
    assert body["summary"]["totalCards"] == 4
    assert body["summary"]["uniqueCards"] == 1
    assert body["summary"]["playableCards"] == 1
    assert body["unsupported"] == []
    assert body["unknown"] == []


def test_preflight_flags_unsupported_with_reasons(client):
    resp = client.post(
        "/api/card-support/preflight",
        json={"decklist": "1 Sol Ring\n1 Shahrazad"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deckPlayable"] is False
    assert body["summary"]["unsupportedCards"] == 1
    flagged = body["unsupported"][0]
    assert flagged["name"] == "Shahrazad"
    assert flagged["reasons"][0].startswith("Players play")


def test_preflight_known_manual_card_is_unplayable(client):
    # Chaos Orb parses (supported) but isn't playable by a bot (knownManual).
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": "1 Chaos Orb"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deckPlayable"] is False
    flagged = body["unsupported"][0]
    assert flagged["name"] == "Chaos Orb"
    assert flagged["knownManual"] is not None
    # Falls back to the manual reason when there's no unsupported clause text.
    assert flagged["reasons"] == [flagged["knownManual"]]


def test_preflight_unknown_card_breaks_playable(client):
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": "1 Made Up Card"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deckPlayable"] is False
    assert body["summary"]["unknownCards"] == 1
    assert body["unknown"][0]["name"] == "Made Up Card"


def test_preflight_skips_headers_and_comments(client):
    decklist = "Commander\n1 Sol Ring\n\n// a note\nDeck\n1 Sol Ring\nSideboard"
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": decklist}
    )
    assert resp.status_code == 200
    body = resp.json()
    # Only the two Sol Ring lines count; headers/comments are ignored.
    assert body["summary"]["uniqueCards"] == 1
    assert body["summary"]["totalCards"] == 2
    assert body["deckPlayable"] is True


def test_preflight_accepts_names_list(client):
    resp = client.post(
        "/api/card-support/preflight",
        json={"names": ["Sol Ring", "Shahrazad"]},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["uniqueCards"] == 2
    assert body["summary"]["unsupportedCards"] == 1


def test_preflight_requires_input(client):
    resp = client.post("/api/card-support/preflight", json={})
    assert resp.status_code == 400


def test_preflight_rejects_oversized_decklist(client):
    huge = "x" * (main.DECK_PREFLIGHT_MAX_CHARS + 1)
    resp = client.post("/api/card-support/preflight", json={"decklist": huge})
    assert resp.status_code == 400


def test_preflight_surfaces_coverage_metadata(client):
    resp = client.post(
        "/api/card-support/preflight", json={"names": ["Sol Ring"]}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["engineCoveragePercent"] == 82.06
    assert body["generatedAt"] == "2026-06-14T00:00:00Z"


# --- Pre-flight: resolution correctness & honesty ----------------------------

def test_preflight_resolves_dfc_front_face(client):
    # A decklist names only the front face of a double-faced card.
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": "1 Westvale Abbey"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deckPlayable"] is True
    assert body["summary"]["uniqueCards"] == 1
    assert body["summary"]["playableCards"] == 1


def test_preflight_resolves_full_dfc_name(client):
    resp = client.post(
        "/api/card-support/preflight",
        json={"names": ["Westvale Abbey // Ormendahl, Profane Prince"]},
    )
    assert resp.status_code == 200
    assert resp.json()["summary"]["playableCards"] == 1


def test_preflight_honesty_parenthetical_card_not_collapsed(client):
    # The unplayable "(...)" card must NOT resolve to its playable namesake.
    resp = client.post(
        "/api/card-support/preflight",
        json={"decklist": "1 Need for Speed (Not the Odyssey One)"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["deckPlayable"] is False
    assert body["summary"]["unsupportedCards"] == 1
    assert body["unsupported"][0]["name"] == "Need for Speed (Not the Odyssey One)"


def test_preflight_plain_namesake_still_playable(client):
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": "1 Need for Speed"}
    )
    assert resp.status_code == 200
    assert resp.json()["deckPlayable"] is True


def test_preflight_digit_prefixed_name_not_treated_as_quantity(client):
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": "1996 World Champion"}
    )
    assert resp.status_code == 200
    body = resp.json()
    # One copy of one card — the "1996" is part of the name, not a quantity.
    assert body["summary"]["totalCards"] == 1
    assert body["summary"]["uniqueCards"] == 1
    assert body["deckPlayable"] is True


def test_preflight_case_variants_dedupe(client):
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": "1 Sol Ring\n1 sol ring"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["uniqueCards"] == 1
    assert body["summary"]["totalCards"] == 2


def test_preflight_strips_mtgo_sideboard_prefix(client):
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": "SB: 1 Sol Ring"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["playableCards"] == 1
    assert body["deckPlayable"] is True


def test_preflight_skips_archidekt_category_headers(client):
    resp = client.post(
        "/api/card-support/preflight",
        json={"decklist": "Ramp (10)\n1 Sol Ring\nRemoval (8)"},
    )
    assert resp.status_code == 200
    body = resp.json()
    # Category labels are not cards; only Sol Ring counts.
    assert body["summary"]["uniqueCards"] == 1
    assert body["unknown"] == []


def test_preflight_oversized_whitespace_line_does_not_hang(client):
    # A 200k-char all-whitespace single line: the old normalizer was O(n^2) and
    # would freeze the worker ~48s. With the length cap it returns immediately.
    huge_line = " " * (main.DECK_PREFLIGHT_MAX_CHARS - 10)
    resp = client.post(
        "/api/card-support/preflight", json={"decklist": huge_line}
    )
    assert resp.status_code == 200
    # The single over-long line is skipped, so nothing resolves.
    assert resp.json()["summary"]["uniqueCards"] == 0


def test_preflight_huge_single_name_is_capped_not_hung(client):
    resp = client.post(
        "/api/card-support/preflight", json={"names": ["x" * 100_000]}
    )
    assert resp.status_code == 200
    # Capped, normalized, and reported unknown — never a hang.
    assert resp.json()["summary"]["unknownCards"] == 1


# --- Version / ETag ----------------------------------------------------------

def test_meta_exposes_version(client):
    resp = client.get("/api/card-support")
    assert resp.status_code == 200
    version = resp.json()["version"]
    assert version and len(version) == 16
    assert resp.headers.get("etag") == f'"{version}"'


def test_meta_if_none_match_returns_304(client):
    first = client.get("/api/card-support")
    etag = first.headers["etag"]
    second = client.get("/api/card-support", headers={"If-None-Match": etag})
    assert second.status_code == 304


# --- Unsupported feed --------------------------------------------------------

def test_unsupported_feed_lists_only_unplayable_cards(client):
    resp = client.get("/api/card-support/unsupported")
    assert resp.status_code == 200
    body = resp.json()
    names = {c["name"] for c in body["cards"]}
    # Not playable: Shahrazad, Chaos Orb, and the "(...)" minigame card.
    assert "Shahrazad" in names
    assert "Chaos Orb" in names
    assert "Need for Speed (Not the Odyssey One)" in names
    # Playable cards must never appear.
    assert "Sol Ring" not in names
    assert "Need for Speed" not in names
    assert body["count"] == len(body["cards"])
    assert all(c["playable"] is False for c in body["cards"])
    assert all(c["reasons"] for c in body["cards"])


def test_unsupported_feed_pagination(client):
    resp = client.get("/api/card-support/unsupported?offset=0&limit=1")
    assert resp.status_code == 200
    body = resp.json()
    assert body["returned"] == 1
    assert body["count"] >= 3
    assert body["version"]


# --- Missing manifest --------------------------------------------------------

def test_missing_manifest_returns_503(monkeypatch, tmp_path):
    monkeypatch.setattr(
        main, "CARD_SUPPORT_MANIFEST_PATH", Path(tmp_path / "does_not_exist.json")
    )
    monkeypatch.setattr(main, "_card_support_manifest", None)
    monkeypatch.setattr(main, "_card_support_name_index", None)

    app = FastAPI()
    app.add_api_route("/api/card-support", main.card_support_meta, methods=["GET"])
    test_client = TestClient(app)
    resp = test_client.get("/api/card-support")
    assert resp.status_code == 503
    assert "not built" in resp.json()["detail"]


# --- API-key auth ------------------------------------------------------------

# Two keys that share a long common prefix. The old label scheme (key[:6]) would
# have merged them into ONE rate-limit bucket; the hash-based id must keep them
# distinct so one licensee can't drain another's quota.
_KEY_A = "csk_live_aaaaaaaaaaaaaaaa"
_KEY_B = "csk_live_bbbbbbbbbbbbbbbb"


@pytest.fixture
def with_keys(monkeypatch):
    monkeypatch.setattr(
        main, "CARD_SUPPORT_API_KEYS", main._parse_api_keys(f"{_KEY_A}:acme,{_KEY_B}")
    )
    return None


def test_key_id_none_when_no_keys_configured(monkeypatch):
    monkeypatch.setattr(main, "CARD_SUPPORT_API_KEYS", {})
    assert main._card_support_key_id(_FakeRequest({"x-api-key": "anything"})) is None


def test_key_id_via_x_api_key_header(with_keys):
    kid = main._card_support_key_id(_FakeRequest({"x-api-key": _KEY_A}))
    assert kid and len(kid) == 16


def test_key_id_via_bearer_token(with_keys):
    kid = main._card_support_key_id(_FakeRequest({"authorization": f"Bearer {_KEY_B}"}))
    assert kid and len(kid) == 16


def test_key_id_rejects_wrong_key(with_keys):
    assert main._card_support_key_id(_FakeRequest({"x-api-key": "not-a-real-key"})) is None


def test_key_id_none_when_header_absent(with_keys):
    assert main._card_support_key_id(_FakeRequest({})) is None


def test_prefix_sharing_keys_get_distinct_ids(with_keys):
    # The collision fix: two keys sharing a prefix must NOT share an identity.
    a = main._card_support_key_id(_FakeRequest({"x-api-key": _KEY_A}))
    b = main._card_support_key_id(_FakeRequest({"x-api-key": _KEY_B}))
    assert a and b and a != b


def test_non_ascii_key_header_denies_cleanly(with_keys):
    # A non-ASCII header byte must NOT raise (old str compare_digest TypeError ->
    # 500); it simply fails to match.
    assert main._card_support_key_id(_FakeRequest({"x-api-key": "ééé"})) is None


def test_require_access_passes_when_auth_not_required(monkeypatch, with_keys):
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", False)
    # No key, but auth isn't required -> returns None, no raise.
    assert main.require_card_support_access(_FakeRequest({})) is None


def test_require_access_401_when_auth_required_and_no_key(monkeypatch, with_keys):
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", True)
    with pytest.raises(HTTPException) as exc:
        main.require_card_support_access(_FakeRequest({}))
    assert exc.value.status_code == 401


def test_require_access_401_on_invalid_key(monkeypatch, with_keys):
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", True)
    with pytest.raises(HTTPException) as exc:
        main.require_card_support_access(_FakeRequest({"x-api-key": "wrong"}))
    assert exc.value.status_code == 401


def test_require_access_returns_id_on_valid_key(monkeypatch, with_keys):
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", True)
    kid = main.require_card_support_access(_FakeRequest({"x-api-key": _KEY_A}))
    assert kid and len(kid) == 16


# --- End-to-end: auth dependency + rate-limit middleware on a real route ------

def _auth_app(manifest_path):
    """A FastAPI app wiring the real card-support route WITH its auth dependency
    and the production rate-limit middleware."""
    app = FastAPI()
    app.middleware("http")(main.production_guardrails)
    app.add_api_route(
        "/api/card-support/{name:path}",
        main.card_support_lookup,
        methods=["GET"],
        dependencies=[Depends(main.require_card_support_access)],
    )
    return app


@pytest.fixture
def auth_env(monkeypatch, tmp_path):
    manifest_path = tmp_path / "card_support.json"
    manifest_path.write_text(json.dumps(FIXTURE_MANIFEST), encoding="utf-8")
    monkeypatch.setattr(main, "CARD_SUPPORT_MANIFEST_PATH", Path(manifest_path))
    monkeypatch.setattr(main, "_card_support_manifest", None)
    monkeypatch.setattr(main, "_card_support_name_index", None)
    monkeypatch.setattr(main, "_card_support_version", None)
    monkeypatch.setattr(main, "_card_support_unsupported_cache", None)
    monkeypatch.setattr(main, "CARD_SUPPORT_API_KEYS", main._parse_api_keys(f"{_KEY_A}:acme"))
    monkeypatch.setattr(main, "RATE_LIMIT_ENABLED", True)
    main._rate_limit_buckets.clear()
    return manifest_path


def test_route_401_without_key_when_required(monkeypatch, auth_env):
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", True)
    resp = TestClient(_auth_app(auth_env)).get("/api/card-support/Sol Ring")
    assert resp.status_code == 401
    assert resp.headers.get("www-authenticate") == "Bearer"


def test_route_200_with_valid_key(monkeypatch, auth_env):
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", True)
    resp = TestClient(_auth_app(auth_env)).get(
        "/api/card-support/Sol Ring", headers={"X-API-Key": _KEY_A}
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Sol Ring"


def test_route_public_when_auth_not_required(monkeypatch, auth_env):
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", False)
    resp = TestClient(_auth_app(auth_env)).get("/api/card-support/Sol Ring")
    assert resp.status_code == 200


def test_middleware_anon_bucket_throttles(monkeypatch, auth_env):
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", False)
    monkeypatch.setattr(main, "CARD_SUPPORT_ANON_RATE_LIMIT", 2)
    client = TestClient(_auth_app(auth_env))
    assert client.get("/api/card-support/Sol Ring").status_code == 200
    assert client.get("/api/card-support/Sol Ring").status_code == 200
    # Third anonymous request in the window exceeds the anon limit.
    assert client.get("/api/card-support/Sol Ring").status_code == 429


def test_middleware_keyed_bucket_is_separate(monkeypatch, auth_env):
    # Anon bucket limit 1, keyed limit high: a keyed caller is metered on its own
    # bucket and isn't throttled by the anon bucket being full.
    monkeypatch.setattr(main, "CARD_SUPPORT_REQUIRE_AUTH", False)
    monkeypatch.setattr(main, "CARD_SUPPORT_ANON_RATE_LIMIT", 1)
    monkeypatch.setattr(main, "CARD_SUPPORT_RATE_LIMIT", 100)
    client = TestClient(_auth_app(auth_env))
    headers = {"X-API-Key": _KEY_A}
    for _ in range(5):
        assert client.get("/api/card-support/Sol Ring", headers=headers).status_code == 200


# --- Client IP hardening (X-Forwarded-For spoof resistance) -------------------

def test_client_ip_uses_rightmost_xff_hop(monkeypatch):
    monkeypatch.setattr(main, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(main, "TRUSTED_PROXY_HOPS", 1)
    # Attacker prepends a spoofed entry; the proxy appends the real client.
    req = _FakeRequest({"x-forwarded-for": "1.1.1.1, 203.0.113.7"}, client_host="10.0.0.1")
    assert main._client_ip(req) == "203.0.113.7"


def test_client_ip_honors_multiple_trusted_hops(monkeypatch):
    monkeypatch.setattr(main, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(main, "TRUSTED_PROXY_HOPS", 2)
    req = _FakeRequest(
        {"x-forwarded-for": "spoofed, 203.0.113.7, 172.16.0.1"}, client_host="10.0.0.1"
    )
    # Two trusted hops from the right -> the genuine client (203.0.113.7).
    assert main._client_ip(req) == "203.0.113.7"


def test_client_ip_single_value(monkeypatch):
    monkeypatch.setattr(main, "TRUST_PROXY_HEADERS", True)
    monkeypatch.setattr(main, "TRUSTED_PROXY_HOPS", 1)
    req = _FakeRequest({"x-forwarded-for": "203.0.113.7"}, client_host="10.0.0.1")
    assert main._client_ip(req) == "203.0.113.7"


def test_client_ip_falls_back_to_socket_when_no_headers(monkeypatch):
    monkeypatch.setattr(main, "TRUST_PROXY_HEADERS", True)
    req = _FakeRequest({}, client_host="198.51.100.5")
    assert main._client_ip(req) == "198.51.100.5"
