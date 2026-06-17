// ============================================================================
// GameView contract — the pure view-model the play UI renders from.
//
// `useGameView` (and the pure `buildGameView`) reshape the hook's ALREADY-DERIVED
// outputs (gameState / legalActions / targetingPrompt / currentPrompt / chatMessages
// / isHumanTurn / winner / guided) into this contract. It NEVER re-derives from raw
// engine state. See docs/superpowers/plans/notes/engine-hook-api.md.
//
// Types are erased at build, so importing the structural types from the large hook
// file is free at runtime and keeps the view-model bound to the real data shapes.
// ============================================================================

import type {
  SimpleGameState,
  SimpleCard,
  SimpleLegalAction,
  SimplePlayer,
  BoardTargetingPrompt,
  ChatMessage,
  TutorCardOption,
  LibraryManipulationChoice,
  OptionalTriggerChoice,
  TaxPaymentChoice,
  WardPaymentChoice,
  DamageAssignmentChoice,
  TriggerOrderChoiceState,
} from '../hooks/useShelectorGame';
import type { DamageAssignmentOrder } from 'commander-engine';

export type {
  SimpleGameState,
  SimpleCard,
  SimpleLegalAction,
  SimplePlayer,
  BoardTargetingPrompt,
  ChatMessage,
  TutorCardOption,
  LibraryManipulationChoice,
  OptionalTriggerChoice,
  TaxPaymentChoice,
  WardPaymentChoice,
  DamageAssignmentChoice,
  TriggerOrderChoiceState,
  DamageAssignmentOrder,
};

/** The hook's `actionError` shape (a refused/illegal action, surfaced to the UI). */
export interface PlayActionError {
  reason: string;
  message: string;
}

/**
 * The engine-prompt DISPATCH surface threaded from the page — the hook's pending
 * choice state plus the resolver that answers each one. Grouped into one prop so
 * PlayExperience takes a single `prompts` bag (mirroring how the page already
 * feeds these to GameBoard), and so `hasPendingBlockingChoice` is computable in
 * one place to gate auto-pass. Signatures match the hook's resolvers exactly.
 */
export interface PlayPrompts {
  /** London mulligan: keep / redraw / then bottom N. */
  mulligan: {
    phase: boolean;
    count: number;
    /** > 0 only during the post-mulligan bottom-selection stage. */
    bottomCount: number;
    selectedCardIds: string[];
    selectedBottomIds: string[];
    onKeep: () => void;
    onMulligan: (cardInstanceIds?: string[]) => void;
    onToggleCard: (cardInstanceId: string) => void;
    onToggleBottom: (cardInstanceId: string) => void;
  };
  /** Cleanup discard-to-hand-size. */
  discard: {
    phase: boolean;
    count: number;
    onDiscard: (cardInstanceId: string) => void;
  };
  /** Shared tutor/search channel (tutor, sacrifice, name-a-card, cast extra cost…). */
  tutor: {
    phase: boolean;
    cards: TutorCardOption[];
    title: string;
    onPick: (cardInstanceId: string) => void;
    onCancel: () => void;
  };
  /** Scry / surveil top-of-library ordering. */
  library: {
    choice: LibraryManipulationChoice | null;
    onResolve: (topIds: string[], movedIds: string[]) => void;
  };
  /** "You may" optional trigger. */
  optionalTrigger: {
    choice: OptionalTriggerChoice | null;
    onResolve: (use: boolean) => void;
  };
  /** Tax trigger ("unless you pay {N}"). */
  tax: {
    choice: TaxPaymentChoice | null;
    onResolve: (pay: boolean) => void;
  };
  /** Ward ("pay the ward cost or be countered"). */
  ward: {
    choice: WardPaymentChoice | null;
    onResolve: (pay: boolean) => void;
  };
  /** Combat damage-assignment order among multiple blockers. */
  damageAssignment: {
    choice: DamageAssignmentChoice | null;
    onResolve: (orders: DamageAssignmentOrder[]) => void;
  };
  /** Ordering of simultaneous own triggers (APNAP). */
  triggerOrder: {
    choice: TriggerOrderChoiceState | null;
    onResolve: (orderedTriggerIds: string[]) => void;
  };
  /** A refused/illegal action — surfaced so stalls aren't silent. */
  actionError: PlayActionError | null;
  onClearActionError: () => void;
}

/** One choice in a prompt — carries the engine action under `action`. When the
 * hook empties `legalActions` (idle priority / mid-resolution windows), the legal
 * choices live HERE instead, so the UI must source actions from this. */
export interface PromptChoiceLike {
  id?: string;
  kind: string;
  label?: string;
  cardInstanceId?: string;
  action: unknown;
}

/** Engine-authored prompt members the selectors actually read (structural subset). */
export interface CurrentPromptLike {
  type?: string;
  playerId?: string;
  phase?: string;
  step?: string;
  priority?: {
    canResolveTopOfStack?: boolean;
    stackSize?: number;
  };
  legalChoices?: PromptChoiceLike[];
}

/** Mid-resolution combat damage-order decision (hook's `damageAssignmentChoice`). */
export interface DamageAssignmentChoiceLike {
  attackerInstanceId?: string;
  blockerInstanceIds?: string[];
}

// ----------------------------------------------------------------------------
// Action layer
// ----------------------------------------------------------------------------

export type LegalActionKind =
  | 'cast'
  | 'play-land'
  | 'activate'
  | 'attack'
  | 'block'
  | 'choose-target'
  | 'pass'
  | 'hold'
  | 'mulligan'
  | 'examine';

/**
 * A single legal action, normalized for the UI. Carries the underlying
 * `SimpleLegalAction` so the UI dispatches via `submitAction(action.source)`.
 * There is intentionally no synthetic stable id (the engine/hook exposes none).
 */
export interface LegalAction {
  source: SimpleLegalAction;
  kind: LegalActionKind;
  label: string;
  whyDisabled?: string;
}

// ----------------------------------------------------------------------------
// Board objects
// ----------------------------------------------------------------------------

export interface PermanentView {
  id: string;
  /** Image is resolved by NAME via <CardImage name=...>; there is no imageUri. */
  name: string;
  tapped: boolean;
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  isLand: boolean;
  isCreature: boolean;
  isAttacking?: boolean;
  isBlocking?: boolean;
  legalActions: LegalAction[];
}

export interface HandCardView {
  id: string;
  name: string;
  manaCost?: string;
  legalActions: LegalAction[];
}

// ----------------------------------------------------------------------------
// Opponents
// ----------------------------------------------------------------------------

export type OpponentFlag = 'commander-out' | 'table-threat';

export interface OpponentGlance {
  playerId: string;
  name: string;
  life: number;
  commanderDamageToYou: number;
  handCount: number;
  openMana: number;
  creatureCount: number;
  totalPower: number;
  flags: OpponentFlag[];
  contextNote?: string;
}

export interface OpponentBoard {
  glance: OpponentGlance;
  creatures: PermanentView[];
  lands: PermanentView[];
  other: PermanentView[];
  graveyardCount: number;
  exileCount: number;
  commandZone: PermanentView[];
}

// ----------------------------------------------------------------------------
// Stack / priority / targeting / combat / narration
// ----------------------------------------------------------------------------

export interface StackItemView {
  id: string;
  controllerName: string;
  title: string;
  description: string;
  resolvesNext: boolean;
}

export interface PriorityContext {
  hasPriority: boolean;
  /** True turn ownership (active player == you), distinct from holding priority. */
  isYourTurn: boolean;
  phaseLabel: string;
  hasMeaningfulResponse: boolean;
  canPass: boolean;
  canHold: boolean;
}

export interface TargetingContext {
  active: boolean;
  prompt: string;
  minTargets: number;
  maxTargets: number;
  legalTargetIds: string[];
  selectedTargetIds: string[];
}

export type CombatStep = 'none' | 'declare-attackers' | 'declare-blockers' | 'order-damage';

/** An eligible combatant, resolved to its name + P/T for display. */
export interface Combatant {
  id: string;
  name: string;
  power?: number;
  toughness?: number;
}

export interface CombatContext {
  step: CombatStep;
  eligibleIds: string[];
  /** The eligible combatants with names/P-T (resolved from your board). */
  eligible: Combatant[];
  assignments: Record<string, string[]>;
}

export type NarrationKind = 'trigger' | 'resolve' | 'phase' | 'action';

export interface NarrationEntry {
  id: string;
  kind: NarrationKind;
  text: string;
}

// ----------------------------------------------------------------------------
// You + top-level GameView
// ----------------------------------------------------------------------------

export interface ManaPoolView {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
}

export interface YouView {
  life: number;
  poison: number;
  /** Mana currently floating in your pool. */
  manaPool: ManaPoolView;
  /** Your commander(s) in the command zone — each carries its cast action(s). */
  commandZone: PermanentView[];
  graveyardCount: number;
  libraryCount: number;
  handCount: number;
  creatures: PermanentView[];
  lands: PermanentView[];
  other: PermanentView[];
  hand: HandCardView[];
}

export interface GameView {
  you: YouView;
  opponents: OpponentBoard[];
  stack: StackItemView[];
  priority: PriorityContext;
  targeting: TargetingContext;
  combat: CombatContext;
  narration: NarrationEntry[];
  guided: boolean;
  isYourTurn: boolean;
  winner: string | null;
}

// ----------------------------------------------------------------------------
// The input to buildGameView — the hook's already-derived outputs.
// ----------------------------------------------------------------------------

export interface GameViewInput {
  gameState: SimpleGameState | null;
  legalActions: SimpleLegalAction[];
  isHumanTurn: boolean;
  /** Player id of the winner, or null. (Hook exposes `winner` = winnerId.) */
  winner: string | null;
  guided: boolean;
  targetingPrompt?: BoardTargetingPrompt | null;
  currentPrompt?: CurrentPromptLike | null;
  chatMessages?: ChatMessage[];
  damageAssignmentChoice?: DamageAssignmentChoiceLike | null;
}
