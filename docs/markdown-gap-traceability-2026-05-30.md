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
| 3. Typed prompt lifecycle | partial | Search, library-choice, Brainstorm hand-to-library-top ordering, `/play` Fact or Fiction pile choice, and `/play` Ward pay/decline choices improved. No universal `ActionRequest` request-id/state-id system across all decisions. |
| 4. Search predicates/response validation | partial | Sisay is browser-proven. Search picker, Farseek/fetch-style legality, Impulse-style top-N choices, and Jeska's Will temporary exile play permissions have test coverage. Not all search/tutor destinations are complete. |
| 5. Stack and priority machine | partial | Stack/priority tests and UI paths exist. Full Arena-like priority stops/hold behavior is not complete. |
| 6. Replacement effects on all zone changes | partial | Shock/fetch-style entry choices have tests/UI coverage in slices. Replacement coverage is not global. |
| 7. One legal action generator everywhere | partial | Engine and AI moved closer to shared try/action paths. Review/coaching are not fully unified. |
| 8. Context-aware card clicks | partial | Hover/modal/card inspect improvements exist. Not every card context maps to exact legal action choices. |
| 9. Target selection | partial | Targeting tests exist, and target prompts now disambiguate duplicate same-name objects by controller, zone, and ordinal in both authority choices and `/play` collapsed target choices. Complex multiplayer target selection/fizzle/revalidation is not complete. |
| 10. Turn/phase/event feed projection | partial | Public phase label polishing, validated manual turn/phase correction, and UI tests exist. Full state-id event consistency/replay is not done. |
| 11. Mandatory choices separate from priority | partial | Search/scry/surveil choices exist, Brainstorm has explicit hand-to-library-top selection support, Fact or Fiction has `/play` pile-selection support, and Ward has `/play` pay/decline support. Universal mandatory-choice handling is not complete. |
| 12. Auto-pay as proposal | partial | Auto-pay preview and Sisay auto-pay are browser-proven. `/play` synthetic auto-pay action generation now includes both registered battlefield cost reducers and intrinsic reducers printed on the spell itself, matching the engine cast path for cards such as Blasphemous Act/Cavern-Hoard Dragon. Full trust UI for every special mana case is incomplete. |
| 13. Continuous effects/derived characteristics | partial | Sisay power and some layers/effective types work. Full CR-style layer/dependency system is not complete. |
| 14. AI uses same engine contract | partial | AI action tests pass, AI uses try paths in slices, AI-sourced ExileUntilNamed casts now receive source-aware named-card choices without bypassing the human UI prompt, and legal-action generation sees temporary exile play permissions. Full 4p politics/hidden-info safe AI is not complete. |
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
| Fix 4: Prompt System | partial | Search/scry/surveil/equipment style prompts exist, Brainstorm hand-to-library-top selection exists, Fact or Fiction pile selection exists in `/play`, Ward pay/decline exists in `/play`, Tainted Pact / Demonic Consultation style "name a card" stack choices now use a typed `NamedCard` prompt with searchable known names plus arbitrary custom naming in `/play`, and manual attach/detach plus turn/phase correction now use validated action requests; no fully generic typed request system. |
| Opening mulligan selection | partial/browser-proven | `/play` selected-card mulligans now stay in redraw-selection mode through repeated mulligans, enter bottom-card selection only after the player keeps, and keep bottom-selection cards visibly/selectably actionable; broader multiplayer mulligan UX is not fully certified. |
| Fix 5: Transactional Engine Updates | partial | Authority/action response structures exist; not a complete event-sourced transaction model. |
| Fix 6: Event-Sourced Replay | partial/test-proven | Engine event-log records now carry request, before/after state IDs, expected accepted/rejected result, rules events, and visible diffs; `auditEngineEventLogReplay` replays and rejects tampered/mismatched records. `/play` saved games persist replay seeds plus authority-routed action and typed prompt-response records, and the saves panel displays an audit badge verified through `scripts/play_save_slots_playtest.js`. UI replay is still incomplete. |
| Fix 7: Review Must Audit Legality | partial/test-proven | The `/play` review now includes a replay audit entry from the saved-game authority event log, and the save-slot browser playtest verifies the review shows the replay audit. Full line-by-line legality audit across all review surfaces is still incomplete. |
| Fix 8: Stack And Priority | partial | Visible stack/priority exists; full-control/stop settings are incomplete. |
| Fix 9: Turn And Phase Labels | partial/browser-checked in UI scripts | Labels improved and a validated turn/phase correction surface exists; event consistency is not globally audited. |
| Fix 10: Replacement/Choice Prompts | partial | Some ETB/tapped/pay-life prompts exist; not global replacement handling. |
| Fix 11: Continuous Effects And Layers | partial | Practical layer slices exist; not full Arena-like layer fidelity. |
| Fix 12: Presentation Events | partial | Feed/last-played/modal polish exists, d20 rolls now persist through the engine authority update as DiceRolled events with a playfield toast, and attachment corrections emit validated manual events. This is still not a full animation/event pipeline. |
| Fix 13: AI Must Use Same Engine | partial | Better action wrappers, source-aware authority dispatch, and AI-only named-card fallback for ExileUntilNamed spells; not full AI legality/hidden-info proof. |
| Fix 14: Unsupported Rules Handling | partial | Unsupported actions fail clearly, manual override entries expose metadata for reason/owner/fixture reporting, room Engine Beta has a server-side deck preflight with user-visible unsupported-card reasons, and solo `/play` starts now preflight hard unsupported cards before engine initialization. The room and solo preflight normalizers now handle decorated export names with quantities, set codes, collector numbers, MTGO prefixes, and repeated `*tags*`; full card support/fallback coverage is still incomplete. |
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
| 2.2 Search Legality In General | partial; top-N search prompts now limit choices to the looked-at cards and bottom unselected cards for Impulse-style effects, ExileUntilNamed effects now prompt through a typed live named-card choice in `/play` with arbitrary card-name entry instead of forcing a hard-coded Oracle line, Jeska's Will grants this-turn play permission to exiled top cards, and unrestricted tutor prompts now require a selection when a card is findable while restricted hidden-library searches still allow fail-to-find. Room deck locking now has tested partner-commander/sideboard exclusion and decorated export cleanup before deck cards are sent to room state. |
| 2.3 Card Type Constraints | partial/test-proven; engine card filters, prompt failure reasons, imported card type parsing, intrinsic basic-land subtype mana inference, and frontend deck/room/draft/permanent-prompt classification now match types, supertypes, and subtypes as separated type-line terms instead of broad substrings, with regression coverage for `land` not matching inside `Island`, subtype phrase matching such as `Time Lord`, `Creature - Island Scout` not importing as a land, and `Islander` not granting Island mana. |
| 2.4 Mana Value Constraints | partial/test-proven; generic library searches, targeted removal/bounce, legal target generation, target validation, and static spell-cost modifiers now parse `with mana value` limits, including strict `less than` / `greater than` phrasing, into CMC filters that authority prompts, target validation, and continuous cost effects enforce. |
| 2.5 Continuous Effects And Layers | partial |
| 2.6 Triggered Abilities | partial |
| 2.7 Replacement And Prevention Effects | partial; delayed blink/flicker effects now exile immediately and return from exile through a one-shot next-end-step delayed trigger instead of using the previous immediate-return shortcut. |
| 2.8 State-Based Actions | partial/test-proven |
| 2.9 Target Legality | partial; duplicate same-name target choices are now disambiguated by controller/zone/ordinal in typed prompts and `/play` pickers |
| 2.10 Cost Payment Rules | partial; dynamic mana production now supports AmountRef-backed AddMana entries, a threshold-style zone count condition, and target-opponent hand-count mana for Jeska's Will, with regressions for Cabal Ritual, Rite of Flame, Songs of the Damned, and Jeska's Will replacing fixed shortcut mana amounts. Toxic Deluge now also carries non-mana X through the stack and pays X life as an additional cast cost before resolving -X/-X. |
| 2.11 Timing Permissions | partial; temporary exile play permissions are now persisted and included in cast/play-land/legal-action generation for this-turn effects such as Jeska's Will, and attacked-this-turn state now drives Chart a Course's discard condition through combat, turn reset, and save/load. Broader duration modeling is incomplete |
| 2.12 Modal And Optional Choices | partial; Brainstorm now has explicit hand-to-library-top ordering, Fact or Fiction has `/play` pile selection and no longer falls back to a deterministic pile when a required stack choice is missing, Ward has `/play` pay/decline choice handling, and parser-backed `choose one or both` modal spells now accept one-or-both mode selections through stack validation/authority/legal actions; broad modal/optional choice UI is still incomplete |
| 3.1 Priority Is Visible But Not Central | partial |
| 3.2 Stack Is Evented But Not Visually Dominant | partial |
| 3.3 Pass Priority Flow Is Compressed | partial; opponent-turn empty-priority action now says `Yield Until My Turn` instead of using the active-turn `Skip Rest of Turn` label. |
| 3.4 Stop Settings Are Incomplete Or Not Exposed Enough | partial | Hold priority and individual priority stops exist, and the game menu now has a Full control shortcut that enables hold priority plus all stops. This is still not a full Arena-equivalent stop system. |
| 4.1 Internal Step Labels Mismatch Visible UI | partial; Main 2 display handles the existing postcombat-main/end representation, and manual phase correction offers explicit user-facing step names |
| 4.2 Main Phase And Begin Combat Confusion | partial; manual phase correction can recover a stuck/incorrect step, but the underlying turn-manager model still needs a cleaner main-step representation |
| 4.3 AI Turn Compression | partial |
| 5.1 Action Text Is Improved But Still Tool-Like | partial |
| 5.2 Action Categories Are Coarse | partial |
| 5.3 No Unified Typed Prompt Surface | partial; `/play` now covers search, scry, surveil, sacrifice, library-top ordering, Fact-or-Fiction-style pile selection, Ward payment, and typed named-card choice prompts, but the prompt system is still not one fully generic typed request surface across every rule/action path |
| 6.1 Invalid Choices Are Not Hidden Or Disabled | partial; selected-card mulligans now keep the user in selection mode for repeated redraws, only switch to bottom selection after keep, and keep bottom cards clickable/visibly actionable, avoiding the previous premature bottom-choice lockout |
| 6.2 "Legal" Label Is Not Trustworthy | partial/test-proven; card/search picker badges and prompt reasons now use `Selectable` and `Unavailable` wording instead of a broad `Legal` claim, with helper tests and frontend build verification. |
| 6.3 Destination Labels Are Too Broad | partial/test-proven; picker destination chips now distinguish `To top of library`, `To bottom of library`, `To command zone`, and `Destination choice` instead of broad top/bottom/command wording. |
| 6.4 Hidden Information Is Not Communicated Cleanly | partial/test-proven; picker chips now distinguish `Reveal pick` from `Hidden pick` instead of relying on ambiguous/private wording. |
| 7.1 Auto-Pay Exists But Needs Trust Layer | partial; `/play` auto-pay now applies intrinsic spell cost reducers in its visible action/payment preview path as well as the engine transaction path, and engine legal-action generation now applies generic cost increasers for noncreature/opponent spell tax effects |
| 7.2 Floating Mana Handling | partial; dynamic AddMana amounts, targeted opponent hand-count mana, and parsed color-choice sacrifice artifacts now keep Cabal Ritual, Rite of Flame, Songs of the Damned, Jeska's Will, Lotus Petal, and Lion's Eye Diamond from using fixed/colorless shortcut pools. |
| 7.3 Special Mana Rules | partial; Lotus Petal and Lion's Eye Diamond now use `ActivateManaAbility` color choice parsing, and Lion's Eye Diamond discards hand plus sacrifices itself before adding the selected three mana. |
| 8.1 Combat Still Too Compressed | partial |
| 8.2 No Observed Blocker Assignment UI | partial/not fully browser-proven |
| 8.3 Attack Requirements And Restrictions | partial |
| 9.1 Zone-Change Identity | partial; manual zone moves clear stale attachments, and manual attach/detach now preserves explicit attachment identity |
| 9.2 Command Zone Rules | partial; manual commander-damage correction validates commander sources and feeds commander-damage loss checks, manual move correction now applies the default commander replacement so commander graveyard/exile/hand moves resolve to command zone, and the `/play` correction message reports the final resolved zone. |
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
| 12.3 AI Legality And Hidden Information | partial; AI ExileUntilNamed fallback uses only its own library/card names and the same authority dispatch source flag, but broad hidden-info-safe AI remains incomplete |
| 14.1 Need Golden Rule Tests | partial |
| 14.2 Need Replay Regression Harness | partial/test-proven; engine event-log replay auditing exists and `/play` saved games persist audit seeds plus authority-routed action/prompt records with a visible audit badge, but broad replay corpus/UI replay is still incomplete |
| 14.3 Need Unsupported-Card Surfacing | partial; room Engine Beta now has server-side deck preflight and UI surfacing for known unsupported cards, solo `/play` game starts now block hard unsupported cards with user-facing reasons, and parser coverage reports exist for syntax clusters; full unsupported taxonomy is still incomplete |

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

Additional named-card verification added after this audit: AI-sourced ExileUntilNamed casts can be auto-named through `dispatchAIAction(..., { autoNameMissingCardChoices: true })`, while `/play` human casts remain browser-proven through the typed NamedCard prompt for both known deck names and arbitrary custom names.

Additional Wheel verification added after this audit: Wheel of Fortune now has a regression that executes the override and proves each player discards their full hand before drawing seven.

Additional solo preflight verification added after this audit: `/play` now shares a hard unsupported-card preflight helper with tests for Chaos Orb, Falling Star, and Shahrazad-style failures before engine initialization.

Additional room moderation verification added after this audit: server-side room chat moderation now rejects common spaced/leetspeak sexual and harassment probes before they enter room history, while backend tests continue to verify safe MTG table phrases are accepted.

Additional guide-mode verification added after this audit: new-player guidance now filters likely infinite-combo activated abilities in addition to combo-looking spell casts, so those lines stay out of the lightweight first-game suggestion lane.

Additional action-layout verification added after this audit: Undo now lives in the top header controls, while phase movement remains in the lower dock near the hand/play area. This directly reduces lower action-dock crowding without moving turn progression back away from cards.

Additional save-slot verification added after this audit: engine-level autosave rotation now uses four autosave slots, matching the `/play` four-slot browser save surface and its existing save-slot UI tests.

Additional picker-wording verification added after this audit: card/search picker availability metadata and prompt reasons now say `Selectable`/`Unavailable` instead of `Legal`/`Illegal`, reducing overclaims when the picker is exposing a prompt filter rather than proving every global rules condition. Destination chips now distinguish top/bottom library movement and command-zone movement explicitly, and reveal metadata now says `Reveal pick` or `Hidden pick`.

Additional search-rule verification added after this audit: unrestricted tutor prompts now default to one required selection when the library contains a findable card, and a paired authority test confirms restricted hidden-library searches can still fail to find.

Additional type-filter verification added after this audit: `matchesCardFilter` and search prompt failure reasons now separate type-line type/supertype terms from subtype terms before matching, so fetch/tutor filters no longer rely on broad substring checks.

Additional shared type-line verification added after this audit: engine card import, prompt filter matching, Equipment detection, commander split handling, and frontend Cavern-style creature-type suggestions now share exact type/supertype/subtype parsing semantics, with targeted engine/frontend tests and both production builds passing.

Additional state/layer/protection exactness added after this audit: state-based legend rule checks, Aura/Equipment/Fortification attachment classification, Sisay-style legendary permanent color counting, cost-reduction subject matching, and protection source-type checks now use exact type-line parsing with focused regression tests.

Additional restricted-mana exactness added after this audit: Cavern-style creature-type mana now recognizes multi-word creature types such as Time Lord, and legendary-only restricted mana now checks the Legendary supertype instead of substring matching subtype text.

Additional mana-value filter verification added after this audit: generic library searches, targeted removal/bounce, target validation, legal-target generation, and static spell-cost modifiers now parse/enforce `with mana value` constraints as executable CMC filters, with focused parser/continuous/authority/legal-action tests and engine build verification.

Additional commander-zone verification added after this audit: manual move corrections now call commander replacement before mutation, so a commander moved toward graveyard/exile/hand by correction lands in command zone and the manual event reports the final command-zone destination. The `/play` manual correction message now reads from the resulting state so it says command zone instead of the requested graveyard/exile destination.

Additional priority-flow wording added after this audit: when the human has priority on someone else's turn and the stack is empty, the phase action is labelled `Yield Until My Turn`; the `Skip Rest of Turn` label is reserved for the human active player's turn.

Additional stack-choice and turn-state verification added after this audit: Jeska's Will now counts the chosen target opponent's hand for red mana and grants this-turn play permission to the exiled top three cards; Brainstorm supports explicit hand-to-library-top selection; Fact or Fiction supports `/play` pile selection from the revealed top cards and waits on the stack instead of choosing a deterministic pile when that required choice is missing; copy effects preserve copiable face/choice values while excluding damage/counters; Ward can be explicitly paid or declined from `/play`; parser-backed `choose one or both` modal spells accept one selected mode or both selected modes while rejecting empty/duplicate selections; and Chart a Course now uses attacked-this-turn state instead of an always-discard shortcut.

## Direct Answer

Yes, relative to the actual size and meaning of these markdown files, I was effectively treating large portions as direction/backlog while reporting progress too broadly. The right status is not "done." The right status is "a verified slice is done; most of the Arena/MTGA parity roadmap remains partial or incomplete."

Going forward, "done" must only be used against a specific checklist row with linked proof.
