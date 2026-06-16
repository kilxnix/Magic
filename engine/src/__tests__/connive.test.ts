import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function def(id: string, types: CardDefinition['card_types'], type_line: string): CardDefinition {
  return {
    id, name: id, type_line, oracle_text: '', mana_cost: '', cmc: 0,
    colors: [], color_identity: [], keywords: [], card_types: types, power: 2, toughness: 2,
  };
}
function inst(id: string, definitionId: string, zone: CardInstance['zone']): CardInstance {
  return {
    instanceId: id, definitionId, ownerId: 'p0', zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
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

const CONNIVE1 = [{ kind: 'Connive', target: { kind: 'Source' }, count: 1 } as never];

describe('Connive', () => {
  it('parses "it connives" inside a trigger', () => {
    const p = parseOracleText('When this creature enters, it connives.');
    expect(JSON.stringify(p)).toContain('"Connive"');
  });

  it('parses "this creature connives 2"', () => {
    const p = parseOracleText('This creature connives 2.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    const c = p.effects.find(e => e.kind === 'Connive');
    expect(c && (c as { count?: number }).count).toBe(2);
  });

  it('discarding a nonland yields a +1/+1 counter', () => {
    const defs = [
      def('cre', ['creature'], 'Creature — Test'),
      def('bolt', ['instant'], 'Instant'),
      def('forest', ['land'], 'Basic Land — Forest'),
    ];
    // hand has the nonland (inserted first → discarded first); library has a land to draw
    let s = state([
      inst('c0', 'cre', 'battlefield'),
      inst('handbolt', 'bolt', 'hand'),
      inst('libland', 'forest', 'library'),
    ], defs);
    s = executeEffects(s, CONNIVE1, 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    // drew the land, discarded the nonland bolt → +1/+1
    expect(s.cards.get('handbolt')!.zone).toBe('graveyard');
    expect(s.cards.get('libland')!.zone).toBe('hand');
    expect(s.cards.get('c0')!.counters['+1/+1']).toBe(1);
  });

  it('discarding only a land yields no counter', () => {
    const defs = [
      def('cre', ['creature'], 'Creature — Test'),
      def('forest', ['land'], 'Basic Land — Forest'),
      def('bolt', ['instant'], 'Instant'),
    ];
    // hand has a land first (discarded), library has a nonland to draw
    let s = state([
      inst('c0', 'cre', 'battlefield'),
      inst('handland', 'forest', 'hand'),
      inst('libbolt', 'bolt', 'library'),
    ], defs);
    s = executeEffects(s, CONNIVE1, 'p0', [], [], 0, { sourceInstanceId: 'c0' });
    expect(s.cards.get('handland')!.zone).toBe('graveyard');
    expect(s.cards.get('c0')!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
