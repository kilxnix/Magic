import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

const cdef: CardDefinition = { id: 'c', name: 'C', type_line: 'Creature — X', oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 4, toughness: 4 };

function st(cards: CardInstance[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])), cardDefinitions: new Map([['c', cdef]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}
const mk = (id: string): CardInstance => ({ instanceId: id, definitionId: 'c', ownerId: 'p0', zone: 'battlefield', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });

describe('GainLife dynamic amounts', () => {
  it('gain life equal to its power (source)', () => {
    const p = parseOracleText('You gain life equal to its power.');
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(st([mk('src')]), p.effects, 'p0', [], [], 0, { sourceInstanceId: 'src' });
    expect(s.players[0].life).toBe(44); // 40 + 4
  });

  it('gain life equal to the number of creatures you control', () => {
    const p = parseOracleText('You gain life equal to the number of creatures you control.');
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(st([mk('a'), mk('b'), mk('c2')]), p.effects, 'p0', [], []);
    expect(s.players[0].life).toBe(43); // 40 + 3
  });
});
