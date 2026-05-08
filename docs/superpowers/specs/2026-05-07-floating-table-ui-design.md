# Floating Table UI Design

## Goal

Make the web PWA game board feel like a playable tabletop instead of a cramped dashboard, especially on laptop-width screens.

## Approved Direction

The default game view should prioritize the battlefield canvas. Permanent side rails should become floating controls or optional drawers. The player should be able to see both battlefields, the current turn state, available actions, and hand cards without the board feeling zoomed in.

## Layout

- The right `GameReview` rail becomes an overlay drawer opened from a floating Review button. It should no longer reserve 360-420px of width during normal play.
- The left commander rail becomes compact floating HUD chips. The existing commander/card details stay available through the board tiles and inspector modal.
- The phase/status row becomes a small floating top bar over the board, with priority, coach, and stack-land controls still reachable.
- Opponent hand and battlefield use a compact top region with shorter spacing and horizontally scrollable cards.
- Human battlefield uses the middle of the canvas and receives the most vertical space.
- Actions and hand become compact bottom docks. They can scroll horizontally and should not push the whole battlefield into a narrow center band.

## Interaction

- The existing review modal remains available. The embedded review panel should be hidden unless opened.
- Hand cards, actions, card inspector, mulligan, discard, tutor, undo, and coach mode keep their current behavior.
- The first pass does not add drag, zoom, resizing, or persisted layout preferences. Those can come after the offline work has a stable board.

## Verification

- Build must pass with `npm run build`.
- Existing Standard offline import/play tests must still pass.
- `/play` must still respond from the running dev server.
