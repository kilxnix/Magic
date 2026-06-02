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
| BCL-003 | Storm/copy/spell-trigger stack certification | Open | Vivi/Quandrix-style spell-copy and trigger multiplication not fully certified through UI. | Live UI scenario plus engine tests for copied spell triggers, storm count, and trigger multiplication. |
| BCL-004 | Complex combat certification | Open | Multi-blocker, trample/deathtouch/double strike, and multi-opponent assignment not fully certified through UI. | Live or deterministic UI scenario plus engine regression coverage. |
| BCL-005 | Real room engine mode | Open | 4-human-context real engine room proof is not complete. | Four-context room run proving scoped views, priority, stack, reload, and action sync. |
| BCL-006 | Save/replay canonicality | Open | `/play` save slots still contain UI metadata around canonical engine saves and can show replay audit warnings. | SaveManager-primary slot round-trip with replay audit clean for a long complex session. |

## Closed Items

| ID | Area | Closed By | Proof |
| --- | --- | --- | --- |
| BCL-000 | Baseline deploy state | `acea2d3` | `https://deckreps.app/api/health` healthy; deployed marker `acea2d3`; live 1v1v1v1 browser run took 33 actions with no visible warnings. |
| BCL-007 | Narrow playfield action layout | `e710368` | Live browser-extension Xenagos retest completed selected-card mulligan, bottom-card selection, and returned to main phase without the standalone overview crowding the action/phase/hand controls. |
| BCL-008 | Fetched shockland replacement choice | `d445a3e` | Live browser-extension `?qa=land-entry-fetch` retest: Stomping Ground pay-life branch resolved 40 -> 38; Scalding Tarn search showed legal Steam Vents/Island and blocked Arcane Signet/Forest; selecting Steam Vents opened `Steam Vents: enter untapped?`; Pay 2 life resolved to LP 35 with Steam Vents untapped and U/R mana actions visible. |
