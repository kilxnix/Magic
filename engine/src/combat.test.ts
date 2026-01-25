import { describe, it, expect } from 'vitest';
import { canDeclareAttacker, declareAttackers, canDeclareBlocker, declareBlockers, resolveCombatDamage } from './combat';
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

describe("Declare Blockers", () => {
  function setupCombat() {
    const decks = [
      { playerId: "p1", name: "Alice", cards: [makeBear("bear-1")], commanderId: "cmd1" },
      { playerId: "p2", name: "Bob", cards: [makeBear("bear-3"), makeBear("bear-4")], commanderId: "cmd2" },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: "battlefield", summoningSick: false });
    }
    state = { ...state, phase: "combat", step: "declare_attackers" };

    // P1 attacks with bear
    const p1Creatures = getCardsInZone(state, "p1", "battlefield");
    state = declareAttackers(state, "p1", [
      { cardInstanceId: p1Creatures[0].instanceId, defendingPlayerId: "p2" },
    ]);
    state = { ...state, step: "declare_blockers" };
    return state;
  }

  describe("canDeclareBlocker", () => {
    it("allows untapped creature to block an attacker targeting its controller", () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, "p2", "battlefield");
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      expect(canDeclareBlocker(state, "p2", p2Creatures[0].instanceId, attackerId)).toBe(true);
    });

    it("rejects tapped creatures as blockers", () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, "p2", "battlefield");
      state.cards.set(p2Creatures[0].instanceId, { ...p2Creatures[0], tapped: true });
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      expect(canDeclareBlocker(state, "p2", p2Creatures[0].instanceId, attackerId)).toBe(false);
    });

    it("allows creatures with summoning sickness to block", () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, "p2", "battlefield");
      state.cards.set(p2Creatures[0].instanceId, { ...p2Creatures[0], summoningSick: true });
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      expect(canDeclareBlocker(state, "p2", p2Creatures[0].instanceId, attackerId)).toBe(true);
    });

    it("rejects blocking an attacker not targeting you", () => {
      const decks = [
        { playerId: "p1", name: "Alice", cards: [makeBear("bear-1")], commanderId: "cmd1" },
        { playerId: "p2", name: "Bob", cards: [], commanderId: "cmd2" },
        { playerId: "p3", name: "Carol", cards: [makeBear("bear-5")], commanderId: "cmd3" },
      ];
      let state = initGameState(decks);
      for (const [id, card] of state.cards) {
        state.cards.set(id, { ...card, zone: "battlefield", summoningSick: false });
      }
      state = { ...state, phase: "combat", step: "declare_attackers" };

      const p1Creature = getCardsInZone(state, "p1", "battlefield")[0];
      state = declareAttackers(state, "p1", [
        { cardInstanceId: p1Creature.instanceId, defendingPlayerId: "p2" },
      ]);
      state = { ...state, step: "declare_blockers" };

      // P3 tries to block an attacker targeting p2 — not allowed
      const p3Creature = getCardsInZone(state, "p3", "battlefield")[0];
      expect(canDeclareBlocker(state, "p3", p3Creature.instanceId, p1Creature.instanceId)).toBe(false);
    });
  });

  describe("declareBlockers", () => {
    it("assigns blockers to attackers", () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, "p2", "battlefield");
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      const blocks = [
        { cardInstanceId: p2Creatures[0].instanceId, blockingAttackerId: attackerId },
      ];
      const next = declareBlockers(state, "p2", blocks);
      expect(next.combat!.blockers).toHaveLength(1);
      expect(next.combat!.blockers[0].blockingAttackerId).toBe(attackerId);
    });

    it("allows multiple blockers on one attacker", () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, "p2", "battlefield");
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      const blocks = [
        { cardInstanceId: p2Creatures[0].instanceId, blockingAttackerId: attackerId },
        { cardInstanceId: p2Creatures[1].instanceId, blockingAttackerId: attackerId },
      ];
      const next = declareBlockers(state, "p2", blocks);
      expect(next.combat!.blockers).toHaveLength(2);
    });

    it("allows empty blocks (no blockers)", () => {
      const state = setupCombat();
      const next = declareBlockers(state, "p2", []);
      expect(next.combat!.blockers).toHaveLength(0);
    });
  });
});

describe("Combat Damage", () => {
  it("unblocked attacker deals damage to defending player", () => {
    const state = setupBattlefield();
    const creatures = getCardsInZone(state, "p1", "battlefield");
    let next = declareAttackers(state, "p1", [
      { cardInstanceId: creatures[0].instanceId, defendingPlayerId: "p2" },
    ]);
    next = declareBlockers(next, "p2", []);
    next = resolveCombatDamage(next);

    expect(next.players[1].life).toBe(38); // 40 - 2 power
  });

  it("multiple unblocked attackers deal cumulative damage", () => {
    const state = setupBattlefield();
    const creatures = getCardsInZone(state, "p1", "battlefield");
    let next = declareAttackers(state, "p1", [
      { cardInstanceId: creatures[0].instanceId, defendingPlayerId: "p2" },
      { cardInstanceId: creatures[1].instanceId, defendingPlayerId: "p2" },
    ]);
    next = declareBlockers(next, "p2", []);
    next = resolveCombatDamage(next);

    expect(next.players[1].life).toBe(36); // 40 - 2 - 2
  });

  it("blocked attacker deals damage to blocker (damage marked)", () => {
    const decks = [
      { playerId: "p1", name: "Alice", cards: [makeBear("bear-1")], commanderId: "cmd1" },
      { playerId: "p2", name: "Bob", cards: [makeBear("bear-3")], commanderId: "cmd2" },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: "battlefield", summoningSick: false });
    }
    state = { ...state, phase: "combat", step: "declare_attackers" };

    const p1Bear = getCardsInZone(state, "p1", "battlefield")[0];
    const p2Bear = getCardsInZone(state, "p2", "battlefield")[0];

    state = declareAttackers(state, "p1", [
      { cardInstanceId: p1Bear.instanceId, defendingPlayerId: "p2" },
    ]);
    state = declareBlockers(state, "p2", [
      { cardInstanceId: p2Bear.instanceId, blockingAttackerId: p1Bear.instanceId },
    ]);
    state = resolveCombatDamage(state);

    // Both deal damage to each other
    expect(state.cards.get(p1Bear.instanceId)!.damage).toBe(2);
    expect(state.cards.get(p2Bear.instanceId)!.damage).toBe(2);
    // No player damage — attacker was blocked
    expect(state.players[1].life).toBe(40);
    // Combat cleared
    expect(state.combat).toBeNull();
  });

  it("blocked attacker does not deal damage to player", () => {
    const bigBear: CardDefinition = {
      id: "big-1",
      name: "Big Bear",
      type_line: "Creature — Bear",
      oracle_text: "",
      mana_cost: "{3}{G}",
      cmc: 4,
      colors: ["G"],
      color_identity: ["G"],
      keywords: [],
      card_types: ["creature"],
      power: 4,
      toughness: 4,
    };
    const decks = [
      { playerId: "p1", name: "Alice", cards: [bigBear], commanderId: "cmd1" },
      { playerId: "p2", name: "Bob", cards: [makeBear("bear-3")], commanderId: "cmd2" },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: "battlefield", summoningSick: false });
    }
    state = { ...state, phase: "combat", step: "declare_attackers" };

    const bigCreature = getCardsInZone(state, "p1", "battlefield")[0];
    const smallBlocker = getCardsInZone(state, "p2", "battlefield")[0];

    state = declareAttackers(state, "p1", [
      { cardInstanceId: bigCreature.instanceId, defendingPlayerId: "p2" },
    ]);
    state = declareBlockers(state, "p2", [
      { cardInstanceId: smallBlocker.instanceId, blockingAttackerId: bigCreature.instanceId },
    ]);
    state = resolveCombatDamage(state);

    // Big bear deals 4 to blocker, gets 2 back. Player takes no damage.
    expect(state.cards.get(smallBlocker.instanceId)!.damage).toBe(4);
    expect(state.cards.get(bigCreature.instanceId)!.damage).toBe(2);
    expect(state.players[1].life).toBe(40);
  });

  it("clears combat state after damage", () => {
    const state = setupBattlefield();
    const creatures = getCardsInZone(state, "p1", "battlefield");
    let next = declareAttackers(state, "p1", [
      { cardInstanceId: creatures[0].instanceId, defendingPlayerId: "p2" },
    ]);
    next = declareBlockers(next, "p2", []);
    next = resolveCombatDamage(next);

    expect(next.combat).toBeNull();
  });
});

describe("Commander Damage Tracking", () => {
  function makeCommander(): CardDefinition {
    return {
      id: "cmd-1",
      name: "Test Commander",
      type_line: "Legendary Creature — Human",
      oracle_text: "",
      mana_cost: "{2}{W}{U}",
      cmc: 4,
      colors: ["W", "U"],
      color_identity: ["W", "U"],
      keywords: [],
      card_types: ["creature"],
      power: 5,
      toughness: 5,
    };
  }

  function setupCommanderCombat() {
    const decks = [
      { playerId: "p1", name: "Alice", cards: [makeCommander()], commanderId: "cmd-1" },
      { playerId: "p2", name: "Bob", cards: [makeBear("bear-3")], commanderId: "cmd-2" },
    ];
    let state = initGameState(decks);
    // Move commander to battlefield (from command zone)
    const commander = getCardsInZone(state, "p1", "command")[0];
    state.cards.set(commander.instanceId, {
      ...commander,
      zone: "battlefield",
      summoningSick: false,
    });
    // Move bear to battlefield
    const bear = getCardsInZone(state, "p2", "library")[0];
    state.cards.set(bear.instanceId, {
      ...bear,
      zone: "battlefield",
      summoningSick: false,
    });
    state = { ...state, phase: "combat", step: "declare_attackers" };
    return state;
  }

  it("tracks commander damage when commander deals combat damage to player", () => {
    let state = setupCommanderCombat();
    const commander = getCardsInZone(state, "p1", "battlefield")[0];

    state = declareAttackers(state, "p1", [
      { cardInstanceId: commander.instanceId, defendingPlayerId: "p2" },
    ]);
    state = declareBlockers(state, "p2", []);
    state = resolveCombatDamage(state);

    expect(state.players[1].life).toBe(35); // 40 - 5
    expect(state.players[1].commanderDamage[commander.instanceId]).toBe(5);
  });

  it("accumulates commander damage over multiple attacks", () => {
    let state = setupCommanderCombat();
    const commander = getCardsInZone(state, "p1", "battlefield")[0];

    // First attack
    state = declareAttackers(state, "p1", [
      { cardInstanceId: commander.instanceId, defendingPlayerId: "p2" },
    ]);
    state = declareBlockers(state, "p2", []);
    state = resolveCombatDamage(state);

    // Reset for second attack
    state.cards.set(commander.instanceId, {
      ...state.cards.get(commander.instanceId)!,
      tapped: false,
    });
    state = {
      ...state,
      phase: "combat",
      step: "declare_attackers",
    };

    // Second attack
    state = declareAttackers(state, "p1", [
      { cardInstanceId: commander.instanceId, defendingPlayerId: "p2" },
    ]);
    state = declareBlockers(state, "p2", []);
    state = resolveCombatDamage(state);

    expect(state.players[1].life).toBe(30); // 40 - 5 - 5
    expect(state.players[1].commanderDamage[commander.instanceId]).toBe(10);
  });

  it("does not track commander damage for non-commander creatures", () => {
    const state = setupBattlefield();
    const creatures = getCardsInZone(state, "p1", "battlefield");

    let next = declareAttackers(state, "p1", [
      { cardInstanceId: creatures[0].instanceId, defendingPlayerId: "p2" },
    ]);
    next = declareBlockers(next, "p2", []);
    next = resolveCombatDamage(next);

    expect(next.players[1].life).toBe(38); // 40 - 2
    // No commander damage tracked for non-commanders
    expect(next.players[1].commanderDamage[creatures[0].instanceId]).toBeUndefined();
  });

  it("does not track commander damage when blocked", () => {
    let state = setupCommanderCombat();
    const commander = getCardsInZone(state, "p1", "battlefield")[0];
    const bear = getCardsInZone(state, "p2", "battlefield")[0];

    state = declareAttackers(state, "p1", [
      { cardInstanceId: commander.instanceId, defendingPlayerId: "p2" },
    ]);
    state = declareBlockers(state, "p2", [
      { cardInstanceId: bear.instanceId, blockingAttackerId: commander.instanceId },
    ]);
    state = resolveCombatDamage(state);

    // No damage to player (blocked)
    expect(state.players[1].life).toBe(40);
    // No commander damage tracked
    expect(state.players[1].commanderDamage[commander.instanceId]).toBeUndefined();
  });

  it("tracks commander damage from trample overflow", () => {
    const bigCommander: CardDefinition = {
      id: "cmd-big",
      name: "Big Commander",
      type_line: "Legendary Creature — Giant",
      oracle_text: "",
      mana_cost: "{4}{G}{G}",
      cmc: 6,
      colors: ["G"],
      color_identity: ["G"],
      keywords: ["Trample"],
      card_types: ["creature"],
      power: 7,
      toughness: 7,
    };

    const decks = [
      { playerId: "p1", name: "Alice", cards: [bigCommander], commanderId: "cmd-big" },
      { playerId: "p2", name: "Bob", cards: [makeBear("bear-3")], commanderId: "cmd-2" },
    ];
    let state = initGameState(decks);

    const commander = getCardsInZone(state, "p1", "command")[0];
    state.cards.set(commander.instanceId, {
      ...commander,
      zone: "battlefield",
      summoningSick: false,
    });

    const bear = getCardsInZone(state, "p2", "library")[0];
    state.cards.set(bear.instanceId, {
      ...bear,
      zone: "battlefield",
      summoningSick: false,
    });

    state = { ...state, phase: "combat", step: "declare_attackers" };

    state = declareAttackers(state, "p1", [
      { cardInstanceId: commander.instanceId, defendingPlayerId: "p2" },
    ]);
    state = declareBlockers(state, "p2", [
      { cardInstanceId: bear.instanceId, blockingAttackerId: commander.instanceId },
    ]);
    state = resolveCombatDamage(state);

    // 7 power, 2 toughness blocker, 5 trample overflow
    expect(state.players[1].life).toBe(35); // 40 - 5
    expect(state.players[1].commanderDamage[commander.instanceId]).toBe(5);
  });
});
