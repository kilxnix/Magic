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

  it('parses typed fetch lands generically without name overrides', () => {
    const text = '{T}, Pay 1 life, Sacrifice Arid Mesa: Search your library for a Mountain or Plains card, put it onto the battlefield, then shuffle.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(1);

    const ability = abilities[0];
    expect(ability.cost.tap).toBe(true);
    expect(ability.cost.payLife).toBe(1);
    expect(ability.cost.sacrifice).toBe('self');

    const searchEffect = ability.effects[0] as any;
    expect(searchEffect.kind).toBe('SearchLibrary');
    expect(searchEffect.filter.types).toEqual(['land']);
    expect(searchEffect.filter.subtypes).toEqual(['Mountain', 'Plains']);
    expect(searchEffect.destination).toBe('battlefield');
    expect(searchEffect.tapped).toBe(false);
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

  it('parses self pump activated abilities that say this creature gets +N/+N', () => {
    const text = '{B}: This creature gets +1/+1 until end of turn.';
    const abilities = parseActivatedAbilities(text);
    expect(abilities).toHaveLength(1);
    expect(abilities[0].cost.mana).toBe('{b}');
    expect(abilities[0].effects[0].kind).toBe('ModifyPT');
    if (abilities[0].effects[0].kind !== 'ModifyPT') return;
    expect(abilities[0].effects[0].target.kind).toBe('Source');
    expect(abilities[0].effects[0].power).toBe(1);
    expect(abilities[0].effects[0].toughness).toBe(1);
    expect(abilities[0].effects[0].untilEndOfTurn).toBe(true);
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

  it('rejects an explicit illegal selected card instead of falling back to another candidate', () => {
    const sisay = createTestDef({
      id: 'sisay',
      name: 'Sisay, Weatherlight Captain',
      type_line: 'Legendary Creature â€” Human Soldier',
      card_types: ['creature'],
      cmc: 3,
      power: 3,
      toughness: 3,
    });
    const arcaneSignet = createTestDef({
      id: 'arcane_signet',
      name: 'Arcane Signet',
      type_line: 'Artifact',
      card_types: ['artifact'],
      cmc: 2,
    });
    const moxAmber = createTestDef({
      id: 'mox_amber',
      name: 'Mox Amber',
      type_line: 'Legendary Artifact',
      card_types: ['artifact'],
      cmc: 0,
    });

    const state = createTestState([
      { def: sisay, zone: 'battlefield', ownerId: 'p1' },
      { def: arcaneSignet, zone: 'library', ownerId: 'p1' },
      { def: moxAmber, zone: 'library', ownerId: 'p1' },
    ]);

    const result = executeSearchLibrary(
      state,
      'p1',
      { supertypes: ['Legendary'], permanent: true, manaValueLessThanSourcePower: true },
      'battlefield',
      false,
      false,
      { selectedCardInstanceId: 'inst_2', sourceInstanceId: 'inst_1' },
    );

    expect(result.cards.get('inst_2')!.zone).toBe('library');
    expect(result.cards.get('inst_3')!.zone).toBe('library');
  });

  it('enforces Sisay-style legendary permanent and source-power filters', () => {
    const sisay = createTestDef({
      id: 'sisay',
      name: 'Sisay, Weatherlight Captain',
      type_line: 'Legendary Creature â€” Human Soldier',
      card_types: ['creature'],
      cmc: 3,
      power: 3,
      toughness: 3,
    });
    const legendarySorcery = createTestDef({
      id: 'legendary_sorcery',
      name: "Karn's Temporal Sundering",
      type_line: 'Legendary Sorcery',
      card_types: ['sorcery'],
      cmc: 6,
    });
    const highLegend = createTestDef({
      id: 'high_legend',
      name: 'High-Cost Legend',
      type_line: 'Legendary Creature â€” Avatar',
      card_types: ['creature'],
      cmc: 5,
    });
    const moxAmber = createTestDef({
      id: 'mox_amber',
      name: 'Mox Amber',
      type_line: 'Legendary Artifact',
      card_types: ['artifact'],
      cmc: 0,
    });

    const state = createTestState([
      { def: sisay, zone: 'battlefield', ownerId: 'p1' },
      { def: legendarySorcery, zone: 'library', ownerId: 'p1' },
      { def: highLegend, zone: 'library', ownerId: 'p1' },
      { def: moxAmber, zone: 'library', ownerId: 'p1' },
    ]);

    const filter = { supertypes: ['Legendary'], permanent: true, manaValueLessThanSourcePower: true };

    expect(matchesCardFilter(legendarySorcery, filter, { state, sourceInstanceId: 'inst_1' })).toBe(false);
    expect(matchesCardFilter(highLegend, filter, { state, sourceInstanceId: 'inst_1' })).toBe(false);
    expect(matchesCardFilter(moxAmber, filter, { state, sourceInstanceId: 'inst_1' })).toBe(true);

    const result = executeSearchLibrary(
      state,
      'p1',
      filter,
      'battlefield',
      false,
      false,
      { selectedCardInstanceId: 'inst_4', sourceInstanceId: 'inst_1' },
    );

    expect(result.cards.get('inst_4')!.zone).toBe('battlefield');
  });

  it('golden Sisay search only allows legendary permanents below current power and rejects forced invalid picks', () => {
    const sisay = createTestDef({
      id: 'sisay',
      name: 'Sisay, Weatherlight Captain',
      type_line: 'Legendary Creature — Human Soldier',
      card_types: ['creature'],
      cmc: 3,
      power: 2,
      toughness: 2,
    });
    const yoshimaru = createTestDef({
      id: 'yoshimaru',
      name: 'Yoshimaru, Ever Faithful',
      type_line: 'Legendary Creature — Dog',
      card_types: ['creature'],
      cmc: 1,
    });
    const arcaneSignet = createTestDef({
      id: 'arcane_signet',
      name: 'Arcane Signet',
      type_line: 'Artifact',
      card_types: ['artifact'],
      cmc: 2,
    });
    const akromasMemorial = createTestDef({
      id: 'akromas_memorial',
      name: "Akroma's Memorial",
      type_line: 'Legendary Artifact',
      card_types: ['artifact'],
      cmc: 7,
    });
    const counterspell = createTestDef({
      id: 'counterspell',
      name: 'Counterspell',
      type_line: 'Instant',
      card_types: ['instant'],
      cmc: 2,
    });
    const bloodCrypt = createTestDef({
      id: 'blood_crypt',
      name: 'Blood Crypt',
      type_line: 'Land — Swamp Mountain',
      card_types: ['land'],
      cmc: 0,
    });

    const state = createTestState([
      { def: sisay, zone: 'battlefield', ownerId: 'p1' },
      { def: yoshimaru, zone: 'library', ownerId: 'p1' },
      { def: arcaneSignet, zone: 'library', ownerId: 'p1' },
      { def: akromasMemorial, zone: 'library', ownerId: 'p1' },
      { def: counterspell, zone: 'library', ownerId: 'p1' },
      { def: bloodCrypt, zone: 'library', ownerId: 'p1' },
    ]);
    const filter = { supertypes: ['Legendary'], permanent: true, manaValueLessThanSourcePower: true };
    const libraryCards = [...state.cards.values()].filter(card => card.zone === 'library');
    const legalNames = libraryCards
      .filter(card => matchesCardFilter(state.cardDefinitions.get(card.definitionId)!, filter, {
        state,
        sourceInstanceId: 'inst_1',
      }))
      .map(card => state.cardDefinitions.get(card.definitionId)!.name);

    expect(legalNames).toEqual(['Yoshimaru, Ever Faithful']);
    expect(matchesCardFilter(arcaneSignet, filter, { state, sourceInstanceId: 'inst_1' })).toBe(false);
    expect(matchesCardFilter(akromasMemorial, filter, { state, sourceInstanceId: 'inst_1' })).toBe(false);
    expect(matchesCardFilter(counterspell, filter, { state, sourceInstanceId: 'inst_1' })).toBe(false);
    expect(matchesCardFilter(bloodCrypt, filter, { state, sourceInstanceId: 'inst_1' })).toBe(false);

    for (const illegalId of ['inst_3', 'inst_4', 'inst_5', 'inst_6']) {
      const rejected = executeSearchLibrary(
        state,
        'p1',
        filter,
        'battlefield',
        false,
        false,
        { selectedCardInstanceId: illegalId, sourceInstanceId: 'inst_1' },
      );
      expect(rejected.cards.get(illegalId)!.zone).toBe('library');
      expect(rejected.cards.get('inst_2')!.zone).toBe('library');
    }

    const accepted = executeSearchLibrary(
      state,
      'p1',
      filter,
      'battlefield',
      false,
      false,
      { selectedCardInstanceId: 'inst_2', sourceInstanceId: 'inst_1' },
    );
    expect(accepted.cards.get('inst_2')!.zone).toBe('battlefield');
  });

  it('full Sisay flow pays WUBRG, uses the stack, and resolves a legal legend to battlefield', () => {
    const sisay = createTestDef({
      id: 'sisay',
      name: 'Sisay, Weatherlight Captain',
      type_line: 'Legendary Creature - Human Soldier',
      oracle_text: '{W}{U}{B}{R}{G}, {T}: Search your library for a legendary permanent card with mana value less than Sisay, Weatherlight Captain\'s power, put that card onto the battlefield, then shuffle.',
      card_types: ['creature'],
      mana_cost: '{2}{W}',
      cmc: 3,
      power: 2,
      toughness: 2,
    });
    const yoshimaru = createTestDef({
      id: 'yoshimaru',
      name: 'Yoshimaru, Ever Faithful',
      type_line: 'Legendary Creature - Dog',
      card_types: ['creature'],
      cmc: 1,
      power: 1,
      toughness: 1,
    });
    const arcaneSignet = createTestDef({
      id: 'arcane_signet',
      name: 'Arcane Signet',
      type_line: 'Artifact',
      card_types: ['artifact'],
      cmc: 2,
    });

    const baseState = createTestState([
      { def: sisay, zone: 'battlefield', ownerId: 'p1' },
      { def: yoshimaru, zone: 'library', ownerId: 'p1' },
      { def: arcaneSignet, zone: 'library', ownerId: 'p1' },
    ]);
    const state: GameState = {
      ...baseState,
      players: baseState.players.map(player =>
        player.id === 'p1'
          ? { ...player, manaPool: { W: 1, U: 1, B: 1, R: 1, G: 1, C: 0 } }
          : player,
      ),
    };

    const abilities = getActivatedAbilities(state, 'inst_1');
    expect(abilities).toHaveLength(1);
    expect(abilities[0].cost.mana).toBe('{W}{U}{B}{R}{G}');
    expect(canActivateAbility(state, 'p1', 'inst_1', 0)).toBe(true);

    const activated = activateAbility(state, 'p1', 'inst_1', 0);
    expect(activated.cards.get('inst_1')!.tapped).toBe(true);
    expect(activated.players[0].manaPool).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
    expect(activated.stack).toHaveLength(1);
    expect(activated.cards.get('inst_2')!.zone).toBe('library');

    const resolved = resolveTopOfStack(activated);
    expect(resolved.stack).toHaveLength(0);
    expect(resolved.cards.get('inst_2')!.zone).toBe('battlefield');
    expect(resolved.cards.get('inst_3')!.zone).toBe('library');
  });

  it('matches Farseek by land subtype, not by every land card', () => {
    const forest = createTestDef({
      id: 'forest',
      name: 'Forest',
      type_line: 'Basic Land â€” Forest',
      card_types: ['land'],
    });
    const stompingGround = createTestDef({
      id: 'stomping_ground',
      name: 'Stomping Ground',
      type_line: 'Land â€” Mountain Forest',
      card_types: ['land'],
    });
    const hallowedFountain = createTestDef({
      id: 'hallowed_fountain',
      name: 'Hallowed Fountain',
      type_line: 'Land â€” Plains Island',
      card_types: ['land'],
    });
    const filter = { types: ['Land'], subtypes: ['Plains', 'Island', 'Swamp', 'Mountain'] };

    expect(matchesCardFilter(forest, filter)).toBe(false);
    expect(matchesCardFilter(stompingGround, filter)).toBe(true);
    expect(matchesCardFilter(hallowedFountain, filter)).toBe(true);
  });

  it('applies shock-land entry choices when a land is searched from the library', () => {
    const marshFlats = createTestDef({
      id: 'marsh_flats',
      name: 'Marsh Flats',
      type_line: 'Land',
      card_types: ['land'],
    });
    const templeGarden = createTestDef({
      id: 'temple_garden',
      name: 'Temple Garden',
      type_line: 'Land - Forest Plains',
      oracle_text: "As Temple Garden enters, you may pay 2 life. If you don't, it enters tapped.",
      card_types: ['land'],
      cmc: 0,
    });
    const state = createTestState([
      { def: marshFlats, zone: 'battlefield', ownerId: 'p1' },
      { def: templeGarden, zone: 'library', ownerId: 'p1' },
    ]);
    const filter = { types: ['Land'], subtypes: ['Forest', 'Plains'] };

    const defaultEntry = executeSearchLibrary(
      state,
      'p1',
      filter,
      'battlefield',
      false,
      true,
      { selectedCardInstanceId: 'inst_2' },
    );

    expect(defaultEntry.cards.get('inst_2')?.zone).toBe('battlefield');
    expect(defaultEntry.cards.get('inst_2')?.tapped).toBe(true);
    expect(defaultEntry.players[0].life).toBe(40);

    const paidEntry = executeSearchLibrary(
      state,
      'p1',
      filter,
      'battlefield',
      false,
      true,
      { selectedCardInstanceId: 'inst_2', payLifeToEnterUntapped: true },
    );

    expect(paidEntry.cards.get('inst_2')?.zone).toBe('battlefield');
    expect(paidEntry.cards.get('inst_2')?.tapped).toBe(false);
    expect(paidEntry.players[0].life).toBe(38);
  });

  it('keeps Farseek-style searched shock lands tapped when the effect says tapped', () => {
    const farseek = createTestDef({
      id: 'farseek',
      name: 'Farseek',
      type_line: 'Sorcery',
      card_types: ['sorcery'],
    });
    const hallowedFountain = createTestDef({
      id: 'hallowed_fountain_for_farseek',
      name: 'Hallowed Fountain',
      type_line: 'Land - Plains Island',
      oracle_text: "As Hallowed Fountain enters, you may pay 2 life. If you don't, it enters tapped.",
      card_types: ['land'],
      cmc: 0,
    });
    const state = createTestState([
      { def: farseek, zone: 'graveyard', ownerId: 'p1' },
      { def: hallowedFountain, zone: 'library', ownerId: 'p1' },
    ]);
    const filter = { types: ['Land'], subtypes: ['Plains', 'Island', 'Swamp', 'Mountain'] };

    const result = executeSearchLibrary(
      state,
      'p1',
      filter,
      'battlefield',
      true,
      true,
      { selectedCardInstanceId: 'inst_2', payLifeToEnterUntapped: true },
    );

    expect(result.cards.get('inst_2')?.zone).toBe('battlefield');
    expect(result.cards.get('inst_2')?.tapped).toBe(true);
    expect(result.players[0].life).toBe(40);
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
