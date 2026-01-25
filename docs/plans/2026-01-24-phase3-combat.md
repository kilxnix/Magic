# Phase 3: Combat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the combat system — declaring attackers/blockers, dealing damage, and creatures dying — so vanilla creatures can fight each other in Commander multiplayer.

**Architecture:** A `CombatState` on `GameState` tracks attackers (mapped to defending player), blockers (mapped to the attacker they block), and damage assignment order. Combat flows through declare_attackers → declare_blockers → combat_damage steps. Damage is marked on `CardInstance.damage` and creatures die (move to graveyard) when damage >= toughness via state-based action checks.

**Tech Stack:** TypeScript, Vitest, builds on Phase 1-2 types/game-state/turn-manager

---

## Task 1: Combat Types — CombatState and GameState Extension

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/game-state.ts`

**Step 1: Write the test** (`engine/src/combat.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { CombatState } from './types';

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
```

**Step 2: Add types to `engine/src/types.ts`**

Add after `StackItem`:

```typescript
export interface AttackerDeclaration {
  cardInstanceId: string;
  defendingPlayerId: string;
}

export interface BlockerDeclaration {
  cardInstanceId: string;
  blockingAttackerId: string;
}

export interface CombatState {
  attackers: AttackerDeclaration[];
  blockers: BlockerDeclaration[];
  damageAssignment: Map<string, number>; // attackerInstanceId -> damage to assign to player
}
```

Add `combat: CombatState | null` to `GameState` interface.

**Step 3: Update initGameState** to include `combat: null`.

**Step 4: Run all tests**

Run: `cd engine && npx vitest run`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add engine/src/types.ts engine/src/game-state.ts engine/src/combat.test.ts
git commit -m "feat(engine): add CombatState types to GameState"
```

---

## Task 2: Declare Attackers — Validation and State Update

**Files:**
- Create: `engine/src/combat.ts`
- Modify: `engine/src/combat.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { canDeclareAttacker, declareAttackers } from './combat';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition, CombatState } from './types';

function makeBear(id: string = 'bear-1'): CardDefinition {
  return {
    id, name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  };
}

function makeWall(): CardDefinition {
  return {
    id: 'wall-1', name: 'Wall of Stone', type_line: 'Creature — Wall',
    oracle_text: '', mana_cost: '{1}{R}{R}', cmc: 3,
    colors: ['R'], color_identity: ['R'], keywords: ['Defender'],
    card_types: ['creature'], power: 0, toughness: 8,
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
        id: 'rock-1', name: 'Mana Rock', type_line: 'Artifact',
        oracle_text: '', mana_cost: '{2}', cmc: 2,
        colors: [], color_identity: [], keywords: [],
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
      const attacks = [
        { cardInstanceId: creatures[0].instanceId, defendingPlayerId: 'p2' },
      ];
      expect(() => declareAttackers(state, 'p1', attacks)).toThrow();
    });
  });
});
```

**Step 2: Write implementation** (`engine/src/combat.ts`)

```typescript
import { GameState, AttackerDeclaration, BlockerDeclaration, CombatState } from './types';
import { getCardDefinition } from './game-state';

export function canDeclareAttacker(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (state.activePlayerIndex !== playerIndex) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'battlefield') return false;
  if (card.tapped) return false;
  if (card.summoningSick) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('creature')) return false;
  if (def.keywords.includes('Defender')) return false;

  return true;
}

export function declareAttackers(state: GameState, playerId: string, attacks: AttackerDeclaration[]): GameState {
  // Validate all attackers
  for (const attack of attacks) {
    if (!canDeclareAttacker(state, playerId, attack.cardInstanceId)) {
      throw new Error(`Cannot declare attacker: ${attack.cardInstanceId}`);
    }
  }

  // Tap all attackers
  const newCards = new Map(state.cards);
  for (const attack of attacks) {
    const card = newCards.get(attack.cardInstanceId)!;
    newCards.set(attack.cardInstanceId, { ...card, tapped: true });
  }

  const combat: CombatState = {
    attackers: attacks,
    blockers: [],
    damageAssignment: new Map(),
  };

  return {
    ...state,
    cards: newCards,
    combat,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
```

**Step 3: Run tests**

Run: `cd engine && npx vitest run src/combat.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add engine/src/combat.ts engine/src/combat.test.ts
git commit -m "feat(engine): declare attackers — validation and combat state"
```

---

## Task 3: Declare Blockers — Validation and Assignment

**Files:**
- Modify: `engine/src/combat.ts`
- Modify: `engine/src/combat.test.ts`

**Step 1: Write the test**

Add to `combat.test.ts`:

```typescript
import { canDeclareAttacker, declareAttackers, canDeclareBlocker, declareBlockers } from './combat';

// ... existing tests ...

describe('Declare Blockers', () => {
  function setupCombat() {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear('bear-1')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeBear('bear-3'), makeBear('bear-4')], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };

    // P1 attacks with bear
    const p1Creatures = getCardsInZone(state, 'p1', 'battlefield');
    state = declareAttackers(state, 'p1', [
      { cardInstanceId: p1Creatures[0].instanceId, defendingPlayerId: 'p2' },
    ]);
    state = { ...state, step: 'declare_blockers' };
    return state;
  }

  describe('canDeclareBlocker', () => {
    it('allows untapped creature to block an attacker targeting its controller', () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, 'p2', 'battlefield');
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      expect(canDeclareBlocker(state, 'p2', p2Creatures[0].instanceId, attackerId)).toBe(true);
    });

    it('rejects tapped creatures as blockers', () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, 'p2', 'battlefield');
      state.cards.set(p2Creatures[0].instanceId, { ...p2Creatures[0], tapped: true });
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      expect(canDeclareBlocker(state, 'p2', p2Creatures[0].instanceId, attackerId)).toBe(false);
    });

    it('allows creatures with summoning sickness to block', () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, 'p2', 'battlefield');
      state.cards.set(p2Creatures[0].instanceId, { ...p2Creatures[0], summoningSick: true });
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      expect(canDeclareBlocker(state, 'p2', p2Creatures[0].instanceId, attackerId)).toBe(true);
    });

    it('rejects blocking an attacker not targeting you', () => {
      const decks = [
        { playerId: 'p1', name: 'Alice', cards: [makeBear('bear-1')], commanderId: 'cmd1' },
        { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
        { playerId: 'p3', name: 'Carol', cards: [makeBear('bear-5')], commanderId: 'cmd3' },
      ];
      let state = initGameState(decks);
      for (const [id, card] of state.cards) {
        state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
      }
      state = { ...state, phase: 'combat', step: 'declare_attackers' };

      const p1Creature = getCardsInZone(state, 'p1', 'battlefield')[0];
      state = declareAttackers(state, 'p1', [
        { cardInstanceId: p1Creature.instanceId, defendingPlayerId: 'p2' },
      ]);
      state = { ...state, step: 'declare_blockers' };

      // P3 tries to block an attacker targeting p2 — not allowed
      const p3Creature = getCardsInZone(state, 'p3', 'battlefield')[0];
      expect(canDeclareBlocker(state, 'p3', p3Creature.instanceId, p1Creature.instanceId)).toBe(false);
    });
  });

  describe('declareBlockers', () => {
    it('assigns blockers to attackers', () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, 'p2', 'battlefield');
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      const blocks = [
        { cardInstanceId: p2Creatures[0].instanceId, blockingAttackerId: attackerId },
      ];
      const next = declareBlockers(state, 'p2', blocks);
      expect(next.combat!.blockers).toHaveLength(1);
      expect(next.combat!.blockers[0].blockingAttackerId).toBe(attackerId);
    });

    it('allows multiple blockers on one attacker', () => {
      const state = setupCombat();
      const p2Creatures = getCardsInZone(state, 'p2', 'battlefield');
      const attackerId = state.combat!.attackers[0].cardInstanceId;
      const blocks = [
        { cardInstanceId: p2Creatures[0].instanceId, blockingAttackerId: attackerId },
        { cardInstanceId: p2Creatures[1].instanceId, blockingAttackerId: attackerId },
      ];
      const next = declareBlockers(state, 'p2', blocks);
      expect(next.combat!.blockers).toHaveLength(2);
    });

    it('allows empty blocks (no blockers)', () => {
      const state = setupCombat();
      const next = declareBlockers(state, 'p2', []);
      expect(next.combat!.blockers).toHaveLength(0);
    });
  });
});
```

**Step 2: Add to `engine/src/combat.ts`**

```typescript
export function canDeclareBlocker(state: GameState, playerId: string, cardInstanceId: string, attackerInstanceId: string): boolean {
  if (!state.combat) return false;

  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'battlefield') return false;
  if (card.tapped) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('creature')) return false;

  // Can only block attackers targeting you
  const attacker = state.combat.attackers.find(a => a.cardInstanceId === attackerInstanceId);
  if (!attacker) return false;
  if (attacker.defendingPlayerId !== playerId) return false;

  return true;
}

export function declareBlockers(state: GameState, playerId: string, blocks: BlockerDeclaration[]): GameState {
  if (!state.combat) throw new Error('No combat state');

  for (const block of blocks) {
    if (!canDeclareBlocker(state, playerId, block.cardInstanceId, block.blockingAttackerId)) {
      throw new Error(`Cannot declare blocker: ${block.cardInstanceId}`);
    }
  }

  const combat: CombatState = {
    ...state.combat,
    blockers: [...state.combat.blockers, ...blocks],
  };

  return {
    ...state,
    combat,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
```

**Step 3: Run tests**

Run: `cd engine && npx vitest run src/combat.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add engine/src/combat.ts engine/src/combat.test.ts
git commit -m "feat(engine): declare blockers — validation and assignment"
```

---

## Task 4: Combat Damage — Deal Damage and Reduce Life

**Files:**
- Modify: `engine/src/combat.ts`
- Modify: `engine/src/combat.test.ts`

**Step 1: Write the test**

Add to `combat.test.ts`:

```typescript
import { canDeclareAttacker, declareAttackers, canDeclareBlocker, declareBlockers, resolveCombatDamage } from './combat';

// ... existing tests ...

describe('Combat Damage', () => {
  it('unblocked attacker deals damage to defending player', () => {
    const state = setupBattlefield();
    const creatures = getCardsInZone(state, 'p1', 'battlefield');
    let next = declareAttackers(state, 'p1', [
      { cardInstanceId: creatures[0].instanceId, defendingPlayerId: 'p2' },
    ]);
    next = declareBlockers(next, 'p2', []);
    next = resolveCombatDamage(next);

    expect(next.players[1].life).toBe(38); // 40 - 2 power
  });

  it('multiple unblocked attackers deal cumulative damage', () => {
    const state = setupBattlefield();
    const creatures = getCardsInZone(state, 'p1', 'battlefield');
    let next = declareAttackers(state, 'p1', [
      { cardInstanceId: creatures[0].instanceId, defendingPlayerId: 'p2' },
      { cardInstanceId: creatures[1].instanceId, defendingPlayerId: 'p2' },
    ]);
    next = declareBlockers(next, 'p2', []);
    next = resolveCombatDamage(next);

    expect(next.players[1].life).toBe(36); // 40 - 2 - 2
  });

  it('blocked attacker deals damage to blocker (damage marked)', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear('bear-1')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeBear('bear-3')], commanderId: 'cmd2' },
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

    // Both deal damage to each other
    expect(state.cards.get(p1Bear.instanceId)!.damage).toBe(2);
    expect(state.cards.get(p2Bear.instanceId)!.damage).toBe(2);
    // No player damage — attacker was blocked
    expect(state.players[1].life).toBe(40);
  });

  it('blocked attacker does not deal damage to player', () => {
    const bigBear: CardDefinition = {
      id: 'big-1', name: 'Big Bear', type_line: 'Creature — Bear',
      oracle_text: '', mana_cost: '{3}{G}', cmc: 4,
      colors: ['G'], color_identity: ['G'], keywords: [],
      card_types: ['creature'], power: 4, toughness: 4,
    };
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [bigBear], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeBear('bear-3')], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    for (const [id, card] of state.cards) {
      state.cards.set(id, { ...card, zone: 'battlefield', summoningSick: false });
    }
    state = { ...state, phase: 'combat', step: 'declare_attackers' };

    const bigCreature = getCardsInZone(state, 'p1', 'battlefield')[0];
    const smallBlocker = getCardsInZone(state, 'p2', 'battlefield')[0];

    state = declareAttackers(state, 'p1', [
      { cardInstanceId: bigCreature.instanceId, defendingPlayerId: 'p2' },
    ]);
    state = declareBlockers(state, 'p2', [
      { cardInstanceId: smallBlocker.instanceId, blockingAttackerId: bigCreature.instanceId },
    ]);
    state = resolveCombatDamage(state);

    // Big bear deals 4 to blocker, gets 2 back. Player takes no damage.
    expect(state.cards.get(smallBlocker.instanceId)!.damage).toBe(4);
    expect(state.cards.get(bigCreature.instanceId)!.damage).toBe(2);
    expect(state.players[1].life).toBe(40);
  });

  it('clears combat state after damage', () => {
    const state = setupBattlefield();
    const creatures = getCardsInZone(state, 'p1', 'battlefield');
    let next = declareAttackers(state, 'p1', [
      { cardInstanceId: creatures[0].instanceId, defendingPlayerId: 'p2' },
    ]);
    next = declareBlockers(next, 'p2', []);
    next = resolveCombatDamage(next);

    expect(next.combat).toBeNull();
  });
});
```

**Step 2: Add resolveCombatDamage to `engine/src/combat.ts`**

```typescript
export function resolveCombatDamage(state: GameState): GameState {
  if (!state.combat) throw new Error('No combat state');

  const newCards = new Map(state.cards);
  const newPlayers = state.players.map(p => ({ ...p }));

  for (const attacker of state.combat.attackers) {
    const attackerCard = newCards.get(attacker.cardInstanceId)!;
    const attackerDef = state.cardDefinitions.get(attackerCard.definitionId)!;
    const attackerPower = attackerDef.power ?? 0;

    // Find blockers for this attacker
    const blockers = state.combat.blockers.filter(b => b.blockingAttackerId === attacker.cardInstanceId);

    if (blockers.length === 0) {
      // Unblocked — deal damage to defending player
      const defenderIndex = newPlayers.findIndex(p => p.id === attacker.defendingPlayerId);
      if (defenderIndex !== -1) {
        newPlayers[defenderIndex].life -= attackerPower;
      }
    } else {
      // Blocked — deal damage to first blocker (simplified: all damage to first)
      const firstBlocker = newCards.get(blockers[0].cardInstanceId)!;
      newCards.set(firstBlocker.instanceId, {
        ...firstBlocker,
        damage: firstBlocker.damage + attackerPower,
      });

      // Each blocker deals damage back to attacker
      for (const blocker of blockers) {
        const blockerCard = newCards.get(blocker.cardInstanceId)!;
        const blockerDef = state.cardDefinitions.get(blockerCard.definitionId)!;
        const blockerPower = blockerDef.power ?? 0;

        const currentAttacker = newCards.get(attacker.cardInstanceId)!;
        newCards.set(attacker.cardInstanceId, {
          ...currentAttacker,
          damage: currentAttacker.damage + blockerPower,
        });
      }
    }
  }

  return {
    ...state,
    cards: newCards,
    players: newPlayers,
    combat: null,
  };
}
```

**Step 3: Run tests**

Run: `cd engine && npx vitest run src/combat.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add engine/src/combat.ts engine/src/combat.test.ts
git commit -m "feat(engine): combat damage — unblocked hits player, blocked creatures trade"
```

---

## Task 5: State-Based Actions — Creatures Die from Lethal Damage

**Files:**
- Create: `engine/src/state-based.ts`
- Create: `engine/src/state-based.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { checkStateBasedActions } from './state-based';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';

function makeBear(id: string = 'bear-1'): CardDefinition {
  return {
    id, name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  };
}

describe('State-Based Actions', () => {
  it('creature with damage >= toughness moves to graveyard', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 2 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');
  });

  it('creature with damage > toughness also dies', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 5 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('graveyard');
  });

  it('creature with damage < toughness survives', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 1 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.zone).toBe('battlefield');
  });

  it('dead creatures have damage reset when moved to graveyard', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 3 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(0);
  });

  it('player with life <= 0 is marked as lost', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    state.players[0].life = 0;

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('player with negative life is marked as lost', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    state.players[0].life = -5;

    const next = checkStateBasedActions(state);
    expect(next.players[0].hasLost).toBe(true);
  });

  it('handles multiple creatures dying at once', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear('b1'), makeBear('b2')], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const cards = getCardsInZone(state, 'p1', 'library');
    state.cards.set(cards[0].instanceId, { ...cards[0], zone: 'battlefield', damage: 2 });
    state.cards.set(cards[1].instanceId, { ...cards[1], zone: 'battlefield', damage: 3 });

    const next = checkStateBasedActions(state);
    expect(next.cards.get(cards[0].instanceId)!.zone).toBe('graveyard');
    expect(next.cards.get(cards[1].instanceId)!.zone).toBe('graveyard');
  });

  it('damage clears at end of turn (cleanup)', () => {
    // This tests cleanupDamage, not SBAs, but it belongs here
    // We'll add cleanupDamage in this same module
  });
});
```

**Step 2: Write implementation** (`engine/src/state-based.ts`)

```typescript
import { GameState } from './types';

export function checkStateBasedActions(state: GameState): GameState {
  const newCards = new Map(state.cards);
  const newPlayers = state.players.map(p => ({ ...p }));
  let changed = false;

  // Check creatures with lethal damage
  for (const [id, card] of newCards) {
    if (card.zone !== 'battlefield') continue;

    const def = state.cardDefinitions.get(card.definitionId);
    if (!def || !def.card_types.includes('creature')) continue;

    const toughness = def.toughness ?? 0;
    if (card.damage >= toughness) {
      newCards.set(id, { ...card, zone: 'graveyard', damage: 0, tapped: false });
      changed = true;
    }
  }

  // Check player life totals
  for (let i = 0; i < newPlayers.length; i++) {
    if (!newPlayers[i].hasLost && newPlayers[i].life <= 0) {
      newPlayers[i].hasLost = true;
      changed = true;
    }
  }

  return { ...state, cards: newCards, players: newPlayers };
}

export function cleanupDamage(state: GameState): GameState {
  const newCards = new Map(state.cards);

  for (const [id, card] of newCards) {
    if (card.zone === 'battlefield' && card.damage > 0) {
      newCards.set(id, { ...card, damage: 0 });
    }
  }

  return { ...state, cards: newCards };
}
```

**Step 3: Run tests**

Run: `cd engine && npx vitest run src/state-based.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add engine/src/state-based.ts engine/src/state-based.test.ts
git commit -m "feat(engine): state-based actions — lethal damage kills creatures, life check"
```

---

## Task 6: Damage Cleanup at End of Turn

**Files:**
- Modify: `engine/src/state-based.test.ts`

**Step 1: Write the test**

Add to `state-based.test.ts`:

```typescript
import { checkStateBasedActions, cleanupDamage } from './state-based';

// ... existing tests ...

describe('cleanupDamage', () => {
  it('removes all damage from creatures on battlefield', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', damage: 1 });

    const next = cleanupDamage(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(0);
  });

  it('does not affect cards in other zones', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeBear()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    // Card in graveyard with damage shouldn't be modified (edge case)
    state.cards.set(card.instanceId, { ...card, zone: 'graveyard', damage: 3 });

    const next = cleanupDamage(state);
    expect(next.cards.get(card.instanceId)!.damage).toBe(3);
  });
});
```

**Step 2: Run tests (should pass — cleanupDamage already implemented)**

Run: `cd engine && npx vitest run src/state-based.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add engine/src/state-based.test.ts
git commit -m "test(engine): cleanup damage tests"
```

---

## Task 7: Combat Integration Test — Full Combat Round

**Files:**
- Create: `engine/src/combat-integration.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { initGameState, getCardsInZone } from './game-state';
import { declareAttackers, declareBlockers, resolveCombatDamage } from './combat';
import { checkStateBasedActions, cleanupDamage } from './state-based';
import { CardDefinition } from './types';

function makeBear(id: string): CardDefinition {
  return {
    id, name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  };
}

function makeGiant(id: string): CardDefinition {
  return {
    id, name: 'Hill Giant', type_line: 'Creature — Giant',
    oracle_text: '', mana_cost: '{3}{R}', cmc: 4,
    colors: ['R'], color_identity: ['R'], keywords: [],
    card_types: ['creature'], power: 3, toughness: 3,
  };
}

function makeElf(id: string): CardDefinition {
  return {
    id, name: 'Llanowar Elves', type_line: 'Creature — Elf Druid',
    oracle_text: '{T}: Add {G}.', mana_cost: '{G}', cmc: 1,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 1, toughness: 1,
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
    state.players[1].life = 3; // Bob at 3 life

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

    expect(state.players[1].life).toBe(38); // Bob takes 2
    expect(state.players[2].life).toBe(39); // Carol takes 1
  });
});
```

**Step 2: Run all tests**

Run: `cd engine && npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add engine/src/combat-integration.test.ts
git commit -m "test(engine): combat integration — trades, lethal, multiplayer attacks"
```

---

## Task 8: Update Barrel Export

**Files:**
- Modify: `engine/src/index.ts`

**Step 1: Add exports**

```typescript
export * from './combat';
export * from './state-based';
```

**Step 2: Verify build**

Run: `cd engine && npx tsc --noEmit && npx vitest run`
Expected: Clean build, all tests pass

**Step 3: Commit**

```bash
git add engine/src/index.ts
git commit -m "feat(engine): export combat and state-based modules"
```

---

## Summary

After completing all 8 tasks, Phase 3 delivers:

| Module | What it does |
|--------|-------------|
| `types.ts` (updated) | `AttackerDeclaration`, `BlockerDeclaration`, `CombatState`, `combat` field on `GameState` |
| `combat.ts` (new) | `canDeclareAttacker`, `declareAttackers`, `canDeclareBlocker`, `declareBlockers`, `resolveCombatDamage` |
| `state-based.ts` (new) | `checkStateBasedActions` (lethal damage, life check), `cleanupDamage` |

**Key behaviors:**
- Attacker validation (untapped, no summoning sickness, no Defender, active player only)
- Multiplayer attacking (different creatures can attack different opponents)
- Blocker validation (untapped, must be defending the right player)
- Multiple blockers per attacker supported
- Unblocked attackers deal damage to defending player
- Blocked attackers deal damage to first blocker, blockers deal damage back
- State-based actions: creatures with damage >= toughness die, players at 0 life lose
- Damage cleanup at end of turn

Phase 4 (Effect Parser basic) builds on this to add destroy, draw, ETB, and simple targeting.
