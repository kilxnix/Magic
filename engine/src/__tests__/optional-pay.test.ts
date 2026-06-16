import { describe, it, expect } from 'vitest';
import type { GameState, CardDefinition, CardInstance } from '../types';
import { createPlayer } from '../types';
import { parseOracleText } from '../effects/parser';
import { executeEffects } from '../effects/executor';

const forestDef: CardDefinition = {
  id: 'forest', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '{T}: Add {G}.',
  mana_cost: '', cmc: 0, colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
};

function stateWith(landCount: number, life = 40): GameState {
  const cards = new Map<string, CardInstance>();
  for (let i = 0; i < landCount; i++) {
    cards.set(`L${i}`, {
      instanceId: `L${i}`, definitionId: 'forest', ownerId: 'p0', zone: 'battlefield',
      tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
    });
  }
  const p0 = { ...createPlayer('p0', 'P0'), life };
  return {
    players: [p0, createPlayer('p1', 'P1')],
    cards, cardDefinitions: new Map([['forest', forestDef]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2,
    hasPriorityPassed: [false, false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [],
  };
}

function handSize(s: GameState, owner: string): number {
  return [...s.cards.values()].filter(c => c.ownerId === owner && c.zone === 'hand').length;
}

describe('OptionalPay (you may pay X. if you do, EFFECT.)', () => {
  it('mana: pays by tapping lands and applies the effect when affordable', () => {
    const p = parseOracleText('You may pay {2}. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error('x');
    // give the player a library card so draw is observable
    let s = stateWith(3);
    s.cards.set('lib', { instanceId: 'lib', definitionId: 'forest', ownerId: 'p0', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    const before = handSize(s, 'p0');
    s = executeEffects(s, p.effects, 'p0', [], []);
    const tapped = [...s.cards.values()].filter(c => c.zone === 'battlefield' && c.tapped).length;
    expect(tapped).toBe(2); // paid {2} by tapping two lands
    expect(handSize(s, 'p0')).toBe(before + 1); // drew the card
  });

  it('mana: does NOT apply the effect (or pay) when unaffordable', () => {
    const p = parseOracleText('You may pay {2}. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error('x');
    let s = stateWith(1); // only 1 land, cost is 2
    s.cards.set('lib', { instanceId: 'lib', definitionId: 'forest', ownerId: 'p0', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    const before = handSize(s, 'p0');
    s = executeEffects(s, p.effects, 'p0', [], []);
    expect([...s.cards.values()].filter(c => c.zone === 'battlefield' && c.tapped).length).toBe(0);
    expect(handSize(s, 'p0')).toBe(before); // no free draw
  });

  it('life: pays life and applies the effect when above the safety buffer', () => {
    const p = parseOracleText('You may pay 3 life. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error('x');
    let s = stateWith(0, 40);
    s.cards.set('lib', { instanceId: 'lib', definitionId: 'forest', ownerId: 'p0', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    s = executeEffects(s, p.effects, 'p0', [], []);
    expect(s.players[0].life).toBe(37);
    expect(handSize(s, 'p0')).toBe(1);
  });

  it('life: refuses to pay when it would drop below the safety buffer', () => {
    const p = parseOracleText('You may pay 3 life. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error('x');
    let s = stateWith(0, 6); // 6 - 3 = 3 < 5 buffer → won't pay
    s.cards.set('lib', { instanceId: 'lib', definitionId: 'forest', ownerId: 'p0', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    s = executeEffects(s, p.effects, 'p0', [], []);
    expect(s.players[0].life).toBe(6); // unchanged
    expect(handSize(s, 'p0')).toBe(0); // no draw
  });
});

describe('OptionalPay sacrifice/discard costs', () => {
  function tokenCreatureState() {
    const def: any = { id: 'goblin', name: 'Goblin', type_line: 'Token Creature — Goblin', oracle_text: '', mana_cost: '', cmc: 0, colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 1, toughness: 1 };
    const real: any = { id: 'bear', name: 'Bear', type_line: 'Creature — Bear', oracle_text: '', mana_cost: '{2}', cmc: 2, colors: [], color_identity: [], keywords: [], card_types: ['creature'], power: 2, toughness: 2 };
    const cards = new Map<string, any>();
    const s: any = { players: [createPlayer('p0','P0'), createPlayer('p1','P1')], cards, cardDefinitions: new Map([['goblin', def], ['bear', real], ['forest', forestDef]]), activePlayerIndex: 0, priorityPlayerIndex: 0, phase: 'precombat_main', step: 'begin_combat', turnNumber: 2, hasPriorityPassed: [false,false], stack: [], combat: null, battlefieldAbilities: new Map(), pendingTriggers: [] };
    return s;
  }

  it('sacrifice: declines (no-op) when only a real creature is available', () => {
    const p = parseOracleText('You may sacrifice a creature. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error('x');
    const s = tokenCreatureState();
    s.cards.set('b0', { instanceId: 'b0', definitionId: 'bear', ownerId: 'p0', zone: 'battlefield', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    s.cards.set('lib', { instanceId: 'lib', definitionId: 'forest', ownerId: 'p0', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    const after = executeEffects(s, p.effects, 'p0', [], []);
    expect(after.cards.get('b0')!.zone).toBe('battlefield'); // real creature kept
    expect([...after.cards.values()].filter(c => c.ownerId==='p0' && c.zone==='hand').length).toBe(0);
  });

  it('sacrifice: pays with an expendable token and applies the effect', () => {
    const p = parseOracleText('You may sacrifice a creature. If you do, draw a card.');
    if (p.kind !== 'Spell') throw new Error('x');
    const s = tokenCreatureState();
    s.cards.set('t0', { instanceId: 't0', definitionId: 'goblin', ownerId: 'p0', zone: 'battlefield', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false, isToken: true });
    s.cards.set('lib', { instanceId: 'lib', definitionId: 'forest', ownerId: 'p0', zone: 'library', tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false });
    const after = executeEffects(s, p.effects, 'p0', [], []);
    const tokenGone = !after.cards.get('t0') || after.cards.get('t0')!.zone !== 'battlefield';
    expect(tokenGone).toBe(true);
    expect([...after.cards.values()].filter(c => c.ownerId==='p0' && c.zone==='hand').length).toBe(1);
  });
});
