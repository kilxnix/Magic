import { GameState, Phase, StackItem } from './types';
import { getCardDefinition } from './game-state';
import { parseManaString, canPayCost, payManaCost } from './mana';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];
const PERMANENT_TYPES = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'];

let stackCounter = 0;

export function canCastSpell(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'hand') return false;

  const def = getCardDefinition(state, card);

  // Lands are not cast
  if (def.card_types.includes('land')) return false;

  const isInstant = def.card_types.includes('instant');
  const hasFlash = def.keywords.includes('Flash');

  // Sorcery-speed: must be main phase, active player, empty stack
  if (!isInstant && !hasFlash) {
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (state.activePlayerIndex !== playerIndex) return false;
    if (!MAIN_PHASES.includes(state.phase)) return false;
    if (state.stack.length > 0) return false;
  }

  // Check mana
  const cost = parseManaString(def.mana_cost);
  const player = state.players.find(p => p.id === playerId)!;
  if (!canPayCost(player.manaPool, cost)) return false;

  return true;
}

export function castSpell(state: GameState, playerId: string, cardInstanceId: string, targets: string[] = []): GameState {
  if (!canCastSpell(state, playerId, cardInstanceId)) {
    throw new Error('Cannot cast spell');
  }

  const card = state.cards.get(cardInstanceId)!;
  const def = getCardDefinition(state, card);
  const cost = parseManaString(def.mana_cost);

  // Pay mana
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const newManaPool = payManaCost(player.manaPool, cost);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, manaPool: newManaPool } : p
  );

  // Move card to stack zone
  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, zone: 'stack' as const });

  // Add to stack
  const stackItem: StackItem = {
    id: `stack_${++stackCounter}`,
    cardInstanceId,
    casterId: playerId,
    targets,
  };

  return {
    ...state,
    cards: newCards,
    players: newPlayers,
    stack: [...state.stack, stackItem],
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}

export function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    throw new Error('Stack is empty');
  }

  const topItem = state.stack[state.stack.length - 1];
  const newStack = state.stack.slice(0, -1);

  const card = state.cards.get(topItem.cardInstanceId)!;
  const def = state.cardDefinitions.get(card.definitionId)!;

  const newCards = new Map(state.cards);
  const isPermanent = def.card_types.some(t => PERMANENT_TYPES.includes(t));

  if (isPermanent) {
    const isCreature = def.card_types.includes('creature');
    newCards.set(card.instanceId, {
      ...card,
      zone: 'battlefield',
      tapped: false,
      summoningSick: isCreature,
    });
  } else {
    // Instants and sorceries go to graveyard
    newCards.set(card.instanceId, { ...card, zone: 'graveyard' });
  }

  return {
    ...state,
    cards: newCards,
    stack: newStack,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
