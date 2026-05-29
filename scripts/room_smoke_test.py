"""Live multiplayer room smoke test with 429 backoff.

The script intentionally uses the public API surface instead of importing app
internals. It can run against production, staging, or localhost.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any


MODERATION_MESSAGE = "Message removed by room moderation."


class SmokeFailure(RuntimeError):
    pass


@dataclass
class ApiClient:
    base_url: str
    admin_token: str = ""
    use_qa_bypass: bool = False
    max_retries: int = 5
    calls: int = 0
    rate_limit_retries: int = 0
    headers: dict[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.base_url = self.base_url.rstrip("/")
        self.headers = {
            "Content-Type": "application/json",
            "User-Agent": "deckreps-room-smoke/1.0",
        }
        if self.admin_token and self.use_qa_bypass:
            self.headers["X-Admin-Token"] = self.admin_token
            self.headers["X-QA-Rate-Limit-Bypass"] = "1"

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        expected: tuple[int, ...] = (200,),
    ) -> tuple[int, Any]:
        url = f"{self.base_url}{path}"
        data = json.dumps(body).encode("utf-8") if body is not None else None

        for attempt in range(self.max_retries + 1):
            request = urllib.request.Request(url, data=data, method=method, headers=self.headers)
            self.calls += 1
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    status = response.status
                    payload = self._read_json(response.read())
            except urllib.error.HTTPError as exc:
                status = exc.code
                payload = self._read_json(exc.read())
                if status == 429 and attempt < self.max_retries:
                    self.rate_limit_retries += 1
                    self._sleep_for_429(exc, attempt)
                    continue

            if status not in expected:
                raise SmokeFailure(f"{method} {path} expected {expected}, got {status}: {payload}")
            return status, payload

        raise SmokeFailure(f"{method} {path} exhausted retries")

    @staticmethod
    def _read_json(raw: bytes) -> Any:
        if not raw:
            return None
        text = raw.decode("utf-8")
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    @staticmethod
    def _sleep_for_429(exc: urllib.error.HTTPError, attempt: int) -> None:
        retry_after = exc.headers.get("Retry-After")
        if retry_after and retry_after.isdigit():
            delay = min(30.0, max(1.0, float(retry_after)))
        else:
            delay = min(30.0, 1.5 * (2**attempt)) + random.uniform(0, 0.4)
        time.sleep(delay)


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise SmokeFailure(message)


HOST_STOMPY_LIST = [
    *["Forest"] * 42,
    "Sol Ring",
    "Arcane Signet",
    "Llanowar Elves",
    "Elvish Mystic",
    "Fyndhorn Elves",
    "Rampant Growth",
    "Kodama's Reach",
    "Cultivate",
    "Garruk's Uprising",
    "Rancor",
    "Return of the Wildspeaker",
    "Beast Within",
    "Reclamation Sage",
    "Acidic Slime",
    "Colossal Dreadmaw",
    "Terra Stomper",
    "Balduvian Bears",
    "Barbary Apes",
    "Bear Cub",
    "Brushstrider",
    "Canopy Spider",
    "Cylian Elf",
    "Elvish Archers",
    "Elvish Warrior",
    "Forest Bear",
    "Grappler Spider",
    "Greenwood Sentinel",
    "Grizzly Bears",
    "Kalonian Tusker",
    "Moon Sprite",
    "Runeclaw Bear",
    "Swordwise Centaur",
    "Terrain Elemental",
    "Underdark Basilisk",
    "Alpine Grizzly",
    "Centaur Courser",
    "Colossodon Yearling",
    "Elvish Ranger",
    "Gnarled Mass",
    "Gnottvold Recluse",
    "Goliath Beetle",
    "Gorilla Warrior",
    "Harrier Naga",
    "Hitchclaw Recluse",
    "Kraul Stinger",
    "Leatherback Baloth",
    "Mosscoat Goriak",
    "Nessian Courser",
    "Orazca Frillback",
    "Rib Cage Spider",
    "Spined Karok",
    "Sporecap Spider",
    "Tajuru Snarecaster",
    "Trained Armodon",
    "Axebane Beast",
    "Broodhunter Wurm",
    "Cloudcrown Oak",
]

GUEST_SPELLS_LIST = [
    *["Island"] * 42,
    "Sol Ring",
    "Arcane Signet",
    "Sky Diamond",
    "Mind Stone",
    "Ponder",
    "Preordain",
    "Opt",
    "Brainstorm",
    "Consider",
    "Impulse",
    "Chart a Course",
    "Talrand's Invocation",
    "Counterspell",
    "Negate",
    "Unsummon",
    "Into the Roil",
    "Divination",
    "Counsel of the Soratami",
    "Concentrate",
    "Quick Study",
    "Inspiration",
    "Think Twice",
    "Hieroglyphic Illumination",
    "Sleight of Hand",
    "Serum Visions",
    "Anticipate",
    "Curate",
    "Strategic Planning",
    "See Beyond",
    "Compulsive Research",
    "Frantic Search",
    "Peek",
    "Disperse",
    "Blink of an Eye",
    "Aetherize",
    "Jace's Ingenuity",
    "Aegis Turtle",
    "Aven Envoy",
    "Flying Men",
    "Fugitive Wizard",
    "Kraken Hatchling",
    "Merfolk of the Pearl Trident",
    "Mist-Cloaked Herald",
    "Shorecomber Crab",
    "Slither Blade",
    "Triton Shorestalker",
    "Triton Shorethief",
    "Wandering Ones",
    "Zephyr Sprite",
    "Bay Falcon",
    "Coral Eel",
    "Coral Merfolk",
    "Curio Vendor",
    "Flying Dolphin-Fish",
    "Jhessian Lookout",
    "Lumengrid Warden",
    "Maritime Guard",
]


def make_deck(commander: str, cards: list[str], color: str) -> dict[str, Any]:
    if len(cards) != 99:
        raise SmokeFailure(f"{commander} smoke deck has {len(cards)} non-commander cards; expected 99")
    return {
        "commander": commander,
        "list": cards,
        "colors": [color],
    }


def player(room: dict[str, Any], name: str) -> dict[str, Any]:
    for entry in room["game"]["players"]:
        if entry["name"] == name:
            return entry
    raise SmokeFailure(f"Missing game player {name}")


def create_two_player_room(client: ApiClient, label: str, namespace: str) -> dict[str, Any]:
    password = f"qa-{label}"
    _, created = client.request(
        "POST",
        "/rooms",
        {
            "name": f"QA {label}",
            "host_name": "QA Host",
            "tags": ["qa", "smoke"],
            "password": password,
            "is_private": True,
            "tier": "free",
            "namespace": namespace,
        },
    )
    room_id = created["room"]["id"]
    _, joined = client.request(
        "POST",
        f"/rooms/{room_id}/join",
        {"player_name": "QA Guest", "password": password},
    )
    return {
        "room_id": room_id,
        "host_id": created["player_id"],
        "guest_id": joined["player_id"],
    }


def lock_decks(client: ApiClient, ids: dict[str, str]) -> None:
    host_deck = make_deck("Goreclaw, Terror of Qal Sisma", HOST_STOMPY_LIST, "G")
    guest_deck = make_deck("Talrand, Sky Summoner", GUEST_SPELLS_LIST, "U")
    _, host_room = client.request(
        "POST",
        f"/rooms/{ids['room_id']}/seat",
        {
            "player_id": ids["host_id"],
            "ready": True,
            "deck_name": "QA Host Stompy",
            "commander": host_deck["commander"],
            "deck": host_deck,
        },
    )
    _, guest_room = client.request(
        "POST",
        f"/rooms/{ids['room_id']}/seat",
        {
            "player_id": ids["guest_id"],
            "ready": True,
            "deck_name": "QA Guest Spells",
            "commander": guest_deck["commander"],
            "deck": guest_deck,
        },
    )
    assert_true(any(seat["name"] == "QA Host" and seat["deck_locked"] for seat in host_room["seats"]), "host deck did not lock")
    assert_true(any(seat["name"] == "QA Guest" and seat["deck_locked"] for seat in guest_room["seats"]), "guest deck did not lock")


def verify_moderation(client: ApiClient, ids: dict[str, str]) -> dict[str, Any]:
    room_id = ids["room_id"]
    safe_messages = [
        "Good luck. I kept a two land hand.",
        "I will cast Swords to Plowshares on your commander.",
        "Combat damage goes at Teferi.",
        "I crack my fetch land before moving to combat.",
        "Kill target creature resolves.",
    ]
    for message in safe_messages:
        _, body = client.request("POST", f"/rooms/{room_id}/chat", {"player_id": ids["host_id"], "message": message})
        assert_true(body["chat"][-1]["message"] == message, f"safe chat did not persist: {message}")

    unsafe_messages = {
        "link": "open https://bad.example",
        "sexual": "send nudes",
        "harassment": "kill yourself",
        "slur": "you are a faggot",
        "spam": "aaaaaaaaaaaaaa",
    }
    for label, message in unsafe_messages.items():
        _, body = client.request(
            "POST",
            f"/rooms/{room_id}/chat",
            {"player_id": ids["guest_id"], "message": message},
            expected=(400,),
        )
        assert_true(body.get("detail") == MODERATION_MESSAGE, f"{label} moderation detail mismatch")
    return {"safe_messages": len(safe_messages), "unsafe_messages": list(unsafe_messages)}


def verify_shared_table(client: ApiClient, ids: dict[str, str]) -> dict[str, Any]:
    room_id = ids["room_id"]
    _, started = client.request("POST", f"/rooms/{room_id}/start", {"player_id": ids["host_id"]})
    assert_true(started["game"] is not None, "Start Shared Table did not create room.game")
    assert_true(started["real_game"] is None, "Start Shared Table unexpectedly created room.real_game")
    assert_true(started["game"]["active_player_name"] == "QA Host", "host was not first active player")

    client.request("POST", f"/rooms/{room_id}/game/action", {"player_id": ids["host_id"], "action": "draw_card"})
    client.request(
        "POST",
        f"/rooms/{room_id}/game/action",
        {"player_id": ids["host_id"], "action": "play_permanent", "note": "QA host permanent"},
    )
    _, passed = client.request("POST", f"/rooms/{room_id}/game/action", {"player_id": ids["host_id"], "action": "pass_turn"})
    assert_true(passed["game"]["active_player_name"] == "QA Guest", "pass turn did not sync to guest")
    client.request("POST", f"/rooms/{room_id}/game/action", {"player_id": ids["guest_id"], "action": "draw_card"})
    client.request(
        "POST",
        f"/rooms/{room_id}/game/action",
        {"player_id": ids["guest_id"], "action": "play_permanent", "note": "QA guest permanent"},
    )
    _, guest_passed = client.request("POST", f"/rooms/{room_id}/game/action", {"player_id": ids["guest_id"], "action": "pass_turn"})
    assert_true(guest_passed["game"]["active_player_name"] == "QA Host", "guest pass turn did not sync back to host")
    client.request("POST", f"/rooms/{room_id}/game/action", {"player_id": ids["guest_id"], "action": "lose_life", "amount": 5})
    _, conceded = client.request("POST", f"/rooms/{room_id}/game/action", {"player_id": ids["guest_id"], "action": "concede"})
    assert_true(conceded["game"]["status"] == "finished", "concession did not finish shared table")
    assert_true(conceded["game"]["winner_name"] == "QA Host", "winner was not visible after concession")
    _, final_room = client.request("GET", f"/rooms/{room_id}")
    _, second_final_room = client.request("GET", f"/rooms/{room_id}")
    assert_true(final_room["game"]["winner_name"] == "QA Host", "winner missing from final room fetch")
    assert_true(second_final_room["game"]["winner_name"] == "QA Host", "winner missing from second room fetch")
    assert_true(
        [entry["id"] for entry in final_room["game"]["log"]] == [entry["id"] for entry in second_final_room["game"]["log"]],
        "game log did not stay synced across repeated room fetches",
    )
    return {
        "room_id": room_id,
        "winner": final_room["game"]["winner_name"],
        "host_card_count": next(seat["deck_card_count"] for seat in final_room["seats"] if seat["name"] == "QA Host"),
        "guest_card_count": next(seat["deck_card_count"] for seat in final_room["seats"] if seat["name"] == "QA Guest"),
        "log_entries": len(final_room["game"]["log"]),
    }


def verify_engine_beta(client: ApiClient, ids: dict[str, str]) -> dict[str, Any]:
    room_id = ids["room_id"]
    _, started = client.request("POST", f"/rooms/{room_id}/start-real-game", {"player_id": ids["host_id"]})
    assert_true(started["game"] is None, "Engine Beta unexpectedly created shared game")
    assert_true(started["real_game"] is not None, "Engine Beta did not create room.real_game")
    assert_true(started["real_game"]["authority_player_name"] == "QA Host", "authority host mismatch")

    _, denied_shared = client.request(
        "POST",
        f"/rooms/{room_id}/game/action",
        {"player_id": ids["host_id"], "action": "draw_card"},
        expected=(409,),
    )
    assert_true("Engine Beta" in denied_shared.get("detail", ""), "shared action denial was unclear")

    client.request("GET", f"/rooms/{room_id}/real-game/start-payload?player_id={ids['guest_id']}", expected=(403,))
    _, payload = client.request("GET", f"/rooms/{room_id}/real-game/start-payload?player_id={ids['host_id']}")
    assert_true(len(payload["players"]) == 2, "authority payload did not include both players")

    _, unsupported = client.request(
        "POST",
        f"/rooms/{room_id}/real-game/action",
        {"player_id": ids["guest_id"], "action": {"kind": "cast_spell", "payload": {"card_instance_id": "unknown"}}},
        expected=(400,),
    )
    assert_true(unsupported.get("detail") == "Unsupported real engine action for this slice", "unsupported action did not fail clearly")

    _, invalid = client.request(
        "POST",
        f"/rooms/{room_id}/real-game/action",
        {"player_id": ids["guest_id"], "action": {"kind": "play_land", "payload": {"card_instance_id": "../bad"}}},
        expected=(400,),
    )
    assert_true(invalid.get("detail") == "Invalid card instance id", "invalid action did not fail clearly")

    _, pass_priority = client.request(
        "POST",
        f"/rooms/{room_id}/real-game/action",
        {"player_id": ids["guest_id"], "action": {"kind": "pass_priority"}},
    )
    _, play_land = client.request(
        "POST",
        f"/rooms/{room_id}/real-game/action",
        {"player_id": ids["guest_id"], "action": {"kind": "play_land", "payload": {"card_instance_id": "qa-forest-1"}}},
    )
    _, actions = client.request("GET", f"/rooms/{room_id}/real-game/actions?player_id={ids['host_id']}")
    assert_true({action["id"] for action in actions} >= {pass_priority["id"], play_land["id"]}, "authority did not receive pending actions")

    host_secret = "HOST_HAND_SHOULD_NOT_LEAK"
    guest_secret = "GUEST_HAND_SHOULD_NOT_LEAK_TO_HOST"
    _, snapshot = client.request(
        "POST",
        f"/rooms/{room_id}/real-game/snapshot",
        {
            "player_id": ids["host_id"],
            "revision": 1,
            "views": {
                ids["host_id"]: {
                    "viewerId": ids["host_id"],
                    "players": [
                        {"id": ids["host_id"], "zones": {"hand": {"cards": [host_secret], "count": 1}}},
                        {"id": ids["guest_id"], "zones": {"hand": {"count": 1}}},
                    ],
                },
                ids["guest_id"]: {
                    "viewerId": ids["guest_id"],
                    "players": [
                        {"id": ids["host_id"], "zones": {"hand": {"count": 1}}},
                        {"id": ids["guest_id"], "zones": {"hand": {"cards": [guest_secret], "count": 1}}},
                    ],
                },
            },
            "completed_action_ids": [pass_priority["id"], play_land["id"]],
            "events": ["QA Guest passed priority.", "QA Guest played a land."],
        },
    )
    assert_true(snapshot["real_game"]["status"] == "playing", "snapshot did not move Engine Beta to playing")
    assert_true(snapshot["real_game"]["pending_action_count"] == 0, "snapshot did not clear pending actions")
    _, guest_view = client.request("GET", f"/rooms/{room_id}/real-game/view?player_id={ids['guest_id']}")
    guest_view_json = json.dumps(guest_view["view"])
    assert_true(host_secret not in guest_view_json, "host hand marker leaked into guest scoped view")
    assert_true(guest_secret in guest_view_json, "guest hand marker missing from guest scoped view")
    return {
        "room_id": room_id,
        "revision": guest_view["revision"],
        "pending_after_snapshot": guest_view["pending_action_count"],
    }


def close_room(client: ApiClient, ids: dict[str, str]) -> None:
    try:
        client.request("POST", f"/rooms/{ids['room_id']}/close", {"player_id": ids["host_id"]}, expected=(200, 403, 409))
    except Exception:
        pass


def run_smoke(client: ApiClient, namespace: str) -> dict[str, Any]:
    label = f"{int(time.time())}-{random.randint(1000, 9999)}"
    shared_ids = create_two_player_room(client, f"shared-{label}", namespace)
    engine_ids = create_two_player_room(client, f"engine-{label}", namespace)
    result: dict[str, Any] = {
        "namespace": namespace,
        "shared_room_id": shared_ids["room_id"],
        "engine_room_id": engine_ids["room_id"],
    }
    try:
        result["moderation"] = verify_moderation(client, shared_ids)
        lock_decks(client, shared_ids)
        result["shared_table"] = verify_shared_table(client, shared_ids)
        lock_decks(client, engine_ids)
        result["engine_beta"] = verify_engine_beta(client, engine_ids)
    finally:
        close_room(client, shared_ids)
        close_room(client, engine_ids)
    result["api_calls"] = client.calls
    result["rate_limit_retries"] = client.rate_limit_retries
    result["qa_bypass_used"] = bool(client.admin_token and client.use_qa_bypass)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a live DeckReps multiplayer room smoke test.")
    parser.add_argument("--base-url", default=os.getenv("DECKREPS_MULTIPLAYER_BASE", "https://deckreps.app/api/multiplayer"))
    parser.add_argument("--namespace", default=os.getenv("DECKREPS_ROOM_NAMESPACE", "qa"), choices=["public", "qa"])
    parser.add_argument("--admin-token", default=os.getenv("DECKREPS_ADMIN_TOKEN") or os.getenv("ADMIN_TOKEN", ""))
    parser.add_argument("--qa-bypass", action="store_true", help="Send the admin-gated QA rate-limit bypass headers.")
    parser.add_argument("--max-retries", type=int, default=5)
    args = parser.parse_args()

    client = ApiClient(
        base_url=args.base_url,
        admin_token=args.admin_token,
        use_qa_bypass=args.qa_bypass,
        max_retries=args.max_retries,
    )
    try:
        result = run_smoke(client, args.namespace)
    except SmokeFailure as exc:
        print(json.dumps({"ok": False, "error": str(exc), "api_calls": client.calls, "rate_limit_retries": client.rate_limit_retries}, indent=2))
        return 1

    print(json.dumps({"ok": True, **result}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
