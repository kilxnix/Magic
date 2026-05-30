import {
  applyClientActionRequest,
  createClientActionRequest,
  evaluateActions,
  getCardDefinition,
  type AIAction,
  type GameState,
} from 'commander-engine';

export type DecisionConfidence = 'high' | 'medium' | 'low';

export interface DecisionAlternative {
  actionType: string;
  label: string;
  score: number;
  reasoning?: string;
}

export interface DecisionReview {
  schemaVersion: 1;
  evaluator: 'engine-heuristic-v1';
  decisionId: string;
  phase: string;
  step: string;
  legalActionCount: number;
  selected: DecisionAlternative;
  best?: DecisionAlternative;
  alternatives: DecisionAlternative[];
  scoreDelta: number;
  confidence: DecisionConfidence;
  confidenceReasons: string[];
  rulesAudit: {
    ok: boolean;
    reason?: string;
    message?: string;
  };
  elapsedMs: number;
}

export interface ReviewableLegalAction {
  kind: string;
  label: string;
  cardName?: string;
  _engineAction: AIAction;
}

export type ReviewRating = 'excellent' | 'good' | 'okay' | 'bad' | 'blunder';

export function actionIdentity(action: AIAction): string {
  switch (action.kind) {
    case 'CastSpell':
      return `${action.kind}:${action.cardInstanceId}:${action.targets.join(',')}:${action.chosenModes?.join(',') || ''}`;
    case 'PlayLand':
    case 'ActivateManaAbility':
      return `${action.kind}:${action.cardInstanceId}`;
    case 'ActivateAbility':
      return `${action.kind}:${action.cardInstanceId}:${action.abilityIndex}:${action.targets.join(',')}`;
    case 'DeclareAttackers':
      return `${action.kind}:${action.attacks.map(a => `${a.cardInstanceId}>${a.defendingPlayerId}`).join(',')}`;
    case 'DeclareBlockers':
      return `${action.kind}:${action.blocks.map(b => `${b.cardInstanceId}>${b.blockingAttackerId}`).join(',')}`;
    case 'Equip':
      return `${action.kind}:${action.equipmentInstanceId}>${action.targetCreatureId}`;
    case 'ManualUntapManaSource':
      return `${action.kind}:${action.cardInstanceId}:${action.color}:${action.amount}`;
    case 'ManualAdjustCounters':
      return `${action.kind}:${action.cardInstanceId}:${action.counterType}:${action.delta}`;
    case 'ManualAdjustPlayerCounter':
      return `${action.kind}:${action.playerId}:${action.counterType}:${action.delta}`;
    case 'ManualAdjustCommanderDamage':
      return `${action.kind}:${action.playerId}:${action.commanderInstanceId}:${action.delta}`;
    case 'ManualMoveCard':
      return `${action.kind}:${action.cardInstanceId}:${action.zone}`;
    case 'ManualAdjustDamage':
      return `${action.kind}:${action.cardInstanceId}:${action.delta}`;
    case 'ManualCreateToken':
      return `${action.kind}:${action.name}:${action.count}:${action.power}/${action.toughness}:${action.colors.join(',')}:${action.types.join(',')}:${action.subtypes.join(',')}:${action.keywords?.join(',') || ''}`;
    case 'ManualAttachCard':
      return `${action.kind}:${action.cardInstanceId}>${action.targetId || 'detached'}`;
    case 'ManualSetPhaseStep':
      return `${action.kind}:${action.activePlayerId}:${action.phase}:${action.step}`;
    case 'PassPriority':
      return action.kind;
    default:
      return 'Unknown';
  }
}

export function describeReviewAction(state: GameState, action: AIAction): string {
  switch (action.kind) {
    case 'CastSpell': {
      const inst = state.cards.get(action.cardInstanceId);
      const def = inst ? getCardDefinition(state, inst) : undefined;
      return `Cast ${def?.name || 'a spell'}`;
    }
    case 'PlayLand': {
      const inst = state.cards.get(action.cardInstanceId);
      const def = inst ? getCardDefinition(state, inst) : undefined;
      return `Play ${def?.name || 'a land'}`;
    }
    case 'ActivateManaAbility': {
      const inst = state.cards.get(action.cardInstanceId);
      const def = inst ? getCardDefinition(state, inst) : undefined;
      return `Tap ${def?.name || 'a permanent'} for ${action.color}`;
    }
    case 'ActivateAbility': {
      const inst = state.cards.get(action.cardInstanceId);
      const def = inst ? getCardDefinition(state, inst) : undefined;
      return `Activate ${def?.name || 'an ability'}`;
    }
    case 'DeclareAttackers':
      return action.attacks.length > 0
        ? `Attack with ${action.attacks.length} creature${action.attacks.length === 1 ? '' : 's'}`
        : 'Do not attack';
    case 'DeclareBlockers':
      return action.blocks.length > 0
        ? `Block with ${action.blocks.length} creature${action.blocks.length === 1 ? '' : 's'}`
        : 'Do not block';
    case 'Equip': {
      const equipment = state.cards.get(action.equipmentInstanceId);
      const target = state.cards.get(action.targetCreatureId);
      const equipmentDef = equipment ? getCardDefinition(state, equipment) : undefined;
      const targetDef = target ? getCardDefinition(state, target) : undefined;
      return `Equip ${equipmentDef?.name || 'equipment'} to ${targetDef?.name || 'creature'}`;
    }
    case 'ManualUntapManaSource': {
      const inst = state.cards.get(action.cardInstanceId);
      const def = inst ? getCardDefinition(state, inst) : undefined;
      return `Undo ${action.color} mana from ${def?.name || 'a mana source'}`;
    }
    case 'ManualAdjustCounters': {
      const inst = state.cards.get(action.cardInstanceId);
      const def = inst ? getCardDefinition(state, inst) : undefined;
      const sign = action.delta > 0 ? '+' : '';
      return `${sign}${action.delta} ${action.counterType} counter on ${def?.name || 'a permanent'}`;
    }
    case 'ManualAdjustPlayerCounter': {
      const player = state.players.find(candidate => candidate.id === action.playerId);
      const sign = action.delta > 0 ? '+' : '';
      return `${sign}${action.delta} ${action.counterType} counter on ${player?.name || 'a player'}`;
    }
    case 'ManualAdjustCommanderDamage': {
      const player = state.players.find(candidate => candidate.id === action.playerId);
      const commander = state.cards.get(action.commanderInstanceId);
      const commanderDef = commander ? getCardDefinition(state, commander) : undefined;
      const sign = action.delta > 0 ? '+' : '';
      return `${sign}${action.delta} commander damage to ${player?.name || 'a player'} from ${commanderDef?.name || 'a commander'}`;
    }
    case 'ManualMoveCard': {
      const inst = state.cards.get(action.cardInstanceId);
      const def = inst ? getCardDefinition(state, inst) : undefined;
      return `Move ${def?.name || 'a card'} to ${action.zone}`;
    }
    case 'ManualAdjustDamage': {
      const inst = state.cards.get(action.cardInstanceId);
      const def = inst ? getCardDefinition(state, inst) : undefined;
      const sign = action.delta > 0 ? '+' : '';
      return `${sign}${action.delta} marked damage on ${def?.name || 'a permanent'}`;
    }
    case 'ManualCreateToken':
      return `Create ${action.count} ${action.name} token${action.count === 1 ? '' : 's'}`;
    case 'ManualAttachCard': {
      const inst = state.cards.get(action.cardInstanceId);
      const target = action.targetId ? state.cards.get(action.targetId) : undefined;
      const def = inst ? getCardDefinition(state, inst) : undefined;
      const targetDef = target ? getCardDefinition(state, target) : undefined;
      return action.targetId
        ? `Attach ${def?.name || 'a card'} to ${targetDef?.name || 'a permanent'}`
        : `Detach ${def?.name || 'a card'}`;
    }
    case 'ManualSetPhaseStep': {
      const player = state.players.find(candidate => candidate.id === action.activePlayerId);
      return `Set turn to ${player?.name || 'a player'} ${action.phase}/${action.step}`;
    }
    case 'PassPriority':
      return 'Pass priority';
    default:
      return 'Take action';
  }
}

export function isLikelyInfiniteComboAction(state: GameState, action: AIAction): boolean {
  const cardInstanceId =
    action.kind === 'CastSpell' || action.kind === 'ActivateAbility' || action.kind === 'ActivateManaAbility'
      ? action.cardInstanceId
      : action.kind === 'Equip'
        ? action.equipmentInstanceId
        : undefined;
  if (!cardInstanceId) return false;
  const inst = state.cards.get(cardInstanceId);
  const def = inst ? getCardDefinition(state, inst) : undefined;
  if (!def) return false;
  const text = `${def.name}\n${def.oracle_text}`.toLowerCase();
  return /\binfinite\b|\bcombo\b|repeat this process|any number of times|arbitrarily/.test(text);
}

export function ratingFromDecisionDelta(delta: number, selectedIsBest: boolean): ReviewRating {
  if (selectedIsBest || delta <= 0.5) return 'excellent';
  if (delta <= 1.5) return 'good';
  if (delta <= 4) return 'okay';
  if (delta <= 8) return 'bad';
  return 'blunder';
}

export function buildDecisionReview(
  state: GameState,
  playerId: string,
  selectedAction: ReviewableLegalAction,
  legalActions: ReviewableLegalAction[],
): DecisionReview | undefined {
  const started = Date.now();
  const selectedIdentity = actionIdentity(selectedAction._engineAction);
  const rawReviewableActions = legalActions
    .filter(action => action._engineAction && action.kind !== 'ActivateManaAbility')
    .slice(0, 50);
  const comboFilteredCount = rawReviewableActions.filter(action =>
    actionIdentity(action._engineAction) !== selectedIdentity
    && isLikelyInfiniteComboAction(state, action._engineAction)
  ).length;
  const reviewableActions = rawReviewableActions.filter(action =>
    actionIdentity(action._engineAction) === selectedIdentity
    || !isLikelyInfiniteComboAction(state, action._engineAction)
  );

  if (reviewableActions.length === 0) return undefined;

  const ranked = evaluateActions(state, playerId, reviewableActions.map(action => action._engineAction));
  const selectedEval = ranked.find(evaluation => actionIdentity(evaluation.action) === selectedIdentity);
  const selectedScore = selectedEval?.score ?? 0;

  const alternatives = ranked.slice(0, 8).map(evaluation => {
    const matchingAction = reviewableActions.find(action => (
      actionIdentity(action._engineAction) === actionIdentity(evaluation.action)
    ));
    return {
      actionType: evaluation.action.kind,
      label: matchingAction?.label || describeReviewAction(state, evaluation.action),
      score: Number(evaluation.score.toFixed(1)),
      reasoning: evaluation.reasoning,
    };
  });

  const selected: DecisionAlternative = {
    actionType: selectedAction._engineAction.kind,
    label: selectedAction.label || selectedAction.cardName || describeReviewAction(state, selectedAction._engineAction),
    score: Number(selectedScore.toFixed(1)),
    reasoning: selectedEval?.reasoning,
  };
  const best = alternatives[0];
  const scoreDelta = Number(Math.max(0, (best?.score ?? selected.score) - selected.score).toFixed(1));
  const confidenceReasons: string[] = [];

  if (!selectedEval) {
    confidenceReasons.push('Selected action was not found in the engine-ranked action list.');
  }
  if (reviewableActions.length > 25) {
    confidenceReasons.push('Large decision tree was capped for speed.');
  }
  if (comboFilteredCount > 0) {
    confidenceReasons.push('Likely infinite-combo lines are excluded from general coaching suggestions.');
  }
  if (
    selectedAction._engineAction.kind === 'CastSpell' &&
    selectedAction._engineAction.targets.length === 0
  ) {
    confidenceReasons.push('Target or mode quality was not deeply evaluated.');
  }
  if (!best || reviewableActions.length <= 1) {
    confidenceReasons.push('Only one meaningful available action was visible to the current engine.');
  }

  const selectedRequest = createClientActionRequest(state, playerId, selectedAction._engineAction, {
    source: 'system',
    label: selectedAction.label || describeReviewAction(state, selectedAction._engineAction),
  });
  const selectedAudit = applyClientActionRequest(state, selectedRequest);
  if (!selectedAudit.ok) {
    confidenceReasons.push(`Rules audit rejected selected action: ${selectedAudit.message || selectedAudit.reason || 'illegal action'}.`);
  }

  const confidence: DecisionConfidence = !selectedEval || !selectedAudit.ok || confidenceReasons.length >= 2
    ? 'low'
    : confidenceReasons.length === 1
      ? 'medium'
    : 'high';

  return {
    schemaVersion: 1,
    evaluator: 'engine-heuristic-v1',
    decisionId: `${state.turnNumber}:${state.phase}:${state.step}:${started}`,
    phase: state.phase,
    step: state.step,
    legalActionCount: reviewableActions.length,
    selected,
    best,
    alternatives,
    scoreDelta,
    confidence,
    confidenceReasons,
    rulesAudit: {
      ok: selectedAudit.ok,
      reason: selectedAudit.reason,
      message: selectedAudit.message,
    },
    elapsedMs: Date.now() - started,
  };
}

export function coachMessageFromDecision(review: DecisionReview): string | null {
  if (review.legalActionCount <= 1 || !review.best) return null;
  const selectedIsBest = review.best.label === review.selected.label && review.scoreDelta <= 0.5;
  if (selectedIsBest) return 'Strong practice action.';
  if (review.scoreDelta < 1) return 'Good practice action (close to the current engine preference).';
  return `Consider: ${review.best.label} (score ${review.best.score.toFixed(1)} vs your ${review.selected.score.toFixed(1)}). ${review.best.reasoning || ''}`.trim();
}

export function playByPlayFromDecision(action: string, review?: DecisionReview): string {
  if (!review || !review.best || review.legalActionCount <= 1) {
    return `${action}.`;
  }

  const selectedIsBest = review.best.label === review.selected.label && review.scoreDelta <= 0.5;
  if (selectedIsBest) {
    return `${action}. The engine review agreed this was a strong available line.`;
  }

  if (review.scoreDelta <= 1.5) {
    return `${action}. This was close to another available line, with ${review.best.label} rated slightly higher.`;
  }

  return `${action}. The review preferred ${review.best.label} by ${review.scoreDelta.toFixed(1)} points.`;
}
