# Verification Ledger - May 30, 2026

Scope: recent `game-reliability-refactor` work from `88e54bb..597d918`, with Sisay excluded from this ledger because it was separately browser-proven.

## Automated Verification

| Area | Command | Result |
| --- | --- | --- |
| Backend + agent | `pytest backend/tests backend/agent/tests` | 187 passed, 13 skipped |
| Engine | `cd engine && npm.cmd test -- --run` | 1141 passed, 1 skipped |
| Frontend | `cd frontend && npm.cmd test -- --run` | 30 passed |
| Engine build | `cd engine && npm.cmd run build` | Passed |
| Frontend build | `cd frontend && npm.cmd run build` | Passed |
| Mobile typecheck | `cd mobile && npm.cmd run typecheck` | Passed |
| Mobile lint | `cd mobile && npm.cmd run lint` | Initially broken because ESLint was not installed/configured; fixed during this audit and now passes |
| Mobile dependency audit | `cd mobile && npm.cmd audit --omit=dev --json` | Fails with 28 production dependency advisories, mostly Expo/Metro transitive packages; the available bundled fix is a semver-major Expo upgrade and was not applied in this audit |

## Browser/UI Verification

| Flow | Command | Result |
| --- | --- | --- |
| `/play` save slots | `DECKREPS_BASE_URL=http://127.0.0.1:5179 node scripts/play_save_slots_playtest.js` | Passed against fresh built preview; now also verifies saved-game replay audit fields (`engineEventLogInitialState`, per-record seeds, authority action/prompt records) and the visible audit badge. |
| Admin console | `DECKREPS_QA_ADMIN_TOKEN=local-ui-qa-token node scripts/admin_console_playtest.js` | Passed locally |
| Multiplayer rooms | `DECKREPS_BASE_URL=http://127.0.0.1:5173 DECKREPS_QA_ADMIN_TOKEN=local-ui-qa-token node scripts/room_ui_playtest.js` | Passed locally; covered shared tracker, engine beta start, 4-player room, mobile room checks, and unsupported-action error |
| Search picker UI | `DECKREPS_BASE_URL=http://127.0.0.1:5173 node scripts/play_search_picker_ui_playtest.js` | Passed locally |
| Scry/surveil choice UI | `DECKREPS_BASE_URL=http://127.0.0.1:5173 node scripts/play_library_choice_ui_playtest.js` | Passed locally |
| Polish surface | `DECKREPS_BASE_URL=http://127.0.0.1:5173 node scripts/polish_ui_playtest.js` | Passed locally |
| Event Center | `DECKREPS_BASE_URL=http://127.0.0.1:5173 DECKREPS_QA_ADMIN_TOKEN=local-ui-qa-token node scripts/event_ui_playtest.js` | Passed locally |
| Four-agent lane | `DECKREPS_BASE_URL=http://127.0.0.1:5173 DECKREPS_QA_ADMIN_TOKEN=local-ui-qa-token GOLDFISH_POD_ACTIONS=40 SHELECTOR_4P_ACTIONS=20 node scripts/four_agent_full_playtest.js` | Passed locally; ran a 4-context multiplayer pod and a `/play` 1v1v1v1 Shelector run |
| Archidekt certification | `DECKREPS_BASE_URL=http://127.0.0.1:5173 DECKREPS_API_BASE_URL=http://127.0.0.1:8000 ARCHIDEKT_CERT_ACTIONS=10 node scripts/archidekt_deck_certification.js` | Passed locally for storms_typhoon, league_of_legendaries, ff_recursion_bullshit, and birbs |

## Fixes Made During This Audit

- Updated `scripts/play_save_slots_playtest.js` so the save-slot verifier opens the current hamburger menu, selects `Saves`, and checks saved-game audit event-log persistence.
- Added mobile ESLint dependencies/configuration so `mobile npm run lint` is a real passing command instead of a broken script.

## What This Does Not Prove

- It does not prove every Magic card or every possible rules interaction works.
- It does not prove every possible line in the four Archidekt decks works; the certification runner verifies import, UI launch, and focused engine action sweeps.
- It does not prove MTGA/Arena parity.
- It does not prove a full multi-hour production tournament.
- It does not prove native Android/iOS runtime behavior; mobile was typechecked and linted only.
- It does not clear the current mobile dependency audit advisories.
- It does not prove production live-site room behavior with real public traffic; these browser runs targeted the local dev site and backend.

## Honest Status

The recent work is much better verified than my earlier claims implied, but it is not equivalent to "everything Magic can do is complete." The verified status is: the listed automated suites and local browser flows pass. Anything outside those rows should be treated as implemented or partially covered, not fully certified.
