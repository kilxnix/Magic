import type { CardDefinition, GameState, ManaCost, StackItem } from './types';
import { getCommanderDestinationZone } from './commander';
import { getCardDefinition } from './game-state';
import { canPayUnrestrictedCost, parseManaString, payUnrestrictedManaCost } from './mana';

type WardCost =
  | { kind: 'mana'; cost: ManaCost }
  | { kind: 'life'; amount: number };

function parseWardCost(def: CardDefinition): WardCost | null {
  const text = def.oracle_text || '';
  const match = text.match(/\bward\s*(?:[\u2014\u2013-]\s*)?(\{[^.\n]+}|\d+|pay\s+\d+\s+life)/i);
  if (!match) return null;

  const raw = match[1].trim();
  const lifeMatch = raw.match(/^pay\s+(\d+)\s+life$/i);
  if (lifeMatch) return { kind: 'life', amount: parseInt(lifeMatch[1], 10) };
  if (/^\d+$/.test(raw)) return { kind: 'mana', cost: parseManaString(`{${raw}}`) };
  if (raw.startsWith('{')) return { kind: 'mana', cost: parseManaString(raw) };
  return null;
}

function canPayWard(state: GameState, playerId: string, cost: WardCost): boolean {
  const player = state.players.find(candidate => candidate.id === playerId);
  if (!player) return false;
  if (cost.kind === 'life') return player.life >= cost.amount;
  return canPayUnrestrictedCost(player, cost.cost);
}

function payWard(state: GameState, playerId: string, cost: WardCost): GameState {
  const playerIndex = state.players.findIndex(candidate => candidate.id === playerId);
  if (playerIndex === -1) return state;

  const paidPlayer = cost.kind === 'life'
    ? { ...state.players[playerIndex], life: state.players[playerIndex].life - cost.amount }
    : payUnrestrictedManaCost(state.players[playerIndex], cost.cost);

  return {
    ...state,
    players: state.players.map((player, index) => index === playerIndex ? paidPlayer : player),
  };
}

function stackItemCanBeCountered(state: GameState, item: StackItem): boolean {
  if (item.kind !== 'Spell') return true;
  if (item.cantBeCountered) return false;
  const card = state.cards.get(item.cardInstanceId);
  const def = card ? getCardDefinition(state, card) : undefined;
  return !def || !/\b(?:can'?t|cannot)\s+be\s+countered\b/i.test(def.oracle_text);
}

function counterWardSubject(state: GameState, item: StackItem): GameState {
  if (!stackItemCanBeCountered(state, item)) return state;

  const newStack = state.stack.filter(candidate => candidate.id !== item.id);
  if (item.kind !== 'Spell') {
    return { ...state, stack: newStack };
  }

  const card = state.cards.get(item.cardInstanceId);
  if (!card) return { ...state, stack: newStack };
  const newCards = new Map(state.cards);
  newCards.set(item.cardInstanceId, {
    ...card,
    zone: getCommanderDestinationZone(state, item.cardInstanceId, 'graveyard'),
    tapped: false,
    damage: 0,
  });
  return { ...state, cards: newCards, stack: newStack };
}

/**
 * Resolves simple Ward costs for targeted spells/abilities through the same
 * stack path. Prompting and response windows are future UI work, but this
 * prevents unsupported Ward permanents from being silently targetable for free.
 */
export function applyWardForStackItem(
  state: GameState,
  item: StackItem,
  controllerId: string,
  targets: string[],
): GameState {
  let nextState = state;
  const seenTargets = new Set<string>();

  for (const targetId of targets) {
    if (seenTargets.has(targetId)) continue;
    seenTargets.add(targetId);

    const target = nextState.cards.get(targetId);
    if (!target || target.zone !== 'battlefield' || target.ownerId === controllerId) continue;
    const targetDef = getCardDefinition(nextState, target);

    const wardCost = parseWardCost(targetDef);
    if (!wardCost) continue;

    if (canPayWard(nextState, controllerId, wardCost)) {
      nextState = payWard(nextState, controllerId, wardCost);
      continue;
    }

    nextState = counterWardSubject(nextState, item);
    break;
  }

  return nextState;
}
