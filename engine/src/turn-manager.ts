import { GameState, Phase, Step } from './types';
import { checkTriggersForEvent } from './stack';
import { pruneDamagePreventionEffects } from './effects/replacement';
import { getCardDefinition } from './game-state';

export const STEP_ORDER: Step[] = [
  'untap', 'upkeep', 'draw',
  'begin_combat', 'declare_attackers', 'declare_blockers',
  'first_strike_damage', 'combat_damage', 'end_of_combat',
  'end', 'cleanup',
];

const STEP_TO_PHASE: Record<Step, Phase> = {
  untap: 'beginning',
  upkeep: 'beginning',
  draw: 'beginning',
  begin_combat: 'combat',
  declare_attackers: 'combat',
  declare_blockers: 'combat',
  first_strike_damage: 'combat',
  combat_damage: 'combat',
  end_of_combat: 'combat',
  end: 'ending',
  cleanup: 'ending',
};

function derivePhase(currentStep: Step, nextStep: Step): Phase {
  if (currentStep === 'draw' && nextStep === 'begin_combat') {
    return 'precombat_main';
  }
  if (currentStep === 'end_of_combat' && nextStep === 'end') {
    return 'postcombat_main';
  }
  return STEP_TO_PHASE[nextStep];
}

export function advanceStep(state: GameState): GameState {
  state = pruneDamagePreventionEffects(state);
  const currentIndex = STEP_ORDER.indexOf(state.step);

  if (currentIndex === STEP_ORDER.length - 1) {
    return advanceToNextTurn(state);
  }

  const nextStep = STEP_ORDER[currentIndex + 1];
  const nextPhase = derivePhase(state.step, nextStep);

  const updatedPlayers = state.players.map(p => ({
    ...p,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    snowManaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    restrictedMana: [],
    conditionalMana: [],
  }));

  let nextState: GameState = {
    ...state,
    step: nextStep,
    phase: nextPhase,
    players: updatedPlayers,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
    combat: state.step === 'end_of_combat' ? null : state.combat,
  };

  const activePlayerId = nextState.players[nextState.activePlayerIndex].id;
  if (nextStep === 'upkeep') {
    nextState = checkTriggersForEvent(nextState, { kind: 'UpkeepStart', activePlayerId });
  } else if (state.step === 'begin_combat' && nextStep === 'declare_attackers') {
    nextState = checkTriggersForEvent(nextState, { kind: 'BeginningCombatStart', activePlayerId });
  } else if (nextStep === 'end') {
    nextState = checkTriggersForEvent(nextState, { kind: 'EndStepStart', activePlayerId });
  }

  return nextState;
}

export function advanceToNextTurn(state: GameState): GameState {
  state = pruneDamagePreventionEffects(state);
  const playerCount = state.players.length;
  let nextIndex = (state.activePlayerIndex + 1) % playerCount;

  let attempts = 0;
  while (state.players[nextIndex].hasLost && attempts < playerCount) {
    nextIndex = (nextIndex + 1) % playerCount;
    attempts++;
  }

  const updatedPlayers = state.players.map((p, i) => {
    if (i === nextIndex) {
      return { ...p, hasPlayedLand: false, landsPlayedThisTurn: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, snowManaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, restrictedMana: [], conditionalMana: [] };
    }
    return { ...p, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, snowManaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, restrictedMana: [], conditionalMana: [] };
  });

  return {
    ...state,
    players: updatedPlayers,
    activePlayerIndex: nextIndex,
    priorityPlayerIndex: nextIndex,
    phase: 'beginning',
    step: 'untap',
    turnNumber: state.turnNumber + 1,
    spellsCastThisTurn: 0,
    hasPriorityPassed: new Array(playerCount).fill(false),
    combat: null,
    damagePreventionEffects: [],
  };
}

export function performUntapStep(state: GameState): GameState {
  const activePlayerId = state.players[state.activePlayerIndex].id;
  const newCards = new Map(state.cards);

  const isPreventedFromUntapping = (cardId: string): boolean => {
    for (const attached of state.cards.values()) {
      if (attached.zone !== 'battlefield' || attached.attachedTo !== cardId) continue;
      const def = getCardDefinition(state, attached);
      if (/\b(?:enchanted|equipped) creature doesn't untap during its controller's untap step\b/i.test(def.oracle_text)) {
        return true;
      }
    }
    return false;
  };

  for (const [id, card] of newCards) {
    if (card.zone !== 'battlefield') continue;
    if (card.ownerId !== activePlayerId) continue;
    if (!card.tapped) {
      // Not tapped — still clear summoningSick so it can act this turn
      newCards.set(id, { ...card, summoningSick: false });
      continue;
    }

    const stunCount = card.counters['stun'] ?? 0;
    if (stunCount > 0) {
      const newCounters: Record<string, number> = { ...card.counters, stun: stunCount - 1 };
      if (newCounters.stun === 0) delete newCounters.stun;
      newCards.set(id, { ...card, counters: newCounters });
      // stays tapped
    } else if (isPreventedFromUntapping(id)) {
      newCards.set(id, { ...card, summoningSick: false });
    } else {
      newCards.set(id, { ...card, tapped: false, summoningSick: false });
    }
  }

  return { ...state, cards: newCards };
}
