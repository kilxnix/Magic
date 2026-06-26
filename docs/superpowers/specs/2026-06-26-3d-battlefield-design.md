# 3D Battlefield (Three.js / WebGL Play Shell) — Design

**Date:** 2026-06-26
**Status:** Approved for planning
**Author:** brainstormed with Claude

## Summary

Add a true volumetric 3D play experience — a perspective, first-person-seat
battlefield rendered with WebGL — as a new opt-in **shell** for the existing
Commander game. It consumes the same `GameView` view-model and callback bag
every current 2D shell uses, so **the rules engine is not touched**. Ships
behind a `?ui=3d` flag alongside the existing 2D UIs, with the 2D shell as the
fallback. Starts as a 1v1 vertical slice and grows toward feature parity.

## Goals

- A genuine 3D-depth playing field: perspective camera, real Z-axis, cards as
  solid objects with thickness that lift, tap-rotate, and travel through space
  between zones. **Not** a flat board faked with a 2D tilt.
- "Arena-like" feel: cinematic camera, lighting + shadows, depth-of-field,
  spell/combat particle effects, smooth zone-change animation.
- First-person seat camera looking across the table; swing to focus an opponent.
- Stylized 3D card frames on the battlefield (name / mana / P-T / art inset);
  full high-res card face on tap/inspect.
- Scales responsively from phone to wide desktop from a single canvas.
- Zero changes to the engine; reuse the existing action/prompt plumbing.

## Non-Goals

- No photoreal paper-card simulation on the battlefield (stylized frames, like
  Arena itself). Full art is shown only on inspect/zoom.
- No reimplementation of HUD or modals inside WebGL — text-heavy UI stays as DOM
  overlaid on the canvas.
- No engine, rules, or AI changes.
- Milestone 1 does not require 4-player rendering or full prompt parity (see
  Milestones).

## Context: the seam this builds on

The play layer is already a clean *reactive view-model → presentational shell*
pattern:

- `frontend/src/play/gameView.types.ts` — `GameView`, the pure view-model the UI
  renders from (your board, opponents, stack, priority, targeting, combat,
  narration). Every card-bearing object already carries its `legalActions`.
- `frontend/src/play/PlayExperience.tsx` — builds a `shellProps` bag (`view` plus
  the flat callback bag: `onAction`, `onExamine`, `onPass`, `onToggleTarget`,
  `onConfirmTarget`, `onAssignCombat`, `onConfirmCombat`, `onSelectDefender`,
  etc.) and selects a shell. Existing shells: `DesktopBattlefield(V2)`,
  `MobileTable(V2)`, chosen by viewport + the `?ui=v2` flag
  (`frontend/src/play/v2/uiFlag.ts`).
- All prompt modals (mulligan, tutor, library/scry, decision, reorder, discard,
  card detail, game-over) are already rendered by `PlayExperience` as DOM
  portals *above* whichever shell is active.

The 3D field is **a third shell**. It receives the identical `shellProps`. The
modals continue to render above it unchanged.

## Rendering stack

**React Three Fiber (R3F) + drei + @react-three/postprocessing.**

Rationale: the codebase is React + TypeScript and the play layer is already
declarative-reactive. R3F lets the scene be driven by `GameView` the same way the
DOM shells are; raw imperative Three.js would mean hand-writing the
React-state ↔ scene-graph bridge (the bug-prone part). drei provides camera
controls, loaders, and instancing; postprocessing provides bloom/glow for the
Arena look.

**Hard rule:** HUD and every modal stay as DOM on top of the `<Canvas>`. Reuse
existing v2 primitives (`YouHudV2`, `PhaseTrackV2`, priority controls, narration
feed) and the existing modal portals. WebGL renders the *table*; DOM renders the
*controls*.

## Architecture

### Plug-in point

- New shell: `frontend/src/play/r3f/ThreeBattlefield.tsx`, a drop-in peer of
  `DesktopBattlefieldV2`, taking the same `shellProps`.
- Extend the flag layer (`uiFlag.ts` or a sibling) so `?ui=3d` selects
  `ThreeBattlefield` for **both** desktop and mobile (one responsive canvas; the
  camera adapts to viewport rather than swapping to a separate mobile shell).
- A WebGL capability check and `prefers-reduced-motion` check fall back to the v2
  2D shell when 3D is unavailable or undesired.

### Scene graph

- `<TableScene>` — lights, environment, table/playmat mesh, postprocessing chain.
- `<CameraRig>` — constrained perspective camera at the player's seat; a
  "focus opponent" action animates a swing to face a chosen opponent and back.
- `<Seat>` (you + each opponent) — a local coordinate frame, rotated to face
  table center, laying out zone rows (lands / creatures / artifacts+enchantments
  / command). Opponents are physically further back across the table.
- `<CardMesh>` — a card with thickness: stylized frame texture (name / mana /
  P-T) drawn to an offscreen canvas, cached by a signature; small art inset
  lazily loaded + downscaled via the existing `/api/card-image/{name}` proxy.
  Handles lift-on-hover, tap-rotate-90° (tap), flip, shadow casting.
- `<HandDock>` — your hand fanned near the camera in the foreground.
- Zone piles (graveyard / exile / library / command) as small counted 3D stacks.
- `<StackTower>` — the spell stack rising vertically off the table.

### Driving the scene from `GameView`

Each render, diff the incoming `GameView` against the previous one:

- Card changed zone → it **glides** (arcs) from its old world slot to the new one
  (lerp in `useFrame`, or react-spring-three).
- Card became tapped/untapped → rotate.
- New permanent → drop-in; permanent left battlefield → fade/sink.
- Spell resolution and combat read from `view.narration` and `view.combat` to
  trigger slides (attackers moving toward defenders) and particle bursts.

The diff/layout logic is **pure** (no WebGL) so it is unit-testable.

### Interaction → callbacks

Raycast a mesh → `mesh.userData.id` → the `legalActions` already attached to that
`PermanentView` / `HandCardView` → invoke the **same** callbacks from
`shellProps` (`onAction`, `onToggleTarget`, `onConfirmTarget`, `onAssignCombat`,
`onConfirmCombat`, `onSelectDefender`, `onExamine`). Targeting highlights the
`view.targeting.legalTargetIds` meshes; combat taps attackers (glow) then a
defender. No new action path is introduced.

## Depth as a first-class requirement

- Perspective camera (not orthographic): real vanishing-point depth; the table
  recedes into the distance.
- True Z-axis world space: foreground (your board) → table surface → opponents
  further back.
- Cards are solid (thickness), cast shadows, lift off the mat toward the camera,
  and travel through 3D space between zones.
- Depth cues: lighting + shadows, depth-of-field (distant opponents softly
  defocused), parallax on camera swing, vertical stack tower.

## Performance / mobile scaling

- Stylized frames = small, atlasable textures; instancing for identical
  lands/tokens.
- Clamp device pixel ratio (≤2, lower on phones).
- `frameloop="demand"` — render only on state change or while an animation is in
  flight; pause on hidden tab.
- drei `PerformanceMonitor` to auto-drop shadows/postprocessing when FPS sags.
- LOD for distant opponents; capped concurrent art-inset texture loads.
- Responsive camera FOV/distance keyed to viewport width.

## Error handling / fallback

- WebGL context-loss → toast + fall back to the 2D shell.
- Failed art-inset load → frame renders without the inset (graceful).
- `prefers-reduced-motion` → animations minimized or skipped.
- No WebGL support → 2D shell, transparently.

## Testing strategy

Match the codebase's "test the pure seams" convention:

- **Pure unit tests (no WebGL):** seat/zone layout math; the `GameView`→scene
  diff (what entered / left / moved); card-frame texture signature & cache;
  mesh-id → legal-action mapping.
- **Scene graph:** `react-three-test-renderer` — assert N permanents produce N
  card meshes with correct `userData` ids, correct seat placement, etc.
- **DOM overlay:** existing testing-library for HUD + modals over the canvas.
- WebGL pixel output is **not** tested in CI.

## Milestones

**Milestone 1 — vertical slice (this spec's plan target):**
1v1, first-person seat, stylized cards, your board + the opponent's board
rendered from `GameView`, core actions (play land / cast / pass / attack /
block), HUD overlay reusing v2 primitives, zone-change glide animation, WebGL
fallback to 2D.

**Later milestones:**
- 4-seat multiplayer table + camera swing-to-focus.
- Spell/combat particle effects & polish pass.
- Full prompt/modal parity in the 3D context.
- Effects/lighting/depth-of-field refinement.

## Open questions

- None blocking Milestone 1. Texture-atlas vs per-card-canvas frame generation
  can be decided during implementation based on measured mobile performance.
