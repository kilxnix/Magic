import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

const beast: CardDefinition = {
  id: 'beast', name: 'Beast', type_line: 'Creature — Beast', oracle_text: '',
  mana_cost: '{3}{G}', cmc: 4, colors: ['G'], color_identity: ['G'], keywords: [], card_types: ['creature'], power: 3, toughness: 3,
};

function state(over: Partial<CardInstance> = {}): GameState {
  const dead: CardInstance = {
    instanceId: 'gy', definitionId: 'beast', ownerId: 'p0', zone: 'graveyard',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, ...over,
  };
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([['gy', dead]]), cardDefinitions: new Map([['beast', beast]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 4,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

describe('reanimation / control via "put ... onto the battlefield"', () => {
  it('reanimates a creature card from your graveyard onto the battlefield', () => {
    const p = parseOracleText('Put target creature card from your graveyard onto the battlefield.');
    if (p.kind !== 'Spell') throw new Error('x');
    const s = executeEffects(state(), p.effects, 'p0', ['gy'], p.targets);
    expect(s.cards.get('gy')!.zone).toBe('battlefield');
  });

  it('reanimates from a graveyard under your control', () => {
    const p = parseOracleText('Put target creature card from a graveyard onto the battlefield under your control.');
    if (p.kind !== 'Spell') throw new Error('x');
    const dead = state();
    // dead creature owned by opponent p1, reanimated under p0's control
    dead.cards.set('gy', { ...dead.cards.get('gy')!, ownerId: 'p1' });
    const s = executeEffects(dead, p.effects, 'p0', ['gy'], p.targets);
    expect(s.cards.get('gy')!.zone).toBe('battlefield');
  });
});

describe('gain control of "it"/"that creature" (EventCreature)', () => {
  it('gains control of the event creature with context; safe no-op without', () => {
    const def: CardDefinition = { ...beast, id: 'd' };
    const mk = (id: string, owner: string): CardInstance => ({ instanceId: id, definitionId: 'd', ownerId: owner, zone: 'battlefield', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    const base = () => ({ players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')], cards: new Map([['evt', mk('evt', 'p1')]]), cardDefinitions: new Map([['d', def]]), activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 4, hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [] } as GameState);
    const p = parseOracleText('Gain control of that creature.');
    if (p.kind !== 'Spell') throw new Error('x');
    const got = executeEffects(base(), p.effects, 'p0', [], [], 0, { eventContext: { cardInstanceId: 'evt' } });
    expect(got.cards.get('evt')!.ownerId === 'p0' || (got.cards.get('evt') as { controllerId?: string }).controllerId === 'p0').toBe(true);
    // no crash without context
    expect(() => executeEffects(base(), p.effects, 'p0', [], [])).not.toThrow();
  });
});
