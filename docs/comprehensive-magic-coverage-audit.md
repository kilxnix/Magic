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
- none currently tracked as a full gap; all remaining areas are partial coverage work.

Missing evidence references:
- none

Area table:
| Priority | Status | Area | Next |
| --- | --- | --- | --- |
| P0 | partial | modal-choice-ui | Typed ChooseMode prompts validate mode responses, modal action labels expose selected mode text, scry/surveil/search prompts use engine request validation, and Brainstorm now pauses for a prompt-backed hand-to-library-top choice; continue replacing deterministic card-specific shortcuts with prompt-backed choices. |
| P0 | partial | casting-costs | Expand alternative costs, additional costs, cost increasers/reducers, X choices, and free-spell casting prompts. |
| P0 | partial | combat | Add browser combat certification for all starter decks plus multiplayer attack/block assignment. |
| P0 | partial | commander-rules | Manual commander-damage correction now validates commander sources and feeds commander-damage loss checks; add partner/background/doctor companion import and cast certification plus Drannith-style restrictions. |
| P0 | partial | continuous-effects-layers | Expand layer engine to full CR-style dependency/timestamp model beyond current practical layer 6/7 and devotion coverage. |
| P0 | partial | deck-import | Add importer golden corpus for real exported lists and bad-data cases. |
| P0 | partial | equipment-auras | Manual attach/detach correction now flows through validated engine actions and the card inspector; add UI certification for equip, Aura legality, and illegal attachment SBAs. |
| P0 | partial | high-power-chaos-regression | Run long-mode chaos regularly and promote every found failure into a targeted regression. |
| P0 | partial | library-search-tutors | Top-library look effects now support limited top-N prompts with unselected looked-at cards moved to bottom for Impulse-style effects; continue replacing deterministic tutor shortcuts with choice UI that supports named card, top-library, graveyard, exile, and battlefield destinations. |
| P0 | partial | mana-system | Add complete coverage for conditional lands, color choice UI, delayed/restricted mana, and mana replacement/multipliers. |
| P0 | partial | oracle-parser-coverage | Run parser coverage against full card database and classify unsupported syntax clusters. |
| P0 | partial | replacement-prevention | Add affected-player ordering choices when multiple replacements apply and expand cannot-lose/win replacement fixtures. |
| P0 | partial | stack-responses | Certify responding to stack items in UI and add APNAP trigger ordering fixtures. |
| P0 | partial | state-based-actions | Add simultaneous win/loss ordering tests and expand SBA coverage for layer/removal dependencies. |
| P0 | partial | targeting | Add target revalidation on resolution, illegal target fizzles, target-changing effects, and multiplayer target selection UI. |
| P0 | partial | tokens | Add a token factory certification table and browser proof for Krenko, Talrand, Goblin Spymaster, Dockside-style counting, and token sacrifice. |
| P0 | partial | triggers-etb | Create a trigger matrix by event kind and add missing beginning/end step token triggers. |
| P0 | partial | turn-structure-priority | Manual turn/phase correction now flows through validated engine actions, resets priority to the chosen active player, clears stale combat when leaving combat, and is exposed in the playfield menu; add multiplayer APNAP priority fixtures and browser proof for skip rest of turn after stack/combat windows. |
| P0 | partial | ui-gameplay | D20 rolls now persist as public engine state, emit authoritative DiceRolled events, and appear as a disappearing playfield toast; add browser automation certification for each starter deck and all action categories. |
| P1 | partial | keywords-non-evergreen | Prowess now registers as a real noncreature-spell trigger with temporary +1/+1 cleanup; continue the mechanic-by-mechanic implementation list for other popular Commander mechanics. |
| P1 | partial | post-game-review | Decision reviews now audit selected actions through the engine authority boundary and are attached to authoritative state updates; continue broadening line comparison and replay presentation. |
| P1 | partial | ai-shelector | Add speed and legality benchmark across archetypes and stack-heavy high-power states. |
| P1 | partial | graveyard-exile | Add zone permission engine for casting/activating from non-hand zones. |
| P1 | partial | keywords-evergreen | Audit every evergreen keyword and bind each to at least one fixture card. |
| P1 | partial | manual-correction-tools | Manual repair tools now cover permanent counters, player counters/poison, commander damage, token creation, zone movement, marked damage, mana untap, attach/detach corrections, and validated turn/phase correction; continue adding replay-audited correction summaries and deeper correction review UX. |
| P1 | partial | manual-overrides | Add override registry metadata with reason, owner, and fixture card. |
| P1 | partial | multiplayer | Bridge rooms to authoritative engine sessions and add four-player combat/priority browser proof. |
| P1 | partial | rules-update-process | Wire edge-case generation and coverage audit into a scheduled certification run after every card-data refresh. |
