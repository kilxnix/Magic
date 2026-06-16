import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function cdef(): CardDefinition {
  return {
    id: 'cdef', name: 'C', type_line: 'Creature — Test', oracle_text: '',
    mana_cost: '{1}', cmc: 1, colors: [], color_identity: [],
    keywords: [], card_types: ['creature'], power: 1, toughness: 1,
  };
}

function card(id: string, ownerId: string, counters: Record<string, number>): CardInstance {
  return {
    instanceId: id, definitionId: 'cdef', ownerId, zone: 'battlefield',
    tapped: false, summoningSick: false, counters, damage: 0, isCommander: false,
  };
}

function state(cards: CardInstance[]): GameState {
  const p0 = createPlayer('p0', 'P0');
  const p1 = createPlayer('p1', 'P1');
  return {
    players: [p0, p1],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map([['cdef', cdef()]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

const PROLIFERATE = [{ kind: 'Proliferate' } as never];

describe('Proliferate', () => {
  it('parses "Proliferate." as a spell effect', () => {
    const p = parseOracleText('Proliferate.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.some(e => e.kind === 'Proliferate')).toBe(true);
  });

  it("grows the caster's own +1/+1 counters", () => {
    let s = state([card('mine', 'p0', { '+1/+1': 2 })]);
    s = executeEffects(s, PROLIFERATE, 'p0', [], []);
    expect(s.cards.get('mine')!.counters['+1/+1']).toBe(3);
  });

  it("does NOT grow an opponent's +1/+1 counters", () => {
    let s = state([card('theirs', 'p1', { '+1/+1': 2 })]);
    s = executeEffects(s, PROLIFERATE, 'p0', [], []);
    expect(s.cards.get('theirs')!.counters['+1/+1']).toBe(2);
  });

  it("grows detrimental counters on an opponent's permanent", () => {
    let s = state([card('theirs', 'p1', { '-1/-1': 1, 'stun': 1 })]);
    s = executeEffects(s, PROLIFERATE, 'p0', [], []);
    expect(s.cards.get('theirs')!.counters['-1/-1']).toBe(2);
    expect(s.cards.get('theirs')!.counters['stun']).toBe(2);
  });

  it("grows poison on an opponent but not on the caster", () => {
    let s = state([]);
    s = { ...s, players: [
      { ...s.players[0], poisonCounters: 3 },
      { ...s.players[1], poisonCounters: 4 },
    ] };
    s = executeEffects(s, PROLIFERATE, 'p0', [], []);
    expect(s.players[0].poisonCounters).toBe(3); // caster unchanged
    expect(s.players[1].poisonCounters).toBe(5); // opponent grows
  });

  it('does nothing to permanents without counters', () => {
    let s = state([card('plain', 'p0', {})]);
    s = executeEffects(s, PROLIFERATE, 'p0', [], []);
    expect(s.cards.get('plain')!.counters).toEqual({});
  });
});
