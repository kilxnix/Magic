// Re-export engine types
// Note: These are imported via path alias @engine which maps to ../engine/src
export type {
  GameState,
  Player,
  CardInstance,
  CardDefinition,
  CardType,
  Zone,
  Phase,
  Step,
  ManaColor,
  ManaPool,
  ManaCost,
  StackItem,
  SpellStackItem,
  TriggeredAbilityStackItem,
  CombatState,
  AttackerDeclaration,
  BlockerDeclaration,
  PendingTrigger,
} from '@engine/types';

export type {
  AIAction,
  AIDifficulty,
  AIPlayerConfig,
} from '@engine/ai/types';

export type { TargetSpec } from '@engine/effects/targets';
export type { SaveMetadata } from '@engine/persistence/schema';

export type { DeckInput } from '@engine/game-state';
export type { AIDecision } from '@engine/ai/agent';

// UI-specific types

export type OverlayType =
  | 'hand'
  | 'stack'
  | 'cardZoom'
  | 'zoneBrowser'
  | 'lifeTotal'
  | 'gameMenu'
  | 'manaPool'
  | 'opponent';

export interface OverlayState {
  hand: boolean;
  stack: boolean;
  cardZoom: string | null; // instanceId of zoomed card
  zoneBrowser: { zone: 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command'; playerId: string } | null;
  lifeTotal: string | null; // playerId whose life to show
  gameMenu: boolean;
  manaPool: boolean;
  opponent: string | null; // playerId to explore
}

export type SelectionMode = 'none' | 'targeting' | 'attackers' | 'blockers';

export interface SelectionState {
  mode: SelectionMode;
  validTargets: string[]; // instanceIds or playerIds
  selectedTargets: string[];
  sourceCardId?: string; // Card requiring targets
}

export interface PlayerConfig {
  id: string;
  name: string;
  isAI: boolean;
  difficulty: number;
}

export interface GameConfig {
  players: PlayerConfig[];
}

// Game action types for UI dispatch
export type GameAction =
  | { type: 'PLAY_LAND'; cardInstanceId: string }
  | { type: 'CAST_SPELL'; cardInstanceId: string; targets: string[] }
  | { type: 'TAP_PERMANENT'; cardInstanceId: string }
  | { type: 'ACTIVATE_MANA'; cardInstanceId: string; color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C' }
  | { type: 'DECLARE_ATTACKERS'; attacks: Array<{ cardInstanceId: string; defendingPlayerId: string }> }
  | { type: 'DECLARE_BLOCKERS'; blocks: Array<{ cardInstanceId: string; blockingAttackerId: string }> }
  | { type: 'PASS_PRIORITY' }
  | { type: 'CONFIRM_TARGETS'; targets: string[] }
  | { type: 'CANCEL_ACTION' };
