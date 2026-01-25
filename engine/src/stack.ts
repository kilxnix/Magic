import { GameState, Phase, StackItem, SpellStackItem, TriggeredAbilityStackItem, isSpellStackItem, isTriggeredAbilityStackItem, TriggeredAbilityRef } from './types';
import { getCardDefinition } from './game-state';
import { parseManaString, canPayCost, payManaCost } from './mana';
import { getOverride } from './effects/overrides';
import { parseOracleText } from './effects/parser';
import { executeEffectsWithSBA } from './effects/executor';
import { validateTargetChoices, TargetSpec } from './effects/targets';
import { checkStateBasedActions } from './state-based';
import type { Effect } from './effects/ast';

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
  const stackItem: SpellStackItem = {
    kind: 'Spell',
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

/**
 * Register ETB abilities for a permanent that just entered the battlefield.
 */
function registerETBAbilities(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;

  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return state;

  // Check for ETB override first
  const override = getOverride(def.id, def.name);
  if (override && override.kind === 'ETB') {
    const newAbilities = new Map(state.battlefieldAbilities);
    const existing = newAbilities.get(instanceId) || [];
    newAbilities.set(instanceId, [...existing, override.ability as TriggeredAbilityRef]);
    return { ...state, battlefieldAbilities: newAbilities };
  }

  // Try to parse oracle text for ETB
  const parsed = parseOracleText(def.oracle_text);
  if (parsed.kind === 'ETB') {
    const newAbilities = new Map(state.battlefieldAbilities);
    const existing = newAbilities.get(instanceId) || [];
    newAbilities.set(instanceId, [...existing, parsed.ability as TriggeredAbilityRef]);
    return { ...state, battlefieldAbilities: newAbilities };
  }

  return state;
}

/**
 * Create pending triggers for a permanent that just entered the battlefield.
 */
function createETBTriggers(state: GameState, instanceId: string): GameState {
  const abilities = state.battlefieldAbilities.get(instanceId);
  if (!abilities || abilities.length === 0) return state;

  const card = state.cards.get(instanceId);
  if (!card) return state;

  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return state;

  // Get target specs from parsing
  const override = getOverride(def.id, def.name);
  let targetSpecs: TargetSpec[] = [];

  if (override && override.kind === 'ETB') {
    targetSpecs = override.targets;
  } else {
    const parsed = parseOracleText(def.oracle_text);
    if (parsed.kind === 'ETB') {
      targetSpecs = parsed.targets;
    }
  }

  const newPendingTriggers = [...state.pendingTriggers];

  for (const ability of abilities) {
    if (ability.trigger.kind === 'ETB' && ability.trigger.who === 'self') {
      newPendingTriggers.push({
        id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        sourceInstanceId: instanceId,
        controllerId: card.ownerId,
        ability,
        requiredTargets: targetSpecs,
      });
    }
  }

  return { ...state, pendingTriggers: newPendingTriggers };
}

export function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    throw new Error('Stack is empty');
  }

  const topItem = state.stack[state.stack.length - 1];
  const newStack = state.stack.slice(0, -1);

  // Handle triggered ability resolution
  if (isTriggeredAbilityStackItem(topItem)) {
    let resultState: GameState = {
      ...state,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    // Execute the triggered ability's effects
    const effects = topItem.ability.effects as Effect[];
    const targetSpecs = [] as TargetSpec[]; // TODO: Get from ability

    resultState = executeEffectsWithSBA(
      resultState,
      effects,
      topItem.controllerId,
      topItem.targets,
      targetSpecs,
    );

    return resultState;
  }

  // Handle spell resolution (existing logic)
  const spellItem = topItem as SpellStackItem;
  const card = state.cards.get(spellItem.cardInstanceId)!;
  const def = state.cardDefinitions.get(card.definitionId)!;

  let newCards = new Map(state.cards);
  const isPermanent = def.card_types.some(t => PERMANENT_TYPES.includes(t));

  let resultState: GameState;

  if (isPermanent) {
    // Permanents enter the battlefield
    const isCreature = def.card_types.includes('creature');
    newCards.set(card.instanceId, {
      ...card,
      zone: 'battlefield',
      tapped: false,
      summoningSick: isCreature,
    });

    resultState = {
      ...state,
      cards: newCards,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    // Register and create ETB triggers
    resultState = registerETBAbilities(resultState, card.instanceId);
    resultState = createETBTriggers(resultState, card.instanceId);
  } else {
    // Instants and sorceries: execute effects, then go to graveyard

    // Move spell to graveyard first (standard behavior)
    newCards.set(card.instanceId, { ...card, zone: 'graveyard' });

    let intermediateState: GameState = {
      ...state,
      cards: newCards,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    // Try to find effect definition: override first, then parse
    const override = getOverride(def.id, def.name);
    if (override && override.kind === 'Spell') {
      // Validate targets
      validateTargetChoices(intermediateState, spellItem.casterId, override.targets, spellItem.targets);
      // Execute effects with SBA check
      resultState = executeEffectsWithSBA(
        intermediateState,
        override.effects,
        spellItem.casterId,
        spellItem.targets,
        override.targets,
      );
    } else {
      // Try to parse oracle text
      const parsed = parseOracleText(def.oracle_text);
      if (parsed.kind === 'Spell') {
        // Validate targets
        validateTargetChoices(intermediateState, spellItem.casterId, parsed.targets, spellItem.targets);
        // Execute effects with SBA check
        resultState = executeEffectsWithSBA(
          intermediateState,
          parsed.effects,
          spellItem.casterId,
          spellItem.targets,
          parsed.targets,
        );
      } else {
        // Unparsed spell: just resolve without effects (card still goes to graveyard)
        // Run SBAs anyway
        resultState = checkStateBasedActions(intermediateState);
      }
    }
  }

  return resultState;
}

/**
 * Move pending triggers to the stack.
 * In APNAP order (active player first, then clockwise).
 */
export function putTriggersOnStack(state: GameState): GameState {
  if (state.pendingTriggers.length === 0) return state;

  // Sort triggers by APNAP order
  const playerOrder: string[] = [];
  for (let i = 0; i < state.players.length; i++) {
    const idx = (state.activePlayerIndex + i) % state.players.length;
    playerOrder.push(state.players[idx].id);
  }

  const sortedTriggers = [...state.pendingTriggers].sort((a, b) => {
    const aIdx = playerOrder.indexOf(a.controllerId);
    const bIdx = playerOrder.indexOf(b.controllerId);
    return aIdx - bIdx;
  });

  // Create stack items for each trigger
  const newStackItems: TriggeredAbilityStackItem[] = sortedTriggers.map(trigger => ({
    kind: 'TriggeredAbility' as const,
    id: trigger.id,
    sourceInstanceId: trigger.sourceInstanceId,
    controllerId: trigger.controllerId,
    ability: trigger.ability,
    targets: [], // TODO: Handle target selection for triggered abilities
  }));

  return {
    ...state,
    stack: [...state.stack, ...newStackItems],
    pendingTriggers: [],
  };
}
