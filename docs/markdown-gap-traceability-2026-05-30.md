# Markdown Gap Traceability - May 30, 2026

This is the correction to the earlier overclaiming. The four MTGA/Arena gap files were not completed in their entirety. A meaningful slice was implemented and tested, but large sections remain partial or not done.

Source files audited:

- `C:\Program Files (x86)\Steam\steamapps\common\MTGA\codex_static_research\deckreps_analysis\deckreps_mtga_gap_analysis.md`
- `C:\Program Files (x86)\Steam\steamapps\common\MTGA\codex_static_research\deckreps_analysis\remaining_gaps_exhaustive.md`
- `C:\Program Files (x86)\Steam\steamapps\common\MTGA\codex_static_research\deckreps_analysis\deckreps_arena_fix_blueprint.md`
- `C:\Program Files (x86)\Steam\steamapps\common\MTGA\codex_static_research\deckreps_analysis\deckreps_engine_fix_review_updated.md`

## Scope Reality

| File | Headings | Bullet lines | Honest status |
| --- | ---: | ---: | --- |
| `deckreps_mtga_gap_analysis.md` | 32 | 485 | Directionally addressed, not completed |
| `remaining_gaps_exhaustive.md` | 73 | 500 | Mostly still a backlog |
| `deckreps_arena_fix_blueprint.md` | 55 | 173 | Several P0 slices implemented, architecture not complete |
| `deckreps_engine_fix_review_updated.md` | 24 | 70 | Sisay/search/action-authority portions improved, acceptance bar not fully met |

## Status Key

- `browser-proven`: verified through the rendered UI.
- `test-proven`: automated tests verify the engine/backend/frontend behavior.
- `partial`: some code/tests exist, but not the whole requested behavior.
- `not done`: no serious implementation yet or only a stub/scaffold exists.
- `not audited`: not checked deeply enough to claim anything.

## `deckreps_engine_fix_review_updated.md`

| Section | Status | Evidence / limitation |
| --- | --- | --- |
| 1. Single engine authority boundary | partial | `engine/src/authority.ts`, `actions-public.ts`, and authority tests exist. UI still has local orchestration and not every mutation is event-sourced. |
| 2. Split spell casting, ability activation, resolution prompts | partial | Sisay cast/activation split is browser-proven. Generic typed prompt architecture is not complete. |
| 3. Typed prompt lifecycle | partial | Search, library-choice, and Brainstorm hand-to-library-top prompts improved. No universal `ActionRequest` request-id/state-id system across all decisions. |
| 4. Search predicates/response validation | partial | Sisay is browser-proven. Search picker, Farseek/fetch-style legality, and Impulse-style top-N choices have UI/authority support. Not all search/tutor destinations are complete. |
| 5. Stack and priority machine | partial | Stack/priority tests and UI paths exist. Full Arena-like priority stops/hold behavior is not complete. |
| 6. Replacement effects on all zone changes | partial | Shock/fetch-style entry choices have tests/UI coverage in slices. Replacement coverage is not global. |
| 7. One legal action generator everywhere | partial | Engine and AI moved closer to shared try/action paths. Review/coaching are not fully unified. |
| 8. Context-aware card clicks | partial | Hover/modal/card inspect improvements exist. Not every card context maps to exact legal action choices. |
| 9. Target selection | partial | Targeting tests exist. Complex multiplayer target selection/fizzle/revalidation is not complete. |
| 10. Turn/phase/event feed projection | partial | Public phase label polishing, validated manual turn/phase correction, and UI tests exist. Full state-id event consistency/replay is not done. |
| 11. Mandatory choices separate from priority | partial | Search/scry/surveil choices exist, and Brainstorm now pauses for mandatory hand-to-library-top selection after draw resolution. Universal mandatory-choice handling is not complete. |
| 12. Auto-pay as proposal | partial | Auto-pay preview and Sisay auto-pay are browser-proven. `/play` synthetic auto-pay action generation now includes both registered battlefield cost reducers and intrinsic reducers printed on the spell itself, matching the engine cast path for cards such as Blasphemous Act/Cavern-Hoard Dragon. Full trust UI for every special mana case is incomplete. |
| 13. Continuous effects/derived characteristics | partial | Sisay power and some layers/effective types work. Full CR-style layer/dependency system is not complete. |
| 14. AI uses same engine contract | partial | AI action tests pass and AI uses try paths in slices. Full 4p politics/hidden-info safe AI is not complete. |
| 15. Deterministic scenario testing | partial | Many scenarios exist; not the whole listed minimum bar. |
| 16. Replay/audit layer | partial/test-proven | `auditEngineEventLogReplay` can replay committed action/prompt records from event-log state hashes, verify rules-event and visible-diff sequences, audit expected prompt/action rejections, and fail on mismatch. `/play` save slots now persist the replay initial state, per-record state seeds, and authority event-log records for routed actions and typed prompt responses; the save-slot UI audits those records and the browser playtest verifies the audit badge. This is not yet a full persisted/shareable replay product. |

Minimum acceptance bar from that file:

| Acceptance item | Status |
| --- | --- |
| Arcane Signet cannot be selected from Sisay | browser-proven for Sisay filtering |
| Illegal Sisay choices not labeled legal | browser-proven for the tested Sisay state |
| Illegal hidden prompt response rejected by engine | partial/test-level only, not universal |
| Sisay search cannot appear while Sisay is on stack | browser-proven |
| Marsh Flats/Rampant Growth search after resolution | partial; search picker UI proved a fetch-style path, not every named card |
| Shockland replacement from hand/library | partial |
| Land plays never appear while stack non-empty | partial/test-proven, not exhaustively browser-proven |
| Event feed and visible UI never disagree | partial |
| AI actions use same validation path | partial |
| Replay audit proves every committed action legal | partial/test-proven; committed event-log records now replay through engine legality and invariant checks, but this is not yet wired into every saved/live game log |

## `deckreps_arena_fix_blueprint.md`

| Fix | Status | Evidence / limitation |
| --- | --- | --- |
| Fix 1: Strict Action Generation | partial | Shared legal-action and try wrappers exist; not every source consumes one canonical predicate. |
| Fix 2: Sisay Search Legality | browser-proven for one flow | The exact `/play` flow cast Sisay, activated WUBRG, filtered choices, and put Mox Amber on battlefield. |
| Fix 3: Shared Legality Engine | partial | Action paths improved, review and UI suggestions still not fully unified. |
| Fix 4: Prompt System | partial | Search/scry/surveil/equipment style prompts exist, Brainstorm hand-to-library-top selection exists, and manual attach/detach plus turn/phase correction now use validated action requests; no fully generic typed request system. |
| Fix 5: Transactional Engine Updates | partial | Authority/action response structures exist; not a complete event-sourced transaction model. |
| Fix 6: Event-Sourced Replay | partial/test-proven | Engine event-log records now carry request, before/after state IDs, expected accepted/rejected result, rules events, and visible diffs; `auditEngineEventLogReplay` replays and rejects tampered/mismatched records. `/play` saved games persist replay seeds plus authority-routed action and typed prompt-response records, and the saves panel displays an audit badge verified through `scripts/play_save_slots_playtest.js`. UI replay is still incomplete. |
| Fix 7: Review Must Audit Legality | partial/test-proven | The `/play` review now includes a replay audit entry from the saved-game authority event log, and the save-slot browser playtest verifies the review shows the replay audit. Full line-by-line legality audit across all review surfaces is still incomplete. |
| Fix 8: Stack And Priority | partial | Visible stack/priority exists; full-control/stop settings are incomplete. |
| Fix 9: Turn And Phase Labels | partial/browser-checked in UI scripts | Labels improved and a validated turn/phase correction surface exists; event consistency is not globally audited. |
| Fix 10: Replacement/Choice Prompts | partial | Some ETB/tapped/pay-life prompts exist; not global replacement handling. |
| Fix 11: Continuous Effects And Layers | partial | Practical layer slices exist; not full Arena-like layer fidelity. |
| Fix 12: Presentation Events | partial | Feed/last-played/modal polish exists, d20 rolls now persist through the engine authority update as DiceRolled events with a playfield toast, and attachment corrections emit validated manual events. This is still not a full animation/event pipeline. |
| Fix 13: AI Must Use Same Engine | partial | Better action wrappers; not full AI legality/hidden-info proof. |
| Fix 14: Unsupported Rules Handling | partial | Unsupported actions fail clearly, manual override entries expose metadata for reason/owner/fixture reporting, and room Engine Beta now has a server-side deck preflight with user-visible unsupported-card reasons; full card support/fallback coverage is still incomplete. |
| Fix 15: Test Plan | partial | Many tests added; listed golden tests are not all fully browser-proven. |
| Fix 16: Development Roadmap | partial | Phase 1-ish slices landed; phases 2-6 are not complete. |
| Fix 17: UI Changes | partial | Hamburger/action dock/search prompt improved; full Arena-like UI not done. |
| Fix 18: "Just Like Arena" interpretation | not complete | Product is not Arena-like yet. |

## `remaining_gaps_exhaustive.md`

| Section | Status |
| --- | --- |
| 1.1 UI Actions Can Still Appear Too Close To State Mutation | partial |
| 1.2 Missing Hard Revalidation At Resolution Time | partial |
| 1.3 No Clear Separation Between Legal Actions, Suggested Actions, And Coach Actions | partial |
| 1.4 No Proven Canonical Event-Sourced State | partial/test-proven for engine event-log replay records and `/play` saved-game audit fields |
| 2.1 Sisay Legal Choice Filtering | browser-proven for tested flow |
| 2.2 Search Legality In General | partial; top-N search prompts now limit choices to the looked-at cards and bottom unselected cards for Impulse-style effects |
| 2.3 Card Type Constraints | partial |
| 2.4 Mana Value Constraints | partial |
| 2.5 Continuous Effects And Layers | partial |
| 2.6 Triggered Abilities | partial |
| 2.7 Replacement And Prevention Effects | partial |
| 2.8 State-Based Actions | partial/test-proven |
| 2.9 Target Legality | partial |
| 2.10 Cost Payment Rules | partial |
| 2.11 Timing Permissions | partial |
| 2.12 Modal And Optional Choices | partial; Brainstorm now has prompt-backed hand-to-library-top ordering |
| 3.1 Priority Is Visible But Not Central | partial |
| 3.2 Stack Is Evented But Not Visually Dominant | partial |
| 3.3 Pass Priority Flow Is Compressed | partial |
| 3.4 Stop Settings Are Incomplete Or Not Exposed Enough | partial | Hold priority and individual priority stops exist, and the game menu now has a Full control shortcut that enables hold priority plus all stops. This is still not a full Arena-equivalent stop system. |
| 4.1 Internal Step Labels Mismatch Visible UI | partial; Main 2 display handles the existing postcombat-main/end representation, and manual phase correction offers explicit user-facing step names |
| 4.2 Main Phase And Begin Combat Confusion | partial; manual phase correction can recover a stuck/incorrect step, but the underlying turn-manager model still needs a cleaner main-step representation |
| 4.3 AI Turn Compression | partial |
| 5.1 Action Text Is Improved But Still Tool-Like | partial |
| 5.2 Action Categories Are Coarse | partial |
| 5.3 No Unified Typed Prompt Surface | not done |
| 6.1 Invalid Choices Are Not Hidden Or Disabled | partial |
| 6.2 "Legal" Label Is Not Trustworthy | partial |
| 6.3 Destination Labels Are Too Broad | partial |
| 6.4 Hidden Information Is Not Communicated Cleanly | partial |
| 7.1 Auto-Pay Exists But Needs Trust Layer | partial; `/play` auto-pay now applies intrinsic spell cost reducers in its visible action/payment preview path as well as the engine transaction path |
| 7.2 Floating Mana Handling | partial |
| 7.3 Special Mana Rules | partial |
| 8.1 Combat Still Too Compressed | partial |
| 8.2 No Observed Blocker Assignment UI | partial/not fully browser-proven |
| 8.3 Attack Requirements And Restrictions | partial |
| 9.1 Zone-Change Identity | partial; manual zone moves clear stale attachments, and manual attach/detach now preserves explicit attachment identity |
| 9.2 Command Zone Rules | partial; manual commander-damage correction validates commander sources and feeds commander-damage loss checks |
| 9.3 Graveyard/Exile/Library UX | partial |
| 10.1 State Changes Need Presentation Events | partial; d20 rolls now have persisted presentation records and authoritative DiceRolled events, and manual attachment plus turn/phase changes emit action events |
| 10.2 Cause And Effect Need Better Timing | partial |
| 10.3 Battlefield Visual Hierarchy | partial |
| 10.4 Card Presentation | partial |
| 11.1 Review Does Not Catch Engine Illegality | partial/test-proven; `/play` review surfaces replay audit pass/fail from authority event logs, but broader post-game legality analysis is still incomplete |
| 11.2 Review Move Granularity Is Too Coarse | partial |
| 11.3 Coaching Blends With Gameplay | partial |
| 12.1 AI Actions Are Still Summarized | partial |
| 12.2 No Opponent Thinking/Intent Feedback | partial |
| 12.3 AI Legality And Hidden Information | partial |
| 14.1 Need Golden Rule Tests | partial |
| 14.2 Need Replay Regression Harness | partial/test-proven; engine event-log replay auditing exists and `/play` saved games persist audit seeds plus authority-routed action/prompt records with a visible audit badge, but broad replay corpus/UI replay is still incomplete |
| 14.3 Need Unsupported-Card Surfacing | partial; room Engine Beta now has server-side deck preflight and UI surfacing for known unsupported cards, plus parser coverage reports for syntax clusters; solo game-start surfacing and full unsupported taxonomy are still incomplete |

## `deckreps_mtga_gap_analysis.md`

| Area | Status |
| --- | --- |
| 1. Authority Model | partial |
| 2. State Diff Granularity | partial |
| 3. Priority And Stack Lifecycle | partial |
| 4. Action Request Model | partial |
| 5. Rules Fidelity | partial |
| 6. Search And Selection UX | partial/browser-proven for some paths |
| 7. Mana Payment And Autotap | partial |
| 8. Combat Flow | partial |
| 9. Opponent Simulation | partial |
| 10. Animation/Event Pipeline | partial/not complete; d20 is now evented and surfaced, broader animation/event coverage remains |
| 11. Battlefield Layout And Visual Hierarchy | partial |
| 12. Card Presentation | partial |
| 13. Prompts And Modal Feel | partial |
| 14. Review Layer Integration | partial/not complete |
| 15. Timing, Responsiveness, And Game Feel | partial |
| 16. Information Architecture | partial |
| 17. AI Transparency | partial |
| 18. Undo Model | partial |
| 19. Hidden Information | partial |
| 20. Multiplayer Commander Fidelity | partial |
| Phase 1: Engine Boundary | partial |
| Phase 2: Prompt System | partial |
| Phase 3: Priority/Stack Exactness | partial |
| Phase 4: Rules Legality | partial |
| Phase 5: Presentation Events | partial |
| Phase 6: Arena-Like Play Surface | not done |

Additional certification added after this audit: the included starter decks now have both engine-level card QA (`starter-decks-card-qa.test.ts`) and browser UI certification (`scripts/starter_deck_ui_certification.js`) for loading, starting, keeping, and driving visible actions. This improves the `ui-gameplay` and starter-deck trust lane, but it still is not exhaustive proof of every card line.

## Direct Answer

Yes, relative to the actual size and meaning of these markdown files, I was effectively treating large portions as direction/backlog while reporting progress too broadly. The right status is not "done." The right status is "a verified slice is done; most of the Arena/MTGA parity roadmap remains partial or incomplete."

Going forward, "done" must only be used against a specific checklist row with linked proof.
