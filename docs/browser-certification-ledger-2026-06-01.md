# Browser Certification Ledger - 2026-06-01

Scope for this ledger:

- Live `/play` browser-extension certification on `https://deckreps.app`.
- Starter decks.
- User-provided Archidekt decks:
  - `storms-typhoon`
  - `league-of-legendaries`
  - `ff-recursion`
  - `birbs`
- 1v1 practice and 1v1v1v1 Shelector practice.

Completion rule:

- An item is closed only after the bug is fixed, pushed, deployed to the VPS, and re-proven through the live browser/UI path or an explicit engine regression plus live session proof.
- A deck is not considered fully certified merely because sampled actions passed. It is certified only when every known card/action/prompt gap in that deck is closed or explicitly marked unsupported before game start.

## Open Items

| ID | Area | Status | Reproduction | Required Close Proof |
| --- | --- | --- | --- | --- |
| BCL-001 | Per-card UI certification | Open | Current live runs drive sessions but do not force every card in each target deck through every printed action/trigger/prompt. | Browser-extension or browser-automation certification that records every card in scope as covered, unsupported-before-start, or fixed. |
| BCL-002 | Scry/surveil/modal/tutor/replacement prompts | Open | Broad prompt classes are not exhaustively proven through live `/play`. | Prompt matrix with live UI proof and regression tests for any failure. |
| BCL-005 | Real room engine mode | Open | 4-human-context real engine room proof is not complete. | Four-context room run proving scoped views, priority, stack, reload, and action sync. |
| BCL-006 | Save/replay canonicality | Open | `/play` save slots still contain UI metadata around canonical engine saves and can show replay audit warnings. | SaveManager-primary slot round-trip with replay audit clean for a long complex session. |

## Closed Items

| ID | Area | Closed By | Proof |
| --- | --- | --- | --- |
| BCL-000 | Baseline deploy state | `acea2d3` | `https://deckreps.app/api/health` healthy; deployed marker `acea2d3`; live 1v1v1v1 browser run took 33 actions with no visible warnings. |
| BCL-007 | Narrow playfield action layout | `e710368` | Live browser-extension Xenagos retest completed selected-card mulligan, bottom-card selection, and returned to main phase without the standalone overview crowding the action/phase/hand controls. |
| BCL-008 | Fetched shockland replacement choice | `d445a3e` | Live browser-extension `?qa=land-entry-fetch` retest: Stomping Ground pay-life branch resolved 40 -> 38; Scalding Tarn search showed legal Steam Vents/Island and blocked Arcane Signet/Forest; selecting Steam Vents opened `Steam Vents: enter untapped?`; Pay 2 life resolved to LP 35 with Steam Vents untapped and U/R mana actions visible. |
| BCL-009 | Sisay activation prompt | `933c25c` | Live browser-extension `?qa=sisay-raw-lands` retest: Sisay was 4/4 with Mahadi; Mahadi did not appear as a mana source; tapping Temple Garden/Rejuvenating Springs/Undergrowth Stadium/Stomping Ground/Steam Vents for WUBRG generated `Activate Sisay, Weatherlight Captain`; activation opened a search with Yoshimaru legal and Jodah blocked because MV 5 is not less than source power 4; picking Yoshimaru moved it library -> battlefield and Sisay updated to 5/5 without no-op. |
| BCL-010 | Declare blockers control availability | `933c25c` | Live browser-extension `?qa=declare-blockers` retest: Declare Blockers state showed `No blocks` and `Block with 1 creature(s)` controls despite opponent combat context; clicking `Block with 1 creature(s)` assigned the block and advanced to the next main-phase action surface without a no-op. |
| BCL-011 | Abrade modal choice branches | `933c25c` | Live browser-extension `?qa=modal-choice` retest: damage branch cast Abrade targeting Grizzly Bears, resolved with stack 1 -> 0 and Grizzly Bears leaving battlefield; artifact branch cast Abrade targeting Sol Ring, resolved with Sol Ring leaving battlefield while Grizzly Bears remained. No no-op occurred. |
| BCL-012 | Scry and surveil library manipulation prompts | `7d3e83d` | Live browser-extension `?qa=library-manipulation` retest: Opt cast and opened `Scry 1`; moving Lightning Bolt to bottom made Opt draw Island; Consider cast and opened `Surveil 1`; moving Mountain to graveyard made Consider draw Forest and left graveyard count at 3. No no-op occurred. |
| BCL-003 | Storm/copy/spell-trigger stack certification | `811c18a` | Engine regression passed for `vivi-tournament-playtest` and stack copy invariants. Live browser-extension `?qa=storm-grapeshot` retest: Grapeshot branch preview changed from invariant failure to stack +3, target selection resolved, and opponent life changed 40 -> 37. Live browser-extension `?qa=spell-copy` retest: Fork targeting Lightning Bolt resolved and opponent life changed 40 -> 34. Live browser-extension `?qa=magecraft-triggers` retest: casting Opt opened six ordered magecraft triggers from Archmage Emeritus, Storm-Kiln Artist, and Veyran doubling; confirming order produced two stacked Treasure tokens, doubled card draw, Veyran 4/4, and Opt resolved off the stack after scry. |
| BCL-004 | Complex combat certification | `2daa595` | Frontend QA scenario regression passed for a 4-player combat state with three attackers, three defenders, a multi-blocked trampling commander, an unblocked double-strike/lifelink attacker, and a deathtouch/trample attacker. Live browser-extension `?qa=complex-combat` retest: `Skip Rest of Turn` opened the combat damage assignment modal for Trampling Commander with Bear Blocker lethal 2 and Wall Blocker lethal 4; confirming damage order resolved combat to human life 44, opponents at 39/36/38, opponent graveyard 2, human graveyard 1, and postcombat main without a no-op. |
