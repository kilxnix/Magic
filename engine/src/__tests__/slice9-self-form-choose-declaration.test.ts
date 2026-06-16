/**
 * slice9-self-form-choose-declaration.test.ts
 *
 * Slice 9: As-enters choose-declaration absorber — 'this creature/aura/enchantment'
 * self-forms.
 *
 * Modern oracle text sometimes uses "this creature", "this Aura", "this enchantment",
 * "this artifact", "this land", or "this equipment" instead of '~' for self-reference.
 * normalizeSelf/normalizeOracleForParser does NOT rewrite these phrases to '~', so the
 * per-line absorber and whole-face strip regex must accept both alternatives.
 *
 * This file verifies:
 *  1. Parse: whole-face strip path — "As this creature enters, choose a creature type."
 *     (Radiant Destiny self-form) is stripped and the companion lord-buff parses.
 *  2. Parse: whole-face strip path — "As this enchantment enters, choose a color."
 *     (Order of the Stars / Ward Sliver self-form) is stripped and companion parses.
 *  3. Parse: whole-face strip path — "As this artifact enters, choose a creature type."
 *     companion buff parses.
 *  4. Parse: per-line absorber path — choose-declaration as a non-first line in a
 *     multi-line face (e.g. after an Enchant preamble).
 *  5. Parse: "this creature is the chosen type ..." self-identity line is absorbed.
 *  6. Parse: "As this creature enters, choose an opponent." extended form absorbed.
 *  7. Parse: "As this creature enters, choose a player." extended form absorbed.
 *  8. Execution: the buff produced by stripping the self-form declaration is identical
 *     to the buff produced by the '~' form; it uses chosenCreatureTypeFromSource and
 *     grants +1/+1 to only the chosen-type creatures.
 *  9. Honesty: "As this creature enters, choose a creature type." with no executable
 *     companion remains Unparsed (no fake parse).
 *
 * Real oracle wordings referenced (self-form variants):
 *   Radiant Destiny    — "As this enchantment enters the battlefield, choose a creature type.\n
 *                          Creatures you control of the chosen type get +1/+1."
 *   Order of the Stars — "As this creature enters the battlefield, choose a color.\n
 *                          This creature has protection from the chosen color."
 *   Ward Sliver        — "As this creature enters, choose a color.\n
 *                          Sliver creatures you control have protection from the chosen color."
 *   True-Name Nemesis  — "As this creature enters the battlefield, choose a player.\n
 *                          This creature has protection from the chosen player."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousEffect, getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// ---------------------------------------------------------------------------
// Shared helpers (mirrors wc-choose-type-etb.test.ts helpers)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1–3. Whole-face strip path: "this <type> enters" self-form
// ---------------------------------------------------------------------------

describe('Slice 9: whole-face strip — this-form choose-creature-type declaration', () => {
  it('1. "As this enchantment enters, choose a creature type" + lord buff => StaticAbility', () => {
    // Radiant Destiny self-form: enchantment uses "this enchantment" instead of ~
    const oracle =
      'As this enchantment enters the battlefield, choose a creature type.\n'
      + 'Creatures you control of the chosen type get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
  });

  it('2. "As this creature enters, choose a creature type" + other lord buff => StaticAbility', () => {
    // Ward Sliver / Adaptive Automaton creature self-form
    const oracle =
      'As this creature enters the battlefield, choose a creature type.\n'
      + 'Other creatures you control of the chosen type get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.excludeSelf).toBe(true);
  });

  it('3. "As this artifact enters, choose a creature type" + buff => StaticAbility', () => {
    // Artifact creature variant
    const oracle =
      'As this artifact enters the battlefield, choose a creature type.\n'
      + 'Other creatures you control of the chosen type get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
  });
});

describe('Slice 9: whole-face strip — this-form choose-color declaration', () => {
  it('4. "As this creature enters, choose a color" + parseable companion => parses', () => {
    // Order of the Stars / Ward Sliver color self-form
    const oracle =
      'As this creature enters the battlefield, choose a color.\n'
      + 'Creatures you control of the chosen color get +1/+1.';
    const r = parseOracleText(oracle);
    // The anthem remainder parses as a StaticAbility (same as ~ form).
    expect(r.kind).toBe('StaticAbility');
  });

  it('5. "As this enchantment enters, choose a color" + companion => parses', () => {
    const oracle =
      'As this enchantment enters the battlefield, choose a color.\n'
      + 'Creatures you control of the chosen color get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
  });
});

describe('Slice 9: whole-face strip — this-form choose-opponent / choose-player', () => {
  it('6. "As this creature enters, choose an opponent" + trigger => Triggered (True-Name Nemesis style)', () => {
    const oracle =
      'As this creature enters the battlefield, choose a player.\n'
      + 'At the beginning of your upkeep, you gain 1 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
  });

  it('7. "As this creature enters, choose an opponent" + trigger => Triggered', () => {
    const oracle =
      'As this creature enters the battlefield, choose an opponent.\n'
      + 'At the beginning of your upkeep, you gain 1 life.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('Triggered');
  });
});

// ---------------------------------------------------------------------------
// 4. Per-line absorber: self-form as non-first line
// ---------------------------------------------------------------------------

describe('Slice 9: per-line absorber — this-form choose declaration as mid-face line', () => {
  it('8. Enchant preamble + this-creature choose type + lord buff: all lines accepted', () => {
    // Aura variant with "this creature" in the choose line, not first.
    const oracle =
      'Enchant creature\n'
      + 'As this aura enters the battlefield, choose a creature type.\n'
      + 'Other creatures you control of the chosen type get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
  });

  it('9. Enchant preamble + this-enchantment choose color + companion: all lines accepted', () => {
    const oracle =
      'Enchant creature\n'
      + 'As this enchantment enters the battlefield, choose a color.\n'
      + 'Creatures you control of the chosen color get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
  });
});

// ---------------------------------------------------------------------------
// 5. "this creature is the chosen type" self-identity absorption
// ---------------------------------------------------------------------------

describe('Slice 9: self-identity line "this creature is the chosen type"', () => {
  it('10. Self-identity line absorbed alongside choose declaration + buff', () => {
    // Adaptive Automaton has "~ is the chosen type in addition to its other types."
    // which is a self-identity flavor line.  The self-form variant should also be absorbed.
    const oracle =
      'As this creature enters the battlefield, choose a creature type.\n'
      + 'This creature is the chosen type in addition to its other types.\n'
      + 'Other creatures you control of the chosen type get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.excludeSelf).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Execution: buff produced by self-form is identical to '~' form
// ---------------------------------------------------------------------------

const SELF_FORM_ORACLE =
  'As this creature enters the battlefield, choose a creature type.\n'
  + 'Other creatures you control of the chosen type get +1/+1.';

const TILDE_FORM_ORACLE =
  'As ~ enters the battlefield, choose a creature type.\n'
  + 'Other creatures you control of the chosen type get +1/+1.';

function buildExecutionState(oracle: string, chosenType?: string) {
  const defs = new Map<string, CardDefinition>();
  defs.set('lord_def', makeDef('lord_def', {
    name: 'Lord Creature',
    type_line: 'Creature - Sliver',
    oracle_text: oracle,
    card_types: ['creature'],
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
  cards.set('lord', makeCard('lord', 'lord_def', 'p1',
    chosenType ? { choices: { chosenCreatureType: chosenType } } : {}));
  cards.set('goblin', makeCard('goblin', 'goblin_def', 'p1'));
  cards.set('elf', makeCard('elf', 'elf_def', 'p1'));

  return makeState({ cards, cardDefinitions: defs });
}

describe('Slice 9: execution — self-form buff is identical to tilde-form buff', () => {
  it('11. Self-form with chosenType=Goblin buffs only Goblins', () => {
    let state = buildExecutionState(SELF_FORM_ORACLE, 'Goblin');
    const parsed = parseOracleText(SELF_FORM_ORACLE);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    state = registerContinuousEffect(state, 'lord', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'goblin')).toBe(2);
    expect(getEffectiveToughness(state, 'goblin')).toBe(2);
    expect(getEffectivePower(state, 'elf')).toBe(1);
    expect(getEffectiveToughness(state, 'elf')).toBe(1);
  });

  it('12. Self-form with chosenType=Elf buffs only Elves', () => {
    let state = buildExecutionState(SELF_FORM_ORACLE, 'Elf');
    const parsed = parseOracleText(SELF_FORM_ORACLE);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    state = registerContinuousEffect(state, 'lord', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'elf')).toBe(2);
    expect(getEffectivePower(state, 'goblin')).toBe(1);
  });

  it('13. Self-form with no chosenType buffs nothing (honesty: no fake bonus)', () => {
    let state = buildExecutionState(SELF_FORM_ORACLE, undefined);
    const parsed = parseOracleText(SELF_FORM_ORACLE);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    state = registerContinuousEffect(state, 'lord', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'goblin')).toBe(1);
    expect(getEffectivePower(state, 'elf')).toBe(1);
  });

  it('14. Tilde-form and self-form produce the same parse result kind', () => {
    const selfParsed = parseOracleText(SELF_FORM_ORACLE);
    const tildeParsed = parseOracleText(TILDE_FORM_ORACLE);
    expect(selfParsed.kind).toBe(tildeParsed.kind);
    if (selfParsed.kind === 'StaticAbility' && tildeParsed.kind === 'StaticAbility') {
      expect(selfParsed.ability.modifier.kind).toBe(tildeParsed.ability.modifier.kind);
      expect(selfParsed.ability.filter.chosenCreatureTypeFromSource).toBe(true);
      expect(tildeParsed.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Honesty: no companion => stays Unparsed
// ---------------------------------------------------------------------------

describe('Slice 9: honesty guard — no-companion self-form stays Unparsed', () => {
  it('15. Bare "As this creature enters, choose a creature type." with no companion => Unparsed', () => {
    const r = parseOracleText('As this creature enters, choose a creature type.');
    expect(r.kind).toBe('Unparsed');
  });

  it('16. Bare "As this enchantment enters, choose a color." with no companion => Unparsed', () => {
    const r = parseOracleText('As this enchantment enters, choose a color.');
    expect(r.kind).toBe('Unparsed');
  });

  it('17. "As this creature enters, choose a color." with unexecutable companion => Unparsed', () => {
    // "Spells of the chosen color cost {1} more to cast." has no engine consumer.
    const r = parseOracleText(
      'As this creature enters the battlefield, choose a color.\n'
      + 'Spells of the chosen color cost {1} more to cast.',
    );
    expect(r.kind).toBe('Unparsed');
  });
});
