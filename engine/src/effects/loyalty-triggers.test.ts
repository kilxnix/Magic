/**
 * Phase 17: Tests for planeswalker loyalty abilities and additional trigger types.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText, parseLoyaltyAbilities, parseActivatedAbilities } from './parser';
import { executeLoyaltyAbility } from './executor';
import type { GameState, CardDefinition, CardInstance } from '../types';
import type { LoyaltyAbility } from './ast';

// ============================================================================
// Helper: create a minimal game state for testing
// ============================================================================

function createTestDef(overrides: Partial<CardDefinition> & { id: string; name: string }): CardDefinition {
  return {
    type_line: 'Creature',
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['creature'],
    ...overrides,
  };
}

function createTestState(cards: { def: CardDefinition; zone: string; ownerId: string; counters?: Record<string, number> }[]): GameState {
  const cardDefinitions = new Map<string, CardDefinition>();
  const cardInstances = new Map<string, CardInstance>();

  for (let i = 0; i < cards.length; i++) {
    const { def, zone, ownerId, counters } = cards[i];
    cardDefinitions.set(def.id, def);
    const instanceId = `inst_${i + 1}`;
    cardInstances.set(instanceId, {
      instanceId,
      definitionId: def.id,
      ownerId,
      zone: zone as any,
      tapped: false,
      summoningSick: false,
      counters: counters ?? {},
      damage: 0,
      isCommander: false,
    });
  }

  return {
    players: [
      {
        id: 'p1',
        name: 'Player 1',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: true,
        hasLost: false,
      },
      {
        id: 'p2',
        name: 'Player 2',
        life: 40,
        poisonCounters: 0,
        commanderDamage: {},
        commanderTax: 0,
        commanderInstanceId: null,
        commanderCastCount: 0,
        manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
        hasPlayedLand: false,
        hasPriority: false,
        hasLost: false,
      },
    ],
    cards: cardInstances,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

// ============================================================================
// Planeswalker Loyalty Ability Parser Tests
// ============================================================================

describe('parseLoyaltyAbilities', () => {
  it('parses "+1: Draw a card."', () => {
    const abilities = parseLoyaltyAbilities('+1: Draw a card.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].kind).toBe('LoyaltyAbility');
    expect(abilities[0].loyaltyCost).toBe(1);
    expect(abilities[0].effects).toHaveLength(1);
    expect(abilities[0].effects[0].kind).toBe('Draw');
  });

  it('parses "-3: Destroy target creature."', () => {
    const abilities = parseLoyaltyAbilities('-3: Destroy target creature.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].loyaltyCost).toBe(-3);
    expect(abilities[0].effects).toHaveLength(1);
    expect(abilities[0].effects[0].kind).toBe('Destroy');
    expect(abilities[0].targets).toHaveLength(1);
    expect(abilities[0].targets[0].type).toBe('Creature');
  });

  it('parses "0: Draw a card."', () => {
    const abilities = parseLoyaltyAbilities('0: Draw a card.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].loyaltyCost).toBe(0);
    expect(abilities[0].effects[0].kind).toBe('Draw');
  });

  it('parses "+2: Gain 3 life."', () => {
    const abilities = parseLoyaltyAbilities('+2: Gain 3 life.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].loyaltyCost).toBe(2);
    expect(abilities[0].effects[0].kind).toBe('GainLife');
  });

  it('parses "-7: Draw 7 cards."', () => {
    const abilities = parseLoyaltyAbilities('-7: Draw 7 cards.');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].loyaltyCost).toBe(-7);
    expect(abilities[0].effects[0].kind).toBe('Draw');
    const draw = abilities[0].effects[0];
    if (draw.kind === 'Draw') {
      expect(draw.count).toBe(7);
    }
  });

  it('parses multi-line planeswalker with multiple abilities', () => {
    const text = '+1: Gain 2 life.\n-2: Draw a card.\n-6: Destroy target creature.';
    const abilities = parseLoyaltyAbilities(text);
    expect(abilities).toHaveLength(3);
    expect(abilities[0].loyaltyCost).toBe(1);
    expect(abilities[0].effects[0].kind).toBe('GainLife');
    expect(abilities[1].loyaltyCost).toBe(-2);
    expect(abilities[1].effects[0].kind).toBe('Draw');
    expect(abilities[2].loyaltyCost).toBe(-6);
    expect(abilities[2].effects[0].kind).toBe('Destroy');
  });

  it('returns empty for text with no loyalty abilities', () => {
    const abilities = parseLoyaltyAbilities('Flying\nVigilance');
    expect(abilities).toHaveLength(0);
  });

  it('skips unparseable effect text after loyalty cost', () => {
    const abilities = parseLoyaltyAbilities('+1: Some unparseable gibberish effect.');
    expect(abilities).toHaveLength(0);
  });

  it('skips lines that are not loyalty abilities in mixed text', () => {
    const text = 'Flying\n+1: Draw a card.\nVigilance';
    const abilities = parseLoyaltyAbilities(text);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].loyaltyCost).toBe(1);
  });
});

describe('parseActivatedAbilities skips loyalty lines', () => {
  it('does not parse loyalty abilities as activated abilities', () => {
    const text = '+1: Draw a card.\n-3: Destroy target creature.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(0);
  });
});

// ============================================================================
// Planeswalker Loyalty Ability Executor Tests
// ============================================================================

describe('executeLoyaltyAbility', () => {
  it('adds loyalty counters for positive cost', () => {
    const pwDef = createTestDef({
      id: 'pw1',
      name: 'Test Planeswalker',
      type_line: 'Legendary Planeswalker',
      card_types: ['planeswalker'],
    });
    const state = createTestState([
      { def: pwDef, zone: 'battlefield', ownerId: 'p1', counters: { loyalty: 3 } },
    ]);

    // Create library cards for draw effect
    const cardDef = createTestDef({ id: 'card1', name: 'Card 1' });
    state.cardDefinitions.set(cardDef.id, cardDef);
    state.cards.set('inst_lib_1', {
      instanceId: 'inst_lib_1',
      definitionId: cardDef.id,
      ownerId: 'p1',
      zone: 'library',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    });

    const ability: LoyaltyAbility = {
      kind: 'LoyaltyAbility',
      loyaltyCost: 1,
      effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: 1 }],
      targets: [],
    };

    const result = executeLoyaltyAbility(state, 'inst_1', ability, 'p1');

    // Loyalty should be 4 (was 3, +1)
    expect(result.cards.get('inst_1')!.counters['loyalty']).toBe(4);
    // Card should have been drawn
    expect(result.cards.get('inst_lib_1')!.zone).toBe('hand');
  });

  it('removes loyalty counters for negative cost', () => {
    const pwDef = createTestDef({
      id: 'pw1',
      name: 'Test Planeswalker',
      type_line: 'Legendary Planeswalker',
      card_types: ['planeswalker'],
    });
    const state = createTestState([
      { def: pwDef, zone: 'battlefield', ownerId: 'p1', counters: { loyalty: 5 } },
    ]);

    const ability: LoyaltyAbility = {
      kind: 'LoyaltyAbility',
      loyaltyCost: -3,
      effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 5 }],
      targets: [],
    };

    const result = executeLoyaltyAbility(state, 'inst_1', ability, 'p1');

    // Loyalty should be 2 (was 5, -3)
    expect(result.cards.get('inst_1')!.counters['loyalty']).toBe(2);
    // Life should be 45 (was 40, +5)
    expect(result.players[0].life).toBe(45);
  });

  it('does not activate if loyalty would go below 0', () => {
    const pwDef = createTestDef({
      id: 'pw1',
      name: 'Test Planeswalker',
      type_line: 'Legendary Planeswalker',
      card_types: ['planeswalker'],
    });
    const state = createTestState([
      { def: pwDef, zone: 'battlefield', ownerId: 'p1', counters: { loyalty: 2 } },
    ]);

    const ability: LoyaltyAbility = {
      kind: 'LoyaltyAbility',
      loyaltyCost: -3,
      effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 5 }],
      targets: [],
    };

    const result = executeLoyaltyAbility(state, 'inst_1', ability, 'p1');

    // Should not change — cannot pay the cost
    expect(result.cards.get('inst_1')!.counters['loyalty']).toBe(2);
    expect(result.players[0].life).toBe(40);
  });

  it('handles zero loyalty cost', () => {
    const pwDef = createTestDef({
      id: 'pw1',
      name: 'Test Planeswalker',
      type_line: 'Legendary Planeswalker',
      card_types: ['planeswalker'],
    });
    const state = createTestState([
      { def: pwDef, zone: 'battlefield', ownerId: 'p1', counters: { loyalty: 3 } },
    ]);

    const ability: LoyaltyAbility = {
      kind: 'LoyaltyAbility',
      loyaltyCost: 0,
      effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 1 }],
      targets: [],
    };

    const result = executeLoyaltyAbility(state, 'inst_1', ability, 'p1');

    // Loyalty stays at 3
    expect(result.cards.get('inst_1')!.counters['loyalty']).toBe(3);
    // Life should be 41
    expect(result.players[0].life).toBe(41);
  });

  it('loyalty reaching 0 from negative cost causes SBA to destroy planeswalker', () => {
    const pwDef = createTestDef({
      id: 'pw1',
      name: 'Test Planeswalker',
      type_line: 'Legendary Planeswalker',
      card_types: ['planeswalker'],
    });
    const state = createTestState([
      { def: pwDef, zone: 'battlefield', ownerId: 'p1', counters: { loyalty: 3 } },
    ]);

    const ability: LoyaltyAbility = {
      kind: 'LoyaltyAbility',
      loyaltyCost: -3,
      effects: [{ kind: 'GainLife', player: { kind: 'Controller' }, amount: 1 }],
      targets: [],
    };

    const result = executeLoyaltyAbility(state, 'inst_1', ability, 'p1');

    // SBA fires: planeswalker with 0 loyalty moves to graveyard.
    const card = result.cards.get('inst_1')!;
    expect(card.zone).toBe('graveyard');
  });
});

// ============================================================================
// Additional Trigger Type Parser Tests
// ============================================================================

describe('additional trigger types', () => {
  it('parses "Whenever you gain life, draw a card."', () => {
    const result = parseOracleText('Whenever you gain life, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'LifeGain' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever you draw a card, gain 1 life."', () => {
    const result = parseOracleText('Whenever you draw a card, gain 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CardDrawn' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('GainLife');
  });

  it('parses "Whenever an opponent casts a spell, draw a card."', () => {
    const result = parseOracleText('Whenever an opponent casts a spell, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'OpponentCastSpell' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever a creature enters the battlefield, draw a card."', () => {
    const result = parseOracleText('Whenever a creature enters the battlefield, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'AnyCreatureETB' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever you cast an instant or sorcery spell, draw a card."', () => {
    const result = parseOracleText('Whenever you cast an instant or sorcery spell, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CastInstantOrSorcery' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  it('parses "Whenever a land enters the battlefield under your control, gain 1 life."', () => {
    const result = parseOracleText('Whenever a land enters the battlefield under your control, gain 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Landfall' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('GainLife');
  });

  it('parses "At the beginning of each player\'s upkeep, draw a card."', () => {
    const result = parseOracleText("At the beginning of each player's upkeep, draw a card.");
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Upkeep', whose: 'each' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Draw');
  });

  // Test that existing triggers still work
  it('still parses "Whenever ~ attacks, draw a card." correctly', () => {
    const result = parseOracleText('Whenever ~ attacks, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Attacks', who: 'self' });
  });

  it('still parses "Whenever you cast a spell, draw a card." correctly', () => {
    const result = parseOracleText('Whenever you cast a spell, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'YouCastSpell' });
  });

  it('still parses "Whenever another creature enters the battlefield under your control, draw a card."', () => {
    const result = parseOracleText('Whenever another creature enters the battlefield under your control, draw a card.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'AnotherCreatureETB', controller: 'yours' });
  });

  // Test triggers with targeted effects
  it('parses "Whenever you gain life, destroy target creature."', () => {
    const result = parseOracleText('Whenever you gain life, destroy target creature.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'LifeGain' });
    expect(result.ability.effects).toHaveLength(1);
    expect(result.ability.effects[0].kind).toBe('Destroy');
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].type).toBe('Creature');
  });

  it('parses landfall with "each opponent loses 1 life"', () => {
    const result = parseOracleText('Whenever a land enters the battlefield under your control, each opponent loses 1 life.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'Landfall' });
    expect(result.ability.effects[0].kind).toBe('LoseLife');
  });

  it('parses "Whenever you cast an instant or sorcery spell, ~ deals 1 damage to any target."', () => {
    const result = parseOracleText('Whenever you cast an instant or sorcery spell, ~ deals 1 damage to any target.');
    expect(result.kind).toBe('Triggered');
    if (result.kind !== 'Triggered') return;
    expect(result.ability.trigger).toEqual({ kind: 'CastInstantOrSorcery' });
    expect(result.ability.effects[0].kind).toBe('DealDamage');
    expect(result.targets).toHaveLength(1);
  });
});
