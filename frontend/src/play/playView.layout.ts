// ============================================================================
// playView.layout.ts — layout class constants for the play-UI rebuild shells.
//
// Mirrors frontend/src/lib/gameBoardLayout.ts (the old FLOATING_TABLE_LAYOUT):
// every dock/rail max-height carries a viewport (svh) cap so high browser zoom
// (rem inflation) can't grow a region past the screen and overlap its neighbors
// — content scrolls WITHIN the capped region instead of spilling over the board.
//
// CRITICAL (the bug class this rebuild kills): NOTHING here is position:fixed
// and nothing is an absolute full-screen overlay over the board. The desktop
// battlefield is a real CSS grid of persistent, in-flow rails + a center board
// column; feeds live in side rails, the hand in a bottom rail. Overlays that DO
// stack on the board (targeting / combat / opponent explorer) are anchored to a
// `relative` board container — never to the viewport.
// ============================================================================

import type { GameView } from './gameView.types';

export const DESKTOP_BATTLEFIELD_LAYOUT = {
  // Root: fills the viewport height with an svh cap so zoom can't push the grid
  // taller than the screen. The whole shell is one scroll-isolated surface.
  shell:
    'h-[100svh] max-h-[100svh] w-full bg-[radial-gradient(125%_125%_at_50%_35%,transparent_50%,rgba(0,0,0,0.5)_100%),radial-gradient(150%_120%_at_50%_-15%,#15231e_0%,#0d1714_42%,#080b0a_100%)] text-stone-100 overflow-hidden overscroll-none',

  // The persistent three-column grid: left rail | center board | right rail.
  // The center column is the only flexible track (1fr); the rails are fixed,
  // independently-scrolling columns so a long feed never grows the board.
  grid:
    'grid h-full min-h-0 w-full grid-cols-[clamp(13rem,17vw,16rem)_minmax(0,1fr)_clamp(13rem,18vw,17rem)] gap-2 p-2',

  // Left rail — priority/phase. In-flow column, scrolls within its own track.
  leftRail:
    'flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto overscroll-contain',

  // Right rail — narration/log. Persistent, fills its track height, scrolls
  // internally (the NarrationFeed itself caps + scrolls its log body).
  rightRail:
    'flex min-h-0 min-w-0 flex-col overflow-hidden',
  // Sizing the NarrationFeed gets so it fills the rail height (its log scrolls).
  narrationFeed: 'min-h-0 flex-1',

  // Center column — the board. `relative` so in-flow overlays (targeting,
  // combat, opponent explorer) anchor to THIS box (absolute inset-0), never to
  // the viewport. `isolate` gives it its own stacking context.
  centerColumn:
    'relative isolate flex min-h-0 min-w-0 flex-col gap-2 overflow-hidden',

  // Opponents strip across the top of the board. Capped height (svh) with its
  // own horizontal scroll so many opponents never crowd the board below.
  opponentsStrip:
    'flex shrink-0 gap-2 overflow-x-auto overflow-y-hidden pb-1 max-h-[min(11rem,24svh)]',
  // Each opponent glance card holds a sensible width inside the scroll strip.
  opponentSlot: 'w-[clamp(11rem,16vw,15rem)] shrink-0',

  // The stack, pinned center — where resolution happens. Capped so a deep stack
  // scrolls internally instead of pushing the board/hand off-screen.
  stackSlot:
    'shrink-0 overflow-y-auto overscroll-contain max-h-[min(18rem,34svh)]',

  // Your battlefield — the main flexible area. Takes the remaining height; the
  // board itself scales-to-fit (FitToBox) so it never scrolls.
  playerBoardArea:
    'min-h-0 flex-1 overflow-hidden',

  // Your hand fanned along the bottom — a bottom rail, capped + scrollable, so
  // a wide hand never overlaps the board or the rails.
  handRail:
    'shrink-0 overflow-visible rounded-xl border border-amber-900/30 bg-gradient-to-b from-stone-900/70 to-neutral-950/80 shadow-[0_-6px_24px_rgba(0,0,0,0.45)] max-h-[min(15rem,30svh)]',

  // In-flow overlay slot (targeting / combat). NOT fixed — it sits in the center
  // column's flow above the hand so it never covers the board's tiles silently.
  // Capped + internally scrollable so a tall banner (e.g. many attackers) can't
  // crush the flex-1 board past the screen or get its Confirm footer clipped by
  // the center column's overflow-hidden.
  decisionSlot:
    'shrink-0 overflow-y-auto overscroll-contain max-h-[min(22rem,42svh)]',
} as const;

export type DesktopBattlefieldLayout = typeof DESKTOP_BATTLEFIELD_LAYOUT;

// ============================================================================
// MOBILE_TABLE_LAYOUT — the mobile (<1024px) "floating table" layout classes.
//
// Spec (mobile §Layout): "opponents collapse to a top strip, your board fills
// the screen, the stack/priority surfaces as a bottom sheet only when it's your
// decision, the hand swipes up." Same components as desktop, laid out for thumb
// reach.
//
// SAME REGRESSION GUARD as desktop: NOTHING here is position:fixed and nothing
// is an absolute full-screen overlay over the board. The whole shell is one
// in-flow vertical FLEX COLUMN — top strip · board (flex-1) · in-flow decision
// sheet · hand pull-up — so the bottom sheet/docks pile up BELOW the board in
// normal flow and can never sit over the board's interactive tiles (the exact
// dock-collision / feed-blocking bug class this rebuild kills). The only
// `absolute inset-0` element (the OpponentExplorer) anchors to the `relative`
// board container, never the viewport. Every region carries an svh cap so high
// browser zoom (rem inflation) can't grow a region past the screen.
// ============================================================================

export const MOBILE_TABLE_LAYOUT = {
  // Root: fills the viewport with an svh cap; the shell is one vertical flex
  // column and the single scroll-isolated surface.
  shell:
    'flex h-[100svh] max-h-[100svh] w-full flex-col gap-1.5 overflow-hidden overscroll-none bg-[radial-gradient(125%_125%_at_50%_38%,transparent_48%,rgba(0,0,0,0.5)_100%),radial-gradient(150%_110%_at_50%_-10%,#15231e_0%,#0d1714_45%,#080b0a_100%)] p-1.5 text-stone-100',

  // Opponents collapse to a top strip — a single horizontal swipe row of glance
  // cards, capped so many opponents never crowd the board below.
  opponentsStrip:
    'flex shrink-0 gap-2 overflow-x-auto overflow-y-hidden pb-1 max-h-[min(8.5rem,22svh)]',
  // Each collapsed opponent glance holds a thumb-width slot in the scroll row.
  opponentSlot: 'w-[clamp(11rem,72vw,15rem)] shrink-0',

  // The board fills the screen — the main flexible area. `relative isolate` so
  // the one in-flow overlay (OpponentExplorer) anchors to THIS box (absolute
  // inset-0), never to the viewport. Scrolls internally when the board is large.
  boardArea:
    'relative isolate min-h-0 flex-1 overflow-hidden',

  // Bottom decision sheet — the stack / priority / targeting / combat surface,
  // shown only when it's the human's decision (see shouldSurfaceDecisionSheet).
  // It is IN FLOW at the bottom of the column (NOT absolute over the board):
  // capped + internally scrollable so a deep stack never pushes the hand off or
  // covers the board.
  decisionSheet:
    'shrink-0 overflow-y-auto overscroll-contain rounded-xl border border-amber-500/35 bg-stone-900/95 p-2 shadow-2xl shadow-black/50 max-h-[min(16rem,32svh)]',

  // Priority strip — always present at the bottom even when no sheet surfaces,
  // so "whose call is it / pass" is always reachable (no-dead-ends invariant).
  prioritySlot: 'shrink-0',

  // Your hand swipes up from the bottom — a capped, in-flow pull-up. <details>
  // grows only its own box (never a full-screen overlay on the board).
  handPullup:
    'shrink-0 overflow-hidden rounded-xl border border-stone-700/60 bg-stone-900/60',
  handPullupSummary:
    'flex cursor-pointer list-none items-center justify-between px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-amber-200/90 [&::-webkit-details-marker]:hidden',
  handPullupBody:
    'overflow-x-auto overflow-y-visible max-h-[min(10rem,22svh)]',

  // Narration — a bounded pull-up (the NarrationFeed renders its own <details>
  // on mobile); this just sizes the slot. In flow, never over the board.
  narrationSlot: 'shrink-0',
} as const;

export type MobileTableLayout = typeof MOBILE_TABLE_LAYOUT;

// ============================================================================
// Pure layout decisions shared by BOTH form factors.
//
// Types + pure functions only — no React, no engine/hook access, no DOM. Derived
// from the already-built `GameView` view-model so both shells stay honestly in
// lockstep and the decision is unit-testable in isolation.
// ============================================================================

/**
 * Whether the stack / priority surface is a LIVE HUMAN DECISION right now — the
 * gate both shells use to decide whether to surface the decision surface (mobile:
 * the bottom sheet slides up; desktop: the pinned center column lights up).
 *
 * Spec (mobile §Layout): "the stack/priority surfaces as a bottom sheet only when
 * it's your decision." A decision is live when the human has priority AND there
 * is something to decide about — either the stack is non-empty (respond / let it
 * resolve) or the priority context reports a meaningful response. When it is not
 * the human's call the stack stays glanceable but does not seize the sheet.
 */
export function shouldSurfaceDecisionSheet(view: GameView): boolean {
  if (!view.priority.hasPriority) return false;
  return view.stack.length > 0 || view.priority.hasMeaningfulResponse;
}
