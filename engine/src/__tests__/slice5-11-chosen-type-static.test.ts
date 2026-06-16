/**
 * slice5-11-chosen-type-static.test.ts
 *
 * Slice 5/11: 'As ~ enters, choose a creature type' with downstream chosen-type
 * STATIC beyond the +N/+N buff.  Covers:
 *
 *  1. Parse: "Creatures of the chosen type get +1/+1." (Shared Triumph style —
 *     no controller scope) emits StaticAbility{ ModifyPT, chosenCreatureTypeFromSource }.
 *  2. Parse: "Creatures of the chosen type have shroud." (Steely Resolve style —
 *     no controller scope) emits StaticAbility{ GrantKeyword:Shroud, chosenCreatureTypeFromSource }.
 *  3. Parse: full Shared Triumph oracle with choose-declaration strip parses to
 *     StaticAbility.
 *  4. Parse: full Steely Resolve oracle with choose-declaration strip parses to
 *     StaticAbility.
 *  5. Parse: "Creatures you control of the chosen type have vigilance." (with
 *     controller scope — existing Radiant Destiny path) still parses correctly.
 *  6. Honesty: "Creatures you control are the chosen type in addition to their
 *     other types." (Arcane Adaptation type-adding) stays Unparsed — no TypeAdd
 *     static modifier exists in the engine.
 *  7. Honesty: "Each creature you control is the chosen type in addition to their
 *     other types." (Xenograft) stays Unparsed.
 *  8. Execute: Steely Resolve shroud grant — goblin of chosen type gains shroud,
 *     elf of wrong type does not.
 *  9. Execute: Shared Triumph P/T buff — goblin of chosen type gets +1/+1,
 *     elf of wrong type does not.
 * 10. Execute: canBeTargetedByOpponent reflects shroud from chosen-type grant.
 *
 * Real oracle wordings referenced:
 *   Shared Triumph  — "As ~ enters the battlefield, choose a creature type.\n
 *                       Creatures of the chosen type get +1/+1."
 *   Steely Resolve  — "As ~ enters the battlefield, choose a creature type.\n
 *                       Creatures of the chosen type have shroud."
 *   Radiant Destiny — "As ~ enters the battlefield, choose a creature type.\n
 *                       Creatures you control of the chosen type get +1/+1."
 *   Arcane Adaptation — "As ~ enters the battlefield, choose a creature type.\n
 *                         Creatures you control are the chosen type in addition to their other types."
 *   Xenograft         — "As ~ enters the battlefield, choose a creature type.\n
 *                         Each creature you control is the chosen type in addition to their other types."
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousEffect, getEffectivePower, getEffectiveToughness } from '../effects/continuous';
import { canBeTargetedByOpponent } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

// ---------------------------------------------------------------------------
// Helpers
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
    power: opts.power ?? 1,
    toughness: opts.toughness ?? 1,
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

/**
 * Build a game state with:
 *   - an enchantment (the "chosen-type lord") on p1's battlefield
 *   - a Goblin creature (p1) with power/toughness 1/1
 *   - an Elf creature (p1) with power/toughness 1/1
 */
function buildState(enchantmentOracle: string, chosenType: string) {
  const defs = new Map<string, CardDefinition>();
  defs.set('enc_def', makeDef('enc_def', {
    name: 'Enchantment Lord',
    type_line: 'Enchantment',
    oracle_text: enchantmentOracle,
    card_types: ['enchantment'],
    power: undefined,
    toughness: undefined,
  }));
  defs.set('goblin_def', makeDef('goblin_def', {
    name: 'Test Goblin',
    type_line: 'Creature — Goblin',
    card_types: ['creature'],
    power: 1,
    toughness: 1,
  }));
  defs.set('elf_def', makeDef('elf_def', {
    name: 'Test Elf',
    type_line: 'Creature — Elf',
    card_types: ['creature'],
    power: 1,
    toughness: 1,
  }));

  const cards = new Map<string, CardInstance>();
  cards.set('enc', makeCard('enc', 'enc_def', 'p1', {
    choices: { chosenCreatureType: chosenType },
  }));
  cards.set('goblin', makeCard('goblin', 'goblin_def', 'p1'));
  cards.set('elf', makeCard('elf', 'elf_def', 'p1'));

  return makeState({ cards, cardDefinitions: defs });
}

// ---------------------------------------------------------------------------
// 1. Parse: no-controller "get +1/+1" form (Shared Triumph body)
// ---------------------------------------------------------------------------

describe('Slice 5/11: chosen-type static — no-controller "get" form (Shared Triumph)', () => {
  it('1. "Creatures of the chosen type get +1/+1." parses as StaticAbility', () => {
    const body = 'Creatures of the chosen type get +1/+1.';
    const r = parseOracleText(body);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    // No controller restriction — affects all players' chosen-type creatures
    expect(r.ability.controller).toBe('any');
  });

  it('2. Full Shared Triumph oracle parses as StaticAbility after choose-strip', () => {
    // Real Shared Triumph oracle text
    const oracle =
      'As ~ enters the battlefield, choose a creature type.\n'
      + 'Creatures of the chosen type get +1/+1.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Parse: no-controller "have <keyword>" form (Steely Resolve body)
// ---------------------------------------------------------------------------

describe('Slice 5/11: chosen-type static — no-controller "have" form (Steely Resolve)', () => {
  it('3. "Creatures of the chosen type have shroud." parses as StaticAbility', () => {
    const body = 'Creatures of the chosen type have shroud.';
    const r = parseOracleText(body);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'GrantKeyword', keyword: 'shroud' });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.controller).toBe('any');
  });

  it('4. Full Steely Resolve oracle parses as StaticAbility after choose-strip', () => {
    // Real Steely Resolve oracle text
    const oracle =
      'As ~ enters the battlefield, choose a creature type.\n'
      + 'Creatures of the chosen type have shroud.';
    const r = parseOracleText(oracle);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'GrantKeyword', keyword: 'shroud' });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
  });

  it('5. "Creatures of the chosen type have vigilance." also parses', () => {
    const body = 'Creatures of the chosen type have vigilance.';
    const r = parseOracleText(body);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'GrantKeyword', keyword: 'vigilance' });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Regression: existing "you control" form still parses
// ---------------------------------------------------------------------------

describe('Slice 5/11: regression — "you control" form still parses correctly', () => {
  it('6. "Creatures you control of the chosen type get +1/+1." still parses', () => {
    const body = 'Creatures you control of the chosen type get +1/+1.';
    const r = parseOracleText(body);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'ModifyPT', power: 1, toughness: 1 });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.controller).toBe('you');
  });

  it('7. "Creatures you control of the chosen type have vigilance." still parses', () => {
    const body = 'Creatures you control of the chosen type have vigilance.';
    const r = parseOracleText(body);
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toMatchObject({ kind: 'GrantKeyword', keyword: 'vigilance' });
    expect(r.ability.filter.chosenCreatureTypeFromSource).toBe(true);
    expect(r.ability.controller).toBe('you');
  });
});

// ---------------------------------------------------------------------------
// 4. Honesty: TypeAdd forms (Arcane Adaptation / Xenograft) stay Unparsed
// ---------------------------------------------------------------------------

describe('Slice 5/11: honesty — type-adding forms stay Unparsed', () => {
  it('8. Arcane Adaptation body stays Unparsed (no TypeAdd executor)', () => {
    // "Creatures you control are the chosen type in addition to their other types."
    // There is no TypeAdd static modifier in the engine — claiming this would be dishonest.
    const body = 'Creatures you control are the chosen type in addition to their other types.';
    const r = parseOracleText(body);
    // The body alone must not parse as a StaticAbility — it should stay Unparsed
    // because no continuous-layer TypeAdd modifier is implemented.
    expect(r.kind).toBe('Unparsed');
  });

  it('9. Xenograft body stays Unparsed', () => {
    const body = 'Each creature you control is the chosen type in addition to their other types.';
    const r = parseOracleText(body);
    expect(r.kind).toBe('Unparsed');
  });
});

// ---------------------------------------------------------------------------
// 5. Execution: Steely Resolve keyword grant via continuous effect
// ---------------------------------------------------------------------------

describe('Slice 5/11: execution — Steely Resolve shroud grant', () => {
  const STEELY_BODY = 'Creatures of the chosen type have shroud.';

  it('10. Goblin of chosen type gains shroud; elf of wrong type does not', () => {
    let state = buildState(STEELY_BODY, 'Goblin');
    const parsed = parseOracleText(STEELY_BODY);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    state = registerContinuousEffect(state, 'enc', 'p1', parsed.ability);

    // canBeTargetedByOpponent returns false when shroud is present
    expect(canBeTargetedByOpponent(state, 'goblin')).toBe(false);
    expect(canBeTargetedByOpponent(state, 'elf')).toBe(true);
  });

  it('11. Shroud grant respects chosen type change: if Elf is chosen, elf has shroud', () => {
    let state = buildState(STEELY_BODY, 'Elf');
    const parsed = parseOracleText(STEELY_BODY);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');

    state = registerContinuousEffect(state, 'enc', 'p1', parsed.ability);

    expect(canBeTargetedByOpponent(state, 'goblin')).toBe(true);
    expect(canBeTargetedByOpponent(state, 'elf')).toBe(false);
  });

  it('12. No shroud if enchantment has no chosenCreatureType set', () => {
    // Build state but do NOT set chosenCreatureType
    const defs = new Map<string, CardDefinition>();
    defs.set('enc_def', makeDef('enc_def', {
      type_line: 'Enchantment',
      card_types: ['enchantment'],
    }));
    defs.set('goblin_def', makeDef('goblin_def', {
      type_line: 'Creature — Goblin',
      card_types: ['creature'],
    }));
    const cards = new Map<string, CardInstance>();
    cards.set('enc', makeCard('enc', 'enc_def', 'p1')); // no choices
    cards.set('goblin', makeCard('goblin', 'goblin_def', 'p1'));
    const state0 = makeState({ cards, cardDefinitions: defs });

    const parsed = parseOracleText(STEELY_BODY);
    if (parsed.kind !== 'StaticAbility') throw new Error('expected StaticAbility');
    const state1 = registerContinuousEffect(state0, 'enc', 'p1', parsed.ability);

    // No chosen type → filter does not match → no shroud
    expect(canBeTargetedByOpponent(state1, 'goblin')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Execution: Shared Triumph P/T buff
// ---------------------------------------------------------------------------

describe('Slice 5/11: execution — Shared Triumph +1/+1 buff', () => {
  const TRIUMPH_BODY = 'Creatures of the chosen type get +1/+1.';

  it('13. Goblin of chosen type gets +1/+1; elf of wrong type does not', () => {
    let state = buildState(TRIUMPH_BODY, 'Goblin');
    const parsed = parseOracleText(TRIUMPH_BODY);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    state = registerContinuousEffect(state, 'enc', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'goblin')).toBe(2);
    expect(getEffectiveToughness(state, 'goblin')).toBe(2);
    expect(getEffectivePower(state, 'elf')).toBe(1);
    expect(getEffectiveToughness(state, 'elf')).toBe(1);
  });

  it('14. Full Shared Triumph oracle produces the same buff as body-only', () => {
    const fullOracle =
      'As ~ enters the battlefield, choose a creature type.\n'
      + 'Creatures of the chosen type get +1/+1.';
    let state = buildState(fullOracle, 'Goblin');
    const parsed = parseOracleText(fullOracle);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    state = registerContinuousEffect(state, 'enc', 'p1', parsed.ability);

    expect(getEffectivePower(state, 'goblin')).toBe(2);
    expect(getEffectiveToughness(state, 'goblin')).toBe(2);
    expect(getEffectivePower(state, 'elf')).toBe(1);
    expect(getEffectiveToughness(state, 'elf')).toBe(1);
  });
});
