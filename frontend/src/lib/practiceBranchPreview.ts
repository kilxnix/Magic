import {
  applyClientActionRequest,
  createClientActionRequest,
  deserializeGameState,
  evaluateActions,
  getCardsInZone,
  getCardDefinition,
  type AIAction,
  type SerializedGameStateV1,
} from 'commander-engine';
import type { SimpleLegalAction } from '../hooks/useShelectorGame';

export interface PracticeBranchPreview {
  actionId: string;
  label: string;
  ok: boolean;
  score?: number;
  summary: string;
  warnings: string[];
}

function actionPreviewId(action: AIAction, index: number): string {
  const cardId = 'cardInstanceId' in action ? action.cardInstanceId : '';
  return `${action.kind}:${cardId}:${index}`;
}

function visibleBoardSummary(state: ReturnType<typeof deserializeGameState>, playerId: string): {
  life: number;
  hand: number;
  battlefield: number;
  graveyard: number;
  stack: number;
} {
  const player = state.players.find(candidate => candidate.id === playerId);
  return {
    life: player?.life ?? 0,
    hand: getCardsInZone(state, playerId, 'hand').length,
    battlefield: getCardsInZone(state, playerId, 'battlefield').length,
    graveyard: getCardsInZone(state, playerId, 'graveyard').length,
    stack: state.stack.length,
  };
}

function deltaLabel(before: number, after: number, label: string): string | null {
  if (before === after) return null;
  const sign = after > before ? '+' : '';
  return `${label} ${sign}${after - before}`;
}

function summarizePreview(
  before: ReturnType<typeof visibleBoardSummary>,
  after: ReturnType<typeof visibleBoardSummary>,
  phase: string,
  step: string,
  action?: AIAction,
): string {
  if (action?.kind === 'DeclareBlockers') {
    return action.blocks.length > 0
      ? `Blocks assigned: ${action.blocks.length}; then ${phase}/${step}`
      : `No blockers declared; then ${phase}/${step}`;
  }
  if (action?.kind === 'DeclareAttackers') {
    return action.attacks.length > 0
      ? `Attackers declared: ${action.attacks.length}; then ${phase}/${step}`
      : `No attackers declared; then ${phase}/${step}`;
  }
  const deltas = [
    deltaLabel(before.life, after.life, 'life'),
    deltaLabel(before.hand, after.hand, 'hand'),
    deltaLabel(before.battlefield, after.battlefield, 'board'),
    deltaLabel(before.graveyard, after.graveyard, 'graveyard'),
    deltaLabel(before.stack, after.stack, 'stack'),
  ].filter(Boolean);
  return deltas.length > 0
    ? `${deltas.join(' / ')}; then ${phase}/${step}`
    : `No visible count change; then ${phase}/${step}`;
}

function previewWarnings(label: string, summary: string): string[] {
  const combined = `${label}\n${summary}`.toLowerCase();
  const warnings: string[] = [];
  if (/xenagos|attack|anzrag|hellkite charger|savage ventmaw/.test(combined)) {
    warnings.push('Check Xenagos target, forced attacks, and extra-combat mana before committing.');
  }
  if (/dracogenesis|terror of the peaks|twinflame tyrant|dragonhawk|etb/.test(combined)) {
    warnings.push('Trigger ordering and target choice can change lethal damage.');
  }
  if (/tutor|natural order|tooth and nail|green sun/.test(combined)) {
    warnings.push('Tutor lines should be compared against the next-turn payoff, not just this action.');
  }
  return warnings.slice(0, 2);
}

export function buildPracticeBranchPreviews(input: {
  serializedState?: SerializedGameStateV1 | null;
  playerId: string;
  legalActions: SimpleLegalAction[];
  max?: number;
}): PracticeBranchPreview[] {
  if (!input.serializedState) return [];
  const serializedState = input.serializedState;
  const max = input.max ?? 4;
  try {
    const state = deserializeGameState(serializedState);
    const reviewable = input.legalActions
      .filter(action => action._engineAction && !['ActivateManaAbility'].includes(action.kind))
      .slice(0, 16);
    const ranked = evaluateActions(state, input.playerId, reviewable.map(action => action._engineAction));
    const scoreByKind = new Map(ranked.map(entry => [JSON.stringify(entry.action), entry.score]));
    const before = visibleBoardSummary(state, input.playerId);

    return reviewable.slice(0, max).map((action, index) => {
      const branchState = deserializeGameState(serializedState);
      const request = createClientActionRequest(branchState, input.playerId, action._engineAction, {
        source: 'system',
        label: action.label,
      });
      const response = applyClientActionRequest(branchState, request);
      const afterState = response.state || branchState;
      const after = visibleBoardSummary(afterState, input.playerId);
      const summary = response.ok
        ? summarizePreview(before, after, afterState.phase, afterState.step, action._engineAction)
        : response.message || 'This line is not currently legal from this exact state.';
      const sourceCard = action.cardInstanceId ? branchState.cards.get(action.cardInstanceId) : undefined;
      const sourceName = sourceCard ? getCardDefinition(branchState, sourceCard).name : action.cardName;
      const label = action.label || sourceName || action.kind;
      return {
        actionId: actionPreviewId(action._engineAction, index),
        label,
        ok: response.ok,
        score: scoreByKind.get(JSON.stringify(action._engineAction)),
        summary,
        warnings: previewWarnings(label, summary),
      };
    });
  } catch {
    return [];
  }
}
