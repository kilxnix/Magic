import { describe, it, expect } from 'vitest';
import { initGameState, getCardsInZone } from './game-state';
import { declareAttackers, declareBlockers, resolveCombatDamage } from './combat';
import { checkStateBasedActions, cleanupDamage } from './state-based';
import { CardDefinition } from './types';

function makeBear(id: string): CardDefinition {
  return {
    id,
    name: 'Grizzly Bears',
    type_line: 'Creature — Bear',
    oracle_text: '',
    mana_cost: '{1}{G}',
    cmc: 2,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 2,
    toughness: 2,
  };
}

function makeGiant(id: string): CardDefinition {
  return {
    id,
    name: 'Hill Giant',
    type_line: 'Creature — Giant',
    oracle_text: '',
    mana_cost: '{3}{R}',
    cmc: 4,
    colors: ['R'],
    color_identity: ['R'],
    keywords: [],
    card_types: ['creature'],
    power: 3,
    toughness: 3,
  };
}

function makeElf(id: string): CardDefinition {
  return {
    id,
    name: 'Llanowar Elves',
    type_line: 'Creature — Elf Druid',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '{G}',
    cmc: 1,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power: 1,
    toughness: 1,
  };
}

describe('Combat Integration', () => {
  it('two bears trade in combat (both die)', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear('b1')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeBear('b2')], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };

    const p1Bear = getCardsInZone(state, 'p1', 'battlefield')[0];
    const p2Bear = getCardsInZone(state, 'p2', 'battlefield')[0];

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: p1Bear.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = declareBlockers(state, 'p2', [
      { cardInstanceId: p2Bear.instanceId, blockingAttackerId: p1Bear.instanceId },
    ]);
    state = resolveCombatDamage(state);
    state = checkStateBasedActions(state);

    expect(state.cards.get(p1Bear.instanceId)!.zone).toBe('graveyard');
    expect(state.cards.get(p2Bear.instanceId)!.zone).toBe('graveyard');
    expect(state.players[1].life).toBe(40); // no player damage
  });

  it('giant kills bear but survives (damage < toughness)', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeGiant('g1')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeBear('b2')], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };

    const giant = getCardsInZone(state, 'p1', 'battlefield')[0];
    const bear = getCardsInZone(state, 'p2', 'battlefield')[0];

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: giant.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = declareBlockers(state, 'p2', [
      { cardInstanceId: bear.instanceId, blockingAttackerId: giant.instanceId },
    ]);
    state = resolveCombatDamage(state);
    state = checkStateBasedActions(state);

    expect(state.cards.get(bear.instanceId)!.zone).toBe('graveyard');
    expect(state.cards.get(giant.instanceId)!.zone).toBe('battlefield');
    expect(state.cards.get(giant.instanceId)!.damage).toBe(2);

    // Damage clears at end of turn
    state = cleanupDamage(state);
    expect(state.cards.get(giant.instanceId)!.damage).toBe(0);
  });

  it('unblocked attacks reduce player life, SBAs check for death', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeGiant('g1')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };
    state.players[1].life = 3;

    const giant = getCardsInZone(state, 'p1', 'battlefield')[0];
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: giant.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = declareBlockers(state, 'p2', []);
    state = resolveCombatDamage(state);

    expect(state.players[1].life).toBe(0);

    state = checkStateBasedActions(state);
    expect(state.players[1].hasLost).toBe(true);
  });

  it('multiplayer: attackers hit different opponents', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear('b1'), makeElf('e1')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [], commanderId: 'cmd3' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };

    const creatures = getCardsInZone(state, 'p1', 'battlefield');
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: creatures[0].instanceId, defendingPlayerId: 'p2' },
      { cardInstanceId: creatures[1].instanceId, defendingPlayerId: 'p3' },
    ]);
    state = declareBlockers(state, 'p2', []);
    state = declareBlockers(state, 'p3', []);
    state = resolveCombatDamage(state);

    expect(state.players[1].life).toBe(38);
    expect(state.players[2].life).toBe(39);
  });
});
