import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  SimpleGameState,
  SimpleLegalAction,
  BoardTargetingPrompt,
  ChatMessage,
  DamageAssignmentChoice,
} from '../hooks/useShelectorGame';

// At an idle window (empty stack, no combat) the engine offers SkipEmptyPhases /
// SkipRestOfTurn INSTEAD of PassPriority, and only the opponent's idle windows
// are auto-passed by the hook. So "pass / advance" must consider all three, in
// least-aggressive-first order.
const PASS_ACTION_KINDS = ['PassPriority', 'SkipEmptyPhases', 'SkipRestOfTurn'] as const;

function findPassAction(actions: SimpleLegalAction[]): SimpleLegalAction | undefined {
  for (const kind of PASS_ACTION_KINDS) {
    const found = actions.find(a => a.kind === kind);
    if (found) return found;
  }
  return undefined;
}
import type {
  GameView,
  GameViewInput,
  LegalAction,
  CurrentPromptLike,
  DamageAssignmentChoiceLike,
  PlayPrompts,
} from './gameView.types';
import { useGameView } from './useGameView';
import { MulliganOverlay } from './components/MulliganOverlay';
import { DecisionModal, type DecisionAccent } from './components/DecisionModal';
import { DesktopBattlefield } from './shells/DesktopBattlefield';
import { MobileTable } from './shells/MobileTable';

interface DecisionModalContent {
  accent: DecisionAccent;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  declineLabel: string;
  confirmDisabled: boolean;
  onConfirm(): void;
  onDecline(): void;
}

/**
 * Build the DecisionModal content for whichever blocking yes/no choice is
 * pending (ward > tax > optional-trigger, most-urgent first — only one is ever
 * pending at a time, but this fixes a deterministic precedence). Returns null
 * when none is pending. Copy mirrors GameBoard's three modals.
 */
function decisionModalContent(prompts: PlayPrompts | undefined): DecisionModalContent | null {
  if (!prompts) return null;

  const ward = prompts.ward.choice;
  if (ward) {
    return {
      accent: 'rose',
      title: `Ward — ${ward.targetName}`,
      body: (
        <span>
          <b>{ward.sourceName}</b> targets <b>{ward.targetName}</b>. Pay {ward.costLabel} or it will
          be countered by ward.
        </span>
      ),
      confirmLabel: `Pay ${ward.costLabel}`,
      confirmDisabled: !ward.canPay,
      declineLabel: 'Decline',
      onConfirm: () => prompts.ward.onResolve(true),
      onDecline: () => prompts.ward.onResolve(false),
    };
  }

  const tax = prompts.tax.choice;
  if (tax) {
    const cost = `{${tax.taxAmount}}`;
    const effectText =
      tax.effect === 'draw'
        ? `${tax.controllerName} draws ${tax.effectCount} card${tax.effectCount === 1 ? '' : 's'}`
        : tax.effect === 'treasure'
          ? `${tax.controllerName} makes ${tax.effectCount} Treasure`
          : 'the trigger resolves';
    return {
      accent: 'sky',
      title: `Tax — ${tax.sourceName}`,
      body: (
        <span>
          <b>{tax.casterName}</b> may pay {cost}. If not, {effectText}.
        </span>
      ),
      confirmLabel: `Pay ${cost}`,
      confirmDisabled: !tax.canPay,
      declineLabel: 'Decline',
      onConfirm: () => prompts.tax.onResolve(true),
      onDecline: () => prompts.tax.onResolve(false),
    };
  }

  const ot = prompts.optionalTrigger.choice;
  if (ot) {
    return {
      accent: 'amber',
      title: ot.title || 'Optional trigger',
      body: (
        <span>
          <b>{ot.sourceName}</b>
          {ot.triggerKind ? ` — ${ot.triggerKind}` : ''}. Use this triggered ability?
        </span>
      ),
      confirmLabel: 'Use',
      confirmDisabled: false,
      declineLabel: 'Decline',
      onConfirm: () => prompts.optionalTrigger.onResolve(true),
      onDecline: () => prompts.optionalTrigger.onResolve(false),
    };
  }

  return null;
}

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
  /**
   * Engine-prompt dispatch surface (mulligan, tutor/search, optional-trigger,
   * tax/ward, damage-order, trigger-order, scry/surveil, discard, actionError).
   * Optional so existing tests can omit it; when absent those prompts are inert.
   */
  prompts?: PlayPrompts;
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
  prompts,
}: PlayExperienceProps) {
  const isDesktop = useIsDesktop();

  // A mid-resolution decision the engine is waiting on. SEVEN of these hard-block
  // submitAction in the hook, so the board's normal action path is refused while
  // one is pending — auto-pass MUST stand down (see the auto-pass effect) or it
  // would pass underneath an unrendered choice (or stall the game silently).
  const hasPendingBlockingChoice = Boolean(
    prompts &&
      (prompts.mulligan.phase ||
        prompts.discard.phase ||
        prompts.tutor.phase ||
        prompts.library.choice ||
        prompts.optionalTrigger.choice ||
        prompts.tax.choice ||
        prompts.ward.choice ||
        prompts.damageAssignment.choice ||
        prompts.triggerOrder.choice),
  );

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

  // The hook empties `legalActions` at idle priority / mid-resolution windows and
  // routes the legal choices into `currentPrompt.legalChoices` instead (each choice
  // carries the engine action under `.action`). Source from there when
  // `legalActions` is empty, otherwise the UI has nothing to act on — no pass, no
  // play, no cast. This is what made the board render but never advance.
  const effectiveLegalActions: SimpleLegalAction[] = useMemo(() => {
    if (legalActions.length > 0) return legalActions;
    const choices = currentPrompt?.legalChoices;
    if (!choices || choices.length === 0) return legalActions;
    return choices.map(c => ({
      kind: c.kind,
      label: c.label ?? '',
      cardInstanceId: c.cardInstanceId,
      _engineAction: c.action,
    })) as SimpleLegalAction[];
  }, [legalActions, currentPrompt]);

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
    for (const action of effectiveLegalActions) {
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
  }, [effectiveLegalActions]);

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
    legalActions: effectiveLegalActions,
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
    const passAction = findPassAction(effectiveLegalActions);
    if (passAction) onAction(passAction);
  }, [effectiveLegalActions, onAction]);
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
    const passAction = findPassAction(effectiveLegalActions);
    if (passAction) onAction(passAction);
  }, [effectiveLegalActions, onAction]);

  // Auto-advance idle windows: when the human's ONLY legal actions are
  // pass/skip kinds (nothing meaningful to do) and they aren't holding with
  // "always stop", submit the pass automatically so the game flows. Guarded by
  // a signature of the current actions so an unchanged state is never passed
  // twice (no tight loop); each real engine advance changes the signature.
  const lastAutoPassSig = useRef<string>('');
  useEffect(() => {
    if (alwaysStop) return;
    if (guidedPromptOpen) return; // wait for the guided choice before auto-flowing
    if (hasPendingBlockingChoice) return; // a decision modal is up — never pass under it
    if (effectiveLegalActions.length === 0) return;
    const passAction = findPassAction(effectiveLegalActions);
    if (!passAction) return;
    const onlyPassActions = effectiveLegalActions.every(
      a => (PASS_ACTION_KINDS as readonly string[]).includes(a.kind),
    );
    if (!onlyPassActions) return; // a real choice exists — let the human decide
    const sig = effectiveLegalActions.map(a => `${a.kind}:${a.cardInstanceId ?? ''}`).join('|');
    if (sig === lastAutoPassSig.current) return;
    lastAutoPassSig.current = sig;
    onAction(passAction);
  }, [effectiveLegalActions, alwaysStop, guidedPromptOpen, hasPendingBlockingChoice, onAction]);

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

  const mulliganOpen = Boolean(prompts?.mulligan.phase);
  const actionError = prompts?.actionError ?? null;
  const decision = decisionModalContent(prompts);

  return (
    <div data-testid="play-experience" className="relative h-full w-full">
      {/* A refused/illegal action is otherwise invisible in this UI — surface it
          so stalls are diagnosable (this is the class of bug that bit us before). */}
      {actionError && (
        <div
          data-testid="play-action-error"
          role="alert"
          className="absolute inset-x-0 top-0 z-50 flex items-start justify-between gap-3 border-b border-rose-500/40 bg-rose-950/95 px-4 py-2 text-sm text-rose-100"
        >
          <span className="min-w-0 flex-1">
            <span className="font-bold">Can't do that: </span>
            {actionError.message}
          </span>
          <button
            type="button"
            data-testid="play-action-error-dismiss"
            onClick={() => prompts?.onClearActionError()}
            aria-label="Dismiss"
            className="shrink-0 rounded px-2 py-0.5 font-bold text-rose-200 hover:bg-rose-900/80"
          >
            ✕
          </button>
        </div>
      )}

      {/* Guided is asked AFTER mulligan so the opening-hand decision comes first. */}
      {guidedPromptOpen && !mulliganOpen && (
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

      {mulliganOpen && prompts && (
        <MulliganOverlay
          hand={view.you.hand}
          count={prompts.mulligan.count}
          bottomCount={prompts.mulligan.bottomCount}
          selectedCardIds={prompts.mulligan.selectedCardIds}
          selectedBottomIds={prompts.mulligan.selectedBottomIds}
          onKeep={prompts.mulligan.onKeep}
          onMulligan={prompts.mulligan.onMulligan}
          onToggleCard={prompts.mulligan.onToggleCard}
          onToggleBottom={prompts.mulligan.onToggleBottom}
        />
      )}

      {decision && (
        <DecisionModal
          accent={decision.accent}
          title={decision.title}
          body={decision.body}
          confirmLabel={decision.confirmLabel}
          declineLabel={decision.declineLabel}
          confirmDisabled={decision.confirmDisabled}
          onConfirm={decision.onConfirm}
          onDecline={decision.onDecline}
        />
      )}
    </div>
  );
}

export default PlayExperience;
