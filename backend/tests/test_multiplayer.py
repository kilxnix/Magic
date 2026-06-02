import json
from datetime import timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import multiplayer


def make_client(monkeypatch):
    multiplayer._rooms.clear()
    monkeypatch.setattr(multiplayer, "_save_rooms_locked", lambda: None)
    app = FastAPI()
    app.include_router(multiplayer.router)
    return TestClient(app)


def test_shared_game_starts_and_syncs_actions(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Grok vs Codex",
            "host_name": "Grok",
            "tags": ["playtest"],
            "password": "test123",
            "is_private": False,
            "tier": "free",
        },
    )
    assert created.status_code == 200
    created_data = created.json()
    room_id = created_data["room"]["id"]
    host_id = created_data["player_id"]

    joined = client.post(
        f"/api/multiplayer/rooms/{room_id}/join",
        json={"player_name": "Duel Codex", "password": "test123"},
    )
    assert joined.status_code == 200
    codex_id = joined.json()["player_id"]

    assert client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": host_id, "ready": True, "deck_name": "Grok Deck", "commander": "Talrand"},
    ).status_code == 200
    assert client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": codex_id, "ready": True, "deck_name": "Codex Stompy", "commander": "Goreclaw"},
    ).status_code == 200

    started = client.post(f"/api/multiplayer/rooms/{room_id}/start", json={"player_id": host_id})
    assert started.status_code == 200
    assert started.json()["real_game"] is None
    game = started.json()["game"]
    assert game["status"] == "playing"
    assert game["turn_number"] == 1
    assert game["active_player_name"] == "Grok"
    assert [player["life"] for player in game["players"]] == [40, 40]

    drew = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "draw_card"},
    )
    assert drew.status_code == 200
    grok = drew.json()["game"]["players"][0]
    assert grok["hand_count"] == 8
    assert grok["library_count"] == 91

    passed = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "pass_turn"},
    )
    assert passed.status_code == 200
    assert passed.json()["game"]["turn_number"] == 2
    assert passed.json()["game"]["active_player_name"] == "Duel Codex"


def test_only_active_player_can_pass_turn(monkeypatch):
    client = make_client(monkeypatch)

    room = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Rules Test",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = room["room"]["id"]
    host_id = room["player_id"]
    guest = client.post(
        f"/api/multiplayer/rooms/{room_id}/join",
        json={"player_name": "Guest"},
    ).json()
    guest_id = guest["player_id"]

    client.post(f"/api/multiplayer/rooms/{room_id}/seat", json={"player_id": host_id, "ready": True})
    client.post(f"/api/multiplayer/rooms/{room_id}/seat", json={"player_id": guest_id, "ready": True})
    client.post(f"/api/multiplayer/rooms/{room_id}/start", json={"player_id": host_id})

    denied = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": guest_id, "action": "pass_turn"},
    )
    assert denied.status_code == 403


def test_players_can_rejoin_in_game_by_invite_name(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Rejoin Table",
            "host_name": "Host",
            "tags": [],
            "password": "test123",
            "is_private": True,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(
        f"/api/multiplayer/rooms/{room_id}/join",
        json={"player_name": "Guest", "password": "test123"},
    ).json()
    guest_id = guest["player_id"]

    client.post(f"/api/multiplayer/rooms/{room_id}/seat", json={"player_id": host_id, "ready": True, "deck_name": "Host", "commander": "Goreclaw"})
    client.post(f"/api/multiplayer/rooms/{room_id}/seat", json={"player_id": guest_id, "ready": True, "deck_name": "Guest", "commander": "Talrand"})
    assert client.post(f"/api/multiplayer/rooms/{room_id}/start", json={"player_id": host_id}).status_code == 200

    left = client.post(f"/api/multiplayer/rooms/{room_id}/leave", json={"player_id": guest_id})
    assert left.status_code == 200
    guest_seat = next(seat for seat in left.json()["seats"] if seat["name"] == "Guest")
    assert guest_seat["disconnected"] is True
    assert left.json()["status"] == "in_game"

    rejoined = client.post(
        f"/api/multiplayer/rooms/{room_id}/join",
        json={"player_name": "Guest", "password": "test123"},
    )
    assert rejoined.status_code == 200
    assert rejoined.json()["player_id"] == guest_id
    guest_seat = next(seat for seat in rejoined.json()["room"]["seats"] if seat["name"] == "Guest")
    assert guest_seat["disconnected"] is False
    assert rejoined.json()["room"]["player_count"] == 2

    denied_new_player = client.post(
        f"/api/multiplayer/rooms/{room_id}/join",
        json={"player_name": "New Player", "password": "test123"},
    )
    assert denied_new_player.status_code == 409
    assert "already started" in denied_new_player.json()["detail"]


def test_shared_tracker_commander_counters_tokens_undo_and_rematch(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Tracker Table",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"}).json()
    guest_id = guest["player_id"]

    host_deck = {"commander": "Goreclaw, Terror of Qal Sisma", "list": ["Forest"] * 99, "colors": ["G"]}
    guest_deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}
    client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": host_id, "ready": True, "deck_name": "Host", "commander": host_deck["commander"], "deck": host_deck},
    )
    client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": guest_id, "ready": True, "deck_name": "Guest", "commander": guest_deck["commander"], "deck": guest_deck},
    )
    client.post(f"/api/multiplayer/rooms/{room_id}/start", json={"player_id": host_id})

    commander_damage = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "commander_damage", "target_player_id": guest_id, "amount": 3},
    )
    assert commander_damage.status_code == 200
    guest_state = next(player for player in commander_damage.json()["game"]["players"] if player["name"] == "Guest")
    assert guest_state["commander_damage"]["Goreclaw, Terror of Qal Sisma"] == 3

    token = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "create_token", "amount": 2, "note": "Bear"},
    )
    assert token.status_code == 200
    host_state = next(player for player in token.json()["game"]["players"] if player["name"] == "Host")
    assert host_state["battlefield_count"] == 2
    assert host_state["battlefield_objects"][0]["name"] == "Bear"
    object_id = host_state["battlefield_objects"][0]["id"]

    manual_object = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "add_board_object", "amount": 1, "note": "Treasure Map"},
    )
    assert manual_object.status_code == 200
    host_state = next(player for player in manual_object.json()["game"]["players"] if player["name"] == "Host")
    assert host_state["battlefield_count"] == 3
    assert host_state["battlefield_objects"][1]["kind"] == "manual"
    assert host_state["battlefield_objects"][1]["name"] == "Treasure Map"

    moved_to_exile = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "move_to_exile", "object_id": host_state["battlefield_objects"][1]["id"]},
    )
    assert moved_to_exile.status_code == 200
    host_state = next(player for player in moved_to_exile.json()["game"]["players"] if player["name"] == "Host")
    assert host_state["exile_count"] == 1
    assert all(item["name"] != "Treasure Map" for item in host_state["battlefield_objects"])

    returned_to_board = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "return_to_battlefield", "zone": "exile", "note": "Treasure Map"},
    )
    assert returned_to_board.status_code == 200
    host_state = next(player for player in returned_to_board.json()["game"]["players"] if player["name"] == "Host")
    assert host_state["exile_count"] == 0
    assert any(item["name"] == "Treasure Map" for item in host_state["battlefield_objects"])

    moved_to_command = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "move_to_command", "object_id": host_state["battlefield_objects"][-1]["id"]},
    )
    assert moved_to_command.status_code == 200
    host_state = next(player for player in moved_to_command.json()["game"]["players"] if player["name"] == "Host")
    assert host_state["command_zone_count"] == 2

    discarded = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "discard_card", "note": "Cleanup discard"},
    )
    assert discarded.status_code == 200
    host_state = next(player for player in discarded.json()["game"]["players"] if player["name"] == "Host")
    assert host_state["hand_count"] == 6
    assert host_state["graveyard_count"] == 1

    counted = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "add_object_counter", "object_id": object_id, "counter_type": "+1/+1"},
    )
    assert counted.status_code == 200
    host_state = next(player for player in counted.json()["game"]["players"] if player["name"] == "Host")
    assert host_state["battlefield_objects"][0]["counters"]["+1/+1"] == 1

    monarch = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "set_monarch", "target_player_id": host_id},
    )
    assert monarch.status_code == 200
    assert monarch.json()["game"]["monarch_player_name"] == "Host"

    undo = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "undo"},
    )
    assert undo.status_code == 200
    assert undo.json()["game"]["monarch_player_name"] is None
    assert undo.json()["game"]["can_undo"] is True

    client.post(f"/api/multiplayer/rooms/{room_id}/game/action", json={"player_id": guest_id, "action": "concede"})
    rematch = client.post(f"/api/multiplayer/rooms/{room_id}/rematch", json={"player_id": host_id})
    assert rematch.status_code == 200
    assert rematch.json()["game"]["status"] == "playing"
    assert rematch.json()["game"]["turn_number"] == 1
    assert rematch.json()["game"]["players"][0]["life"] == 40


def test_shared_tracker_replay_review_search_and_annotations(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Replay Learning Table",
            "host_name": "Coach Host",
            "tags": ["learning"],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Replay Guest"}).json()
    guest_id = guest["player_id"]
    deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}
    for player_id, name in ((host_id, "Coach"), (guest_id, "Guest")):
        assert client.post(
            f"/api/multiplayer/rooms/{room_id}/seat",
            json={"player_id": player_id, "ready": True, "deck_name": name, "commander": deck["commander"], "deck": deck},
        ).status_code == 200
    assert client.post(f"/api/multiplayer/rooms/{room_id}/start", json={"player_id": host_id}).status_code == 200
    assert client.post(f"/api/multiplayer/rooms/{room_id}/game/action", json={"player_id": host_id, "action": "draw_card"}).status_code == 200
    assert client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "play_permanent", "note": "Rhystic Study"},
    ).status_code == 200
    assert client.post(f"/api/multiplayer/rooms/{room_id}/game/action", json={"player_id": guest_id, "action": "concede"}).status_code == 200

    replay = client.get(f"/api/multiplayer/rooms/{room_id}/replay")
    assert replay.status_code == 200
    report = replay.json()
    assert report["summary"]["grade"] in {"A", "B", "C", "D", "F"}
    assert report["summary"]["event_count"] >= 4
    assert report["events"][0]["state"]["players"][0]["name"] == "Coach Host"
    assert any(decision["available_options"] for decision in report["decisions"])
    assert report["review"]["evaluator"] == "shared-tracker-heuristic-v1"
    assert report["share_url_path"] == f"/multiplayer/{room_id}?review=1"

    event_id = report["events"][1]["id"]
    annotation = client.post(
        f"/api/multiplayer/rooms/{room_id}/replay/annotations",
        json={"player_id": host_id, "event_id": event_id, "message": "Good spot to compare whether holding the engine was safer."},
    )
    assert annotation.status_code == 200
    assert annotation.json()["annotations"][-1]["author_name"] == "Coach Host"
    assert annotation.json()["annotations"][-1]["event_id"] == event_id

    blocked = client.post(
        f"/api/multiplayer/rooms/{room_id}/replay/annotations",
        json={"player_id": host_id, "message": "read https://bad.example"},
    )
    assert blocked.status_code == 400

    replays = client.get("/api/multiplayer/replays", params={"q": "Replay Learning"})
    assert replays.status_code == 200
    assert any(item["room_id"] == room_id for item in replays.json())


def test_rooms_block_user_links_and_hide_private_discovery(monkeypatch):
    client = make_client(monkeypatch)

    blocked = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Join https://bad.example",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    )
    assert blocked.status_code == 400

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Private Table",
            "host_name": "Host",
            "tags": ["friends"],
            "is_private": True,
            "tier": "free",
        },
    )
    assert created.status_code == 200
    room_id = created.json()["room"]["id"]
    host_id = created.json()["player_id"]

    discoverable = client.get("/api/multiplayer/rooms", params={"include_private": True})
    assert discoverable.status_code == 200
    assert all(room["id"] != room_id for room in discoverable.json())

    direct = client.get(f"/api/multiplayer/rooms/{room_id}")
    assert direct.status_code == 200

    chat = client.post(
        f"/api/multiplayer/rooms/{room_id}/chat",
        json={"player_id": host_id, "message": "open www.bad.example"},
    )
    assert chat.status_code == 400
    assert chat.json()["detail"] == "Message removed by room moderation."


def test_room_chat_accepts_safe_and_rejects_unsafe_messages(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Moderation Room",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    )
    assert created.status_code == 200
    room_id = created.json()["room"]["id"]
    host_id = created.json()["player_id"]

    safe = client.post(
        f"/api/multiplayer/rooms/{room_id}/chat",
        json={"player_id": host_id, "message": "Good luck, I kept a two land hand."},
    )
    assert safe.status_code == 200
    assert safe.json()["chat"][-1]["message"] == "Good luck, I kept a two land hand."
    safe_mtg_phrases = [
        "I will cast Swords to Plowshares on your commander.",
        "Combat damage goes at Teferi.",
        "I crack my fetch land before moving to combat.",
        "Kill target creature resolves.",
    ]
    for message in safe_mtg_phrases:
        accepted = client.post(
            f"/api/multiplayer/rooms/{room_id}/chat",
            json={"player_id": host_id, "message": message},
        )
        assert accepted.status_code == 200
        assert accepted.json()["chat"][-1]["message"] == message

    unsafe_messages = [
        "send nudes",
        "send n u d e s",
        "p0rn spam",
        "kill yourself",
        "k y s",
        "you are worthless",
        "you are a faggot",
        "aaaaaaaaaaaaaa",
        "spam spam spam spam spam spam",
    ]
    for message in unsafe_messages:
        rejected = client.post(
            f"/api/multiplayer/rooms/{room_id}/chat",
            json={"player_id": host_id, "message": message},
        )
        assert rejected.status_code == 400
        assert rejected.json()["detail"] == "Message removed by room moderation."


def test_real_engine_session_routes_actions_and_scoped_views(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Real Engine",
            "host_name": "Authority",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"}).json()
    guest_id = guest["player_id"]

    host_deck = {"commander": "Goreclaw, Terror of Qal Sisma", "list": ["Forest"] * 99, "colors": ["G"]}
    guest_deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}
    assert client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": host_id, "ready": True, "deck_name": "Stompy", "commander": host_deck["commander"], "deck": host_deck},
    ).status_code == 200
    assert client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": guest_id, "ready": True, "deck_name": "Spells", "commander": guest_deck["commander"], "deck": guest_deck},
    ).status_code == 200

    started = client.post(f"/api/multiplayer/rooms/{room_id}/start-real-game", json={"player_id": host_id})
    assert started.status_code == 200
    body = started.json()
    assert body["status"] == "in_game"
    assert body["game"] is None
    assert body["real_game"]["authority_player_name"] == "Authority"
    assert body["real_game"]["players"][0]["deck_locked"] is True

    denied_payload = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/start-payload", params={"player_id": guest_id})
    assert denied_payload.status_code == 403

    payload = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/start-payload", params={"player_id": host_id})
    assert payload.status_code == 200
    assert payload.json()["players"][1]["deck"]["commander"] == "Talrand, Sky Summoner"

    submitted = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/action",
        json={"player_id": guest_id, "action": {"kind": "pass_priority"}},
    )
    assert submitted.status_code == 200
    action_id = submitted.json()["id"]

    actions = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/actions", params={"player_id": host_id})
    assert actions.status_code == 200
    assert actions.json()[0]["id"] == action_id

    tap_mana = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/action",
        json={"player_id": host_id, "action": {"kind": "tap_mana", "payload": {"card_instance_id": "room_card_1", "color": "G"}}},
    )
    assert tap_mana.status_code == 200
    assert tap_mana.json()["action"]["kind"] == "tap_mana"

    cast_spell = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/action",
        json={"player_id": host_id, "action": {"kind": "cast_spell", "payload": {"card_instance_id": "room_card_2", "targets": []}}},
    )
    assert cast_spell.status_code == 200
    assert cast_spell.json()["action"]["kind"] == "cast_spell"

    snapshot = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/snapshot",
        json={
            "player_id": host_id,
            "revision": 1,
            "engine_state": {
                "version": 1,
                "turnNumber": 1,
                "activePlayerIndex": 0,
                "priorityPlayerIndex": 0,
                "players": [{"id": host_id, "landsPlayedThisTurn": 1}],
            },
            "views": {
                host_id: {
                    "viewerId": host_id,
                    "players": [
                        {
                            "id": host_id,
                            "zones": {
                                "battlefield": {
                                    "cards": [
                                        {
                                            "name": "Forest",
                                            "metadata": {
                                                "printed": {
                                                    "faces": [
                                                        {
                                                            "oracle": {
                                                                "paragraphs": [
                                                                    {"text": "Tap: Add G."}
                                                                ]
                                                            }
                                                        }
                                                    ]
                                                }
                                            },
                                        }
                                    ]
                                }
                            },
                        }
                    ],
                },
                guest_id: {"viewerId": guest_id, "players": []},
            },
            "completed_action_ids": [action_id, tap_mana.json()["id"], cast_spell.json()["id"]],
            "events": ["Guest passed priority."],
        },
    )
    assert snapshot.status_code == 200
    assert snapshot.json()["real_game"]["pending_action_count"] == 0

    restored_payload = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/start-payload", params={"player_id": host_id})
    assert restored_payload.status_code == 200
    assert restored_payload.json()["engineState"]["players"][0]["landsPlayedThisTurn"] == 1

    rejected_action = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/action",
        json={"player_id": guest_id, "action": {"kind": "play_land", "payload": {"card_instance_id": "room_card_1"}}},
    )
    assert rejected_action.status_code == 200
    rejected_action_id = rejected_action.json()["id"]

    rejected_snapshot = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/snapshot",
        json={
            "player_id": host_id,
            "revision": 2,
            "views": {
                host_id: {"viewerId": host_id, "players": []},
                guest_id: {"viewerId": guest_id, "players": []},
            },
            "rejected_actions": {rejected_action_id: "Lands can only be played in main phases"},
        },
    )
    assert rejected_snapshot.status_code == 200
    rejected_body = rejected_snapshot.json()
    assert rejected_body["real_game"]["pending_action_count"] == 0
    assert any(
        entry["message"] == "Guest's play land failed: Lands can only be played in main phases"
        for entry in rejected_body["real_game"]["log"]
    )

    guest_view = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/view", params={"player_id": guest_id})
    assert guest_view.status_code == 200
    assert guest_view.json()["revision"] == 2
    assert guest_view.json()["view"]["viewerId"] == guest_id

    stale_action = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/action",
        json={
            "player_id": guest_id,
            "view_revision": 1,
            "action": {"kind": "pass_priority"},
        },
    )
    assert stale_action.status_code == 200
    after_stale = client.get(f"/api/multiplayer/rooms/{room_id}")
    assert after_stale.json()["real_game"]["pending_action_count"] == 1

    current_action = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/action",
        json={
            "player_id": guest_id,
            "view_revision": 2,
            "action": {"kind": "pass_priority"},
        },
    )
    assert current_action.status_code == 200


def test_real_engine_authority_fails_over_when_authority_disconnects(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Failover Engine",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"}).json()
    guest_id = guest["player_id"]
    third = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Third"}).json()
    third_id = third["player_id"]
    deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}

    for player_id, name in ((host_id, "Host"), (guest_id, "Guest"), (third_id, "Third")):
        assert client.post(
            f"/api/multiplayer/rooms/{room_id}/seat",
            json={"player_id": player_id, "ready": True, "deck_name": name, "commander": deck["commander"], "deck": deck},
        ).status_code == 200

    started = client.post(f"/api/multiplayer/rooms/{room_id}/start-real-game", json={"player_id": host_id})
    assert started.status_code == 200
    assert started.json()["real_game"]["authority_player_id"] == host_id

    left = client.post(f"/api/multiplayer/rooms/{room_id}/leave", json={"player_id": host_id})
    assert left.status_code == 200
    assert left.json()["real_game"]["authority_player_id"] == guest_id
    assert left.json()["real_game"]["authority_player_name"] == "Guest"
    assert any("Authority moved to Guest" in entry["message"] for entry in left.json()["real_game"]["log"])

    old_payload = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/start-payload", params={"player_id": host_id})
    assert old_payload.status_code == 403

    new_payload = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/start-payload", params={"player_id": guest_id})
    assert new_payload.status_code == 200
    assert new_payload.json()["authorityPlayerId"] == guest_id


def test_real_engine_authority_fails_over_when_heartbeat_stales(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Stale Authority",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"}).json()
    guest_id = guest["player_id"]
    deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}
    for player_id, name in ((host_id, "Host"), (guest_id, "Guest")):
        client.post(
            f"/api/multiplayer/rooms/{room_id}/seat",
            json={"player_id": player_id, "ready": True, "deck_name": name, "commander": deck["commander"], "deck": deck},
        )
    client.post(f"/api/multiplayer/rooms/{room_id}/start-real-game", json={"player_id": host_id})
    multiplayer._rooms[room_id]["real_game"]["authority_last_seen_at"] = multiplayer._now() - timedelta(seconds=90)

    view = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/view", params={"player_id": guest_id})
    assert view.status_code == 200
    assert view.json()["authority_player_id"] == guest_id
    assert view.json()["authority_player_name"] == "Guest"


def test_real_engine_spectator_view_redacts_hidden_information(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Spectator Engine",
            "host_name": "Host",
            "tags": [],
            "password": "test123",
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest", "password": "test123"}).json()
    guest_id = guest["player_id"]
    deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}
    for player_id, name in ((host_id, "Host"), (guest_id, "Guest")):
        client.post(
            f"/api/multiplayer/rooms/{room_id}/seat",
            json={"player_id": player_id, "ready": True, "deck_name": name, "commander": deck["commander"], "deck": deck},
        )
    client.post(f"/api/multiplayer/rooms/{room_id}/start-real-game", json={"player_id": host_id})
    snapshot_view = {
        "viewerId": host_id,
        "turnNumber": 1,
        "phase": "precombat_main",
        "step": "main",
        "activePlayerId": host_id,
        "priorityPlayerId": host_id,
        "stackSize": 1,
        "players": [
            {
                "id": host_id,
                "name": "Host",
                "life": 40,
                "isActive": True,
                "hasPriority": True,
                "zones": {
                    "hand": {"count": 7, "cards": [{"name": "Secret Host Card"}]},
                    "library": {"count": 92, "cards": [{"name": "Top Secret"}]},
                    "battlefield": {"count": 0, "cards": []},
                    "graveyard": {"count": 0, "cards": []},
                    "exile": {"count": 0, "cards": []},
                    "command": {"count": 1, "cards": [{"name": "Talrand, Sky Summoner"}]},
                },
            },
            {
                "id": guest_id,
                "name": "Guest",
                "life": 40,
                "isActive": False,
                "hasPriority": False,
                "zones": {
                    "hand": {"count": 7, "cards": [{"name": "Secret Guest Card"}]},
                    "library": {"count": 92, "cards": [{"name": "Guest Top Secret"}]},
                    "battlefield": {"count": 0, "cards": []},
                    "graveyard": {"count": 0, "cards": []},
                    "exile": {"count": 0, "cards": []},
                    "command": {"count": 1, "cards": [{"name": "Talrand, Sky Summoner"}]},
                },
            },
        ],
    }
    assert client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/snapshot",
        json={
            "player_id": host_id,
            "revision": 1,
            "views": {host_id: snapshot_view, guest_id: {**snapshot_view, "viewerId": guest_id}},
        },
    ).status_code == 200

    spectator = client.post(
        f"/api/multiplayer/rooms/{room_id}/spectate",
        json={"spectator_name": "Watcher", "password": "test123"},
    )
    assert spectator.status_code == 200
    spectator_id = spectator.json()["spectator_id"]
    assert spectator.json()["room"]["spectator_count"] == 1

    view = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/spectator-view", params={"spectator_id": spectator_id})
    assert view.status_code == 200
    body = view.json()
    assert body["view"]["viewerId"] == "spectator"
    assert body["view"]["stackSize"] == 1
    for player in body["view"]["players"]:
        assert "cards" not in player["zones"]["hand"]
        assert "cards" not in player["zones"]["library"]
        assert player["zones"]["command"]["cards"][0]["name"] == "Talrand, Sky Summoner"


def test_real_engine_four_player_views_are_sanitized_server_side(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Four Player Hidden Info",
            "host_name": "Seat One",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    player_ids = [created["player_id"]]
    for name in ("Seat Two", "Seat Three", "Seat Four"):
        joined = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": name})
        assert joined.status_code == 200
        player_ids.append(joined.json()["player_id"])

    for index, player_id in enumerate(player_ids, start=1):
        deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}
        seated = client.post(
            f"/api/multiplayer/rooms/{room_id}/seat",
            json={
                "player_id": player_id,
                "ready": True,
                "deck_name": f"Seat {index} Deck",
                "commander": deck["commander"],
                "deck": deck,
            },
        )
        assert seated.status_code == 200

    started = client.post(f"/api/multiplayer/rooms/{room_id}/start-real-game", json={"player_id": player_ids[0]})
    assert started.status_code == 200
    assert started.json()["real_game"]["authority_player_id"] == player_ids[0]

    def leaky_view(viewer_id: str) -> dict:
        return {
            "viewerId": viewer_id,
            "turnNumber": 1,
            "phase": "precombat_main",
            "step": "main",
            "activePlayerId": player_ids[0],
            "priorityPlayerId": player_ids[0],
            "stackSize": 0,
            "players": [
                {
                    "id": player_id,
                    "name": f"Seat {index}",
                    "life": 40,
                    "isActive": player_id == player_ids[0],
                    "hasPriority": player_id == player_ids[0],
                    "zones": {
                        "hand": {"count": 7, "cards": [{"name": f"Hidden Hand {index}"}]},
                        "library": {"count": 92, "cards": [{"name": f"Hidden Library {index}"}]},
                        "battlefield": {"count": 1, "cards": [{"name": f"Public Permanent {index}"}]},
                        "graveyard": {"count": 0, "cards": []},
                        "exile": {"count": 0, "cards": []},
                        "command": {"count": 1, "cards": [{"name": "Talrand, Sky Summoner"}]},
                    },
                }
                for index, player_id in enumerate(player_ids, start=1)
            ],
        }

    snapshot = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/snapshot",
        json={
            "player_id": player_ids[0],
            "revision": 1,
            "views": {player_id: leaky_view(player_id) for player_id in player_ids},
        },
    )
    assert snapshot.status_code == 200

    for index, player_id in enumerate(player_ids, start=1):
        response = client.get(f"/api/multiplayer/rooms/{room_id}/real-game/view", params={"player_id": player_id})
        assert response.status_code == 200
        view = response.json()["view"]
        assert view["viewerId"] == player_id
        rendered = json.dumps(view)
        assert f"Hidden Hand {index}" in rendered
        assert f"Hidden Library {index}" in rendered
        assert "Public Permanent 1" in rendered
        assert "Public Permanent 4" in rendered
        for other_index in range(1, 5):
            if other_index == index:
                continue
            assert f"Hidden Hand {other_index}" not in rendered
            assert f"Hidden Library {other_index}" not in rendered


def test_room_settings_can_disable_spectators(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Settings Room",
            "host_name": "Host",
            "tags": [],
            "password": "test123",
            "is_private": True,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]

    updated = client.post(
        f"/api/multiplayer/rooms/{room_id}/settings",
        json={
            "player_id": host_id,
            "spectators_allowed": False,
            "spectator_delay_seconds": 30,
            "table_note": "Friday pod",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["settings"]["spectators_allowed"] is False
    assert updated.json()["settings"]["spectator_delay_seconds"] == 30
    assert updated.json()["settings"]["table_note"] == "Friday pod"

    rejected = client.post(
        f"/api/multiplayer/rooms/{room_id}/spectate",
        json={"spectator_name": "Watcher", "password": "test123"},
    )
    assert rejected.status_code == 403


def test_real_engine_action_payload_is_whitelisted(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Action Security",
            "host_name": "Authority",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"}).json()
    guest_id = guest["player_id"]
    deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}

    client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": host_id, "ready": True, "deck_name": "Host", "commander": deck["commander"], "deck": deck},
    )
    client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": guest_id, "ready": True, "deck_name": "Guest", "commander": deck["commander"], "deck": deck},
    )
    client.post(f"/api/multiplayer/rooms/{room_id}/start-real-game", json={"player_id": host_id})

    shared_action = client.post(
        f"/api/multiplayer/rooms/{room_id}/game/action",
        json={"player_id": host_id, "action": "draw_card"},
    )
    assert shared_action.status_code == 409
    assert "Engine Beta" in shared_action.json()["detail"]

    bad_action = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/action",
        json={"player_id": guest_id, "action": {"kind": "play_land", "payload": {"card_instance_id": "../bad"}}},
    )
    assert bad_action.status_code == 400

    unsupported = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/action",
        json={"player_id": guest_id, "action": {"kind": "cheat_win", "payload": {}}},
    )
    assert unsupported.status_code == 400
    assert "Unsupported real engine action" in unsupported.json()["detail"]

    bad_event = client.post(
        f"/api/multiplayer/rooms/{room_id}/real-game/snapshot",
        json={
            "player_id": host_id,
            "revision": 1,
            "views": {},
            "events": ["see bad.example now"],
        },
    )
    assert bad_event.status_code == 400


def test_engine_beta_blocks_known_unsupported_cards(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Unsupported Engine Cards",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"}).json()
    guest_id = guest["player_id"]

    host_deck = {"commander": "Xenagos, God of Revels", "list": ["Forest"] * 98 + ["1x Chaos Orb (2ED) 233 *F*"], "colors": ["R", "G"]}
    guest_deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}
    client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": host_id, "ready": True, "deck_name": "Host", "commander": host_deck["commander"], "deck": host_deck},
    )
    client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": guest_id, "ready": True, "deck_name": "Guest", "commander": guest_deck["commander"], "deck": guest_deck},
    )

    preflight = client.get(f"/api/multiplayer/rooms/{room_id}/engine-preflight", params={"player_id": host_id})
    assert preflight.status_code == 200
    preflight_body = preflight.json()
    assert preflight_body["ok"] is False
    assert preflight_body["seats"][0]["unsupported_cards"][0]["name"] == "Chaos Orb"
    assert "physical-card" in preflight_body["seats"][0]["unsupported_cards"][0]["reason"]

    blocked = client.post(f"/api/multiplayer/rooms/{room_id}/start-real-game", json={"player_id": host_id})
    assert blocked.status_code == 400
    assert "Chaos Orb" in blocked.json()["detail"]
    assert "Use Shared Table" in blocked.json()["detail"]


def test_engine_beta_allows_supported_blacker_lotus(monkeypatch):
    client = make_client(monkeypatch)

    created = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Blacker Lotus Engine Cards",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    room_id = created["room"]["id"]
    host_id = created["player_id"]
    guest = client.post(f"/api/multiplayer/rooms/{room_id}/join", json={"player_name": "Guest"}).json()
    guest_id = guest["player_id"]

    host_deck = {"commander": "Xenagos, God of Revels", "list": ["Forest"] * 98 + ["Blacker Lotus"], "colors": ["R", "G"]}
    guest_deck = {"commander": "Talrand, Sky Summoner", "list": ["Island"] * 99, "colors": ["U"]}
    client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": host_id, "ready": True, "deck_name": "Host", "commander": host_deck["commander"], "deck": host_deck},
    )
    client.post(
        f"/api/multiplayer/rooms/{room_id}/seat",
        json={"player_id": guest_id, "ready": True, "deck_name": "Guest", "commander": guest_deck["commander"], "deck": guest_deck},
    )

    started = client.post(f"/api/multiplayer/rooms/{room_id}/start-real-game", json={"player_id": host_id})
    assert started.status_code == 200
    assert started.json()["real_game"]["status"] == "starting"
    assert started.json()["real_game"]["authority_player_id"] == host_id


def test_room_cleanup_removes_closed_and_expired_rooms(monkeypatch):
    client = make_client(monkeypatch)

    fresh = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Fresh Room",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    expired = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Expired Room",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    closed = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Closed Room",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()

    fresh_id = fresh["room"]["id"]
    expired_id = expired["room"]["id"]
    closed_id = closed["room"]["id"]

    multiplayer._rooms[expired_id]["updated_at"] = multiplayer._now() - multiplayer.ROOM_EXPIRY - timedelta(minutes=1)
    multiplayer._rooms[closed_id]["status"] = "closed"

    listed = client.get("/api/multiplayer/rooms")
    assert listed.status_code == 200
    assert fresh_id in multiplayer._rooms
    assert expired_id not in multiplayer._rooms
    assert closed_id not in multiplayer._rooms


def test_qa_namespace_is_direct_only_and_not_public_discovery(monkeypatch):
    client = make_client(monkeypatch)

    public = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "Public Room",
            "host_name": "Host",
            "tags": [],
            "is_private": False,
            "tier": "free",
        },
    ).json()
    qa = client.post(
        "/api/multiplayer/rooms",
        json={
            "name": "QA Room",
            "host_name": "Host",
            "tags": ["smoke"],
            "is_private": False,
            "tier": "free",
            "namespace": "qa",
        },
    ).json()

    public_rooms = client.get("/api/multiplayer/rooms").json()
    public_ids = {room["id"] for room in public_rooms}
    assert public["room"]["id"] in public_ids
    assert qa["room"]["id"] not in public_ids

    qa_rooms = client.get("/api/multiplayer/rooms", params={"namespace": "qa"}).json()
    assert qa["room"]["id"] in {room["id"] for room in qa_rooms}

    direct = client.get(f"/api/multiplayer/rooms/{qa['room']['id']}")
    assert direct.status_code == 200
    assert direct.json()["namespace"] == "qa"
