import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function tokenDef(): CardDefinition {
  return {
    id: 'beast_token', name: 'Beast', type_line: 'Token Creature — Beast', oracle_text: '',
    mana_cost: '', cmc: 0, colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 3, toughness: 3,
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

const POPULATE = [{ kind: 'Populate' } as never];

describe('Populate', () => {
  it('parses "Populate." as a spell effect', () => {
    const p = parseOracleText('Populate.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.some(e => e.kind === 'Populate')).toBe(true);
  });

  it('copies a creature token the caster controls', () => {
    const token: CardInstance = {
      instanceId: 'tok0', definitionId: 'beast_token', ownerId: 'p0', zone: 'battlefield',
      tapped: false, summoningSick: false, counters: { '+1/+1': 2 }, damage: 0, isCommander: false, isToken: true,
    };
    let s = state([token], [tokenDef()]);
    s = executeEffects(s, POPULATE, 'p0', [], []);
    const beasts = [...s.cards.values()].filter(c => c.definitionId === 'beast_token' && c.zone === 'battlefield');
    expect(beasts.length).toBe(2);
    const copy = beasts.find(c => c.instanceId !== 'tok0')!;
    expect(copy.isToken).toBe(true);
    expect(copy.ownerId).toBe('p0');
    expect(copy.counters['+1/+1'] ?? 0).toBe(0); // counters are NOT copied
  });

  it('does nothing if the caster controls no creature token', () => {
    let s = state([], []);
    const before = s.cards.size;
    s = executeEffects(s, POPULATE, 'p0', [], []);
    expect(s.cards.size).toBe(before);
  });

  it('does not copy an opponent\'s token', () => {
    const oppToken: CardInstance = {
      instanceId: 'opp0', definitionId: 'beast_token', ownerId: 'p1', zone: 'battlefield',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, isToken: true,
    };
    let s = state([oppToken], [tokenDef()]);
    s = executeEffects(s, POPULATE, 'p0', [], []);
    const count = [...s.cards.values()].filter(c => c.definitionId === 'beast_token').length;
    expect(count).toBe(1);
  });
});
