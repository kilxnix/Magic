from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import multiplayer


def make_client(monkeypatch):
    multiplayer._rooms.clear()
    multiplayer._events.clear()
    monkeypatch.setattr(multiplayer, "_save_rooms_locked", lambda: None)
    monkeypatch.setattr(multiplayer, "_save_events_locked", lambda: None)
    app = FastAPI()
    app.include_router(multiplayer.router)
    return TestClient(app)


def register_players(client, event_id, names):
    for name in names:
        response = client.post(
            f"/api/multiplayer/events/{event_id}/players",
            json={"player_name": name, "deck_name": f"{name} Deck"},
        )
        assert response.status_code == 200
    return response.json()


def test_swiss_event_pairs_reports_standings_and_creates_match_room(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/events",
        json={
            "name": "Friday Commander League",
            "organizer_name": "Judge Codex",
            "format": "swiss",
            "public": True,
            "settings": {"rounds": 2, "max_players": 8, "match_wins_required": 2, "round_minutes": 50},
        },
    )
    assert created.status_code == 200
    event_id = created.json()["event"]["id"]
    token = created.json()["organizer_token"]

    registered = register_players(client, event_id, ["Ari", "Bea", "Cy", "Dee"])
    assert registered["player_count"] == 4

    started = client.post(f"/api/multiplayer/events/{event_id}/start", json={"organizer_token": token})
    assert started.status_code == 200
    event = started.json()
    assert event["status"] == "running"
    assert event["current_round"] == 1
    assert len([match for match in event["matches"] if match["round"] == 1]) == 2
    first_match = event["matches"][0]

    room = client.post(
        f"/api/multiplayer/events/{event_id}/matches/{first_match['id']}/room",
        json={"organizer_token": token},
    )
    assert room.status_code == 200
    assert room.json()["room_id"]
    assert room.json()["room"]["settings"]["table_note"].startswith(f"Event {event_id}")

    reported = client.post(
        f"/api/multiplayer/events/{event_id}/matches/{first_match['id']}/result",
        json={
            "organizer_token": token,
            "player1_wins": 2,
            "player2_wins": 1,
            "highlight": "A clean tempo pivot decided game three.",
        },
    )
    assert reported.status_code == 200
    event = reported.json()
    assert event["matches"][0]["status"] == "reported"
    assert event["highlights"][0]["message"].startswith("A clean tempo")

    second_match = event["matches"][1]
    assert client.post(
        f"/api/multiplayer/events/{event_id}/matches/{second_match['id']}/result",
        json={"organizer_token": token, "player1_wins": 0, "player2_wins": 2},
    ).status_code == 200

    next_round = client.post(f"/api/multiplayer/events/{event_id}/pair-next", json={"organizer_token": token})
    assert next_round.status_code == 200
    event = next_round.json()
    assert event["current_round"] == 2
    assert len([match for match in event["matches"] if match["round"] == 2]) == 2
    assert event["standings"][0]["match_points"] == 3

    listed = client.get("/api/multiplayer/events")
    assert listed.status_code == 200
    assert any(item["id"] == event_id for item in listed.json())


def test_event_learning_report_aggregates_attached_replay_rooms(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/events",
        json={
            "name": "Replay Swiss",
            "organizer_name": "Coach",
            "format": "swiss",
            "settings": {"rounds": 1, "max_players": 4, "match_wins_required": 2, "round_minutes": 50},
        },
    ).json()
    event_id = created["event"]["id"]
    token = created["organizer_token"]
    register_players(client, event_id, ["Ari", "Bea"])

    started = client.post(f"/api/multiplayer/events/{event_id}/start", json={"organizer_token": token}).json()
    match = started["matches"][0]
    table = client.post(
        f"/api/multiplayer/events/{event_id}/matches/{match['id']}/room",
        json={"organizer_token": token},
    ).json()
    room_id = table["room_id"]
    host_id = table["host_player_id"]
    guest_id = table["guest_player_id"]
    deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}

    for player_id, deck_name in ((host_id, "Ari Tempo"), (guest_id, "Bea Control")):
        assert client.post(
            f"/api/multiplayer/rooms/{room_id}/seat",
            json={"player_id": player_id, "ready": True, "deck_name": deck_name, "commander": deck["commander"], "deck": deck},
        ).status_code == 200

    assert client.post(f"/api/multiplayer/rooms/{room_id}/start", json={"player_id": host_id}).status_code == 200
    assert client.post(f"/api/multiplayer/rooms/{room_id}/game/action", json={"player_id": host_id, "action": "draw_card"}).status_code == 200
    assert client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "play_permanent", "note": "Rhystic Study"},
    ).status_code == 200
    assert client.post(f"/api/multiplayer/rooms/{room_id}/game/action", json={"player_id": guest_id, "action": "concede"}).status_code == 200

    reported = client.post(
        f"/api/multiplayer/events/{event_id}/matches/{match['id']}/result",
        json={
            "organizer_token": token,
            "player1_wins": 2,
            "player2_wins": 0,
            "replay_room_id": room_id,
            "highlight": "Ari converted early resources into a fast win.",
        },
    )
    assert reported.status_code == 200

    report = client.get(f"/api/multiplayer/events/{event_id}/learning-report")
    assert report.status_code == 200
    body = report.json()
    assert body["summary"]["replay_match_count"] == 1
    assert body["summary"]["coverage_percent"] == 100
    assert body["summary"]["reviewed_decision_count"] >= 3
    assert body["match_reports"][0]["replay_room_id"] == room_id
    assert body["next_drills"]
    assert body["next_drills"][0]["replay_room_id"] == room_id
    assert any(insight["player_name"] == "Ari" for insight in body["player_insights"])


def test_draft_event_creates_pods_and_blocks_unsafe_announcements(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/events",
        json={
            "name": "Eight Seat Draft",
            "organizer_name": "Draft Boss",
            "format": "draft",
            "settings": {"rounds": 3, "max_players": 8, "match_wins_required": 2, "round_minutes": 50},
        },
    ).json()
    event_id = created["event"]["id"]
    token = created["organizer_token"]
    register_players(client, event_id, ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"])

    started = client.post(f"/api/multiplayer/events/{event_id}/start", json={"organizer_token": token})
    assert started.status_code == 200
    event = started.json()
    assert event["draft_pods"][0]["packs_per_player"] == 3
    assert len(event["draft_pods"][0]["player_names"]) == 8

    unsafe = client.post(
        f"/api/multiplayer/events/{event_id}/announcements",
        json={"organizer_token": token, "message": "join http://bad.example for prizes"},
    )
    assert unsafe.status_code == 400
    assert unsafe.json()["detail"] == multiplayer.ROOM_MODERATION_MESSAGE

    safe = client.post(
        f"/api/multiplayer/events/{event_id}/announcements",
        json={"organizer_token": token, "message": "Round one starts after deck construction."},
    )
    assert safe.status_code == 200
    assert safe.json()["announcements"][-1]["message"] == "Round one starts after deck construction."
