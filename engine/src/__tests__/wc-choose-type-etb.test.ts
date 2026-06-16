import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousEffect, getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// Family: choose-type-etb
//
// "As ~ enters[ the battlefield], choose a creature type." followed by an
// "of the chosen type" lord buff. The choice is supplied at cast time
// (CastSpellOptions.cardChoices.chosenCreatureType -> stored on
// CardInstance.choices.chosenCreatureType) and consumed by the static buff's
// filter.chosenCreatureTypeFromSource. These tests EXECUTE the buff: a creature
// of the chosen type gets the bonus; a creature of a different type does not.

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

const AUTOMATON_ORACLE =
  'As ~ enters the battlefield, choose a creature type.\n'
  + '~ is the chosen type in addition to its other types.\n'
  + 'Other creatures you control of the chosen type get +1/+1.';

function buildState(chosenType?: string) {
  const defs = new Map<string, CardDefinition>();
  defs.set('automaton_def', makeDef('automaton_def', {
    name: 'Adaptive Automaton',
    type_line: 'Artifact Creature - Construct',
    oracle_text: AUTOMATON_ORACLE,
    card_types: ['artifact', 'creature'],
    power: 2,
    toughness: 2,
  }));
  defs.set('goblin_def', makeDef('goblin_def', {
    name: 'Goblin Test',
    type_line: 'Creature - Goblin',
    power: 1,
    toughness: 1,
  }));
  defs.set('elf_def', makeDef('elf_def', {
    name: 'Elf Test',
    type_line: 'Creature - Elf',
    power: 1,
    toughness: 1,
  }));

  const cards = new Map<string, CardInstance>();
  cards.set('automaton', makeCard('automaton', 'automaton_def', 'p1',
    chosenType ? { choices: { chosenCreatureType: chosenType } } : {}));
  cards.set('goblin', makeCard('goblin', 'goblin_def', 'p1'));
  cards.set('elf', makeCard('elf', 'elf_def', 'p1'));

  return makeState({ cards, cardDefinitions: defs });
}

describe('choose-type-etb: Adaptive Automaton lord', () => {
  it('parses the full card (strips the choose-type declaration) into a chosen-type buff', () => {
    const parsed = parseOracleText(AUTOMATON_ORACLE);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier).toEqual({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(parsed.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(parsed.ability.excludeSelf).toBe(true);
  });

  it('EXECUTES: buffs only creatures of the chosen type', () => {
    let state = buildState('Goblin');
    const parsed = parseOracleText(AUTOMATON_ORACLE);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    state = registerContinuousEffect(state, 'automaton', 'p1', parsed.ability);

    // Goblin matches the chosen type -> +1/+1 (1/1 -> 2/2).
    expect(getEffectivePower(state, 'goblin')).toBe(2);
    expect(getEffectiveToughness(state, 'goblin')).toBe(2);
    // Elf is a different type -> unaffected.
    expect(getEffectivePower(state, 'elf')).toBe(1);
    expect(getEffectiveToughness(state, 'elf')).toBe(1);
  });

  it('EXECUTES: changing the stored choice changes which creatures are buffed', () => {
    let state = buildState('Elf');
    const parsed = parseOracleText(AUTOMATON_ORACLE);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    state = registerContinuousEffect(state, 'automaton', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'elf')).toBe(2);
    expect(getEffectivePower(state, 'goblin')).toBe(1);
  });

  it('EXECUTES honestly: with no chosen type stored, nothing is buffed (no fake bonus)', () => {
    let state = buildState(undefined);
    const parsed = parseOracleText(AUTOMATON_ORACLE);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    state = registerContinuousEffect(state, 'automaton', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'goblin')).toBe(1);
    expect(getEffectivePower(state, 'elf')).toBe(1);
  });
});

describe('choose-type-etb: honesty guards', () => {
  it('does NOT parse a bare "choose a creature type" with no runnable function', () => {
    // No "of the chosen type" buff to consume the choice -> must stay Unparsed
    // rather than fake-parse just to flip the coverage bit.
    const parsed = parseOracleText('As ~ enters, choose a creature type.');
    expect(parsed.kind).toBe('Unparsed');
  });

  it('handles "choose a color" when the remainder parses (Slice 5 consumers exist)', () => {
    // Slice 5 adds chosenColor storage + anthem/protection/mana consumers.
    // A face whose remainder parses should no longer be Unparsed.
    const parsed = parseOracleText(
      'As ~ enters the battlefield, choose a color.\n'
      + 'Creatures you control of the chosen color get +1/+1.',
    );
    // The anthem remainder parses as a StaticAbility.
    expect(parsed.kind).toBe('StaticAbility');
  });

  it('does NOT handle "choose a color" when the remainder cannot parse', () => {
    const parsed = parseOracleText(
      'As ~ enters the battlefield, choose a color.\n'
      + 'Spells of the chosen color cost {1} more to cast.',
    );
    // "Spells of the chosen color cost {1} more to cast" has no engine consumer.
    expect(parsed.kind).toBe('Unparsed');
  });
});
