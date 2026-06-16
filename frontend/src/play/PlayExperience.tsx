import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  SimpleGameState,
  SimpleLegalAction,
  BoardTargetingPrompt,
  ChatMessage,
  DamageAssignmentChoice,
} from '../hooks/useShelectorGame';
import type {
  GameView,
  GameViewInput,
  LegalAction,
  CurrentPromptLike,
  DamageAssignmentChoiceLike,
} from './gameView.types';
import { useGameView } from './useGameView';
import { DesktopBattlefield } from './shells/DesktopBattlefield';
import { MobileTable } from './shells/MobileTable';

// ============================================================================
// PlayExperience — the top-level that wires the pure play view-model
// (useGameView + the shells) to the REAL engine hook outputs.
//
// It is a DROP-IN ALTERNATIVE to <GameBoard>: it takes the same prop bag the
// page already feeds GameBoard (which IS the hook's already-derived outputs and
// dispatchers), so the launching page can render <PlayExperience .../> instead
// of <GameBoard .../> behind a flag with no other change. This avoids spinning
// up a second useShelectorGame() instance (which would be a SECOND, empty game)
// — the page owns the single hook instance and threads it down here, exactly as
// it does to GameBoard, so the engine wiring is identical.
//
// Responsibilities:
//   • build GameViewInput from the hook outputs + a `guided` boolean and run
//     useGameView, then render DesktopBattlefield (>=1024px) or MobileTable
//     (live-switching via matchMedia);
//   • own the interaction state the shells don't: `guided`, `alwaysStop`, the
//     in-progress `selectedTargetIds`, and the combat `assignments`;
//   • implement the flat callback bag the shells expect by routing to the SAME
//     dispatchers the current GameBoard uses (onAction === submitAction, the
//     pass/targeting/combat dispatch built exactly as GameBoard builds them).
// ============================================================================

const DESKTOP_MIN_WIDTH = 1024;

/** Live-tracks whether the viewport is at/above the desktop breakpoint. */
function useIsDesktop(): boolean {
  const query = `(min-width: ${DESKTOP_MIN_WIDTH}px)`;
  const read = () =>
    typeof window !== 'undefined' &&
    (window.matchMedia
      ? window.matchMedia(query).matches
      : window.innerWidth >= DESKTOP_MIN_WIDTH);

  const [isDesktop, setIsDesktop] = useState<boolean>(read);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Prefer matchMedia (fires only when the breakpoint is actually crossed);
    // fall back to a resize listener where matchMedia is unavailable.
    if (window.matchMedia) {
      const mql = window.matchMedia(query);
      const onChange = () => setIsDesktop(mql.matches);
      onChange();
      // addEventListener('change') is the modern API; addListener the legacy one.
      if (mql.addEventListener) {
        mql.addEventListener('change', onChange);
        return () => mql.removeEventListener('change', onChange);
      }
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
    const onResize = () => setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [query]);

  return isDesktop;
}

/**
 * The subset of the GameBoard prop bag PlayExperience actually needs to render
 * the new play UI. It is intentionally a SUBSET of GameBoardProps (all optional
 * extras omitted) so the page can hand <PlayExperience> the identical props it
 * hands <GameBoard> — TypeScript ignores the surplus props.
 */
export interface PlayExperienceProps {
  gameState: SimpleGameState;
  legalActions: SimpleLegalAction[];
  isHumanTurn: boolean;
  /** Hook's `winner` = winnerId (a player id), or null. */
  winner?: string | null;
  /** The single commit path: submitAction(action.source). */
  onAction: (action: SimpleLegalAction) => void;
  targetingPrompt?: BoardTargetingPrompt | null;
  onCancelTargeting?: () => void;
  currentPrompt?: CurrentPromptLike | null;
  chatMessages?: ChatMessage[];
  /** The hook's `damageAssignmentChoice` (adapted to the loose contract shape). */
  damageAssignmentChoice?: DamageAssignmentChoice | null;
  /** Whether to START in guided mode (mirrors the page's newPlayerMode toggle). */
  newPlayerMode?: boolean;
}

/**
 * Adapt the hook's structured DamageAssignmentChoice into the loose
 * DamageAssignmentChoiceLike the combat selector reads. The selector only needs
 * one (attacker → blocker ids) group to flag the order-damage step; we surface
 * the first group's attacker + its blocker ids.
 */
function toDamageAssignmentLike(
  choice: DamageAssignmentChoice | null | undefined,
): DamageAssignmentChoiceLike | null {
  if (!choice) return null;
  const group = choice.groups[0];
  if (!group) return { attackerInstanceId: undefined, blockerInstanceIds: [] };
  return {
    attackerInstanceId: group.attackerId,
    blockerInstanceIds: group.blockers.map(b => b.blockerId),
  };
}

export function PlayExperience({
  gameState,
  legalActions,
  isHumanTurn,
  winner = null,
  onAction,
  targetingPrompt = null,
  onCancelTargeting,
  currentPrompt = null,
  chatMessages,
  damageAssignmentChoice = null,
  newPlayerMode = false,
}: PlayExperienceProps) {
  const isDesktop = useIsDesktop();

  // ── Interaction state owned here (NOT in the pure shells) ─────────────────
  // `guided`: seeded from the page's newPlayerMode, then a start "play guided?"
  // prompt lets the player confirm before/at game start.
  const [guided, setGuided] = useState<boolean>(newPlayerMode);
  // Whether the guided prompt is still pending (shown before/at game start).
  const [guidedPromptOpen, setGuidedPromptOpen] = useState<boolean>(true);
  // Control-player setting: stop at every priority window.
  const [alwaysStop, setAlwaysStop] = useState<boolean>(false);
  // In-progress board-target selection (the prompt resolves one target/tap).
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([]);
  // Combat assignments the human composes before confirming:
  //   attackers → Set<attackerId>; blockers → blockerId -> attackerId.
  const [attackSelection, setAttackSelection] = useState<Set<string>>(() => new Set());
  const [blockAssignments, setBlockAssignments] = useState<Record<string, string>>({});

  // Clear stale board-target selection whenever the prompt changes/closes.
  useEffect(() => {
    setSelectedTargetIds([]);
  }, [targetingPrompt]);

  // ── Combat composer data (derived EXACTLY as GameBoard derives it) ────────
  // Every eligible attacker appears in some DeclareAttackers menu option; every
  // legal (blocker, attacker) pair appears in some DeclareBlockers option.
  const {
    eligibleDefenderIds,
    legalBlockPairs,
    hasDeclareAttackers,
    hasDeclareBlockers,
  } = useMemo(() => {
    const defenders: string[] = [];
    const pairs = new Map<string, Set<string>>();
    let hasAtk = false;
    let hasBlk = false;
    for (const action of legalActions) {
      const engineAction = action._engineAction;
      if (engineAction?.kind === 'DeclareAttackers') {
        hasAtk = true;
        for (const attack of engineAction.attacks) {
          if (!defenders.includes(attack.defendingPlayerId)) {
            defenders.push(attack.defendingPlayerId);
          }
        }
      } else if (engineAction?.kind === 'DeclareBlockers') {
        hasBlk = true;
        for (const block of engineAction.blocks) {
          const set = pairs.get(block.cardInstanceId) ?? new Set<string>();
          set.add(block.blockingAttackerId);
          pairs.set(block.cardInstanceId, set);
        }
      }
    }
    return {
      eligibleDefenderIds: defenders,
      legalBlockPairs: pairs,
      hasDeclareAttackers: hasAtk,
      hasDeclareBlockers: hasBlk,
    };
  }, [legalActions]);

  // Reset the composer whenever the respective combat window closes (mirrors
  // GameBoard's effect so a stale selection never leaks across steps).
  useEffect(() => {
    if (!hasDeclareAttackers && attackSelection.size > 0) {
      setAttackSelection(new Set());
    }
  }, [hasDeclareAttackers, attackSelection.size]);
  useEffect(() => {
    if (!hasDeclareBlockers && Object.keys(blockAssignments).length > 0) {
      setBlockAssignments({});
    }
  }, [hasDeclareBlockers, blockAssignments]);

  // ── Build the view-model from the hook outputs + guided ───────────────────
  const damageAssignmentLike = useMemo(
    () => toDamageAssignmentLike(damageAssignmentChoice),
    [damageAssignmentChoice],
  );
  const input: GameViewInput = {
    gameState,
    legalActions,
    isHumanTurn,
    winner,
    guided,
    targetingPrompt,
    currentPrompt,
    chatMessages,
    damageAssignmentChoice: damageAssignmentLike,
  };
  const baseView = useGameView(input);

  // Inject the locally-owned interaction state the selectors can't know about:
  //   • board-target selection (the prompt API resolves one tap at a time);
  //   • the composed combat assignments (attackers / blocks-in-progress).
  const view: GameView = useMemo(() => {
    const assignments: Record<string, string[]> = {};
    if (baseView.combat.step === 'declare-attackers') {
      for (const attackerId of attackSelection) {
        assignments[attackerId] = eligibleDefenderIds.length > 0 ? [eligibleDefenderIds[0]] : [];
      }
    } else if (baseView.combat.step === 'declare-blockers') {
      for (const [blockerId, attackerId] of Object.entries(blockAssignments)) {
        assignments[blockerId] = [attackerId];
      }
    }
    return {
      ...baseView,
      targeting: { ...baseView.targeting, selectedTargetIds },
      combat: { ...baseView.combat, assignments },
    };
  }, [baseView, selectedTargetIds, attackSelection, blockAssignments, eligibleDefenderIds]);

  // ── Callback bag → hook dispatchers ───────────────────────────────────────

  // Object/hand action: the single commit path. submitAction(action.source).
  const handleAction = useCallback(
    (action: LegalAction) => {
      onAction(action.source);
    },
    [onAction],
  );

  // Examine / explore: pure look-only UI state. The shells own the
  // OpponentExplorer overlay (open by playerId) and a card-detail open by id;
  // there is no engine dispatch, so these are intentional no-ops at this level.
  const handleExamine = useCallback((_id: string) => {
    // Look-only: handled inside the shells (card detail) — no engine commit.
  }, []);
  const handleExploreOpponent = useCallback((_playerId: string) => {
    // Look-only: the shell opens its OpponentExplorer — no engine commit.
  }, []);

  // Priority: pass routes to the PassPriority legal action (same as GameBoard's
  // passAction = legalActions.find(kind === 'PassPriority')). "Hold" has no
  // engine action in this surface; it is a UI affordance only.
  const handlePass = useCallback(() => {
    const passAction = legalActions.find(a => a.kind === 'PassPriority');
    if (passAction) onAction(passAction);
  }, [legalActions, onAction]);
  const handleHold = useCallback(() => {
    // No engine "hold" on this prop surface; toggling stops is the page's job.
  }, []);
  const handleToggleAlwaysStop = useCallback(() => {
    setAlwaysStop(prev => !prev);
  }, []);

  // Stack responses: "respond" keeps priority to act (no-op here — the human
  // simply plays an instant via the normal action path); "let resolve" passes
  // priority so the top of stack resolves. Mirrors GameBoard's pass semantics.
  const handleRespond = useCallback(() => {
    // Responding = casting/activating via the normal action path; nothing to
    // dispatch here beyond keeping the window open.
  }, []);
  const handleLetResolve = useCallback(() => {
    const passAction = legalActions.find(a => a.kind === 'PassPriority');
    if (passAction) onAction(passAction);
  }, [legalActions, onAction]);

  // Targeting: the board-target prompt resolves ONE target per tap (max = 1).
  //   toggle  → record the locally-selected id (or clear it if re-tapped);
  //   confirm → submit the chosen choice.action (the per-target SimpleLegalAction);
  //   cancel  → dismiss via cancelTargeting() and clear local selection.
  const handleToggleTarget = useCallback((id: string) => {
    setSelectedTargetIds(prev => (prev.includes(id) ? [] : [id]));
  }, []);
  const handleConfirmTarget = useCallback(() => {
    const id = selectedTargetIds[0];
    if (!id || !targetingPrompt) return;
    const choice = targetingPrompt.choices.find(c => c.targetId === id);
    if (choice) onAction(choice.action);
    setSelectedTargetIds([]);
  }, [selectedTargetIds, targetingPrompt, onAction]);
  const handleCancelTarget = useCallback(() => {
    onCancelTargeting?.();
    setSelectedTargetIds([]);
  }, [onCancelTargeting]);

  // Combat assign: in declare-attackers, `a` is the attacker id we toggle into
  // the selection (the defender defaults to the sole eligible defender, exactly
  // as GameBoard's composer does). In declare-blockers, `a` is the blocker and
  // `b` the attacker it blocks — only legal (blocker, attacker) pairs are kept.
  const handleAssignCombat = useCallback(
    (a: string, b: string) => {
      if (hasDeclareAttackers) {
        setAttackSelection(prev => {
          const next = new Set(prev);
          if (next.has(a)) next.delete(a);
          else next.add(a);
          return next;
        });
        return;
      }
      if (hasDeclareBlockers) {
        if (!legalBlockPairs.get(a)?.has(b)) return; // not a legal block
        setBlockAssignments(prev => ({ ...prev, [a]: b }));
      }
    },
    [hasDeclareAttackers, hasDeclareBlockers, legalBlockPairs],
  );

  // Combat confirm: build a fresh DeclareAttackers/DeclareBlockers
  // SimpleLegalAction EXACTLY as GameBoard's confirmComposedAttack/Blocks do,
  // and submit it through the single commit path.
  const handleConfirmCombat = useCallback(() => {
    if (hasDeclareAttackers) {
      const defenderId = eligibleDefenderIds[0];
      if (attackSelection.size === 0 || !defenderId) return;
      onAction({
        kind: 'DeclareAttackers',
        label: `Attack with ${attackSelection.size}`,
        _engineAction: {
          kind: 'DeclareAttackers',
          attacks: [...attackSelection].map(cardInstanceId => ({
            cardInstanceId,
            defendingPlayerId: defenderId,
          })),
        },
      } as SimpleLegalAction);
      setAttackSelection(new Set());
      return;
    }
    if (hasDeclareBlockers) {
      // Empty blocks (no blocks) is a legal declaration, matching GameBoard.
      onAction({
        kind: 'DeclareBlockers',
        label: `Block with ${Object.keys(blockAssignments).length}`,
        _engineAction: {
          kind: 'DeclareBlockers',
          blocks: Object.entries(blockAssignments).map(([cardInstanceId, blockingAttackerId]) => ({
            cardInstanceId,
            blockingAttackerId,
          })),
        },
      } as SimpleLegalAction);
      setBlockAssignments({});
    }
  }, [hasDeclareAttackers, hasDeclareBlockers, eligibleDefenderIds, attackSelection, blockAssignments, onAction]);

  // ── Render ────────────────────────────────────────────────────────────────
  const shellProps = {
    view,
    alwaysStop,
    onAction: handleAction,
    onExamine: handleExamine,
    onPass: handlePass,
    onHold: handleHold,
    onToggleAlwaysStop: handleToggleAlwaysStop,
    onExploreOpponent: handleExploreOpponent,
    onRespond: handleRespond,
    onLetResolve: handleLetResolve,
    onToggleTarget: handleToggleTarget,
    onConfirmTarget: handleConfirmTarget,
    onCancelTarget: handleCancelTarget,
    onAssignCombat: handleAssignCombat,
    onConfirmCombat: handleConfirmCombat,
  };

  return (
    <div data-testid="play-experience" className="relative h-full w-full">
      {guidedPromptOpen && (
        <div
          data-testid="play-guided-prompt"
          className="absolute inset-x-0 top-0 z-30 flex items-center justify-center gap-3 border-b border-amber-500/30 bg-stone-950/95 px-4 py-2 text-sm text-stone-100"
          role="dialog"
          aria-label="Play guided?"
        >
          <span className="font-semibold">Play guided?</span>
          <button
            type="button"
            data-testid="play-guided-yes"
            onClick={() => {
              setGuided(true);
              setGuidedPromptOpen(false);
            }}
            className="min-h-9 rounded-lg bg-amber-400 px-3 py-1 font-bold text-neutral-950 hover:bg-amber-300"
          >
            Yes, guide me
          </button>
          <button
            type="button"
            data-testid="play-guided-no"
            onClick={() => {
              setGuided(false);
              setGuidedPromptOpen(false);
            }}
            className="min-h-9 rounded-lg border border-stone-600 bg-stone-800 px-3 py-1 font-bold text-stone-200 hover:bg-stone-700"
          >
            No, just play
          </button>
        </div>
      )}

      {isDesktop ? <DesktopBattlefield {...shellProps} /> : <MobileTable {...shellProps} />}
    </div>
  );
}

export default PlayExperience;
