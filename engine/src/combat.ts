import { AttackerDeclaration, BlockerDeclaration, CardInstance, CombatState, GameState, ManaCost, Player } from './types';
import { getCardDefinition, getPlayer } from './game-state';
import {
  canAttackThisTurn,
  shouldTapWhenAttacking,
  canBlock,
  satisfiesMenace,
  instanceHasKeyword,
  isLethalDamage,
  isProtectedFromSource,
} from './keywords';
import { LURE_STATIC_SELF_RE, LURE_STATIC_ATTACHED_RE } from './effects/matchers/static-abilities';
import { getEffectivePower, getEffectiveToughness } from './effects/continuous';
import { isEffectiveCreature } from './effective-types';
import { checkTriggersForEvent } from './stack';
import { checkStateBasedActions } from './state-based';
import { applyDamageReplacementEffects } from './effects/replacement';
import { canPayUnrestrictedCost, payUnrestrictedManaCost } from './mana';
import { playerCantLoseLife } from './game-outcome';

// ============================================================================
// Slice 8: CanBlockAdditional helper
// ============================================================================

/**
 * The "can block an additional creature each combat" static oracle text regex.
 * Mirrors the matchCanBlockAdditionalStatic parser: read directly from oracle text
 * so the ability is enforced even if the face parsed as Unparsed or as an
 * Activated ability (where the static line is mixed with an activated ability).
 */
const CAN_BLOCK_ADDITIONAL_ORACLE_RE =
  /\bcan\s+block\s+an\s+additional\s+creature\s+each\s+combat\b/i;

/**
 * Slice 11: "can block any number of creatures" — no cap at all (return 99 as
 * a practical infinity). Mirrors matchCanBlockAnyNumber in static-abilities.ts.
 */
const CAN_BLOCK_ANY_NUMBER_ORACLE_RE =
  /\bcan\s+block\s+any\s+number\s+of\s+creatures\b/i;

/**
 * Returns the maximum number of attackers creature `instanceId` may simultaneously
 * block this combat:
 *  - The default is 1 (CR 509.1b: each creature may only block one attacker).
 *  - The static "can block an additional creature each combat" (oracle text) and
 *    the activated "can block an additional creature this turn" (grantedKeywords)
 *    each add +1, stacking for creatures with both.
 *  - Slice 11: "can block any number of creatures" (oracle text or CanBlockAnyNumber
 *    grantedKeyword) returns 99 — a practical infinity that exceeds any realistic
 *    attacking force.
 *
 * Only called from declareBlockers to validate the proposed block assignments.
 */
function maxAttackersCreatureCanBlock(state: GameState, instanceId: string): number {
  let cap = 1;
  const card = state.cards.get(instanceId);
  if (!card) return cap;

  const def = getCardDefinition(state, card);
  const oracleText = def?.oracle_text || '';

  // Slice 11: "can block any number of creatures" — unlimited blocker.
  if (CAN_BLOCK_ANY_NUMBER_ORACLE_RE.test(oracleText)
      || card.grantedKeywords?.includes('CanBlockAnyNumber')) {
    return 99;
  }

  // Static form: printed in oracle text ("each combat").
  if (CAN_BLOCK_ADDITIONAL_ORACLE_RE.test(oracleText)) {
    cap++;
  }

  // Activated (or ETB/triggered) grant: keyword written into grantedKeywords
  // ("this turn") by the executor's GrantKeyword/Source branch.
  if (card.grantedKeywords?.includes('CanBlockAdditional')) {
    cap++;
  }

  return cap;
}

function emptyGenericCost(generic: number): ManaCost {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic };
}

// ============================================================================
// Slice 7: Lure / forced-block helper
// ============================================================================

/**
 * Collect the instance IDs of all currently attacking creatures that must be
 * blocked by every blocker that is able to block them (the "lure" rule,
 * CR 509.1a modifier).
 *
 * Sources:
 *  1. state.combat.luredCreatureIds — set at resolution time by the
 *     MustBeBlockedIfAble executor for spell/trigger forms (Taunting Challenge).
 *  2. Static "All creatures able to block ~ do so" on an attacker's oracle text
 *     (Elvish Bard / Breaker of Armies family — LURE_STATIC_SELF_RE).
 *  3. Static "All creatures able to block equipped creature do so" on a non-
 *     attacker Equipment / Aura whose attached creature IS attacking
 *     (Nemesis Mask family — LURE_STATIC_ATTACHED_RE).
 *  4. 'MustBeBlockedIfAble' in an attacker's grantedKeywords (Taunting Challenge
 *     cast before combat, stored via GrantKeyword).
 */
function getActiveLuredCreatureIds(state: GameState): string[] {
  if (!state.combat) return [];
  const ids = new Set<string>(state.combat.luredCreatureIds ?? []);

  for (const attacker of state.combat.attackers) {
    const attackerCard = state.cards.get(attacker.cardInstanceId);
    if (!attackerCard) continue;
    const attackerDef = getCardDefinition(state, attackerCard);

    // Self-lure static on the attacker's oracle text (Elvish Bard, Breaker of Armies).
    if (LURE_STATIC_SELF_RE.test(attackerDef.oracle_text)) {
      ids.add(attacker.cardInstanceId);
    }

    // Keyword granted by a spell-form lure that resolved before combat (e.g.
    // Taunting Challenge cast before the declare-attackers step).
    if (attackerCard.grantedKeywords?.includes('MustBeBlockedIfAble')) {
      ids.add(attacker.cardInstanceId);
    }
  }

  // Equipment / Aura static: LURE_STATIC_ATTACHED_RE — find any non-equipment
  // permanent whose oracle text matches and whose attachedTo creature is attacking.
  for (const card of state.cards.values()) {
    if (card.zone !== 'battlefield') continue;
    const def = getCardDefinition(state, card);
    if (!LURE_STATIC_ATTACHED_RE.test(def.oracle_text)) continue;
    // The Equipment/Aura must be attached to a creature that is currently attacking.
    const attachedToId = card.attachedTo;
    if (!attachedToId) continue;
    if (state.combat.attackers.some(a => a.cardInstanceId === attachedToId)) {
      ids.add(attachedToId);
    }
  }

  return [...ids];
}

export function canDeclareAttacker(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (state.activePlayerIndex !== playerIndex) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'battlefield') return false;
  if (card.tapped) return false;

  if (!isEffectiveCreature(state, cardInstanceId)) return false;

  // Use keyword helpers for defender/haste/summoning sickness
  if (!canAttackThisTurn(state, cardInstanceId)) return false;

  return true;
}

/** True when a creature is currently goaded (by at least one player). */
export function isGoaded(state: GameState, cardInstanceId: string): boolean {
  const card = state.cards.get(cardInstanceId);
  return Boolean(card?.goadedBy && card.goadedBy.length > 0);
}

/** The set of players who have goaded this creature (empty if not goaded). */
export function goaders(state: GameState, cardInstanceId: string): string[] {
  const card = state.cards.get(cardInstanceId);
  return card?.goadedBy ? [...card.goadedBy] : [];
}

export function mustAttackIfAble(state: GameState, cardInstanceId: string): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  // Goaded creatures must attack each combat if able (CR 701.39a).
  if (isGoaded(state, cardInstanceId)) return true;
  const def = getCardDefinition(state, card);
  return /\battacks\s+(?:each|every)\s+combat\s+if\s+able\b/i.test(def.oracle_text)
    || /\battacks\s+each\s+turn\s+if\s+able\b/i.test(def.oracle_text);
}

export function getRequiredAttackers(state: GameState, playerId: string): string[] {
  return [...state.cards.values()]
    .filter(card => card.ownerId === playerId && card.zone === 'battlefield')
    .filter(card => canDeclareAttacker(state, playerId, card.instanceId))
    .filter(card => mustAttackIfAble(state, card.instanceId))
    .map(card => card.instanceId);
}

function attackTaxForPermanent(defOracle: string): number {
  const match = defOracle.match(/creatures\s+can't\s+attack\s+you\s+unless\s+their\s+controller\s+pays\s+\{(\d+)\}\s+for\s+each\s+creature\s+they\s+control\s+that's\s+attacking\s+you/i);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function attackTaxForDefender(state: GameState, defenderId: string): number {
  let tax = 0;
  for (const card of state.cards.values()) {
    if (card.ownerId !== defenderId || card.zone !== 'battlefield') continue;
    const def = getCardDefinition(state, card);
    tax += attackTaxForPermanent(def.oracle_text);
  }
  return tax;
}

export function attackTaxCost(state: GameState, attacks: AttackerDeclaration[]): ManaCost {
  let generic = 0;
  const attacksByDefender = new Map<string, number>();
  for (const attack of attacks) {
    attacksByDefender.set(attack.defendingPlayerId, (attacksByDefender.get(attack.defendingPlayerId) ?? 0) + 1);
  }
  for (const [defenderId, count] of attacksByDefender) {
    generic += attackTaxForDefender(state, defenderId) * count;
  }
  return emptyGenericCost(generic);
}

export function canPayAttackTaxes(state: GameState, playerId: string, attacks: AttackerDeclaration[]): boolean {
  const cost = attackTaxCost(state, attacks);
  if (cost.generic <= 0) return true;
  const player = state.players.find(p => p.id === playerId);
  return Boolean(player && canPayUnrestrictedCost(player, cost));
}

export function declareAttackers(state: GameState, playerId: string, attacks: AttackerDeclaration[]): GameState {
  const declaredAttackers = new Set<string>();

  // Validate all attackers
  for (const attack of attacks) {
    if (declaredAttackers.has(attack.cardInstanceId)) {
      throw new Error(`Duplicate attacker: ${attack.cardInstanceId}`);
    }
    declaredAttackers.add(attack.cardInstanceId);

    // Defending player must exist
    getPlayer(state, attack.defendingPlayerId);

    if (!canDeclareAttacker(state, playerId, attack.cardInstanceId)) {
      throw new Error(`Cannot declare attacker: ${attack.cardInstanceId}`);
    }

    // CR 701.39a: a goaded creature must attack a player other than a goader if able.
    const goaderIds = goaders(state, attack.cardInstanceId);
    if (goaderIds.length > 0 && goaderIds.includes(attack.defendingPlayerId)) {
      const nonGoaderDefenders = state.players.filter(
        p => p.id !== playerId && !p.hasLost && !goaderIds.includes(p.id),
      );
      if (nonGoaderDefenders.length > 0) {
        const card = state.cards.get(attack.cardInstanceId);
        const name = card ? getCardDefinition(state, card).name : attack.cardInstanceId;
        throw new Error(`${name} is goaded and must attack a player who didn't goad it`);
      }
    }
  }

  for (const requiredAttackerId of getRequiredAttackers(state, playerId)) {
    if (!declaredAttackers.has(requiredAttackerId)) {
      const card = state.cards.get(requiredAttackerId);
      const name = card ? getCardDefinition(state, card).name : requiredAttackerId;
      throw new Error(`${name} attacks each combat if able`);
    }
  }

  const taxCost = attackTaxCost(state, attacks);
  const playerIndex = state.players.findIndex(player => player.id === playerId);
  if (taxCost.generic > 0 && (playerIndex < 0 || !canPayUnrestrictedCost(state.players[playerIndex], taxCost))) {
    throw new Error(`Cannot pay attack tax: {${taxCost.generic}}`);
  }
  const newPlayers = state.players.map((player, index) =>
    index === playerIndex && taxCost.generic > 0
      ? payUnrestrictedManaCost(player, taxCost)
      : player
  );

  // Tap attackers (unless they have vigilance)
  const newCards = new Map(state.cards);
  const tappedAttackerIds: string[] = [];
  for (const attack of attacks) {
    const card = newCards.get(attack.cardInstanceId)!;
    if (shouldTapWhenAttacking(state, attack.cardInstanceId)) {
      newCards.set(attack.cardInstanceId, { ...card, tapped: true });
      if (!card.tapped) tappedAttackerIds.push(attack.cardInstanceId);
    }
  }

  const combat: CombatState = {
    attackers: attacks,
    blockers: [],
    blockersDeclared: false,
    blockersDeclaredBy: [],
    damageAssignment: new Map(),
  };

  let resultState: GameState = {
    ...state,
    players: newPlayers,
    cards: newCards,
    combat,
    playersWhoAttackedThisTurn: attacks.length > 0
      ? [...new Set([...(state.playersWhoAttackedThisTurn || []), playerId])]
      : state.playersWhoAttackedThisTurn,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };

  // Fire "whenever ~ attacks" triggers for each attacker.
  // "alone" is true when this creature is the only attacker this combat,
  // enabling "Whenever ~ attacks alone" triggers (CR 508.4 / 'attacking alone').
  const attacksAlone = attacks.length === 1;
  for (const attack of attacks) {
    resultState = checkTriggersForEvent(resultState, {
      kind: 'Attacks',
      attackerInstanceId: attack.cardInstanceId,
      controllerId: playerId,
      alone: attacksAlone,
      defendingPlayerId: attack.defendingPlayerId,
    });
  }

  for (const attackerId of tappedAttackerIds) {
    resultState = checkTriggersForEvent(resultState, {
      kind: 'PermanentTapped',
      instanceId: attackerId,
      controllerId: playerId,
    });
  }

  return resultState;
}

function defendingPlayerIds(combat: CombatState): string[] {
  return [...new Set(combat.attackers.map(attack => attack.defendingPlayerId))];
}

export function hasPlayerDeclaredBlockers(state: GameState, playerId: string): boolean {
  if (!state.combat) return false;
  if (state.combat.blockersDeclaredBy) {
    return state.combat.blockersDeclaredBy.includes(playerId);
  }
  return state.combat.blockersDeclared === true;
}

function allDefendersDeclared(combat: CombatState, declaredBy: string[]): boolean {
  const defenders = defendingPlayerIds(combat);
  return defenders.length === 0 || defenders.every(playerId => declaredBy.includes(playerId));
}

export function canDeclareBlocker(
  state: GameState,
  playerId: string,
  cardInstanceId: string,
  attackerInstanceId: string
): boolean {
  if (!state.combat) return false;
  if (hasPlayerDeclaredBlockers(state, playerId)) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'battlefield') return false;
  if (card.tapped) return false;

  if (!isEffectiveCreature(state, cardInstanceId)) return false;

  // Can only block attackers targeting you
  const attacker = state.combat.attackers.find(a => a.cardInstanceId === attackerInstanceId);
  if (!attacker) return false;
  if (attacker.defendingPlayerId !== playerId) return false;

  // Check flying/reach restrictions
  if (!canBlock(state, cardInstanceId, attackerInstanceId)) return false;

  return true;
}

export function declareBlockers(state: GameState, playerId: string, blocks: BlockerDeclaration[]): GameState {
  if (!state.combat) throw new Error('No combat state');
  if (hasPlayerDeclaredBlockers(state, playerId)) throw new Error('Blockers already declared');

  const defendingPlayers = defendingPlayerIds(state.combat);
  if (!defendingPlayers.includes(playerId)) {
    throw new Error('No attackers are attacking this player');
  }

  for (const block of blocks) {
    if (!canDeclareBlocker(state, playerId, block.cardInstanceId, block.blockingAttackerId)) {
      throw new Error(`Cannot declare blocker: ${block.cardInstanceId}`);
    }
  }

  // CR 509.1b — each creature may block only one attacker per combat unless it
  // has an ability permitting additional blocks ("can block an additional creature
  // each/this combat/turn"). Count how many times each blocker appears in the
  // proposed declarations and compare against its limit.
  const newBlockCounts = new Map<string, number>();
  for (const block of blocks) {
    newBlockCounts.set(block.cardInstanceId, (newBlockCounts.get(block.cardInstanceId) ?? 0) + 1);
  }
  for (const [cardInstanceId, count] of newBlockCounts) {
    const limit = maxAttackersCreatureCanBlock(state, cardInstanceId);
    if (count > limit) {
      throw new Error(`Creature ${cardInstanceId} cannot block more than ${limit} attacker(s) simultaneously`);
    }
  }

  // Calculate updated blockers list
  const newBlockers = [...state.combat.blockers, ...blocks];

  // Validate menace for each attacker
  for (const attacker of state.combat.attackers.filter(attack => attack.defendingPlayerId === playerId)) {
    const blockerIds = newBlockers
      .filter(b => b.blockingAttackerId === attacker.cardInstanceId)
      .map(b => b.cardInstanceId);

    if (!satisfiesMenace(state, attacker.cardInstanceId, blockerIds)) {
      throw new Error(`Menace creature ${attacker.cardInstanceId} requires 2+ blockers`);
    }
  }

  // Slice 7 (lure): CR 509.1a — if any attacker has a lure effect ("all creatures
  // able to block ~ do so"), every creature the defending player controls that CAN
  // block at least one lured attacker MUST block at least one of them (or block
  // another lured creature).  A declaration that omits a creature able to block a
  // lured creature is illegal.
  const luredIds = getActiveLuredCreatureIds(state);
  if (luredIds.length > 0) {
    // Attackers targeting this defending player that are lured.
    const luredAttackersForPlayer = luredIds.filter(luredId =>
      state.combat!.attackers.some(a => a.cardInstanceId === luredId && a.defendingPlayerId === playerId),
    );
    if (luredAttackersForPlayer.length > 0) {
      // Find all potential blockers this player controls.
      for (const card of state.cards.values()) {
        if (card.zone !== 'battlefield') continue;
        if (card.ownerId !== playerId) continue;
        if (card.tapped) continue;
        if (!isEffectiveCreature(state, card.instanceId)) continue;

        // Check if this creature can block at least one lured attacker.
        const canBlockAnyLured = luredAttackersForPlayer.some(
          luredId => canBlock(state, card.instanceId, luredId),
        );
        if (!canBlockAnyLured) continue; // Cannot block any lured creature — free to do anything.

        // The creature can block a lured creature; it MUST be assigned to block
        // at least one lured creature in this declaration.
        const blocksALured = newBlockers.some(
          b => b.cardInstanceId === card.instanceId && luredAttackersForPlayer.includes(b.blockingAttackerId),
        );
        if (!blocksALured) {
          throw new Error(`Lure: creature ${card.instanceId} must block a lured creature this turn`);
        }
      }
    }
  }

  const blockersDeclaredBy = [...(state.combat.blockersDeclaredBy || []), playerId];
  const blockersDeclared = allDefendersDeclared(state.combat, blockersDeclaredBy);
  const nextBlockingPlayerId = defendingPlayers.find(defenderId => !blockersDeclaredBy.includes(defenderId));
  const nextPriorityIndex = blockersDeclared
    ? state.activePlayerIndex
    : Math.max(0, state.players.findIndex(player => player.id === nextBlockingPlayerId));

  const combat: CombatState = {
    ...state.combat,
    blockers: newBlockers,
    blockersDeclared,
    blockersDeclaredBy,
  };

  let resultState: GameState = {
    ...state,
    combat,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: nextPriorityIndex,
  };

  if (blockersDeclared) {
    // Slice 8/11: fire BlocksOrBlockedBy triggers for each blocker-attacker pair.
    // Per MTG CR 509.1d, "blocks or becomes blocked" triggers fire when blockers are
    // declared. For each pair: the blocker fires with the attacker as "that creature",
    // and the attacker fires with the blocker as "that creature".
    for (const blocker of combat.blockers) {
      const blockerCard = resultState.cards.get(blocker.cardInstanceId);
      const attackerCard = resultState.cards.get(blocker.blockingAttackerId);
      if (blockerCard && attackerCard) {
        // Blocker fires (it is "blocking a creature" — the attacker is "that creature").
        resultState = checkTriggersForEvent(resultState, {
          kind: 'BlocksOrBlockedBy',
          sourceInstanceId: blocker.cardInstanceId,
          opposingCreatureId: blocker.blockingAttackerId,
          controllerId: blockerCard.ownerId,
        });
        // Attacker fires (it is "becoming blocked by a creature" — the blocker is "that creature").
        resultState = checkTriggersForEvent(resultState, {
          kind: 'BlocksOrBlockedBy',
          sourceInstanceId: blocker.blockingAttackerId,
          opposingCreatureId: blocker.cardInstanceId,
          controllerId: attackerCard.ownerId,
        });
      }
    }

    for (const attacker of combat.attackers) {
      const hasBlocker = combat.blockers.some(blocker => blocker.blockingAttackerId === attacker.cardInstanceId);
      if (!hasBlocker) {
        const attackerCard = resultState.cards.get(attacker.cardInstanceId);
        if (attackerCard) {
          resultState = checkTriggersForEvent(resultState, {
            kind: 'Unblocked',
            attackerInstanceId: attacker.cardInstanceId,
            controllerId: attackerCard.ownerId,
            defendingPlayerId: attacker.defendingPlayerId,
          });
        }
      }
    }
  }

  return resultState;
}

/**
 * Helper to apply lifelink: when a creature with lifelink deals damage,
 * its controller gains that much life.
 */
function applyLifelink(
  state: GameState,
  newPlayers: Player[],
  sourceId: string,
  damageDealt: number,
): { playerId: string; amount: number } | null {
  if (damageDealt <= 0) return null;
  if (!instanceHasKeyword(state, sourceId, 'Lifelink')) return null;

  // Slice 5: "Players can't gain life." (Leyline of Punishment family).
  // Lifelink gain bypasses executeGainLife, so we must check here too.
  const cantGainLifeActive = (state.continuousEffects ?? []).some(ce => {
    if (ce.ability.modifier.kind !== 'CantGainLife') return false;
    const src = state.cards.get(ce.sourceInstanceId);
    return src != null && src.zone === 'battlefield';
  });
  if (cantGainLifeActive) return null;

  const sourceCard = state.cards.get(sourceId);
  if (!sourceCard) return null;

  const ownerIndex = newPlayers.findIndex(p => p.id === sourceCard.ownerId);
  if (ownerIndex !== -1) {
    newPlayers[ownerIndex].life += damageDealt;
    return { playerId: sourceCard.ownerId, amount: damageDealt };
  }
  return null;
}

/**
 * Track commander damage dealt to a player in combat.
 * If the source is a commander, add the damage to the defender's commanderDamage record.
 */
function trackCommanderDamage(
  state: GameState,
  newPlayers: Player[],
  sourceId: string,
  defenderId: string,
  damageDealt: number,
): void {
  if (damageDealt <= 0) return;

  const sourceCard = state.cards.get(sourceId);
  if (!sourceCard || !sourceCard.isCommander) return;

  const defenderIndex = newPlayers.findIndex(p => p.id === defenderId);
  if (defenderIndex === -1) return;

  const currentDamage = newPlayers[defenderIndex].commanderDamage[sourceId] ?? 0;
  newPlayers[defenderIndex].commanderDamage = {
    ...newPlayers[defenderIndex].commanderDamage,
    [sourceId]: currentDamage + damageDealt,
  };
}

/**
 * Calculate lethal damage considering deathtouch.
 * Returns 1 for deathtouch (minimum lethal), otherwise returns remaining toughness.
 */
function getLethalDamageAmount(
  state: GameState,
  sourceId: string,
  targetId: string,
): number {
  const target = state.cards.get(targetId);
  if (!target) return 0;

  const toughness = getEffectiveToughness(state, targetId);
  const remainingToughness = toughness - target.damage;

  // Deathtouch: 1 damage is lethal
  if (instanceHasKeyword(state, sourceId, 'Deathtouch')) {
    return Math.max(0, Math.min(1, remainingToughness));
  }

  return Math.max(0, remainingToughness);
}

/**
 * Check if any attacker or blocker in combat has First Strike or Double Strike.
 */
function checkForFirstStrikers(state: GameState): boolean {
  if (!state.combat) return false;

  for (const attacker of state.combat.attackers) {
    if (instanceHasKeyword(state, attacker.cardInstanceId, 'First Strike') ||
        instanceHasKeyword(state, attacker.cardInstanceId, 'Double Strike')) {
      return true;
    }
  }

  for (const blocker of state.combat.blockers) {
    if (instanceHasKeyword(state, blocker.cardInstanceId, 'First Strike') ||
        instanceHasKeyword(state, blocker.cardInstanceId, 'Double Strike')) {
      return true;
    }
  }

  return false;
}

/**
 * Determine whether a creature deals damage in the given combat damage step.
 * - 'first' step: only First Strike and Double Strike creatures deal damage
 * - 'normal' step: non-First-Strike creatures AND Double Strike creatures deal damage
 *   (Double Strike deals in BOTH steps)
 */
function creatureDealsInStep(state: GameState, instanceId: string, step: 'first' | 'normal'): boolean {
  const hasFirstStrike = instanceHasKeyword(state, instanceId, 'First Strike');
  const hasDoubleStrike = instanceHasKeyword(state, instanceId, 'Double Strike');

  if (step === 'first') {
    return hasFirstStrike || hasDoubleStrike;
  } else {
    // Normal step: creatures without first strike, plus double strikers
    return !hasFirstStrike || hasDoubleStrike;
  }
}

function applyCombatDamagePrevention(
  state: GameState,
  cards: Map<string, CardInstance>,
  players: Player[],
  sourceId: string,
  targetId: string,
  amount: number,
): { state: GameState; amount: number } {
  if (amount <= 0) return { state, amount: 0 };
  if (cards.has(targetId) && isProtectedFromSource({ ...state, cards, players }, targetId, sourceId)) {
    return { state, amount: 0 };
  }

  const { state: replacedState, event } = applyDamageReplacementEffects(
    { ...state, cards, players },
    {
      type: 'DamageDealt',
      sourceId,
      targetId,
      amount,
      isCombatDamage: true,
    },
  );

  return {
    state: replacedState,
    amount: event?.amount ?? 0,
  };
}

function orderBlockersForAttacker(
  state: GameState,
  attackerId: string,
  blockers: BlockerDeclaration[],
): BlockerDeclaration[] {
  const order = state.combat?.blockerOrder?.[attackerId];
  if (!order?.length) return blockers;

  const blockerById = new Map(blockers.map(blocker => [blocker.cardInstanceId, blocker]));
  const ordered = order
    .map(blockerId => blockerById.get(blockerId))
    .filter((blocker): blocker is BlockerDeclaration => Boolean(blocker));
  const orderedIds = new Set(ordered.map(blocker => blocker.cardInstanceId));
  const missing = blockers.filter(blocker => !orderedIds.has(blocker.cardInstanceId));
  return [...ordered, ...missing];
}

/**
 * Resolve damage for a single combat damage step (first strike or normal).
 * Only creatures that deal damage in this step participate.
 * Only creatures still on the battlefield deal damage.
 * Returns updated state with damage applied.
 */
function resolveDamageStep(state: GameState, step: 'first' | 'normal'): GameState {
  if (!state.combat) throw new Error("No combat state");

  const newCards = new Map(state.cards);
  const newPlayers = state.players.map(p => ({ ...p }));
  let replacementState: GameState = state;
  // Snapshot attacker ids NOW, before combat state is cleared by resolveDamageStep.
  // This is used by AllAttackingCreaturesYouControl trigger bodies (slice 6).
  const attackerSnapshot = state.combat.attackers.map(a => a.cardInstanceId);

  const combatDamageEvents: Array<{
    sourceInstanceId: string;
    controllerId: string;
    damagedPlayerId: string;
    damage: number;
    attackerInstanceIds: string[];
  }> = [];
  const lifeGainEvents: Array<{ playerId: string; amount: number }> = [];

  for (const attacker of state.combat.attackers) {
    const attackerCard = newCards.get(attacker.cardInstanceId);
    if (!attackerCard || attackerCard.zone !== 'battlefield') continue;

    const attackerPower = getEffectivePower(state, attacker.cardInstanceId);

    // Check if attacker deals damage in this step
    const attackerDeals = creatureDealsInStep(state, attacker.cardInstanceId, step);

    // Find blockers for this attacker
    const blockers = orderBlockersForAttacker(
      state,
      attacker.cardInstanceId,
      state.combat.blockers.filter(b => b.blockingAttackerId === attacker.cardInstanceId),
    );

    if (blockers.length === 0) {
      // Unblocked — deal damage to defending player
      if (attackerDeals) {
        const defenderIndex = newPlayers.findIndex(p => p.id === attacker.defendingPlayerId);
        if (defenderIndex !== -1) {
          const prevented = applyCombatDamagePrevention(
            replacementState,
            newCards,
            newPlayers,
            attacker.cardInstanceId,
            attacker.defendingPlayerId,
            attackerPower,
          );
          replacementState = prevented.state;
          const damageDealt = prevented.amount;
          if (!playerCantLoseLife(replacementState, attacker.defendingPlayerId)) {
            newPlayers[defenderIndex].life -= damageDealt;
          }
          const lifelinkEvent = applyLifelink(state, newPlayers, attacker.cardInstanceId, damageDealt);
          if (lifelinkEvent) lifeGainEvents.push(lifelinkEvent);
          trackCommanderDamage(state, newPlayers, attacker.cardInstanceId, attacker.defendingPlayerId, damageDealt);
          if (damageDealt > 0) {
            combatDamageEvents.push({
              sourceInstanceId: attacker.cardInstanceId,
              controllerId: attackerCard.ownerId,
              damagedPlayerId: attacker.defendingPlayerId,
              damage: damageDealt,
              attackerInstanceIds: attackerSnapshot,
            });
          }
        }
      }
    } else {
      // Blocked — attacker deals damage to blockers, blockers deal damage back

      // Attacker deals damage to blockers (if it deals in this step)
      if (attackerDeals) {
        let remainingDamage = attackerPower;
        const hasTrample = instanceHasKeyword(state, attacker.cardInstanceId, 'Trample');
        const attackerHasDeathtouch = instanceHasKeyword(state, attacker.cardInstanceId, 'Deathtouch');

        // Deal damage to each blocker (in order)
        for (const blocker of blockers) {
          const blockerCard = newCards.get(blocker.cardInstanceId);
          if (!blockerCard || blockerCard.zone !== 'battlefield') continue;

          // Calculate how much damage to assign to this blocker
          // Use newCards state for getLethalDamageAmount since damage may have accumulated
          const lethalState = { ...state, cards: newCards };
          const lethalAmount = getLethalDamageAmount(lethalState, attacker.cardInstanceId, blocker.cardInstanceId);
          const damageToBlocker = hasTrample
            ? Math.min(lethalAmount, remainingDamage) // Trample: only assign lethal
            : remainingDamage; // Normal: all damage to first blocker

          if (damageToBlocker > 0) {
            const prevented = applyCombatDamagePrevention(
              replacementState,
              newCards,
              newPlayers,
              attacker.cardInstanceId,
              blocker.cardInstanceId,
              damageToBlocker,
            );
            replacementState = prevented.state;
            const damageDealt = prevented.amount;
            newCards.set(blockerCard.instanceId, {
              ...blockerCard,
              damage: blockerCard.damage + damageDealt,
              deathtouchDamage: blockerCard.deathtouchDamage || (damageDealt > 0 && attackerHasDeathtouch),
            });
            remainingDamage -= damageToBlocker;
            const lifelinkEvent = applyLifelink(state, newPlayers, attacker.cardInstanceId, damageDealt);
            if (lifelinkEvent) lifeGainEvents.push(lifelinkEvent);
          }

          if (!hasTrample) break; // Without trample, all damage goes to first blocker
        }

        // Trample: excess damage to defending player
        if (hasTrample && remainingDamage > 0) {
          const defenderIndex = newPlayers.findIndex(p => p.id === attacker.defendingPlayerId);
          if (defenderIndex !== -1) {
            const prevented = applyCombatDamagePrevention(
              replacementState,
              newCards,
              newPlayers,
              attacker.cardInstanceId,
              attacker.defendingPlayerId,
              remainingDamage,
            );
            replacementState = prevented.state;
            const damageDealt = prevented.amount;
            if (!playerCantLoseLife(replacementState, attacker.defendingPlayerId)) {
              newPlayers[defenderIndex].life -= damageDealt;
            }
            const lifelinkEvent = applyLifelink(state, newPlayers, attacker.cardInstanceId, damageDealt);
            if (lifelinkEvent) lifeGainEvents.push(lifelinkEvent);
            trackCommanderDamage(state, newPlayers, attacker.cardInstanceId, attacker.defendingPlayerId, damageDealt);
            if (damageDealt > 0) {
              combatDamageEvents.push({
                sourceInstanceId: attacker.cardInstanceId,
                controllerId: attackerCard.ownerId,
                damagedPlayerId: attacker.defendingPlayerId,
                damage: damageDealt,
                attackerInstanceIds: attackerSnapshot,
              });
            }
          }
        }
      }

      // Each blocker deals damage back to attacker (if the blocker deals in this step)
      for (const blocker of blockers) {
        const blockerCard = newCards.get(blocker.cardInstanceId);
        if (!blockerCard || blockerCard.zone !== 'battlefield') continue;

        // Check if blocker deals damage in this step
        if (!creatureDealsInStep(state, blocker.cardInstanceId, step)) continue;

        const blockerPower = getEffectivePower(state, blocker.cardInstanceId);

        const currentAttacker = newCards.get(attacker.cardInstanceId);
        if (!currentAttacker || currentAttacker.zone !== 'battlefield') continue;
        const blockerHasDeathtouch = blockerPower > 0 && instanceHasKeyword(state, blocker.cardInstanceId, 'Deathtouch');
        const prevented = applyCombatDamagePrevention(
          replacementState,
          newCards,
          newPlayers,
          blocker.cardInstanceId,
          attacker.cardInstanceId,
          blockerPower,
        );
        replacementState = prevented.state;
        const damageDealt = prevented.amount;

        newCards.set(attacker.cardInstanceId, {
          ...currentAttacker,
          damage: currentAttacker.damage + damageDealt,
          deathtouchDamage: currentAttacker.deathtouchDamage || (damageDealt > 0 && blockerHasDeathtouch),
        });
        const lifelinkEvent = applyLifelink(state, newPlayers, blocker.cardInstanceId, damageDealt);
        if (lifelinkEvent) lifeGainEvents.push(lifelinkEvent);
      }
    }
  }

  // Only clear combat state after the normal damage step
  const newCombat = step === 'normal' ? null : state.combat;

  let resultState: GameState = {
    ...state,
    cards: newCards,
    players: newPlayers,
    combat: newCombat,
    damagePreventionEffects: replacementState.damagePreventionEffects,
  };

  for (const event of combatDamageEvents) {
    resultState = checkTriggersForEvent(resultState, {
      kind: 'CombatDamageToPlayer',
      ...event,
    });
  }
  for (const event of lifeGainEvents) {
    resultState = checkTriggersForEvent(resultState, {
      kind: 'LifeGained',
      ...event,
    });
  }

  // CR 720.5: a creature dealing combat damage to the monarch makes its
  // controller the new monarch.
  if (resultState.monarchId) {
    const hit = combatDamageEvents.find(
      e => e.damagedPlayerId === resultState.monarchId && e.damage > 0 && e.controllerId !== resultState.monarchId,
    );
    if (hit) resultState = { ...resultState, monarchId: hit.controllerId };
  }

  return resultState;
}

export function resolveCombatDamage(state: GameState): GameState {
  if (!state.combat) throw new Error("No combat state");

  const hasFirstStrikers = checkForFirstStrikers(state);

  if (!hasFirstStrikers) {
    // No first strikers — single damage step (same behavior as before)
    return checkStateBasedActions(resolveDamageStep(state, 'normal'));
  }

  // Two-step combat damage:
  // 1. First strike damage step
  let afterFirstStrike = resolveDamageStep(state, 'first');

  // 2. Check state-based actions (creatures die from first strike damage)
  afterFirstStrike = checkStateBasedActions(afterFirstStrike);

  // 3. Normal damage step (dead creatures from first strike won't deal damage
  //    because resolveDamageStep checks zone === 'battlefield')
  return checkStateBasedActions(resolveDamageStep(afterFirstStrike, 'normal'));
}
