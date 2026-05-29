from starlette.requests import Request

from backend import main


def make_request(path="/api/multiplayer/rooms", headers=None):
    raw_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": raw_headers,
            "client": ("127.0.0.1", 12345),
        }
    )


def test_qa_rate_limit_bypass_requires_admin_token(monkeypatch):
    monkeypatch.setattr(main, "ADMIN_TOKEN", "test-admin-token")
    monkeypatch.setattr(main, "RATE_LIMIT_QA_BYPASS_ENABLED", True)

    no_header = make_request(headers={"x-qa-rate-limit-bypass": "1"})
    assert main._should_bypass_rate_limit(no_header, "/api/multiplayer/rooms") is False

    wrong_header = make_request(
        headers={
            "x-qa-rate-limit-bypass": "1",
            "x-admin-token": "wrong",
        }
    )
    assert main._should_bypass_rate_limit(wrong_header, "/api/multiplayer/rooms") is False

    valid_header = make_request(
        headers={
            "x-qa-rate-limit-bypass": "1",
            "x-admin-token": "test-admin-token",
        }
    )
    assert main._should_bypass_rate_limit(valid_header, "/api/multiplayer/rooms") is True


def test_qa_rate_limit_bypass_includes_multiplayer_verification_routes(monkeypatch):
    monkeypatch.setattr(main, "ADMIN_TOKEN", "test-admin-token")
    monkeypatch.setattr(main, "RATE_LIMIT_QA_BYPASS_ENABLED", True)
    headers = {
        "x-qa-rate-limit-bypass": "1",
        "x-admin-token": "test-admin-token",
    }
    replay_request = make_request(path="/api/multiplayer/replays", headers=headers)
    event_request = make_request(path="/api/multiplayer/events", headers=headers)

    assert main._should_bypass_rate_limit(replay_request, "/api/multiplayer/replays") is True
    assert main._should_bypass_rate_limit(event_request, "/api/multiplayer/events") is True


def test_qa_rate_limit_bypass_is_limited_to_multiplayer_verification_routes(monkeypatch):
    monkeypatch.setattr(main, "ADMIN_TOKEN", "test-admin-token")
    monkeypatch.setattr(main, "RATE_LIMIT_QA_BYPASS_ENABLED", True)
    request = make_request(
        path="/api/generate-deck",
        headers={
            "x-qa-rate-limit-bypass": "1",
            "x-admin-token": "test-admin-token",
        },
    )

    assert main._should_bypass_rate_limit(request, "/api/generate-deck") is False


def test_admin_bearer_token_is_accepted(monkeypatch):
    monkeypatch.setattr(main, "ADMIN_TOKEN", "test-admin-token")
    request = make_request(headers={"authorization": "Bearer test-admin-token"})

    assert main._has_valid_admin_token(request) is True


def test_multiplayer_default_limit_supports_room_smoke_runs():
    _, limit = main._rate_limit_for_path("/api/multiplayer/rooms/test-room/chat")

    assert limit >= 300


def test_client_event_limit_is_bounded():
    bucket, limit = main._rate_limit_for_path("/api/ops/client-events")

    assert bucket == "/api/ops/client-events"
    assert 0 < limit <= 120
