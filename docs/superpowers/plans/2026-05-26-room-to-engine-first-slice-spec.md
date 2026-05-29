# Room to Real Engine - First Vertical Slice Spec

**Date:** 2026-05-26
**Owner (proposed):** Duel Codex
**Goal:** Get from "room starts" to "one real engine action works" with proper hidden information.

This is intentionally the smallest slice that moves us out of the toy simulation and into the real `commander-engine`.

## Success Criteria

1. A room with 2+ players who have locked full decks can start a real table.
2. A real `commander-engine` `GameState` is created from the room's player data.
3. Each connected player can request their scoped view.
4. A player can submit one safe real action through the room system and have it validated and applied by the engine.
5. All players see the resulting state update through existing polling.

Recommended first real action: `passPriority`, with `playLand` as the next low-risk action.

## Architecture

- Authority model: designated client authority, initially the host.
- Transport: existing room polling.
- Engine location: authority client's browser.
- Room's job: seating, deck locking, game session lifecycle, and action routing.
- Engine's job: validation, state transitions, and per-player views.

## Starting Order

1. Add deck locking and a start-real-game payload.
2. Add `initRoomGame` and `getPlayerView` in the engine.
3. Add pending action transport for room clients.
4. Let the authority client apply one action and publish scoped views.
