import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

const cdef: CardDefinition = { id: 'c', name: 'C', type_line: 'Creature — X', oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 1, toughness: 1 };
const land: CardDefinition = { id: 'l', name: 'L', type_line: 'Basic Land — Forest', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: [], keywords: [], card_types: ['land'] };

it('draw cards equal to the number of creatures you control', () => {
  const cards = new Map<string, CardInstance>();
  const mk = (id: string, defId: string, zone: CardInstance['zone']): CardInstance => ({ instanceId: id, definitionId: defId, ownerId: 'p0', zone, tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
  cards.set('a', mk('a', 'c', 'battlefield'));
  cards.set('b', mk('b', 'c', 'battlefield'));
  for (let i = 0; i < 5; i++) cards.set(`lib${i}`, mk(`lib${i}`, 'l', 'library'));
  const s: GameState = { players: [createPlayer('p0','P0'), createPlayer('p1','P1')], cards, cardDefinitions: new Map([['c', cdef], ['l', land]]), activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2, hasPriorityPassed: [false,false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [] };
  const p = parseOracleText('Draw cards equal to the number of creatures you control.');
  if (p.kind !== 'Spell') throw new Error('x');
  const after = executeEffects(s, p.effects, 'p0', [], []);
  const hand = [...after.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'hand').length;
  expect(hand).toBe(2); // 2 creatures → drew 2
});
