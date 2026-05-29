import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import ops


def make_client(monkeypatch, tmp_path):
    monkeypatch.setattr(ops, "CLIENT_EVENT_STORE_PATH", tmp_path / "client_events.jsonl")
    app = FastAPI()
    app.include_router(ops.router)
    return TestClient(app)


def test_client_event_is_sanitized_and_saved(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)

    response = client.post(
        "/api/ops/client-events",
        json={
            "kind": "frontend_error",
            "severity": "error",
            "message": "Crashed with token=abc123 on the table",
            "page": "/multiplayer/abc?player_id=secret-token",
            "request_id": "req-123",
            "component_stack": "ErrorBoundary > MultiplayerPage",
            "details": {"room": "abc", "password": "hidden"},
        },
    )

    assert response.status_code == 200
    record = json.loads(ops.CLIENT_EVENT_STORE_PATH.read_text(encoding="utf-8"))
    assert record["message"] == "Crashed with token=[redacted] on the table"
    assert record["page"] == "/multiplayer/abc"
    assert record["request_id"] == "req-123"
    assert record["details"]["password"] == "[redacted]"


def test_ops_status_reports_runtime_writable(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)

    response = client.get("/api/ops/status")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["runtime_writable"] is True
