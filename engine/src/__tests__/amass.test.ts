import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { typeLineHasSubtype } from '../type-line';

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

describe('Amass', () => {
  it('parses "Amass Orcs 2." with type and count', () => {
    const p = parseOracleText('Amass Orcs 2.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const a = p.effects.find(e => e.kind === 'Amass');
    expect(a && (a as { count?: number }).count).toBe(2);
    expect(a && (a as { armyType?: string }).armyType).toBe('Orc');
  });

  it('creates a 0/0 Army token and adds counters when you control no Army', () => {
    let s = state([], []);
    s = executeEffects(s, [{ kind: 'Amass', count: 2, armyType: 'Zombie' } as never], 'p0', [], []);
    const army = [...s.cards.values()].find(c => {
      const def = s.cardDefinitions.get(c.definitionId);
      return def && typeLineHasSubtype(def.type_line, 'army');
    });
    expect(army).toBeTruthy();
    expect(army!.ownerId).toBe('p0');
    expect(army!.counters['+1/+1']).toBe(2);
  });

  it('adds counters to an existing Army instead of making a new one', () => {
    const armyDef: CardDefinition = {
      id: 'armydef', name: 'Zombie Army', type_line: 'Creature — Zombie Army', oracle_text: '',
      mana_cost: '', cmc: 0, colors: ['B'], color_identity: ['B'], keywords: [], card_types: ['creature'], power: 0, toughness: 0,
    };
    const existing: CardInstance = {
      instanceId: 'army0', definitionId: 'armydef', ownerId: 'p0', zone: 'battlefield',
      tapped: false, summoningSick: false, counters: { '+1/+1': 1 }, damage: 0, isCommander: false,
    };
    let s = state([existing], [armyDef]);
    s = executeEffects(s, [{ kind: 'Amass', count: 3 } as never], 'p0', [], []);
    // no new army created
    const armies = [...s.cards.values()].filter(c => {
      const def = s.cardDefinitions.get(c.definitionId);
      return def && typeLineHasSubtype(def.type_line, 'army');
    });
    expect(armies.length).toBe(1);
    expect(s.cards.get('army0')!.counters['+1/+1']).toBe(4);
  });
});
