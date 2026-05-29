import type { SimpleCard, SimpleGameState, SimpleLegalAction } from '../hooks/useShelectorGame';

export type NewPlayerSuggestionKind =
  | 'land'
  | 'mana'
  | 'spell'
  | 'combat'
  | 'block'
  | 'response'
  | 'utility'
  | 'pass';

export interface NewPlayerSuggestion {
  action: SimpleLegalAction;
  actionLabel: string;
  reason: string;
  kind: NewPlayerSuggestionKind;
}

const CARD_ACTION_KINDS = new Set([
  'CastSpell',
  'PlayLand',
  'ActivateManaAbility',
  'ActivateAbility',
  'Equip',
]);

function actionName(action: SimpleLegalAction): string {
  return action.cardName || action.label || action.kind;
}

function findHumanCard(gameState: SimpleGameState, action: SimpleLegalAction): SimpleCard | undefined {
  if (!action.cardInstanceId) return undefined;
  return [
    ...gameState.humanHand,
    ...gameState.humanBattlefield,
    ...gameState.humanCommandZone,
    ...gameState.humanGraveyard,
  ].find(card => card.instanceId === action.cardInstanceId);
}

function hasInstantSorceryPayoff(gameState: SimpleGameState): boolean {
  return gameState.humanBattlefield.some(card =>
    /whenever you cast an instant or sorcery/i.test(card.oracleText),
  );
}

function isInstantOrSorcery(card?: SimpleCard): boolean {
  return !!card && (card.cardTypes.includes('instant') || card.cardTypes.includes('sorcery'));
}

function isLikelyInfiniteCombo(card?: SimpleCard): boolean {
  if (!card) return false;
  const text = `${card.name}\n${card.oracleText}`.toLowerCase();
  return /\binfinite\b|\bcombo\b|repeat this process|any number of times|arbitrarily/.test(text);
}

function chooseCastAction(
  gameState: SimpleGameState,
  legalActions: SimpleLegalAction[],
): SimpleLegalAction | undefined {
  const castActions = legalActions.filter(action => action.kind === 'CastSpell');
  if (castActions.length === 0) return undefined;
  const nonComboCastActions = castActions.filter(action =>
    !isLikelyInfiniteCombo(findHumanCard(gameState, action)),
  );
  if (nonComboCastActions.length === 0) return undefined;

  if (hasInstantSorceryPayoff(gameState)) {
    return nonComboCastActions.find(action => isInstantOrSorcery(findHumanCard(gameState, action))) || nonComboCastActions[0];
  }

  return nonComboCastActions[0];
}

function castReason(card?: SimpleCard): string {
  if (!card) return 'Use your available mana on an available spell instead of passing with resources unused.';

  const text = card.oracleText.toLowerCase();
  if (card.cardTypes.includes('creature')) {
    return 'This develops your board and gives you more pressure or blockers for the next turn cycle.';
  }
  if (text.includes('draw')) {
    return 'This turns mana into more cards, which helps you keep making plays.';
  }
  if (/(destroy|exile|counter target|deals? \d+ damage)/.test(text)) {
    return 'This can answer a threat while you have the mana and priority to use it.';
  }
  if (card.cardTypes.includes('artifact') || card.cardTypes.includes('enchantment')) {
    return 'This adds a permanent that can keep helping after the turn passes.';
  }
  return 'This uses your current mana and moves the turn forward with a practice action.';
}

function cardActionReason(action: SimpleLegalAction, card?: SimpleCard): string {
  if (action.kind === 'Equip') {
    return 'Equipment is usually best before combat so the creature attacks or blocks with the bonus.';
  }
  if (card?.oracleText.toLowerCase().includes('draw')) {
    return 'Card advantage helps newer turns stay smoother and gives you more choices.';
  }
  return 'This is the most useful noncombat action available before you pass priority.';
}

function chooseNonSkip(actions: SimpleLegalAction[]): SimpleLegalAction | undefined {
  return actions.find(action => !/(skip|no attack|no block|pass)/i.test(action.label)) || actions[0];
}

export function getNewPlayerSuggestion(
  gameState: SimpleGameState,
  legalActions: SimpleLegalAction[],
): NewPlayerSuggestion | null {
  if (gameState.gameOver || legalActions.length === 0) return null;

  const passAction = legalActions.find(action => action.kind === 'PassPriority');
  const playLandAction = legalActions.find(action => action.kind === 'PlayLand');
  const castAction = chooseCastAction(gameState, legalActions);
  const manaAction = legalActions.find(action => action.kind === 'ActivateManaAbility');
  const utilityAction = legalActions.find(action =>
    action.cardInstanceId &&
    CARD_ACTION_KINDS.has(action.kind) &&
    !['CastSpell', 'PlayLand', 'ActivateManaAbility'].includes(action.kind)
  );
  const attackAction = chooseNonSkip(legalActions.filter(action => action.kind === 'DeclareAttackers'));
  const blockAction = chooseNonSkip(legalActions.filter(action => action.kind === 'DeclareBlockers'));
  const stackHasItems = gameState.stack.length > 0;
  const isMainPhase = gameState.phase === 'precombat_main' || gameState.phase === 'postcombat_main';

  if (stackHasItems) {
    const responseAction = castAction || utilityAction;
    if (responseAction) {
      return {
        action: responseAction,
        actionLabel: actionName(responseAction),
        reason: 'There is something on the stack. Use this now if you want to respond before it resolves.',
        kind: 'response',
      };
    }
    if (passAction) {
      return {
        action: passAction,
        actionLabel: passAction.label,
        reason: 'Nothing useful is available, so passing lets the top stack item resolve.',
        kind: 'pass',
      };
    }
  }

  if (gameState.step === 'declare_blockers' && blockAction) {
    return {
      action: blockAction,
      actionLabel: blockAction.label,
      reason: /skip|no block/i.test(blockAction.label)
        ? 'If blocking is bad, it is fine to take the damage and keep your creatures.'
        : 'Choose blocks now before combat damage happens.',
      kind: 'block',
    };
  }

  if (gameState.step === 'declare_attackers' && attackAction) {
    return {
      action: attackAction,
      actionLabel: attackAction.label,
      reason: /skip|no attack/i.test(attackAction.label)
        ? 'Passing combat is fine when attacks are not profitable.'
        : 'Attack when it pressures the opponent without risking too much back.',
      kind: 'combat',
    };
  }

  if (isMainPhase && playLandAction) {
    return {
      action: playLandAction,
      actionLabel: actionName(playLandAction),
      reason: 'Play a land before spending mana. More lands make the next turns easier.',
      kind: 'land',
    };
  }

  if (castAction) {
    const card = findHumanCard(gameState, castAction);
    return {
      action: castAction,
      actionLabel: actionName(castAction),
      reason: castReason(card),
      kind: 'spell',
    };
  }

  if (isMainPhase && manaAction) {
    return {
      action: manaAction,
      actionLabel: manaAction.label,
      reason: 'Tap mana sources first, then check the action bar again for spells you can cast.',
      kind: 'mana',
    };
  }

  if (utilityAction) {
    const card = findHumanCard(gameState, utilityAction);
    return {
      action: utilityAction,
      actionLabel: utilityAction.label,
      reason: cardActionReason(utilityAction, card),
      kind: 'utility',
    };
  }

  if (passAction) {
    return {
      action: passAction,
      actionLabel: passAction.label,
      reason: 'The current engine does not see a stronger available action right now, so passing is the clean next step.',
      kind: 'pass',
    };
  }

  return null;
}
