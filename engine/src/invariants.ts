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

function stackItemId(item: StackItem): string {
  return item.id;
}

export function validateStateInvariants(state: GameState): StateInvariantReport {
  const violations: StateInvariantViolation[] = [];

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
  });

  const stackIds = new Set<string>();
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
      const card = state.cards.get(item.cardInstanceId);
      if (!card) {
        violations.push({
          code: 'missing_stack_spell_card',
          message: `Spell stack object ${id} references missing card ${item.cardInstanceId}.`,
        });
      } else if (card.zone !== 'stack') {
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

  return { ok: violations.length === 0, violations };
}
