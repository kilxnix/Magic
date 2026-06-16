import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { executeEffects } from '../effects/executor';
import { registerBattlefieldAbilities } from '../stack';

function cdef(id: string, power: number, toughness: number, keywords: string[] = []): CardDefinition {
  return {
    id, name: id, type_line: 'Creature — Soldier', oracle_text: '', mana_cost: '{2}', cmc: 2,
    colors: [], color_identity: [], keywords, card_types: ['creature'], power, toughness,
  };
}
function inst(id: string, definitionId: string): CardInstance {
  return {
    instanceId: id, definitionId, ownerId: 'p0', zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  };
}
function combatState(cards: CardInstance[], defs: CardDefinition[], attackerIds: string[]): GameState {
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map(cards.map(c => [c.instanceId, c])),
    cardDefinitions: new Map(defs.map(d => [d.id, d])),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'combat', step: 'declare_attackers', turnNumber: 3,
    hasPriorityPassed: [false, false], stack: [],
    combat: { attackers: attackerIds.map(id => ({ cardInstanceId: id, defendingPlayerId: 'p1' })), blockers: [], damageAssignment: new Map() },
    battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

const MENTOR = [{ kind: 'Mentor' } as never];

describe('Mentor', () => {
  it('registers an Attacks trigger with a Mentor effect for a creature with the keyword', () => {
    const def = cdef('mentor', 3, 3, ['Mentor']);
    let s = combatState([inst('m0', 'mentor')], [def], []);
    s = registerBattlefieldAbilities(s, 'm0');
    const abilities = s.battlefieldAbilities.get('m0') ?? [];
    const mentorTrig = abilities.find(a => a.trigger.kind === 'Attacks' && a.effects.some((e: unknown) => (e as { kind?: string }).kind === 'Mentor'));
    expect(mentorTrig).toBeTruthy();
  });

  it('buffs a lesser-power attacking creature', () => {
    const defs = [cdef('mentor', 3, 3, ['Mentor']), cdef('small', 1, 1)];
    let s = combatState([inst('m0', 'mentor'), inst('s0', 'small')], defs, ['m0', 's0']);
    s = executeEffects(s, MENTOR, 'p0', [], [], 0, { sourceInstanceId: 'm0' });
    expect(s.cards.get('s0')!.counters['+1/+1']).toBe(1);
    expect(s.cards.get('m0')!.counters['+1/+1'] ?? 0).toBe(0); // not itself
  });

  it('does not buff an equal-or-greater power attacker', () => {
    const defs = [cdef('mentor', 3, 3, ['Mentor']), cdef('big', 4, 4)];
    let s = combatState([inst('m0', 'mentor'), inst('b0', 'big')], defs, ['m0', 'b0']);
    s = executeEffects(s, MENTOR, 'p0', [], [], 0, { sourceInstanceId: 'm0' });
    expect(s.cards.get('b0')!.counters['+1/+1'] ?? 0).toBe(0);
  });
});
