// Phase 4: Manual effect overrides for complex cards
// Lookup by definitionId (preferred) or card name (fallback)

import type { Effect, TriggeredAbility, ActivatedAbility } from './ast';
import type { TargetSpec } from './targets';

export type OverrideDefinition =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[] }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Activated'; ability: ActivatedAbility };

export interface OverrideMetadata {
  reason: string;
  owner: string;
  fixtureCards: string[];
  addedAt?: string;
}

export interface OverrideRegistryEntry {
  keyType: 'definitionId' | 'name';
  key: string;
  override: OverrideDefinition;
  metadata: OverrideMetadata;
}

// Registry keyed by definitionId
const overridesByDefinitionId = new Map<string, OverrideDefinition>();
const overrideMetadataByDefinitionId = new Map<string, OverrideMetadata>();

// Fallback registry keyed by normalized card name (lowercase)
const overridesByName = new Map<string, OverrideDefinition>();
const overrideMetadataByName = new Map<string, OverrideMetadata>();

function defaultMetadata(fixtureCard: string, keyType: 'definitionId' | 'name'): OverrideMetadata {
  return {
    reason: `Legacy ${keyType} override; add a focused parser/engine fixture before removing it.`,
    owner: 'engine',
    fixtureCards: [fixtureCard],
  };
}

/**
 * Register an override by definitionId.
 */
export function registerOverrideById(
  definitionId: string,
  override: OverrideDefinition,
  metadata: Partial<OverrideMetadata> = {},
): void {
  overridesByDefinitionId.set(definitionId, override);
  overrideMetadataByDefinitionId.set(definitionId, {
    ...defaultMetadata(definitionId, 'definitionId'),
    ...metadata,
    fixtureCards: metadata.fixtureCards?.length ? metadata.fixtureCards : [definitionId],
  });
}

/**
 * Register an override by card name (case-insensitive).
 */
export function registerOverrideByName(
  cardName: string,
  override: OverrideDefinition,
  metadata: Partial<OverrideMetadata> = {},
): void {
  const key = cardName.toLowerCase();
  overridesByName.set(key, override);
  overrideMetadataByName.set(key, {
    ...defaultMetadata(cardName, 'name'),
    ...metadata,
    fixtureCards: metadata.fixtureCards?.length ? metadata.fixtureCards : [cardName],
  });
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

export function getOverrideMetadata(definitionId: string, cardName: string): OverrideMetadata | null {
  const byId = overrideMetadataByDefinitionId.get(definitionId);
  if (byId) return byId;
  const byName = overrideMetadataByName.get(cardName.toLowerCase());
  if (byName) return byName;
  return null;
}

export function getOverrideRegistryEntries(): OverrideRegistryEntry[] {
  const byId: OverrideRegistryEntry[] = [...overridesByDefinitionId.entries()].map(([key, override]) => ({
    keyType: 'definitionId',
    key,
    override,
    metadata: overrideMetadataByDefinitionId.get(key) || defaultMetadata(key, 'definitionId'),
  }));
  const byName: OverrideRegistryEntry[] = [...overridesByName.entries()].map(([key, override]) => ({
    keyType: 'name',
    key,
    override,
    metadata: overrideMetadataByName.get(key) || defaultMetadata(key, 'name'),
  }));
  return [...byId, ...byName].sort((a, b) => `${a.keyType}:${a.key}`.localeCompare(`${b.keyType}:${b.key}`));
}

/**
 * Clear all overrides (useful for testing).
 */
export function clearOverrides(): void {
  overridesByDefinitionId.clear();
  overridesByName.clear();
  overrideMetadataByDefinitionId.clear();
  overrideMetadataByName.clear();
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

// Jeska's Will - current engine mode applies both commander-enabled modes:
// add {R} for each card in target opponent's hand, then exile the top 3.
registerOverrideByName("Jeska's Will", {
  kind: 'Spell',
  effects: [
    {
      kind: 'AddMana',
      player: { kind: 'Controller' },
      mana: {
        R: {
          kind: 'ForEach',
          zone: 'hand',
          controller: 'target',
          target: { kind: 'Chosen', targetId: 'target_1' },
        },
      },
    },
    {
      kind: 'ExileFromLibrary',
      player: { kind: 'Controller' },
      count: 3,
      mayPlay: true,
    },
  ],
  targets: [{ id: 'target_1', type: 'Player', count: 1, constraints: { opponentControls: true } }],
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
// through TargetController so the destroyed permanent's controller receives it.
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

// Teferi's Protection — partial engine support: prevent damage to you for the
// turn. Full "life total can't change" and "protection from everything" still
// require broader replacement/protection coverage.
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
      kind: 'PreventDamage',
      target: { kind: 'Controller' },
      amount: 'all',
      combatOnly: false,
      duration: 'turn',
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

// Toxic Deluge — pay X life; all creatures get -X/-X until end of turn.
registerOverrideByName('Toxic Deluge', {
  kind: 'Spell',
  effects: [
    {
      kind: 'ModifyPT',
      target: { kind: 'AllCreatures' },
      power: { kind: 'XMultiplied', multiplier: -1 },
      toughness: { kind: 'XMultiplied', multiplier: -1 },
      untilEndOfTurn: true,
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

// Brainstorm choices can be supplied as putOnTopIds. Browser play keeps a
// follow-up selection prompt for human casts when the stack item has no choice yet.
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
    {
      kind: 'PutCardsFromHandOnTop',
      player: { kind: 'Controller' },
      count: 2,
      selectedCardChoiceId: 'putOnTopIds',
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

// Impulse - choose a card from the top four, put the rest on bottom.
registerOverrideByName('Impulse', {
  kind: 'Spell',
  effects: [
    {
      kind: 'SearchLibrary',
      player: { kind: 'Controller' },
      filter: {},
      destination: 'hand',
      shuffle: false,
      topCount: 4,
      putUnselectedTopCardsOnBottom: true,
    },
  ],
  targets: [],
});

// Chart a Course - draw two, then discard a card unless you attacked this turn.
registerOverrideByName('Chart a Course', {
  kind: 'Spell',
  effects: [
    {
      kind: 'Draw',
      player: { kind: 'Controller' },
      count: 2,
    },
    {
      kind: 'Conditional',
      condition: { kind: 'PlayerAttackedThisTurn', controller: 'you' },
      effect: {
        kind: 'Draw',
        player: { kind: 'Controller' },
        count: 0,
      },
      elseEffect: {
        kind: 'Discard',
        player: { kind: 'Controller' },
        count: 1,
      },
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

// Fact or Fiction - choose a revealed pile with factOrFictionPileIds.
registerOverrideByName('Fact or Fiction', {
  kind: 'Spell',
  effects: [
    {
      kind: 'ChooseFromTopOfLibrary',
      player: { kind: 'Controller' },
      count: 5,
      destination: 'hand',
      restDestination: 'graveyard',
      minSelections: 1,
      maxSelections: 5,
      selectedCardChoiceId: 'factOrFictionPileIds',
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

// Cabal Ritual — Add {B}{B}{B}; threshold adds two more black mana.
registerOverrideByName('Cabal Ritual', {
  kind: 'Spell',
  effects: [
    { kind: 'AddMana', player: { kind: 'Controller' }, mana: { B: 3 } },
    {
      kind: 'Conditional',
      condition: {
        kind: 'CardsInZoneAtLeast',
        controller: 'you',
        zone: 'graveyard',
        count: 7,
      },
      effect: { kind: 'AddMana', player: { kind: 'Controller' }, mana: { B: 2 } },
    },
  ],
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

// Rite of Flame — Add {R}{R}, then {R} for each card named Rite of Flame in each graveyard.
registerOverrideByName('Rite of Flame', {
  kind: 'Spell',
  effects: [
    { kind: 'AddMana', player: { kind: 'Controller' }, mana: { R: 2 } },
    {
      kind: 'AddMana',
      player: { kind: 'Controller' },
      mana: {
        R: {
          kind: 'ForEach',
          zone: 'graveyard',
          filter: { names: ['Rite of Flame'] },
          controller: 'each',
        },
      },
    },
  ],
  targets: [],
});

// Songs of the Damned — Add {B} for each creature card in your graveyard.
registerOverrideByName('Songs of the Damned', {
  kind: 'Spell',
  effects: [
    {
      kind: 'AddMana',
      player: { kind: 'Controller' },
      mana: {
        B: {
          kind: 'ForEach',
          zone: 'graveyard',
          filter: { types: ['creature'] },
          controller: 'you',
        },
      },
    },
  ],
  targets: [],
});

