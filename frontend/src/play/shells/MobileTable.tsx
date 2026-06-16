import { useState } from 'react';
import type { HandCardView, LegalAction } from '../gameView.types';

import { PlayerBoard } from '../components/PlayerBoard';
import { OpponentCard } from '../components/OpponentCard';
import { OpponentExplorer } from '../components/OpponentExplorer';
import { StackView } from '../components/StackView';
import { HandView } from '../components/HandView';
import { PriorityStrip } from '../components/PriorityStrip';
import { NarrationFeed } from '../components/NarrationFeed';
import { TargetingLayer } from '../components/TargetingLayer';
import { CombatFlow } from '../components/CombatFlow';

import { MOBILE_TABLE_LAYOUT as L, shouldSurfaceDecisionSheet } from '../playView.layout';
import type { DesktopBattlefieldProps } from './DesktopBattlefield';

// ============================================================================
// MobileTable — the mobile (<1024px) "floating table" layout shell.
//
// "Two native form factors, one component set" (spec §Goals 4): MobileTable and
// DesktopBattlefield are the SAME presentational components arranged differently,
// and they are interchangeable at the props boundary — MobileTable takes the
// exact `DesktopBattlefieldProps` shape (view · alwaysStop · the flat callback
// set) so the page can pick either by viewport and hand it identical props.
//
// PURE / PRESENTATIONAL: it takes the already-derived `GameView` view-model plus
// the callbacks and composes the shared components — NO engine/hook access and
// NO game logic. The one piece of state it owns is purely UI: which opponent's
// board is currently being explored (a look-only, free + reversible overlay).
//
// Layout (spec → "Mobile floating table"): one in-flow VERTICAL FLEX COLUMN —
//   • top      → opponents collapsed to a horizontal strip of glance cards
//   • middle   → your PlayerBoard fills the screen (the flexible area); the
//                OpponentExplorer mounts here, anchored to this relative box
//   • bottom   → a DECISION SHEET (the stack · targeting · combat) that surfaces
//                ONLY when it's the human's decision, the PriorityStrip (always
//                present so "pass" is always reachable), a swipe-up HandView, and
//                the NarrationFeed's bounded pull-up.
//
// REGRESSION GUARD — the bug class this rebuild kills: the whole shell is one
// in-flow flex column, so the bottom sheet / hand / narration pile up BELOW the
// board in normal flow. NOTHING is position:fixed and NOTHING is an absolute
// full-screen overlay over the board. The only `absolute inset-0` element (the
// OpponentExplorer) is anchored to the `relative` board area — never the
// viewport — so it can never sit over the priority/hand controls or collapse the
// layout. The decision sheet appears beneath the board, never on top of its
// interactive tiles.
// ============================================================================

export type MobileTableProps = DesktopBattlefieldProps;

export function MobileTable({
  view,
  alwaysStop,
  onAction,
  onExamine,
  onPass,
  onHold,
  onToggleAlwaysStop,
  onExploreOpponent,
  onRespond,
  onLetResolve,
  onToggleTarget,
  onConfirmTarget,
  onCancelTarget,
  onAssignCombat,
  onConfirmCombat,
}: MobileTableProps) {
  const { you, opponents, stack, priority, targeting, combat, narration, guided } = view;

  // UI-only state: which opponent board (by playerId) is open in the explorer.
  // Look-only overlay — opening/closing it never commits anything to the engine.
  const [exploringId, setExploringId] = useState<string | null>(null);

  const exploring =
    exploringId == null
      ? null
      : opponents.find((o) => o.glance.playerId === exploringId) ?? null;

  // HandView hands back the card; the shell threads the chosen action through the
  // single commit path. Examine is the free/reversible look path (by id).
  const handAction = (_card: HandCardView, action: LegalAction) => onAction(action);
  const handExamine = (card: HandCardView) => onExamine(card.id);

  const exploreOpponent = (playerId: string) => {
    setExploringId(playerId);
    onExploreOpponent(playerId);
  };

  // The stack / priority decision sheet surfaces ONLY when it's the human's call
  // (spec: "the stack/priority surfaces as a bottom sheet only when it's your
  // decision"). Targeting and combat steps are their own live decisions and also
  // surface in the sheet. Shared with desktop via the pure layout helper.
  const showStackSheet = shouldSurfaceDecisionSheet(view);
  const showDecisionSheet = showStackSheet || targeting.active || combat.step !== 'none';

  return (
    <div data-testid="mobile-table" className={L.shell}>
      {/* ── TOP: opponents collapsed to a horizontal strip ──────────────────── */}
      <section
        data-testid="opponents-strip"
        aria-label="Opponents"
        className={L.opponentsStrip}
      >
        {opponents.map((opponent) => (
          <div key={opponent.glance.playerId} className={L.opponentSlot}>
            <OpponentCard
              glance={opponent.glance}
              onExplore={() => exploreOpponent(opponent.glance.playerId)}
            />
          </div>
        ))}
      </section>

      {/* ── MIDDLE: your board fills the screen (relative — anchors the explorer) */}
      <main
        data-testid="board-area"
        aria-label="Your battlefield"
        className={L.boardArea}
      >
        <PlayerBoard you={you} onAction={onAction} onExamine={onExamine} />

        {/* Opponent explorer — anchored to THIS board area (absolute inset-0
            within the relative box), never to the viewport. Look-only overlay. */}
        {exploring && (
          <OpponentExplorer board={exploring} onClose={() => setExploringId(null)} />
        )}
      </main>

      {/* ── BOTTOM SHEET: stack · targeting · combat — only on a human decision ─
          IN FLOW beneath the board (NOT absolute over it), capped + scrollable. */}
      {showDecisionSheet && (
        <section
          data-testid="decision-sheet"
          aria-label="Your decision"
          className={L.decisionSheet}
        >
          {showStackSheet && (
            <StackView
              stack={stack}
              guided={guided}
              onRespond={onRespond}
              onLetResolve={onLetResolve}
            />
          )}

          {targeting.active && (
            <div data-testid="targeting-slot" className={showStackSheet ? 'mt-2' : ''}>
              <TargetingLayer
                targeting={targeting}
                onToggleTarget={onToggleTarget}
                onConfirm={onConfirmTarget}
                onCancel={onCancelTarget}
              />
            </div>
          )}

          {combat.step !== 'none' && (
            <div
              data-testid="combat-slot"
              className={showStackSheet || targeting.active ? 'mt-2' : ''}
            >
              <CombatFlow
                combat={combat}
                onAssign={onAssignCombat}
                onConfirm={onConfirmCombat}
              />
            </div>
          )}
        </section>
      )}

      {/* ── PRIORITY: always present (the no-dead-ends invariant — "pass" is
          always reachable), in flow at the bottom of the column. ─────────────── */}
      <section
        data-testid="priority-slot"
        aria-label="Priority"
        className={L.prioritySlot}
      >
        <PriorityStrip
          priority={priority}
          alwaysStop={alwaysStop}
          onPass={onPass}
          onHold={onHold}
          onToggleAlwaysStop={onToggleAlwaysStop}
        />
      </section>

      {/* ── HAND: swipes up from the bottom — a capped, in-flow pull-up. ──────── */}
      <details open data-testid="hand-pullup" className={L.handPullup}>
        <summary className={L.handPullupSummary}>
          <span>Your hand</span>
          <span aria-hidden="true" className="text-stone-500">
            {you.hand.length}
          </span>
        </summary>
        <div className={L.handPullupBody}>
          <HandView hand={you.hand} onAction={handAction} onExamine={handExamine} />
        </div>
      </details>

      {/* ── NARRATION: the calm log as a bounded pull-up (its own <details> on
          mobile). In flow, never over the board. ─────────────────────────────── */}
      <section
        data-testid="narration-slot"
        aria-label="Narration and log"
        className={L.narrationSlot}
      >
        <NarrationFeed entries={narration} />
      </section>
    </div>
  );
}

export default MobileTable;
