/**
 * Tests for activated abilities: parser, executor, and integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { parseActivatedAbilities } from './parser';
import {
  matchesCardFilter,
  executeSacrificeSpecific,
  executeSearchLibrary,
  executeShuffleLibrary,
} from './executor';
import {
  getActivatedAbilities,
  canActivateAbility,
  activateAbility,
} from '../actions';
import { resolveTopOfStack } from '../stack';
import { initGameState, type DeckInput } from '../game-state';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { clearOverrides } from './overrides';

// ============================================================================
// Helper: create a minimal game state for testing
// ============================================================================

function createTestDef(overrides: Partial<CardDefinition> & { id: string; name: string }): CardDefinition {
  return {
    type_line: 'Land',
    oracle_text: '',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types: ['land'],
    ...overrides,
  };
}

function createTestState(cards: { def: CardDefinition; zone: string; ownerId: string; tapped?: boolean; summoningSick?: boolean }[]): GameState {
  const cardDefinitions = new Map<string, CardDefinition>();
  const cardInstances = new Map<string, CardInstance>();

  for (let i = 0; i < cards.length; i++) {
    const { def, zone, ownerId, tapped, summoningSick } = cards[i];
    cardDefinitions.set(def.id, def);
    const instanceId = `inst_${i + 1}`;
    cardInstances.set(instanceId, {
      instanceId,
      definitionId: def.id,
      ownerId,
      zone: zone as any,
      tapped: tapped ?? false,
      summoningSick: summoningSick ?? false,
      counters: {},
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
// Parser tests
// ============================================================================

describe('parseActivatedAbilities', () => {
  it('parses Terramorphic Expanse oracle text', () => {
    const text = '{T}, Sacrifice Terramorphic Expanse: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(1);

    const ability = abilities[0];
    expect(ability.cost.tap).toBe(true);
    expect(ability.cost.sacrifice).toBe('self');
    expect(ability.isManaAbility).toBe(false);

    // Should have SearchLibrary + ShuffleLibrary effects
    expect(ability.effects).toHaveLength(2);
    expect(ability.effects[0].kind).toBe('SearchLibrary');
    expect(ability.effects[1].kind).toBe('ShuffleLibrary');

    const searchEffect = ability.effects[0] as any;
    expect(searchEffect.filter.supertypes).toEqual(['basic']);
    expect(searchEffect.filter.types).toEqual(['land']);
    expect(searchEffect.destination).toBe('battlefield');
    expect(searchEffect.tapped).toBe(true);
    expect(searchEffect.shuffle).toBe(true);
  });

  it('parses {T}: effect as tap-only cost', () => {
    const text = '{T}: Draw a card.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].cost.tap).toBe(true);
    expect(abilities[0].cost.sacrifice).toBeUndefined();
    expect(abilities[0].cost.mana).toBeUndefined();
    expect(abilities[0].effects[0].kind).toBe('Draw');
  });

  it('parses {2}{B}: effect as mana-only cost', () => {
    const text = '{2}{B}: Draw a card.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].cost.tap).toBeUndefined();
    expect(abilities[0].cost.mana).toBe('{2}{b}');
    expect(abilities[0].effects[0].kind).toBe('Draw');
  });

  it('skips mana abilities like "{T}: Add {G}"', () => {
    const text = '{T}: Add {G}.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(0);
  });

  it('skips basic land mana pattern "({T}: Add {W}.)"', () => {
    const text = '({T}: Add {W}.)';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(0);
  });

  it('extracts only activated ability lines from multi-line text', () => {
    const text = 'Flying\n{T}: Destroy target creature.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effects[0].kind).toBe('Destroy');
  });

  it('skips triggered ability lines', () => {
    const text = 'When ~ enters the battlefield, draw a card.\n{T}: Gain 3 life.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].effects[0].kind).toBe('GainLife');
  });

  it('returns empty for text with no activated abilities', () => {
    const text = 'Flying\nVigilance';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(0);
  });
});

// ============================================================================
// Executor tests
// ============================================================================

describe('matchesCardFilter', () => {
  const basicForest = createTestDef({
    id: 'forest',
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    card_types: ['land'],
  });

  const nonbasicLand = createTestDef({
    id: 'command_tower',
    name: 'Command Tower',
    type_line: 'Land',
    card_types: ['land'],
  });

  const creature = createTestDef({
    id: 'bear',
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    card_types: ['creature'],
    colors: ['G'] as any,
  });

  it('filters by type', () => {
    expect(matchesCardFilter(basicForest, { types: ['land'] })).toBe(true);
    expect(matchesCardFilter(creature, { types: ['land'] })).toBe(false);
  });

  it('filters by supertype', () => {
    expect(matchesCardFilter(basicForest, { supertypes: ['basic'] })).toBe(true);
    expect(matchesCardFilter(nonbasicLand, { supertypes: ['basic'] })).toBe(false);
  });

  it('combines type and supertype filters', () => {
    expect(matchesCardFilter(basicForest, { types: ['land'], supertypes: ['basic'] })).toBe(true);
    expect(matchesCardFilter(nonbasicLand, { types: ['land'], supertypes: ['basic'] })).toBe(false);
    expect(matchesCardFilter(creature, { types: ['land'], supertypes: ['basic'] })).toBe(false);
  });
});

describe('executeSacrificeSpecific', () => {
  it('moves permanent from battlefield to graveyard', () => {
    const def = createTestDef({ id: 'land1', name: 'Test Land' });
    const state = createTestState([{ def, zone: 'battlefield', ownerId: 'p1' }]);

    const result = executeSacrificeSpecific(state, 'inst_1');
    const card = result.cards.get('inst_1')!;
    expect(card.zone).toBe('graveyard');
    expect(card.tapped).toBe(false);
    expect(card.damage).toBe(0);
  });

  it('applies commander replacement rule', () => {
    const def = createTestDef({ id: 'cmdr', name: 'Commander' });
    const state = createTestState([{ def, zone: 'battlefield', ownerId: 'p1' }]);
    // Set as commander
    const card = state.cards.get('inst_1')!;
    state.cards.set('inst_1', { ...card, isCommander: true });
    state.players[0].commanderInstanceId = 'inst_1';

    const result = executeSacrificeSpecific(state, 'inst_1');
    expect(result.cards.get('inst_1')!.zone).toBe('command');
  });

  it('no-ops for non-battlefield cards', () => {
    const def = createTestDef({ id: 'land1', name: 'Test Land' });
    const state = createTestState([{ def, zone: 'hand', ownerId: 'p1' }]);

    const result = executeSacrificeSpecific(state, 'inst_1');
    expect(result.cards.get('inst_1')!.zone).toBe('hand');
  });
});

describe('executeSearchLibrary', () => {
  it('finds matching card and moves to destination', () => {
    const forest = createTestDef({
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });
    const island = createTestDef({
      id: 'island',
      name: 'Island',
      type_line: 'Basic Land — Island',
      card_types: ['land'],
    });

    const state = createTestState([
      { def: forest, zone: 'library', ownerId: 'p1' },
      { def: island, zone: 'library', ownerId: 'p1' },
    ]);

    const result = executeSearchLibrary(
      state, 'p1',
      { types: ['land'], supertypes: ['basic'] },
      'battlefield',
      true,
    );

    const card = result.cards.get('inst_1')!;
    expect(card.zone).toBe('battlefield');
    expect(card.tapped).toBe(true);
    expect(card.summoningSick).toBe(true);
  });

  it('enters battlefield untapped when tapped=false', () => {
    const forest = createTestDef({
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const state = createTestState([
      { def: forest, zone: 'library', ownerId: 'p1' },
    ]);

    const result = executeSearchLibrary(
      state, 'p1',
      { types: ['land'], supertypes: ['basic'] },
      'battlefield',
      false,
    );

    expect(result.cards.get('inst_1')!.tapped).toBe(false);
  });

  it('moves to hand destination', () => {
    const forest = createTestDef({
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const state = createTestState([
      { def: forest, zone: 'library', ownerId: 'p1' },
    ]);

    const result = executeSearchLibrary(
      state, 'p1',
      { types: ['land'], supertypes: ['basic'] },
      'hand',
    );

    expect(result.cards.get('inst_1')!.zone).toBe('hand');
  });

  it('no-ops when no match found', () => {
    const creature = createTestDef({
      id: 'bear',
      name: 'Bear',
      type_line: 'Creature — Bear',
      card_types: ['creature'],
    });

    const state = createTestState([
      { def: creature, zone: 'library', ownerId: 'p1' },
    ]);

    const result = executeSearchLibrary(
      state, 'p1',
      { types: ['land'], supertypes: ['basic'] },
      'battlefield',
    );

    // Nothing changed
    expect(result.cards.get('inst_1')!.zone).toBe('library');
  });
});

describe('executeShuffleLibrary', () => {
  it('randomizes library card order', () => {
    const cards: { def: CardDefinition; zone: string; ownerId: string }[] = [];
    for (let i = 0; i < 20; i++) {
      cards.push({
        def: createTestDef({ id: `card_${i}`, name: `Card ${i}` }),
        zone: 'library',
        ownerId: 'p1',
      });
    }

    const state = createTestState(cards);
    const originalOrder = Array.from(state.cards.entries())
      .filter(([, c]) => c.zone === 'library')
      .map(([id]) => id);

    const result = executeShuffleLibrary(state, 'p1');
    const newOrder = Array.from(result.cards.entries())
      .filter(([, c]) => c.zone === 'library')
      .map(([id]) => id);

    // Same length
    expect(newOrder).toHaveLength(originalOrder.length);

    // Very unlikely to be the same order with 20 cards
    // (but not guaranteed, so we just check length and contents)
    expect(new Set(newOrder)).toEqual(new Set(originalOrder));
  });
});

// ============================================================================
// Action tests
// ============================================================================

describe('canActivateAbility', () => {
  it('returns false for tapped permanents with tap cost', () => {
    const def = createTestDef({
      id: 'te',
      name: 'Terramorphic Expanse',
      oracle_text: '{T}, Sacrifice Terramorphic Expanse: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    });
    const state = createTestState([{ def, zone: 'battlefield', ownerId: 'p1', tapped: true }]);

    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(false);
  });

  it('returns false for summoning-sick creatures with tap cost', () => {
    const def = createTestDef({
      id: 'dork',
      name: 'Mana Dork',
      type_line: 'Creature — Elf',
      card_types: ['creature'],
      oracle_text: '{T}: Draw a card.',
    });
    const state = createTestState([{ def, zone: 'battlefield', ownerId: 'p1', summoningSick: true }]);

    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(false);
  });

  it('returns true for untapped lands with tap cost', () => {
    const def = createTestDef({
      id: 'te',
      name: 'Terramorphic Expanse',
      oracle_text: '{T}, Sacrifice Terramorphic Expanse: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    });
    const state = createTestState([{ def, zone: 'battlefield', ownerId: 'p1' }]);

    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(true);
  });
});

describe('activateAbility', () => {
  it('taps the permanent when cost includes tap', () => {
    const def = createTestDef({
      id: 'te',
      name: 'Terramorphic Expanse',
      oracle_text: '{T}, Sacrifice Terramorphic Expanse: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    });
    const forest = createTestDef({
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const state = createTestState([
      { def, zone: 'battlefield', ownerId: 'p1' },
      { def: forest, zone: 'library', ownerId: 'p1' },
    ]);

    const result = activateAbility(state, 'p1', 'inst_1', 0);

    // Terramorphic should be sacrificed (in graveyard)
    expect(result.cards.get('inst_1')!.zone).toBe('graveyard');
  });

  it('puts non-mana ability on stack', () => {
    const def = createTestDef({
      id: 'te',
      name: 'Terramorphic Expanse',
      oracle_text: '{T}, Sacrifice Terramorphic Expanse: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    });
    const forest = createTestDef({
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const state = createTestState([
      { def, zone: 'battlefield', ownerId: 'p1' },
      { def: forest, zone: 'library', ownerId: 'p1' },
    ]);

    const result = activateAbility(state, 'p1', 'inst_1', 0);

    // Should have stack item
    expect(result.stack).toHaveLength(1);
    expect(result.stack[0].kind).toBe('ActivatedAbility');
  });
});

// ============================================================================
// Integration test
// ============================================================================

describe('Terramorphic Expanse integration', () => {
  it('full flow: activate → resolve → land enters tapped', () => {
    const teDef = createTestDef({
      id: 'te',
      name: 'Terramorphic Expanse',
      oracle_text: '{T}, Sacrifice Terramorphic Expanse: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
    });
    const forestDef = createTestDef({
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      card_types: ['land'],
    });

    const state = createTestState([
      { def: teDef, zone: 'battlefield', ownerId: 'p1' },
      { def: forestDef, zone: 'library', ownerId: 'p1' },
      { def: forestDef, zone: 'library', ownerId: 'p1' },
    ]);

    // Step 1: Activate the ability
    let result = activateAbility(state, 'p1', 'inst_1', 0);

    // Terramorphic should be in graveyard (sacrifice cost paid)
    expect(result.cards.get('inst_1')!.zone).toBe('graveyard');

    // Should be on stack
    expect(result.stack).toHaveLength(1);

    // Step 2: Resolve the stack
    result = resolveTopOfStack(result);

    // One forest should now be on battlefield, tapped
    const battlefieldCards = Array.from(result.cards.values()).filter(c => c.zone === 'battlefield');
    expect(battlefieldCards).toHaveLength(1);
    expect(battlefieldCards[0].tapped).toBe(true);

    // The other forest should still be in library
    const libraryCards = Array.from(result.cards.values()).filter(c => c.zone === 'library');
    expect(libraryCards).toHaveLength(1);
  });
});
