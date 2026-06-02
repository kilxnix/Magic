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
| BCL-007 | Narrow playfield action layout | Open | Live browser-extension Xenagos rep after mulligan showed the standalone Complex Turn Overview visually crowding the bottom action/phase area. | Live extension retest after layout fix showing mulligan to main phase without overlapping overview/action controls. |

## Closed Items

| ID | Area | Closed By | Proof |
| --- | --- | --- | --- |
| BCL-000 | Baseline deploy state | `acea2d3` | `https://deckreps.app/api/health` healthy; deployed marker `acea2d3`; live 1v1v1v1 browser run took 33 actions with no visible warnings. |
