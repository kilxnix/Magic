# Verification Ledger - May 30, 2026

Scope: recent `game-reliability-refactor` work from `88e54bb..597d918`, with Sisay excluded from this ledger because it was separately browser-proven.

## Automated Verification

| Area | Command | Result |
| --- | --- | --- |
| Backend + agent | `pytest backend/tests backend/agent/tests` | 187 passed, 13 skipped |
| Engine | `cd engine && npm.cmd test -- --run` | 1393 passed, 1 skipped |
| Starter deck card QA | `cd engine && npm.cmd test -- --run src/__tests__/starter-decks-card-qa.test.ts` | 16 passed |
| Frontend | `cd frontend && npm.cmd test -- --run` | 30 passed |
| Engine build | `cd engine && npm.cmd run build` | Passed |
| Frontend build | `cd frontend && npm.cmd run build` | Passed |
| Cost modifier slice | `cd engine && npm.cmd test -- --run src/effects/continuous.test.ts src/ai/legal-actions.test.ts` | 95 passed; covers registered cost reducers, intrinsic self-reducers in the broader continuous suite, and new noncreature/opponent spell cost increasers in legal action generation. |
| AI named-card fallback | `cd engine && npm.cmd test -- --run src/ai/integration.test.ts src/authority.test.ts src/playtesting-report-regressions.test.ts` | 96 passed; AI-sourced ExileUntilNamed casts can receive a deterministic named-card fallback while UI-sourced casts still pause for the typed NamedCard prompt. |
| Solo engine preflight | `cd frontend && npm.cmd test -- --run tests/enginePreflight.test.ts` | 2 passed; `/play` deck-start preflight reports hard unsupported cards such as Chaos Orb/Falling Star/Shahrazad with deck labels and reasons before engine initialization. |
| Target disambiguation | `cd engine && npm.cmd test -- --run src/authority.test.ts`; `cd engine && npm.cmd run build`; `cd frontend && npm.cmd run build` | 61 passed plus both builds passed; typed target prompts and `/play` target labels now identify duplicate names by controller, zone, and ordinal instead of presenting indistinguishable duplicate Forest/Bear choices. |
| Room deck parser + decorated unsupported names | `cd frontend && npm.cmd test -- --run tests/roomDeckParser.test.ts tests/enginePreflight.test.ts`; `pytest backend/tests/test_multiplayer.py -q`; `cd frontend && npm.cmd run build` | 4 frontend tests, 17 backend room tests, and frontend build passed; room deck locking now ignores partner commanders/sideboards and strips repeated `*tags*`, set codes, collector numbers, MTGO-style prefixes, and quantity prefixes before card comparison/preflight. |
| Room moderation obfuscation | `pytest backend/tests/test_multiplayer.py -q` | 17 passed; chat moderation now rejects spaced/leetspeak sexual probes and self-harm/slur probes in addition to links, plain sexual content, harassment, and spam while preserving normal MTG phrases. |
| Mobile typecheck | `cd mobile && npm.cmd run typecheck` | Passed |
| Mobile lint | `cd mobile && npm.cmd run lint` | Initially broken because ESLint was not installed/configured; fixed during this audit and now passes |
| Mobile dependency audit | `cd mobile && npm.cmd audit --omit=dev --json` | Fails with 28 production dependency advisories, mostly Expo/Metro transitive packages; the available bundled fix is a semver-major Expo upgrade and was not applied in this audit |

## Browser/UI Verification

| Flow | Command | Result |
| --- | --- | --- |
| `/play` save slots/review audit | `DECKREPS_BASE_URL=http://127.0.0.1:5179 node scripts/play_save_slots_playtest.js` | Passed against fresh built preview; now verifies saved-game replay audit fields (`engineEventLogInitialState`, per-record seeds, authority action/prompt records), the save-slot audit badge, and the Game Review replay audit entry. |
| `/play` selected mulligan | `DECKREPS_BASE_URL=http://127.0.0.1:5179 node scripts/play_mulligan_ui_playtest.js` | Passed against fresh built preview; selected-card mulligan redraw requires a bottom choice before game actions appear. |
| `/play` starter decks | `DECKREPS_BASE_URL=http://127.0.0.1:5179 node scripts/starter_deck_ui_certification.js` | Passed against fresh built preview for Green Big Creatures, Red Goblin Swarm, and Blue Spell Practice through import/start/keep/visible actions. |
| Admin console | `DECKREPS_QA_ADMIN_TOKEN=local-ui-qa-token node scripts/admin_console_playtest.js` | Passed locally |
| Multiplayer rooms | `DECKREPS_BASE_URL=http://127.0.0.1:5173 DECKREPS_QA_ADMIN_TOKEN=local-ui-qa-token node scripts/room_ui_playtest.js` | Passed locally; covered shared tracker, engine beta start, 4-player room, mobile room checks, and unsupported-action error |
| Search picker UI | `DECKREPS_BASE_URL=http://127.0.0.1:5179 node scripts/play_search_picker_ui_playtest.js` | Passed against fresh built preview; hover card preview and search picker legality/destination/reveal metadata verified. |
| Scry/surveil choice UI | `DECKREPS_BASE_URL=http://127.0.0.1:5179 node scripts/play_library_choice_ui_playtest.js` | Passed against fresh built preview |
| Named-card choice UI | `DECKREPS_BASE_URL=http://127.0.0.1:5179 node scripts/play_named_card_choice_ui_playtest.js` and `NAMED_CARD_CHOICE=Black Lotus ... node scripts/play_named_card_choice_ui_playtest.js` | Passed against fresh built preview after the AI fallback fix; cast Tainted Pact through the browser, opened the typed "name a card" picker, selected Thassa's Oracle from the searchable card list, accepted an arbitrary typed Black Lotus name, recorded accepted NamedCard prompt responses, and resolved the stack. |
| Polish surface | `DECKREPS_BASE_URL=http://127.0.0.1:5173 node scripts/polish_ui_playtest.js` | Passed locally |
| Event Center | `DECKREPS_BASE_URL=http://127.0.0.1:5173 DECKREPS_QA_ADMIN_TOKEN=local-ui-qa-token node scripts/event_ui_playtest.js` | Passed locally |
| Four-agent lane | `DECKREPS_BASE_URL=http://127.0.0.1:5173 DECKREPS_QA_ADMIN_TOKEN=local-ui-qa-token GOLDFISH_POD_ACTIONS=40 SHELECTOR_4P_ACTIONS=20 node scripts/four_agent_full_playtest.js` | Passed locally; ran a 4-context multiplayer pod and a `/play` 1v1v1v1 Shelector run |
| Archidekt certification | `DECKREPS_BASE_URL=http://127.0.0.1:5173 DECKREPS_API_BASE_URL=http://127.0.0.1:8000 ARCHIDEKT_CERT_ACTIONS=10 node scripts/archidekt_deck_certification.js` | Passed locally for storms_typhoon, league_of_legendaries, ff_recursion_bullshit, and birbs |

## Fixes Made During This Audit

- Updated `scripts/play_save_slots_playtest.js` so the save-slot verifier opens the current hamburger menu, selects `Saves`, and checks saved-game audit event-log persistence.
- Added mobile ESLint dependencies/configuration so `mobile npm run lint` is a real passing command instead of a broken script.
- Updated `/play` auto-pay action generation to include intrinsic cost reducers printed on the spell itself, matching the engine path used by `tryCastSpell` and `getEffectiveCastCost`.
- Added engine parsing/execution support for generic spell cost increasers such as `Noncreature spells cost {1} more to cast` and `Spells your opponents cast cost {1} more to cast`.
- Updated the starter deck browser certification to handle real picker prompts during starter deck turns instead of trying to click through an open modal.
- Added engine-authoritative `/play` browser support for live "name a card" stack choices, using a typed `NamedCard` prompt plus the searchable picker surface/custom text naming for Tainted Pact / Demonic Consultation style effects instead of relying on a deterministic named-card shortcut.
- Added AI-only fallback naming for ExileUntilNamed spells and kept the authority path source-aware so human/UI Tainted Pact casts still open the live named-card prompt instead of being silently auto-named.
- Hardened `scripts/play_named_card_choice_ui_playtest.js` so it does not click Undo while driving toward the prompt and captures the final body/screenshot on prompt failures.
- Added shared solo `/play` engine preflight helpers and start guards so hard unsupported cards fail with explicit reasons before the local practice engine starts.
- Disambiguated target-choice prompts and collapsed `/play` targeted action choices with controller, zone, and duplicate ordinals so multiple same-name permanents are not presented as identical targets.
- Moved the room deck-list parser into a tested shared frontend helper and hardened both room and solo preflight name normalization against decorated exports (`1x`, set codes, collector numbers, MTGO prefixes, and repeated `*F*` / `*CMDR*` tags).
- Expanded server-side room chat moderation to catch common spaced/leetspeak sexual and harassment probes before messages enter room history.

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
