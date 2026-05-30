from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import admin, multiplayer


def make_client(monkeypatch, tmp_path):
    monkeypatch.setattr(admin, "ADMIN_TOKEN", "test-admin-token")
    monkeypatch.setattr(admin, "ADMIN_AUDIT_STORE_PATH", tmp_path / "admin_audit.jsonl")
    monkeypatch.setattr(multiplayer, "_save_rooms_locked", lambda: None)
    monkeypatch.setattr(multiplayer, "_save_events_locked", lambda: None)
    multiplayer._rooms.clear()
    multiplayer._events.clear()
    app = FastAPI()
    app.include_router(multiplayer.router)
    app.include_router(admin.router)
    return TestClient(app)


def auth_headers():
    return {"x-admin-token": "test-admin-token"}


def create_room(client: TestClient):
    created = client.post(
        "/api/multiplayer/rooms",
        json={"name": "Admin Test Room", "host_name": "Host", "is_private": True},
    )
    assert created.status_code == 200
    return created.json()


def test_admin_overview_requires_token(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)
    assert client.get("/api/admin/overview").status_code == 401
    assert client.get("/api/admin/overview", headers=auth_headers()).status_code == 200


def test_admin_can_close_and_delete_room(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)
    room_id = create_room(client)["room"]["id"]

    closed = client.post(
        f"/api/admin/rooms/{room_id}/close",
        headers=auth_headers(),
        json={"reason": "qa cleanup"},
    )
    assert closed.status_code == 200
    assert closed.json()["room"]["status"] == "closed"
    assert multiplayer._rooms[room_id]["chat"][-1]["message"].startswith("Admin closed the room.")

    deleted = client.request(
        "DELETE",
        f"/api/admin/rooms/{room_id}",
        headers=auth_headers(),
        json={"reason": "done"},
    )
    assert deleted.status_code == 200
    assert room_id not in multiplayer._rooms


def test_admin_can_kick_seat_and_remove_chat(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)
    payload = create_room(client)
    room_id = payload["room"]["id"]
    joined = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"})
    assert joined.status_code == 200
    guest_id = joined.json()["player_id"]
    client.post(f"/api/multiplayer/rooms/{room_id}/chat", json={"player_id": guest_id, "message": "hello table"})
    message_id = multiplayer._rooms[room_id]["chat"][-1]["id"]

    removed = client.request(
        "DELETE",
        f"/api/admin/rooms/{room_id}/chat/{message_id}",
        headers=auth_headers(),
        json={"reason": "moderation"},
    )
    assert removed.status_code == 200
    assert all(message["id"] != message_id for message in multiplayer._rooms[room_id]["chat"])

    kicked = client.post(
        f"/api/admin/rooms/{room_id}/seats/2/kick",
        headers=auth_headers(),
        json={"reason": "test"},
    )
    assert kicked.status_code == 200
    assert multiplayer._rooms[room_id]["seats"][1]["player_id"] is None


def test_admin_can_mute_and_unmute_room_player(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)
    payload = create_room(client)
    room_id = payload["room"]["id"]
    joined = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"})
    assert joined.status_code == 200
    guest_id = joined.json()["player_id"]

    muted = client.post(
        f"/api/admin/rooms/{room_id}/seats/2/mute",
        headers=auth_headers(),
        json={"reason": "spam"},
    )
    assert muted.status_code == 200
    assert muted.json()["room"]["seats"][1]["muted"] is True

    rejected = client.post(
        f"/api/multiplayer/rooms/{room_id}/chat",
        json={"player_id": guest_id, "message": "normal mtg table chat"},
    )
    assert rejected.status_code == 403
    assert rejected.json()["detail"] == "This player is muted in the room"

    unmuted = client.post(
        f"/api/admin/rooms/{room_id}/seats/2/unmute",
        headers=auth_headers(),
        json={"reason": "resolved"},
    )
    assert unmuted.status_code == 200
    assert unmuted.json()["room"]["seats"][1]["muted"] is False

    accepted = client.post(
        f"/api/multiplayer/rooms/{room_id}/chat",
        json={"player_id": guest_id, "message": "ready to play"},
    )
    assert accepted.status_code == 200
    assert accepted.json()["chat"][-1]["message"] == "ready to play"


def test_admin_can_ban_room_player(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)
    payload = create_room(client)
    room_id = payload["room"]["id"]
    joined = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"})
    assert joined.status_code == 200
    guest_id = joined.json()["player_id"]

    banned = client.post(
        f"/api/admin/rooms/{room_id}/seats/2/ban",
        headers=auth_headers(),
        json={"reason": "abuse"},
    )
    assert banned.status_code == 200
    assert banned.json()["room"]["banned_player_count"] == 1
    assert multiplayer._rooms[room_id]["seats"][1]["player_id"] is None

    rejected_chat = client.post(
        f"/api/multiplayer/rooms/{room_id}/chat",
        json={"player_id": guest_id, "message": "still here"},
    )
    assert rejected_chat.status_code == 403

    rejected_rejoin = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"})
    assert rejected_rejoin.status_code == 403
    assert rejected_rejoin.json()["detail"] == "This player name is banned from the room"


def test_admin_can_announce_to_room(monkeypatch, tmp_path):
    client = make_client(monkeypatch, tmp_path)
    room_id = create_room(client)["room"]["id"]
    announced = client.post(
        f"/api/admin/rooms/{room_id}/announce",
        headers=auth_headers(),
        json={"message": "Admin notice"},
    )
    assert announced.status_code == 200
    assert multiplayer._rooms[room_id]["chat"][-1]["player_name"] == "Admin"
    assert multiplayer._rooms[room_id]["chat"][-1]["message"] == "Admin notice"
