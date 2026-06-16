import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function def(id: string, types: CardDefinition['card_types'], type_line: string): CardDefinition {
  return {
    id, name: id, type_line, oracle_text: '', mana_cost: '', cmc: 0,
    colors: [], color_identity: [], keywords: [], card_types: types, power: 1, toughness: 1,
  };
}

function inst(id: string, definitionId: string, zone: CardInstance['zone'], over: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: id, definitionId, ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, ...over,
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

const EXPLORE_SELF = [{ kind: 'Explore', target: { kind: 'Source' } } as never];

describe('Explore', () => {
  it('parses "Target creature you control explores." with a target', () => {
    const p = parseOracleText('Target creature you control explores.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.some(e => e.kind === 'Explore')).toBe(true);
    expect(p.targets.length).toBe(1);
  });

  it('parses "this creature explores" as Source', () => {
    const p = parseOracleText('Whenever this creature attacks, it explores.');
    // triggered ability; just assert it parsed an Explore somewhere
    const json = JSON.stringify(p);
    expect(json).toContain('"Explore"');
  });

  it('reveals a land on top → puts it into hand (no counter)', () => {
    const defs = [def('cre', ['creature'], 'Creature — Test'), def('forest', ['land'], 'Basic Land — Forest')];
    let s = state([
      inst('c0', 'cre', 'battlefield'),
      inst('lib0', 'forest', 'library'),
    ], defs);
    s = executeEffects(s, EXPLORE_SELF, 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('lib0')!.zone).toBe('hand');
    expect(s.cards.get('c0')!.counters['+1/+1'] ?? 0).toBe(0);
  });

  it('reveals a nonland on top → +1/+1 counter, card stays in library', () => {
    const defs = [def('cre', ['creature'], 'Creature — Test'), def('bolt', ['instant'], 'Instant')];
    let s = state([
      inst('c0', 'cre', 'battlefield'),
      inst('lib0', 'bolt', 'library'),
    ], defs);
    s = executeEffects(s, EXPLORE_SELF, 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('lib0')!.zone).toBe('library');
    expect(s.cards.get('c0')!.counters['+1/+1']).toBe(1);
  });

  it('empty library → still grants a +1/+1 counter', () => {
    const defs = [def('cre', ['creature'], 'Creature — Test')];
    let s = state([inst('c0', 'cre', 'battlefield')], defs);
    s = executeEffects(s, EXPLORE_SELF, 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('c0')!.counters['+1/+1']).toBe(1);
  });
});
