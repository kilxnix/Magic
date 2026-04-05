import { GameState, Phase, StackItem, SpellStackItem, TriggeredAbilityStackItem, isSpellStackItem, isTriggeredAbilityStackItem, isActivatedAbilityStackItem, TriggeredAbilityRef } from './types';
import { getCardDefinition } from './game-state';
import { parseManaString, canPayCost, payManaCost } from './mana';
import { getOverride } from './effects/overrides';
import { parseOracleText } from './effects/parser';
import { executeEffectsWithSBA } from './effects/executor';
import { validateTargetChoices, TargetSpec, TargetType } from './effects/targets';
import { checkStateBasedActions } from './state-based';
import type { Effect } from './effects/ast';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];
const PERMANENT_TYPES = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'];

let stackCounter = 0;

/**
 * Normalize oracle text for the parser by replacing the card's own name with '~'.
 * Scryfall oracle text uses the literal card name; the parser expects '~'.
 */
function normalizeOracleText(oracleText: string, cardName: string): string {
  if (!cardName) return oracleText;
  // Escape any regex special characters in the card name
  const escaped = cardName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return oracleText.replace(new RegExp(escaped, 'gi'), '~');
}

/**
 * Calculate commander tax for a player.
 */
function getCommanderTax(state: GameState, playerId: string): number {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return 0;
  return player.commanderCastCount * 2; // {2} per previous cast
}

export function canCastSpell(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;

  // Can cast from hand OR command zone (if it's the player's commander)
  const player = state.players.find(p => p.id === playerId);
  const isCommander = player?.commanderInstanceId === cardInstanceId;
  const validZone = card.zone === 'hand' || (card.zone === 'command' && isCommander);
  if (!validZone) return false;

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

  // Check mana (including commander tax for command zone casts)
  const baseCost = parseManaString(def.mana_cost);
  const taxAmount = card.zone === 'command' ? getCommanderTax(state, playerId) : 0;
  const totalCost = { ...baseCost, generic: baseCost.generic + taxAmount };

  if (!canPayCost(player!.manaPool, totalCost)) return false;

  return true;
}

export function castSpell(state: GameState, playerId: string, cardInstanceId: string, targets: string[] = [], chosenModes?: number[]): GameState {
  if (!canCastSpell(state, playerId, cardInstanceId)) {
    throw new Error('Cannot cast spell');
  }

  const card = state.cards.get(cardInstanceId)!;
  const def = getCardDefinition(state, card);
  const cost = parseManaString(def.mana_cost);

  // Pay mana (including commander tax if from command zone)
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const isFromCommandZone = card.zone === 'command';
  const taxAmount = isFromCommandZone ? getCommanderTax(state, playerId) : 0;
  const totalCost = { ...cost, generic: cost.generic + taxAmount };
  const newManaPool = payManaCost(player.manaPool, totalCost);

  // Increment commander cast count if casting from command zone
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex
      ? { ...p, manaPool: newManaPool, commanderCastCount: isFromCommandZone ? p.commanderCastCount + 1 : p.commanderCastCount }
      : p
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
    ...(chosenModes ? { chosenModes } : {}),
  };

  let resultState: GameState = {
    ...state,
    cards: newCards,
    players: newPlayers,
    stack: [...state.stack, stackItem],
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };

  // Fire "whenever a spell is cast" triggers
  resultState = checkTriggersForEvent(resultState, {
    kind: 'SpellCast',
    casterId: playerId,
    cardInstanceId,
  });

  return resultState;
}

/**
 * Register ALL triggered abilities for a permanent that just entered the battlefield.
 * Handles ETB, Dies, Attacks, OpponentCastSpell, YouCastSpell, Upkeep, EndStep,
 * AnotherCreatureETB, CreatureYouControlDies, LifeGain, CardDrawn, AnyCreatureETB,
 * CastInstantOrSorcery, Landfall, and more.
 */
export function registerBattlefieldAbilities(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;

  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return state;

  const abilitiesToAdd: TriggeredAbilityRef[] = [];

  // Register tax triggers from cached data (Rhystic Study, Mystic Remora, etc.)
  if (def.unlessTax) {
    const trigger = { kind: def.unlessTax.triggerKind as 'OpponentCastSpell' | 'CardDrawn' };
    const taxEffects = def.unlessTax.effect === 'draw'
      ? [{ kind: 'Draw' as const, player: { kind: 'Controller' as const }, count: def.unlessTax.effectCount }]
      : [];
    abilitiesToAdd.push({
      kind: 'TriggeredAbility' as const,
      trigger,
      effects: taxEffects,
    } as TriggeredAbilityRef);
  }

  // Check for override first (ETB overrides)
  const override = getOverride(def.id, def.name);
  if (override && override.kind === 'ETB') {
    abilitiesToAdd.push(override.ability as TriggeredAbilityRef);
  }

  // Parse oracle text — may contain multiple abilities across sentences
  // Split oracle text by newlines to parse each ability line separately
  const lines = def.oracle_text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parsed = parseOracleText(normalizeOracleText(trimmed, def.name));

    if (parsed.kind === 'ETB') {
      // Only add if we didn't already get an override for ETB
      if (!override || override.kind !== 'ETB') {
        abilitiesToAdd.push(parsed.ability as TriggeredAbilityRef);
      }
    } else if (parsed.kind === 'Dies') {
      abilitiesToAdd.push(parsed.ability as TriggeredAbilityRef);
    } else if (parsed.kind === 'Triggered') {
      // This covers: Attacks, Upkeep, EndStep, AnotherCreatureETB,
      // CreatureYouControlDies, YouCastSpell, OpponentCastSpell,
      // LifeGain, CardDrawn, AnyCreatureETB, CastInstantOrSorcery, Landfall
      // Deduplicate: skip if a trigger of this kind was already added from cached data
      const parsedTriggerKind = (parsed.ability as TriggeredAbilityRef).trigger.kind;
      const alreadyRegistered = abilitiesToAdd.some(a => a.trigger.kind === parsedTriggerKind);
      if (!alreadyRegistered) {
        abilitiesToAdd.push(parsed.ability as TriggeredAbilityRef);
      }
    }
  }

  if (abilitiesToAdd.length === 0) return state;

  const newAbilities = new Map(state.battlefieldAbilities || new Map());
  const existing = newAbilities.get(instanceId) || [];
  newAbilities.set(instanceId, [...existing, ...abilitiesToAdd]);
  return { ...state, battlefieldAbilities: newAbilities };
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
    const parsed = parseOracleText(normalizeOracleText(def.oracle_text, def.name));
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

  // Handle activated ability resolution
  if (isActivatedAbilityStackItem(topItem)) {
    let resultState: GameState = {
      ...state,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    const effects = topItem.ability.effects as Effect[];
    const targetSpecs = topItem.ability.targets as TargetSpec[];

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
    const entersTapped = def.oracle_text.toLowerCase().includes('enters the battlefield tapped')
      || def.oracle_text.toLowerCase().includes('enters tapped');
    newCards.set(card.instanceId, {
      ...card,
      zone: 'battlefield',
      tapped: entersTapped,
      summoningSick: isCreature,
    });

    resultState = {
      ...state,
      cards: newCards,
      stack: newStack,
      hasPriorityPassed: new Array(state.players.length).fill(false),
      priorityPlayerIndex: state.activePlayerIndex,
    };

    // Register all triggered abilities for this permanent (ETB, dies, attacks, etc.)
    resultState = registerBattlefieldAbilities(resultState, card.instanceId);
    // Create ETB triggers for this specific permanent (self-ETB)
    resultState = createETBTriggers(resultState, card.instanceId);

    // Fire "whenever a creature enters the battlefield" triggers on OTHER permanents
    if (isCreature) {
      resultState = checkTriggersForEvent(resultState, {
        kind: 'CreatureETB',
        instanceId: card.instanceId,
        controllerId: card.ownerId,
      });
    }
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
      const parsed = parseOracleText(normalizeOracleText(def.oracle_text, def.name));
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
      } else if (parsed.kind === 'Modal' && spellItem.chosenModes && spellItem.chosenModes.length > 0) {
        // Modal spell: collect effects and targets from chosen modes
        const modal = parsed.modal;

        // Validate mode count matches spell requirement
        if (spellItem.chosenModes.length !== modal.chooseCount) {
          throw new Error(`Modal spell requires ${modal.chooseCount} mode(s), got ${spellItem.chosenModes.length}`);
        }
        const allEffects: Effect[] = [];
        const allTargetSpecs: TargetSpec[] = [];

        for (const modeIndex of spellItem.chosenModes) {
          if (modeIndex >= 0 && modeIndex < modal.choices.length) {
            const choice = modal.choices[modeIndex];
            allEffects.push(...choice.effects);
            // Convert ModalChoice targets to TargetSpecs
            for (const t of choice.targets) {
              allTargetSpecs.push({ id: t.id, type: t.type as TargetType, count: 1 });
            }
          }
        }

        // Validate targets if any
        if (allTargetSpecs.length > 0) {
          validateTargetChoices(intermediateState, spellItem.casterId, allTargetSpecs, spellItem.targets);
        }

        // Execute effects with SBA check
        resultState = executeEffectsWithSBA(
          intermediateState,
          allEffects,
          spellItem.casterId,
          spellItem.targets,
          allTargetSpecs,
        );
      } else {
        // Unparsed spell (or modal with no chosenModes): just resolve without effects (card still goes to graveyard)
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
    eventContext: trigger.eventContext,
  }));

  return {
    ...state,
    stack: [...state.stack, ...newStackItems],
    pendingTriggers: [],
  };
}

// ============================================================================
// Event-driven trigger checking
// ============================================================================

/**
 * Game event types that can fire triggers.
 */
export type GameEvent =
  | { kind: 'SpellCast'; casterId: string; cardInstanceId: string }
  | { kind: 'CreatureETB'; instanceId: string; controllerId: string }
  | { kind: 'Attacks'; attackerInstanceId: string; controllerId: string }
  | { kind: 'LandETB'; instanceId: string; controllerId: string }
  | { kind: 'UpkeepStart'; activePlayerId: string }
  | { kind: 'EndStepStart'; activePlayerId: string };

/**
 * Check all battlefield permanents for triggers matching a game event.
 * Creates pending trigger entries for any matches.
 *
 * This is the CORE function that connects game events to the trigger system.
 * It must be called whenever a relevant game event occurs.
 */
export function checkTriggersForEvent(state: GameState, event: GameEvent): GameState {
  if (!state.battlefieldAbilities || state.battlefieldAbilities.size === 0) return state;

  const newPendingTriggers = [...(state.pendingTriggers || [])];

  for (const [instanceId, abilities] of state.battlefieldAbilities) {
    // Verify the permanent is still on the battlefield
    const card = state.cards.get(instanceId);
    if (!card || card.zone !== 'battlefield') continue;

    const controllerId = card.ownerId;

    for (const ability of abilities) {
      const trigger = ability.trigger;
      let shouldFire = false;

      switch (event.kind) {
        case 'SpellCast': {
          // "Whenever an opponent casts a spell"
          if (trigger.kind === 'OpponentCastSpell' && event.casterId !== controllerId) {
            shouldFire = true;
          }
          // "Whenever you cast a spell"
          if (trigger.kind === 'YouCastSpell' && event.casterId === controllerId) {
            shouldFire = true;
          }
          // "Whenever you cast an instant or sorcery spell"
          if (trigger.kind === 'CastInstantOrSorcery' && event.casterId === controllerId) {
            const spellCard = state.cards.get(event.cardInstanceId);
            if (spellCard) {
              const spellDef = state.cardDefinitions.get(spellCard.definitionId);
              if (spellDef && (spellDef.card_types.includes('instant') || spellDef.card_types.includes('sorcery'))) {
                shouldFire = true;
              }
            }
          }
          break;
        }

        case 'CreatureETB': {
          // "Whenever another creature enters the battlefield under your control"
          if (trigger.kind === 'AnotherCreatureETB'
            && (trigger as { kind: 'AnotherCreatureETB'; controller: string }).controller === 'yours'
            && event.controllerId === controllerId
            && event.instanceId !== instanceId) {
            shouldFire = true;
          }
          // "Whenever a creature enters the battlefield"
          if (trigger.kind === 'AnyCreatureETB' && event.instanceId !== instanceId) {
            shouldFire = true;
          }
          break;
        }

        case 'Attacks': {
          // "Whenever ~ attacks"
          if (trigger.kind === 'Attacks' && (trigger as { kind: 'Attacks'; who: string }).who === 'self'
            && event.attackerInstanceId === instanceId) {
            shouldFire = true;
          }
          break;
        }

        case 'LandETB': {
          // "Whenever a land enters the battlefield under your control"
          if (trigger.kind === 'Landfall' && event.controllerId === controllerId) {
            shouldFire = true;
          }
          break;
        }

        case 'UpkeepStart': {
          // "At the beginning of your upkeep"
          if (trigger.kind === 'Upkeep') {
            const upkeepTrigger = trigger as { kind: 'Upkeep'; whose: string };
            if (upkeepTrigger.whose === 'yours' && event.activePlayerId === controllerId) {
              shouldFire = true;
            }
            if (upkeepTrigger.whose === 'each') {
              shouldFire = true;
            }
          }
          break;
        }

        case 'EndStepStart': {
          // "At the beginning of your end step"
          if (trigger.kind === 'EndStep'
            && (trigger as { kind: 'EndStep'; whose: string }).whose === 'yours'
            && event.activePlayerId === controllerId) {
            shouldFire = true;
          }
          break;
        }
      }

      if (shouldFire) {
        // Get target specs for this ability from parsing
        let targetSpecs: TargetSpec[] = [];
        const cardDef = state.cardDefinitions.get(card.definitionId);
        if (cardDef) {
          // Parse the specific line that matches this trigger
          const lines = cardDef.oracle_text.split('\n');
          for (const line of lines) {
            const parsed = parseOracleText(normalizeOracleText(line.trim(), cardDef.name));
            if ((parsed.kind === 'Triggered' || parsed.kind === 'ETB' || parsed.kind === 'Dies')
              && parsed.ability.trigger.kind === trigger.kind) {
              targetSpecs = parsed.targets;
              break;
            }
          }
        }

        newPendingTriggers.push({
          id: `trigger_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          sourceInstanceId: instanceId,
          controllerId,
          ability,
          requiredTargets: targetSpecs,
          eventContext: event.kind === 'SpellCast'
            ? { casterId: event.casterId, cardInstanceId: event.cardInstanceId }
            : undefined,
        });
      }
    }
  }

  return { ...state, pendingTriggers: newPendingTriggers };
}
