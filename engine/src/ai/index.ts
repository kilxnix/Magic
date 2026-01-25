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
  AIPersonality,
  PersonalityWeights,
  AIPlayerConfig,
  ActionEvaluation,
  DamageRecord,
  ThreatAssessment,
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

// Personalities (Phase 11)
export {
  PERSONALITY_WEIGHTS,
  getPersonalityWeights,
  getDefaultPersonality,
  applyPersonalityModifier,
  shouldSpreadAttacks,
  getGrudgeMultiplier,
} from './personalities';

// Threat Assessment (Phase 11)
export {
  assessPlayerThreat,
  assessAllThreats,
  getArchenemy,
  hasArchenemy,
  getNormalizedThreat,
} from './threat';

// Grudge System (Phase 11)
export {
  initGrudgeTracking,
  hasGrudgeTracking,
  recordDamage,
  getDamageDealt,
  getRecentDamageDealt,
  calculateGrudgeLevel,
  getMostRecentAttacker,
  getGrudgeRanking,
  shouldRetaliate,
  getGrudgeTargetingBonus,
  pruneOldRecords,
} from './grudges';
export type { GameStateWithGrudges } from './grudges';

// Deck Pool (Phase 13)
export {
  AIDeckPool,
  createPrebuiltDeck,
  loadDeckPool,
  saveDeckPool,
} from './deck-pool';
export type { PrebuiltDeck, DeckPoolConfig } from './deck-pool';
