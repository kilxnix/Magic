import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousEffect, getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { isProtectedFromSource } from '../keywords';
import { executeEffects, type EffectExecutionOptions } from '../effects/executor';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';
import type { AddManaEffect } from '../effects/ast';

// ============================================================================
// Slice 5: Chosen-color subsystem tests
//
// Covers:
//   1. Parser: "As ~ enters, choose a color." header stripping
//   2. Anthem: "Creatures [you control] of the chosen color get +1/+1"
//      (Caged Sun / Gauntlet of Power family) — chosenColorFromSource filter
//   3. Protection: "~ has protection from the chosen color"
//      (Order of Stars family) — isProtectedFromSource via getProtectionColors
//   4. Attached protection: "Enchanted creature has protection from the chosen color"
//      (Floating Shield family) — protectionClausesFor aura scan
//   5. Mana: "{T}: Add one mana of the chosen color." (Sol Grail family)
//      — matchAddManaChosenColor, AddManaEffect.chosenColorAmount, executor
// ============================================================================

function makePlayer(id: string): Player {
  return {
    id, name: id, life: 40,
    poisonCounters: 0,
    commanderDamage: {}, commanderTax: 0,
    commanderInstanceId: null, commanderCastCount: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false, hasPriority: false, hasLost: false,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  extra: Partial<CardInstance> = {},
): CardInstance {
  return {
    instanceId, definitionId, ownerId, zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    ...extra,
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
// 1. Parser: strip "choose a color" ETB header
// ============================================================================

describe('Slice 5: choose-color ETB header stripping', () => {
  it('strips "As ~ enters the battlefield, choose a color." and parses the remainder', () => {
    const oracle =
      'As ~ enters the battlefield, choose a color.\n'
      + 'Creatures you control of the chosen color get +1/+1.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(parsed.ability.filter.chosenColorFromSource).toBe(true);
    expect(parsed.ability.filter.types).toContain('creature');
    expect(parsed.ability.controller).toBe('you');
  });

  it('strips "As ~ enters, choose a color." (short form) and parses the remainder', () => {
    const oracle =
      'As ~ enters, choose a color.\n'
      + 'Creatures you control of the chosen color get +1/+1.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('StaticAbility');
  });

  it('returns Unparsed when the remainder cannot be parsed', () => {
    const oracle =
      'As ~ enters the battlefield, choose a color.\n'
      + 'Spells of the chosen color cost {1} more to cast.';
    const parsed = parseOracleText(oracle);
    // "Spells of the chosen color cost {1} more to cast" has no engine consumer.
    expect(parsed.kind).toBe('Unparsed');
  });

  it('parses a solo mana activation (Sol Grail style) after stripping', () => {
    // Sol Grail: "As ~ enters, choose a color. {T}: Add one mana of the chosen color."
    const oracle =
      'As ~ enters the battlefield, choose a color.\n'
      + '{T}: Add one mana of the chosen color.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    expect(parsed.abilities.length).toBe(1);
    const abil = parsed.abilities[0];
    expect(abil.isManaAbility).toBe(true);
    expect(abil.cost.tap).toBe(true);
    const effect = abil.effects[0] as AddManaEffect;
    expect(effect.kind).toBe('AddMana');
    expect(effect.chosenColorAmount).toBe(1);
  });
});

// ============================================================================
// 2. Anthem: chosenColorFromSource filter — Caged Sun / Gauntlet of Power
// ============================================================================

const ANTHEM_ORACLE =
  'As ~ enters the battlefield, choose a color.\n'
  + 'Creatures you control of the chosen color get +1/+1.';

function buildAnthemState(chosenColor?: 'W' | 'U' | 'B' | 'R' | 'G') {
  const defs = new Map<string, CardDefinition>();
  defs.set('sun_def', makeDef('sun_def', {
    name: 'Caged Sun',
    type_line: 'Artifact',
    oracle_text: ANTHEM_ORACLE,
    card_types: ['artifact'],
    colors: [],
    power: undefined,
    toughness: undefined,
  }));
  defs.set('red_goblin_def', makeDef('red_goblin_def', {
    name: 'Red Goblin',
    type_line: 'Creature - Goblin',
    colors: ['R'],
    power: 1,
    toughness: 1,
  }));
  defs.set('green_elf_def', makeDef('green_elf_def', {
    name: 'Green Elf',
    type_line: 'Creature - Elf',
    colors: ['G'],
    power: 1,
    toughness: 1,
  }));

  const cards = new Map<string, CardInstance>();
  cards.set('sun', makeCard('sun', 'sun_def', 'p1',
    chosenColor ? { choices: { chosenColor } } : {}));
  cards.set('goblin', makeCard('goblin', 'red_goblin_def', 'p1'));
  cards.set('elf', makeCard('elf', 'green_elf_def', 'p1'));

  return makeState({ cards, cardDefinitions: defs });
}

describe('Slice 5: anthem — creatures of the chosen color get +1/+1', () => {
  it('parses the anthem into a chosenColorFromSource filter', () => {
    const parsed = parseOracleText(ANTHEM_ORACLE);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.filter.chosenColorFromSource).toBe(true);
    expect(parsed.ability.filter.types).toContain('creature');
    expect(parsed.ability.controller).toBe('you');
    expect(parsed.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
  });

  it('EXECUTES: buffs only creatures of the chosen color (red chosen)', () => {
    let state = buildAnthemState('R');
    const parsed = parseOracleText(ANTHEM_ORACLE);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    state = registerContinuousEffect(state, 'sun', 'p1', parsed.ability);

    // Red creature gets +1/+1.
    expect(getEffectivePower(state, 'goblin')).toBe(2);
    expect(getEffectiveToughness(state, 'goblin')).toBe(2);
    // Green creature is unaffected.
    expect(getEffectivePower(state, 'elf')).toBe(1);
    expect(getEffectiveToughness(state, 'elf')).toBe(1);
  });

  it('EXECUTES: buffs only creatures of the chosen color (green chosen)', () => {
    let state = buildAnthemState('G');
    const parsed = parseOracleText(ANTHEM_ORACLE);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    state = registerContinuousEffect(state, 'sun', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'elf')).toBe(2);
    expect(getEffectivePower(state, 'goblin')).toBe(1);
  });

  it('EXECUTES honestly: no buff when no color is chosen', () => {
    let state = buildAnthemState(undefined);
    const parsed = parseOracleText(ANTHEM_ORACLE);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    state = registerContinuousEffect(state, 'sun', 'p1', parsed.ability);

    // No color chosen → no buff.
    expect(getEffectivePower(state, 'goblin')).toBe(1);
    expect(getEffectivePower(state, 'elf')).toBe(1);
  });
});

// ============================================================================
// 3. Protection: Order of Stars style — "~ has protection from the chosen color"
// ============================================================================

const ORDER_ORACLE =
  'As ~ enters the battlefield, choose a color.\n'
  + '~ has protection from the chosen color.';

describe('Slice 5: protection from the chosen color (self-protection)', () => {
  it('parses "~ has protection from the chosen color" as a StaticAbility', () => {
    const parsed = parseOracleText(ORDER_ORACLE);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.selfOnly).toBe(true);
    expect(parsed.ability.modifier.kind).toBe('GrantKeyword');
    if (parsed.ability.modifier.kind !== 'GrantKeyword') return;
    expect(parsed.ability.modifier.keyword.toLowerCase()).toBe('protection');
  });

  it('EXECUTES: isProtectedFromSource returns true when source color matches chosen color', () => {
    const defs = new Map<string, CardDefinition>();
    defs.set('order_def', makeDef('order_def', {
      name: 'Order of the Stars',
      type_line: 'Creature - Cleric',
      oracle_text: ORDER_ORACLE,
      colors: ['W'],
      card_types: ['creature'],
      power: 1,
      toughness: 3,
    }));
    defs.set('red_spell_def', makeDef('red_spell_def', {
      name: 'Red Spell',
      type_line: 'Instant',
      oracle_text: 'Deal 3 damage.',
      colors: ['R'],
      card_types: ['instant'],
      power: undefined,
      toughness: undefined,
    }));
    defs.set('blue_spell_def', makeDef('blue_spell_def', {
      name: 'Blue Spell',
      type_line: 'Sorcery',
      oracle_text: 'Draw a card.',
      colors: ['U'],
      card_types: ['sorcery'],
      power: undefined,
      toughness: undefined,
    }));

    const cards = new Map<string, CardInstance>();
    // Order of the Stars with chosenColor = 'R'
    cards.set('order', makeCard('order', 'order_def', 'p1', {
      choices: { chosenColor: 'R' },
    }));
    // Red source in hand/graveyard (non-battlefield is fine for sourceId lookup)
    cards.set('red_spell', makeCard('red_spell', 'red_spell_def', 'p2',
      { zone: 'hand' }));
    cards.set('blue_spell', makeCard('blue_spell', 'blue_spell_def', 'p2',
      { zone: 'hand' }));

    const state = makeState({ cards, cardDefinitions: defs });

    // Order has protection from Red (chosen color) → red spell can't target it.
    expect(isProtectedFromSource(state, 'order', 'red_spell')).toBe(true);
    // Order is NOT protected from Blue (not the chosen color).
    expect(isProtectedFromSource(state, 'order', 'blue_spell')).toBe(false);
  });
});

// ============================================================================
// 4. Attached protection: Floating Shield style
// ============================================================================

const FLOATING_SHIELD_ORACLE =
  'As ~ enters the battlefield, choose a color.\n'
  + 'Enchanted creature has protection from the chosen color.\n'
  + 'Enchant creature';

describe('Slice 5: attached protection (Floating Shield)', () => {
  it('parses Floating Shield oracle as StaticAbility (attachedOnly)', () => {
    const parsed = parseOracleText(FLOATING_SHIELD_ORACLE);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.attachedOnly).toBe(true);
  });

  it('EXECUTES: isProtectedFromSource on enchanted creature uses aura chosenColor', () => {
    const defs = new Map<string, CardDefinition>();
    defs.set('shield_def', makeDef('shield_def', {
      name: 'Floating Shield',
      type_line: 'Enchantment - Aura',
      oracle_text: FLOATING_SHIELD_ORACLE,
      colors: ['W'],
      card_types: ['enchantment'],
      power: undefined,
      toughness: undefined,
    }));
    defs.set('creature_def', makeDef('creature_def', {
      name: 'Guarded Creature',
      type_line: 'Creature - Human',
      oracle_text: '',
      colors: ['W'],
      card_types: ['creature'],
      power: 2,
      toughness: 2,
    }));
    defs.set('red_source_def', makeDef('red_source_def', {
      name: 'Red Source',
      type_line: 'Instant',
      oracle_text: '',
      colors: ['R'],
      card_types: ['instant'],
      power: undefined,
      toughness: undefined,
    }));
    defs.set('blue_source_def', makeDef('blue_source_def', {
      name: 'Blue Source',
      type_line: 'Sorcery',
      oracle_text: '',
      colors: ['U'],
      card_types: ['sorcery'],
      power: undefined,
      toughness: undefined,
    }));

    const cards = new Map<string, CardInstance>();
    // Floating Shield attached to the creature, chosenColor = 'R'
    cards.set('shield', makeCard('shield', 'shield_def', 'p1', {
      attachedTo: 'creature',
      choices: { chosenColor: 'R' },
    }));
    cards.set('creature', makeCard('creature', 'creature_def', 'p1'));
    cards.set('red_src', makeCard('red_src', 'red_source_def', 'p2', { zone: 'hand' }));
    cards.set('blue_src', makeCard('blue_src', 'blue_source_def', 'p2', { zone: 'hand' }));

    const state = makeState({ cards, cardDefinitions: defs });

    // Creature has protection from Red (via attached Floating Shield's chosenColor=R).
    expect(isProtectedFromSource(state, 'creature', 'red_src')).toBe(true);
    // Creature does NOT have protection from Blue.
    expect(isProtectedFromSource(state, 'creature', 'blue_src')).toBe(false);
  });
});

// ============================================================================
// 5. Mana: Sol Grail — "{T}: Add one mana of the chosen color."
// ============================================================================

describe('Slice 5: Sol Grail mana ability', () => {
  it('parses as Activated with isManaAbility=true and chosenColorAmount=1', () => {
    const oracle =
      'As ~ enters the battlefield, choose a color.\n'
      + '{T}: Add one mana of the chosen color.';
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const abil = parsed.abilities[0];
    expect(abil.isManaAbility).toBe(true);
    const effect = abil.effects[0] as AddManaEffect;
    expect(effect.kind).toBe('AddMana');
    expect(effect.chosenColorAmount).toBe(1);
  });

  it('EXECUTES: AddMana with chosenColorAmount adds the chosen color to the pool', () => {
    // Simulate executor directly: execute the AddMana effect on a player.
    // We use the executeEffects function indirectly by constructing a minimal state
    // and verifying the mana pool after execution.

    const defs = new Map<string, CardDefinition>();
    const solGrailOracle =
      'As ~ enters the battlefield, choose a color.\n'
      + '{T}: Add one mana of the chosen color.';
    defs.set('grail_def', makeDef('grail_def', {
      name: 'Sol Grail',
      type_line: 'Artifact',
      oracle_text: solGrailOracle,
      colors: [],
      card_types: ['artifact'],
      power: undefined,
      toughness: undefined,
    }));

    const cards = new Map<string, CardInstance>();
    // Sol Grail with chosenColor = 'U'
    cards.set('grail', makeCard('grail', 'grail_def', 'p1', {
      choices: { chosenColor: 'U' },
    }));

    const state = makeState({ cards, cardDefinitions: defs });

    // Parse the activated ability
    const parsed = parseOracleText(solGrailOracle);
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    const abil = parsed.abilities[0];
    const effect = abil.effects[0] as AddManaEffect;
    expect(effect.chosenColorAmount).toBe(1);

    // Execute the AddMana effect — pass sourceInstanceId='grail' so executor
    // can look up grail.choices.chosenColor.
    const opts: EffectExecutionOptions = { sourceInstanceId: 'grail' };
    const afterState = executeEffects(state, abil.effects, 'p1', [], [], 0, opts);

    // Controller's mana pool should have 1 Blue mana.
    const player = afterState.players.find((p: { id: string }) => p.id === 'p1');
    expect(player?.manaPool.U).toBe(1);
    // Other colors should not have been added.
    expect(player?.manaPool.R).toBe(0);
    expect(player?.manaPool.G).toBe(0);
  });
});
