"""Fast room watcher for the DeckReps multiplayer sync test.

This is intentionally small and stdlib-only so it can run on Windows, the VPS,
or any scratch terminal. It does not try to be a real MTG player yet; it just
keeps the shared mock table moving quickly while the real game layer is built.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


TRIGGER_PHRASES = (
    "codex, take turn",
    "codex, respond",
    "grok, take turn",
    "grok, respond",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Poll a DeckReps room and take quick test turns.")
    parser.add_argument("--base-url", default="https://deckreps.app/api/multiplayer")
    parser.add_argument("--room", required=True)
    parser.add_argument("--player-id", required=True)
    parser.add_argument("--bot-name", default="Duel Codex")
    parser.add_argument("--opponent-name", default="Grok")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--once", action="store_true", help="Poll once, act if needed, then exit.")
    parser.add_argument("--dry-run", action="store_true", help="Print intended actions without posting.")
    parser.add_argument("--log-file", help="Optional file to append watcher events to.")
    return parser.parse_args()


class Client:
    def __init__(self, base_url: str, room_id: str, player_id: str, dry_run: bool) -> None:
        self.base_url = base_url.rstrip("/")
        self.room_id = room_id
        self.player_id = player_id
        self.dry_run = dry_run

    def get_room(self) -> dict[str, Any]:
        return self._request("GET", f"/rooms/{self.room_id}")

    def start_room(self) -> dict[str, Any]:
        return self._post(f"/rooms/{self.room_id}/start", {"player_id": self.player_id})

    def game_action(self, action: str, **fields: Any) -> dict[str, Any]:
        payload = {"player_id": self.player_id, "action": action}
        payload.update(fields)
        return self._post(f"/rooms/{self.room_id}/game/action", payload)

    def chat(self, message: str) -> dict[str, Any]:
        return self._post(f"/rooms/{self.room_id}/chat", {"player_id": self.player_id, "message": message})

    def _post(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self.dry_run:
            return {"dry_run": True, "path": path, "payload": payload}
        return self._request("POST", path, payload)

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        body = None
        headers = {"Accept": "application/json"}
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(f"{self.base_url}{path}", data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"{method} {path} failed with HTTP {exc.code}: {detail}") from exc


def emit(message: str, log_file: Path | None = None) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}"
    print(line, flush=True)
    if log_file:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        with log_file.open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def current_turn_start_index(log: list[dict[str, Any]], turn_number: int, bot_name: str) -> int:
    exact = f"Turn {turn_number}: {bot_name} is active."
    for index in range(len(log) - 1, -1, -1):
        entry = log[index]
        if entry.get("player_name") != "System":
            continue
        message = entry.get("message", "")
        if message == exact or (turn_number == 1 and f"{bot_name} takes the first turn" in message):
            return index
    return -1


def newest_handoff_ref(room: dict[str, Any], opponent_name: str) -> str:
    candidates: list[dict[str, Any]] = []
    game = room.get("game") or {}
    for entry in game.get("log") or []:
        if entry.get("player_name") == opponent_name and entry.get("message") == "Passed the turn.":
            candidates.append(entry)
    for entry in room.get("chat") or []:
        message = entry.get("message", "").lower()
        if entry.get("player_name") == opponent_name and not entry.get("system") and any(
            phrase in message for phrase in TRIGGER_PHRASES
        ):
            candidates.append(entry)
    if not candidates:
        return "no-handoff-id"
    candidates.sort(key=lambda entry: entry.get("created_at", ""))
    return str(candidates[-1].get("id") or "no-handoff-id")


def bot_has_acted_this_turn(room: dict[str, Any], bot_name: str) -> bool:
    game = room.get("game") or {}
    log = game.get("log") or []
    start_index = current_turn_start_index(log, int(game.get("turn_number") or 0), bot_name)
    return any(entry.get("player_name") == bot_name for entry in log[start_index + 1 :])


def player_state(room: dict[str, Any], bot_name: str) -> dict[str, Any]:
    for player in (room.get("game") or {}).get("players") or []:
        if player.get("name") == bot_name:
            return player
    raise RuntimeError(f"Could not find game player {bot_name!r}")


def maybe_take_turn(client: Client, args: argparse.Namespace, log_file: Path | None) -> None:
    room = client.get_room()
    status = room.get("status")

    if status == "waiting" and room.get("host_name") == args.bot_name and room.get("player_count", 0) >= 2:
        room = client.start_room()
        game = room.get("game") or {}
        emit(f"started room {args.room}; active={game.get('active_player_name')}", log_file)
        return

    game = room.get("game") or {}
    active = game.get("active_player_name")
    if status != "in_game" or active != args.bot_name:
        emit(f"waiting; status={status} active={active} turn={game.get('turn_number')}", log_file)
        return

    if bot_has_acted_this_turn(room, args.bot_name):
        emit(f"already acted this turn; active={active} turn={game.get('turn_number')}", log_file)
        return

    handoff_ref = newest_handoff_ref(room, args.opponent_name)
    if game.get("phase") != "main":
        client.game_action("set_phase", phase="main")

    room = client.get_room()
    bot = player_state(room, args.bot_name)
    if int(bot.get("hand_count") or 0) <= 7:
        client.game_action("draw_card")

    room = client.get_room()
    bot = player_state(room, args.bot_name)
    if int(bot.get("hand_count") or 0) > 0:
        client.game_action("play_permanent", note="Codex automation test permanent")

    client.game_action("note", note=f"Codex realtime watcher handled Grok handoff {handoff_ref}; passing turn.")
    client.game_action("pass_turn")
    client.chat("Codex passed; grok, take turn")

    room = client.get_room()
    game = room.get("game") or {}
    emit(f"took turn; handled={handoff_ref} next={game.get('active_player_name')} turn={game.get('turn_number')}", log_file)


def main() -> int:
    args = parse_args()
    log_file = Path(args.log_file) if args.log_file else None
    client = Client(args.base_url, args.room, args.player_id, args.dry_run)

    emit(
        f"watching room={args.room} bot={args.bot_name!r} opponent={args.opponent_name!r} interval={args.interval}s",
        log_file,
    )
    while True:
        try:
            maybe_take_turn(client, args, log_file)
        except KeyboardInterrupt:
            emit("stopped", log_file)
            return 0
        except Exception as exc:  # The heartbeat remains responsible for deeper repair work.
            emit(f"error: {exc}", log_file)

        if args.once:
            return 0
        time.sleep(max(0.5, args.interval))


if __name__ == "__main__":
    sys.exit(main())
