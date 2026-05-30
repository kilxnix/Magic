/**
 * AI Heuristic Evaluator
 *
 * Scores game states and actions using simple heuristics.
 * Higher scores are better for the AI.
 */

import { GameState, CardInstance, CardDefinition, Player, ManaCost, ManaColor, ManaPool, emptyManaPool } from '../types';
import { getCardsInZone, getCardDefinition } from '../game-state';
import { getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { getNormalizedThreat } from './threat';
import type { AIAction, ActionEvaluation } from './types';
import { canCastSpell, getEffectiveCastCost } from '../stack';
import { addMana } from '../mana';

// Scoring constants
const LIFE_VALUE = 1;
const CARD_IN_HAND_VALUE = 2;
const CREATURE_BASE_VALUE = 3;
const CREATURE_POWER_VALUE = 1;
const CREATURE_TOUGHNESS_VALUE = 0.5;
const MANA_AVAILABLE_VALUE = 0.5;
const MANA_SPENT_VALUE = 1.5;
const THREAT_REMOVED_VALUE = 5;
const COMMANDER_VALUE = 10;
const MANA_COLORS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

/**
 * Evaluate the value of a single creature.
 */
export function evaluateCreature(
  state: GameState,
  card: CardInstance,
): number {
  const def = getCardDefinition(state, card);
  const power = card.zone === 'battlefield' ? getEffectivePower(state, card.instanceId) : def.power ?? 0;
  const toughness = card.zone === 'battlefield' ? getEffectiveToughness(state, card.instanceId) : def.toughness ?? 0;

  let value = CREATURE_BASE_VALUE;
  value += power * CREATURE_POWER_VALUE;
  value += toughness * CREATURE_TOUGHNESS_VALUE;

  // Keywords add value
  if (def.keywords.includes('Flying')) value += 2;
  if (def.keywords.includes('Deathtouch')) value += 2;
  if (def.keywords.includes('Trample')) value += 1;
  if (def.keywords.includes('Lifelink')) value += 1.5;
  if (def.keywords.includes('Vigilance')) value += 1;
  if (def.keywords.includes('Haste')) value += 0.5;
  if (def.keywords.includes('First Strike') || def.keywords.includes('Double Strike')) value += 1.5;
  if (def.keywords.includes('Hexproof')) value += 2;
  if (def.keywords.includes('Indestructible')) value += 4;

  // Commander is extra valuable
  if (card.isCommander) {
    value += COMMANDER_VALUE;
  }

  return value;
}

/**
 * Evaluate a player's board position.
 */
export function evaluatePlayerPosition(
  state: GameState,
  playerId: string,
): number {
  const player = state.players.find(p => p.id === playerId);
  if (!player || player.hasLost) return -1000;

  let score = 0;

  // Life total
  score += player.life * LIFE_VALUE;

  // Cards in hand
  const hand = getCardsInZone(state, playerId, 'hand');
  score += hand.length * CARD_IN_HAND_VALUE;

  // Creatures on battlefield
  const battlefield = getCardsInZone(state, playerId, 'battlefield');
  for (const card of battlefield) {
    const def = getCardDefinition(state, card);
    if (def.card_types.includes('creature')) {
      score += evaluateCreature(state, card);
    }
  }

  // Available mana
  const manaPool = player.manaPool;
  const totalMana = manaPool.W + manaPool.U + manaPool.B + manaPool.R + manaPool.G + manaPool.C;
  score += totalMana * MANA_AVAILABLE_VALUE;

  // Untapped lands (potential mana)
  for (const card of battlefield) {
    const def = getCardDefinition(state, card);
    if (def.card_types.includes('land') && !card.tapped) {
      score += MANA_AVAILABLE_VALUE;
    }
  }

  return score;
}

/**
 * Evaluate the game state from a player's perspective.
 * Considers own position minus opponents' positions.
 */
export function evaluateGameState(
  state: GameState,
  playerId: string,
): number {
  const ownScore = evaluatePlayerPosition(state, playerId);

  // Subtract opponents' scores (weighted down in multiplayer)
  let opponentScore = 0;
  let opponentCount = 0;

  for (const player of state.players) {
    if (player.id !== playerId && !player.hasLost) {
      opponentScore += evaluatePlayerPosition(state, player.id);
      opponentCount++;
    }
  }

  // Average opponent score
  const avgOpponentScore = opponentCount > 0 ? opponentScore / opponentCount : 0;

  return ownScore - avgOpponentScore * 0.8;
}

/**
 * Evaluate a PlayLand action.
 */
function evaluatePlayLand(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
): number {
  // Playing a land is almost always good - it's free mana development
  return 3;
}

/**
 * Evaluate a CastSpell action.
 */
function evaluateCastSpell(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  targets: string[],
): number {
  const card = state.cards.get(cardInstanceId);
  if (!card) return 0;

  const def = getCardDefinition(state, card);
  let score = 0;

  // Value of spending mana (better to use mana than leave it unspent)
  score += def.cmc * MANA_SPENT_VALUE;

  // Value based on card type
  if (def.card_types.includes('creature')) {
    const power = card.zone === 'battlefield'
      ? getEffectivePower(state, cardInstanceId)
      : def.power ?? 0;
    const toughness = card.zone === 'battlefield'
      ? getEffectiveToughness(state, cardInstanceId)
      : def.toughness ?? 0;
    score += CREATURE_BASE_VALUE + power * CREATURE_POWER_VALUE + toughness * CREATURE_TOUGHNESS_VALUE;
  }

  // Value for targeted removal
  if (targets.length > 0) {
    for (const targetId of targets) {
      const targetCard = state.cards.get(targetId);
      if (targetCard && targetCard.ownerId !== playerId) {
        // Removing an opponent's creature
        score += evaluateCreature(state, targetCard) * 0.9;
      }
    }
  }

  return score;
}

function manaActionKey(action: Extract<AIAction, { kind: 'ActivateManaAbility' }>): string {
  return `${action.cardInstanceId}:${action.color}`;
}

function producedManaForAction(
  state: GameState,
  playerId: string,
  action: Extract<AIAction, { kind: 'ActivateManaAbility' }>,
): ManaPool {
  const card = state.cards.get(action.cardInstanceId);
  const def = card ? getCardDefinition(state, card) : undefined;
  const pool = emptyManaPool();
  if (!def?.manaProduction) {
    return addMana(pool, action.color, 1);
  }

  let amount = def.manaProduction.amounts[action.color] ?? 1;
  if (def.manaProduction.amountScale === 'creaturesYouControl') {
    const creatureCount = [...state.cards.values()].filter(instance => {
      if (instance.ownerId !== playerId || instance.zone !== 'battlefield') return false;
      const cardDef = getCardDefinition(state, instance);
      return cardDef.card_types.includes('creature');
    }).length;
    amount *= creatureCount;
  }

  if (def.manaProduction.producesAllColors) {
    return def.manaProduction.colors.reduce(
      (nextPool, color) => addMana(nextPool, color, def.manaProduction!.amounts[color] ?? amount),
      pool,
    );
  }

  return addMana(pool, action.color, Math.max(0, amount));
}

function manaActionTotalAmount(
  state: GameState,
  playerId: string,
  action: Extract<AIAction, { kind: 'ActivateManaAbility' }>,
): number {
  const produced = producedManaForAction(state, playerId, action);
  return MANA_COLORS.reduce((total, color) => total + produced[color], 0);
}

function manaSourceRank(
  state: GameState,
  action: Extract<AIAction, { kind: 'ActivateManaAbility' }>,
): number {
  const card = state.cards.get(action.cardInstanceId);
  const def = card ? getCardDefinition(state, card) : undefined;
  if (!def) return 6;
  if (
    def.manaProduction?.requiresSacrifice
    || def.manaProduction?.sacrificeFilter
    || def.manaProduction?.activationZone === 'hand'
  ) return 5;
  if (def.card_types.includes('land')) return 0;
  if (def.card_types.includes('artifact')) return 1;
  if (def.card_types.includes('creature')) return 3;
  return 2;
}

function applyPoolPaymentToCost(pool: ManaPool, manaCost: ManaCost): ManaCost {
  const needed: ManaCost = {
    ...manaCost,
    hybrid: manaCost.hybrid?.map(options => [...options]),
  };
  const available = { ...pool };

  for (const color of MANA_COLORS) {
    const pay = Math.min(available[color], needed[color]);
    needed[color] -= pay;
    available[color] -= pay;
  }

  const hybridNeeded: ManaColor[][] = [];
  for (const options of needed.hybrid || []) {
    const poolColor = [...options]
      .sort((a, b) => available[b] - available[a])
      .find(color => available[color] > 0);
    if (poolColor) {
      available[poolColor] -= 1;
    } else {
      hybridNeeded.push(options);
    }
  }
  needed.hybrid = hybridNeeded;

  for (const color of MANA_COLORS) {
    const pay = Math.min(available[color], needed.generic);
    needed.generic -= pay;
    available[color] -= pay;
  }

  return needed;
}

function findManaPlanForCost(
  state: GameState,
  playerId: string,
  manaCost: ManaCost,
  actions: Extract<AIAction, { kind: 'ActivateManaAbility' }>[],
): Extract<AIAction, { kind: 'ActivateManaAbility' }>[] | null {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return null;

  const actionsByCard = new Map<string, Extract<AIAction, { kind: 'ActivateManaAbility' }>[]>();
  for (const action of actions) {
    const list = actionsByCard.get(action.cardInstanceId) || [];
    list.push(action);
    actionsByCard.set(action.cardInstanceId, list);
  }

  const result: Extract<AIAction, { kind: 'ActivateManaAbility' }>[] = [];
  const usedCards = new Set<string>();
  const needed = applyPoolPaymentToCost(player.manaPool, manaCost);
  const sortActions = (
    a: [string, Extract<AIAction, { kind: 'ActivateManaAbility' }>[]],
    b: [string, Extract<AIAction, { kind: 'ActivateManaAbility' }>[]],
  ): number =>
    manaSourceRank(state, a[1][0]) - manaSourceRank(state, b[1][0])
    || a[1].length - b[1].length;

  for (const color of MANA_COLORS) {
    while (needed[color] > 0) {
      const candidates = [...actionsByCard.entries()]
        .filter(([id]) => !usedCards.has(id))
        .filter(([, cardActions]) => cardActions.some(action => action.color === color))
        .sort(sortActions);
      if (candidates.length === 0) return null;

      const [cardId, cardActions] = candidates[0];
      const action = cardActions.find(candidate => candidate.color === color)!;
      result.push(action);
      usedCards.add(cardId);
      needed[color] = Math.max(0, needed[color] - (producedManaForAction(state, playerId, action)[color] || 1));
    }
  }

  for (const options of needed.hybrid || []) {
    const candidates = [...actionsByCard.entries()]
      .filter(([id]) => !usedCards.has(id))
      .filter(([, cardActions]) => cardActions.some(action => options.includes(action.color)))
      .sort(sortActions);
    if (candidates.length === 0) return null;

    const [cardId, cardActions] = candidates[0];
    const action = cardActions.find(candidate => options.includes(candidate.color))!;
    result.push(action);
    usedCards.add(cardId);
  }

  while (needed.generic > 0) {
    const candidates = [...actionsByCard.entries()]
      .filter(([id]) => !usedCards.has(id))
      .sort(sortActions);
    if (candidates.length === 0) return null;

    const [cardId, cardActions] = candidates[0];
    const action = cardActions[0];
    result.push(action);
    usedCards.add(cardId);
    needed.generic = Math.max(0, needed.generic - Math.max(1, manaActionTotalAmount(state, playerId, action)));
  }

  return result;
}

function canAttemptCastIgnoringMana(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const richPlayers = state.players.map(player => player.id === playerId
    ? { ...player, manaPool: { W: 50, U: 50, B: 50, R: 50, G: 50, C: 50 } }
    : player);
  return canCastSpell({ ...state, players: richPlayers }, playerId, cardInstanceId);
}

function preferredManaActionKeys(
  state: GameState,
  playerId: string,
  actions: AIAction[],
): Set<string> {
  const manaActions = actions.filter((action): action is Extract<AIAction, { kind: 'ActivateManaAbility' }> =>
    action.kind === 'ActivateManaAbility',
  );
  if (manaActions.length === 0) return new Set();

  const playableZones = getCardsInZone(state, playerId, 'hand').concat(
    getCardsInZone(state, playerId, 'command').filter(card => card.isCommander),
  );
  const alreadyCastable = actions.some(action => action.kind === 'CastSpell');
  if (alreadyCastable) return new Set();

  let bestPlan: Extract<AIAction, { kind: 'ActivateManaAbility' }>[] | null = null;
  let bestScore = -Infinity;

  for (const card of playableZones) {
    if (!canAttemptCastIgnoringMana(state, playerId, card.instanceId)) continue;
    const cost = getEffectiveCastCost(state, playerId, card.instanceId);
    if (!cost) continue;
    const def = getCardDefinition(state, card);
    const plan = findManaPlanForCost(state, playerId, cost, manaActions);
    if (!plan) continue;

    const planCost = plan.reduce((total, action) => total + manaSourceRank(state, action), 0);
    const score = evaluateCastSpell(state, playerId, card.instanceId, []) - planCost * 0.35 - plan.length * 0.25;
    if (score > bestScore) {
      bestScore = score;
      bestPlan = plan;
    }
  }

  return new Set((bestPlan || []).map(manaActionKey));
}

/**
 * Evaluate an ActivateManaAbility action.
 */
function evaluateActivateMana(
  state: GameState,
  playerId: string,
  action: Extract<AIAction, { kind: 'ActivateManaAbility' }>,
  preferredManaKeys: Set<string>,
): number {
  if (preferredManaKeys.has(manaActionKey(action))) {
    return manaSourceRank(state, action) >= 5 ? 1.4 : 2.7;
  }
  return manaSourceRank(state, action) >= 5 ? -8 : -0.2;
}

/**
 * Evaluate a DeclareAttackers action.
 */
function evaluateDeclareAttackers(
  state: GameState,
  playerId: string,
  attacks: { cardInstanceId: string; defendingPlayerId: string }[],
): number {
  if (attacks.length === 0) {
    // Not attacking is safe but doesn't advance win condition
    return 0;
  }

  let score = 0;

  for (const attack of attacks) {
    const attackerCard = state.cards.get(attack.cardInstanceId);
    if (!attackerCard) continue;

    const def = getCardDefinition(state, attackerCard);
    const power = attackerCard.zone === 'battlefield'
      ? getEffectivePower(state, attack.cardInstanceId)
      : def.power ?? 0;

    // Value of dealing damage
    const defender = state.players.find(p => p.id === attack.defendingPlayerId);
    if (defender) {
      // More valuable to attack players with lower life
      const lifeFactor = Math.max(1, 40 / Math.max(1, defender.life));
      const threatFactor = getNormalizedThreat(state, defender.id, playerId);
      score += power * lifeFactor;
      score += power * threatFactor * 1.5;

      // Commander damage is extra valuable
      if (attackerCard.isCommander) {
        score += power * 2;
      }
    }

    // Penalty for attacking with valuable creatures that might die
    // (Will be refined in combat evaluation)
    const creatureValue = evaluateCreature(state, attackerCard);
    score -= creatureValue * 0.1; // Small risk penalty
  }

  return score;
}

/**
 * Evaluate a DeclareBlockers action.
 */
function evaluateDeclareBlockers(
  state: GameState,
  playerId: string,
  blocks: { cardInstanceId: string; blockingAttackerId: string }[],
): number {
  if (!state.combat) return 0;

  // Calculate damage that would be dealt to us
  let incomingDamage = 0;
  for (const attacker of state.combat.attackers) {
    if (attacker.defendingPlayerId !== playerId) continue;

    const attackerCard = state.cards.get(attacker.cardInstanceId);
    if (!attackerCard) continue;

    const power = getEffectivePower(state, attacker.cardInstanceId);

    // Check if this attacker is blocked
    const isBlocked = blocks.some(b => b.blockingAttackerId === attacker.cardInstanceId);
    if (!isBlocked) {
      incomingDamage += power;
    }
  }

  let score = 0;

  // Value of reducing incoming damage
  const player = state.players.find(p => p.id === playerId);
  if (player) {
    // Blocking is more valuable at low life
    const lifeFactor = Math.max(1, 40 / Math.max(1, player.life));
    score += (state.combat.attackers.length > 0 ? 1 : 0) * lifeFactor;
  }

  // Evaluate each block
  for (const block of blocks) {
    const blockerCard = state.cards.get(block.cardInstanceId);
    const attackerCard = state.cards.get(block.blockingAttackerId);
    if (!blockerCard || !attackerCard) continue;

    const blockerPower = getEffectivePower(state, block.cardInstanceId);
    const blockerToughness = getEffectiveToughness(state, block.cardInstanceId);
    const attackerPower = getEffectivePower(state, block.blockingAttackerId);
    const attackerToughness = getEffectiveToughness(state, block.blockingAttackerId);

    // Good block: kills attacker, blocker survives
    const attackerDies = blockerPower >= attackerToughness;
    const blockerDies = attackerPower >= blockerToughness;

    if (attackerDies && !blockerDies) {
      // Excellent trade
      score += evaluateCreature(state, attackerCard) * 1.5;
    } else if (attackerDies && blockerDies) {
      // Trade - good if attacker is more valuable
      score += evaluateCreature(state, attackerCard) - evaluateCreature(state, blockerCard);
    } else if (!attackerDies && blockerDies) {
      // Bad trade - losing blocker for nothing
      score -= evaluateCreature(state, blockerCard);
    } else {
      // Neither dies - just blocked damage
      score += attackerPower * 0.5;
    }
  }

  // Penalty for taking damage
  score -= incomingDamage * LIFE_VALUE;

  return score;
}

/**
 * Evaluate a PassPriority action.
 */
function evaluatePassPriority(
  state: GameState,
  playerId: string,
): number {
  // Passing is neutral but slightly negative (prefer action over inaction)
  return -0.1;
}

/**
 * Evaluate an action and return a score.
 */
export function evaluateAction(
  state: GameState,
  playerId: string,
  action: AIAction,
  preferredManaKeys: Set<string> = new Set(),
): ActionEvaluation {
  let score: number;
  let reasoning: string | undefined;

  switch (action.kind) {
    case 'PlayLand':
      score = evaluatePlayLand(state, playerId, action.cardInstanceId);
      reasoning = 'Land development';
      break;

    case 'CastSpell':
      score = evaluateCastSpell(state, playerId, action.cardInstanceId, action.targets);
      reasoning = 'Spell value';
      break;

    case 'ActivateManaAbility':
      score = evaluateActivateMana(state, playerId, action, preferredManaKeys);
      reasoning = 'Mana generation';
      break;

    case 'DeclareAttackers':
      score = evaluateDeclareAttackers(state, playerId, action.attacks);
      reasoning = action.attacks.length > 0 ? 'Attack value' : 'No attack';
      break;

    case 'DeclareBlockers':
      score = evaluateDeclareBlockers(state, playerId, action.blocks);
      reasoning = action.blocks.length > 0 ? 'Block value' : 'No blocks';
      break;

    case 'PassPriority':
      score = evaluatePassPriority(state, playerId);
      reasoning = 'Pass';
      break;

    default:
      score = 0;
  }

  return { action, score, reasoning };
}

/**
 * Evaluate all actions and return sorted by score (highest first).
 */
export function evaluateActions(
  state: GameState,
  playerId: string,
  actions: AIAction[],
): ActionEvaluation[] {
  const preferredManaKeys = preferredManaActionKeys(state, playerId, actions);
  const evaluations = actions.map(action => evaluateAction(state, playerId, action, preferredManaKeys));
  return evaluations.sort((a, b) => b.score - a.score);
}

/**
 * Get the best action from a list.
 */
export function getBestAction(
  state: GameState,
  playerId: string,
  actions: AIAction[],
): AIAction | null {
  if (actions.length === 0) return null;

  const evaluations = evaluateActions(state, playerId, actions);
  return evaluations[0].action;
}
