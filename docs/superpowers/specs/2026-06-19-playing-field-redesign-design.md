# Playing Field Redesign — Design Spec

- **Date:** 2026-06-19
- **Status:** Approved design, pending spec review
- **Scope:** The in-browser Commander playtesting UI (`frontend/src/play/`), desktop + mobile. The marketing/generator **site** is a separate, later effort that will adopt the visual language established here.
- **Branch:** `game-reliability-refactor` (build proceeds behind a feature flag)

## 1. Goal

A ground-up reimagining of the playing field's **look and feel** — a bold, atmospheric, premium game table — without rewiring the game. The current UI works but feels amateur; we want it to feel like a real product. Two new capabilities are added as first-class pieces: an **explorable graveyard** (and other hidden-but-public zones) and a **universal floating card viewer**.

The engine is already cleanly decoupled from the UI through a view-model (`GameView`). This redesign swaps the **presentation layer** only. **No engine changes.**

## 2. Locked decisions (from brainstorming)

| Decision | Choice |
| --- | --- |
| Visual direction | **Artisan Table, deepened** — dark emerald felt, walnut frame, aged-leather panels, brass accents, warm aged-stock cards |
| Devices | **Desktop + mobile**, one shared visual language |
| Rollout | **Parallel build behind a feature flag** — new shells alongside old; instant A/B + rollback |
| Data layer | **Reuse** engine + `useCommanderEngine` + `engineAdapter` + `useGameView` + selectors + action callbacks |
| Foundation | Build the look as a **reusable theme + primitives layer**, not one-off styles, so the later site redesign inherits it |
| New features | **Zone explorer** (graveyard/command/library/exile, any player) + **universal card viewer** |

## 3. Visual design language

A single source of truth: a `playTheme` token module plus a Tailwind theme extension, so every new component reads the same values. The existing play background is already a dark-green radial gradient (`#15231e → #0d1714 → #080b0a`); we deepen and formalize it.

### 3.1 Color tokens

```
// Surfaces
felt-base       #14251c   // table felt (deep emerald)
felt-vignette   #080b0a   // outer darkening
frame-walnut    #26190d   // table edge / frame
panel-leather   #281c10   // opponent chips, phase bar, HUD, modals
panel-border    #5a4324   // leather hairline
panel-border-hi #7a5a2a   // brass-tinged border on raised modals

// Cards (aged stock)
card-stock      #e3d2a6
card-border     #9a824f
card-ink        #2a1f10   // text on card
card-badge-bd   #8a6f3f   // P/T badge border

// Accents
brass           #b8842c   // primary action, active pip
brass-deep      #9a6c1f
brass-on        #241804   // ink on brass fills
gold-label      #d8b86a   // zone labels, "your turn"
gold-bright     #ead6a4   // serif headings on dark
text-muted      #a88c5e   // subtitles on leather
ember           #cf6a52   // life total
oxblood         #8a2a1e   // danger / declare-attackers
combat-ring     #c79a45   // attacker/blocker outline

// Mana pips
W #ece0ba   U #2f5f86   B #241c14   R #9a3326   G #2f6b40
```

All game-surface colors are **explicit hex** (a designed surface that must not invert with OS dark mode), consistent with how `playView.layout.ts` already hardcodes the felt gradient.

### 3.2 Typography

- **Display serif — Cormorant Garamond:** card names, life totals, zone titles, turn number, primary buttons. Carries the "card game heritage" warmth.
- **Body sans — Inter:** counts, labels, oracle text, secondary UI.
- Loaded via the app's existing font pipeline (added to `tailwind.config.js` font families alongside the current Merriweather/Inter set).

### 3.3 Card & tile treatment

- Permanent tiles render as warm aged-stock cards: art band (the real `<CardImage>`), a serif name strip, and a P/T badge bottom-right.
- Tapped = rotate ~10° + reduced opacity (existing pattern).
- Attacking/blocking = brass combat ring (`combat-ring`) + a small sword glyph (preserves the existing `isAttacking`/`isBlocking` highlight semantics).
- Identical lands stack into one tile with a `stackCount` badge (existing `groupLands` behavior — preserved).

### 3.4 Motion (principles, not pixel specs)

Cards deal/slide onto the field; mana pips light as lands tap; the attacker lunges on declaration; the stack resolves top-down; P/T and life changes pulse (reuse `useValueFlash`). All motion respects `prefers-reduced-motion` (the app already has reduced-motion handling). Implemented with the existing Tailwind keyframes (`tile-in`, `fade-in`, `value-flash`) extended as needed.

## 4. Architecture

### 4.1 The seam we build on (unchanged)

```
engine (commander-engine)
  → useCommanderEngine + engineAdapter        // engine ↔ React, action dispatch
    → useGameView / buildGameView             // pure view-model: GameView
      → SHELLS (DesktopBattlefield / MobileTable)
        → presentational components
```

`buildGameView` "NEVER re-derives from raw engine state" — it reshapes the hook's already-derived outputs. The new UI consumes the **same `GameView`** and fires the **same callbacks**. Nothing below the shells changes.

### 4.2 View-model extensions (`gameView.types.ts` + `useGameView.ts`)

The only data-layer change. `GameView` today exposes zone **counts**; the explorer needs zone **contents**.

Add a lightweight zone-card type and zone-content fields:

```ts
// Minimal: image is by NAME (<CardImage name>), oracle text lives on the image.
export interface ZoneCardView {
  id: string;
  name: string;
  // legalActions present only where the zone affords actions to you
  // (e.g. flashback/escape from your graveyard); [] otherwise.
  legalActions: LegalAction[];
}

// YouView gains:
graveyard: ZoneCardView[];   // contents (existing graveyardCount stays for glance)
exile: ZoneCardView[];       // see §4.6 dependency
// library: contents stay hidden by default — existing libraryCount only.

// OpponentBoard gains:
graveyard: ZoneCardView[];   // public — explorable
exile: ZoneCardView[];       // public — see §4.6
// commandZone already present as PermanentView[]
```

`buildGameView` maps `gameState.humanGraveyard`, `gameState.aiGraveyards[id]`, and the command zones (already read for counts) into these lists. This is pure reshaping — no engine access.

### 4.3 Universal `CardView` (the floating viewer's input)

The viewer shows the real card image + live state. It does not need oracle text plumbed (it's on the image). It needs the live, engine-derived state for the selected object:

```ts
export interface CardView {
  id: string;
  name: string;
  zone: 'battlefield' | 'hand' | 'stack' | 'graveyard' | 'exile' | 'command';
  power?: number;          // current/modified
  toughness?: number;
  counters?: Record<string, number>;
  tapped?: boolean;
  statuses?: string[];     // e.g. "summoning sick", "attacking", "monarch" (best-effort from existing view data)
  legalActions: LegalAction[];
}
```

The viewer is opened with a `CardView` assembled from whichever view object was clicked (`PermanentView`, `HandCardView`, `StackItemView`, `ZoneCardView`). A small adapter builds `CardView` from each; no new engine queries.

### 4.4 Theme + primitives layer (new, reusable)

- `frontend/src/play/v2/theme.ts` — the tokens in §3.1–3.2 as TS constants + a Tailwind extension.
- `frontend/src/play/v2/primitives/` — themed building blocks reused across every component (and later the site):
  - `Panel` (leather surface), `CardFace` (aged-stock card frame), `Tile`, `Pip` (mana/counter dot), `Badge` (P/T, counts), `BrassButton`, `ZoneCounter`, `ModalShell` (board-anchored overlay container).

### 4.5 New themed components (consume `GameView`, fire existing callbacks)

A v2 set mirroring the current components, re-skinned and recomposed:

| Concern | v1 component | v2 component |
| --- | --- | --- |
| Your battlefield tile | `PermanentTile` | `v2/Tile` |
| Your board | `PlayerBoard` | `v2/PlayerBoard` |
| Your HUD | `YouHud` | `v2/YouHud` (+ zone counters) |
| Opponent glance | `OpponentCard` | `v2/OpponentRail` |
| Opponent board browse | `OpponentExplorer` | folded into `v2/ZoneExplorer` + opponent view |
| Hand | `HandView` | `v2/HandView` |
| Stack | `StackView` | `v2/StackView` |
| Priority controls | `PriorityStrip` | `v2/PriorityControls` |
| Phase track | `PhaseTrack` | `v2/PhaseTrack` |
| Narration | `NarrationFeed` | `v2/NarrationFeed` |
| Combat | `CombatFlow` | `v2/CombatFlow` |
| Targeting | `TargetingLayer` | `v2/TargetingLayer` |
| Card zoom | `CardDetailOverlay` / `CardHoverPreview` | `v2/CardViewer` (universal) |
| — (new) | — | `v2/ZoneExplorer` |
| Prompt modals (mulligan, discard, tutor, library, decision, etc.) | existing overlays | re-themed via `ModalShell`; logic reused unchanged |

### 4.6 New features

**Zone explorer (`v2/ZoneExplorer`).** A board-anchored modal listing the cards in a zone as a grid of aged-stock thumbnails, with:
- **Tabs** to switch zones for the focused player: Graveyard · Exile · Command (Library is count-only by default).
- **Per-player** — opens for you or any opponent (public zones). Replaces/absorbs the existing `OpponentExplorer`.
- Selecting a thumbnail opens it in the **card viewer** (right-hand panel on desktop, full-screen push on mobile).
- Affordances where legal: e.g. a graveyard card you can flashback/escape shows its action (sourced from `ZoneCardView.legalActions`).

**Universal card viewer (`v2/CardViewer`).** One component, opened for **any** card anywhere (hand, battlefield, stack, opponent board, a zone-explorer thumbnail). Shows the full `<CardImage>` + a live-state strip (modified P/T, counters, tapped/summoning-sick/combat statuses) + any legal actions for that object. Replaces the thin `CardDetailOverlay` and the hover preview with a single surface (hover-to-peek on desktop, tap-to-open on mobile).

**Exile dependency.** Exile contents are **not** on `SimpleGameState` today (`buildGameView` hardcodes `exileCount: 0`). Surfacing exile-explore requires adding exile zones to the hook's `SimpleGameState` projection (`humanExile` / `aiExiles`). This is a small, contained upstream addition in `useShelectorGame`/the hook layer — the one non-`play/` touch. Until/unless done, the Exile tab shows count-only. Graveyard and Command explore ship without it.

### 4.7 Shells + feature flag

- New shells `v2/shells/DesktopBattlefield` and `v2/shells/MobileTable` compose the v2 components, reusing `DESKTOP_BATTLEFIELD_LAYOUT` / `MOBILE_TABLE_LAYOUT` (or v2 variants that preserve the same invariants).
- `PlayExperience.tsx` selects the shell **set** from a flag, then picks desktop/mobile by viewport as today.
- **Flag:** `PLAY_UI_V2`, resolved from (in order) URL query `?ui=v2`, `localStorage['mb.play.ui'] === 'v2'`, else default **off**. A small dev toggle in the play UI flips it for easy side-by-side comparison.

### 4.8 Layout invariants (preserved — non-negotiable)

`playView.layout.ts` documents the bug class this rebuild already killed; the v2 shells **must** keep it:
- **Nothing is `position:fixed`.** No absolute full-screen overlay over the board.
- The board lives in a `relative isolate` container; **all overlays** (targeting, combat, zone explorer, card viewer) anchor to that container via `absolute inset-0`, never the viewport.
- Every region carries an `svh` cap; content scrolls **within** its region. The board scales-to-fit (`FitToBox`) and never scrolls.
- Mobile is one in-flow vertical flex column (top strip · board · decision sheet · hand); docks pile **below** the board, never over its tiles.

The mockups used a faux-viewport for illustration; the real explorer/viewer modals are **board-anchored**, not fixed.

## 5. Data & state flow

Unchanged. Player actions still dispatch through the existing `useCommanderEngine` callbacks (`playLandAction`, `castSpellAction`, `declareAttacker`/`confirmAttackers`, `declareBlocker`/`confirmBlockers`, `passPriorityAction`, `activateAbility`, targeting confirm, prompt resolvers). v2 components receive props and fire these callbacks exactly as v1 does. The `prompts` bag (`PlayPrompts`) is threaded into v2 prompt modals untouched.

## 6. Testing strategy

- **View-model:** unit-test the new `buildGameView` zone-content mapping and the `CardView` adapters with `buildGameView` directly (the existing test entry point) — no React.
- **Components:** v2 components are presentational; snapshot + interaction tests in isolation with fixture `GameView`s.
- **Layout invariant guard:** assert no `position:fixed` and that overlays are board-anchored (extend the existing layout regression guard).
- **Parity:** because the flag defaults off and the data layer is shared, v1 remains the untouched fallback; a regression in v2 cannot reach the default experience.

## 7. Rollout plan

1. Theme + primitives layer.
2. View-model extensions (zone contents, `CardView`) + tests.
3. v2 components, bottom-up (Tile → board → rails → stack/priority → overlays).
4. `ZoneExplorer` + universal `CardViewer`.
5. v2 shells (desktop, then mobile) + flag wiring in `PlayExperience`.
6. (Optional) exile surfacing in the hook to light up the Exile tab.
7. A/B against v1 via the toggle; promote default to v2 when satisfied; retire v1 later.

## 8. Out of scope

- The marketing/generator **site** redesign (separate effort; inherits this theme + primitives).
- Any **engine** rules/logic change.
- New **gameplay** features beyond zone-explore + card-viewer.
- Multiplayer-specific UI beyond what shares the play components.

## 9. Risks & open questions

- **Exile plumbing** (§4.6) is the only change outside `play/`; if we want the Exile tab fully live it must land. Otherwise it's count-only — acceptable for v1.
- **`statuses` richness** on `CardView` is best-effort from existing view data; deeper status text (e.g. granted keywords) may need extra view-model fields later.
- **Font loading** adds Cormorant Garamond; confirm it fits the existing font pipeline/perf budget.
- **Promote-to-default timing** — when does v2 become the default and v1 get deleted? (Post-A/B, user's call.)

## 10. Success criteria

- New playing field renders the live engine state at full fidelity (parity with v1's information) in the deepened Artisan Table look, on desktop and mobile.
- Graveyard (and command) are explorable for any player; exile at least count-visible.
- Any card, anywhere, opens the universal viewer with live state.
- Layout invariants hold (no fixed overlays, no board scrolling, fit-to-screen).
- Flag-gated; v1 remains an instant fallback; no regression to the default experience.
