import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { registerContinuousEffect, getCostReduction, getGrantedKeywords } from '../effects/continuous';
import { executeEffects } from '../effects/executor';
import { hasKeyword } from '../keywords';
import { emptyManaPool } from '../types';
import type { GameState, CardInstance, CardDefinition, Player } from '../types';

/**
 * Family: keyword-line-absorption (engine-known keywords).
 *
 * Mixed faces used to fail wholesale when a standalone keyword line ("Flying",
 * "Trample", "Ward {2}") sat before/among otherwise-parseable text. The parser
 * now absorbs any line that is purely a comma/and-list of engine-enforced
 * keywords, re-parses the remainder through the full normal dispatch, and
 * records the absorbed keywords on the result. HONEST: the keywords' functions
 * are enforced outside the parse (keywords.ts keyword cache read from
 * def.keywords, ward.ts parseWardCost, stack.ts hasProwess, keywords.ts
 * protection/evasion oracle scans), and the remainder's parse is exactly what
 * the runtime per-line paths register and execute.
 */

// ============================================================================
// Test helpers (mirrors kw-self-cost-reduction.test.ts)
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
    phase: 'precombat_main' as any,
    step: 'main' as any,
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
// RECOGNITION: previously-Unparsed mixed faces now parse, with the keyword
// lines absorbed and recorded.
// ============================================================================

describe('keyword-line absorption — parser recognition', () => {
  it('absorbs a leading "Flying" line before a cost-reduction static (Mocking Sprite)', () => {
    const r = parseOracleText('Flying\nInstant and sorcery spells you cast cost {1} less to cast.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ReduceCost', amount: 1 });
    expect(r.ability.filter.types).toEqual(['instant', 'sorcery']);
    expect(r.absorbedKeywords).toEqual(['flying']);
  });

  it('absorbs a leading "Trample" line before a keyword-grant static (Aggressive Mammoth)', () => {
    const r = parseOracleText('Trample\nOther creatures you control have trample.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'GrantKeyword', keyword: 'trample' });
    expect(r.ability.excludeSelf).toBe(true);
    expect(r.absorbedKeywords).toEqual(['trample']);
  });

  it('absorbs a leading "Flying" line before a self P/T static (Zanam Djinn)', () => {
    const r = parseOracleText('Flying\nThis creature gets -2/-2 as long as blue is the most common color among all permanents.');
    expect(r.kind).toBe('StaticAbility');
    if (r.kind !== 'StaticAbility') return;
    expect(r.ability.modifier).toEqual({ kind: 'ModifyPT', power: -2, toughness: -2 });
    expect(r.absorbedKeywords).toEqual(['flying']);
  });

  it('absorbs a multi-keyword comma list and a ward cost line', () => {
    const multi = parseOracleText('Flying, vigilance\nInstant and sorcery spells you cast cost {1} less to cast.');
    expect(multi.kind).toBe('StaticAbility');
    expect(multi.absorbedKeywords).toEqual(['flying', 'vigilance']);

    const ward = parseOracleText('Ward {2}\nOther creatures you control have trample.');
    expect(ward.kind).toBe('StaticAbility');
    expect(ward.absorbedKeywords).toEqual(['ward {2}']);
  });

  it('absorbs enforced protection clauses, including the "and from" spelling', () => {
    const r = parseOracleText('Flying, protection from black and from red\nOther creatures you control have trample.');
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toEqual(['flying', 'protection from black and from red']);
  });

  it('absorbs keyword lines with reminder text', () => {
    const r = parseOracleText(
      "Defender (This creature can't attack.)\nOther creatures you control have trample.",
    );
    expect(r.kind).toBe('StaticAbility');
    expect(r.absorbedKeywords).toEqual(['defender']);
  });

  // HONESTY GATES — absorption must never widen what the engine claims to run.
  it('does NOT claim a keyword-ONLY face (stays Unparsed for the KeywordOnly audit gate)', () => {
    expect(parseOracleText('Flying, vigilance').kind).toBe('Unparsed');
    expect(parseOracleText('Flying\nTrample, haste').kind).toBe('Unparsed');
  });

  it('does NOT absorb keywords the engine does not run (infect stays a real unrun function)', () => {
    const r = parseOracleText('Infect\nOther creatures you control have trample.');
    expect(r.kind).toBe('Unparsed');
  });

  it('does NOT claim the face when the remainder still fails to parse', () => {
    const r = parseOracleText('Flying\nYou may have ~ assign its combat damage as though it were not blocked.');
    expect(r.kind).toBe('Unparsed');
  });

  it('does not change faces that already parse (leading keyword before a trigger)', () => {
    // The pre-existing preamble trimmer claims this BEFORE absorption runs.
    const r = parseOracleText('Flying\nWhen ~ enters, draw a card.');
    expect(r.kind).toBe('ETB');
    expect(r.absorbedKeywords).toBeUndefined();
  });
});

// ============================================================================
// EXECUTION: the parsed remainder runs through the engine's existing
// continuous/executor machinery, and the absorbed keyword still functions via
// the keyword cache (def.keywords).
// ============================================================================

describe('keyword-line absorption — engine execution', () => {
  it('Mocking Sprite: the absorbed-parse static actually reduces instant/sorcery costs', () => {
    const parsed = parseOracleText('Flying\nInstant and sorcery spells you cast cost {1} less to cast.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    const cards = new Map<string, CardInstance>();
    cards.set('sprite_1', makeCard('sprite_1', 'sprite_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('sprite_def', makeDef('sprite_def', {
      name: 'Mocking Sprite',
      type_line: 'Creature — Faerie Rogue',
      oracle_text: 'Flying\nInstant and sorcery spells you cast cost {1} less to cast.',
      keywords: ['Flying'],
      colors: ['U'],
    }));
    defs.set('bolt_def', makeDef('bolt_def', {
      name: 'Lightning Bolt', type_line: 'Instant', card_types: ['instant'],
      power: undefined, toughness: undefined,
    }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'sprite_1', 'p1', parsed.ability);

    // Instants and sorceries the controller casts cost {1} less...
    expect(getCostReduction(state, 'p1', defs.get('bolt_def')!)).toBe(1);
    // ...creature spells do not...
    expect(getCostReduction(state, 'p1', defs.get('bear_def')!)).toBe(0);
    // ...and the opponent gets nothing.
    expect(getCostReduction(state, 'p2', defs.get('bolt_def')!)).toBe(0);

    // The absorbed "Flying" still functions through the keyword cache.
    expect(hasKeyword(state, 'sprite_1', 'flying')).toBe(true);
  });

  it('Aggressive Mammoth: the absorbed-parse static grants trample to OTHER creatures you control', () => {
    const parsed = parseOracleText('Trample\nOther creatures you control have trample.');
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;

    const cards = new Map<string, CardInstance>();
    cards.set('mammoth_1', makeCard('mammoth_1', 'mammoth_def', 'p1'));
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p1'));
    cards.set('bear_2', makeCard('bear_2', 'bear_def', 'p2'));
    const defs = new Map<string, CardDefinition>();
    defs.set('mammoth_def', makeDef('mammoth_def', {
      name: 'Aggressive Mammoth',
      type_line: 'Creature — Elephant',
      oracle_text: 'Trample\nOther creatures you control have trample.',
      keywords: ['Trample'],
      power: 8, toughness: 8,
    }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));

    let state = makeState({ cards, cardDefinitions: defs });
    state = registerContinuousEffect(state, 'mammoth_1', 'p1', parsed.ability);

    // Your other creature gains trample from the executed static...
    expect(getGrantedKeywords(state, 'bear_1')).toContain('trample');
    expect(hasKeyword(state, 'bear_1', 'trample')).toBe(true);
    // ...the opponent's creature does not...
    expect(getGrantedKeywords(state, 'bear_2')).not.toContain('trample');
    // ...and the mammoth itself keeps trample via its printed keyword
    // (excludeSelf static + def.keywords), proving the absorbed line is honest.
    expect(hasKeyword(state, 'mammoth_1', 'trample')).toBe(true);
  });

  it('Spearbreaker wording: a keyword line before an activated grant parses and executes', () => {
    // "Indestructible — {1}: Target creature ... gains indestructible until end
    // of turn." (Spearbreaker Behemoth; the "power 5 or greater" constraint is a
    // later slice). The line-based activated parser already skips the keyword
    // line, so this face parses WITHOUT needing absorption (absorbedKeywords
    // stays unset) — this test pins that coexistence and proves the parsed
    // ability executes.
    const parsed = parseOracleText('Indestructible\n{1}: Target creature gains indestructible until end of turn.');
    expect(parsed.kind).toBe('Activated');
    if (parsed.kind !== 'Activated') return;
    expect(parsed.absorbedKeywords).toBeUndefined();
    expect(parsed.abilities).toHaveLength(1);
    const ability = parsed.abilities[0];

    const cards = new Map<string, CardInstance>();
    cards.set('behemoth_1', makeCard('behemoth_1', 'behemoth_def', 'p1'));
    cards.set('bear_1', makeCard('bear_1', 'bear_def', 'p1'));
    const defs = new Map<string, CardDefinition>();
    defs.set('behemoth_def', makeDef('behemoth_def', {
      name: 'Spearbreaker Behemoth',
      type_line: 'Creature — Beast',
      oracle_text: 'Indestructible\n{1}: Target creature gains indestructible until end of turn.',
      keywords: ['Indestructible'],
      power: 5, toughness: 5,
    }));
    defs.set('bear_def', makeDef('bear_def', { name: 'Bear', type_line: 'Creature — Bear' }));

    const state = makeState({ cards, cardDefinitions: defs });

    // Execute the parsed ability's effects on the chosen target.
    const result = executeEffects(
      state,
      ability.effects,
      'p1',
      ['bear_1'],
      ability.targets,
    );
    expect(result.cards.get('bear_1')?.grantedKeywords).toContain('Indestructible');
    expect(hasKeyword(result, 'bear_1', 'indestructible')).toBe(true);
  });
});
