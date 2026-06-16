import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function cdef(): CardDefinition {
  return {
    id: 'd44', name: 'Beast', type_line: 'Creature — Beast', oracle_text: '', mana_cost: '{4}', cmc: 4,
    colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 4, toughness: 4,
  };
}
function inst(over: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: 'c0', definitionId: 'd44', ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, ...over,
  };
}
function state(c: CardInstance): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([[c.instanceId, c]]),
    cardDefinitions: new Map([['d44', cdef()]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

describe('Monstrosity', () => {
  it('parses "Monstrosity 3."', () => {
    const p = parseOracleText('Monstrosity 3.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const m = p.effects.find(e => e.kind === 'Monstrosity');
    expect(m && (m as { count?: number }).count).toBe(3);
  });

  it('adds counters and marks the creature monstrous', () => {
    let s = state(inst());
    s = executeEffects(s, [{ kind: 'Monstrosity', count: 3 } as never], 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('c0')!.counters['+1/+1']).toBe(3);
    expect(s.cards.get('c0')!.monstrous).toBe(true);
  });

  it('does nothing if already monstrous', () => {
    let s = state(inst({ monstrous: true }));
    s = executeEffects(s, [{ kind: 'Monstrosity', count: 3 } as never], 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('c0')!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
