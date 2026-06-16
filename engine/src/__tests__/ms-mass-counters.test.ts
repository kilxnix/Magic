import { describe, it, expect } from 'vitest';
import { executeEffects } from '../effects/executor';
import { parseOracleText } from '../effects/parser';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

/**
 * Family: mass-counters
 *
 * "Put a/N +1/+1 counter(s) on each creature you control." → AllCreaturesYouControl
 * "Put a/N +1/+1 counter(s) on each creature."             → AllCreatures
 *
 * The matcher (parser.ts matchAddCounters sub-case A3) emits an AddCounters effect
 * whose target is AllCreaturesYouControl / AllCreatures. The executor's AddCounters
 * dispatch (executor.ts) loops over every battlefield creature the target implies
 * and calls executeAddCounters on each, so the family runs honestly for ALL
 * affected creatures (own-only vs every player) and STACKS onto existing counters.
 *
 * These tests EXECUTE the effect and assert real counter state on each instance.
 */

function makeDef(
  id: string,
  name: string,
  type_line: string,
  card_types: string[],
): CardDefinition {
  return {
    id,
    name,
    type_line,
    oracle_text: '',
    mana_cost: '{1}',
    cmc: 1,
    colors: [],
    color_identity: [],
    keywords: [],
    card_types,
    power: 2,
    toughness: 2,
  } as CardDefinition;
}

function makeCard(
  instanceId: string,
  definitionId: string,
  ownerId: string,
  counters: Record<string, number> = {},
): CardInstance {
  return {
    instanceId,
    definitionId,
    ownerId,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: { ...counters },
    damage: 0,
    isCommander: false,
  } as CardInstance;
}

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  cardDefinitions.set('def-cre', makeDef('def-cre', 'Bear', 'Creature — Bear', ['creature']));
  cardDefinitions.set('def-land', makeDef('def-land', 'Forest', 'Basic Land — Forest', ['land']));

  // player-1: 2 creatures (one already carrying a +1/+1 counter) + 1 land
  cards.set('p1-cre-a', makeCard('p1-cre-a', 'def-cre', 'player-1'));
  cards.set('p1-cre-b', makeCard('p1-cre-b', 'def-cre', 'player-1', { '+1/+1': 1 }));
  cards.set('p1-land', makeCard('p1-land', 'def-land', 'player-1'));

  // player-2: 1 creature — must NOT be touched by "each creature you control"
  cards.set('p2-cre', makeCard('p2-cre', 'def-cre', 'player-2'));

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

const plus = (s: GameState, id: string) => s.cards.get(id)!.counters['+1/+1'] ?? 0;

describe('ms-mass-counters: parse', () => {
  it('"Put a +1/+1 counter on each creature you control." → AddCounters / AllCreaturesYouControl', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on each creature you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.counterType).toBe('+1/+1');
    expect(e.count).toBe(1);
    expect(e.target).toEqual({ kind: 'AllCreaturesYouControl' });
  });

  it('"Put a +1/+1 counter on each creature." → AddCounters / AllCreatures', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on each creature.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const e = parsed.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.target).toEqual({ kind: 'AllCreatures' });
    expect(e.count).toBe(1);
  });

  it('"Put two +1/+1 counters on each creature you control." → count 2 / AllCreaturesYouControl', () => {
    const parsed = parseOracleText('Put two +1/+1 counters on each creature you control.');
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const e = parsed.effects[0] as Extract<Effect, { kind: 'AddCounters' }>;
    expect(e.kind).toBe('AddCounters');
    expect(e.count).toBe(2);
    expect(e.target).toEqual({ kind: 'AllCreaturesYouControl' });
  });
});

describe('ms-mass-counters: execute', () => {
  it('each creature you control: adds +1/+1 to ALL own creatures, stacks on existing, skips opponent + non-creatures', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on each creature you control.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const r = executeEffects(makeState(), parsed.effects, 'player-1', [], []);

    expect(plus(r, 'p1-cre-a')).toBe(1);          // own creature gains 1
    expect(plus(r, 'p1-cre-b')).toBe(2);          // own creature: 1 existing + 1 = 2 (stacked)
    expect(plus(r, 'p2-cre')).toBe(0);            // opponent's creature untouched
    expect(r.cards.get('p1-land')!.counters['+1/+1'] ?? 0).toBe(0); // non-creature untouched
  });

  it('each creature (no controller restriction): adds +1/+1 to EVERY creature, both players', () => {
    const parsed = parseOracleText('Put a +1/+1 counter on each creature.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const r = executeEffects(makeState(), parsed.effects, 'player-1', [], []);

    expect(plus(r, 'p1-cre-a')).toBe(1);
    expect(plus(r, 'p1-cre-b')).toBe(2);          // stacked onto existing
    expect(plus(r, 'p2-cre')).toBe(1);            // opponent's creature ALSO gains
    expect(r.cards.get('p1-land')!.counters['+1/+1'] ?? 0).toBe(0); // land never a creature
  });

  it('N counters: "Put two +1/+1 counters on each creature you control." adds 2 to each own creature', () => {
    const parsed = parseOracleText('Put two +1/+1 counters on each creature you control.');
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const r = executeEffects(makeState(), parsed.effects, 'player-1', [], []);

    expect(plus(r, 'p1-cre-a')).toBe(2);          // 0 + 2
    expect(plus(r, 'p1-cre-b')).toBe(3);          // 1 + 2
    expect(plus(r, 'p2-cre')).toBe(0);            // opponent untouched
  });
});
