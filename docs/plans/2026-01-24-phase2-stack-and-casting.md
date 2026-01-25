# Phase 2: Stack + Casting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the spell stack, casting validation, mana payment, and resolution so non-land cards can be played and resolve into game effects.

**Architecture:** A `StackItem` array on `GameState` represents the LIFO stack. Casting validates timing/cost, pays mana, moves card to stack zone. Resolution pops the top item, moves creatures/artifacts/enchantments to battlefield (with summoning sickness), and sends instants/sorceries to graveyard. Priority resets after each cast and resolution.

**Tech Stack:** TypeScript, Vitest, builds on Phase 1 types/game-state/mana/priority modules

---

## Task 1: Stack Types — StackItem and GameState Extension

**Files:**
- Modify: `engine/src/types.ts`
- Test: `engine/src/stack.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { GameState, StackItem } from './types';

describe('Stack Types', () => {
  it('StackItem has required fields', () => {
    const item: StackItem = {
      id: 'stack_1',
      cardInstanceId: 'inst_1',
      casterId: 'p1',
      targets: [],
    };
    expect(item.id).toBe('stack_1');
    expect(item.cardInstanceId).toBe('inst_1');
    expect(item.casterId).toBe('p1');
    expect(item.targets).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: FAIL — StackItem not exported

**Step 3: Add types to `engine/src/types.ts`**

Add after the `CardInstance` interface:

```typescript
export interface StackItem {
  id: string;
  cardInstanceId: string;
  casterId: string;
  targets: string[]; // instanceIds of targeted cards/players
}
```

Add `stack` field to the `GameState` interface:

```typescript
export interface GameState {
  players: Player[];
  cards: Map<string, CardInstance>;
  cardDefinitions: Map<string, CardDefinition>;
  activePlayerIndex: number;
  priorityPlayerIndex: number;
  phase: Phase;
  step: Step;
  turnNumber: number;
  hasPriorityPassed: boolean[];
  stack: StackItem[];
}
```

**Step 4: Fix initGameState to include `stack: []`**

In `engine/src/game-state.ts`, add `stack: []` to the return object of `initGameState`.

**Step 5: Run all tests to verify nothing broke**

Run: `cd engine && npx vitest run`
Expected: ALL PASS (existing tests still work with the new field)

**Step 6: Commit**

```bash
git add engine/src/types.ts engine/src/game-state.ts engine/src/stack.test.ts
git commit -m "feat(engine): add StackItem type and stack to GameState"
```

---

## Task 2: Casting Validation — canCastSpell

**Files:**
- Create: `engine/src/stack.ts`
- Modify: `engine/src/stack.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { canCastSpell } from './stack';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition, GameState, StackItem } from './types';

function makeCreature(): CardDefinition {
  return {
    id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  };
}

function makeInstant(): CardDefinition {
  return {
    id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    mana_cost: '{R}', cmc: 1,
    colors: ['R'], color_identity: ['R'], keywords: [],
    card_types: ['instant'],
  };
}

function makeSorcery(): CardDefinition {
  return {
    id: 'divination-1', name: 'Divination', type_line: 'Sorcery',
    oracle_text: 'Draw two cards.', mana_cost: '{2}{U}', cmc: 3,
    colors: ['U'], color_identity: ['U'], keywords: [],
    card_types: ['sorcery'],
  };
}

function setupWithCardInHand(cardDef: CardDefinition, phase: string = 'precombat_main') {
  const decks = [
    { playerId: 'p1', name: 'Alice', cards: [cardDef], commanderId: 'cmd1' },
    { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
  ];
  let state = initGameState(decks);
  const card = getCardsInZone(state, 'p1', 'library')[0];
  state.cards.set(card.instanceId, { ...card, zone: 'hand' });
  state = { ...state, phase: phase as any };
  // Give player enough mana
  state.players[0].manaPool = { W: 5, U: 5, B: 5, R: 5, G: 5, C: 5 };
  return { state, cardInstanceId: card.instanceId };
}

describe('canCastSpell', () => {
  it('allows creatures during main phase with empty stack', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
  });

  it('allows instants during any phase', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeInstant(), 'combat');
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
  });

  it('rejects sorceries during combat', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeSorcery(), 'combat');
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
  });

  it('rejects creatures during combat', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature(), 'combat');
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
  });

  it('rejects if player cannot pay mana cost', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
  });

  it('rejects if not the casters card', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
    expect(canCastSpell(state, 'p2', cardInstanceId)).toBe(false);
  });

  it('rejects if card not in hand', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
    const card = state.cards.get(cardInstanceId)!;
    state.cards.set(cardInstanceId, { ...card, zone: 'battlefield' });
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
  });

  it('rejects sorceries when stack is not empty', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeSorcery());
    const stackItem: StackItem = {
      id: 'stack_1', cardInstanceId: 'other', casterId: 'p2', targets: [],
    };
    state.stack.push(stackItem);
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
  });

  it('allows instants when stack is not empty (responding)', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeInstant());
    const stackItem: StackItem = {
      id: 'stack_1', cardInstanceId: 'other', casterId: 'p2', targets: [],
    };
    state.stack.push(stackItem);
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
  });

  it('rejects lands (lands are not cast)', () => {
    const land: CardDefinition = {
      id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
      colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
    };
    const { state, cardInstanceId } = setupWithCardInHand(land);
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: FAIL — canCastSpell not found

**Step 3: Write implementation** (`engine/src/stack.ts`)

```typescript
import { GameState, Phase, StackItem } from './types';
import { getCardDefinition } from './game-state';
import { parseManaString, canPayCost } from './mana';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];

let stackCounter = 0;

export function canCastSpell(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const card = state.cards.get(cardInstanceId);
  if (!card) return false;
  if (card.ownerId !== playerId) return false;
  if (card.zone !== 'hand') return false;

  const def = getCardDefinition(state, card);

  // Lands are not cast
  if (def.card_types.includes('land')) return false;

  const isInstant = def.card_types.includes('instant');
  const hasFlash = def.keywords.includes('Flash');

  // Sorcery-speed: must be main phase, active player, empty stack
  if (!isInstant && !hasFlash) {
    const playerIndex = state.players.findIndex(p => p.id === playerId);
    if (state.activePlayerIndex !== playerIndex) return false;
    if (!MAIN_PHASES.includes(state.phase)) return false;
    if (state.stack.length > 0) return false;
  }

  // Check mana
  const cost = parseManaString(def.mana_cost);
  const player = state.players.find(p => p.id === playerId)!;
  if (!canPayCost(player.manaPool, cost)) return false;

  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/stack.ts engine/src/stack.test.ts
git commit -m "feat(engine): casting validation — canCastSpell with timing and mana checks"
```

---

## Task 3: Cast Spell — Pay Mana, Move to Stack

**Files:**
- Modify: `engine/src/stack.ts`
- Modify: `engine/src/stack.test.ts`

**Step 1: Write the test**

Add to `stack.test.ts`:

```typescript
import { canCastSpell, castSpell } from './stack';

// ... existing tests ...

describe('castSpell', () => {
  it('pays mana cost and moves card to stack zone', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
    const next = castSpell(state, 'p1', cardInstanceId);

    // Card moves to stack zone
    expect(next.cards.get(cardInstanceId)!.zone).toBe('stack');
    // Mana is paid ({1}{G} = 1 generic + 1 green, from pool of 2G -> pays 1G colored, 1G generic)
    expect(next.players[0].manaPool.G).toBe(0);
    // Stack has one item
    expect(next.stack).toHaveLength(1);
    expect(next.stack[0].cardInstanceId).toBe(cardInstanceId);
    expect(next.stack[0].casterId).toBe('p1');
  });

  it('resets priority passed after casting', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
    state.hasPriorityPassed[0] = true;
    state.hasPriorityPassed[1] = true;
    const next = castSpell(state, 'p1', cardInstanceId);
    expect(next.hasPriorityPassed.every(p => p === false)).toBe(true);
  });

  it('throws if cannot cast', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
    expect(() => castSpell(state, 'p1', cardInstanceId)).toThrow();
  });

  it('supports casting with targets', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeInstant());
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    const next = castSpell(state, 'p1', cardInstanceId, ['target_1']);
    expect(next.stack[0].targets).toEqual(['target_1']);
  });

  it('multiple spells stack in LIFO order', () => {
    const bolt1: CardDefinition = { ...makeInstant(), id: 'bolt-1' };
    const bolt2: CardDefinition = { ...makeInstant(), id: 'bolt-2' };
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [bolt1, bolt2], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const cards = getCardsInZone(state, 'p1', 'library');
    state.cards.set(cards[0].instanceId, { ...cards[0], zone: 'hand' });
    state.cards.set(cards[1].instanceId, { ...cards[1], zone: 'hand' });
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 };
    state = { ...state, phase: 'precombat_main' as any };

    state = castSpell(state, 'p1', cards[0].instanceId);
    state = castSpell(state, 'p1', cards[1].instanceId);

    expect(state.stack).toHaveLength(2);
    // Last cast is on top (index 1 = top of stack for our array)
    expect(state.stack[1].cardInstanceId).toBe(cards[1].instanceId);
    expect(state.stack[0].cardInstanceId).toBe(cards[0].instanceId);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: FAIL — castSpell not found

**Step 3: Add castSpell to `engine/src/stack.ts`**

```typescript
export function castSpell(state: GameState, playerId: string, cardInstanceId: string, targets: string[] = []): GameState {
  if (!canCastSpell(state, playerId, cardInstanceId)) {
    throw new Error('Cannot cast spell');
  }

  const card = state.cards.get(cardInstanceId)!;
  const def = getCardDefinition(state, card);
  const cost = parseManaString(def.mana_cost);

  // Pay mana
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const player = state.players[playerIndex];
  const newManaPool = payManaCost(player.manaPool, cost);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, manaPool: newManaPool } : p
  );

  // Move card to stack zone
  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, zone: 'stack' as const });

  // Add to stack
  const stackItem: StackItem = {
    id: `stack_${++stackCounter}`,
    cardInstanceId,
    casterId: playerId,
    targets,
  };

  return {
    ...state,
    cards: newCards,
    players: newPlayers,
    stack: [...state.stack, stackItem],
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
```

Add import of `payManaCost` at top:

```typescript
import { parseManaString, canPayCost, payManaCost } from './mana';
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/stack.ts engine/src/stack.test.ts
git commit -m "feat(engine): castSpell — pays mana, moves to stack, resets priority"
```

---

## Task 4: Resolve Stack — Permanents Enter Battlefield

**Files:**
- Modify: `engine/src/stack.ts`
- Modify: `engine/src/stack.test.ts`

**Step 1: Write the test**

Add to `stack.test.ts`:

```typescript
import { canCastSpell, castSpell, resolveTopOfStack } from './stack';

// ... existing tests ...

function makeArtifact(): CardDefinition {
  return {
    id: 'sol-ring-1', name: 'Sol Ring', type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.', mana_cost: '{1}', cmc: 1,
    colors: [], color_identity: [], keywords: [],
    card_types: ['artifact'],
  };
}

function makeEnchantment(): CardDefinition {
  return {
    id: 'omen-1', name: 'Omen of the Sea', type_line: 'Enchantment',
    oracle_text: 'When Omen of the Sea enters the battlefield, scry 2, then draw a card.',
    mana_cost: '{1}{U}', cmc: 2,
    colors: ['U'], color_identity: ['U'], keywords: ['Flash'],
    card_types: ['enchantment'],
  };
}

describe('resolveTopOfStack', () => {
  it('creature resolves to battlefield with summoning sickness', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeCreature());
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
    let next = castSpell(state, 'p1', cardInstanceId);
    next = resolveTopOfStack(next);

    expect(next.cards.get(cardInstanceId)!.zone).toBe('battlefield');
    expect(next.cards.get(cardInstanceId)!.summoningSick).toBe(true);
    expect(next.stack).toHaveLength(0);
  });

  it('artifact resolves to battlefield without summoning sickness', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeArtifact());
    state.players[0].manaPool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
    let next = castSpell(state, 'p1', cardInstanceId);
    next = resolveTopOfStack(next);

    expect(next.cards.get(cardInstanceId)!.zone).toBe('battlefield');
    expect(next.cards.get(cardInstanceId)!.summoningSick).toBe(false);
  });

  it('enchantment resolves to battlefield', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeEnchantment(), 'combat');
    state.players[0].manaPool = { W: 0, U: 2, B: 0, R: 0, G: 0, C: 0 };
    let next = castSpell(state, 'p1', cardInstanceId);
    next = resolveTopOfStack(next);

    expect(next.cards.get(cardInstanceId)!.zone).toBe('battlefield');
  });

  it('instant resolves to graveyard', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeInstant());
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    let next = castSpell(state, 'p1', cardInstanceId);
    next = resolveTopOfStack(next);

    expect(next.cards.get(cardInstanceId)!.zone).toBe('graveyard');
    expect(next.stack).toHaveLength(0);
  });

  it('sorcery resolves to graveyard', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeSorcery());
    state.players[0].manaPool = { W: 0, U: 3, B: 0, R: 0, G: 0, C: 0 };
    let next = castSpell(state, 'p1', cardInstanceId);
    next = resolveTopOfStack(next);

    expect(next.cards.get(cardInstanceId)!.zone).toBe('graveyard');
  });

  it('resolves top item (LIFO) when multiple on stack', () => {
    const bolt1: CardDefinition = { ...makeInstant(), id: 'bolt-1' };
    const bolt2: CardDefinition = { ...makeInstant(), id: 'bolt-2' };
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [bolt1, bolt2], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const cards = getCardsInZone(state, 'p1', 'library');
    state.cards.set(cards[0].instanceId, { ...cards[0], zone: 'hand' });
    state.cards.set(cards[1].instanceId, { ...cards[1], zone: 'hand' });
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 5, G: 0, C: 0 };
    state = { ...state, phase: 'precombat_main' as any };

    state = castSpell(state, 'p1', cards[0].instanceId);
    state = castSpell(state, 'p1', cards[1].instanceId);
    expect(state.stack).toHaveLength(2);

    // Resolve top (bolt2)
    state = resolveTopOfStack(state);
    expect(state.stack).toHaveLength(1);
    expect(state.cards.get(cards[1].instanceId)!.zone).toBe('graveyard');
    // bolt1 still on stack
    expect(state.stack[0].cardInstanceId).toBe(cards[0].instanceId);
  });

  it('throws if stack is empty', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    expect(() => resolveTopOfStack(state)).toThrow();
  });

  it('resets priority after resolution', () => {
    const { state, cardInstanceId } = setupWithCardInHand(makeInstant());
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    let next = castSpell(state, 'p1', cardInstanceId);
    next.hasPriorityPassed[0] = true;
    next.hasPriorityPassed[1] = true;
    next = resolveTopOfStack(next);
    expect(next.hasPriorityPassed.every(p => p === false)).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: FAIL — resolveTopOfStack not found

**Step 3: Add resolveTopOfStack to `engine/src/stack.ts`**

```typescript
const PERMANENT_TYPES = ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'];

export function resolveTopOfStack(state: GameState): GameState {
  if (state.stack.length === 0) {
    throw new Error('Stack is empty');
  }

  const topItem = state.stack[state.stack.length - 1];
  const newStack = state.stack.slice(0, -1);

  const card = state.cards.get(topItem.cardInstanceId)!;
  const def = state.cardDefinitions.get(card.definitionId)!;

  const newCards = new Map(state.cards);
  const isPermanent = def.card_types.some(t => PERMANENT_TYPES.includes(t));

  if (isPermanent) {
    const isCreature = def.card_types.includes('creature');
    newCards.set(card.instanceId, {
      ...card,
      zone: 'battlefield',
      tapped: false,
      summoningSick: isCreature,
    });
  } else {
    // Instants and sorceries go to graveyard
    newCards.set(card.instanceId, { ...card, zone: 'graveyard' });
  }

  return {
    ...state,
    cards: newCards,
    stack: newStack,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/stack.ts engine/src/stack.test.ts
git commit -m "feat(engine): resolveTopOfStack — permanents to battlefield, spells to graveyard"
```

---

## Task 5: Flash Keyword Support

**Files:**
- Modify: `engine/src/stack.test.ts`

**Step 1: Write the test**

Add to the `canCastSpell` describe block in `stack.test.ts`:

```typescript
  it('allows flash creatures during combat', () => {
    const flashCreature: CardDefinition = {
      id: 'ambusher-1', name: 'Bounding Krasis', type_line: 'Creature — Fish Lizard',
      oracle_text: 'Flash\nWhen Bounding Krasis enters the battlefield, you may tap or untap target creature.',
      mana_cost: '{1}{G}{U}', cmc: 3,
      colors: ['G', 'U'], color_identity: ['G', 'U'], keywords: ['Flash'],
      card_types: ['creature'], power: 3, toughness: 3,
    };
    const { state, cardInstanceId } = setupWithCardInHand(flashCreature, 'combat');
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
  });

  it('allows flash creatures when stack is not empty', () => {
    const flashCreature: CardDefinition = {
      id: 'ambusher-1', name: 'Bounding Krasis', type_line: 'Creature — Fish Lizard',
      oracle_text: 'Flash',
      mana_cost: '{1}{G}{U}', cmc: 3,
      colors: ['G', 'U'], color_identity: ['G', 'U'], keywords: ['Flash'],
      card_types: ['creature'], power: 3, toughness: 3,
    };
    const { state, cardInstanceId } = setupWithCardInHand(flashCreature);
    state.stack.push({ id: 'stack_1', cardInstanceId: 'other', casterId: 'p2', targets: [] });
    expect(canCastSpell(state, 'p1', cardInstanceId)).toBe(true);
  });
```

**Step 2: Run test to verify it passes (already implemented in canCastSpell)**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: PASS (Flash logic is already in canCastSpell from Task 2)

**Step 3: Commit**

```bash
git add engine/src/stack.test.ts
git commit -m "test(engine): verify Flash keyword allows instant-speed casting"
```

---

## Task 6: Non-Active Player Casting (Instants on Opponents' Turns)

**Files:**
- Modify: `engine/src/stack.test.ts`

**Step 1: Write the test**

Add to `canCastSpell` describe block:

```typescript
  it('allows non-active player to cast instants (responding)', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeInstant()], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    // p1 is active, but p2 has priority and an instant in hand
    const card = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'hand' });
    state.players[1].manaPool = { W: 0, U: 0, B: 0, R: 1, G: 0, C: 0 };
    state = { ...state, phase: 'precombat_main' as any, priorityPlayerIndex: 1 };

    expect(canCastSpell(state, 'p2', card.instanceId)).toBe(true);
  });

  it('rejects non-active player casting sorceries', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [makeSorcery()], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'hand' });
    state.players[1].manaPool = { W: 0, U: 5, B: 0, R: 0, G: 0, C: 0 };
    state = { ...state, phase: 'precombat_main' as any, priorityPlayerIndex: 1 };

    expect(canCastSpell(state, 'p2', card.instanceId)).toBe(false);
  });
```

**Step 2: Run test to verify it passes**

Run: `cd engine && npx vitest run src/stack.test.ts`
Expected: PASS (non-active player instant casting already works; sorcery rejected by main phase + active player checks)

**Step 3: Commit**

```bash
git add engine/src/stack.test.ts
git commit -m "test(engine): verify non-active player instant casting and sorcery rejection"
```

---

## Task 7: Stack Integration Test — Full Cast-Resolve Cycle

**Files:**
- Create: `engine/src/stack-integration.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { initGameState, getCardsInZone } from './game-state';
import { advanceStep, performUntapStep } from './turn-manager';
import { playLand, tapLandForMana, drawCards } from './actions';
import { passPriority, allPlayersPassed } from './priority';
import { castSpell, resolveTopOfStack } from './stack';
import { CardDefinition } from './types';

function makeForest(): CardDefinition {
  return {
    id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
  };
}

function makeForest2(): CardDefinition {
  return {
    id: 'forest-2', name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
  };
}

function makeBear(): CardDefinition {
  return {
    id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear',
    oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
    colors: ['G'], color_identity: ['G'], keywords: [],
    card_types: ['creature'], power: 2, toughness: 2,
  };
}

function makeBolt(): CardDefinition {
  return {
    id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    mana_cost: '{R}', cmc: 1,
    colors: ['R'], color_identity: ['R'], keywords: [],
    card_types: ['instant'],
  };
}

function makeMountain(): CardDefinition {
  return {
    id: 'mountain-1', name: 'Mountain', type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['R'], keywords: [], card_types: ['land'],
  };
}

describe('Stack Integration: Cast and Resolve', () => {
  it('full turn: play lands, cast creature, resolve to battlefield', () => {
    const p1Cards = [makeForest(), makeForest2(), makeBear()];
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: p1Cards, commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Move all cards to hand for simplicity
    for (const card of state.cards.values()) {
      if (card.ownerId === 'p1') {
        state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      }
    }

    // Go to main phase
    state = { ...state, phase: 'precombat_main' as any };

    // Play a forest
    const forests = getCardsInZone(state, 'p1', 'hand').filter(c => {
      const def = state.cardDefinitions.get(c.definitionId)!;
      return def.card_types.includes('land');
    });
    state = playLand(state, 'p1', forests[0].instanceId);

    // Tap both lands (simulate turn 2 with 2 lands already on board)
    // Actually, let's just put 2 forests on battlefield tapped=false
    state.cards.set(forests[0].instanceId, { ...state.cards.get(forests[0].instanceId)!, zone: 'battlefield', tapped: false });
    state.cards.set(forests[1].instanceId, { ...state.cards.get(forests[1].instanceId)!, zone: 'battlefield', tapped: false });

    // Tap both for mana
    state = tapLandForMana(state, 'p1', forests[0].instanceId, 'G');
    state = tapLandForMana(state, 'p1', forests[1].instanceId, 'G');
    expect(state.players[0].manaPool.G).toBe(2);

    // Cast Grizzly Bears ({1}{G})
    const bear = getCardsInZone(state, 'p1', 'hand').find(c => {
      const def = state.cardDefinitions.get(c.definitionId)!;
      return def.name === 'Grizzly Bears';
    })!;
    state = castSpell(state, 'p1', bear.instanceId);
    expect(state.stack).toHaveLength(1);
    expect(state.players[0].manaPool.G).toBe(0); // paid {1}{G} from 2G

    // Both players pass priority
    state = passPriority(state);
    state = passPriority(state);
    expect(allPlayersPassed(state)).toBe(true);

    // Resolve
    state = resolveTopOfStack(state);
    expect(state.stack).toHaveLength(0);
    expect(state.cards.get(bear.instanceId)!.zone).toBe('battlefield');
    expect(state.cards.get(bear.instanceId)!.summoningSick).toBe(true);
  });

  it('instant responds to creature on stack, resolves first (LIFO)', () => {
    const p1Cards = [makeForest(), makeForest2(), makeBear()];
    const p2Cards = [makeMountain(), makeBolt()];
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: p1Cards, commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: p2Cards, commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Setup: p1 has bear in hand, 2 forests on battlefield
    // p2 has bolt in hand, 1 mountain on battlefield
    for (const card of state.cards.values()) {
      const def = state.cardDefinitions.get(card.definitionId)!;
      if (card.ownerId === 'p1') {
        if (def.card_types.includes('land')) {
          state.cards.set(card.instanceId, { ...card, zone: 'battlefield' });
        } else {
          state.cards.set(card.instanceId, { ...card, zone: 'hand' });
        }
      } else {
        if (def.card_types.includes('land')) {
          state.cards.set(card.instanceId, { ...card, zone: 'battlefield' });
        } else {
          state.cards.set(card.instanceId, { ...card, zone: 'hand' });
        }
      }
    }

    state = { ...state, phase: 'precombat_main' as any };

    // P1 taps lands and casts bear
    const p1Lands = getCardsInZone(state, 'p1', 'battlefield');
    state = tapLandForMana(state, 'p1', p1Lands[0].instanceId, 'G');
    state = tapLandForMana(state, 'p1', p1Lands[1].instanceId, 'G');

    const bear = getCardsInZone(state, 'p1', 'hand')[0];
    state = castSpell(state, 'p1', bear.instanceId);
    expect(state.stack).toHaveLength(1);

    // P2 responds with bolt (targets the bear on the stack — targeting simplified for now)
    const p2Land = getCardsInZone(state, 'p2', 'battlefield')[0];
    state = tapLandForMana(state, 'p2', p2Land.instanceId, 'R');

    const bolt = getCardsInZone(state, 'p2', 'hand')[0];
    state = castSpell(state, 'p2', bolt.instanceId, [bear.instanceId]);
    expect(state.stack).toHaveLength(2);

    // Both pass — bolt resolves first (LIFO)
    state = resolveTopOfStack(state);
    expect(state.cards.get(bolt.instanceId)!.zone).toBe('graveyard');
    expect(state.stack).toHaveLength(1);

    // Bear still on stack, resolves next
    state = resolveTopOfStack(state);
    expect(state.cards.get(bear.instanceId)!.zone).toBe('battlefield');
    expect(state.stack).toHaveLength(0);
  });
});
```

**Step 2: Run all tests**

Run: `cd engine && npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add engine/src/stack-integration.test.ts
git commit -m "test(engine): stack integration — cast/resolve cycle, LIFO ordering"
```

---

## Task 8: Update Barrel Export

**Files:**
- Modify: `engine/src/index.ts`

**Step 1: Add stack export**

Add to `engine/src/index.ts`:

```typescript
export * from './stack';
```

**Step 2: Verify build**

Run: `cd engine && npx tsc --noEmit`
Expected: No errors

**Step 3: Run all tests**

Run: `cd engine && npx vitest run`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add engine/src/index.ts
git commit -m "feat(engine): export stack module from barrel"
```

---

## Summary

After completing all 8 tasks, Phase 2 delivers:

| Module | What it does |
|--------|-------------|
| `types.ts` (updated) | `StackItem` interface, `stack` field on `GameState` |
| `stack.ts` (new) | `canCastSpell`, `castSpell`, `resolveTopOfStack` |
| `stack.test.ts` | 20+ unit tests for casting validation and resolution |
| `stack-integration.test.ts` | Full cast-resolve cycles with priority |

**Key behaviors implemented:**
- Sorcery-speed timing (main phase, active player, empty stack)
- Instant-speed timing (any phase, any player with priority)
- Flash keyword support
- Mana payment on cast
- LIFO stack ordering
- Permanents → battlefield (creatures get summoning sickness)
- Instants/sorceries → graveyard after resolution
- Priority reset after cast and resolution

Phase 3 (Combat) builds on this to add attackers, blockers, and damage.
