import { describe, it, expect } from 'vitest';
import { canDeclareAttacker, declareAttackers } from './combat';
import { getCardsInZone, initGameState } from './game-state';
import { CardDefinition, CombatState } from './types';

function makeBear(id: string = 'bear-1'): CardDefinition {
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

function makeWall(): CardDefinition {
  return {
    id: 'wall-1',
    name: 'Wall of Stone',
    type_line: 'Creature — Wall',
    oracle_text: '',
    mana_cost: '{1}{R}{R}',
    cmc: 3,
    colors: ['R'],
    color_identity: ['R'],
    keywords: ['Defender'],
    card_types: ['creature'],
    power: 0,
    toughness: 8,
  };
}

function setupBattlefield() {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [makeBear('bear-1'), makeBear('bear-2')], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [makeBear('bear-3')], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  // Move all cards to battlefield, remove summoning sickness
  for (const [id, card] of state.cards) {
    state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
  }
  state = { ...state, phase: 'combat', step: 'declare_attackers' };
  return state;
}

describe('Combat Types', () => {
  it('CombatState tracks attackers mapped to defending players', () => {
    const combat: CombatState = {
      attackers: [{ cardInstanceId: 'inst_1', defendingPlayerId: 'p2' }],
      blockers: [],
      damageAssignment: new Map(),
    };
    expect(combat.attackers[0].defendingPlayerId).toBe('p2');
  });

  it('CombatState tracks blockers mapped to attackers', () => {
    const combat: CombatState = {
      attackers: [{ cardInstanceId: 'inst_1', defendingPlayerId: 'p2' }],
      blockers: [{ cardInstanceId: 'inst_2', blockingAttackerId: 'inst_1' }],
      damageAssignment: new Map(),
    };
    expect(combat.blockers[0].blockingAttackerId).toBe('inst_1');
  });
});

describe('Declare Attackers', () => {
  describe('canDeclareAttacker', () => {
    it('allows untapped creature without summoning sickness', () => {
      const state = setupBattlefield();
      const creatures = getCardsInZone(state, 'p1', 'battlefield');
      expect(canDeclareAttacker(state, 'p1', creatures[0].instanceId)).toBe(true);
    });

    it('rejects tapped creatures', () => {
      const state = setupBattlefield();
      const creatures = getCardsInZone(state, 'p1', 'battlefield');
      state.cards.set(creatures[0].instanceId, { ...creatures[0], tapped: true });
      expect(canDeclareAttacker(state, 'p1', creatures[0].instanceId)).toBe(false);
    });

    it('rejects creatures with summoning sickness', () => {
      const state = setupBattlefield();
      const creatures = getCardsInZone(state, 'p1', 'battlefield');
      state.cards.set(creatures[0].instanceId, { ...creatures[0], summoningSick: true });
      expect(canDeclareAttacker(state, 'p1', creatures[0].instanceId)).toBe(false);
    });

    it('rejects creatures with Defender', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeWall()], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const wall = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(wall.instanceId, { ...wall, zone: 'battlefield', summoningSick: false });
      state = { ...state, phase: 'combat', step: 'declare_attackers' };
      expect(canDeclareAttacker(state, 'p1', wall.instanceId)).toBe(false);
    });

    it('rejects non-creatures', () => {
      const artifact: CardDefinition = {
        id: 'rock-1',
        name: 'Mana Rock',
        type_line: 'Artifact',
        oracle_text: '',
        mana_cost: '{2}',
        cmc: 2,
        colors: [],
        color_identity: [],
        keywords: [],
        card_types: ['artifact'],
      };
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [artifact], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
      ];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });
      state = { ...state, phase: 'combat', step: 'declare_attackers' };
      expect(canDeclareAttacker(state, 'p1', card.instanceId)).toBe(false);
    });

    it('rejects if not active player', () => {
      const state = setupBattlefield();
      const creatures = getCardsInZone(state, 'p2', 'battlefield');
      expect(canDeclareAttacker(state, 'p2', creatures[0].instanceId)).toBe(false);
    });
  });

  describe('declareAttackers', () => {
    it('taps attacking creatures and creates combat state', () => {
      const state = setupBattlefield();
      const creatures = getCardsInZone(state, 'p1', 'battlefield');
      const attacks = [
        { cardInstanceId: creatures[0].instanceId, defendingPlayerId: 'p2' },
        { cardInstanceId: creatures[1].instanceId, defendingPlayerId: 'p2' },
      ];
      const next = declareAttackers(state, 'p1', attacks);

      expect(next.cards.get(creatures[0].instanceId)!.tapped).toBe(true);
      expect(next.cards.get(creatures[1].instanceId)!.tapped).toBe(true);
      expect(next.combat).not.toBeNull();
      expect(next.combat!.attackers).toHaveLength(2);
    });

    it('allows attacking different opponents in multiplayer', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeBear('bear-1'), makeBear('bear-2')], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
        { playerId: 'p3', name: 'Carol', cards: [], commanderId: 'cmd3' },
      ];
      let state = initGameState(decks);
      for (const [id, card] of state.cards) {
        state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
      }
      state = { ...state, phase: 'combat', step: 'declare_attackers' };

      const creatures = getCardsInZone(state, 'p1', 'battlefield');
      const attacks = [
        { cardInstanceId: creatures[0].instanceId, defendingPlayerId: 'p2' },
        { cardInstanceId: creatures[1].instanceId, defendingPlayerId: 'p3' },
      ];
      const next = declareAttackers(state, 'p1', attacks);
      expect(next.combat!.attackers[0].defendingPlayerId).toBe('p2');
      expect(next.combat!.attackers[1].defendingPlayerId).toBe('p3');
    });

    it('allows empty attacks (no attackers)', () => {
      const state = setupBattlefield();
      const next = declareAttackers(state, 'p1', []);
      expect(next.combat).not.toBeNull();
      expect(next.combat!.attackers).toHaveLength(0);
    });

    it('throws if any creature cannot attack', () => {
      const state = setupBattlefield();
      const creatures = getCardsInZone(state, 'p1', 'battlefield');
      state.cards.set(creatures[0].instanceId, { ...creatures[0], tapped: true });
      const attacks = [{ cardInstanceId: creatures[0].instanceId, defendingPlayerId: 'p2' }];
      expect(() => declareAttackers(state, 'p1', attacks)).toThrow();
    });
  });
});
