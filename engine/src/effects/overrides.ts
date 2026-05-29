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

// Cultivate — search two basic lands: one to battlefield tapped, one to hand.
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
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['land'], supertypes: ['basic'] },
      destination: 'hand',
      shuffle: false,
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
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['land'], supertypes: ['basic'] },
      destination: 'hand',
      shuffle: false,
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// Dockside Extortionist - ETB: create X Treasures where X is the number of
// artifacts and enchantments opponents control.
registerOverrideByName('Dockside Extortionist', {
  kind: 'ETB',
  ability: {
    kind: 'TriggeredAbility',
    trigger: { kind: 'ETB', who: 'self' },
    effects: [
      {
        kind: 'CreateToken',
        controller: { kind: 'Controller' },
        token: {
          name: 'Treasure',
          colors: [],
          types: ['artifact'],
          subtypes: ['Treasure'],
          power: 0,
          toughness: 0,
        },
        count: {
          kind: 'ForEach',
          zone: 'battlefield',
          filter: { types: ['artifact', 'enchantment'] },
          controller: 'opponent',
        },
      },
    ],
  },
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
      controller: { kind: 'TargetController', targetId: 'target_1' },
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
// If permanent card, put on battlefield." The reveal is not modeled yet, but
// the target now goes to its owner's shuffled library instead of exile.
registerOverrideByName('Chaos Warp', {
  kind: 'Spell',
  effects: [
    {
      kind: 'PutIntoLibrary',
      target: { kind: 'Chosen', targetId: 'target_1' },
      position: 'shuffle',
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

// Demonic Tutor - choose a real library card through namedCardChoices.
registerOverrideByName('Demonic Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: {},
      destination: 'hand',
      shuffle: true,
      namedCardChoiceId: 'tutorCard',
      selectedCardChoiceId: 'tutorCardId',
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// Enlightened Tutor - search for artifact or enchantment, put on top of library.
registerOverrideByName('Enlightened Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['artifact', 'enchantment'] },
      destination: 'top',
      shuffle: true,
      namedCardChoiceId: 'tutorCard',
      selectedCardChoiceId: 'tutorCardId',
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
// cEDH library naming effects. The chosen card comes from the spell action's
// namedCardChoices.namedCard value so Tainted Pact / Consultation are not
// hard-coded to a single win line.
registerOverrideByName('Tainted Pact', {
  kind: 'Spell',
  effects: [
    {
      kind: 'ExileUntilNamed',
      player: { kind: 'Controller' },
      namedCardChoiceId: 'namedCard',
      foundDestination: 'hand',
    },
  ],
  targets: [],
});

registerOverrideByName('Demonic Consultation', {
  kind: 'Spell',
  effects: [
    {
      kind: 'ExileUntilNamed',
      player: { kind: 'Controller' },
      namedCardChoiceId: 'namedCard',
      foundDestination: 'hand',
      exileBeforeSearch: 6,
    },
  ],
  targets: [],
});

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

// Acidic Slime — ETB: destroy target artifact, enchantment, or land
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
  targets: [{ id: 'target_1', type: 'ArtifactEnchantmentOrLand', count: 1 }],
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
      controller: { kind: 'TargetController', targetId: 'target_1' },
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
registerOverrideByName('Wheel of Fortune', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Discard',
      player: { kind: 'EachPlayer' },
      count: 99,
      random: false,
    },
    {
      kind: 'Draw',
      player: { kind: 'EachPlayer' },
      count: 7,
    },
  ],
  targets: [],
});

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

// Opt — Scry 1, then draw a card.
registerOverrideByName('Opt', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Scry',
      player: { kind: 'Controller' },
      count: 1,
    },
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// Consider — Surveil 1, then draw a card.
registerOverrideByName('Consider', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Surveil',
      player: { kind: 'Controller' },
      count: 1,
    },
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// Impulse — choose a card from the top four; simplified to putting one library card into hand.
registerOverrideByName('Impulse', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: {},
      destination: 'hand',
      shuffle: false,
    },
  ],
  targets: [],
});

// Chart a Course — draw two, then discard a card unless you attacked. The engine
// does not yet carry attacked-this-turn choice state, so the conservative floor is
// the normal draw-two-discard-one mode.
registerOverrideByName('Chart a Course', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 2,
    },
    {
      kind: 'Discard',
      player: { kind: 'Controller' },
      count: 1,
    },
  ],
  targets: [],
});

// Return of the Wildspeaker — starter-deck mode uses the card-draw option.
registerOverrideByName('Return of the Wildspeaker', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: {
        kind: 'GreatestPower',
        zone: 'battlefield',
        controller: 'you',
        filter: { types: ['creature'], excludeSubtypes: ['Human'] },
      },
    },
  ],
  targets: [],
});

// Garruk's Uprising — ETB draw when the pilot controls a large creature.
registerOverrideByName("Garruk's Uprising", {
  kind: 'ETB',
  ability: {
    kind: 'TriggeredAbility',
    trigger: { kind: 'ETB', who: 'self' },
    effects: [
      {
        kind: 'Draw',
        player: { kind: 'Controller' },
        count: 1,
      },
    ],
  },
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
      filter: { types: ['Land'], subtypes: ['Plains', 'Island', 'Swamp', 'Mountain'] },
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

// Sisay, Weatherlight Captain - {W}{U}{B}{R}{G}, {T}: Search for a
// legendary permanent card with mana value less than Sisay's power.
registerOverrideByName('Sisay, Weatherlight Captain', {
  kind: 'Activated',
  ability: {
    kind: 'ActivatedAbility',
    cost: { tap: true, mana: '{W}{U}{B}{R}{G}' },
    effects: [
      {
        kind: 'SearchLibrary',
        player: { kind: 'Controller' },
        filter: {
          supertypes: ['Legendary'],
          permanent: true,
          manaValueLessThanSourcePower: true,
        },
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

// Sakura-Tribe Elder - Activated ability (sacrifice): SearchLibrary basic land to battlefield tapped + Shuffle
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

// Vampiric Tutor - search for any card, put on top of library, lose 2 life.
registerOverrideByName('Vampiric Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: {},
      destination: 'top',
      shuffle: true,
      namedCardChoiceId: 'tutorCard',
      selectedCardChoiceId: 'tutorCardId',
    },
    {
      kind: 'LoseLife',
      player: { kind: 'Controller' },
      amount: 2,
    },
  ],
  targets: [],
});

// Mystical Tutor - search for instant or sorcery, put on top of library.
registerOverrideByName('Mystical Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['instant', 'sorcery'] },
      destination: 'top',
      shuffle: true,
      namedCardChoiceId: 'tutorCard',
      selectedCardChoiceId: 'tutorCardId',
    },
  ],
  targets: [],
});

// Worldly Tutor - search for creature, put on top of library.
registerOverrideByName('Worldly Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: { types: ['creature'] },
      destination: 'top',
      shuffle: true,
      namedCardChoiceId: 'tutorCard',
      selectedCardChoiceId: 'tutorCardId',
    },
  ],
  targets: [],
});

// Imperial Seal - search for any card, put on top of library, lose 2 life.
registerOverrideByName('Imperial Seal', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: {},
      destination: 'top',
      shuffle: true,
      namedCardChoiceId: 'tutorCard',
      selectedCardChoiceId: 'tutorCardId',
    },
    {
      kind: 'LoseLife',
      player: { kind: 'Controller' },
      amount: 2,
    },
  ],
  targets: [],
});

// Diabolic Tutor - choose a real library card through namedCardChoices.
registerOverrideByName('Diabolic Tutor', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: {},
      destination: 'hand',
      shuffle: true,
      namedCardChoiceId: 'tutorCard',
      selectedCardChoiceId: 'tutorCardId',
    },
    {
      kind: 'ShuffleLibrary',
      player: { kind: 'Controller' },
    },
  ],
  targets: [],
});

// =============================================================================
// Fetch Lands — Activated: tap + sacrifice self, search for land by subtype, shuffle
// =============================================================================

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
