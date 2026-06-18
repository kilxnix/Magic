import { useState } from 'react';
import type {
  GameView,
  HandCardView,
  LegalAction,
} from '../gameView.types';

import { PlayerBoard } from '../components/PlayerBoard';
import { OpponentCard } from '../components/OpponentCard';
import { OpponentExplorer } from '../components/OpponentExplorer';
import { StackView } from '../components/StackView';
import { HandView } from '../components/HandView';
import { PriorityStrip } from '../components/PriorityStrip';
import { PhaseTrack } from '../components/PhaseTrack';
import { NarrationFeed } from '../components/NarrationFeed';
import { TargetingLayer } from '../components/TargetingLayer';
import { CombatFlow } from '../components/CombatFlow';

import { DESKTOP_BATTLEFIELD_LAYOUT as L } from '../playView.layout';

// ============================================================================
// DesktopBattlefield — the desktop (≥1024px) layout shell from the redesign spec.
//
// PURE / PRESENTATIONAL: it takes the already-derived `GameView` view-model plus
// a flat set of callbacks and composes the same presentational components the
// mobile shell uses — it holds NO engine/hook access and NO game logic. (The one
// piece of state it owns is purely UI: which opponent's board is currently being
// explored — a look-only, free + reversible overlay.)
//
// Layout (spec → "Desktop battlefield"): a persistent THREE-COLUMN CSS GRID —
//   • left rail   → PriorityStrip (whose call is it / pass / hold / always-stop)
//   • center      → opponents strip across the top · the stack pinned center ·
//                   your PlayerBoard as the main area · your HandView along the
//                   bottom, with TargetingLayer + CombatFlow as IN-FLOW overlays
//                   and the OpponentExplorer anchored to the board container.
//   • right rail  → NarrationFeed (the calm, self-explaining game log)
//
// REGRESSION GUARD — the bug class this whole rebuild kills: the rails are real,
// persistent grid columns and the feeds/docks live IN them. NOTHING is
// position:fixed and NOTHING is an absolute full-screen overlay over the board.
// The only `absolute inset-0` element (the OpponentExplorer) is anchored to the
// `relative` CENTER COLUMN — i.e. the board area — never to the viewport, so it
// can never sit over the rails' interactive controls or collapse the layout.
// ============================================================================

export interface DesktopBattlefieldProps {
  view: GameView;
  /** Control-player setting (lifted): stop at every priority window. */
  alwaysStop: boolean;

  // ── Object actions (commit) + look ──────────────────────────────────────
  /** Commit a legal action chosen on a hand card or one of your permanents. */
  onAction(action: LegalAction): void;
  /** Look-only (free + reversible): examine an object by id. */
  onExamine(id: string): void;

  // ── Priority ────────────────────────────────────────────────────────────
  onPass(): void;
  onHold(): void;
  onToggleAlwaysStop(): void;

  // ── Opponents ───────────────────────────────────────────────────────────
  /** Open the full explorable board for an opponent (look-only). */
  onExploreOpponent(playerId: string): void;

  // ── Stack / priority responses ──────────────────────────────────────────
  onRespond(): void;
  onLetResolve(): void;

  // ── Targeting ───────────────────────────────────────────────────────────
  onToggleTarget(id: string): void;
  onConfirmTarget(): void;
  onCancelTarget(): void;

  // ── Combat ──────────────────────────────────────────────────────────────
  onAssignCombat(a: string, b: string): void;
  onConfirmCombat(): void;
  onSkipCombat(): void;
  /** Which defender attackers hit (null → first eligible). */
  selectedDefenderId: string | null;
  onSelectDefender(id: string): void;
}

export function DesktopBattlefield({
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
  onSkipCombat,
  selectedDefenderId,
  onSelectDefender,
}: DesktopBattlefieldProps) {
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

  // Whole-screen "act now" read: a gentle inset glow + ring on the board when you
  // hold priority, stronger when there's a real decision (a response available or
  // a non-empty stack). Driven by priority, NOT turn ownership — you can hold
  // priority on an opponent's turn, which is exactly when "act now" matters most.
  const live = priority.hasPriority;
  const urgent = live && (priority.hasMeaningfulResponse || stack.length > 0);
  const spotlight = urgent
    ? 'ring-1 ring-amber-400/35 shadow-[inset_0_0_140px_rgba(251,191,36,0.09)]'
    : live
      ? 'ring-1 ring-amber-400/20 shadow-[inset_0_0_120px_rgba(251,191,36,0.05)]'
      : 'ring-1 ring-transparent';

  return (
    <div data-testid="desktop-battlefield" className={L.shell}>
      <div className={L.grid}>
        {/* ── LEFT RAIL: priority / phase (persistent, in-flow column) ──────── */}
        <aside data-testid="left-rail" aria-label="Priority and phase" className={L.leftRail}>
          <PriorityStrip
            priority={priority}
            alwaysStop={alwaysStop}
            onPass={onPass}
            onHold={onHold}
            onToggleAlwaysStop={onToggleAlwaysStop}
          />
          <PhaseTrack phaseLabel={priority.phaseLabel} />
        </aside>

        {/* ── CENTER: the board column (relative — anchors in-flow overlays) ── */}
        <main
          data-testid="board-column"
          aria-label="Battlefield"
          className={`${L.centerColumn} transition-shadow duration-500 ${spotlight}`}
        >
          {/* Opponents strip across the top — glance cards, one tap to explore. */}
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

          {/* The stack, pinned center — where resolution happens. */}
          <section data-testid="stack-slot" className={L.stackSlot}>
            <StackView
              stack={stack}
              guided={guided}
              onRespond={onRespond}
              onLetResolve={onLetResolve}
            />
          </section>

          {/* Your battlefield — the main area. */}
          <section data-testid="player-board-area" className={L.playerBoardArea}>
            <PlayerBoard you={you} onAction={onAction} onExamine={onExamine} />
          </section>

          {/* In-flow decision overlays (NOT fixed) — they sit in the board
              column's flow above the hand, so they never silently cover tiles.
              Each renders nothing when its context is inactive. */}
          {targeting.active && (
            <section data-testid="targeting-slot" className={L.decisionSlot}>
              <TargetingLayer
                targeting={targeting}
                onToggleTarget={onToggleTarget}
                onConfirm={onConfirmTarget}
                onCancel={onCancelTarget}
              />
            </section>
          )}

          {combat.step !== 'none' && (
            <section data-testid="combat-slot" className={L.decisionSlot}>
              <CombatFlow
                combat={combat}
                onAssign={onAssignCombat}
                onConfirm={onConfirmCombat}
                onSkip={onSkipCombat}
                selectedDefenderId={selectedDefenderId}
                onSelectDefender={onSelectDefender}
              />
            </section>
          )}

          {/* Your hand fanned along the bottom (a bottom rail of the board). */}
          <section data-testid="hand-rail" aria-label="Your hand" className={L.handRail}>
            <HandView hand={you.hand} onAction={handAction} onExamine={handExamine} />
          </section>

          {/* Opponent explorer — anchored to THIS board column (absolute inset-0
              within the relative center column), never to the viewport. */}
          {exploring && (
            <OpponentExplorer board={exploring} onClose={() => setExploringId(null)} />
          )}
        </main>

        {/* ── RIGHT RAIL: narration / log (persistent, in-flow column) ──────── */}
        <aside data-testid="right-rail" aria-label="Narration and log" className={L.rightRail}>
          <NarrationFeed entries={narration} className={L.narrationFeed} />
        </aside>
      </div>
    </div>
  );
}

export default DesktopBattlefield;
