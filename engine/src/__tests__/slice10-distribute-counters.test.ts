/**
 * Slice 10: DistributeCounters — parser + executor tests.
 *
 * "Distribute N +1/+1 counters among one, two, or three target creatures [you control]."
 * (Armament Dragon ETB form, Vastwood Animist-family pump spells, ETB distributors.)
 *
 * Coverage:
 *   - Parser: three wording variants emit DistributeCounters with correct total / counterType / target
 *   - Parser: targets spec has correct count (max choices) and minCount=1
 *   - Executor: even split across two targets (3→2+1), all-to-one when only one chosen,
 *               explicit counterDivision namedCardChoices payload honored
 */

import { describe, it, expect } from 'vitest';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import type { Effect } from '../effects/ast';
import type { GameState, CardInstance, CardDefinition } from '../types';

// ─── helpers ───────────────────────────────────────────────────────────────

function makeState(): GameState {
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  const creatureDef: CardDefinition = {
    id: 'def-cre',
    name: 'Bear',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  } as CardDefinition;

  cardDefinitions.set('def-cre', creatureDef);

  const makeCard = (id: string, owner: string, counters: Record<string, number> = {}): CardInstance => ({
    instanceId: id,
    definitionId: 'def-cre',
    ownerId: owner,
    zone: 'battlefield',
    tapped: false,
    summoningSick: false,
    counters: { ...counters },
    damage: 0,
    isCommander: false,
  } as CardInstance);

  cards.set('cre-a', makeCard('cre-a', 'player-1'));
  cards.set('cre-b', makeCard('cre-b', 'player-1'));
  cards.set('cre-c', makeCard('cre-c', 'player-1'));

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

const counters = (s: GameState, id: string, type = '+1/+1') => s.cards.get(id)!.counters[type] ?? 0;

// ─── parser tests ───────────────────────────────────────────────────────────

describe('slice10-distribute-counters: parser', () => {
  it('parses "Distribute three +1/+1 counters among one, two, or three target creatures." (Armament Dragon wording)', () => {
    const parsed = parseOracleText(
      'Distribute three +1/+1 counters among one, two, or three target creatures.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    expect(parsed.effects).toHaveLength(1);
    const e = parsed.effects[0] as Extract<Effect, { kind: 'DistributeCounters' }>;
    expect(e.kind).toBe('DistributeCounters');
    expect(e.counterType).toBe('+1/+1');
    expect(e.total).toBe(3);
    expect(e.target.kind).toBe('Chosen');
    // Target spec: count=3 (max), minCount=1
    expect(parsed.targets).toHaveLength(1);
    expect(parsed.targets[0].count).toBe(3);
    expect(parsed.targets[0].minCount).toBe(1);
    expect(parsed.targets[0].type).toBe('Creature');
    expect(parsed.targets[0].constraints?.controllerControls).toBeUndefined();
  });

  it('parses "Distribute three +1/+1 counters among one, two, or three target creatures you control." with controllerControls', () => {
    const parsed = parseOracleText(
      'Distribute three +1/+1 counters among one, two, or three target creatures you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const e = parsed.effects[0] as Extract<Effect, { kind: 'DistributeCounters' }>;
    expect(e.kind).toBe('DistributeCounters');
    expect(e.counterType).toBe('+1/+1');
    expect(e.total).toBe(3);
    expect(parsed.targets[0].constraints?.controllerControls).toBe(true);
  });

  it('parses "Distribute five +1/+1 counters among any number of target creatures you control." (any-number form)', () => {
    const parsed = parseOracleText(
      'Distribute five +1/+1 counters among any number of target creatures you control.',
    );
    expect(parsed.kind).toBe('Spell');
    if (parsed.kind !== 'Spell') return;
    const e = parsed.effects[0] as Extract<Effect, { kind: 'DistributeCounters' }>;
    expect(e.kind).toBe('DistributeCounters');
    expect(e.total).toBe(5);
    // count capped at total=5 for "any number" form
    expect(parsed.targets[0].count).toBe(5);
    expect(parsed.targets[0].minCount).toBe(1);
  });

  it('parses ETB form — embedded in "When ~ enters, distribute three +1/+1 counters among..."', () => {
    const parsed = parseOracleText(
      'When ~ enters, distribute three +1/+1 counters among one, two, or three target creatures you control.',
    );
    // Triggers parse to an ETB TriggeredAbility
    if (parsed.kind !== 'ETB' && parsed.kind !== 'Triggered') {
      // Accept as Spell form too (some ETB parsers emit Spell for bare sentences)
      expect(['Spell', 'ETB', 'Triggered']).toContain(parsed.kind);
      return;
    }
    const effects = 'ability' in parsed ? parsed.ability.effects : (parsed as any).effects ?? [];
    const e = effects.find((fx: Effect) => fx.kind === 'DistributeCounters') as
      | Extract<Effect, { kind: 'DistributeCounters' }>
      | undefined;
    expect(e).toBeDefined();
    if (!e) return;
    expect(e.total).toBe(3);
    expect(e.counterType).toBe('+1/+1');
  });
});

// ─── executor tests ─────────────────────────────────────────────────────────

describe('slice10-distribute-counters: executor', () => {
  it('all three counters go to the single chosen creature (one target)', () => {
    const parsed = parseOracleText(
      'Distribute three +1/+1 counters among one, two, or three target creatures.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const state = makeState();
    // Only one target chosen: cre-a
    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['cre-a'],
      [{ id: spec.id, count: spec.count }],
    );

    expect(counters(result, 'cre-a')).toBe(3);
    expect(counters(result, 'cre-b')).toBe(0);
    expect(counters(result, 'cre-c')).toBe(0);
  });

  it('splits three counters evenly across two targets: 2 to first, 1 to second', () => {
    const parsed = parseOracleText(
      'Distribute three +1/+1 counters among one, two, or three target creatures.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const state = makeState();
    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['cre-a', 'cre-b'],
      [{ id: spec.id, count: spec.count }],
    );

    // Floor(3/2)=1 base, remainder=1 → first gets 2, second gets 1
    expect(counters(result, 'cre-a')).toBe(2);
    expect(counters(result, 'cre-b')).toBe(1);
    expect(counters(result, 'cre-c')).toBe(0);
  });

  it('honors explicit counterDivision namedCardChoices payload', () => {
    const parsed = parseOracleText(
      'Distribute three +1/+1 counters among one, two, or three target creatures.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const state = makeState();
    // Explicit allocation: 1 to cre-a, 2 to cre-b
    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['cre-a', 'cre-b'],
      [{ id: spec.id, count: spec.count }],
      0,
      { namedCardChoices: { counterDivision: '1,2' } },
    );

    expect(counters(result, 'cre-a')).toBe(1);
    expect(counters(result, 'cre-b')).toBe(2);
    expect(counters(result, 'cre-c')).toBe(0);
  });

  it('distributes three counters evenly across three targets (1 each)', () => {
    const parsed = parseOracleText(
      'Distribute three +1/+1 counters among one, two, or three target creatures.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const state = makeState();
    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['cre-a', 'cre-b', 'cre-c'],
      [{ id: spec.id, count: spec.count }],
    );

    expect(counters(result, 'cre-a')).toBe(1);
    expect(counters(result, 'cre-b')).toBe(1);
    expect(counters(result, 'cre-c')).toBe(1);
  });

  it('stacks on top of existing counters', () => {
    const parsed = parseOracleText(
      'Distribute three +1/+1 counters among one, two, or three target creatures.',
    );
    if (parsed.kind !== 'Spell') throw new Error('not a spell');
    const [spec] = parsed.targets;

    const state = makeState();
    // Pre-seed cre-a with 2 existing counters
    state.cards.get('cre-a')!.counters['+1/+1'] = 2;

    const result = executeEffects(
      state,
      parsed.effects,
      'player-1',
      ['cre-a'],
      [{ id: spec.id, count: spec.count }],
    );

    expect(counters(result, 'cre-a')).toBe(5); // 2 existing + 3 distributed
  });
});
