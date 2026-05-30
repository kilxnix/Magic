import { describe, it, expect, beforeEach } from 'vitest';
import { parseOracleText } from './parser';
import type { StaticAbilityEffect, ConditionalEffect } from './ast';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';
import {
  registerContinuousEffect,
  unregisterContinuousEffects,
  getContinuousPTModification,
  getEffectivePower,
  getEffectiveToughness,
  getGrantedKeywords,
  getCostReduction,
  getIntrinsicCostReduction,
  evaluateCondition,
  resetContinuousTimestamp,
} from './continuous';
import { executeEffects } from './executor';
import { getKeywordsForInstance } from '../keywords';
import { emptyManaPool } from '../types';
import { canDeclareAttacker } from '../combat';
import { canCastSpell, registerContinuousAbilitiesForPermanent } from '../stack';
import { countDevotionToColors, getEffectiveCardTypes, isEffectiveCreature } from '../effective-types';

// ============================================================================
// Test helpers
// ============================================================================

function makePlayer(id: string, life = 40): Player {
  return {
    id, name: id, life,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(instanceId: string, definitionId: string, ownerId: string, zone = 'battlefield' as const): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

function makeDef(id: string, opts: Partial<CardDefinition> = {}): CardDefinition {
  return {
    id,
    name: opts.name || id,
    type_line: opts.type_line || 'Creature',
    oracle_text: opts.oracle_text || '',
    mana_cost: opts.mana_cost || '',
    cmc: opts.cmc || 0,
    colors: opts.colors || [],
    color_identity: opts.color_identity || [],
    keywords: opts.keywords || [],
    card_types: opts.card_types || ['creature'],
    power: opts.power ?? 2,
    toughness: opts.toughness ?? 2,
  };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    players: overrides.players || [makePlayer('p1'), makePlayer('p2')],
    cards: overrides.cards || new Map(),
    cardDefinitions: overrides.cardDefinitions || new Map(),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'main1',
    step: 'none',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
    continuousEffects: overrides.continuousEffects || [],
  };
}

// ============================================================================
// TASK 1: Static/Continuous Ability Tests
// ============================================================================

describe('Devotion type-changing effects', () => {
  function makeDevotionState(): GameState {
    const defs = new Map<string, CardDefinition>();
    defs.set('xenagos_def', makeDef('xenagos_def', {
      name: 'Xenagos, God of Revels',
      type_line: 'Legendary Enchantment Creature - God',
      oracle_text: 'Indestructible\nAs long as your devotion to red and green is less than seven, Xenagos isn\'t a creature.',
      mana_cost: '{3}{R}{G}',
      colors: ['R', 'G'],
      color_identity: ['R', 'G'],
      keywords: ['Indestructible'],
      card_types: ['enchantment', 'creature'],
      power: 6,
      toughness: 5,
    }));
    defs.set('dragon_def', makeDef('dragon_def', {
      name: 'Balefire Dragon',
      type_line: 'Creature - Dragon',
      mana_cost: '{5}{R}{R}',
      colors: ['R'],
      color_identity: ['R'],
      card_types: ['creature'],
      power: 6,
      toughness: 6,
    }));
    defs.set('green_def', makeDef('green_def', {
      name: 'Devotion Helper',
      type_line: 'Creature - Elemental',
      mana_cost: '{G}{G}{G}',
      colors: ['G'],
      color_identity: ['G'],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    }));

    const cards = new Map<string, CardInstance>();
    cards.set('xenagos', makeCard('xenagos', 'xenagos_def', 'p1'));
    cards.set('dragon', makeCard('dragon', 'dragon_def', 'p1'));

    return makeState({
      cards,
      cardDefinitions: defs,
      phase: 'combat',
      step: 'declare_attackers',
    });
  }

  it('removes creature type from Xenagos while devotion is below seven', () => {
    const state = makeDevotionState();

    expect(countDevotionToColors(state, 'p1', ['R', 'G'])).toBe(4);
    expect(getEffectiveCardTypes(state, 'xenagos')).toEqual(['enchantment']);
    expect(isEffectiveCreature(state, 'xenagos')).toBe(false);
    expect(canDeclareAttacker(state, 'p1', 'xenagos')).toBe(false);
  });

  it('restores Xenagos as a creature when devotion reaches seven', () => {
    const state = makeDevotionState();
    state.cards.set('green-helper', makeCard('green-helper', 'green_def', 'p1'));

    expect(countDevotionToColors(state, 'p1', ['R', 'G'])).toBe(7);
    expect(getEffectiveCardTypes(state, 'xenagos')).toEqual(['enchantment', 'creature']);
    expect(isEffectiveCreature(state, 'xenagos')).toBe(true);
    expect(canDeclareAttacker(state, 'p1', 'xenagos')).toBe(true);
  });
});

describe('Static Ability Parsing', () => {
  it('parses "Creatures you control get +1/+1"', () => {
    const result = parseOracleText('Creatures you control get +1/+1');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(result.ability.filter).toEqual({ types: ['creature'] });
    expect(result.ability.controller).toBe('you');
    expect(result.ability.excludeSelf).toBe(false);
  });

  it('parses "Other creatures you control get +1/+1"', () => {
    const result = parseOracleText('Other creatures you control get +1/+1');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(result.ability.excludeSelf).toBe(true);
  });

  it('parses "Creatures you control get +2/+0"', () => {
    const result = parseOracleText('Creatures you control get +2/+0');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ModifyPT', power: 2, toughness: 0 });
  });

  it('parses "Elves you control get +1/+1"', () => {
    const result = parseOracleText('Elves you control get +1/+1');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(result.ability.filter).toEqual({ types: ['creature'], subtypes: ['elf'] });
  });

  it('parses "Creatures you control have flying"', () => {
    const result = parseOracleText('Creatures you control have flying');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'flying' });
    expect(result.ability.filter).toEqual({ types: ['creature'] });
  });

  it('parses "Other creatures you control have vigilance"', () => {
    const result = parseOracleText('Other creatures you control have vigilance');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'vigilance' });
    expect(result.ability.excludeSelf).toBe(true);
  });

  it('parses self static unblockable text', () => {
    const result = parseOracleText("~ can't be blocked.");
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'unblockable' });
    expect(result.ability.selfOnly).toBe(true);
  });

  it('parses compound self combat restrictions', () => {
    const result = parseOracleText("This creature can't block and can't be blocked.");
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({
      kind: 'GrantKeywords',
      keywords: ['CannotBlock', 'unblockable'],
    });
    expect(result.ability.selfOnly).toBe(true);
  });

  it('parses "Spells you cast cost {1} less to cast"', () => {
    const result = parseOracleText('Spells you cast cost {1} less to cast');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
  });

  it('parses instant and sorcery spell cost reducers', () => {
    const result = parseOracleText('Instant and sorcery spells you cast cost {1} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    expect(result.ability.filter).toEqual({ types: ['instant', 'sorcery'] });
  });

  it('parses color-specific spell cost reducers', () => {
    const result = parseOracleText('Red spells you cast cost {1} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    expect(result.ability.filter).toEqual({ colors: ['R'] });
  });

  it('parses color plus type spell cost reducers', () => {
    const result = parseOracleText('Red instant and sorcery spells you cast cost {1} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    expect(result.ability.filter).toEqual({ types: ['instant', 'sorcery'], colors: ['R'] });
  });

  it('parses chosen-type spell cost reducers', () => {
    const result = parseOracleText('Creature spells you cast of the chosen type cost {1} less to cast.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    expect(result.ability.filter).toEqual({
      types: ['creature'],
      chosenCreatureTypeFromSource: true,
    });
  });

  it('parses "Zombies you control get +1/+1"', () => {
    const result = parseOracleText('Zombies you control get +1/+1');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(result.ability.filter).toEqual({ types: ['creature'], subtypes: ['zombie'] });
  });

  it('parses Sisay-style self boost from colors among other legendary permanents', () => {
    const result = parseOracleText('~ gets +1/+1 for each color among other legendary permanents you control.');
    expect(result.kind).toBe('StaticAbility');
    if (result.kind !== 'StaticAbility') return;

    expect(result.ability.selfOnly).toBe(true);
    expect(result.ability.modifier).toEqual({
      kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl',
      powerPerColor: 1,
      toughnessPerColor: 1,
    });
  });
});

describe('Continuous Effect Registration', () => {
  beforeEach(() => {
    resetContinuousTimestamp();
  });

  it('registers a continuous effect', () => {
    const state = makeState();
    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    };

    const newState = registerContinuousEffect(state, 'lord_1', 'p1', ability);
    expect(newState.continuousEffects).toHaveLength(1);
    expect(newState.continuousEffects![0].sourceInstanceId).toBe('lord_1');
    expect(newState.continuousEffects![0].controllerId).toBe('p1');
  });

  it('unregisters continuous effects when source leaves', () => {
    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState();
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);
    state = registerContinuousEffect(state, 'lord_2', 'p1', ability);
    expect(state.continuousEffects).toHaveLength(2);

    state = unregisterContinuousEffects(state, 'lord_1');
    expect(state.continuousEffects).toHaveLength(1);
    expect(state.continuousEffects![0].sourceInstanceId).toBe('lord_2');
  });
});

describe('Continuous P/T Modifications', () => {
  beforeEach(() => {
    resetContinuousTimestamp();
  });

  it('+1/+1 lord buff applies to controller creatures', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('lord_1', makeCard('lord_1', 'lord_def', 'p1'));
    cards.set('creature_1', makeCard('creature_1', 'bear_def', 'p1'));
    cards.set('opp_creature', makeCard('opp_creature', 'bear_def', 'p2'));

    const defs = new Map<string, CardDefinition>();
    defs.set('lord_def', makeDef('lord_def', { card_types: ['creature'], power: 2, toughness: 2 }));
    defs.set('bear_def', makeDef('bear_def', { card_types: ['creature'], power: 2, toughness: 2 }));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);

    // Controller's creatures get +1/+1
    const modCreature = getContinuousPTModification(state, 'creature_1');
    expect(modCreature.power).toBe(1);
    expect(modCreature.toughness).toBe(1);

    // Lord itself also gets the buff (excludeSelf=false)
    const modLord = getContinuousPTModification(state, 'lord_1');
    expect(modLord.power).toBe(1);
    expect(modLord.toughness).toBe(1);

    // Opponent's creature does NOT get the buff
    const modOpp = getContinuousPTModification(state, 'opp_creature');
    expect(modOpp.power).toBe(0);
    expect(modOpp.toughness).toBe(0);
  });

  it('excludeSelf prevents lord from buffing itself', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('lord_1', makeCard('lord_1', 'lord_def', 'p1'));
    cards.set('creature_1', makeCard('creature_1', 'bear_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('lord_def', makeDef('lord_def'));
    defs.set('bear_def', makeDef('bear_def'));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: true,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);

    // Other creature gets buff
    expect(getContinuousPTModification(state, 'creature_1')).toEqual({ power: 1, toughness: 1 });

    // Lord itself does NOT get the buff
    expect(getContinuousPTModification(state, 'lord_1')).toEqual({ power: 0, toughness: 0 });
  });

  it('getEffectivePower/Toughness includes continuous effects', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('creature_1', makeCard('creature_1', 'bear_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def', { power: 2, toughness: 2 }));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);
    // Need the lord on battlefield too for the effect to apply
    const cardsWithLord = new Map(state.cards);
    cardsWithLord.set('lord_1', makeCard('lord_1', 'bear_def', 'p1'));
    state = { ...state, cards: cardsWithLord };

    expect(getEffectivePower(state, 'creature_1')).toBe(3); // 2 base + 1 continuous
    expect(getEffectiveToughness(state, 'creature_1')).toBe(3);
  });

  it('subtype filter only affects matching creatures', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('lord_1', makeCard('lord_1', 'elf_lord_def', 'p1'));
    cards.set('elf_1', makeCard('elf_1', 'elf_def', 'p1'));
    cards.set('goblin_1', makeCard('goblin_1', 'goblin_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('elf_lord_def', makeDef('elf_lord_def', { type_line: 'Creature - Elf' }));
    defs.set('elf_def', makeDef('elf_def', { type_line: 'Creature - Elf' }));
    defs.set('goblin_def', makeDef('goblin_def', { type_line: 'Creature - Goblin' }));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'], subtypes: ['elf'] },
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);

    // Elf gets the buff
    expect(getContinuousPTModification(state, 'elf_1')).toEqual({ power: 1, toughness: 1 });

    // Goblin does NOT get the buff
    expect(getContinuousPTModification(state, 'goblin_1')).toEqual({ power: 0, toughness: 0 });
  });

  it('multiple lords stack their buffs', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('lord_1', makeCard('lord_1', 'lord_def', 'p1'));
    cards.set('lord_2', makeCard('lord_2', 'lord_def', 'p1'));
    cards.set('creature_1', makeCard('creature_1', 'bear_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('lord_def', makeDef('lord_def'));
    defs.set('bear_def', makeDef('bear_def'));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);
    state = registerContinuousEffect(state, 'lord_2', 'p1', ability);

    // Creature gets +2/+2 total
    expect(getContinuousPTModification(state, 'creature_1')).toEqual({ power: 2, toughness: 2 });
  });

  it('Sisay-style dynamic boost counts unique colors among other legendary permanents', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('sisay_1', makeCard('sisay_1', 'sisay_def', 'p1'));
    cards.set('legend_wu', makeCard('legend_wu', 'legend_wu_def', 'p1'));
    cards.set('legend_r', makeCard('legend_r', 'legend_r_def', 'p1'));
    cards.set('nonlegend_g', makeCard('nonlegend_g', 'nonlegend_g_def', 'p1'));
    cards.set('opp_legend_b', makeCard('opp_legend_b', 'opp_legend_b_def', 'p2'));

    const defs = new Map<string, CardDefinition>();
    defs.set('sisay_def', makeDef('sisay_def', {
      name: 'Sisay, Weatherlight Captain',
      type_line: 'Legendary Creature - Human Soldier',
      colors: ['W'],
      power: 2,
      toughness: 2,
    }));
    defs.set('legend_wu_def', makeDef('legend_wu_def', {
      name: 'Two-Color Legend',
      type_line: 'Legendary Creature - Advisor',
      colors: ['W', 'U'],
    }));
    defs.set('legend_r_def', makeDef('legend_r_def', {
      name: 'Red Legend',
      type_line: 'Legendary Artifact Creature - Construct',
      colors: ['R'],
    }));
    defs.set('nonlegend_g_def', makeDef('nonlegend_g_def', {
      name: 'Green Nonlegend',
      type_line: 'Creature - Elf',
      colors: ['G'],
    }));
    defs.set('opp_legend_b_def', makeDef('opp_legend_b_def', {
      name: 'Opponent Legend',
      type_line: 'Legendary Creature - Rogue',
      colors: ['B'],
    }));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: {
        kind: 'ModifyPTByUniqueColorsAmongOtherLegendaryPermanentsYouControl',
        powerPerColor: 1,
        toughnessPerColor: 1,
      },
      filter: {},
      controller: 'any',
      excludeSelf: false,
      selfOnly: true,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'sisay_1', 'p1', ability);

    expect(getEffectivePower(state, 'sisay_1')).toBe(5);
    expect(getEffectiveToughness(state, 'sisay_1')).toBe(5);
    expect(getEffectivePower(state, 'legend_wu')).toBe(2);
  });

  it('buff stops when lord leaves the battlefield', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('lord_1', makeCard('lord_1', 'lord_def', 'p1'));
    cards.set('creature_1', makeCard('creature_1', 'bear_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('lord_def', makeDef('lord_def'));
    defs.set('bear_def', makeDef('bear_def'));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ModifyPT', power: 1, toughness: 1 },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);

    // Initially buffed
    expect(getContinuousPTModification(state, 'creature_1')).toEqual({ power: 1, toughness: 1 });

    // Move lord to graveyard
    const newCards = new Map(state.cards);
    newCards.set('lord_1', { ...newCards.get('lord_1')!, zone: 'graveyard' as const });
    state = { ...state, cards: newCards };

    // Effect no longer applies (source not on battlefield)
    expect(getContinuousPTModification(state, 'creature_1')).toEqual({ power: 0, toughness: 0 });
  });
});

describe('Continuous Keyword Grants', () => {
  beforeEach(() => {
    resetContinuousTimestamp();
  });

  it('grants keywords via continuous effects', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('lord_1', makeCard('lord_1', 'lord_def', 'p1'));
    cards.set('creature_1', makeCard('creature_1', 'bear_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('lord_def', makeDef('lord_def'));
    defs.set('bear_def', makeDef('bear_def', { keywords: [] }));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'GrantKeyword', keyword: 'flying' },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);

    const granted = getGrantedKeywords(state, 'creature_1');
    expect(granted).toContain('flying');
  });

  it('keyword grants integrate with getKeywordsForInstance', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('lord_1', makeCard('lord_1', 'lord_def', 'p1'));
    cards.set('creature_1', makeCard('creature_1', 'bear_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('lord_def', makeDef('lord_def'));
    defs.set('bear_def', makeDef('bear_def', { keywords: ['Trample'] }));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'GrantKeyword', keyword: 'flying' },
      filter: { types: ['creature'] },
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'lord_1', 'p1', ability);

    const keywords = getKeywordsForInstance(state, 'creature_1');
    expect(keywords.has('Flying')).toBe(true);  // from continuous effect
    expect(keywords.has('Trample')).toBe(true);  // from definition
  });

  it('registers parsed self combat restrictions as continuous keywords', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('prowler_1', makeCard('prowler_1', 'prowler_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('prowler_def', makeDef('prowler_def', {
      name: 'River Prowler',
      oracle_text: "This creature can't block and can't be blocked.",
      keywords: [],
    }));

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousAbilitiesForPermanent(state, 'prowler_1');

    const keywords = getKeywordsForInstance(state, 'prowler_1');
    expect(keywords.has('CannotBlock')).toBe(true);
    expect(keywords.has('Unblockable')).toBe(true);
  });
});

describe('Cost Reduction', () => {
  beforeEach(() => {
    resetContinuousTimestamp();
  });

  it('reduces spell costs', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('medallion_1', makeCard('medallion_1', 'medallion_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('medallion_def', makeDef('medallion_def', { card_types: ['artifact'] }));

    const ability: StaticAbilityEffect = {
      kind: 'StaticAbility',
      modifier: { kind: 'ReduceCost', amount: 1 },
      filter: {},
      controller: 'you',
      excludeSelf: false,
    };

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'medallion_1', 'p1', ability);

    expect(getCostReduction(state, 'p1')).toBe(1);
    expect(getCostReduction(state, 'p2')).toBe(0); // only for controller
  });

  it('makes an otherwise uncastable instant castable through parsed cost reduction', () => {
    const reducerText = 'Instant and sorcery spells you cast cost {1} less to cast.';
    const parsed = parseOracleText(reducerText);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    const cards = new Map<string, CardInstance>();
    cards.set('mentor_1', makeCard('mentor_1', 'mentor_def', 'p1', 'battlefield'));
    cards.set('bolt_1', makeCard('bolt_1', 'bolt_def', 'p1', 'hand'));

    const defs = new Map<string, CardDefinition>();
    defs.set('mentor_def', makeDef('mentor_def', {
      name: 'Stormcatch Mentor',
      type_line: 'Creature - Otter Wizard',
      oracle_text: reducerText,
      card_types: ['creature'],
      colors: ['R'],
    }));
    defs.set('bolt_def', makeDef('bolt_def', {
      name: 'Expensive Bolt',
      type_line: 'Instant',
      oracle_text: 'Expensive Bolt deals 3 damage to any target.',
      mana_cost: '{1}{R}',
      cmc: 2,
      card_types: ['instant'],
      colors: ['R'],
    }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = {
      ...players[0],
      manaPool: { ...emptyManaPool(), R: 1 },
    };

    let state = makeState({
      players,
      cards,
      cardDefinitions: defs,
      phase: 'precombat_main',
      step: 'main',
    });

    expect(canCastSpell(state, 'p1', 'bolt_1')).toBe(false);
    state = registerContinuousEffect(state, 'mentor_1', 'p1', parsed.ability);
    expect(canCastSpell(state, 'p1', 'bolt_1')).toBe(true);
  });

  it('applies chosen-type cost reducers only to matching creature spells', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('horn_1', {
      ...makeCard('horn_1', 'horn_def', 'p1', 'battlefield'),
      choices: { chosenCreatureType: 'Bird' },
    });
    cards.set('bird_1', makeCard('bird_1', 'bird_def', 'p1', 'hand'));
    cards.set('dragon_1', makeCard('dragon_1', 'dragon_def', 'p1', 'hand'));

    const defs = new Map<string, CardDefinition>();
    defs.set('horn_def', makeDef('horn_def', {
      name: "Herald's Horn",
      type_line: 'Artifact',
      oracle_text: 'As Herald\'s Horn enters, choose a creature type.\nCreature spells you cast of the chosen type cost {1} less to cast.',
      card_types: ['artifact'],
      power: undefined,
      toughness: undefined,
    }));
    defs.set('bird_def', makeDef('bird_def', {
      name: 'Aven Test',
      type_line: 'Creature - Bird Wizard',
      mana_cost: '{1}{U}',
      cmc: 2,
      card_types: ['creature'],
      colors: ['U'],
    }));
    defs.set('dragon_def', makeDef('dragon_def', {
      name: 'Dragon Test',
      type_line: 'Creature - Dragon',
      mana_cost: '{1}{U}',
      cmc: 2,
      card_types: ['creature'],
      colors: ['U'],
    }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = {
      ...players[0],
      manaPool: { ...emptyManaPool(), U: 1 },
    };

    let state = makeState({
      players,
      cards,
      cardDefinitions: defs,
    });
    state = { ...state, phase: 'precombat_main' as any, step: 'main' as any };
    state = registerContinuousAbilitiesForPermanent(state, 'horn_1');

    expect(canCastSpell(state, 'p1', 'bird_1')).toBe(true);
    expect(canCastSpell(state, 'p1', 'dragon_1')).toBe(false);
  });

  it('applies intrinsic per-creature spell cost reduction from the spell being cast', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('act_1', makeCard('act_1', 'act_def', 'p1', 'hand'));

    const defs = new Map<string, CardDefinition>();
    defs.set('act_def', makeDef('act_def', {
      name: 'Blasphemous Act',
      type_line: 'Sorcery',
      oracle_text: 'This spell costs {1} less to cast for each creature on the battlefield. Blasphemous Act deals 13 damage to each creature.',
      mana_cost: '{8}{R}',
      cmc: 9,
      card_types: ['sorcery'],
      colors: ['R'],
      power: undefined,
      toughness: undefined,
    }));

    for (let i = 0; i < 8; i += 1) {
      const ownerId = i % 2 === 0 ? 'p1' : 'p2';
      cards.set(`creature_${i}`, makeCard(`creature_${i}`, 'bear_def', ownerId, 'battlefield'));
    }
    defs.set('bear_def', makeDef('bear_def', {
      name: 'Bear',
      type_line: 'Creature - Bear',
      card_types: ['creature'],
    }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), R: 1 } };

    let state = makeState({
      players,
      cards,
      cardDefinitions: defs,
    });
    state = { ...state, phase: 'precombat_main' as any, step: 'main' as any };

    expect(getIntrinsicCostReduction(state, 'p1', defs.get('act_def')!)).toBe(8);
    expect(canCastSpell(state, 'p1', 'act_1')).toBe(true);
  });

  it('applies intrinsic greatest-mana-value spell cost reduction from opposing artifacts', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('dragon_1', makeCard('dragon_1', 'dragon_def', 'p1', 'hand'));
    cards.set('rock_1', makeCard('rock_1', 'rock_def', 'p2', 'battlefield'));

    const defs = new Map<string, CardDefinition>();
    defs.set('dragon_def', makeDef('dragon_def', {
      name: 'Cavern-Hoard Dragon',
      type_line: 'Creature - Dragon',
      oracle_text: 'This spell costs {X} less to cast, where X is the greatest mana value among artifacts your opponents control.',
      mana_cost: '{7}{R}',
      cmc: 8,
      card_types: ['creature'],
      colors: ['R'],
      power: 6,
      toughness: 6,
    }));
    defs.set('rock_def', makeDef('rock_def', {
      name: 'Expensive Rock',
      type_line: 'Artifact',
      oracle_text: '',
      mana_cost: '{6}',
      cmc: 6,
      card_types: ['artifact'],
      power: undefined,
      toughness: undefined,
    }));

    const players = [makePlayer('p1'), makePlayer('p2')];
    players[0] = { ...players[0], manaPool: { ...emptyManaPool(), R: 1, C: 1 } };

    let state = makeState({
      players,
      cards,
      cardDefinitions: defs,
    });
    state = { ...state, phase: 'precombat_main' as any, step: 'main' as any };

    expect(getIntrinsicCostReduction(state, 'p1', defs.get('dragon_def')!)).toBe(6);
    expect(canCastSpell(state, 'p1', 'dragon_1')).toBe(true);
  });
});

// ============================================================================
// TASK 2: Conditional Effect Tests
// ============================================================================

describe('Conditional Effect Parsing', () => {
  it('parses "if you control a creature, draw a card"', () => {
    const result = parseOracleText('If you control a creature, draw a card');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const cond = result.effects[0] as ConditionalEffect;
    expect(cond.kind).toBe('Conditional');
    expect(cond.condition.kind).toBe('ControlsType');
    if (cond.condition.kind === 'ControlsType') {
      expect(cond.condition.controller).toBe('you');
      expect(cond.condition.filter).toEqual({ types: ['creature'] });
    }
    expect(cond.effect.kind).toBe('Draw');
  });

  it('parses "if you control a dragon, draw 2 cards"', () => {
    const result = parseOracleText('If you control a dragon, draw 2 cards');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const cond = result.effects[0] as ConditionalEffect;
    expect(cond.kind).toBe('Conditional');
    if (cond.condition.kind === 'ControlsType') {
      expect(cond.condition.filter).toEqual({ types: ['creature'], subtypes: ['dragon'] });
    }
  });

  it('parses "if an opponent controls more creatures than you, draw a card"', () => {
    const result = parseOracleText('If an opponent controls more creatures than you, draw a card');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;

    expect(result.effects).toHaveLength(1);
    const cond = result.effects[0] as ConditionalEffect;
    expect(cond.kind).toBe('Conditional');
    expect(cond.condition.kind).toBe('ControlsMoreThan');
  });
});

describe('Conditional Effect Execution', () => {
  it('executes effect when condition is met', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('creature_1', makeCard('creature_1', 'bear_def', 'p1'));
    // Library cards for drawing
    cards.set('lib_1', { ...makeCard('lib_1', 'bear_def', 'p1'), zone: 'library' as const });

    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def'));

    let state = makeState({ cards, cardDefinitions: defs });

    const condEffect: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'ControlsType', controller: 'you', filter: { types: ['creature'] } },
      effect: { kind: 'Draw', player: { kind: 'Controller' }, count: 1 },
    };

    const newState = executeEffects(state, [condEffect], 'p1', [], [], 0);

    // Player controls a creature, so condition is met, card should be drawn
    const lib1 = newState.cards.get('lib_1');
    expect(lib1?.zone).toBe('hand');
  });

  it('does not execute effect when condition is not met', () => {
    const cards = new Map<string, CardInstance>();
    // No creatures on battlefield
    cards.set('lib_1', { ...makeCard('lib_1', 'bear_def', 'p1'), zone: 'library' as const });

    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def'));

    let state = makeState({ cards, cardDefinitions: defs });

    const condEffect: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'ControlsType', controller: 'you', filter: { types: ['creature'] } },
      effect: { kind: 'Draw', player: { kind: 'Controller' }, count: 1 },
    };

    const newState = executeEffects(state, [condEffect], 'p1', [], [], 0);

    // No creatures, condition not met, card stays in library
    const lib1 = newState.cards.get('lib_1');
    expect(lib1?.zone).toBe('library');
  });

  it('executes elseEffect when condition is not met', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('lib_1', { ...makeCard('lib_1', 'bear_def', 'p1'), zone: 'library' as const });

    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def'));

    let state = makeState({ cards, cardDefinitions: defs });

    const condEffect: ConditionalEffect = {
      kind: 'Conditional',
      condition: { kind: 'ControlsType', controller: 'you', filter: { types: ['creature'] } },
      effect: { kind: 'GainLife', player: { kind: 'Controller' }, amount: 5 },
      elseEffect: { kind: 'Draw', player: { kind: 'Controller' }, count: 1 },
    };

    const newState = executeEffects(state, [condEffect], 'p1', [], [], 0);

    // No creature => elseEffect fires => draw a card
    const lib1 = newState.cards.get('lib_1');
    expect(lib1?.zone).toBe('hand');
    // Life should NOT have changed (condition not met, so main effect doesn't run)
    expect(newState.players[0].life).toBe(40);
  });
});

describe('evaluateCondition', () => {
  it('ControlsType returns true when player has matching permanent', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('dragon_1', makeCard('dragon_1', 'dragon_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('dragon_def', makeDef('dragon_def', { type_line: 'Creature - Dragon', card_types: ['creature'], }));

    const state = makeState({ cards, cardDefinitions: defs });

    const result = evaluateCondition(
      state,
      { kind: 'ControlsType', controller: 'you', filter: { types: ['creature'], subtypes: ['dragon'] } },
      'p1',
    );
    expect(result).toBe(true);
  });

  it('ControlsType returns false when no matching permanent', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def', { type_line: 'Creature - Bear' }));

    const state = makeState({ cards, cardDefinitions: defs });

    const result = evaluateCondition(
      state,
      { kind: 'ControlsType', controller: 'you', filter: { types: ['creature'], subtypes: ['dragon'] } },
      'p1',
    );
    expect(result).toBe(false);
  });

  it('ControlsMoreThan detects opponent advantage', () => {
    const cards = new Map<string, CardInstance>();
    cards.set('opp_1', makeCard('opp_1', 'bear_def', 'p2'));
    cards.set('opp_2', makeCard('opp_2', 'bear_def', 'p2'));
    cards.set('mine_1', makeCard('mine_1', 'bear_def', 'p1'));

    const defs = new Map<string, CardDefinition>();
    defs.set('bear_def', makeDef('bear_def'));

    const state = makeState({ cards, cardDefinitions: defs });

    const result = evaluateCondition(
      state,
      { kind: 'ControlsMoreThan', who: 'opponent', what: { types: ['creature'] }, thanWho: 'you' },
      'p1',
    );
    expect(result).toBe(true); // opponent has 2, you have 1
  });

  it('LifeAtOrBelow checks life threshold', () => {
    const state = makeState({ players: [makePlayer('p1', 10), makePlayer('p2', 40)] });

    expect(evaluateCondition(state, { kind: 'LifeAtOrBelow', controller: 'you', amount: 10 }, 'p1')).toBe(true);
    expect(evaluateCondition(state, { kind: 'LifeAtOrBelow', controller: 'you', amount: 5 }, 'p1')).toBe(false);
  });
});
