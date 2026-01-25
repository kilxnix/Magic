/**
 * AI Module
 *
 * Basic AI for Commander gameplay. Aligned with bracket difficulty levels.
 */

// Types
export type {
  AIAction,
  CastSpellAction,
  PlayLandAction,
  ActivateManaAbilityAction,
  DeclareAttackersAction,
  DeclareBlockersAction,
  PassPriorityAction,
  AIDifficulty,
  AIPlayerConfig,
  ActionEvaluation,
} from './types';

// Legal action generation
export {
  getLegalActions,
  hasPriority,
  getSpellTargetSpecs,
  getLegalTargets,
} from './legal-actions';

// Evaluation
export {
  evaluateCreature,
  evaluatePlayerPosition,
  evaluateGameState,
  evaluateAction,
  evaluateActions,
  getBestAction,
} from './evaluate';

// Target selection
export {
  scoreRemovalTarget,
  scoreDamageTarget,
  scoreCreatureDamageTarget,
  selectRemovalTargets,
  selectDamageTargets,
  selectTargetsForSpell,
  selectBestAttackTarget,
} from './targeting';
export type { TargetSelection } from './targeting';

// Agent
export {
  makeDecision,
  applyAction,
  runAITurn,
  isAIPlayer,
  createAIConfig,
} from './agent';
export type { AIDecision } from './agent';
