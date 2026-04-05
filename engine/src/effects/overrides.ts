// Phase 4: Manual effect overrides for complex cards
// Lookup by definitionId (preferred) or card name (fallback)

import type { Effect, TriggeredAbility, ActivatedAbility } from './ast';
import type { TargetSpec } from './targets';

export type OverrideDefinition =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[] }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Activated'; ability: ActivatedAbility };

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

// Terramorphic Expanse - {T}, Sacrifice: Search for basic land, put onto battlefield tapped, shuffle
const fetchLandAbility: ActivatedAbility = {
  kind: 'ActivatedAbility',
  cost: { tap: true, sacrifice: 'self' },
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['land'], supertypes: ['basic'] },
      destination: 'battlefield',
      tapped: true,
      shuffle: true,
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  isManaAbility: false,
  targets: [],
};

registerOverrideByName('Terramorphic Expanse', {
  kind: 'Activated',
  ability: fetchLandAbility,
});

registerOverrideByName('Evolving Wilds', {
  kind: 'Activated',
  ability: fetchLandAbility,
});

// =============================================================================
// Commander Staples — Mana / Ramp
// =============================================================================

// Jeska's Will — "Choose one or both: Add {R} for each card in target opponent's hand.
// Exile top 3, may play this turn." → Simplified: add 5R (average hand size)
registerOverrideByName("Jeska's Will", {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 3,
    },
  ],
  targets: [],
});

// Cultivate — "Search for up to two basic lands, one to battlefield tapped,
// one to hand, shuffle." → Search basic land to battlefield + draw 1
registerOverrideByName('Cultivate', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['land'], supertypes: ['basic'] },
      destination: 'battlefield',
      tapped: true,
      shuffle: false,
    },
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// Kodama's Reach — functionally identical to Cultivate
registerOverrideByName("Kodama's Reach", {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['land'], supertypes: ['basic'] },
      destination: 'battlefield',
      tapped: true,
      shuffle: false,
    },
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// =============================================================================
// Commander Staples — Removal
// =============================================================================

// Cyclonic Rift — "Return target nonland permanent to its owner's hand.
// Overload {6}{U}" → Non-overload mode: bounce target nonland permanent
registerOverrideByName('Cyclonic Rift', {
  kind: 'Spell',
  effects: [
    {
      kind: 'ReturnToHand',
      target: { kind: 'Chosen', targetId: 'target_1' },
    },
  ],
  targets: [{ id: 'target_1', type: 'NonlandPermanent', count: 1 }],
});

// Beast Within — "Destroy target permanent. Its controller creates a 3/3
// green Beast creature token." → Destroy + create 3/3 token for controller
// (simplified: token goes to spell's controller since we can't reference
// target's controller in TargetRef)
registerOverrideByName('Beast Within', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Destroy',
      target: { kind: 'Chosen', targetId: 'target_1' },
    },
    {
      kind: 'CreateToken',
      controller: { kind: 'Controller' },
      token: {
        name: 'Beast',
        colors: ['G'],
        types: ['creature'],
        subtypes: ['Beast'],
        power: 3,
        toughness: 3,
      },
      count: 1,
    },
  ],
  targets: [{ id: 'target_1', type: 'Permanent', count: 1 }],
});

// Chaos Warp — "Owner shuffles target permanent into library, reveals top card.
// If permanent card, put on battlefield." → Simplified: shuffle target into library
// (approximated as exile since there's no ShuffleIntoLibrary effect)
registerOverrideByName('Chaos Warp', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Exile',
      target: { kind: 'Chosen', targetId: 'target_1' },
    },
  ],
  targets: [{ id: 'target_1', type: 'Permanent', count: 1 }],
});

// =============================================================================
// Commander Staples — Board Wipes
// =============================================================================

// Farewell — "Choose one or more: Exile all artifacts / creatures / enchantments /
// graveyards." → Simplified: exile all creatures
registerOverrideByName('Farewell', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Exile',
      target: { kind: 'AllCreatures' },
    },
  ],
  targets: [],
});

// Wrath of God — "Destroy all creatures. They can't be regenerated."
// Parser should handle this, but register as safety net.
registerOverrideByName('Wrath of God', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Destroy',
      target: { kind: 'AllCreatures' },
    },
  ],
  targets: [],
});

// =============================================================================
// Commander Staples — Card Advantage / Tutors
// =============================================================================

// Demonic Tutor — "Search your library for a card, put into hand, shuffle."
// → Simplified: draw 1 (proxy for tutoring best card)
registerOverrideByName('Demonic Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// Enlightened Tutor — "Search for artifact or enchantment, put on top of library."
// → Simplified: draw 1 (proxy for tutoring)
registerOverrideByName('Enlightened Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// =============================================================================
// Commander Staples — Interaction / Protection
// =============================================================================

// Teferi's Protection — "Your life total can't change. Prevent all damage.
// Your permanents phase out." → Simplified: gain 99 life as damage buffer proxy
// (no 'PreventDamage' effect type exists, so we approximate with life gain)
registerOverrideByName("Teferi's Protection", {
  kind: 'Spell',
  effects: [
    {
      kind: 'GainLife',
      player: { kind: 'Controller' },
      amount: 99,
    },
  ],
  targets: [],
});

// =============================================================================
// Batch 1 — Removal
// =============================================================================

// Generous Gift — Destroy target permanent, create 3/3 green Elephant token
registerOverrideByName('Generous Gift', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Destroy',
      target: { kind: 'Chosen', targetId: 'target_1' },
    },
    {
      kind: 'CreateToken',
      controller: { kind: 'Controller' },
      token: {
        name: 'Elephant',
        colors: ['G'],
        types: ['creature'],
        subtypes: ['Elephant'],
        power: 3,
        toughness: 3,
      },
      count: 1,
    },
  ],
  targets: [{ id: 'target_1', type: 'Permanent', count: 1 }],
});

// Anguished Unmaking — Exile target nonland permanent, controller loses 3 life
registerOverrideByName('Anguished Unmaking', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Exile',
      target: { kind: 'Chosen', targetId: 'target_1' },
    },
    {
      kind: 'LoseLife',
      player: { kind: 'Controller' },
      amount: 3,
    },
  ],
  targets: [{ id: 'target_1', type: 'NonlandPermanent', count: 1 }],
});

// Toxic Deluge — Destroy all creatures (simplified from -X/-X)
registerOverrideByName('Toxic Deluge', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Destroy',
      target: { kind: 'AllCreatures' },
    },
  ],
  targets: [],
});

// Blasphemous Act — Deal 13 damage to all creatures
registerOverrideByName('Blasphemous Act', {
  kind: 'Spell',
  effects: [
    {
      kind: 'DealDamage',
      source: { kind: 'ThisSpell' },
      target: { kind: 'AllCreatures' },
      amount: 13,
    },
  ],
  targets: [],
});

// Infernal Grasp — Destroy target creature, controller loses 2 life
registerOverrideByName('Infernal Grasp', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Destroy',
      target: { kind: 'Chosen', targetId: 'target_1' },
    },
    {
      kind: 'LoseLife',
      player: { kind: 'Controller' },
      amount: 2,
    },
  ],
  targets: [{ id: 'target_1', type: 'Creature', count: 1 }],
});

// Ravenous Chupacabra — ETB: destroy target creature
registerOverrideByName('Ravenous Chupacabra', {
  kind: 'ETB',
  ability: {
    kind: 'TriggeredAbility',
    trigger: { kind: 'ETB', who: 'self' },
    effects: [
      {
        kind: 'Destroy',
        target: { kind: 'Chosen', targetId: 'target_1' },
      },
    ],
  },
  targets: [{ id: 'target_1', type: 'Creature', count: 1 }],
});

// Reclamation Sage — ETB: destroy target artifact or enchantment
registerOverrideByName('Reclamation Sage', {
  kind: 'ETB',
  ability: {
    kind: 'TriggeredAbility',
    trigger: { kind: 'ETB', who: 'self' },
    effects: [
      {
        kind: 'Destroy',
        target: { kind: 'Chosen', targetId: 'target_1' },
      },
    ],
  },
  targets: [{ id: 'target_1', type: 'ArtifactOrEnchantment', count: 1 }],
});

// Acidic Slime — ETB: destroy target permanent
registerOverrideByName('Acidic Slime', {
  kind: 'ETB',
  ability: {
    kind: 'TriggeredAbility',
    trigger: { kind: 'ETB', who: 'self' },
    effects: [
      {
        kind: 'Destroy',
        target: { kind: 'Chosen', targetId: 'target_1' },
      },
    ],
  },
  targets: [{ id: 'target_1', type: 'Permanent', count: 1 }],
});

// =============================================================================
// Batch 2 — Counterspells
// =============================================================================

// Swan Song — Counter target spell, create 2/2 blue Bird with flying for opponent
registerOverrideByName('Swan Song', {
  kind: 'Spell',
  effects: [
    {
      kind: 'CounterSpell',
      target: { kind: 'Chosen', targetId: 'target_1' },
    },
    {
      kind: 'CreateToken',
      controller: { kind: 'EachOpponent' },
      token: {
        name: 'Bird',
        colors: ['U'],
        types: ['creature'],
        subtypes: ['Bird'],
        power: 2,
        toughness: 2,
        keywords: ['Flying'],
      },
      count: 1,
    },
  ],
  targets: [{ id: 'target_1', type: 'Spell', count: 1 }],
});

// =============================================================================
// Batch 3 — Card Draw
// =============================================================================

// Brainstorm — Draw 3 (simplified)
registerOverrideByName('Brainstorm', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 3,
    },
  ],
  targets: [],
});

// Ponder — Scry 3 + Draw 1
registerOverrideByName('Ponder', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Scry',
      player: { kind: 'Controller' },
      count: 3,
    },
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// Preordain — Scry 2 + Draw 1
registerOverrideByName('Preordain', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Scry',
      player: { kind: 'Controller' },
      count: 2,
    },
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// Read the Bones — Scry 2 + Draw 2 + Lose 2 life
registerOverrideByName('Read the Bones', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Scry',
      player: { kind: 'Controller' },
      count: 2,
    },
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 2,
    },
    {
      kind: 'LoseLife',
      player: { kind: 'Controller' },
      amount: 2,
    },
  ],
  targets: [],
});

// Fact or Fiction — Draw 3 (simplified from pile split)
registerOverrideByName('Fact or Fiction', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 3,
    },
  ],
  targets: [],
});

// =============================================================================
// Batch 4 — Ramp
// =============================================================================

// Rampant Growth — Search basic land to battlefield tapped + Shuffle
registerOverrideByName('Rampant Growth', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { supertypes: ['Basic'], types: ['Land'] },
      destination: 'battlefield',
      tapped: true,
      shuffle: false,
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// Nature's Lore — Search Forest to battlefield + Shuffle
registerOverrideByName("Nature's Lore", {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { subtypes: ['Forest'], types: ['Land'] },
      destination: 'battlefield',
      tapped: false,
      shuffle: false,
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// Three Visits — Search Forest to battlefield + Shuffle
registerOverrideByName('Three Visits', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { subtypes: ['Forest'], types: ['Land'] },
      destination: 'battlefield',
      tapped: false,
      shuffle: false,
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// Farseek — Search land to battlefield tapped + Shuffle
registerOverrideByName('Farseek', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['Land'] },
      destination: 'battlefield',
      tapped: true,
      shuffle: false,
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// Sakura-Tribe Elder — Activated ability (sacrifice): SearchLibrary basic land to battlefield tapped + Shuffle
registerOverrideByName('Sakura-Tribe Elder', {
  kind: 'Activated',
  ability: {
    kind: 'ActivatedAbility',
    cost: { sacrifice: 'self' },
    effects: [
      {
        kind: 'SearchLibrary',
        player: { kind: 'Controller' },
        filter: { supertypes: ['Basic'], types: ['Land'] },
        destination: 'battlefield',
        tapped: true,
        shuffle: false,
      },
      {
        kind: 'ShuffleLibrary',
        player: { kind: 'Controller' },
      },
    ],
    isManaAbility: false,
    targets: [],
  },
});

// Mind Stone — Activated ability (tap + sacrifice + {1}): Draw 1
registerOverrideByName('Mind Stone', {
  kind: 'Activated',
  ability: {
    kind: 'ActivatedAbility',
    cost: { tap: true, sacrifice: 'self', mana: '{1}' },
    effects: [
      {
        kind: 'Draw',
        player: { kind: 'Controller' },
        count: 1,
      },
    ],
    isManaAbility: false,
    targets: [],
  },
});

// Solemn Simulacrum — ETB: SearchLibrary basic land to battlefield tapped + Shuffle
registerOverrideByName('Solemn Simulacrum', {
  kind: 'ETB',
  ability: {
    kind: 'TriggeredAbility',
    trigger: { kind: 'ETB', who: 'self' },
    effects: [
      {
        kind: 'SearchLibrary',
        player: { kind: 'Controller' },
        filter: { supertypes: ['Basic'], types: ['Land'] },
        destination: 'battlefield',
        tapped: true,
        shuffle: false,
      },
      {
        kind: 'ShuffleLibrary',
        player: { kind: 'Controller' },
      },
    ],
  },
  targets: [],
});

// Burnished Hart — Activated ability (sacrifice + {3}): SearchLibrary basic land to battlefield tapped + Shuffle
registerOverrideByName('Burnished Hart', {
  kind: 'Activated',
  ability: {
    kind: 'ActivatedAbility',
    cost: { sacrifice: 'self', mana: '{3}' },
    effects: [
      {
        kind: 'SearchLibrary',
        player: { kind: 'Controller' },
        filter: { supertypes: ['Basic'], types: ['Land'] },
        destination: 'battlefield',
        tapped: true,
        shuffle: false,
      },
      {
        kind: 'ShuffleLibrary',
        player: { kind: 'Controller' },
      },
    ],
    isManaAbility: false,
    targets: [],
  },
});

// =============================================================================
// Batch 5 — Tutors
// =============================================================================

// Vampiric Tutor — Draw 1 + Lose 2 life (proxy for tutoring)
registerOverrideByName('Vampiric Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
    {
      kind: 'LoseLife',
      player: { kind: 'Controller' },
      amount: 2,
    },
  ],
  targets: [],
});

// Mystical Tutor — Draw 1 (proxy for tutoring)
registerOverrideByName('Mystical Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// Worldly Tutor — Draw 1 (proxy for tutoring)
registerOverrideByName('Worldly Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// Imperial Seal — Draw 1 + Lose 2 life (proxy for tutoring)
registerOverrideByName('Imperial Seal', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
    {
      kind: 'LoseLife',
      player: { kind: 'Controller' },
      amount: 2,
    },
  ],
  targets: [],
});

// Diabolic Tutor — Draw 1 (proxy for tutoring)
registerOverrideByName('Diabolic Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// =============================================================================
// Fetch Lands — Activated: tap + sacrifice self, search for land by subtype, shuffle
// =============================================================================

const FETCH_OVERRIDE = (subtypes: string[]): OverrideDefinition => ({
  kind: 'Activated',
  ability: {
    kind: 'ActivatedAbility',
    cost: { tap: true, sacrifice: 'self' },
    effects: [
      {
        kind: 'SearchLibrary',
        player: { kind: 'Controller' },
        filter: { subtypes },
        destination: 'battlefield',
        tapped: false,
        shuffle: false,
      },
      {
        kind: 'ShuffleLibrary',
        player: { kind: 'Controller' },
      },
    ],
    isManaAbility: false,
    targets: [],
  },
});

// Enemy fetches
registerOverrideByName('Scalding Tarn', FETCH_OVERRIDE(['Island', 'Mountain']));
registerOverrideByName('Misty Rainforest', FETCH_OVERRIDE(['Forest', 'Island']));
registerOverrideByName('Verdant Catacombs', FETCH_OVERRIDE(['Swamp', 'Forest']));
registerOverrideByName('Marsh Flats', FETCH_OVERRIDE(['Plains', 'Swamp']));
registerOverrideByName('Arid Mesa', FETCH_OVERRIDE(['Mountain', 'Plains']));

// Allied fetches
registerOverrideByName('Flooded Strand', FETCH_OVERRIDE(['Plains', 'Island']));
registerOverrideByName('Polluted Delta', FETCH_OVERRIDE(['Island', 'Swamp']));
registerOverrideByName('Bloodstained Mire', FETCH_OVERRIDE(['Swamp', 'Mountain']));
registerOverrideByName('Wooded Foothills', FETCH_OVERRIDE(['Mountain', 'Forest']));
registerOverrideByName('Windswept Heath', FETCH_OVERRIDE(['Forest', 'Plains']));

// Budget fetches (search for any basic land type)
const BASIC_FETCH = FETCH_OVERRIDE(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
registerOverrideByName('Prismatic Vista', BASIC_FETCH);
registerOverrideByName('Fabled Passage', BASIC_FETCH);

// === MANA-PRODUCING SPELLS ===

// Dark Ritual — Add {B}{B}{B}
registerOverrideByName('Dark Ritual', {
  kind: 'Spell',
  effects: [{ kind: 'AddMana', player: { kind: 'Controller' }, mana: { B: 3 } }],
  targets: [],
});

// Cabal Ritual — Add {B}{B}{B} (threshold: {B}{B}{B}{B}{B}, simplified to base)
registerOverrideByName('Cabal Ritual', {
  kind: 'Spell',
  effects: [{ kind: 'AddMana', player: { kind: 'Controller' }, mana: { B: 3 } }],
  targets: [],
});

// Pyretic Ritual — Add {R}{R}{R}
registerOverrideByName('Pyretic Ritual', {
  kind: 'Spell',
  effects: [{ kind: 'AddMana', player: { kind: 'Controller' }, mana: { R: 3 } }],
  targets: [],
});

// Desperate Ritual — Add {R}{R}{R}
registerOverrideByName('Desperate Ritual', {
  kind: 'Spell',
  effects: [{ kind: 'AddMana', player: { kind: 'Controller' }, mana: { R: 3 } }],
  targets: [],
});

// Seething Song — Add {R}{R}{R}{R}{R}
registerOverrideByName('Seething Song', {
  kind: 'Spell',
  effects: [{ kind: 'AddMana', player: { kind: 'Controller' }, mana: { R: 5 } }],
  targets: [],
});

// Rite of Flame — Add {R}{R} (simplified from scaling)
registerOverrideByName('Rite of Flame', {
  kind: 'Spell',
  effects: [{ kind: 'AddMana', player: { kind: 'Controller' }, mana: { R: 2 } }],
  targets: [],
});

// Songs of the Damned — Add {B} for each creature in graveyard (simplified: add {B}{B}{B})
registerOverrideByName('Songs of the Damned', {
  kind: 'Spell',
  effects: [{ kind: 'AddMana', player: { kind: 'Controller' }, mana: { B: 3 } }],
  targets: [],
});

// Lotus Petal — sacrifice: add one mana of any color (simplified: add {C})
registerOverrideByName('Lotus Petal', {
  kind: 'Activated',
  ability: {
    kind: 'ActivatedAbility',
    cost: { tap: false, sacrifice: 'self' },
    effects: [{ kind: 'AddMana', player: { kind: 'Controller' }, mana: { C: 1 } }],
    targets: [],
    isManaAbility: true,
  },
});

// Lion's Eye Diamond — sacrifice, discard hand: add 3 of any color (simplified: add {C}{C}{C})
registerOverrideByName("Lion's Eye Diamond", {
  kind: 'Activated',
  ability: {
    kind: 'ActivatedAbility',
    cost: { tap: false, sacrifice: 'self' },
    effects: [
      { kind: 'Discard', player: { kind: 'Controller' }, count: 99, random: false },
      { kind: 'AddMana', player: { kind: 'Controller' }, mana: { C: 3 } },
    ],
    targets: [],
    isManaAbility: true,
  },
});
