import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

function state(): GameState {
  const def: CardDefinition = {
    id: 'd', name: 'X', type_line: 'Creature — Test', oracle_text: '', mana_cost: '{1}', cmc: 1,
    colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 2, toughness: 2,
  };
  const mk = (id: string, owner: string): CardInstance => ({
    instanceId: id, definitionId: 'd', ownerId: owner, zone: 'battlefield',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  });
  return {
    players: [createPlayer('p0', 'P0'), createPlayer('p1', 'P1')],
    cards: new Map([['src', mk('src', 'p0')], ['evt', mk('evt', 'p1')]]),
    cardDefinitions: new Map([['d', def]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

describe('"that creature" (EventCreature) targeting', () => {
  it('destroys the triggering-event creature when event context is present', () => {
    const p = parseOracleText('Destroy that creature.');
    if (p.kind !== 'Spell') throw new Error('expected spell');
    const after = executeEffects(state(), p.effects, 'p0', [], [], 0, {
      sourceInstanceId: 'src',
      eventContext: { cardInstanceId: 'evt' },
    });
    expect(after.cards.get('evt')!.zone).toBe('graveyard');
    expect(after.cards.get('src')!.zone).toBe('battlefield'); // source untouched
  });

  it('taps the event creature', () => {
    const p = parseOracleText('Tap that creature.');
    if (p.kind !== 'Spell') throw new Error('expected spell');
    const after = executeEffects(state(), p.effects, 'p0', [], [], 0, {
      sourceInstanceId: 'src',
      eventContext: { cardInstanceId: 'evt' },
    });
    expect(after.cards.get('evt')!.tapped).toBe(true);
  });

  it('exiles the event creature', () => {
    const p = parseOracleText('Exile that creature.');
    if (p.kind !== 'Spell') throw new Error('expected spell');
    const after = executeEffects(state(), p.effects, 'p0', [], [], 0, {
      sourceInstanceId: 'src',
      eventContext: { cardInstanceId: 'evt' },
    });
    expect(after.cards.get('evt')!.zone).toBe('exile');
  });

  it('safely no-ops when there is no event context (no crash)', () => {
    const p = parseOracleText('Destroy that creature.');
    if (p.kind !== 'Spell') throw new Error('expected spell');
    const after = executeEffects(state(), p.effects, 'p0', [], []);
    expect(after.cards.get('evt')!.zone).toBe('battlefield');
  });
});

describe('more "that creature" verbs (EventCreature)', () => {
  it('bounce / counter / goad that creature with event context', () => {
    const def: any = { id: 'd', name: 'X', type_line: 'Creature — Test', oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };
    const mk = (id: string, owner: string): any => ({ instanceId: id, definitionId: 'd', ownerId: owner, zone: 'battlefield', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    const base = () => ({ players: [createPlayer('p0','P0'), createPlayer('p1','P1')], cards: new Map([['src', mk('src','p0')], ['evt', mk('evt','p1')]]), cardDefinitions: new Map([['d', def]]), activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2, hasPriorityPassed: [false,false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [] } as any);
    const ec = { sourceInstanceId: 'src', eventContext: { cardInstanceId: 'evt' } };
    const ret = parseOracleText("Return that creature to its owner's hand."); if (ret.kind !== 'Spell') throw new Error('x');
    expect(executeEffects(base(), ret.effects, 'p0', [], [], 0, ec).cards.get('evt').zone).toBe('hand');
    const ctr = parseOracleText('Put a +1/+1 counter on that creature.'); if (ctr.kind !== 'Spell') throw new Error('x');
    expect(executeEffects(base(), ctr.effects, 'p0', [], [], 0, ec).cards.get('evt').counters['+1/+1']).toBe(1);
    const g = parseOracleText('Goad that creature.'); if (g.kind !== 'Spell') throw new Error('x');
    expect(executeEffects(base(), g.effects, 'p0', [], [], 0, ec).cards.get('evt').goadedBy).toContain('p0');
  });
});

describe('deal damage to "that creature"', () => {
  it('damages the event creature, no-op without context', () => {
    const def: any = { id: 'd', name: 'X', type_line: 'Creature — Test', oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };
    const mk = (id: string, owner: string): any => ({ instanceId: id, definitionId: 'd', ownerId: owner, zone: 'battlefield', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    const base = () => ({ players: [createPlayer('p0','P0'), createPlayer('p1','P1')], cards: new Map([['src', mk('src','p0')], ['evt', mk('evt','p1')]]), cardDefinitions: new Map([['d', def]]), activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2, hasPriorityPassed: [false,false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [] } as any);
    const p = parseOracleText('This creature deals 2 damage to that creature.');
    if (p.kind !== 'Spell') throw new Error('x');
    const withCtx = executeEffects(base(), p.effects, 'p0', [], [], 0, { sourceInstanceId: 'src', eventContext: { cardInstanceId: 'evt' } });
    expect(withCtx.cards.get('evt').damage).toBe(2);
    const noCtx = executeEffects(base(), p.effects, 'p0', [], []);
    expect(noCtx.cards.get('evt').damage).toBe(0); // safe no-op
  });
});

describe('"that player" (EventPlayer) discard', () => {
  it('event player discards with context; safe no-op without context', () => {
    const def: any = { id: 'i', name: 'I', type_line: 'Instant', oracle_text: '', mana_cost: '{1}', cmc: 1, colors: [], color_identity: [], keywords: [], card_types: ['instant'] };
    const base = () => ({ players: [createPlayer('p0','P0'), createPlayer('p1','P1')], cards: new Map([['h0', { instanceId: 'h0', definitionId: 'i', ownerId: 'p1', zone: 'hand', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false }]]), cardDefinitions: new Map([['i', def]]), activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 1, hasPriorityPassed: [false,false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [] } as any);
    const p = parseOracleText('That player discards a card.'); if (p.kind !== 'Spell') throw new Error('x');
    // Slice 8/12: "that player" now resolves via EventPlayer (eventPlayerId).
    // For SpellCast events casterId == eventPlayerId; for upkeep triggers only eventPlayerId is set.
    expect(executeEffects(base(), p.effects, 'p0', [], [], 0, { eventContext: { casterId: 'p1', eventPlayerId: 'p1' } }).cards.get('h0').zone).toBe('graveyard');
    // no eventContext → no crash, no discard
    expect(executeEffects(base(), p.effects, 'p0', [], []).cards.get('h0').zone).toBe('hand');
  });
});
