/**
 * Replacement Effects Framework (Phase 10)
 *
 * Handles "If would... instead" effects that modify game events
 * before they happen. These don't use the stack.
 *
 * Examples:
 * - "If damage would be dealt to you, prevent that damage" (damage prevention)
 * - "If a creature would die, exile it instead" (death replacement)
 * - "If you would draw a card, draw two cards instead" (card draw doubling)
 */

import type { GameState, CardInstance, DamagePreventionEffectRef, Zone } from '../types';

// Types of events that can be replaced
export type ReplacementEventType =
  | 'DamageDealt'
  | 'LifeGained'
  | 'LifeLost'
  | 'CardDrawn'
  | 'CreatureDies'
  | 'EntersBattlefield'
  | 'CounterAdded'
  | 'TokenCreated';

// Base replacement effect interface
export interface ReplacementEffect {
  id: string;
  sourceInstanceId: string;
  controllerId: string;
  eventType: ReplacementEventType;
  // Check if this replacement applies to the event
  applies: (state: GameState, event: ReplacementEvent) => boolean;
  // Apply the replacement, returning modified event or null to prevent
  replace: (state: GameState, event: ReplacementEvent) => ReplacementEvent | null;
}

// Event being replaced
export interface ReplacementEvent {
  type: ReplacementEventType;
  targetId?: string;      // Player or permanent affected
  sourceId?: string;      // Source of the event
  amount?: number;        // For damage, life, counters
  isCombatDamage?: boolean;
  cardInstanceId?: string; // For draw, dies, ETB
  destinationZone?: Zone; // For zone-change replacements such as dies -> exile
}

// Result of applying replacement effects
export interface ReplacementResult {
  event: ReplacementEvent | null; // null = event was prevented
  appliedReplacements: string[];  // IDs of applied replacements
}

// Registry of active replacement effects
const activeReplacements: Map<string, ReplacementEffect> = new Map();

/**
 * Register a replacement effect.
 */
export function registerReplacement(effect: ReplacementEffect): void {
  activeReplacements.set(effect.id, effect);
}

/**
 * Unregister a replacement effect.
 */
export function unregisterReplacement(effectId: string): void {
  activeReplacements.delete(effectId);
}

/**
 * Clear all replacement effects (for testing).
 */
export function clearReplacements(): void {
  activeReplacements.clear();
}

/**
 * Get all replacement effects for a permanent.
 */
export function getReplacementsForPermanent(instanceId: string): ReplacementEffect[] {
  return Array.from(activeReplacements.values()).filter(
    r => r.sourceInstanceId === instanceId
  );
}

/**
 * Apply replacement effects to an event.
 * Returns the modified event (or null if prevented).
 *
 * If multiple replacements apply, the affected player/controller chooses
 * which to apply first (for now, we apply in registration order).
 */
export function applyReplacements(
  state: GameState,
  event: ReplacementEvent,
): ReplacementResult {
  let currentEvent: ReplacementEvent | null = event;
  const appliedReplacements: string[] = [];

  // Limit iterations to prevent infinite loops
  const maxIterations = 10;
  let iterations = 0;

  while (currentEvent !== null && iterations < maxIterations) {
    iterations++;

    // Find applicable replacements
    const applicable = Array.from(activeReplacements.values()).filter(
      r => !appliedReplacements.includes(r.id) && r.applies(state, currentEvent!)
    );

    if (applicable.length === 0) break;

    // Apply the first applicable replacement
    // (In a real implementation, the affected player would choose)
    const replacement = applicable[0];
    currentEvent = replacement.replace(state, currentEvent);
    appliedReplacements.push(replacement.id);
  }

  return { event: currentEvent, appliedReplacements };
}

/**
 * Create a damage prevention replacement effect.
 */
export function createDamagePreventionEffect(
  sourceInstanceId: string,
  controllerId: string,
  protectedPlayerId: string,
  preventAmount: number | 'all',
): ReplacementEffect {
  return {
    id: `prevent_damage_${sourceInstanceId}`,
    sourceInstanceId,
    controllerId,
    eventType: 'DamageDealt',
    applies: (_state, event) =>
      event.type === 'DamageDealt' && event.targetId === protectedPlayerId,
    replace: (_state, event) => {
      if (preventAmount === 'all') {
        return null; // Prevent all damage
      }
      const remaining = Math.max(0, (event.amount || 0) - preventAmount);
      if (remaining === 0) return null;
      return { ...event, amount: remaining };
    },
  };
}

/**
 * Create a "dies -> exile instead" replacement effect.
 */
export function createExileInsteadOfDieEffect(
  sourceInstanceId: string,
  controllerId: string,
  filterFn?: (card: CardInstance) => boolean,
): ReplacementEffect {
  return {
    id: `exile_instead_die_${sourceInstanceId}`,
    sourceInstanceId,
    controllerId,
    eventType: 'CreatureDies',
    applies: (state, event) => {
      if (event.type !== 'CreatureDies') return false;
      if (!event.cardInstanceId) return false;
      if (filterFn) {
        const card = state.cards.get(event.cardInstanceId);
        if (!card) return false;
        return filterFn(card);
      }
      return true;
    },
    replace: (_state, event) => ({ ...event, destinationZone: 'exile' }),
  };
}

function clearExpiredPreventionEffects(
  effects: DamagePreventionEffectRef[] | undefined,
  turnNumber: number,
): DamagePreventionEffectRef[] {
  return (effects || []).filter(effect => effect.expiresAtTurnNumber >= turnNumber);
}

/**
 * Add a state-scoped damage prevention effect. Unlike the legacy test registry,
 * these effects are serialized with the game and expire with the turn.
 */
export function registerDamagePrevention(
  state: GameState,
  effect: DamagePreventionEffectRef,
): GameState {
  const active = clearExpiredPreventionEffects(state.damagePreventionEffects, state.turnNumber);
  return { ...state, damagePreventionEffects: [...active, effect] };
}

/**
 * Drop turn-scoped prevention effects that have expired.
 */
export function pruneDamagePreventionEffects(state: GameState): GameState {
  const active = clearExpiredPreventionEffects(state.damagePreventionEffects, state.turnNumber);
  if (active.length === (state.damagePreventionEffects || []).length) return state;
  return { ...state, damagePreventionEffects: active };
}

/**
 * Apply both the legacy replacement registry and state-scoped damage prevention.
 * Returns the possibly updated state because finite prevention shields consume
 * their remaining amount.
 */
export function applyDamageReplacementEffects(
  state: GameState,
  event: ReplacementEvent & { type: 'DamageDealt'; amount: number },
): { state: GameState; event: ReplacementEvent | null; appliedReplacements: string[] } {
  const globalResult = applyReplacements(state, event);
  if (!globalResult.event) {
    return { state, event: null, appliedReplacements: globalResult.appliedReplacements };
  }

  let currentEvent: ReplacementEvent | null = globalResult.event;
  let effects = clearExpiredPreventionEffects(state.damagePreventionEffects, state.turnNumber);
  const appliedReplacements = [...globalResult.appliedReplacements];

  for (const prevention of effects) {
    if (!currentEvent) break;
    if (prevention.protectedTargetId && prevention.protectedTargetId !== currentEvent.targetId) continue;
    if (prevention.combatOnly && !currentEvent.isCombatDamage) continue;

    appliedReplacements.push(prevention.id);
    if (prevention.amount === 'all') {
      currentEvent = null;
      continue;
    }

    const currentAmount: number = currentEvent.amount ?? 0;
    const prevented: number = Math.min(prevention.amount, currentAmount);
    const remainingDamage: number = currentAmount - prevented;
    const remainingShield: number = prevention.amount - prevented;
    effects = remainingShield > 0
      ? effects.map(effect => effect.id === prevention.id ? { ...effect, amount: remainingShield } : effect)
      : effects.filter(effect => effect.id !== prevention.id);
    currentEvent = remainingDamage > 0 ? { ...currentEvent, amount: remainingDamage } : null;
  }

  return {
    state: { ...state, damagePreventionEffects: effects },
    event: currentEvent,
    appliedReplacements,
  };
}

/**
 * Create a card draw doubling effect (like Teferi's Ageless Insight).
 */
export function createDrawDoublingEffect(
  sourceInstanceId: string,
  controllerId: string,
  affectedPlayerId: string,
): ReplacementEffect {
  return {
    id: `double_draw_${sourceInstanceId}`,
    sourceInstanceId,
    controllerId,
    eventType: 'CardDrawn',
    applies: (_state, event) =>
      event.type === 'CardDrawn' && event.targetId === affectedPlayerId,
    replace: (_state, event) => ({
      ...event,
      amount: (event.amount || 1) * 2,
    }),
  };
}

/**
 * Create a counter doubling effect (like Doubling Season for +1/+1 counters).
 */
export function createCounterDoublingEffect(
  sourceInstanceId: string,
  controllerId: string,
  counterType?: string,
): ReplacementEffect {
  return {
    id: `double_counters_${sourceInstanceId}`,
    sourceInstanceId,
    controllerId,
    eventType: 'CounterAdded',
    applies: (state, event) => {
      if (event.type !== 'CounterAdded') return false;
      if (!event.targetId) return false;

      // Only apply to permanents controlled by the effect's controller
      const card = state.cards.get(event.targetId);
      if (!card || card.ownerId !== controllerId) return false;

      // If specific counter type is specified, check it
      // (For now, we don't have counter type in the event, so skip this)

      return true;
    },
    replace: (_state, event) => ({
      ...event,
      amount: (event.amount || 1) * 2,
    }),
  };
}

/**
 * Create a token doubling effect (like Doubling Season for tokens).
 */
export function createTokenDoublingEffect(
  sourceInstanceId: string,
  controllerId: string,
): ReplacementEffect {
  return {
    id: `double_tokens_${sourceInstanceId}`,
    sourceInstanceId,
    controllerId,
    eventType: 'TokenCreated',
    applies: (_state, event) =>
      event.type === 'TokenCreated' && event.targetId === controllerId,
    replace: (_state, event) => ({
      ...event,
      amount: (event.amount || 1) * 2,
    }),
  };
}
