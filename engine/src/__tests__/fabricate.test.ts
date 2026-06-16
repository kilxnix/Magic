import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { typeLineHasSubtype } from '../type-line';

function cdef(): CardDefinition {
  return {
    id: 'd22', name: 'Construct', type_line: 'Artifact Creature — Construct', oracle_text: '', mana_cost: '{3}', cmc: 3,
    colors: [], color_identity: [], keywords: [], card_types: ['artifact', 'creature'], power: 2, toughness: 2,
  };
}
function state(cards: CardInstance[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map([['d22', cdef()]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}
function inst(): CardInstance {
  return {
    instanceId: 'c0', definitionId: 'd22', ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}

describe('Fabricate', () => {
  it('parses "Fabricate 2."', () => {
    const p = parseOracleText('Fabricate 2.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.some(e => e.kind === 'Fabricate')).toBe(true);
  });

  it('puts counters on the source creature (counters mode)', () => {
    let s = state([inst()]);
    s = executeEffects(s, [{ kind: 'Fabricate', count: 2 } as never], 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('c0')!.counters['+1/+1']).toBe(2);
  });

  it('creates Servo tokens when the source is gone', () => {
    let s = state([]);
    s = executeEffects(s, [{ kind: 'Fabricate', count: 3 } as never], 'p0', [], []);
    const servos = [...s.cards.values()].filter(c => {
      const def = s.cardDefinitions.get(c.definitionId);
      return def && typeLineHasSubtype(def.type_line, 'servo');
    });
    expect(servos.length).toBe(3);
  });
});
