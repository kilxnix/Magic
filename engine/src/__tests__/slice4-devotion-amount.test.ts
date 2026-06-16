/**
 * Slice 4 (devotion amounts): Tests for "equal to your devotion to <color(s)>"
 * AmountRef parsing and execution.
 *
 * Covers:
 *   - GainLife with DevotionCount (Setessan Petitioner)
 *   - CreateToken count with DevotionCount (Evangel of Heliod)
 *   - AddCounters count with DevotionCount (Reverent Hunter)
 */
import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

// A creature with a green mana symbol (devotion = 1 to green)
const greenCreatureDef: CardDefinition = {
  id: 'green1', name: 'Green1', type_line: 'Creature — Elf',
  oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
  colors: ['G'], color_identity: ['G'], keywords: [],
  card_types: ['creature'], power: 1, toughness: 1,
};

// A creature with two green mana symbols (devotion = 2 to green)
const greenCreature2Def: CardDefinition = {
  id: 'green2', name: 'Green2', type_line: 'Creature — Elf',
  oracle_text: '', mana_cost: '{G}{G}', cmc: 2,
  colors: ['G'], color_identity: ['G'], keywords: [],
  card_types: ['creature'], power: 2, toughness: 2,
};

// A white creature (devotion = 1 to white)
const whiteCreatureDef: CardDefinition = {
  id: 'white1', name: 'White1', type_line: 'Creature — Soldier',
  oracle_text: '', mana_cost: '{2}{W}', cmc: 3,
  colors: ['W'], color_identity: ['W'], keywords: [],
  card_types: ['creature'], power: 2, toughness: 2,
};

// A blue creature (used to confirm colors don't cross-pollinate)
const blueCreatureDef: CardDefinition = {
  id: 'blue1', name: 'Blue1', type_line: 'Creature — Merfolk',
  oracle_text: '', mana_cost: '{1}{U}', cmc: 2,
  colors: ['U'], color_identity: ['U'], keywords: [],
  card_types: ['creature'], power: 1, toughness: 1,
};

function makeState(cards: CardInstance[], extraDefs?: CardDefinition[]): GameState {
  const defs: [string, CardDefinition][] = [
    ['green1', greenCreatureDef],
    ['green2', greenCreature2Def],
    ['white1', whiteCreatureDef],
    ['blue1', blueCreatureDef],
  ];
  if (extraDefs) {
    for (const d of extraDefs) defs.push([d.id, d]);
  }
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(defs),
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'precombat_main',
    step: 'begin_combat',
    turnNumber: 2,
    hasPriorityPassed: [false, false],
    stack: [],
    combat: null,
    battlefieldAbilities: new Map(),
    pendingTriggers: [],
  };
}

function mkCard(instanceId: string, definitionId: string, ownerId = 'p0'): CardInstance {
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
  };
}

// ── Parser tests ───────────────────────────────────────────────────────────────

describe('Devotion amount — parser', () => {
  it('parses GainLife equal to devotion to green (Setessan Petitioner wording)', () => {
    const result = parseOracleText('you gain life equal to your devotion to green.');
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0];
    expect(eff.kind).toBe('GainLife');
    if (eff.kind !== 'GainLife') return;
    expect(eff.amount).toEqual({ kind: 'DevotionCount', colors: ['G'] });
  });

  it('parses CreateToken count equal to devotion to white (Evangel of Heliod wording)', () => {
    const result = parseOracleText(
      'create a number of 1/1 white Soldier creature tokens equal to your devotion to white.'
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0];
    expect(eff.kind).toBe('CreateToken');
    if (eff.kind !== 'CreateToken') return;
    expect(eff.count).toEqual({ kind: 'DevotionCount', colors: ['W'] });
  });

  it('parses AddCounters equal to devotion to green (Reverent Hunter wording)', () => {
    const result = parseOracleText(
      'put a number of +1/+1 counters on it equal to your devotion to green.'
    );
    expect(result.kind).toBe('Spell');
    if (result.kind !== 'Spell') return;
    expect(result.effects).toHaveLength(1);
    const eff = result.effects[0];
    expect(eff.kind).toBe('AddCounters');
    if (eff.kind !== 'AddCounters') return;
    expect(eff.count).toEqual({ kind: 'DevotionCount', colors: ['G'] });
    expect(eff.counterType).toBe('+1/+1');
  });

  it('parses ETB trigger with GainLife equal to devotion (Setessan Petitioner ETB form)', () => {
    const result = parseOracleText(
      'when this creature enters, you gain life equal to your devotion to green.'
    );
    expect(result.kind).toBe('ETB');
    if (result.kind !== 'ETB') return;
    expect(result.ability.effects).toHaveLength(1);
    const eff = result.ability.effects[0];
    expect(eff.kind).toBe('GainLife');
    if (eff.kind !== 'GainLife') return;
    expect(eff.amount).toEqual({ kind: 'DevotionCount', colors: ['G'] });
  });
});

// ── Executor tests ─────────────────────────────────────────────────────────────

describe('Devotion amount — executor', () => {
  it('GainLife equal to devotion to green — counts colored mana symbols correctly', () => {
    // Two green creatures on battlefield: green1 ({1}{G} = 1 green symbol) + green2 ({G}{G} = 2 green symbols)
    const state = makeState([
      mkCard('g1', 'green1'),
      mkCard('g2', 'green2'),
    ]);
    // Green devotion = 1 + 2 = 3
    const result = parseOracleText('you gain life equal to your devotion to green.');
    if (result.kind !== 'Spell') throw new Error('expected Spell');
    const newState = executeEffects(state, result.effects, 'p0', [], [], 0);
    expect(newState.players[0].life).toBe(43); // 40 + 3
  });

  it('GainLife equal to devotion to green — creatures of other colors do not count', () => {
    // One green creature + one blue creature; only the green one counts
    const state = makeState([
      mkCard('g1', 'green1'),   // {1}{G} = 1 green symbol
      mkCard('b1', 'blue1'),    // {1}{U} = 0 green symbols
    ]);
    const result = parseOracleText('you gain life equal to your devotion to green.');
    if (result.kind !== 'Spell') throw new Error('expected Spell');
    const newState = executeEffects(state, result.effects, 'p0', [], [], 0);
    expect(newState.players[0].life).toBe(41); // 40 + 1
  });

  it('GainLife equal to devotion to white — counts white mana symbols', () => {
    // Two white creatures: white1 ({2}{W} = 1 white symbol each)
    const state = makeState([
      mkCard('w1', 'white1'),   // {2}{W} = 1 white symbol
      mkCard('w2', 'white1'),   // second copy
    ]);
    const result = parseOracleText('you gain life equal to your devotion to white.');
    if (result.kind !== 'Spell') throw new Error('expected Spell');
    const newState = executeEffects(state, result.effects, 'p0', [], [], 0);
    expect(newState.players[0].life).toBe(42); // 40 + 2
  });

  it('AddCounters equal to devotion to green — places correct number of counters', () => {
    // green2 has {G}{G} = 2 green symbols; it is also the source
    const sourceDef: CardDefinition = {
      id: 'src', name: 'Src', type_line: 'Creature — Elf',
      oracle_text: 'when ~ enters, put a number of +1/+1 counters on it equal to your devotion to green.',
      mana_cost: '{2}{G}', cmc: 3,
      colors: ['G'], color_identity: ['G'], keywords: [],
      card_types: ['creature'], power: 1, toughness: 1,
    };
    const state = makeState(
      [
        mkCard('src', 'src'),
        mkCard('g2', 'green2'),  // {G}{G} = 2 additional green symbols
      ],
      [sourceDef],
    );
    // Devotion to green = 1 (src: {2}{G}) + 2 (g2: {G}{G}) = 3
    const result = parseOracleText(
      'put a number of +1/+1 counters on it equal to your devotion to green.'
    );
    if (result.kind !== 'Spell') throw new Error('expected Spell');
    const newState = executeEffects(state, result.effects, 'p0', [], [], 0, { sourceInstanceId: 'src' });
    const srcCard = newState.cards.get('src');
    expect(srcCard?.counters['+1/+1']).toBe(3);
  });

  it('CreateToken count equal to devotion — creates the right number of tokens', () => {
    // Two white creatures = 2 devotion to white
    const state = makeState([
      mkCard('w1', 'white1'),
      mkCard('w2', 'white1'),
    ]);
    const result = parseOracleText(
      'create a number of 1/1 white Soldier creature tokens equal to your devotion to white.'
    );
    if (result.kind !== 'Spell') throw new Error('expected Spell');
    const newState = executeEffects(state, result.effects, 'p0', [], [], 0);
    // Should have created 2 new token cards on the battlefield for p0
    const tokens = [...newState.cards.values()].filter(
      c => c.ownerId === 'p0' && c.zone === 'battlefield' && !['w1', 'w2'].includes(c.instanceId)
    );
    expect(tokens.length).toBe(2);
  });

  it('Devotion is 0 when no permanents with matching color symbols', () => {
    // Blue creature on battlefield — devotion to green = 0
    const state = makeState([mkCard('b1', 'blue1')]);
    const result = parseOracleText('you gain life equal to your devotion to green.');
    if (result.kind !== 'Spell') throw new Error('expected Spell');
    const newState = executeEffects(state, result.effects, 'p0', [], [], 0);
    expect(newState.players[0].life).toBe(40); // no gain
  });
});
