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
} from '../hooks/useShelectorGame';

export type {
  SimpleGameState,
  SimpleCard,
  SimpleLegalAction,
  SimplePlayer,
  BoardTargetingPrompt,
  ChatMessage,
};

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

export interface CombatContext {
  step: CombatStep;
  eligibleIds: string[];
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

export interface YouView {
  life: number;
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
