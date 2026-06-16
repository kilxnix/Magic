import { GameState, Phase, Step } from './types';
import { checkTriggersForEvent } from './stack';
import { pruneDamagePreventionEffects } from './effects/replacement';
import { pruneGameOutcomePreventionEffects } from './game-outcome';
import { getCardDefinition } from './game-state';
import { cleanupDamage } from './state-based';
import { drawCards } from './actions';
import { getCommanderDestinationZone } from './commander';

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

const EMPTY_ATTACK_COMBAT_STEPS: Step[] = [
  'declare_attackers',
  'declare_blockers',
  'first_strike_damage',
  'combat_damage',
];

function derivePhase(currentStep: Step, nextStep: Step): Phase {
  if (currentStep === 'draw' && nextStep === 'begin_combat') {
    return 'precombat_main';
  }
  if (currentStep === 'end_of_combat' && nextStep === 'end') {
    return 'postcombat_main';
  }
  return STEP_TO_PHASE[nextStep];
}

function nextMeaningfulStep(state: GameState): Step | null {
  const currentIndex = STEP_ORDER.indexOf(state.step);
  if (currentIndex === STEP_ORDER.length - 1) return null;

  if (state.combat && state.combat.attackers.length === 0 && EMPTY_ATTACK_COMBAT_STEPS.includes(state.step)) {
    return 'end_of_combat';
  }

  return STEP_ORDER[currentIndex + 1];
}

function nextStepPriorityPlayerIndex(state: GameState, nextStep: Step): number {
  if (nextStep !== 'declare_blockers' || !state.combat?.attackers.length) {
    return state.activePlayerIndex;
  }

  const firstDefenderId = state.combat.attackers
    .map(attack => attack.defendingPlayerId)
    .find((defenderId, index, allDefenders) => allDefenders.indexOf(defenderId) === index);
  const firstDefenderIndex = state.players.findIndex(player => player.id === firstDefenderId && !player.hasLost);
  return firstDefenderIndex >= 0 ? firstDefenderIndex : state.activePlayerIndex;
}

/**
 * Slice 11: Sacrifice all permanents flagged with `sacrificeAtCleanup` by moving
 * them to their controller's graveyard (or command zone if they are commanders).
 * Called at the beginning of the cleanup step (advanceStep when nextStep === 'cleanup').
 */
function applyFlashWindowCleanupSacrifices(state: GameState): GameState {
  const toSacrifice: string[] = [];
  for (const [id, card] of state.cards) {
    if (card.zone === 'battlefield' && card.sacrificeAtCleanup) {
      toSacrifice.push(id);
    }
  }
  if (toSacrifice.length === 0) return state;

  const newCards = new Map(state.cards);
  for (const id of toSacrifice) {
    const card = newCards.get(id)!;
    const destZone = getCommanderDestinationZone(state, id, 'graveyard');
    newCards.set(id, {
      ...card,
      zone: destZone,
      tapped: false,
      damage: 0,
      attachedTo: undefined,
      sacrificeAtCleanup: undefined,
    });
    // Detach any auras/equipment that were attached to this permanent.
    for (const [otherId, other] of newCards) {
      if (other.attachedTo === id) {
        newCards.set(otherId, { ...other, attachedTo: undefined, zone: 'graveyard' });
      }
    }
  }
  return { ...state, cards: newCards };
}

export function advanceStep(state: GameState): GameState {
  state = pruneDamagePreventionEffects(state);
  state = pruneGameOutcomePreventionEffects(state);
  const nextStep = nextMeaningfulStep(state);

  if (!nextStep) {
    return advanceToNextTurn(state);
  }

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
    priorityPlayerIndex: nextStepPriorityPlayerIndex(state, nextStep),
    combat: state.step === 'end_of_combat' ? null : state.combat,
  };

  const activePlayerId = nextState.players[nextState.activePlayerIndex].id;
  if (nextStep === 'upkeep') {
    nextState = checkTriggersForEvent(nextState, { kind: 'UpkeepStart', activePlayerId });
  } else if (state.step === 'begin_combat' && nextStep === 'declare_attackers') {
    nextState = checkTriggersForEvent(nextState, { kind: 'BeginningCombatStart', activePlayerId });
  } else if (nextStep === 'end') {
    nextState = checkTriggersForEvent(nextState, { kind: 'EndStepStart', activePlayerId });
    // CR 720.4: at the beginning of the monarch's end step, that player draws a card.
    if (nextState.monarchId && nextState.monarchId === activePlayerId) {
      nextState = drawCards(nextState, activePlayerId, 1);
    }
  } else if (nextStep === 'cleanup') {
    // Slice 11: Flash-window cleanup-sacrifice (Spider Climb / Armor of Thorns family).
    // CR 702.8b: if cast any time a sorcery couldn't have been cast, the controller
    // of the permanent it becomes sacrifices it at the beginning of the next cleanup step.
    // The permanent is flagged with `sacrificeAtCleanup` at resolution (stack.ts).
    nextState = applyFlashWindowCleanupSacrifices(nextState);
  }

  return nextState;
}

export function advanceToNextTurn(state: GameState): GameState {
  state = pruneDamagePreventionEffects(state);
  state = pruneGameOutcomePreventionEffects(state);
  state = cleanupDamage(state);
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
    // Slice 2 (werewolf): snapshot the just-ended turn's spell count before clearing.
    spellsCastLastTurn: state.spellsCastThisTurn ?? 0,
    creaturesDiedThisTurn: 0,
    playersWhoAttackedThisTurn: [],
    hasPriorityPassed: new Array(playerCount).fill(false),
    combat: null,
    damagePreventionEffects: [],
    gameOutcomePreventionEffects: [],
    spellCastProhibitions: [],
    // Slice 6: Prune "until your next turn" spell-cost taxes whose controller's
    // next turn is now beginning (i.e., the new active player registered the tax).
    // All other taxes remain active.
    spellCostTaxes: (state.spellCostTaxes || []).filter(
      tax => tax.controllerId !== state.players[nextIndex].id,
    ),
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

  // CR 701.39: goad lasts "until your next turn" — when the goader's turn begins,
  // their goads end. Strip the active player from every creature's goadedBy list.
  for (const [id, card] of newCards) {
    if (!card.goadedBy || !card.goadedBy.includes(activePlayerId)) continue;
    const remaining = card.goadedBy.filter(pid => pid !== activePlayerId);
    newCards.set(id, remaining.length > 0 ? { ...card, goadedBy: remaining } : { ...card, goadedBy: undefined });
  }

  for (const [id, base] of newCards) {
    if (base.zone !== 'battlefield') continue;
    if (base.ownerId !== activePlayerId) continue;
    const card = newCards.get(id)!; // post goad-strip
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

  // Slice 1 (engine-gap): Seedborn Muse — "Untap all permanents you control
  // during each other player's untap step."
  //
  // After the active player's own permanents have been untapped, scan all
  // battlefield permanents controlled by NON-active players for the
  // UntapDuringOtherUntapSteps static (registered via
  // registerContinuousAbilitiesForPermanent).  For each such controller, untap
  // ALL permanents they control (same stun/prevent-lock rules do NOT apply here
  // because CR 702.108 and the Seedborn Muse oracle give unconditional untap).
  const seedbornControllers = new Set<string>();
  for (const effect of (state.continuousEffects ?? [])) {
    const mod = effect.ability.modifier;
    if (mod.kind !== 'UntapDuringOtherUntapSteps') continue;
    // Source permanent must still be on the battlefield.
    const source = newCards.get(effect.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;
    // The controlling player must NOT be the active player (we untap during
    // OTHER players' untap steps, not our own).
    if (effect.controllerId === activePlayerId) continue;
    seedbornControllers.add(effect.controllerId);
  }

  if (seedbornControllers.size > 0) {
    for (const [id, card] of newCards) {
      if (card.zone !== 'battlefield') continue;
      if (!seedbornControllers.has(card.ownerId)) continue;
      if (!card.tapped) continue;
      newCards.set(id, { ...card, tapped: false });
    }
  }

  return { ...state, cards: newCards };
}
