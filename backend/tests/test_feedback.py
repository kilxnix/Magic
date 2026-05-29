from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import feedback


def make_client(monkeypatch, tmp_path):
    monkeypatch.setattr(feedback, "FEEDBACK_STORE_PATH", tmp_path / "feedback.jsonl")
    app = FastAPI()
    app.include_router(feedback.router)
    return TestClient(app)


def test_feedback_is_saved(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)

    response = client.post(
        "/api/feedback",
        json={
            "category": "bug",
            "message": "The room handoff felt delayed after combat.",
            "email": "tester@example.com",
            "page": "/multiplayer/abc123",
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert "room handoff" in feedback.FEEDBACK_STORE_PATH.read_text(encoding="utf-8")


def test_feedback_rejects_links(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)

    response = client.post(
        "/api/feedback",
        json={
            "category": "other",
            "message": "Please look at https://bad.example for details",
        },
    )

    assert response.status_code == 400
