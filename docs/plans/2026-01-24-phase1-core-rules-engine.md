# Phase 1: Core Rules Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the foundational game state, turn manager, and mana system for a Commander rules engine in TypeScript.

**Architecture:** Immutable-style game state object passed through pure functions. Turn manager drives phase/step progression with priority passing. Mana system tracks colored/colorless pools with payment validation.

**Tech Stack:** TypeScript, Vitest (testing), Node.js ESM modules

---

## Task 1: Project Scaffolding

**Files:**
- Create: `engine/package.json`
- Create: `engine/tsconfig.json`
- Create: `engine/vitest.config.ts`

**Step 1: Create engine directory and package.json**

```json
{
  "name": "commander-engine",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "sourceMap": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 4: Install dependencies**

Run: `cd engine && npm install`

**Step 5: Commit**

```bash
git add engine/package.json engine/tsconfig.json engine/vitest.config.ts engine/package-lock.json
git commit -m "feat(engine): scaffold project with TypeScript and Vitest"
```

---

## Task 2: Core Types — Card, Player, Zone Definitions

**Files:**
- Create: `engine/src/types.ts`
- Test: `engine/src/types.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { ManaColor, Zone, Phase, Step, CardType } from './types';

describe('Core Types', () => {
  it('defines all five mana colors plus colorless', () => {
    const colors: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];
    expect(colors).toHaveLength(6);
  });

  it('defines all seven zones', () => {
    const zones: Zone[] = [
      'library', 'hand', 'battlefield', 'graveyard',
      'exile', 'stack', 'command'
    ];
    expect(zones).toHaveLength(7);
  });

  it('defines all phases', () => {
    const phases: Phase[] = [
      'beginning', 'precombat_main', 'combat',
      'postcombat_main', 'ending'
    ];
    expect(phases).toHaveLength(5);
  });

  it('defines all steps', () => {
    const steps: Step[] = [
      'untap', 'upkeep', 'draw',
      'begin_combat', 'declare_attackers', 'declare_blockers',
      'first_strike_damage', 'combat_damage', 'end_of_combat',
      'end', 'cleanup'
    ];
    expect(steps).toHaveLength(11);
  });

  it('defines card types', () => {
    const types: CardType[] = [
      'creature', 'instant', 'sorcery', 'artifact',
      'enchantment', 'planeswalker', 'land', 'battle'
    ];
    expect(types).toHaveLength(8);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/types.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
export type ManaColor = 'W' | 'U' | 'B' | 'R' | 'G' | 'C';

export type Zone = 'library' | 'hand' | 'battlefield' | 'graveyard' | 'exile' | 'stack' | 'command';

export type Phase = 'beginning' | 'precombat_main' | 'combat' | 'postcombat_main' | 'ending';

export type Step =
  | 'untap' | 'upkeep' | 'draw'
  | 'begin_combat' | 'declare_attackers' | 'declare_blockers'
  | 'first_strike_damage' | 'combat_damage' | 'end_of_combat'
  | 'end' | 'cleanup';

export type CardType = 'creature' | 'instant' | 'sorcery' | 'artifact' | 'enchantment' | 'planeswalker' | 'land' | 'battle';

export interface ManaCost {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
  generic: number;
}

export interface CardDefinition {
  id: string;
  name: string;
  type_line: string;
  oracle_text: string;
  mana_cost: string;
  cmc: number;
  colors: ManaColor[];
  color_identity: ManaColor[];
  keywords: string[];
  power?: number;
  toughness?: number;
  card_types: CardType[];
}

export interface CardInstance {
  instanceId: string;
  definitionId: string;
  ownerId: string;
  zone: Zone;
  tapped: boolean;
  summoningSick: boolean;
  counters: Record<string, number>;
  attachedTo?: string;
  damage: number;
  isCommander: boolean;
}

export interface ManaPool {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number;
}

export interface Player {
  id: string;
  name: string;
  life: number;
  commanderDamage: Record<string, number>; // cardInstanceId -> damage taken
  commanderTax: number;
  manaPool: ManaPool;
  hasPlayedLand: boolean;
  hasPriority: boolean;
  hasLost: boolean;
}

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
}

export function emptyManaPool(): ManaPool {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

export function createPlayer(id: string, name: string, life: number = 40): Player {
  return {
    id,
    name,
    life,
    commanderDamage: {},
    commanderTax: 0,
    manaPool: emptyManaPool(),
    hasPlayedLand: false,
    hasPriority: false,
    hasLost: false,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/types.ts engine/src/types.test.ts
git commit -m "feat(engine): define core types — cards, players, zones, phases"
```

---

## Task 3: Game State — Initialization and Queries

**Files:**
- Create: `engine/src/game-state.ts`
- Test: `engine/src/game-state.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { initGameState, getPlayer, getActivePlayer, getCardsInZone } from './game-state';
import { CardDefinition } from './types';

function makeLand(id: string, name: string, color: 'W' | 'U' | 'B' | 'R' | 'G'): CardDefinition {
  return {
    id,
    name,
    type_line: 'Basic Land',
    oracle_text: `{T}: Add {${color}}.`,
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: [color],
    keywords: [],
    card_types: ['land'],
  };
}

function makeCreature(id: string, name: string, power: number, toughness: number): CardDefinition {
  return {
    id,
    name,
    type_line: 'Creature',
    oracle_text: '',
    mana_cost: '{2}{G}',
    cmc: 3,
    colors: ['G'],
    color_identity: ['G'],
    keywords: [],
    card_types: ['creature'],
    power,
    toughness,
  };
}

describe('Game State', () => {
  it('initializes a 2-player game with correct defaults', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [] as CardDefinition[], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [] as CardDefinition[], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);

    expect(state.players).toHaveLength(2);
    expect(state.players[0].life).toBe(40);
    expect(state.players[1].life).toBe(40);
    expect(state.activePlayerIndex).toBe(0);
    expect(state.turnNumber).toBe(1);
    expect(state.phase).toBe('beginning');
    expect(state.step).toBe('untap');
  });

  it('places deck cards in library zone', () => {
    const cards = [makeLand('l1', 'Forest', 'G'), makeCreature('c1', 'Bear', 2, 2)];
    const decks = [
      { playerId: 'p1', name: 'Alice', cards, commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);

    const libraryCards = getCardsInZone(state, 'p1', 'library');
    expect(libraryCards).toHaveLength(2);
  });

  it('getPlayer returns the correct player', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [] as CardDefinition[], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [] as CardDefinition[], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    const player = getPlayer(state, 'p1');
    expect(player.name).toBe('Alice');
  });

  it('getActivePlayer returns the player whose turn it is', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [] as CardDefinition[], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [] as CardDefinition[], commanderId: 'cmd2' },
    ];
    const state = initGameState(decks);
    const active = getActivePlayer(state);
    expect(active.id).toBe('p1');
  });

  it('supports 4-player games', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [] as CardDefinition[], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [] as CardDefinition[], commanderId: 'cmd2' },
      { playerId: 'p3', name: 'Carol', cards: [] as CardDefinition[], commanderId: 'cmd3' },
      { playerId: 'p4', name: 'Dave', cards: [] as CardDefinition[], commanderId: 'cmd4' },
    ];
    const state = initGameState(decks);
    expect(state.players).toHaveLength(4);
    expect(state.hasPriorityPassed).toHaveLength(4);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/game-state.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
import { GameState, CardInstance, CardDefinition, Player, Zone, createPlayer } from './types';

export interface DeckInput {
  playerId: string;
  name: string;
  cards: CardDefinition[];
  commanderId: string;
}

let instanceCounter = 0;
function nextInstanceId(): string {
  return `inst_${++instanceCounter}`;
}

export function initGameState(decks: DeckInput[]): GameState {
  instanceCounter = 0;

  const players: Player[] = decks.map(d => createPlayer(d.playerId, d.name));
  const cards = new Map<string, CardInstance>();
  const cardDefinitions = new Map<string, CardDefinition>();

  for (const deck of decks) {
    for (const def of deck.cards) {
      cardDefinitions.set(def.id, def);

      const instance: CardInstance = {
        instanceId: nextInstanceId(),
        definitionId: def.id,
        ownerId: deck.playerId,
        zone: 'library',
        tapped: false,
        summoningSick: true,
        counters: {},
        damage: 0,
        isCommander: def.id === deck.commanderId,
      };
      cards.set(instance.instanceId, instance);
    }
  }

  return {
    players,
    cards,
    cardDefinitions,
    activePlayerIndex: 0,
    priorityPlayerIndex: 0,
    phase: 'beginning',
    step: 'untap',
    turnNumber: 1,
    hasPriorityPassed: new Array(decks.length).fill(false),
  };
}

export function getPlayer(state: GameState, playerId: string): Player {
  const player = state.players.find(p => p.id === playerId);
  if (!player) throw new Error(`Player not found: ${playerId}`);
  return player;
}

export function getActivePlayer(state: GameState): Player {
  return state.players[state.activePlayerIndex];
}

export function getCardsInZone(state: GameState, playerId: string, zone: Zone): CardInstance[] {
  const result: CardInstance[] = [];
  for (const card of state.cards.values()) {
    if (card.ownerId === playerId && card.zone === zone) {
      result.push(card);
    }
  }
  return result;
}

export function getCardDefinition(state: GameState, card: CardInstance): CardDefinition {
  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) throw new Error(`Card definition not found: ${card.definitionId}`);
  return def;
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/game-state.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/game-state.ts engine/src/game-state.test.ts
git commit -m "feat(engine): game state initialization and query helpers"
```

---

## Task 4: Mana System — Pool Management and Cost Payment

**Files:**
- Create: `engine/src/mana.ts`
- Test: `engine/src/mana.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseManaString, addMana, canPayCost, payManaCost, totalMana } from './mana';
import { emptyManaPool, ManaPool, ManaCost } from './types';

describe('Mana System', () => {
  describe('parseManaString', () => {
    it('parses {2}{G}{G}', () => {
      const cost = parseManaString('{2}{G}{G}');
      expect(cost).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 2 });
    });

    it('parses {W}{U}{B}{R}{G}', () => {
      const cost = parseManaString('{W}{U}{B}{R}{G}');
      expect(cost).toEqual({ W: 1, U: 1, B: 1, R: 1, G: 1, C: 0, generic: 0 });
    });

    it('parses {5}', () => {
      const cost = parseManaString('{5}');
      expect(cost).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 5 });
    });

    it('parses empty string (lands)', () => {
      const cost = parseManaString('');
      expect(cost).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 });
    });

    it('parses {3}{W}{W}', () => {
      const cost = parseManaString('{3}{W}{W}');
      expect(cost).toEqual({ W: 2, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 3 });
    });

    it('parses {C} for colorless', () => {
      const cost = parseManaString('{2}{C}');
      expect(cost).toEqual({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 1, generic: 2 });
    });
  });

  describe('addMana', () => {
    it('adds colored mana to pool', () => {
      const pool = emptyManaPool();
      const result = addMana(pool, 'G', 1);
      expect(result.G).toBe(1);
    });

    it('accumulates mana', () => {
      let pool = emptyManaPool();
      pool = addMana(pool, 'R', 2);
      pool = addMana(pool, 'R', 1);
      expect(pool.R).toBe(3);
    });
  });

  describe('canPayCost', () => {
    it('returns true when pool has exact mana', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 0 };
      expect(canPayCost(pool, cost)).toBe(true);
    });

    it('returns true when pool has excess for generic', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 3, G: 2, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 2 };
      expect(canPayCost(pool, cost)).toBe(true);
    });

    it('returns false when not enough colored mana', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 0 };
      expect(canPayCost(pool, cost)).toBe(false);
    });

    it('returns false when not enough total mana for generic', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0, generic: 3 };
      expect(canPayCost(pool, cost)).toBe(false);
    });

    it('handles colorless mana requirement', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1, generic: 0 };
      expect(canPayCost(pool, cost)).toBe(true);
    });

    it('colored mana cannot pay colorless requirement', () => {
      const pool: ManaPool = { W: 1, U: 0, B: 0, R: 0, G: 0, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 1, generic: 0 };
      expect(canPayCost(pool, cost)).toBe(false);
    });
  });

  describe('payManaCost', () => {
    it('removes colored mana first, then generic from remainder', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 2, G: 3, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 1 };
      const result = payManaCost(pool, cost);
      expect(result.G).toBe(1);
      expect(result.R).toBe(1);
    });

    it('throws if cannot pay', () => {
      const pool: ManaPool = { W: 0, U: 0, B: 0, R: 0, G: 1, C: 0 };
      const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 2, C: 0, generic: 0 };
      expect(() => payManaCost(pool, cost)).toThrow();
    });
  });

  describe('totalMana', () => {
    it('sums all colors', () => {
      const pool: ManaPool = { W: 1, U: 2, B: 0, R: 1, G: 3, C: 0 };
      expect(totalMana(pool)).toBe(7);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/mana.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
import { ManaCost, ManaColor, ManaPool, emptyManaPool } from './types';

const COLOR_SYMBOLS: ManaColor[] = ['W', 'U', 'B', 'R', 'G', 'C'];

export function parseManaString(manaString: string): ManaCost {
  const cost: ManaCost = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
  if (!manaString) return cost;

  const symbols = manaString.match(/\{[^}]+\}/g) || [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1);
    if (COLOR_SYMBOLS.includes(inner as ManaColor)) {
      cost[inner as ManaColor]++;
    } else {
      const num = parseInt(inner, 10);
      if (!isNaN(num)) {
        cost.generic += num;
      }
    }
  }
  return cost;
}

export function addMana(pool: ManaPool, color: ManaColor, amount: number): ManaPool {
  return { ...pool, [color]: pool[color] + amount };
}

export function totalMana(pool: ManaPool): number {
  return pool.W + pool.U + pool.B + pool.R + pool.G + pool.C;
}

export function canPayCost(pool: ManaPool, cost: ManaCost): boolean {
  let remaining = 0;
  for (const color of COLOR_SYMBOLS) {
    if (pool[color] < cost[color]) return false;
    remaining += pool[color] - cost[color];
  }
  return remaining >= cost.generic;
}

export function payManaCost(pool: ManaPool, cost: ManaCost): ManaPool {
  if (!canPayCost(pool, cost)) {
    throw new Error('Cannot pay mana cost');
  }

  const result: ManaPool = { ...pool };

  // Pay colored costs first
  for (const color of COLOR_SYMBOLS) {
    result[color] -= cost[color];
  }

  // Pay generic from remaining (largest pools first to preserve options)
  let genericLeft = cost.generic;
  const colorsByPool = [...COLOR_SYMBOLS].sort((a, b) => result[b] - result[a]);
  for (const color of colorsByPool) {
    const take = Math.min(result[color], genericLeft);
    result[color] -= take;
    genericLeft -= take;
    if (genericLeft === 0) break;
  }

  return result;
}

export function emptyPool(): ManaPool {
  return emptyManaPool();
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/mana.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/mana.ts engine/src/mana.test.ts
git commit -m "feat(engine): mana system — parsing, pools, cost payment"
```

---

## Task 5: Turn Manager — Phase/Step Progression

**Files:**
- Create: `engine/src/turn-manager.ts`
- Test: `engine/src/turn-manager.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { advanceStep, advanceToNextTurn, STEP_ORDER } from './turn-manager';
import { initGameState } from './game-state';
import { CardDefinition } from './types';

function makeEmptyDecks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `Player ${i + 1}`,
    cards: [] as CardDefinition[],
    commanderId: `cmd${i + 1}`,
  }));
}

describe('Turn Manager', () => {
  describe('STEP_ORDER', () => {
    it('has 11 steps in correct MTG order', () => {
      expect(STEP_ORDER).toEqual([
        'untap', 'upkeep', 'draw',
        'begin_combat', 'declare_attackers', 'declare_blockers',
        'first_strike_damage', 'combat_damage', 'end_of_combat',
        'end', 'cleanup',
      ]);
    });
  });

  describe('advanceStep', () => {
    it('advances from untap to upkeep', () => {
      const state = initGameState(makeEmptyDecks(2));
      const next = advanceStep(state);
      expect(next.step).toBe('upkeep');
      expect(next.phase).toBe('beginning');
    });

    it('advances from draw to begin_combat (entering precombat_main then combat)', () => {
      let state = initGameState(makeEmptyDecks(2));
      state = { ...state, step: 'draw', phase: 'beginning' };
      const next = advanceStep(state);
      expect(next.step).toBe('begin_combat');
      expect(next.phase).toBe('precombat_main');
    });

    it('advances from end_of_combat to end (through postcombat_main)', () => {
      let state = initGameState(makeEmptyDecks(2));
      state = { ...state, step: 'end_of_combat', phase: 'combat' };
      const next = advanceStep(state);
      expect(next.step).toBe('end');
      expect(next.phase).toBe('postcombat_main');
    });

    it('cleanup wraps to untap of next turn', () => {
      let state = initGameState(makeEmptyDecks(2));
      state = { ...state, step: 'cleanup', phase: 'ending' };
      const next = advanceStep(state);
      expect(next.step).toBe('untap');
      expect(next.phase).toBe('beginning');
      expect(next.activePlayerIndex).toBe(1);
      expect(next.turnNumber).toBe(2);
    });

    it('resets hasPlayedLand on new turn', () => {
      let state = initGameState(makeEmptyDecks(2));
      state.players[0].hasPlayedLand = true;
      state = { ...state, step: 'cleanup', phase: 'ending' };
      const next = advanceStep(state);
      expect(next.players[1].hasPlayedLand).toBe(false);
    });

    it('resets priority passed flags on step advance', () => {
      let state = initGameState(makeEmptyDecks(2));
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      const next = advanceStep(state);
      expect(next.hasPriorityPassed.every(p => p === false)).toBe(true);
    });
  });

  describe('advanceToNextTurn', () => {
    it('wraps active player around (2 players)', () => {
      let state = initGameState(makeEmptyDecks(2));
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(1);
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(0);
      expect(state.turnNumber).toBe(3);
    });

    it('wraps active player around (4 players)', () => {
      let state = initGameState(makeEmptyDecks(4));
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(1);
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(2);
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(3);
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(0);
      expect(state.turnNumber).toBe(5);
    });

    it('skips players who have lost', () => {
      let state = initGameState(makeEmptyDecks(3));
      state.players[1].hasLost = true;
      state = advanceToNextTurn(state);
      expect(state.activePlayerIndex).toBe(2);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/turn-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
import { GameState, Phase, Step } from './types';

export const STEP_ORDER: Step[] = [
  'untap', 'upkeep', 'draw',
  'begin_combat', 'declare_attackers', 'declare_blockers',
  'first_strike_damage', 'combat_damage', 'end_of_combat',
  'end', 'cleanup',
];

const STEP_TO_PHASE: Record<Step, Phase> = {
  untap: 'beginning',
  upkeep: 'beginning',
  draw: 'beginning',
  begin_combat: 'combat',
  declare_attackers: 'combat',
  declare_blockers: 'combat',
  first_strike_damage: 'combat',
  combat_damage: 'combat',
  end_of_combat: 'combat',
  end: 'ending',
  cleanup: 'ending',
};

export function stepToPhase(step: Step): Phase {
  return STEP_TO_PHASE[step];
}

export function advanceStep(state: GameState): GameState {
  const currentIndex = STEP_ORDER.indexOf(state.step);

  if (currentIndex === STEP_ORDER.length - 1) {
    // Cleanup -> next turn
    return advanceToNextTurn(state);
  }

  const nextStep = STEP_ORDER[currentIndex + 1];
  const nextPhase = derivePhase(state.step, nextStep);

  return {
    ...state,
    step: nextStep,
    phase: nextPhase,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}

function derivePhase(currentStep: Step, nextStep: Step): Phase {
  // Main phases are between beginning/combat and combat/ending
  if (currentStep === 'draw' && nextStep === 'begin_combat') {
    return 'precombat_main';
  }
  if (currentStep === 'end_of_combat' && nextStep === 'end') {
    return 'postcombat_main';
  }
  return STEP_TO_PHASE[nextStep];
}

export function advanceToNextTurn(state: GameState): GameState {
  const playerCount = state.players.length;
  let nextIndex = (state.activePlayerIndex + 1) % playerCount;

  // Skip players who have lost
  let attempts = 0;
  while (state.players[nextIndex].hasLost && attempts < playerCount) {
    nextIndex = (nextIndex + 1) % playerCount;
    attempts++;
  }

  const updatedPlayers = state.players.map((p, i) => {
    if (i === nextIndex) {
      return { ...p, hasPlayedLand: false, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } };
    }
    return { ...p, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 } };
  });

  return {
    ...state,
    players: updatedPlayers,
    activePlayerIndex: nextIndex,
    priorityPlayerIndex: nextIndex,
    phase: 'beginning',
    step: 'untap',
    turnNumber: state.turnNumber + 1,
    hasPriorityPassed: new Array(playerCount).fill(false),
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/turn-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/turn-manager.ts engine/src/turn-manager.test.ts
git commit -m "feat(engine): turn manager — phase/step progression, turn order"
```

---

## Task 6: Priority System — Passing and Resolution

**Files:**
- Create: `engine/src/priority.ts`
- Test: `engine/src/priority.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { passPriority, allPlayersPassed, resetPriority, getNextPriorityPlayer } from './priority';
import { initGameState } from './game-state';
import { CardDefinition } from './types';

function makeEmptyDecks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    playerId: `p${i + 1}`,
    name: `Player ${i + 1}`,
    cards: [] as CardDefinition[],
    commanderId: `cmd${i + 1}`,
  }));
}

describe('Priority System', () => {
  describe('passPriority', () => {
    it('marks current player as passed and moves to next', () => {
      const state = initGameState(makeEmptyDecks(2));
      const next = passPriority(state);
      expect(next.hasPriorityPassed[0]).toBe(true);
      expect(next.priorityPlayerIndex).toBe(1);
    });

    it('skips players who have lost', () => {
      const state = initGameState(makeEmptyDecks(3));
      state.players[1].hasLost = true;
      const next = passPriority(state);
      expect(next.priorityPlayerIndex).toBe(2);
    });
  });

  describe('allPlayersPassed', () => {
    it('returns false when not all players passed', () => {
      const state = initGameState(makeEmptyDecks(2));
      expect(allPlayersPassed(state)).toBe(false);
    });

    it('returns true when all active players passed', () => {
      const state = initGameState(makeEmptyDecks(2));
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      expect(allPlayersPassed(state)).toBe(true);
    });

    it('ignores players who have lost', () => {
      const state = initGameState(makeEmptyDecks(3));
      state.players[2].hasLost = true;
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      expect(allPlayersPassed(state)).toBe(true);
    });
  });

  describe('resetPriority', () => {
    it('resets all passed flags and gives priority to active player', () => {
      const state = initGameState(makeEmptyDecks(2));
      state.hasPriorityPassed[0] = true;
      state.hasPriorityPassed[1] = true;
      const next = resetPriority(state);
      expect(next.hasPriorityPassed.every(p => p === false)).toBe(true);
      expect(next.priorityPlayerIndex).toBe(state.activePlayerIndex);
    });
  });

  describe('getNextPriorityPlayer', () => {
    it('returns next player in turn order', () => {
      const state = initGameState(makeEmptyDecks(4));
      expect(getNextPriorityPlayer(state, 0)).toBe(1);
      expect(getNextPriorityPlayer(state, 3)).toBe(0);
    });

    it('skips eliminated players', () => {
      const state = initGameState(makeEmptyDecks(4));
      state.players[1].hasLost = true;
      expect(getNextPriorityPlayer(state, 0)).toBe(2);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/priority.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
import { GameState } from './types';

export function getNextPriorityPlayer(state: GameState, currentIndex: number): number {
  const count = state.players.length;
  let next = (currentIndex + 1) % count;
  let attempts = 0;
  while (state.players[next].hasLost && attempts < count) {
    next = (next + 1) % count;
    attempts++;
  }
  return next;
}

export function passPriority(state: GameState): GameState {
  const newPassed = [...state.hasPriorityPassed];
  newPassed[state.priorityPlayerIndex] = true;

  const nextPlayer = getNextPriorityPlayer(state, state.priorityPlayerIndex);

  return {
    ...state,
    hasPriorityPassed: newPassed,
    priorityPlayerIndex: nextPlayer,
  };
}

export function allPlayersPassed(state: GameState): boolean {
  return state.players.every((player, i) =>
    player.hasLost || state.hasPriorityPassed[i]
  );
}

export function resetPriority(state: GameState): GameState {
  return {
    ...state,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/priority.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/priority.ts engine/src/priority.test.ts
git commit -m "feat(engine): priority system — passing, resolution detection"
```

---

## Task 7: Land Playing — Validation and Zone Movement

**Files:**
- Create: `engine/src/actions.ts`
- Test: `engine/src/actions.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import { playLand, canPlayLand, tapLandForMana } from './actions';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';

function makeForest(): CardDefinition {
  return {
    id: 'forest-1',
    name: 'Forest',
    type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['G'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeIsland(): CardDefinition {
  return {
    id: 'island-1',
    name: 'Island',
    type_line: 'Basic Land — Island',
    oracle_text: '{T}: Add {U}.',
    mana_cost: '',
    cmc: 0,
    colors: [],
    color_identity: ['U'],
    keywords: [],
    card_types: ['land'],
  };
}

function makeCreature(): CardDefinition {
  return {
    id: 'bear-1',
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

describe('Land Actions', () => {
  describe('canPlayLand', () => {
    it('returns true during main phase with land in hand', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      // Move card to hand, set main phase
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main', step: 'begin_combat' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(true);
    });

    it('returns false if not active player', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      state = { ...state, activePlayerIndex: 1, phase: 'precombat_main' };
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false if already played a land this turn', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      state.players[0].hasPlayedLand = true;
      state = { ...state, phase: 'precombat_main' };
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false if not a main phase', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'combat' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });

    it('returns false if card is not a land', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeCreature()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      expect(canPlayLand(state, 'p1', card.instanceId)).toBe(false);
    });
  });

  describe('playLand', () => {
    it('moves land from hand to battlefield and marks land played', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'hand' });
      state = { ...state, phase: 'precombat_main' };

      const next = playLand(state, 'p1', card.instanceId);
      const played = next.cards.get(card.instanceId)!;
      expect(played.zone).toBe('battlefield');
      expect(next.players[0].hasPlayedLand).toBe(true);
    });
  });

  describe('tapLandForMana', () => {
    it('taps a land and adds mana to pool', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: false });

      const next = tapLandForMana(state, 'p1', card.instanceId, 'G');
      expect(next.cards.get(card.instanceId)!.tapped).toBe(true);
      expect(next.players[0].manaPool.G).toBe(1);
    });

    it('throws if land is already tapped', () => {
      const decks = [{
        playerId: 'p1', name: 'Alice',
        cards: [makeForest()], commanderId: 'cmd1',
      }, {
        playerId: 'p2', name: 'Bob',
        cards: [], commanderId: 'cmd2',
      }];
      let state = initGameState(decks);
      const card = getCardsInZone(state, 'p1', 'library')[0];
      state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: true });

      expect(() => tapLandForMana(state, 'p1', card.instanceId, 'G')).toThrow();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/actions.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
import { GameState, ManaColor, Phase } from './types';
import { getCardDefinition } from './game-state';
import { addMana } from './mana';

const MAIN_PHASES: Phase[] = ['precombat_main', 'postcombat_main'];

export function canPlayLand(state: GameState, playerId: string, cardInstanceId: string): boolean {
  const playerIndex = state.players.findIndex(p => p.id === playerId);
  if (playerIndex === -1) return false;

  // Must be active player
  if (state.activePlayerIndex !== playerIndex) return false;

  // Must be main phase
  if (!MAIN_PHASES.includes(state.phase)) return false;

  // Must not have played a land this turn
  if (state.players[playerIndex].hasPlayedLand) return false;

  // Card must exist, be in hand, and be a land
  const card = state.cards.get(cardInstanceId);
  if (!card || card.zone !== 'hand' || card.ownerId !== playerId) return false;

  const def = getCardDefinition(state, card);
  if (!def.card_types.includes('land')) return false;

  return true;
}

export function playLand(state: GameState, playerId: string, cardInstanceId: string): GameState {
  if (!canPlayLand(state, playerId, cardInstanceId)) {
    throw new Error('Cannot play land');
  }

  const newCards = new Map(state.cards);
  const card = newCards.get(cardInstanceId)!;
  newCards.set(cardInstanceId, { ...card, zone: 'battlefield', tapped: false, summoningSick: false });

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, hasPlayedLand: true } : p
  );

  return { ...state, cards: newCards, players: newPlayers };
}

export function tapLandForMana(state: GameState, playerId: string, cardInstanceId: string, color: ManaColor): GameState {
  const card = state.cards.get(cardInstanceId);
  if (!card) throw new Error('Card not found');
  if (card.ownerId !== playerId) throw new Error('Not your card');
  if (card.zone !== 'battlefield') throw new Error('Card not on battlefield');
  if (card.tapped) throw new Error('Card already tapped');

  const newCards = new Map(state.cards);
  newCards.set(cardInstanceId, { ...card, tapped: true });

  const playerIndex = state.players.findIndex(p => p.id === playerId);
  const newPlayers = state.players.map((p, i) =>
    i === playerIndex ? { ...p, manaPool: addMana(p.manaPool, color, 1) } : p
  );

  return { ...state, cards: newCards, players: newPlayers };
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/actions.ts engine/src/actions.test.ts
git commit -m "feat(engine): land actions — play land, tap for mana"
```

---

## Task 8: Untap Step — Untap All Permanents

**Files:**
- Modify: `engine/src/turn-manager.ts`
- Test: `engine/src/turn-manager.test.ts` (add tests)

**Step 1: Add untap tests**

Add to `turn-manager.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { advanceStep, advanceToNextTurn, performUntapStep, STEP_ORDER } from './turn-manager';
import { initGameState, getCardsInZone } from './game-state';
import { CardDefinition } from './types';

// ... existing tests ...

describe('performUntapStep', () => {
  it('untaps all permanents controlled by active player', () => {
    const forest: CardDefinition = {
      id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
      colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
    };
    const decks = [{
      playerId: 'p1', name: 'Alice', cards: [forest], commanderId: 'cmd1',
    }, {
      playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2',
    }];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: true });

    const next = performUntapStep(state);
    expect(next.cards.get(card.instanceId)!.tapped).toBe(false);
  });

  it('removes summoning sickness from creatures', () => {
    const bear: CardDefinition = {
      id: 'bear-1', name: 'Bear', type_line: 'Creature — Bear',
      oracle_text: '', mana_cost: '{1}{G}', cmc: 2,
      colors: ['G'], color_identity: ['G'], keywords: [],
      card_types: ['creature'], power: 2, toughness: 2,
    };
    const decks = [{
      playerId: 'p1', name: 'Alice', cards: [bear], commanderId: 'cmd1',
    }, {
      playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2',
    }];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', summoningSick: true });

    const next = performUntapStep(state);
    expect(next.cards.get(card.instanceId)!.summoningSick).toBe(false);
  });

  it('does not untap other players permanents', () => {
    const forest: CardDefinition = {
      id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
      colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
    };
    const decks = [{
      playerId: 'p1', name: 'Alice', cards: [], commanderId: 'cmd1',
    }, {
      playerId: 'p2', name: 'Bob', cards: [forest], commanderId: 'cmd2',
    }];
    let state = initGameState(decks);
    const card = getCardsInZone(state, 'p2', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'battlefield', tapped: true });

    // p1 is active player
    const next = performUntapStep(state);
    expect(next.cards.get(card.instanceId)!.tapped).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/turn-manager.test.ts`
Expected: FAIL — performUntapStep not found

**Step 3: Add performUntapStep to turn-manager.ts**

Add to `engine/src/turn-manager.ts`:

```typescript
export function performUntapStep(state: GameState): GameState {
  const activePlayerId = state.players[state.activePlayerIndex].id;
  const newCards = new Map(state.cards);

  for (const [id, card] of newCards) {
    if (card.ownerId === activePlayerId && card.zone === 'battlefield') {
      newCards.set(id, { ...card, tapped: false, summoningSick: false });
    }
  }

  return { ...state, cards: newCards };
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/turn-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/turn-manager.ts engine/src/turn-manager.test.ts
git commit -m "feat(engine): untap step — untaps active player's permanents"
```

---

## Task 9: Draw Step — Draw Cards

**Files:**
- Modify: `engine/src/actions.ts`
- Test: `engine/src/actions.test.ts` (add tests)

**Step 1: Add draw tests**

Add to `actions.test.ts`:

```typescript
import { playLand, canPlayLand, tapLandForMana, drawCards } from './actions';

// ... existing tests ...

describe('drawCards', () => {
  it('moves top card from library to hand', () => {
    const forest = makeForest();
    const decks = [{
      playerId: 'p1', name: 'Alice', cards: [forest], commanderId: 'cmd1',
    }, {
      playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2',
    }];
    const state = initGameState(decks);

    const next = drawCards(state, 'p1', 1);
    const hand = getCardsInZone(next, 'p1', 'hand');
    const library = getCardsInZone(next, 'p1', 'library');
    expect(hand).toHaveLength(1);
    expect(library).toHaveLength(0);
  });

  it('draws multiple cards', () => {
    const cards = [makeForest(), makeIsland()];
    const decks = [{
      playerId: 'p1', name: 'Alice', cards, commanderId: 'cmd1',
    }, {
      playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2',
    }];
    const state = initGameState(decks);

    const next = drawCards(state, 'p1', 2);
    const hand = getCardsInZone(next, 'p1', 'hand');
    expect(hand).toHaveLength(2);
  });

  it('draws fewer if library is empty', () => {
    const decks = [{
      playerId: 'p1', name: 'Alice', cards: [makeForest()], commanderId: 'cmd1',
    }, {
      playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2',
    }];
    const state = initGameState(decks);

    const next = drawCards(state, 'p1', 5);
    const hand = getCardsInZone(next, 'p1', 'hand');
    expect(hand).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/actions.test.ts`
Expected: FAIL — drawCards not found

**Step 3: Add drawCards to actions.ts**

```typescript
export function drawCards(state: GameState, playerId: string, count: number): GameState {
  const library = getCardsInZone(state, playerId, 'library');
  const toDraw = Math.min(count, library.length);

  const newCards = new Map(state.cards);
  for (let i = 0; i < toDraw; i++) {
    const card = library[i];
    newCards.set(card.instanceId, { ...card, zone: 'hand' });
  }

  return { ...state, cards: newCards };
}
```

Add import of `getCardsInZone` at the top of `actions.ts`:

```typescript
import { getCardDefinition, getCardsInZone } from './game-state';
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/actions.ts engine/src/actions.test.ts
git commit -m "feat(engine): draw cards action — moves from library to hand"
```

---

## Task 10: Mana Pool Emptying — End of Step/Phase

**Files:**
- Modify: `engine/src/turn-manager.ts`
- Test: `engine/src/turn-manager.test.ts` (add test)

**Step 1: Add mana emptying test**

Add to `turn-manager.test.ts`:

```typescript
describe('mana pool emptying', () => {
  it('empties mana pools when advancing steps', () => {
    let state = initGameState(makeEmptyDecks(2));
    state.players[0].manaPool = { W: 0, U: 0, B: 0, R: 0, G: 3, C: 0 };
    state = { ...state, phase: 'precombat_main', step: 'begin_combat' };

    const next = advanceStep(state);
    expect(next.players[0].manaPool.G).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npx vitest run src/turn-manager.test.ts`
Expected: FAIL — mana pool still has 3 green

**Step 3: Modify advanceStep to empty mana pools**

In `advanceStep` function, add mana pool emptying:

```typescript
export function advanceStep(state: GameState): GameState {
  const currentIndex = STEP_ORDER.indexOf(state.step);

  if (currentIndex === STEP_ORDER.length - 1) {
    return advanceToNextTurn(state);
  }

  const nextStep = STEP_ORDER[currentIndex + 1];
  const nextPhase = derivePhase(state.step, nextStep);

  const updatedPlayers = state.players.map(p => ({
    ...p,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  }));

  return {
    ...state,
    step: nextStep,
    phase: nextPhase,
    players: updatedPlayers,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd engine && npx vitest run src/turn-manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add engine/src/turn-manager.ts engine/src/turn-manager.test.ts
git commit -m "feat(engine): empty mana pools on step advancement"
```

---

## Task 11: Integration Test — Full Turn Cycle

**Files:**
- Create: `engine/src/integration.test.ts`

**Step 1: Write integration test**

```typescript
import { describe, it, expect } from 'vitest';
import { initGameState, getCardsInZone } from './game-state';
import { advanceStep, performUntapStep } from './turn-manager';
import { playLand, tapLandForMana, drawCards } from './actions';
import { canPayCost, parseManaString } from './mana';
import { passPriority, allPlayersPassed } from './priority';
import { CardDefinition } from './types';

function makeForest(): CardDefinition {
  return {
    id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest',
    oracle_text: '{T}: Add {G}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['G'], keywords: [], card_types: ['land'],
  };
}

function makeMountain(): CardDefinition {
  return {
    id: 'mountain-1', name: 'Mountain', type_line: 'Basic Land — Mountain',
    oracle_text: '{T}: Add {R}.', mana_cost: '', cmc: 0,
    colors: [], color_identity: ['R'], keywords: [], card_types: ['land'],
  };
}

describe('Integration: Full Turn Cycle', () => {
  it('player can untap, draw, play land, tap for mana in a single turn', () => {
    const p1Cards = [makeForest(), makeMountain()];
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: p1Cards, commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // --- Turn 1, P1 ---
    // Untap step: nothing to untap yet
    state = performUntapStep(state);

    // Advance through beginning phase to main
    state = advanceStep(state); // upkeep
    expect(state.step).toBe('upkeep');
    state = advanceStep(state); // draw
    expect(state.step).toBe('draw');

    // Draw a card
    state = drawCards(state, 'p1', 1);
    const hand = getCardsInZone(state, 'p1', 'hand');
    expect(hand).toHaveLength(1);

    // Advance to precombat main
    state = advanceStep(state); // begin_combat (phase = precombat_main)
    expect(state.phase).toBe('precombat_main');

    // Play a land from hand
    const landInHand = getCardsInZone(state, 'p1', 'hand')[0];
    state = playLand(state, 'p1', landInHand.instanceId);
    expect(state.players[0].hasPlayedLand).toBe(true);

    // Tap the land for mana
    state = tapLandForMana(state, 'p1', landInHand.instanceId, 'G');
    expect(state.players[0].manaPool.G).toBe(1);

    // Check we can pay {G}
    const cost = parseManaString('{G}');
    expect(canPayCost(state.players[0].manaPool, cost)).toBe(true);

    // Both players pass priority
    state = passPriority(state); // p1 passes
    state = passPriority(state); // p2 passes
    expect(allPlayersPassed(state)).toBe(true);

    // Advance through combat and ending
    state = advanceStep(state); // declare_attackers
    state = advanceStep(state); // declare_blockers
    state = advanceStep(state); // first_strike_damage
    state = advanceStep(state); // combat_damage
    state = advanceStep(state); // end_of_combat
    state = advanceStep(state); // end (phase = postcombat_main)
    state = advanceStep(state); // cleanup

    // Now it's P2's turn
    expect(state.activePlayerIndex).toBe(1);
    expect(state.turnNumber).toBe(2);
    expect(state.players[0].hasPlayedLand).toBe(false); // reset
  });

  it('played land untaps next turn', () => {
    const decks = [
      { playerId: 'p1', name: 'Alice', cards: [makeForest()], commanderId: 'cmd1' },
      { playerId: 'p2', name: 'Bob', cards: [], commanderId: 'cmd2' },
    ];
    let state = initGameState(decks);

    // Move forest to hand, go to main phase
    const card = getCardsInZone(state, 'p1', 'library')[0];
    state.cards.set(card.instanceId, { ...card, zone: 'hand' });
    state = { ...state, phase: 'precombat_main' };

    // Play and tap
    state = playLand(state, 'p1', card.instanceId);
    state = tapLandForMana(state, 'p1', card.instanceId, 'G');
    expect(state.cards.get(card.instanceId)!.tapped).toBe(true);

    // Advance to P2's turn, then back to P1's turn
    state = { ...state, step: 'cleanup', phase: 'ending' };
    state = advanceStep(state); // P2's turn
    state = { ...state, step: 'cleanup', phase: 'ending' };
    state = advanceStep(state); // Back to P1

    // Untap step
    state = performUntapStep(state);
    expect(state.cards.get(card.instanceId)!.tapped).toBe(false);
  });
});
```

**Step 2: Run all tests**

Run: `cd engine && npx vitest run`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add engine/src/integration.test.ts
git commit -m "test(engine): integration test — full turn cycle with land, mana, draw"
```

---

## Task 12: Index File — Public API Exports

**Files:**
- Create: `engine/src/index.ts`

**Step 1: Create barrel export**

```typescript
export * from './types';
export * from './game-state';
export * from './turn-manager';
export * from './mana';
export * from './priority';
export * from './actions';
```

**Step 2: Verify build**

Run: `cd engine && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add engine/src/index.ts
git commit -m "feat(engine): add barrel export index"
```

---

## Summary

After completing all 12 tasks, Phase 1 delivers:

| Module | What it does |
|--------|-------------|
| `types.ts` | All core type definitions (Card, Player, Zone, Phase, Mana) |
| `game-state.ts` | Game initialization, player/card queries |
| `turn-manager.ts` | Phase/step progression, untap, turn advancement |
| `mana.ts` | Mana parsing, pool management, cost payment |
| `priority.ts` | Priority passing, all-passed detection |
| `actions.ts` | Play land, tap for mana, draw cards |
| `index.ts` | Public API barrel export |

Phase 2 (Stack + Casting) builds on this foundation to add spell casting, the stack, and resolution.
