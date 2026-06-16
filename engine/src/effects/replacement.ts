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

import type { GameState, CardInstance, CardDefinition, DamagePreventionEffectRef, Zone } from '../types';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect a SELF die-replacement printed on a card's own oracle text, e.g.
 *   "If ~ would die, exile it instead."
 *   "If this creature would die, return it to its owner's hand instead."
 *
 * Returns the replacement destination zone, or null if the card has no such
 * self-replacement. This is read directly off the CardDefinition at the moment
 * a creature is dying (the die chokepoints), so no serialized state is needed.
 */
export function getSelfDieReplacementZone(def: CardDefinition): 'exile' | 'hand' | null {
  const texts: string[] = [];
  if (def.oracle_text) texts.push(def.oracle_text);
  if (def.faces) for (const f of def.faces) if (f.oracle_text) texts.push(f.oracle_text);
  if (texts.length === 0) return null;
  const nameRe = def.name ? new RegExp(escapeRegExp(def.name), 'gi') : null;
  for (const raw of texts) {
    let text = raw.toLowerCase();
    if (nameRe) text = text.replace(nameRe, '~');
    text = text.replace(/\bthis (?:creature|permanent|card)\b/g, '~');
    const m = text.match(/if ~ would die,?\s+(?:instead\s+)?(exile|return)\b[^.]*/);
    if (!m) continue;
    const clause = m[0];
    if (!/\binstead\b/.test(clause)) continue;
    if (m[1] === 'exile') return 'exile';
    if (m[1] === 'return' && /\bhand\b/.test(clause)) return 'hand';
  }
  return null;
}

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

function affectedPlayerId(state: GameState, event: ReplacementEvent): string | undefined {
  if (event.targetId && state.players.some(player => player.id === event.targetId)) {
    return event.targetId;
  }
  const cardId = event.cardInstanceId || event.targetId;
  if (!cardId) return undefined;
  return state.cards.get(cardId)?.ownerId;
}

export function replacementChoiceKey(event: ReplacementEvent, playerId?: string): string {
  const parts = [
    event.type,
    playerId || 'unknown',
    event.cardInstanceId || event.targetId || 'none',
    event.sourceId || 'none',
  ];
  return parts.map(part => String(part).replace(/[:|]/g, '_')).join('|');
}

function explicitReplacementOrder(state: GameState, event: ReplacementEvent): string[] {
  const choices = state.replacementEffectOrderChoices;
  if (!choices) return [];
  const playerId = affectedPlayerId(state, event);
  const keys = [
    replacementChoiceKey(event, playerId),
    playerId ? `player:${playerId}` : '',
    'global',
  ].filter(Boolean);

  for (const key of keys) {
    const order = choices[key];
    if (order?.length) return order;
  }
  return [];
}

function orderApplicableReplacements(
  state: GameState,
  event: ReplacementEvent,
  applicable: ReplacementEffect[],
): ReplacementEffect[] {
  const order = explicitReplacementOrder(state, event);
  if (order.length === 0) return applicable;
  const rank = new Map(order.map((id, index) => [id, index]));
  return applicable
    .map((replacement, index) => ({ replacement, index }))
    .sort((a, b) => {
      const rankA = rank.get(a.replacement.id);
      const rankB = rank.get(b.replacement.id);
      if (rankA !== undefined || rankB !== undefined) {
        if (rankA === undefined) return 1;
        if (rankB === undefined) return -1;
        return rankA - rankB;
      }
      return a.index - b.index;
    })
    .map(entry => entry.replacement);
}

/**
 * Apply replacement effects to an event.
 * Returns the modified event (or null if prevented).
 *
 * If multiple replacements apply, explicit state choices select the order;
 * otherwise the engine falls back to registration order for AI/tests.
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
    const applicable = orderApplicableReplacements(state, currentEvent, Array.from(activeReplacements.values()).filter(
      r => !appliedReplacements.includes(r.id) && r.applies(state, currentEvent!)
    ));

    if (applicable.length === 0) break;

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
 * Determine the controller of a damage-event target.
 * Returns the player id that controls the target (either a player id directly,
 * or the ownerId of the permanent being damaged).
 */
function targetControllerId(state: GameState, targetId: string | undefined): string | undefined {
  if (!targetId) return undefined;
  // Direct player target
  if (state.players.some(p => p.id === targetId)) return targetId;
  // Permanent target — ownerId serves as controller in this engine
  return state.cards.get(targetId)?.ownerId;
}

/**
 * Apply Gisela-style damage-doubling and damage-halving continuous effects.
 *
 * For each GiselaDamageDoubling effect in state.continuousEffects:
 *   If the damage target is controlled by an OPPONENT of the effect's controller
 *   (i.e. targetController !== effect.controllerId), double the damage.
 *
 * For each GiselaDamageHalving effect in state.continuousEffects:
 *   If the damage target is controlled by the SAME player as the effect's
 *   controller (i.e. targetController === effect.controllerId), halve the damage
 *   (rounded up) by preventing ceil(amount/2), so dealt = floor(amount/2).
 *
 * Returns the modified event (or null if damage becomes 0).
 * MTG rules: doubling applies as a replacement; halving is also a replacement.
 * When both could apply simultaneously (unusual), apply doubling first then
 * halving so that layering resolves in a deterministic order.
 */
function applyGiselaContinuousReplacements(
  state: GameState,
  event: ReplacementEvent,
): { event: ReplacementEvent | null; appliedReplacements: string[] } {
  if (!state.continuousEffects || state.continuousEffects.length === 0) {
    return { event, appliedReplacements: [] };
  }

  let currentEvent: ReplacementEvent | null = event;
  const appliedReplacements: string[] = [];

  const targetController = targetControllerId(state, event.targetId);

  // Phase 1: apply GiselaDamageDoubling effects (opponent/opponent's permanent)
  for (const ce of state.continuousEffects) {
    if (!currentEvent) break;
    if (ce.ability.modifier.kind !== 'GiselaDamageDoubling') continue;

    // Verify Gisela is still on the battlefield
    const source = state.cards.get(ce.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // Apply only when the target is controlled by an OPPONENT of the effect's controller
    if (targetController === undefined) continue;
    if (targetController === ce.controllerId) continue; // target is self — skip

    const newAmount: number = (currentEvent.amount ?? 0) * 2;
    appliedReplacements.push(`gisela_double_${ce.sourceInstanceId}`);
    currentEvent = { ...currentEvent, amount: newAmount };
  }

  // Phase 2: apply GiselaDamageHalving effects (self/own permanent)
  for (const ce of state.continuousEffects) {
    if (!currentEvent) break;
    if (ce.ability.modifier.kind !== 'GiselaDamageHalving') continue;

    // Verify Gisela is still on the battlefield
    const source = state.cards.get(ce.sourceInstanceId);
    if (!source || source.zone !== 'battlefield') continue;

    // Apply only when the target is controlled by the SAME player as the effect's controller
    if (targetController !== ce.controllerId) continue;

    const amount: number = currentEvent.amount ?? 0;
    // "prevent half that damage, rounded up" → prevented = ceil(amount/2)
    // dealt = floor(amount/2)
    const prevented: number = Math.ceil(amount / 2);
    const dealt: number = amount - prevented; // == floor(amount / 2)
    appliedReplacements.push(`gisela_halve_${ce.sourceInstanceId}`);
    currentEvent = dealt > 0 ? { ...currentEvent, amount: dealt } : null;
  }

  return { event: currentEvent, appliedReplacements };
}

/**
 * Slice 5 (player-level static prohibitions): return true when any battlefield
 * permanent has a DamageCantBePrevented continuous effect active (i.e.,
 * "Damage can't be prevented." from Leyline of Punishment, Everlasting Torment,
 * Sulfuric Vortex family).
 *
 * When true, applyDamageReplacementEffects skips the prevention-effect loops
 * (state.damagePreventionEffects and DamageDealt replacement registry). Gisela-
 * style doubling/halving (which modifies, not prevents, damage) still applies.
 */
function damageCantBePrevented(state: GameState): boolean {
  const effects = state.continuousEffects;
  if (!effects || effects.length === 0) return false;
  for (const ce of effects) {
    if (ce.ability.modifier.kind !== 'DamageCantBePrevented') continue;
    const source = state.cards.get(ce.sourceInstanceId);
    if (source && source.zone === 'battlefield') return true;
  }
  return false;
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
  // Apply Gisela-style continuous replacements first (before the legacy registry
  // and state-scoped prevention shields). These live in state.continuousEffects
  // and are registered by registerContinuousAbilitiesForPermanent when a
  // GiselaDamageDoubling/GiselaDamageHalving static is parsed.
  const giselaResult = applyGiselaContinuousReplacements(state, event);
  const eventAfterGisela = giselaResult.event;
  const giselaApplied = giselaResult.appliedReplacements;

  if (!eventAfterGisela) {
    return { state, event: null, appliedReplacements: giselaApplied };
  }

  // Slice 5: "Damage can't be prevented." (Leyline of Punishment family).
  // When active, skip the prevention-effect loops entirely — damage goes through
  // unreduced. Gisela-style doubling/halving (above) is NOT prevention and still
  // applies. The checked flag is also respected by state.damagePreventionEffects
  // (turn-scoped shields like Fog), so both paths are bypassed.
  if (damageCantBePrevented(state)) {
    return {
      state,
      event: eventAfterGisela,
      appliedReplacements: giselaApplied,
    };
  }

  const globalResult = applyReplacements(state, eventAfterGisela as ReplacementEvent & { type: 'DamageDealt'; amount: number });
  if (!globalResult.event) {
    return { state, event: null, appliedReplacements: [...giselaApplied, ...globalResult.appliedReplacements] };
  }

  let currentEvent: ReplacementEvent | null = globalResult.event;
  let effects = clearExpiredPreventionEffects(state.damagePreventionEffects, state.turnNumber);
  const appliedReplacements = [...giselaApplied, ...globalResult.appliedReplacements];

  for (const prevention of effects) {
    if (!currentEvent) break;
    if (prevention.protectedTargetId && prevention.protectedTargetId !== currentEvent.targetId) continue;
    if (prevention.combatOnly && !currentEvent.isCombatDamage) continue;

    appliedReplacements.push(prevention.id);

    // Slice 12 (en-Kor redirect): when redirectToId is set, the damage is
    // redirected to a different target rather than prevented. The shield is
    // consumed (one-shot) and the event's targetId is updated.
    if (prevention.redirectToId) {
      const currentAmount: number = currentEvent.amount ?? 0;
      const redirected: number = Math.min(
        prevention.amount === 'all' ? currentAmount : prevention.amount,
        currentAmount,
      );
      const remainingDamage: number = currentAmount - redirected;
      // Consume the redirect shield entirely (always one-shot per activation)
      effects = effects.filter(e => e.id !== prevention.id);
      // Redirect the damage; if any damage exceeds the shield's amount,
      // the remainder goes to the original target via a separate event.
      // For simplicity (en-Kor always redirects all covered damage), we
      // redirect up to `prevention.amount` to the new target.
      // The caller (executeDealDamage) will check replaced.targetId.
      currentEvent = redirected > 0
        ? { ...currentEvent, targetId: prevention.redirectToId, amount: redirected }
        : null;
      // If there is remaining damage (amount > shield), it is lost here.
      // (en-Kor shields cover "next N", so only N is redirected; excess falls
      // to the original target. For N=1 forms this never fires.)
      void remainingDamage; // acknowledged: excess damage is not re-dealt
      continue;
    }

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
