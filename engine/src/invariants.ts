import type { GameState, StackItem } from './types';

export interface StateInvariantViolation {
  code: string;
  message: string;
}

export interface StateInvariantReport {
  ok: boolean;
  violations: StateInvariantViolation[];
}

const VALID_ZONES = new Set(['library', 'hand', 'battlefield', 'graveyard', 'exile', 'stack', 'command']);
const VALID_PHASES = new Set(['beginning', 'precombat_main', 'combat', 'postcombat_main', 'ending']);
const VALID_STEPS = new Set([
  'untap', 'upkeep', 'draw', 'main', 'begin_combat', 'declare_attackers',
  'declare_blockers', 'first_strike_damage', 'combat_damage', 'end_of_combat',
  'end', 'cleanup',
]);
const MANA_COLORS = ['W', 'U', 'B', 'R', 'G', 'C'] as const;

function stackItemId(item: StackItem): string {
  return item.id;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pushNumericViolation(
  violations: StateInvariantViolation[],
  code: string,
  label: string,
  value: unknown,
  options: { allowNegative?: boolean } = {},
): void {
  if (!isFiniteNumber(value)) {
    violations.push({
      code,
      message: `${label} must be a finite number.`,
    });
    return;
  }
  if (!options.allowNegative && value < 0) {
    violations.push({
      code,
      message: `${label} must not be negative.`,
    });
  }
}

export function validateStateInvariants(state: GameState): StateInvariantReport {
  const violations: StateInvariantViolation[] = [];
  const spellStackCardIds = new Set(
    state.stack
      .filter((item): item is Extract<StackItem, { kind: 'Spell' }> => item.kind === 'Spell')
      .map(item => item.cardInstanceId),
  );

  state.cards.forEach((card, id) => {
    if (id !== card.instanceId) {
      violations.push({
        code: 'card_key_mismatch',
        message: `Card map key ${id} does not match instance ${card.instanceId}.`,
      });
    }
    if (!VALID_ZONES.has(card.zone)) {
      violations.push({
        code: 'invalid_zone',
        message: `${card.instanceId} is in invalid zone ${card.zone}.`,
      });
    }
    if (!state.players.some(player => player.id === card.ownerId)) {
      violations.push({
        code: 'missing_owner',
        message: `${card.instanceId} has missing owner ${card.ownerId}.`,
      });
    }
    if (!state.cardDefinitions.has(card.definitionId)) {
      violations.push({
        code: 'missing_definition',
        message: `${card.instanceId} references missing definition ${card.definitionId}.`,
      });
    }
    pushNumericViolation(violations, 'invalid_card_damage', `${card.instanceId} marked damage`, card.damage);
    for (const [counterName, amount] of Object.entries(card.counters || {})) {
      if (!counterName.trim()) {
        violations.push({
          code: 'empty_counter_name',
          message: `${card.instanceId} has an empty counter name.`,
        });
      }
      pushNumericViolation(violations, 'invalid_card_counter', `${card.instanceId} ${counterName} counter count`, amount);
    }
    if (card.zone === 'stack' && !spellStackCardIds.has(card.instanceId)) {
      violations.push({
        code: 'stack_zone_without_stack_object',
        message: `${card.instanceId} is in the stack zone without a matching spell stack object.`,
      });
    }
    if (card.isToken && card.zone !== 'battlefield') {
      violations.push({
        code: 'token_outside_battlefield',
        message: `Token ${card.instanceId} exists in ${card.zone}; tokens should cease to exist outside the battlefield.`,
      });
    }
    if (card.attachedTo) {
      const target = state.cards.get(card.attachedTo);
      if (!target) {
        violations.push({
          code: 'missing_attachment_target',
          message: `${card.instanceId} is attached to missing object ${card.attachedTo}.`,
        });
      } else if (card.zone !== 'battlefield' || target.zone !== 'battlefield') {
        violations.push({
          code: 'invalid_attachment_zone',
          message: `${card.instanceId} attached to ${card.attachedTo}, but one or both objects are not on the battlefield.`,
        });
      }
    }
  });

  const playerIds = new Set<string>();
  state.players.forEach((player, index) => {
    if (playerIds.has(player.id)) {
      violations.push({
        code: 'duplicate_player_id',
        message: `Player id ${player.id} appears more than once.`,
      });
    }
    playerIds.add(player.id);

    pushNumericViolation(violations, 'invalid_life_total', `${player.id} life total`, player.life, { allowNegative: true });
    pushNumericViolation(violations, 'invalid_poison_counter', `${player.id} poison counters`, player.poisonCounters);
    pushNumericViolation(violations, 'invalid_commander_tax', `${player.id} commander tax`, player.commanderTax);
    pushNumericViolation(violations, 'invalid_commander_cast_count', `${player.id} commander cast count`, player.commanderCastCount);
    pushNumericViolation(violations, 'invalid_lands_played', `${player.id} lands played this turn`, player.landsPlayedThisTurn ?? 0);
    for (const color of MANA_COLORS) {
      pushNumericViolation(violations, 'invalid_mana_pool', `${player.id} ${color} mana`, player.manaPool?.[color]);
      pushNumericViolation(violations, 'invalid_snow_mana_pool', `${player.id} ${color} snow mana`, player.snowManaPool?.[color] ?? 0);
    }
    for (const [counterName, amount] of Object.entries(player.playerCounters || {})) {
      if (!counterName.trim()) {
        violations.push({
          code: 'empty_player_counter_name',
          message: `${player.id} has an empty player counter name.`,
        });
      }
      pushNumericViolation(violations, 'invalid_player_counter', `${player.id} ${counterName} counter count`, amount);
    }
    for (const [commanderId, amount] of Object.entries(player.commanderDamage || {})) {
      pushNumericViolation(violations, 'invalid_commander_damage', `${player.id} commander damage from ${commanderId}`, amount);
      const commander = state.cards.get(commanderId);
      if (!commander) {
        violations.push({
          code: 'missing_commander_damage_source',
          message: `${player.id} has commander damage from missing commander ${commanderId}.`,
        });
      } else if (!commander.isCommander) {
        violations.push({
          code: 'noncommander_damage_source',
          message: `${player.id} has commander damage from non-commander ${commanderId}.`,
        });
      }
    }
    for (const [commanderId, castCount] of Object.entries(player.commanderCastCounts || {})) {
      pushNumericViolation(violations, 'invalid_commander_cast_count', `${player.id} commander ${commanderId} cast count`, castCount);
    }
    const commanderIds = new Set([player.commanderInstanceId, ...(player.commanderInstanceIds || [])].filter(Boolean) as string[]);
    for (const commanderId of commanderIds) {
      const commander = state.cards.get(commanderId);
      if (!commander) {
        violations.push({
          code: 'missing_player_commander',
          message: `${player.id} references missing commander ${commanderId}.`,
        });
      } else if (!commander.isCommander) {
        violations.push({
          code: 'player_commander_not_marked',
          message: `${player.id} references ${commanderId} as commander, but the card is not marked as a commander.`,
        });
      } else if (commander.ownerId !== player.id) {
        violations.push({
          code: 'player_commander_wrong_owner',
          message: `${player.id} references commander ${commanderId} owned by ${commander.ownerId}.`,
        });
      }
    }
  });

  const stackIds = new Set<string>();
  const spellStackCardIdsSeen = new Set<string>();
  for (const item of state.stack) {
    const id = stackItemId(item);
    if (stackIds.has(id)) {
      violations.push({
        code: 'duplicate_stack_id',
        message: `Stack object ${id} appears more than once.`,
      });
    }
    stackIds.add(id);

    if (item.kind === 'Spell') {
      if (spellStackCardIdsSeen.has(item.cardInstanceId)) {
        violations.push({
          code: 'duplicate_spell_stack_card',
          message: `${item.cardInstanceId} appears in more than one spell stack object.`,
        });
      }
      spellStackCardIdsSeen.add(item.cardInstanceId);
      const card = state.cards.get(item.cardInstanceId);
      if (!card) {
        violations.push({
          code: 'missing_stack_spell_card',
          message: `Spell stack object ${id} references missing card ${item.cardInstanceId}.`,
        });
      } else if (!item.isCopy && card.zone !== 'stack') {
        violations.push({
          code: 'stack_spell_card_not_on_stack',
          message: `Spell stack object ${id} references ${item.cardInstanceId} in ${card.zone}.`,
        });
      }
      if (!state.players.some(player => player.id === item.casterId)) {
        violations.push({
          code: 'missing_stack_controller',
          message: `Spell stack object ${id} has missing caster ${item.casterId}.`,
        });
      }
      if (!Array.isArray(item.targets)) {
        violations.push({
          code: 'invalid_stack_targets',
          message: `Spell stack object ${id} has malformed targets.`,
        });
      }
    } else {
      const sourceId = item.sourceInstanceId;
      if (sourceId && !state.cards.has(sourceId)) {
        violations.push({
          code: 'missing_stack_source',
          message: `${item.kind} stack object ${id} references missing source ${sourceId}.`,
        });
      }
      if (!state.players.some(player => player.id === item.controllerId)) {
        violations.push({
          code: 'missing_stack_controller',
          message: `${item.kind} stack object ${id} has missing controller ${item.controllerId}.`,
        });
      }
      if (!Array.isArray(item.targets)) {
        violations.push({
          code: 'invalid_stack_targets',
          message: `${item.kind} stack object ${id} has malformed targets.`,
        });
      }
    }
  }

  if (state.activePlayerIndex < 0 || state.activePlayerIndex >= state.players.length) {
    violations.push({
      code: 'invalid_active_player',
      message: `Active player index ${state.activePlayerIndex} is out of bounds.`,
    });
  }
  if (state.priorityPlayerIndex < 0 || state.priorityPlayerIndex >= state.players.length) {
    violations.push({
      code: 'invalid_priority_player',
      message: `Priority player index ${state.priorityPlayerIndex} is out of bounds.`,
    });
  }
  if (state.hasPriorityPassed.length !== state.players.length) {
    violations.push({
      code: 'priority_pass_shape',
      message: 'Priority pass flags do not match player count.',
    });
  }
  if (!VALID_PHASES.has(state.phase) || !VALID_STEPS.has(state.step)) {
    violations.push({
      code: 'invalid_phase_step',
      message: `Phase ${state.phase} or step ${state.step} is not recognized.`,
    });
  }
  pushNumericViolation(violations, 'invalid_turn_number', 'turn number', state.turnNumber);
  pushNumericViolation(violations, 'invalid_spells_cast_count', 'spells cast this turn', state.spellsCastThisTurn ?? 0);

  const pendingIds = new Set<string>();
  for (const trigger of state.pendingTriggers || []) {
    if (pendingIds.has(trigger.id)) {
      violations.push({
        code: 'duplicate_pending_trigger_id',
        message: `Pending trigger ${trigger.id} appears more than once.`,
      });
    }
    pendingIds.add(trigger.id);
    if (!state.cards.has(trigger.sourceInstanceId)) {
      violations.push({
        code: 'missing_pending_trigger_source',
        message: `Pending trigger ${trigger.id} references missing source ${trigger.sourceInstanceId}.`,
      });
    }
    if (!playerIds.has(trigger.controllerId)) {
      violations.push({
        code: 'missing_pending_trigger_controller',
        message: `Pending trigger ${trigger.id} references missing controller ${trigger.controllerId}.`,
      });
    }
    if (!Array.isArray(trigger.requiredTargets)) {
      violations.push({
        code: 'invalid_pending_trigger_targets',
        message: `Pending trigger ${trigger.id} has malformed required targets.`,
      });
    }
  }

  for (const [sourceId] of state.battlefieldAbilities || []) {
    const source = state.cards.get(sourceId);
    if (!source) {
      violations.push({
        code: 'missing_battlefield_ability_source',
        message: `Battlefield abilities reference missing source ${sourceId}.`,
      });
    } else if (source.zone !== 'battlefield') {
      violations.push({
        code: 'battlefield_ability_source_not_battlefield',
        message: `Battlefield abilities reference ${sourceId} in ${source.zone}.`,
      });
    }
  }

  for (const effect of state.continuousEffects || []) {
    if (effect.sourceInstanceId && !state.cards.has(effect.sourceInstanceId)) {
      violations.push({
        code: 'missing_continuous_effect_source',
        message: `Continuous effect ${effect.id} references missing source ${effect.sourceInstanceId}.`,
      });
    }
    if (!playerIds.has(effect.controllerId)) {
      violations.push({
        code: 'missing_continuous_effect_controller',
        message: `Continuous effect ${effect.id} references missing controller ${effect.controllerId}.`,
      });
    }
  }

  for (const prevention of state.damagePreventionEffects || []) {
    if (prevention.sourceInstanceId && !state.cards.has(prevention.sourceInstanceId)) {
      violations.push({
        code: 'missing_prevention_effect_source',
        message: `Damage prevention effect ${prevention.id} references missing source ${prevention.sourceInstanceId}.`,
      });
    }
    if (prevention.protectedTargetId && !state.cards.has(prevention.protectedTargetId) && !playerIds.has(prevention.protectedTargetId)) {
      violations.push({
        code: 'missing_prevention_target',
        message: `Damage prevention effect ${prevention.id} references missing protected target ${prevention.protectedTargetId}.`,
      });
    }
    if (!playerIds.has(prevention.controllerId)) {
      violations.push({
        code: 'missing_prevention_controller',
        message: `Damage prevention effect ${prevention.id} references missing controller ${prevention.controllerId}.`,
      });
    }
    pushNumericViolation(violations, 'invalid_prevention_expiry', `Damage prevention effect ${prevention.id} expiry`, prevention.expiresAtTurnNumber);
  }

  if (state.combat) {
    const attackingIds = new Set<string>();
    for (const attacker of state.combat.attackers) {
      const attackingCard = state.cards.get(attacker.cardInstanceId);
      if (!attackingCard) {
        violations.push({
          code: 'missing_combat_attacker',
          message: `Combat attacker ${attacker.cardInstanceId} is missing.`,
        });
      } else if (attackingCard.zone !== 'battlefield') {
        violations.push({
          code: 'combat_attacker_not_battlefield',
          message: `Combat attacker ${attacker.cardInstanceId} is in ${attackingCard.zone}.`,
        });
      }
      if (attackingIds.has(attacker.cardInstanceId)) {
        violations.push({
          code: 'duplicate_combat_attacker',
          message: `Combat attacker ${attacker.cardInstanceId} is declared more than once.`,
        });
      }
      attackingIds.add(attacker.cardInstanceId);
      if (!playerIds.has(attacker.defendingPlayerId)) {
        violations.push({
          code: 'missing_combat_defender',
          message: `Combat attacker ${attacker.cardInstanceId} points at missing defender ${attacker.defendingPlayerId}.`,
        });
      }
    }

    const blockingIds = new Set<string>();
    for (const blocker of state.combat.blockers) {
      const blockingCard = state.cards.get(blocker.cardInstanceId);
      if (!blockingCard) {
        violations.push({
          code: 'missing_combat_blocker',
          message: `Combat blocker ${blocker.cardInstanceId} is missing.`,
        });
      } else if (blockingCard.zone !== 'battlefield') {
        violations.push({
          code: 'combat_blocker_not_battlefield',
          message: `Combat blocker ${blocker.cardInstanceId} is in ${blockingCard.zone}.`,
        });
      }
      if (blockingIds.has(blocker.cardInstanceId)) {
        violations.push({
          code: 'duplicate_combat_blocker',
          message: `Combat blocker ${blocker.cardInstanceId} is declared more than once.`,
        });
      }
      blockingIds.add(blocker.cardInstanceId);
      if (!attackingIds.has(blocker.blockingAttackerId)) {
        violations.push({
          code: 'blocker_missing_attacker',
          message: `Combat blocker ${blocker.cardInstanceId} points at missing attacker ${blocker.blockingAttackerId}.`,
        });
      }
    }

    for (const [attackerId, damage] of state.combat.damageAssignment || new Map<string, number>()) {
      if (!attackingIds.has(attackerId)) {
        violations.push({
          code: 'damage_assignment_missing_attacker',
          message: `Combat damage assignment references missing attacker ${attackerId}.`,
        });
      }
      pushNumericViolation(violations, 'invalid_damage_assignment', `Combat damage assignment for ${attackerId}`, damage);
    }
  }

  return { ok: violations.length === 0, violations };
}
