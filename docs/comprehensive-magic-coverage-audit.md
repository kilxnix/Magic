# DeckReps Magic Coverage Audit

Total areas: 28

By status:
- certified: 0
- partial: 28
- gap: 0
- blocked: 0

By priority:
- P0: 19
- P1: 9

Open P0/P1 gaps:
- none

Missing evidence references:
- none

Area table:
| Priority | Status | Area | Next |
| --- | --- | --- | --- |
| P0 | partial | casting-costs | Expand alternative costs, additional costs, cost increasers/reducers, X choices, and free-spell casting prompts. |
| P0 | partial | combat | Expand multiplayer combat matrix with more mixed evasion, planeswalker/battle defenders, and UI combat certification. |
| P0 | partial | commander-rules | Add partner/background/doctor companion import and cast certification plus Drannith-style restrictions. |
| P0 | partial | continuous-effects-layers | Expand layer engine to full CR-style dependency/timestamp model beyond current practical layer 6/7 and devotion coverage. |
| P0 | partial | deck-import | Add importer golden corpus for real exported lists and bad-data cases. |
| P0 | partial | equipment-auras | Add UI certification for equip and illegal attachment SBAs. |
| P0 | partial | high-power-chaos-regression | Run long-mode chaos regularly and promote every found failure into a targeted regression. |
| P0 | partial | library-search-tutors | Replace deterministic tutor shortcuts with choice UI that supports named card, top-library, graveyard, exile, and battlefield destinations. |
| P0 | partial | mana-system | Add complete coverage for conditional lands, color choice UI, delayed/restricted mana, and mana replacement/multipliers. |
| P0 | partial | modal-choice-ui | Continue replacing deterministic shortcuts with the existing typed prompt lifecycle until modal, optional, naming, color/type, and random-choice flows all round-trip through request validation. |
| P0 | partial | oracle-parser-coverage | Use the generated syntax clusters to pick the next parser/executor fixtures and rerun npm run coverage:parser after every card-data refresh. |
| P0 | partial | replacement-prevention | Add affected-player ordering choices when multiple replacements apply and expand cannot-lose/win replacement fixtures. |
| P0 | partial | stack-responses | Certify responding to stack items in UI and broaden APNAP fixtures with replacement/choice prompts. |
| P0 | partial | state-based-actions | Add simultaneous win/loss ordering tests and expand SBA coverage for layer/removal dependencies. |
| P0 | partial | targeting | Add target revalidation on resolution, illegal target fizzles, target-changing effects, and multiplayer target selection UI. |
| P0 | partial | tokens | Add a token factory certification table and browser proof for Krenko, Talrand, Goblin Spymaster, Dockside-style counting, and token sacrifice. |
| P0 | partial | triggers-etb | Create a trigger matrix by event kind and add missing beginning/end step token triggers. |
| P0 | partial | turn-structure-priority | Add multiplayer APNAP priority fixtures and browser proof for skip rest of turn after stack/combat windows. |
| P0 | partial | ui-gameplay | Add browser automation certification for each starter deck and all action categories. |
| P1 | partial | ai-shelector | Add politics/threat benchmarks across more board archetypes and stack-heavy high-power states. |
| P1 | partial | graveyard-exile | Add zone permission engine for casting/activating from non-hand zones. |
| P1 | partial | keywords-evergreen | Audit every evergreen keyword and bind each to at least one fixture card. |
| P1 | partial | keywords-non-evergreen | Keep promoting unsupported mechanics from the tracker into engine-native implementation, starting with Adventure, Mutate, Foretell, Cascade/Discover, and dungeon progress. |
| P1 | partial | manual-correction-tools | Add replay-audited correction summaries and deeper correction review UX on top of the existing counter, token, zone, attachment, damage, mana, commander damage, and phase repair actions. |
| P1 | partial | manual-overrides | Fill specific owner/reason metadata for every legacy override and link each override to a regression fixture or parser-coverage cluster. |
| P1 | partial | multiplayer | Keep running long four-player chaos and hosted room UI proof while adding more high-power pod archetypes. |
| P1 | partial | post-game-review | Broaden authoritative review records into full line comparison, replay stepping, and rules-confidence versus strategy-confidence presentation. |
| P1 | partial | rules-update-process | Wire edge-case generation and coverage audit into a scheduled certification run after every card-data refresh. |
