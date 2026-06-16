import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';
import { advanceStep } from '../turn-manager';
import { resolveCombatDamage } from '../combat';

function creatureDef(): CardDefinition {
  return {
    id: 'cdef', name: 'Knight', type_line: 'Creature — Knight', oracle_text: '',
    mana_cost: '{2}', cmc: 2, colors: [], color_identity: [],
    keywords: [], card_types: ['creature'], power: 3, toughness: 3,
  };
}

function inst(id: string, ownerId: string, zone: CardInstance['zone'], over: Partial<CardInstance> = {}): CardInstance {
  return {
    instanceId: id, definitionId: 'cdef', ownerId, zone,
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, ...over,
  };
}

function baseState(cards: CardInstance[], over: Partial<GameState> = {}): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map([['cdef', creatureDef()]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'begin_combat', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
    ...over,
  };
}

describe('Monarch', () => {
  it('parses "You become the monarch." and sets monarchId on the caster', () => {
    const p = parseOracleText('You become the monarch.');
    expect(p.kind).toBe('Spell');
    if (p.kind !== 'Spell') return;
    expect(p.effects.some(e => e.kind === 'BecomeMonarch')).toBe(true);
    const s = executeEffects(baseState([]), p.effects, 'p0', [], []);
    expect(s.monarchId).toBe('p0');
  });

  it('the monarch draws a card at the beginning of their end step', () => {
    // p0 is active and the monarch, with a card in library; advance into the end step.
    let s = baseState(
      [inst('lib0', 'p0', 'library')],
      { monarchId: 'p0', activePlayerIndex: 0, phase: 'postcombat_main', step: 'end_of_combat' },
    );
    const handBefore = [...s.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'hand').length;
    s = advanceStep(s); // → end step
    expect(s.step).toBe('end');
    const handAfter = [...s.cards.values()].filter(c => c.ownerId === 'p0' && c.zone === 'hand').length;
    expect(handAfter).toBe(handBefore + 1);
  });

  it('dealing combat damage to the monarch transfers the crown to the attacker', () => {
    // p0 is the monarch; p1 attacks p0 with an unblocked 3/3.
    const attacker = inst('atk', 'p1', 'battlefield');
    let s = baseState([attacker], {
      monarchId: 'p0',
      activePlayerIndex: 1,
      phase: 'combat', step: 'combat_damage',
      combat: { attackers: [{ cardInstanceId: 'atk', defendingPlayerId: 'p0' }], blockers: [], damageAssignment: new Map() },
    });
    s = resolveCombatDamage(s);
    expect(s.monarchId).toBe('p1');
  });
});
