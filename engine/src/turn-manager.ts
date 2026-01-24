import { GameState, Phase, Step } from './types';

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
  const currentIndex = STEP_ORDER.indexOf(state.step);

  if (currentIndex === STEP_ORDER.length - 1) {
    return advanceToNextTurn(state);
  }

  const nextStep = STEP_ORDER[currentIndex + 1];
  const nextPhase = derivePhase(state.step, nextStep);

  const updatedPlayers = state.players.map(p => ({
    ...p,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  }));

  return {
    ...state,
    step: nextStep,
    phase: nextPhase,
    players: updatedPlayers,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}

export function advanceToNextTurn(state: GameState): GameState {
  const playerCount = state.players.length;
  let nextIndex = (state.activePlayerIndex + 1) % playerCount;

  let attempts = 0;
  while (state.players[nextIndex].hasLost && attempts < playerCount) {
    nextIndex = (nextIndex + 1) % playerCount;
    attempts++;
  }

  const updatedPlayers = state.players.map((p, i) => {
    if (i === nextIndex) {
      return { ...p, hasPlayedLand: false, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } };
    }
    return { ...p, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } };
  });

  return {
    ...state,
    players: updatedPlayers,
    activePlayerIndex: nextIndex,
    priorityPlayerIndex: nextIndex,
    phase: 'beginning',
    step: 'untap',
    turnNumber: state.turnNumber + 1,
    hasPriorityPassed: new Array(playerCount).fill(false),
  };
}

export function performUntapStep(state: GameState): GameState {
  const activePlayerId = state.players[state.activePlayerIndex].id;
  const newCards = new Map(state.cards);

  for (const [id, card] of newCards) {
    if (card.ownerId === activePlayerId && card.zone === 'battlefield') {
      newCards.set(id, { ...card, tapped: false, summoningSick: false });
    }
  }

  return { ...state, cards: newCards };
}
