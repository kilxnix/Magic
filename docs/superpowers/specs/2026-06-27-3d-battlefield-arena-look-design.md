# 3D Battlefield — "Arena Look" Visual Pass — Design

**Date:** 2026-06-27
**Status:** Approved for planning
**Author:** brainstormed with Claude
**Builds on:** `2026-06-26-3d-battlefield-design.md` (Milestone 1 vertical slice)

## Summary

Milestone 1 shipped a working 3D WebGL battlefield (`?ui=3d`) but with
deliberately minimal visuals: a near-black table and flat solid-color card
boxes with no text. This pass pulls forward the "Arena-like" visual items the
Milestone-1 plan explicitly deferred, turning the prototype into a polished,
legible 3D board. **No engine changes**; the scene is still driven entirely by
the existing `GameView`.

## Goals

- **Readable stylized card frames** on the battlefield: card name, mana pips,
  power/toughness, color-identity frame tint, type styling, and a **card-art
  inset** (loaded by name via the existing same-origin image proxy, with a
  graceful tinted-panel fallback offline).
- **Cinematic lighting**: 3-point lighting (hemisphere + warm key with soft
  shadows + cool rim/fill), ACES filmic tone mapping, subtle bloom glow.
- **A real playmat** instead of a near-black plane.
- Keep it **fully offline-capable**: no CDN HDR/fonts/textures. Frames and
  playmat are drawn to offscreen canvases with system fonts; art insets use the
  existing `/api/card-image/{name}` proxy and degrade gracefully.

## Non-Goals

- No engine/rules/AI changes.
- No 4-seat-specific layout work, camera swing-to-focus, or DOF — those remain
  later-milestone items. (The scene already renders N opponents from `GameView`;
  this pass only changes *how cards and the table look*, not the layout math.)
- No new interaction paths; hover/tap/targeting wiring is unchanged.
- Not photoreal — stylized Arena-style frames, art shown as a small inset on the
  frame plus the existing full-card DOM viewer on tap.

## Context: what data the scene actually has

`PermanentView` (battlefield) currently exposes `name`, `power`, `toughness`,
`counters`, `isLand`, `isCreature`, `isAttacking`, `isBlocking`, `stackCount` —
but **not** mana cost, colors, or type line. The underlying `SimpleCard`
(`useShelectorGame`) already carries `manaCost`, `typeLine`, `cardTypes`,
`isCommander`, `isToken`. Art is resolved **by name** via `/api/card-image`
(there is no image URI on the view).

So a small, clean view-model extension is required: forward `manaCost` (and a
derived color identity) from `SimpleCard` → `PermanentView` → `Placement`. Color
identity is derived by parsing mana symbols out of `manaCost` (W/U/B/R/G); no
new engine field is needed.

## Architecture

All work lives in `frontend/src/play/r3f/` plus a small forward-through in the
view-model (`gameView.types.ts`, `useGameView.ts`, `placements.ts`).

### 1. View-model forward-through (pure)
- `PermanentView` gains `manaCost?: string` and `colorIdentity?: string[]`
  (derived). `toPermanentView` populates them from the `SimpleCard`.
- `Placement` gains `manaCost?`, `colorIdentity?`, `typeKind`
  (`creature | land | artifact | enchantment | planeswalker | other`),
  `isCommander?`, `isToken?`. `buildPlacements` threads them through.
- A pure `colorIdentityFromManaCost(manaCost): string[]` helper (unit-tested).

### 2. Card frame generation — `cardFrame.ts` (extends existing seam)
- Add pure `frameSpec(placement): FrameSpec` deriving everything the drawer
  needs: `{ name, tint, manaPips: string[], pt: string | null, typeKind,
  isCommander, isToken, counterText }`. **This is the unit-tested seam.**
- `frameSignature` is extended to include `manaCost` + `typeKind` so visually
  distinct cards get distinct cached textures (identical cards still share one).
- A `drawFrame(spec, ctx)` paints to a 2D canvas: tinted frame border by
  color identity, name banner (truncated), mana pips top-right, P/T badge
  bottom-right, type accent, commander/token/counter accents, and a reserved
  **art-inset region**. Returns a `CanvasTexture`. (Pixel output not CI-tested.)
- A small **art loader** fetches `/api/card-image/{name}`, draws it into the
  inset region and re-flags the texture for upload; on error it leaves the
  tinted panel (graceful fallback). Concurrent loads are capped.

### 3. `CardMesh.tsx`
- Apply the frame `CanvasTexture` to the card's face; keep the box thickness and
  give the edges/back the frame's border tint. Hover/targeting adds an
  **emissive** highlight (which bloom picks up) plus the existing lift.
- Frame textures come from a `createFrameCache` instance so identical permanents
  share one texture; the cache lives at the scene level.

### 4. `BattlefieldScene.tsx`
- Replace `ambientLight(0.6) + 1 directional` with: low ambient + a
  `hemisphereLight` (sky/ground) + a warm key `directionalLight` casting soft
  shadows + a cool rim/fill light.
- Replace the `#1c1917` plane with a **playmat** mesh textured from a
  canvas-drawn radial gradient (dark green felt, brighter center "spotlight,"
  vignette, faint seat-zone rings). Receives shadows.

### 5. `ThreeBattlefield.tsx`
- `<Canvas gl={{ toneMapping: ACESFilmicToneMapping }}>` with tuned exposure;
  optionally lower the camera a touch for a more cinematic seat angle.
- Add `<EffectComposer><Bloom/></EffectComposer>` from
  `@react-three/postprocessing` (**new dependency**) — a subtle glow, gentle
  threshold/intensity, perf-guarded. Compatible with `frameloop="demand"`.

## Performance / offline

- Frame textures cached by signature; art-inset loads capped and lazy; DPR still
  clamped `[1,2]`; `frameloop="demand"` retained (bloom renders on invalidate).
- Zero external network for the look itself: all canvas-drawn. Art insets are the
  only network use and are same-origin + optional.

## Error handling / fallback

- Art image 404 / offline / decode error → tinted art panel (no inset). Never
  blocks the frame.
- Bloom/postprocessing kept subtle; if it ever costs too much, it is the first
  thing to drop (single `<Bloom/>` toggle).
- WebGL-unavailable fallback to the 2D shell is unchanged.

## Testing strategy

Per the codebase's "test the pure seams" convention:
- **Pure unit tests:** `colorIdentityFromManaCost`; `frameSpec` (mana pips, color
  tint, creature P/T, land/artifact/enchantment kinds, commander/token);
  extended `frameSignature` (distinct by manaCost/type); the `manaCost`/identity
  threading in `toPermanentView` + `buildPlacements`.
- **Scene graph:** existing test-renderer mount tests stay green (N permanents →
  N meshes with correct ids).
- **Visual output:** validated by the manual screenshot smoke loop with the
  backend running for art; **WebGL pixel output is not CI-tested** (per the
  original spec).

## Open questions

- None blocking. Exact palette/exposure/bloom values are tuned during the
  screenshot iteration loop.
