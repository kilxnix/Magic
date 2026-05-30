export * from './types';
export * from './game-state';
export * from './turn-manager';
export * from './mana';
export * from './priority';
export * from './actions';
export * from './stack';
export * from './combat';
export * from './state-based';
export * from './effective-types';
export * from './permanent-entry';
export * from './invariants';

// Keywords (Phase 5)
export * from './keywords';

// Effects system (Phase 4 + Phase 10 + Phase 15)
export * from './effects/ast';
export * from './effects/tokens';
export * from './effects/targets';
export * from './effects/parser';
export * from './effects/executor';
export * from './effects/overrides';
export * from './effects/replacement';
export * from './effects/continuous';

// AI system (Phase 8)
export * from './ai';

// Persistence system (Phase 12)
export * from './persistence';

// Cards system (Phase 13)
export * from './cards';

// Game initialization (Phase 13)
export * from './game-init';
export * from './room-game';
export * from './authority';

// Public try* action wrappers (Task 7 — game-reliability-refactor)
// Note: actions-public also exports GameEvent, which conflicts with stack.ts's GameEvent.
// We re-export everything except GameEvent to avoid the ambiguity, then re-export
// actions-public's GameEvent under the alias ActionGameEvent.
export {
  type ActionFailure,
  type WinReason,
  type LoopCategory,
  type LoopSignature,
  type ActionResult,
  type GameEvent as ActionGameEvent,
  fail as actionFail,
  success as actionSuccess,
  tryPlayLand,
  tryTapLandForMana,
  tryUntapManaSource,
  tryCastSpell,
  tryActivateAbility,
  tryPassPriority,
  tryDeclareAttackers,
  tryDeclareBlockers,
  tryEquip,
  tryAdjustCounters,
  tryAdjustPlayerCounter,
  tryAdjustCommanderDamage,
  tryMoveCardManually,
  tryAdjustDamage,
  tryCreateManualToken,
  tryAttachCardManually,
  trySetPhaseStepManually,
  resetLoopDetector,
} from './actions-public';
