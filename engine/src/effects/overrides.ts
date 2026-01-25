// Phase 4: Manual effect overrides for complex cards
// Lookup by definitionId (preferred) or card name (fallback)

import type { Effect, TriggeredAbility } from './ast';
import type { TargetSpec } from './targets';

export type OverrideDefinition =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[] }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] };

// Registry keyed by definitionId
const overridesByDefinitionId = new Map<string, OverrideDefinition>();

// Fallback registry keyed by normalized card name (lowercase)
const overridesByName = new Map<string, OverrideDefinition>();

/**
 * Register an override by definitionId.
 */
export function registerOverrideById(definitionId: string, override: OverrideDefinition): void {
  overridesByDefinitionId.set(definitionId, override);
}

/**
 * Register an override by card name (case-insensitive).
 */
export function registerOverrideByName(cardName: string, override: OverrideDefinition): void {
  overridesByName.set(cardName.toLowerCase(), override);
}

/**
 * Look up an override by definitionId, then by card name.
 * Returns null if no override is registered.
 */
export function getOverride(definitionId: string, cardName: string): OverrideDefinition | null {
  // Try definitionId first
  const byId = overridesByDefinitionId.get(definitionId);
  if (byId) return byId;

  // Fallback to name
  const byName = overridesByName.get(cardName.toLowerCase());
  if (byName) return byName;

  return null;
}

/**
 * Check if an override exists.
 */
export function hasOverride(definitionId: string, cardName: string): boolean {
  return getOverride(definitionId, cardName) !== null;
}

/**
 * Clear all overrides (useful for testing).
 */
export function clearOverrides(): void {
  overridesByDefinitionId.clear();
  overridesByName.clear();
}

/**
 * Get counts of registered overrides (for debugging/metrics).
 */
export function getOverrideCounts(): { byId: number; byName: number } {
  return {
    byId: overridesByDefinitionId.size,
    byName: overridesByName.size,
  };
}

// =============================================================================
// Pre-registered overrides for common cards
// =============================================================================

// Lightning Bolt - explicit override even though parser handles it
// Useful as an example and for ensuring exact behavior
registerOverrideByName('Lightning Bolt', {
  kind: 'Spell',
  effects: [
    {
      kind: 'DealDamage',
      source: { kind: 'ThisSpell' },
      target: { kind: 'Chosen', targetId: 'target_1' },
      amount: 3,
    },
  ],
  targets: [{ id: 'target_1', type: 'Any', count: 1 }],
});

// Murder - destroy target creature
registerOverrideByName('Murder', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Destroy',
      target: { kind: 'Chosen', targetId: 'target_1' },
    },
  ],
  targets: [{ id: 'target_1', type: 'Creature', count: 1 }],
});

// Divination - draw 2 cards
registerOverrideByName('Divination', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 2,
    },
  ],
  targets: [],
});

// Healing Salve - gain 3 life (simplified, ignoring modal)
registerOverrideByName('Healing Salve', {
  kind: 'Spell',
  effects: [
    {
      kind: 'GainLife',
      player: { kind: 'Controller' },
      amount: 3,
    },
  ],
  targets: [],
});
