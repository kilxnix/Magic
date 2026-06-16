import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function cdef(id: string, power: number, toughness: number): CardDefinition {
  return {
    id, name: id, type_line: 'Creature — Test', oracle_text: '', mana_cost: '{1}', cmc: 1,
    colors: [], color_identity: [], keywords: [], card_types: ['creature'], power, toughness,
  };
}
function inst(id: string, definitionId: string, counters: Record<string, number> = {}): CardInstance {
  return {
    instanceId: id, definitionId, ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters, damage: 0, isCommander: false,
  };
}
function state(cards: CardInstance[], defs: CardDefinition[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

describe('Adapt', () => {
  it('parses "Adapt 2."', () => {
    const p = parseOracleText('Adapt 2.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const a = p.effects.find(e => e.kind === 'Adapt');
    expect(a && (a as { count?: number }).count).toBe(2);
  });

  it('adds counters when the source has none', () => {
    let s = state([inst('c0', 'd33')], [cdef('d33', 3, 3)]);
    s = executeEffects(s, [{ kind: 'Adapt', count: 2 } as never], 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('c0')!.counters['+1/+1']).toBe(2);
  });

  it('does nothing when the source already has +1/+1 counters', () => {
    let s = state([inst('c0', 'd33', { '+1/+1': 1 })], [cdef('d33', 3, 3)]);
    s = executeEffects(s, [{ kind: 'Adapt', count: 2 } as never], 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('c0')!.counters['+1/+1']).toBe(1);
  });
});

describe('Bolster', () => {
  it('parses "Bolster 1."', () => {
    const p = parseOracleText('Bolster 1.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.some(e => e.kind === 'Bolster')).toBe(true);
  });

  it('adds counters to the least-toughness creature you control', () => {
    let s = state([
      inst('big', 'd55'),
      inst('small', 'd11'),
    ], [cdef('d55', 5, 5), cdef('d11', 1, 1)]);
    s = executeEffects(s, [{ kind: 'Bolster', count: 3 } as never], 'p0', [], []);
    expect(s.cards.get('small')!.counters['+1/+1']).toBe(3);
    expect(s.cards.get('big')!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
