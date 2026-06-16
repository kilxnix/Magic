/**
 * Slice 5: Compound 'enters or attacks' triggers + CDA-companion parsing.
 *
 * Two coupled gaps are addressed:
 *
 *  (a) matchAddCounters Sub-case A2 now recognises 'land' as a valid target
 *      type for "put a <type> counter on target land", enabling the
 *      'enters or attacks' trigger tail "put a flood counter on target land"
 *      (Eluge, the Shoreless Sea family) to parse.
 *
 *  (b) CDA + companion trigger: a face whose first line is a CDA
 *      ("~'s power and toughness are each equal to ...") and whose second
 *      line is an 'enters or attacks' trigger is now parsed by
 *      parseOracleTextPerLine — the CDA line returns StaticAbility when called
 *      in isolation, and the trigger line returns ETB when its body parses.
 *
 * Parser tests verify correct AST shapes.
 * Execution tests verify that AddCounters with a Land Chosen target actually
 * places the counter on the target land card instance.
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ---------------------------------------------------------------------------
// Minimal state builder
// ---------------------------------------------------------------------------

function makeLandDef(id: string): CardDefinition {
  return {
    id,
    name: 'Island',
    type_line: 'Basic Land — Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
    subtypes: ['Island'],
  };
}

function makeCreatureDef(id: string): CardDefinition {
  return {
    id,
    name: 'Merfolk Looter',
    type_line: 'Creature — Merfolk Rogue',
    oracle_text: '',
    mana_cost: '{1}{U}',
    cmc: 2,
    colors: ['U'],
    color_identity: ['U'],
    keywords: [],
    card_types: ['creature'],
    power: 1,
    toughness: 1,
  };
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  cardTypes: string[] = ['land'],
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: {},
    damage: 0,
    isCommander: false,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  cardDefinitions.set('def-island', makeLandDef('def-island'));
  cardDefinitions.set('def-creature', makeCreatureDef('def-creature'));

  cards.set('land-1', makeCard('land-1', 'def-island', 'player-1'));
  cards.set('creature-1', makeCard('creature-1', 'def-creature', 'player-1', ['creature']));

  const players = ['player-1', 'player-2'].map((id, idx) => ({
    id,
    name: id,
    life: 40,
    poisonCounters: 0,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    hasPlayedLand: false,
    hasPriority: idx === 0,
    hasLost: false,
  }));

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'upkeep',
    turnNumber: 1,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
  } as GameState;
}

// ---------------------------------------------------------------------------
// Parser tests — arbitrary-type counter on target land
// ---------------------------------------------------------------------------

describe('sl5: "put a <type> counter on target land" — parser', () => {
  it('parses "put a flood counter on target land" as AddCounters / Land Chosen', () => {
    const parsed = parseOracleText('Put a flood counter on target land.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.counterType).toBe('flood');
    expect(e.count).toBe(1);
    expect(e.target.kind).toBe('Chosen');
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].type).toBe('Land');
  });

  it('parses "put a +1/+1 counter on target land" as AddCounters / Land Chosen', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on target land.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const e = parsed.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.counterType).toBe('+1/+1');
    expect(e.count).toBe(1);
    expect(parsed.targets[0].type).toBe('Land');
  });

  it('parses "put two rust counters on target land you control" with you-control constraint', () => {
    const parsed = parseOracleText('Put two rust counters on target land you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const e = parsed.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.counterType).toBe('rust');
    expect(e.count).toBe(2);
    expect(parsed.targets[0].type).toBe('Land');
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parser tests — 'enters or attacks' trigger with arbitrary-type land counter
// ---------------------------------------------------------------------------

describe('sl5: "Whenever ~ enters or attacks, put a flood counter on target land" — ETB trigger parse', () => {
  it('parses as ETB trigger with AddCounters / Land Chosen body', () => {
    const parsed = parseOracleText(
      'Whenever ~ enters or attacks, put a flood counter on target land.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    expect(parsed.ability.trigger).toEqual({ kind: 'ETB', who: 'self' });
    expect(parsed.ability.effects).toHaveLength(1);
    const e = parsed.ability.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.counterType).toBe('flood');
    expect(e.count).toBe(1);
    expect(e.target.kind).toBe('Chosen');
    expect(parsed.targets[0].type).toBe('Land');
  });

  it('parses "Whenever ~ enters or attacks, put a stun counter on target land you control." correctly', () => {
    const parsed = parseOracleText(
      'Whenever ~ enters or attacks, put a stun counter on target land you control.',
    );
    expect(parsed.kind).toBe('ETB');
    if (parsed.kind !== 'ETB') return;
    const e = parsed.ability.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.counterType).toBe('stun');
    expect(parsed.targets[0].type).toBe('Land');
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Parser tests — CDA + 'enters or attacks' trigger companion (Eluge family)
// ---------------------------------------------------------------------------

describe('sl5: CDA + enters-or-attacks trigger companion — parseOracleTextPerLine', () => {
  it('Eluge CDA + flood trigger: whole face is not Unparsed', () => {
    // Real Eluge oracle text (abbreviated): CDA line + enters-or-attacks trigger.
    const oracle = [
      "~'s power and toughness are each equal to the number of Islands you control.",
      'Whenever ~ enters or attacks, put a flood counter on target land.',
    ].join('\n');
    const parsed = parseOracleText(oracle);
    expect(parsed.kind).not.toBe('Unparsed');
  });

  it('CDA line alone parses as StaticAbility (SetBasePTDynamic)', () => {
    const line = "~'s power and toughness are each equal to the number of Islands you control.";
    const parsed = parseOracleText(line);
    expect(parsed.kind).toBe('StaticAbility');
    if (parsed.kind !== 'StaticAbility') return;
    expect(parsed.ability.modifier.kind).toBe('SetBasePTDynamic');
  });

  it('trigger line alone parses as ETB (enters-or-attacks recognized)', () => {
    const line = 'Whenever ~ enters or attacks, put a flood counter on target land.';
    const parsed = parseOracleText(line);
    expect(parsed.kind).toBe('ETB');
  });
});

// ---------------------------------------------------------------------------
// Execution tests — AddCounters places counter on target land
// ---------------------------------------------------------------------------

describe('sl5: AddCounters on target land — execution', () => {
  it('"put a flood counter on target land" places flood counter on chosen land', () => {
    const state = makeState();
    const parsed = parseOracleText('Put a flood counter on target land.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const landSpec = parsed.targets[0];
    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['land-1'], // chosen target: the Island on the battlefield
      [{ id: landSpec.id, count: 1 }],
    );

    const land = result.cards.get('land-1')!;
    expect(land.counters['flood']).toBe(1);
    // Non-chosen cards are untouched.
    expect(result.cards.get('creature-1')!.counters['flood'] ?? 0).toBe(0);
  });

  it('"put a +1/+1 counter on target land" stacks on subsequent calls', () => {
    const state = makeState();
    const parsed = parseOracleText('Put a +1/+1 counter on target land.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;

    const spec = parsed.targets[0];
    // Apply twice (simulating two trigger firings).
    let result = executeEffects(state, parsed.effects, 'player-1', ['land-1'], [{ id: spec.id }]);
    result = executeEffects(result, parsed.effects, 'player-1', ['land-1'], [{ id: spec.id }]);

    expect(result.cards.get('land-1')!.counters['+1/+1']).toBe(2);
  });
});
