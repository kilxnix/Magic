# 3D Battlefield — Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an opt-in (`?ui=3d`) true-3D-depth Commander battlefield as a new play shell that renders from the existing `GameView` and reuses the existing action/prompt plumbing, with a 2D fallback — as a 1v1 vertical slice.

**Architecture:** A new shell `frontend/src/play/r3f/ThreeBattlefield.tsx` is a drop-in peer of `DesktopBattlefieldV2`, taking the identical `DesktopBattlefieldProps` bag. WebGL (React Three Fiber) renders the table/cards in perspective 3D; the HUD, targeting/combat controls, card viewer, and all modals stay as DOM overlaid on the `<Canvas>`, reusing existing v2 components. All 3D-specific logic (layout math, GameView→scene placement, diffing, frame-texture caching, id→action mapping) is extracted into **pure, unit-tested modules** with no WebGL dependency; R3F components are asserted with `@react-three/test-renderer`. The engine is not touched.

**Tech Stack:** React 18.2, TypeScript 5.2, Vite 5, Vitest 1.6 (jsdom), React Three Fiber 8 (`@react-three/fiber`), `@react-three/drei` 9, `three` 0.169, `@react-three/test-renderer` 8 (dev), `@types/three` (dev).

## Global Constraints

- **No engine changes.** Nothing under `engine/` is modified. The new shell consumes only `GameView` (`frontend/src/play/gameView.types.ts`) and the `DesktopBattlefieldProps` callback bag (`frontend/src/play/shells/DesktopBattlefield.tsx`).
- **HUD/controls/modals are DOM, not WebGL.** Reuse existing v2 components (`PhaseTrackV2`, `PriorityControlsV2`, `TargetingLayerV2`, `CombatFlowV2`, `NarrationFeedV2`, `CardViewerV2`). Do not reimplement text UI in three.js.
- **3D-depth requirement.** Perspective camera (not orthographic). Cards are solid (thin box geometry) lying on a table plane, lift on hover, rotate to tap, and the table recedes in depth. This is a hard acceptance criterion, not optional polish.
- **2D fallback.** When WebGL is unavailable, `?ui=3d` transparently renders the existing v2 2D shell.
- **Milestone 1 scope:** 1v1 only; no particle effects, no postprocessing, no camera swing-to-focus, no full prompt parity beyond what the reused v2 DOM controls already provide. Those are later milestones.
- **Test command:** `cd frontend && npm test` (Vitest). Single file: `cd frontend && npx vitest run <path>`.
- **All new source lives under** `frontend/src/play/r3f/`.

---

### Task 1: Add dependencies + the `getPlayUiMode` flag

**Files:**
- Modify: `frontend/package.json` (dependencies)
- Create: `frontend/src/play/r3f/playUiMode.ts`
- Test: `frontend/src/play/r3f/playUiMode.test.ts`

**Interfaces:**
- Produces: `getPlayUiMode(search?: string): 'v1' | 'v2' | '3d'` — reads the `ui` query param first, then `localStorage['mb.play.ui']`, defaulting to `'v1'`. Mirrors `isPlayUiV2` semantics and shares the same storage key.

- [ ] **Step 1: Install the 3D dependencies**

Run:
```bash
cd frontend && npm install three@^0.169.0 @react-three/fiber@^8.17.10 @react-three/drei@^9.114.0
cd frontend && npm install -D @types/three@^0.169.0 @react-three/test-renderer@^8.2.0
```
Expected: installs succeed; `package.json` lists the four packages.

- [ ] **Step 2: Write the failing test**

Create `frontend/src/play/r3f/playUiMode.test.ts`:
```ts
import { describe, expect, it, afterEach } from 'vitest';
import { getPlayUiMode } from './playUiMode';

afterEach(() => localStorage.removeItem('mb.play.ui'));

describe('getPlayUiMode', () => {
  it('reads the ui query param', () => {
    expect(getPlayUiMode('?ui=3d')).toBe('3d');
    expect(getPlayUiMode('?ui=v2')).toBe('v2');
    expect(getPlayUiMode('?ui=v1')).toBe('v1');
  });

  it('defaults to v1 when nothing is set', () => {
    expect(getPlayUiMode('')).toBe('v1');
  });

  it('falls back to localStorage when no query param', () => {
    localStorage.setItem('mb.play.ui', '3d');
    expect(getPlayUiMode('')).toBe('3d');
  });

  it('query param wins over localStorage', () => {
    localStorage.setItem('mb.play.ui', '3d');
    expect(getPlayUiMode('?ui=v2')).toBe('v2');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/playUiMode.test.ts`
Expected: FAIL — cannot find module `./playUiMode`.

- [ ] **Step 4: Write minimal implementation**

Create `frontend/src/play/r3f/playUiMode.ts`:
```ts
const STORAGE_KEY = 'mb.play.ui';
export type PlayUiMode = 'v1' | 'v2' | '3d';

function isMode(v: string | null): v is PlayUiMode {
  return v === 'v1' || v === 'v2' || v === '3d';
}

export function getPlayUiMode(search?: string): PlayUiMode {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const q = new URLSearchParams(query).get('ui');
  if (isMode(q)) return q;
  try {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (isMode(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return 'v1';
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/playUiMode.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/play/r3f/playUiMode.ts frontend/src/play/r3f/playUiMode.test.ts
git commit -m "feat(play-3d): add R3F deps + getPlayUiMode flag"
```

---

### Task 2: Seat + zone layout math (pure)

**Files:**
- Create: `frontend/src/play/r3f/layout.ts`
- Test: `frontend/src/play/r3f/layout.test.ts`

**Interfaces:**
- Produces:
  - `type Vec3 = [number, number, number]`
  - `type ZoneRow = 'creatures' | 'artifacts' | 'lands' | 'command'`
  - `seatTransform(index: number, total: number): { position: Vec3; rotationY: number }` — seats on a ring of radius `SEAT_R`; index 0 ("you") at world `[0,0,SEAT_R]` (near camera, `rotationY = 0`); others spaced evenly.
  - `zoneSlotLocal(row: ZoneRow, idx: number, count: number): Vec3` — slot position in a seat's local frame; cards spread along local X, rows at fixed local Z (creatures nearest table center, lands nearest the player).
  - `worldSlot(seatIndex: number, total: number, row: ZoneRow, idx: number, count: number): Vec3` — composes the two (rotate local by `rotationY`, translate by seat position).
  - Exported constants: `SEAT_R`, `CARD_SPACING_X`, `ROW_Z: Record<ZoneRow, number>`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/layout.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { seatTransform, zoneSlotLocal, worldSlot, SEAT_R, ROW_Z } from './layout';

describe('seatTransform', () => {
  it('places you (index 0) at +Z facing center with no rotation', () => {
    const t = seatTransform(0, 2);
    expect(t.position[0]).toBeCloseTo(0);
    expect(t.position[2]).toBeCloseTo(SEAT_R);
    expect(t.rotationY).toBeCloseTo(0);
  });

  it('places the opposite seat (index 1 of 2) at -Z, half-turn rotated', () => {
    const t = seatTransform(1, 2);
    expect(t.position[2]).toBeCloseTo(-SEAT_R);
    expect(t.rotationY).toBeCloseTo(Math.PI);
  });

  it('gives distinct rotations to four seats', () => {
    const ys = [0, 1, 2, 3].map((i) => seatTransform(i, 4).rotationY);
    expect(new Set(ys.map((y) => y.toFixed(3))).size).toBe(4);
  });
});

describe('zoneSlotLocal', () => {
  it('centers a single slot at local x=0', () => {
    expect(zoneSlotLocal('creatures', 0, 1)[0]).toBeCloseTo(0);
  });

  it('spreads slots symmetrically around x=0', () => {
    const a = zoneSlotLocal('lands', 0, 2)[0];
    const b = zoneSlotLocal('lands', 1, 2)[0];
    expect(a).toBeCloseTo(-b);
    expect(a).toBeLessThan(b);
  });

  it('puts creatures nearer table center than lands', () => {
    // local +Z points toward the player, so smaller z = nearer center.
    expect(ROW_Z.creatures).toBeLessThan(ROW_Z.lands);
  });
});

describe('worldSlot', () => {
  it('for you (seat 0) matches seat position plus local slot', () => {
    const w = worldSlot(0, 2, 'creatures', 0, 1);
    expect(w[0]).toBeCloseTo(0);
    expect(w[2]).toBeCloseTo(SEAT_R + ROW_Z.creatures);
  });

  it('rotates the local frame for the opposite seat', () => {
    // seat 1 of 2 is half-turned: a +x local offset becomes -x in world.
    const w0 = worldSlot(1, 2, 'lands', 0, 2);
    const w1 = worldSlot(1, 2, 'lands', 1, 2);
    expect(w0[0]).toBeCloseTo(-zoneSlotLocal('lands', 0, 2)[0]);
    expect(w1[0]).toBeCloseTo(-zoneSlotLocal('lands', 1, 2)[0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/layout.test.ts`
Expected: FAIL — cannot find module `./layout`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/layout.ts`:
```ts
export type Vec3 = [number, number, number];
export type ZoneRow = 'creatures' | 'artifacts' | 'lands' | 'command';

export const SEAT_R = 6;
export const CARD_SPACING_X = 1.2;

// local +Z points from table center toward the seated player.
// creatures sit nearest center (smallest z), lands nearest the player (largest z).
export const ROW_Z: Record<ZoneRow, number> = {
  creatures: 1.0,
  artifacts: 2.0,
  lands: 3.0,
  command: 0.2,
};

export function seatTransform(index: number, total: number): { position: Vec3; rotationY: number } {
  const a = (index / total) * Math.PI * 2;
  // rotationY = a maps local +Z (0,0,1) to world (sin a, 0, cos a).
  return {
    position: [SEAT_R * Math.sin(a), 0, SEAT_R * Math.cos(a)],
    rotationY: a,
  };
}

export function zoneSlotLocal(row: ZoneRow, idx: number, count: number): Vec3 {
  const x = (idx - (count - 1) / 2) * CARD_SPACING_X;
  return [x, 0, ROW_Z[row]];
}

export function worldSlot(
  seatIndex: number,
  total: number,
  row: ZoneRow,
  idx: number,
  count: number,
): Vec3 {
  const { position, rotationY } = seatTransform(seatIndex, total);
  const [lx, ly, lz] = zoneSlotLocal(row, idx, count);
  const sin = Math.sin(rotationY);
  const cos = Math.cos(rotationY);
  // rotate (lx, lz) around Y by rotationY, then translate by seat position.
  const wx = lx * cos + lz * sin;
  const wz = -lx * sin + lz * cos;
  return [position[0] + wx, ly, position[2] + wz];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/layout.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/layout.ts frontend/src/play/r3f/layout.test.ts
git commit -m "feat(play-3d): seat + zone layout math"
```

---

### Task 3: Flatten `GameView` into card placements (pure)

**Files:**
- Create: `frontend/src/play/r3f/placements.ts`
- Test: `frontend/src/play/r3f/placements.test.ts`

**Interfaces:**
- Consumes: `GameView`, `PermanentView` from `../gameView.types`; `worldSlot`, `Vec3`, `ZoneRow` from `./layout`.
- Produces:
  - `interface Placement { id: string; name: string; seatIndex: number; row: ZoneRow; position: Vec3; tapped: boolean; power?: number; toughness?: number; counters?: Record<string, number>; isOwn: boolean }`
  - `buildPlacements(view: GameView): Placement[]` — seat 0 is "you"; opponents are seats 1..n in `view.opponents` order. Maps each player's `creatures`/`artifacts`+`enchantments`/`lands`/`command` into rows and assigns world positions via `worldSlot`. (Hand is handled separately by the HandDock, not here.)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/placements.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildPlacements } from './placements';
import type { GameView, PermanentView } from '../gameView.types';

function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [], ...extra };
}

function makeView(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 0,
      creatures: [perm('c1', 'Bear', { isCreature: true, power: 2, toughness: 2 })],
      artifacts: [], enchantments: [],
      lands: [perm('l1', 'Forest', { isLand: true, tapped: true }), perm('l2', 'Forest', { isLand: true })],
      other: [], hand: [], graveyard: [], exile: [],
    },
    opponents: [{
      glance: {
        playerId: 'opp', name: 'Rival', life: 40, commanderDamageToYou: 0, handCount: 7,
        openMana: 0, creatureCount: 1, totalPower: 3, flags: [],
      },
      creatures: [perm('oc1', 'Wolf', { isCreature: true, power: 3, toughness: 3 })],
      lands: [], other: [], graveyardCount: 0, exileCount: 0,
      commandZone: [], graveyard: [], exile: [],
    }],
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('buildPlacements', () => {
  it('places your creatures and lands at seat 0', () => {
    const ps = buildPlacements(makeView());
    const bear = ps.find((p) => p.id === 'c1')!;
    expect(bear.seatIndex).toBe(0);
    expect(bear.isOwn).toBe(true);
    expect(bear.row).toBe('creatures');
    expect(bear.power).toBe(2);
  });

  it('carries the tapped flag', () => {
    const ps = buildPlacements(makeView());
    expect(ps.find((p) => p.id === 'l1')!.tapped).toBe(true);
    expect(ps.find((p) => p.id === 'l2')!.tapped).toBe(false);
  });

  it('places opponent permanents at seat 1', () => {
    const ps = buildPlacements(makeView());
    const wolf = ps.find((p) => p.id === 'oc1')!;
    expect(wolf.seatIndex).toBe(1);
    expect(wolf.isOwn).toBe(false);
  });

  it('gives every placement a distinct world position', () => {
    const ps = buildPlacements(makeView());
    const keys = ps.map((p) => p.position.map((n) => n.toFixed(2)).join(','));
    expect(new Set(keys).size).toBe(ps.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/placements.test.ts`
Expected: FAIL — cannot find module `./placements`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/placements.ts`:
```ts
import type { GameView, PermanentView } from '../gameView.types';
import { worldSlot, type Vec3, type ZoneRow } from './layout';

export interface Placement {
  id: string;
  name: string;
  seatIndex: number;
  row: ZoneRow;
  position: Vec3;
  tapped: boolean;
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  isOwn: boolean;
}

interface SeatRows {
  creatures: PermanentView[];
  artifacts: PermanentView[];
  lands: PermanentView[];
  command: PermanentView[];
}

function placeSeat(rows: SeatRows, seatIndex: number, total: number, isOwn: boolean): Placement[] {
  const out: Placement[] = [];
  (Object.keys(rows) as (keyof SeatRows)[]).forEach((row) => {
    const cards = rows[row];
    cards.forEach((c, idx) => {
      out.push({
        id: c.id,
        name: c.name,
        seatIndex,
        row: row as ZoneRow,
        position: worldSlot(seatIndex, total, row as ZoneRow, idx, cards.length),
        tapped: c.tapped,
        power: c.power,
        toughness: c.toughness,
        counters: c.counters,
        isOwn,
      });
    });
  });
  return out;
}

export function buildPlacements(view: GameView): Placement[] {
  const total = 1 + view.opponents.length;
  const placements: Placement[] = [];

  placements.push(
    ...placeSeat(
      {
        creatures: view.you.creatures,
        artifacts: [...view.you.artifacts, ...view.you.enchantments],
        lands: view.you.lands,
        command: view.you.commandZone,
      },
      0,
      total,
      true,
    ),
  );

  view.opponents.forEach((opp, i) => {
    placements.push(
      ...placeSeat(
        {
          creatures: opp.creatures,
          artifacts: opp.other,
          lands: opp.lands,
          command: opp.commandZone,
        },
        i + 1,
        total,
        false,
      ),
    );
  });

  return placements;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/placements.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/placements.ts frontend/src/play/r3f/placements.test.ts
git commit -m "feat(play-3d): GameView -> card placements"
```

---

### Task 4: Scene diff + lerp helpers (pure)

**Files:**
- Create: `frontend/src/play/r3f/sceneDiff.ts`
- Test: `frontend/src/play/r3f/sceneDiff.test.ts`

**Interfaces:**
- Consumes: `Placement`, `Vec3` from `./placements` / `./layout`.
- Produces:
  - `interface PlacementDiff { entered: string[]; left: string[]; moved: { id: string; from: Vec3; to: Vec3 }[]; tapChanged: { id: string; tapped: boolean }[] }`
  - `diffPlacements(prev: Placement[], next: Placement[]): PlacementDiff`
  - `lerpVec3(a: Vec3, b: Vec3, t: number): Vec3` — component-wise linear interpolation, `t` clamped to `[0,1]`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/sceneDiff.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { diffPlacements, lerpVec3 } from './sceneDiff';
import type { Placement } from './placements';

function p(id: string, pos: [number, number, number], tapped = false): Placement {
  return { id, name: id, seatIndex: 0, row: 'creatures', position: pos, tapped, isOwn: true };
}

describe('diffPlacements', () => {
  it('reports entered ids', () => {
    const d = diffPlacements([], [p('a', [0, 0, 0])]);
    expect(d.entered).toEqual(['a']);
    expect(d.left).toEqual([]);
  });

  it('reports left ids', () => {
    const d = diffPlacements([p('a', [0, 0, 0])], []);
    expect(d.left).toEqual(['a']);
  });

  it('reports moved ids with from/to', () => {
    const d = diffPlacements([p('a', [0, 0, 0])], [p('a', [1, 0, 2])]);
    expect(d.moved).toEqual([{ id: 'a', from: [0, 0, 0], to: [1, 0, 2] }]);
  });

  it('does not report a stationary card as moved', () => {
    const d = diffPlacements([p('a', [0, 0, 0])], [p('a', [0, 0, 0])]);
    expect(d.moved).toEqual([]);
  });

  it('reports tap changes', () => {
    const d = diffPlacements([p('a', [0, 0, 0], false)], [p('a', [0, 0, 0], true)]);
    expect(d.tapChanged).toEqual([{ id: 'a', tapped: true }]);
  });
});

describe('lerpVec3', () => {
  it('interpolates at t=0.5', () => {
    expect(lerpVec3([0, 0, 0], [2, 4, 6], 0.5)).toEqual([1, 2, 3]);
  });
  it('clamps t', () => {
    expect(lerpVec3([0, 0, 0], [2, 2, 2], 2)).toEqual([2, 2, 2]);
    expect(lerpVec3([0, 0, 0], [2, 2, 2], -1)).toEqual([0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/sceneDiff.test.ts`
Expected: FAIL — cannot find module `./sceneDiff`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/sceneDiff.ts`:
```ts
import type { Vec3 } from './layout';
import type { Placement } from './placements';

export interface PlacementDiff {
  entered: string[];
  left: string[];
  moved: { id: string; from: Vec3; to: Vec3 }[];
  tapChanged: { id: string; tapped: boolean }[];
}

function near(a: Vec3, b: Vec3): boolean {
  return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
}

export function diffPlacements(prev: Placement[], next: Placement[]): PlacementDiff {
  const prevById = new Map(prev.map((p) => [p.id, p]));
  const nextById = new Map(next.map((p) => [p.id, p]));

  const entered = next.filter((p) => !prevById.has(p.id)).map((p) => p.id);
  const left = prev.filter((p) => !nextById.has(p.id)).map((p) => p.id);

  const moved: PlacementDiff['moved'] = [];
  const tapChanged: PlacementDiff['tapChanged'] = [];
  for (const n of next) {
    const o = prevById.get(n.id);
    if (!o) continue;
    if (!near(o.position, n.position)) moved.push({ id: n.id, from: o.position, to: n.position });
    if (o.tapped !== n.tapped) tapChanged.push({ id: n.id, tapped: n.tapped });
  }

  return { entered, left, moved, tapChanged };
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  const c = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * c, a[1] + (b[1] - a[1]) * c, a[2] + (b[2] - a[2]) * c];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/sceneDiff.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/sceneDiff.ts frontend/src/play/r3f/sceneDiff.test.ts
git commit -m "feat(play-3d): placement diff + lerp helpers"
```

---

### Task 5: Card-frame texture signature + cache (pure)

**Files:**
- Create: `frontend/src/play/r3f/cardFrame.ts`
- Test: `frontend/src/play/r3f/cardFrame.test.ts`

**Interfaces:**
- Consumes: `Placement` from `./placements`.
- Produces:
  - `frameSignature(p: Pick<Placement, 'name' | 'power' | 'toughness' | 'tapped' | 'counters'>): string` — a stable key capturing everything that changes a card's drawn frame.
  - `createFrameCache<T>(make: (p: Placement) => T): { get(p: Placement): T; size(): number }` — memoizes `make` by `frameSignature`, so identical cards (e.g. many Forests) share one texture and a tapped card re-uses its untapped sibling's signature only if visually identical.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/cardFrame.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { frameSignature, createFrameCache } from './cardFrame';
import type { Placement } from './placements';

function p(over: Partial<Placement>): Placement {
  return { id: 'x', name: 'Forest', seatIndex: 0, row: 'lands', position: [0, 0, 0], tapped: false, isOwn: true, ...over };
}

describe('frameSignature', () => {
  it('is equal for identical cards', () => {
    expect(frameSignature(p({}))).toBe(frameSignature(p({ id: 'other' })));
  });
  it('differs by power/toughness', () => {
    expect(frameSignature(p({ power: 2, toughness: 2 }))).not.toBe(frameSignature(p({ power: 3, toughness: 3 })));
  });
  it('differs by counters', () => {
    expect(frameSignature(p({ counters: { '+1/+1': 1 } }))).not.toBe(frameSignature(p({})));
  });
});

describe('createFrameCache', () => {
  it('calls make once per distinct signature', () => {
    const make = vi.fn((c: Placement) => ({ tex: c.name }));
    const cache = createFrameCache(make);
    cache.get(p({ id: 'a' }));
    cache.get(p({ id: 'b' })); // same signature as a
    cache.get(p({ id: 'c', name: 'Island' }));
    expect(make).toHaveBeenCalledTimes(2);
    expect(cache.size()).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/cardFrame.test.ts`
Expected: FAIL — cannot find module `./cardFrame`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/cardFrame.ts`:
```ts
import type { Placement } from './placements';

export function frameSignature(
  p: Pick<Placement, 'name' | 'power' | 'toughness' | 'tapped' | 'counters'>,
): string {
  const pt = p.power != null || p.toughness != null ? `${p.power ?? ''}/${p.toughness ?? ''}` : '';
  const counters = p.counters
    ? Object.keys(p.counters)
        .sort()
        .map((k) => `${k}:${p.counters![k]}`)
        .join(',')
    : '';
  // tapped does NOT change the drawn frame (tapping is a mesh rotation), so it is
  // intentionally excluded — identical cards share one texture whether tapped or not.
  return `${p.name}|${pt}|${counters}`;
}

export function createFrameCache<T>(make: (p: Placement) => T): { get(p: Placement): T; size(): number } {
  const store = new Map<string, T>();
  return {
    get(p: Placement): T {
      const sig = frameSignature(p);
      let v = store.get(sig);
      if (v === undefined) {
        v = make(p);
        store.set(sig, v);
      }
      return v;
    },
    size: () => store.size,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/cardFrame.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/cardFrame.ts frontend/src/play/r3f/cardFrame.test.ts
git commit -m "feat(play-3d): card-frame signature + cache"
```

---

### Task 6: Object index + `toCardView` adapter (pure)

**Files:**
- Create: `frontend/src/play/r3f/interaction.ts`
- Test: `frontend/src/play/r3f/interaction.test.ts`

**Interfaces:**
- Consumes: `GameView`, `CardView`, `PermanentView`, `HandCardView`, `LegalAction` from `../gameView.types`.
- Produces:
  - `interface ObjectEntry { id: string; name: string; zone: CardView['zone']; legalActions: LegalAction[]; power?: number; toughness?: number; counters?: Record<string, number>; tapped?: boolean }`
  - `buildObjectIndex(view: GameView): Map<string, ObjectEntry>` — every selectable object across your zones + hand + each opponent's board/command, keyed by id.
  - `toCardView(entry: ObjectEntry): CardView` — adapts an entry into the `CardView` shape `CardViewerV2` consumes (so selecting a 3D object opens the existing DOM action menu).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/interaction.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildObjectIndex, toCardView } from './interaction';
import type { GameView, PermanentView, LegalAction } from '../gameView.types';

const act: LegalAction = { source: {} as never, kind: 'cast', label: 'Cast' };
function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [act], ...extra };
}

function view(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [perm('cmd', 'Commander')], graveyardCount: 0, libraryCount: 0, handCount: 1,
      creatures: [perm('c1', 'Bear', { isCreature: true, power: 2, toughness: 2, tapped: true })],
      artifacts: [], enchantments: [], lands: [perm('l1', 'Forest', { isLand: true })], other: [],
      hand: [{ id: 'h1', name: 'Giant Growth', legalActions: [act] }], graveyard: [], exile: [],
    },
    opponents: [{
      glance: { playerId: 'o', name: 'R', life: 40, commanderDamageToYou: 0, handCount: 0, openMana: 0, creatureCount: 1, totalPower: 1, flags: [] },
      creatures: [perm('oc1', 'Wolf', { isCreature: true })], lands: [], other: [], graveyardCount: 0, exileCount: 0,
      commandZone: [], graveyard: [], exile: [],
    }],
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'M', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('buildObjectIndex', () => {
  it('indexes your board, hand, command zone, and opponent board', () => {
    const idx = buildObjectIndex(view());
    expect(idx.get('c1')!.name).toBe('Bear');
    expect(idx.get('h1')!.zone).toBe('hand');
    expect(idx.get('cmd')!.zone).toBe('command');
    expect(idx.get('oc1')!.name).toBe('Wolf');
  });

  it('carries legalActions and combat-relevant fields', () => {
    const idx = buildObjectIndex(view());
    expect(idx.get('c1')!.legalActions).toHaveLength(1);
    expect(idx.get('c1')!.tapped).toBe(true);
    expect(idx.get('c1')!.power).toBe(2);
  });
});

describe('toCardView', () => {
  it('produces a CardView the viewer can consume', () => {
    const idx = buildObjectIndex(view());
    const cv = toCardView(idx.get('c1')!);
    expect(cv.id).toBe('c1');
    expect(cv.zone).toBe('battlefield');
    expect(cv.legalActions).toHaveLength(1);
    expect(Array.isArray(cv.statuses)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/interaction.test.ts`
Expected: FAIL — cannot find module `./interaction`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/interaction.ts`:
```ts
import type {
  GameView,
  CardView,
  PermanentView,
  HandCardView,
  LegalAction,
} from '../gameView.types';

export interface ObjectEntry {
  id: string;
  name: string;
  zone: CardView['zone'];
  legalActions: LegalAction[];
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  tapped?: boolean;
}

function fromPermanent(p: PermanentView, zone: CardView['zone']): ObjectEntry {
  return {
    id: p.id,
    name: p.name,
    zone,
    legalActions: p.legalActions,
    power: p.power,
    toughness: p.toughness,
    counters: p.counters,
    tapped: p.tapped,
  };
}

function fromHand(c: HandCardView): ObjectEntry {
  return { id: c.id, name: c.name, zone: 'hand', legalActions: c.legalActions };
}

export function buildObjectIndex(view: GameView): Map<string, ObjectEntry> {
  const map = new Map<string, ObjectEntry>();
  const add = (e: ObjectEntry) => {
    if (!map.has(e.id)) map.set(e.id, e);
  };

  const y = view.you;
  [...y.creatures, ...y.artifacts, ...y.enchantments, ...y.lands, ...y.other].forEach((p) =>
    add(fromPermanent(p, 'battlefield')),
  );
  y.commandZone.forEach((p) => add(fromPermanent(p, 'command')));
  y.hand.forEach((c) => add(fromHand(c)));

  for (const opp of view.opponents) {
    [...opp.creatures, ...opp.lands, ...opp.other].forEach((p) => add(fromPermanent(p, 'battlefield')));
    opp.commandZone.forEach((p) => add(fromPermanent(p, 'command')));
  }

  return map;
}

export function toCardView(entry: ObjectEntry): CardView {
  const statuses: string[] = [];
  if (entry.tapped) statuses.push('Tapped');
  return {
    id: entry.id,
    name: entry.name,
    zone: entry.zone,
    power: entry.power,
    toughness: entry.toughness,
    counters: entry.counters,
    tapped: entry.tapped,
    statuses,
    legalActions: entry.legalActions,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/interaction.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/interaction.ts frontend/src/play/r3f/interaction.test.ts
git commit -m "feat(play-3d): object index + CardView adapter"
```

---

### Task 7: `supportsWebGL` capability check

**Files:**
- Create: `frontend/src/play/r3f/webgl.ts`
- Test: `frontend/src/play/r3f/webgl.test.ts`

**Interfaces:**
- Produces: `supportsWebGL(doc?: Document): boolean` — true when a canvas can return a `webgl`/`experimental-webgl` context. Accepts an injectable `document` for testing; defaults to the global `document`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/webgl.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { supportsWebGL } from './webgl';

function fakeDoc(ctx: unknown): Document {
  return {
    createElement: () => ({ getContext: () => ctx }),
  } as unknown as Document;
}

describe('supportsWebGL', () => {
  it('is true when a webgl context is returned', () => {
    expect(supportsWebGL(fakeDoc({}))).toBe(true);
  });
  it('is false when no context is available', () => {
    expect(supportsWebGL(fakeDoc(null))).toBe(false);
  });
  it('is false when createElement throws', () => {
    const doc = { createElement: () => { throw new Error('no'); } } as unknown as Document;
    expect(supportsWebGL(doc)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/webgl.test.ts`
Expected: FAIL — cannot find module `./webgl`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/webgl.ts`:
```ts
export function supportsWebGL(doc: Document = document): boolean {
  try {
    const canvas = doc.createElement('canvas') as HTMLCanvasElement;
    const ctx =
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return Boolean(ctx);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/webgl.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/webgl.ts frontend/src/play/r3f/webgl.test.ts
git commit -m "feat(play-3d): WebGL capability check"
```

---

### Task 8: `CardMesh` component

**Files:**
- Create: `frontend/src/play/r3f/CardMesh.tsx`
- Test: `frontend/src/play/r3f/CardMesh.test.tsx`

**Interfaces:**
- Consumes: `Placement` from `./placements`; `Vec3` from `./layout`.
- Produces: `CardMesh(props: { placement: Placement; onSelect(id: string): void; onHover?(id: string | null): void }): JSX.Element` — a solid thin box at `placement.position`, lying flat (rotated −90° about X so the face points up). Tapped cards rotate +90° about Y. The mesh carries `userData={{ id }}` and calls `onSelect(id)` on click. A flat card is `CARD_W × CARD_H`, thickness `CARD_T`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/CardMesh.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { CardMesh } from './CardMesh';
import type { Placement } from './placements';

function p(over: Partial<Placement> = {}): Placement {
  return { id: 'c1', name: 'Bear', seatIndex: 0, row: 'creatures', position: [1, 0, 2], tapped: false, isOwn: true, ...over };
}

describe('CardMesh', () => {
  it('renders a mesh carrying the card id in userData', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p()} onSelect={() => {}} />);
    const meshes = r.scene.findAll((n) => n.type === 'Mesh');
    expect(meshes.length).toBeGreaterThanOrEqual(1);
    expect(meshes.some((m) => (m.instance.userData as { id?: string }).id === 'c1')).toBe(true);
  });

  it('positions the card at its placement coordinates', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p({ position: [1, 0, 2] })} onSelect={() => {}} />);
    const group = r.scene.children[0];
    expect(group.instance.position.x).toBeCloseTo(1);
    expect(group.instance.position.z).toBeCloseTo(2);
  });

  it('rotates a tapped card about Y', async () => {
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p({ tapped: true })} onSelect={() => {}} />);
    const group = r.scene.children[0];
    expect(Math.abs(group.instance.rotation.y)).toBeCloseTo(Math.PI / 2);
  });

  it('fires onSelect with the id when clicked', async () => {
    const onSelect = vi.fn();
    const r = await ReactThreeTestRenderer.create(<CardMesh placement={p()} onSelect={onSelect} />);
    const mesh = r.scene.findAll((n) => n.type === 'Mesh').find((m) => (m.instance.userData as { id?: string }).id === 'c1')!;
    await r.fireEvent(mesh, 'click');
    expect(onSelect).toHaveBeenCalledWith('c1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/CardMesh.test.tsx`
Expected: FAIL — cannot find module `./CardMesh`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/CardMesh.tsx`:
```tsx
import { useState } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Placement } from './placements';

export const CARD_W = 1.0;
export const CARD_H = 1.4;
export const CARD_T = 0.04;
const HOVER_LIFT = 0.25;

// Color the frame by seat ownership; full per-type theming arrives in a later milestone.
function frameColor(isOwn: boolean, hovered: boolean): string {
  if (hovered) return '#facc15';
  return isOwn ? '#3f6212' : '#7f1d1d';
}

export function CardMesh({
  placement,
  onSelect,
  onHover,
}: {
  placement: Placement;
  onSelect(id: string): void;
  onHover?(id: string | null): void;
}) {
  const [hovered, setHovered] = useState(false);
  const [x, y, z] = placement.position;
  const lift = hovered ? HOVER_LIFT : 0;

  return (
    <group position={[x, y + lift, z]} rotation={[0, placement.tapped ? Math.PI / 2 : 0, 0]}>
      {/* Lay the card flat: rotate the upright card -90deg about X so its face points up (+Y). */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        userData={{ id: placement.id }}
        castShadow
        receiveShadow
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(placement.id);
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          setHovered(true);
          onHover?.(placement.id);
        }}
        onPointerOut={() => {
          setHovered(false);
          onHover?.(null);
        }}
      >
        <boxGeometry args={[CARD_W, CARD_H, CARD_T]} />
        <meshStandardMaterial color={frameColor(placement.isOwn, hovered)} />
      </mesh>
    </group>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/CardMesh.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/CardMesh.tsx frontend/src/play/r3f/CardMesh.test.tsx
git commit -m "feat(play-3d): CardMesh solid card with tap + hover"
```

---

### Task 9: `BattlefieldScene` (places all permanents)

**Files:**
- Create: `frontend/src/play/r3f/BattlefieldScene.tsx`
- Test: `frontend/src/play/r3f/BattlefieldScene.test.tsx`

**Interfaces:**
- Consumes: `GameView` from `../gameView.types`; `buildPlacements` from `./placements`; `CardMesh` from `./CardMesh`.
- Produces: `BattlefieldScene(props: { view: GameView; onSelect(id: string): void }): JSX.Element` — renders one `CardMesh` per placement, plus the table plane and lights. (The camera is provided by the `<Canvas>` host in Task 11, not here.)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/BattlefieldScene.test.tsx`:
```tsx
import { describe, expect, it } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { BattlefieldScene } from './BattlefieldScene';
import { buildPlacements } from './placements';
import type { GameView, PermanentView } from '../gameView.types';

function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [], ...extra };
}
function view(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 0,
      creatures: [perm('c1', 'Bear', { isCreature: true })],
      artifacts: [], enchantments: [], lands: [perm('l1', 'Forest', { isLand: true })], other: [],
      hand: [], graveyard: [], exile: [],
    },
    opponents: [{
      glance: { playerId: 'o', name: 'R', life: 40, commanderDamageToYou: 0, handCount: 0, openMana: 0, creatureCount: 1, totalPower: 1, flags: [] },
      creatures: [perm('oc1', 'Wolf', { isCreature: true })], lands: [], other: [], graveyardCount: 0, exileCount: 0,
      commandZone: [], graveyard: [], exile: [],
    }],
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'M', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('BattlefieldScene', () => {
  it('renders one card group per placement', async () => {
    const v = view();
    const expected = buildPlacements(v).length; // 3
    const r = await ReactThreeTestRenderer.create(<BattlefieldScene view={v} onSelect={() => {}} />);
    const ids = r.scene
      .findAll((n) => n.type === 'Mesh')
      .map((m) => (m.instance.userData as { id?: string }).id)
      .filter(Boolean);
    expect(new Set(ids).size).toBe(expected);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/BattlefieldScene.test.tsx`
Expected: FAIL — cannot find module `./BattlefieldScene`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/BattlefieldScene.tsx`:
```tsx
import type { GameView } from '../gameView.types';
import { buildPlacements } from './placements';
import { CardMesh } from './CardMesh';
import { SEAT_R } from './layout';

export function BattlefieldScene({ view, onSelect }: { view: GameView; onSelect(id: string): void }) {
  const placements = buildPlacements(view);
  const tableSize = SEAT_R * 2 + 4;

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 12, 8]} intensity={1.1} castShadow />

      {/* Table surface on the XZ plane (rotate the plane to lie flat). */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -CARD_BASE, 0]} receiveShadow>
        <planeGeometry args={[tableSize, tableSize]} />
        <meshStandardMaterial color="#1c1917" />
      </mesh>

      {placements.map((p) => (
        <CardMesh key={p.id} placement={p} onSelect={onSelect} />
      ))}
    </>
  );
}

const CARD_BASE = 0.03;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/BattlefieldScene.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/BattlefieldScene.tsx frontend/src/play/r3f/BattlefieldScene.test.tsx
git commit -m "feat(play-3d): BattlefieldScene renders placements + table + lights"
```

---

### Task 10: `HandDock` (your hand, fanned near camera)

**Files:**
- Create: `frontend/src/play/r3f/HandDock.tsx`
- Test: `frontend/src/play/r3f/HandDock.test.tsx`

**Interfaces:**
- Consumes: `HandCardView` from `../gameView.types`; `CardMesh` from `./CardMesh`; `Placement` from `./placements`.
- Produces: `HandDock(props: { hand: HandCardView[]; onSelect(id: string): void }): JSX.Element` — lays hand cards in a shallow fan in front of the camera (near `+Z`, slightly raised), each a `CardMesh` so selection routes through the same path. Builds a synthetic `Placement` per hand card (row `'command'`, `isOwn: true`) at fan positions.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/HandDock.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { HandDock } from './HandDock';
import type { HandCardView } from '../gameView.types';

const hand: HandCardView[] = [
  { id: 'h1', name: 'Giant Growth', legalActions: [] },
  { id: 'h2', name: 'Llanowar Elves', legalActions: [] },
  { id: 'h3', name: 'Forest', legalActions: [] },
];

describe('HandDock', () => {
  it('renders one mesh per hand card', async () => {
    const r = await ReactThreeTestRenderer.create(<HandDock hand={hand} onSelect={() => {}} />);
    const ids = r.scene.findAll((n) => n.type === 'Mesh').map((m) => (m.instance.userData as { id?: string }).id).filter(Boolean);
    expect(new Set(ids)).toEqual(new Set(['h1', 'h2', 'h3']));
  });

  it('routes selection through onSelect', async () => {
    const onSelect = vi.fn();
    const r = await ReactThreeTestRenderer.create(<HandDock hand={hand} onSelect={onSelect} />);
    const mesh = r.scene.findAll((n) => n.type === 'Mesh').find((m) => (m.instance.userData as { id?: string }).id === 'h2')!;
    await r.fireEvent(mesh, 'click');
    expect(onSelect).toHaveBeenCalledWith('h2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/HandDock.test.tsx`
Expected: FAIL — cannot find module `./HandDock`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/HandDock.tsx`:
```tsx
import type { HandCardView } from '../gameView.types';
import { CardMesh } from './CardMesh';
import type { Placement } from './placements';
import { SEAT_R, CARD_SPACING_X } from './layout';

const DOCK_Z = SEAT_R + 2.5; // in front of your seat, toward the camera
const DOCK_Y = 1.2; // raised off the table so the fan is readable

function handPlacement(card: HandCardView, idx: number, count: number): Placement {
  const x = (idx - (count - 1) / 2) * CARD_SPACING_X;
  return {
    id: card.id,
    name: card.name,
    seatIndex: 0,
    row: 'command',
    position: [x, DOCK_Y, DOCK_Z],
    tapped: false,
    isOwn: true,
  };
}

export function HandDock({ hand, onSelect }: { hand: HandCardView[]; onSelect(id: string): void }) {
  return (
    <>
      {hand.map((c, i) => (
        <CardMesh key={c.id} placement={handPlacement(c, i, hand.length)} onSelect={onSelect} />
      ))}
    </>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/HandDock.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/HandDock.tsx frontend/src/play/r3f/HandDock.test.tsx
git commit -m "feat(play-3d): HandDock fanned hand"
```

---

### Task 11: `ThreeBattlefield` shell (Canvas + DOM overlay + viewer)

**Files:**
- Create: `frontend/src/play/r3f/ThreeBattlefield.tsx`
- Test: `frontend/src/play/r3f/ThreeBattlefield.test.tsx`

**Interfaces:**
- Consumes: `DesktopBattlefieldProps` from `../shells/DesktopBattlefield`; `BattlefieldScene` (Task 9); `HandDock` (Task 10); `buildObjectIndex`, `toCardView` (Task 6); existing DOM components `PhaseTrackV2`, `PriorityControlsV2`, `TargetingLayerV2`, `CombatFlowV2`, `NarrationFeedV2`, `CardViewerV2`.
- Produces: `ThreeBattlefield(props: DesktopBattlefieldProps): JSX.Element` — a `<Canvas>` (perspective camera at the seat, `frameloop="demand"`, DPR clamped) hosting `BattlefieldScene` + `HandDock`, with a DOM overlay (absolutely positioned over the canvas) carrying the phase track, priority controls, targeting layer, combat flow, and narration feed. Selecting a 3D object opens `CardViewerV2` with that object's actions; the viewer's `onAction` routes to `props.onAction`.

**Note on testing:** `<Canvas>` from `@react-three/fiber` creates its own WebGL root and does not render under jsdom. The test mocks `@react-three/fiber`'s `Canvas` to render its children into a plain `<div data-testid="r3f-canvas">` so the DOM overlay and the viewer wiring are assertable without WebGL. The scene-graph itself is already covered by Tasks 8–10.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/ThreeBattlefield.test.tsx`:
```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, renderHook, act } from '@testing-library/react';

// Mock <Canvas> to a placeholder that does NOT mount its 3D children: those use
// R3F hooks (useFrame) that require a real Canvas context, and the scene graph is
// already covered by the test-renderer tests (Tasks 8-10). The DOM overlay renders
// as a sibling of <Canvas>, so it is still present and assertable.
vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber');
  return { ...actual, Canvas: () => <div data-testid="r3f-canvas" /> };
});

import { ThreeBattlefield, useSelectionViewer } from './ThreeBattlefield';
import type { DesktopBattlefieldProps } from '../shells/DesktopBattlefield';
import type { GameView, PermanentView } from '../gameView.types';

function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [], ...extra };
}
function view(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 0,
      creatures: [perm('c1', 'Bear', { isCreature: true })], artifacts: [], enchantments: [],
      lands: [], other: [], hand: [], graveyard: [], exile: [],
    },
    opponents: [],
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

function props(over: Partial<DesktopBattlefieldProps> = {}): DesktopBattlefieldProps {
  return {
    view: view(), alwaysStop: false,
    onAction: vi.fn(), onExamine: vi.fn(), onPass: vi.fn(), onHold: vi.fn(), onToggleAlwaysStop: vi.fn(),
    onExploreOpponent: vi.fn(), onRespond: vi.fn(), onLetResolve: vi.fn(),
    onToggleTarget: vi.fn(), onConfirmTarget: vi.fn(), onCancelTarget: vi.fn(),
    onAssignCombat: vi.fn(), onConfirmCombat: vi.fn(), onSkipCombat: vi.fn(),
    selectedDefenderId: null, onSelectDefender: vi.fn(),
    ...over,
  };
}

describe('ThreeBattlefield', () => {
  it('renders the canvas host and the DOM phase track', () => {
    render(<ThreeBattlefield {...props()} />);
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.getByText(/Main/)).toBeInTheDocument();
  });

});

describe('useSelectionViewer', () => {
  it('opens a viewer for a selected object and clears it', () => {
    const v = view(); // your board has creature 'c1' (Bear)
    const { result } = renderHook(() => useSelectionViewer(v));
    expect(result.current.viewer).toBeNull();
    act(() => result.current.select('c1'));
    expect(result.current.viewer?.id).toBe('c1');
    expect(result.current.viewer?.name).toBe('Bear');
    act(() => result.current.clear());
    expect(result.current.viewer).toBeNull();
  });

  it('ignores selection of an unknown id', () => {
    const { result } = renderHook(() => useSelectionViewer(view()));
    act(() => result.current.select('does-not-exist'));
    expect(result.current.viewer).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/ThreeBattlefield.test.tsx`
Expected: FAIL — cannot find module `./ThreeBattlefield`.

- [ ] **Step 3: Write minimal implementation**

> Confirm the import path/prop names of `CardViewerV2` before writing (it is read in `DesktopBattlefieldV2.tsx` as `<CardViewerV2 card={viewer} onClose=... onAction=... />`). No change to `CardViewerV2` is required — the selection→viewer wiring is verified through the `useSelectionViewer` hook test, not by asserting the rendered overlay.

Create `frontend/src/play/r3f/ThreeBattlefield.tsx`:
```tsx
import { useCallback, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { DesktopBattlefieldProps } from '../shells/DesktopBattlefield';
import type { CardView, GameView } from '../gameView.types';
import { BattlefieldScene } from './BattlefieldScene';
import { HandDock } from './HandDock';
import { buildObjectIndex, toCardView } from './interaction';
import { SEAT_R } from './layout';
import { PhaseTrackV2 } from '../v2/components/PhaseTrackV2';
import { PriorityControlsV2 } from '../v2/components/PriorityControlsV2';
import { TargetingLayerV2 } from '../v2/components/TargetingLayerV2';
import { CombatFlowV2 } from '../v2/components/CombatFlowV2';
import { NarrationFeedV2 } from '../v2/components/NarrationFeedV2';
import { CardViewerV2 } from '../v2/components/CardViewerV2';

/**
 * Selecting a 3D object opens the existing DOM action menu (CardViewerV2) for it.
 * Extracted as a hook so the selection→viewer wiring is unit-testable without a
 * real WebGL canvas (the 3D click path itself is covered by CardMesh's tests).
 */
export function useSelectionViewer(view: GameView): {
  viewer: CardView | null;
  select(id: string): void;
  clear(): void;
} {
  const [viewer, setViewer] = useState<CardView | null>(null);
  const index = useMemo(() => buildObjectIndex(view), [view]);
  const select = useCallback(
    (id: string) => {
      const entry = index.get(id);
      if (entry) setViewer(toCardView(entry));
    },
    [index],
  );
  const clear = useCallback(() => setViewer(null), []);
  return { viewer, select, clear };
}

export function ThreeBattlefield(props: DesktopBattlefieldProps) {
  const { view } = props;
  const { viewer, select: handleSelect, clear } = useSelectionViewer(view);

  return (
    <div data-testid="three-battlefield" className="relative h-full w-full bg-black">
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="demand"
        camera={{ position: [0, 7, SEAT_R + 6], fov: 50 }}
      >
        <BattlefieldScene view={view} onSelect={handleSelect} />
        <HandDock hand={view.you.hand} onSelect={handleSelect} />
      </Canvas>

      {/* DOM overlay — controls + readouts live here, not in WebGL. */}
      <div className="pointer-events-none absolute inset-0">
        <div className="pointer-events-auto absolute left-3 top-3">
          <PhaseTrackV2 priority={view.priority} />
          <PriorityControlsV2
            priority={view.priority}
            alwaysStop={props.alwaysStop}
            onPass={props.onPass}
            onHold={props.onHold}
            onToggleAlwaysStop={props.onToggleAlwaysStop}
          />
        </div>
        <div className="pointer-events-auto absolute right-3 top-3 max-w-xs">
          <NarrationFeedV2 narration={view.narration} />
        </div>
        <div className="pointer-events-auto absolute inset-x-0 bottom-3 flex flex-col items-center gap-2">
          <TargetingLayerV2
            targeting={view.targeting}
            onToggleTarget={props.onToggleTarget}
            onConfirm={props.onConfirmTarget}
            onCancel={props.onCancelTarget}
          />
          <CombatFlowV2
            combat={view.combat}
            selectedDefenderId={props.selectedDefenderId}
            onAssign={props.onAssignCombat}
            onConfirm={props.onConfirmCombat}
            onSkip={props.onSkipCombat}
            onSelectDefender={props.onSelectDefender}
          />
        </div>
      </div>

      {viewer ? (
        <CardViewerV2
          card={viewer}
          onClose={clear}
          onAction={(a) => {
            props.onAction(a);
            clear();
          }}
        />
      ) : null}
    </div>
  );
}

export default ThreeBattlefield;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/ThreeBattlefield.test.tsx`
Expected: PASS (4 tests — 2 render tests + 2 `useSelectionViewer` hook tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/ThreeBattlefield.tsx frontend/src/play/r3f/ThreeBattlefield.test.tsx
git commit -m "feat(play-3d): ThreeBattlefield shell (canvas + DOM overlay + viewer)"
```

---

### Task 12: Wire `?ui=3d` into `PlayExperience` with 2D fallback

**Files:**
- Modify: `frontend/src/play/PlayExperience.tsx` (shell selection, lines ~328–330 and ~830)
- Test: `frontend/src/play/r3f/playExperience3d.test.tsx`

**Interfaces:**
- Consumes: `getPlayUiMode` (Task 1); `supportsWebGL` (Task 7); `ThreeBattlefield` (Task 11).
- Produces: behavior — when `getPlayUiMode() === '3d'` and `supportsWebGL()` is true, `PlayExperience` renders `<ThreeBattlefield {...shellProps} />` for all viewport sizes. When 3D is requested but WebGL is unavailable, it falls back to the v2 2D shells. `v1`/`v2` behavior is unchanged.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/playExperience3d.test.tsx`:
```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('./playUiMode', () => ({ getPlayUiMode: () => '3d' }));
const webglMock = vi.fn(() => true);
vi.mock('./webgl', () => ({ supportsWebGL: () => webglMock() }));
// Canvas placeholder (no 3D children) — see ThreeBattlefield.test.tsx for rationale.
vi.mock('@react-three/fiber', async () => {
  const actual = await vi.importActual<typeof import('@react-three/fiber')>('@react-three/fiber');
  return { ...actual, Canvas: () => <div data-testid="r3f-canvas" /> };
});

import { PlayExperience, type PlayExperienceProps } from '../PlayExperience';

// Minimal valid gameState + props; reuse a helper or inline a stub matching SimpleGameState's
// shape used by useGameView. (Copy the stub from PlayExperience's existing tests if present.)
function baseProps(): PlayExperienceProps {
  // NOTE: import or replicate the test fixture used by PlayExperience's existing suite.
  return require('../__fixtures__/playExperienceProps').makePlayExperienceProps();
}

beforeEach(() => webglMock.mockReturnValue(true));

describe('PlayExperience with ?ui=3d', () => {
  it('renders the 3D shell when WebGL is available', () => {
    render(<PlayExperience {...baseProps()} />);
    expect(screen.getByTestId('three-battlefield')).toBeInTheDocument();
  });

  it('falls back to a 2D shell when WebGL is unavailable', () => {
    webglMock.mockReturnValue(false);
    render(<PlayExperience {...baseProps()} />);
    expect(screen.queryByTestId('three-battlefield')).not.toBeInTheDocument();
  });
});
```

> If no shared `PlayExperience` props fixture exists, create `frontend/src/play/__fixtures__/playExperienceProps.ts` exporting `makePlayExperienceProps()` that returns a minimal valid `PlayExperienceProps` (a `gameState` with `humanPlayer`, empty zones; empty `legalActions`; `isHumanTurn: true`). Model it on the `GameView` stub used in Task 9's test, wrapped as the hook-output shape `PlayExperience` expects. Keep it in one place so other tests can reuse it.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/playExperience3d.test.tsx`
Expected: FAIL — `three-battlefield` not found (PlayExperience does not yet branch on 3D).

- [ ] **Step 3: Implement the wiring**

In `frontend/src/play/PlayExperience.tsx`, add imports near the other shell imports (after line 45):
```tsx
import { getPlayUiMode } from './r3f/playUiMode';
import { supportsWebGL } from './r3f/webgl';
import { ThreeBattlefield } from './r3f/ThreeBattlefield';
```

Replace the shell-selection block (currently lines ~328–330):
```tsx
  const uiV2 = useMemo(() => isPlayUiV2(), []);
  const Desktop = uiV2 ? DesktopBattlefieldV2 : DesktopBattlefield;
  const Mobile = uiV2 ? MobileTableV2 : MobileTable;
```
with:
```tsx
  const uiMode = useMemo(() => getPlayUiMode(), []);
  // 3D requires WebGL; otherwise fall back to the v2 2D look.
  const use3d = useMemo(() => uiMode === '3d' && supportsWebGL(), [uiMode]);
  const uiV2 = uiMode === 'v2' || uiMode === '3d';
  const Desktop = uiV2 ? DesktopBattlefieldV2 : DesktopBattlefield;
  const Mobile = uiV2 ? MobileTableV2 : MobileTable;
```

Replace the shell render line (currently line ~830):
```tsx
      {isDesktop ? <Desktop {...shellProps} /> : <Mobile {...shellProps} />}
```
with:
```tsx
      {use3d ? (
        <ThreeBattlefield {...shellProps} />
      ) : isDesktop ? (
        <Desktop {...shellProps} />
      ) : (
        <Mobile {...shellProps} />
      )}
```

- [ ] **Step 4: Run the new test + the full play suite to verify no regressions**

Run: `cd frontend && npx vitest run src/play/r3f/playExperience3d.test.tsx`
Expected: PASS (2 tests).

Run: `cd frontend && npx vitest run src/play`
Expected: PASS — existing PlayExperience/shell tests still green (v1/v2 unaffected).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/PlayExperience.tsx frontend/src/play/r3f/playExperience3d.test.tsx frontend/src/play/__fixtures__/playExperienceProps.ts
git commit -m "feat(play-3d): wire ?ui=3d into PlayExperience with 2D fallback"
```

---

### Task 13: Zone-change glide animation

**Files:**
- Create: `frontend/src/play/r3f/useGlide.ts`
- Test: `frontend/src/play/r3f/useGlide.test.ts`
- Modify: `frontend/src/play/r3f/CardMesh.tsx` (consume glide target), `frontend/src/play/r3f/BattlefieldScene.tsx` (track previous placements + invalidate)

**Interfaces:**
- Consumes: `Vec3` from `./layout`; `lerpVec3` from `./sceneDiff`.
- Produces:
  - `stepToward(current: Vec3, target: Vec3, dt: number, speed?: number): Vec3` — advances `current` toward `target` by `speed * dt` (as a fraction via `lerpVec3`), snapping when within an epsilon. Pure and unit-tested.
  - `CardMesh` uses `stepToward` inside `useFrame` to ease from its last rendered position to `placement.position`, so a card whose `position` changes (zone move) visibly glides. With `frameloop="demand"`, `BattlefieldScene` calls `invalidate()` while any card is mid-gli­de.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/play/r3f/useGlide.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { stepToward } from './useGlide';

describe('stepToward', () => {
  it('moves partway toward the target', () => {
    const next = stepToward([0, 0, 0], [10, 0, 0], 0.1, 5); // 0.1*5 = 0.5 fraction
    expect(next[0]).toBeCloseTo(5);
  });
  it('snaps to target when very close', () => {
    const next = stepToward([9.999, 0, 0], [10, 0, 0], 0.016, 5);
    expect(next).toEqual([10, 0, 0]);
  });
  it('does not overshoot', () => {
    const next = stepToward([0, 0, 0], [1, 0, 0], 1, 100);
    expect(next[0]).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/useGlide.test.ts`
Expected: FAIL — cannot find module `./useGlide`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/play/r3f/useGlide.ts`:
```ts
import type { Vec3 } from './layout';
import { lerpVec3 } from './sceneDiff';

const SNAP_EPS = 0.01;

export function stepToward(current: Vec3, target: Vec3, dt: number, speed = 5): Vec3 {
  const dist = Math.hypot(target[0] - current[0], target[1] - current[1], target[2] - current[2]);
  if (dist < SNAP_EPS) return target;
  const t = Math.min(1, speed * dt);
  return lerpVec3(current, target, t);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/useGlide.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Make `CardMesh` glide**

In `frontend/src/play/r3f/CardMesh.tsx`, replace the static `<group position=...>` with a ref-driven group that eases toward `placement.position` each frame. Add at the top of the imports:
```tsx
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Group } from 'three';
import { stepToward } from './useGlide';
```
Inside `CardMesh`, add a ref and frame loop, and drive position imperatively (drop `position` from the `<group>` JSX, set it via the ref instead):
```tsx
  const groupRef = useRef<Group>(null);
  useFrame((state, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const target: [number, number, number] = [x, y + lift, z];
    const cur: [number, number, number] = [g.position.x, g.position.y, g.position.z];
    const [nx, ny, nz] = stepToward(cur, target, dt);
    g.position.set(nx, ny, nz);
    if (nx !== target[0] || ny !== target[1] || nz !== target[2]) state.invalidate();
  });
```
Change the group opening tag to:
```tsx
    <group ref={groupRef} rotation={[0, placement.tapped ? Math.PI / 2 : 0, 0]}>
```
(initialize the ref's position once on mount so cards don't all fly from origin):
```tsx
  useEffect(() => {
    groupRef.current?.position.set(x, y + lift, z);
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```
Add `useEffect` to the React import.

> The existing CardMesh tests assert `group.instance.position` equals the placement coords. Because the mount effect sets the position immediately, those assertions still hold under test-renderer (which mounts effects). Re-run them in the next step to confirm.

- [ ] **Step 6: Run the full r3f suite to verify nothing regressed**

Run: `cd frontend && npx vitest run src/play/r3f`
Expected: PASS — all r3f tests including CardMesh position/tap tests.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/play/r3f/useGlide.ts frontend/src/play/r3f/useGlide.test.ts frontend/src/play/r3f/CardMesh.tsx
git commit -m "feat(play-3d): zone-change glide animation"
```

---

### Task 14: Full-suite gate + manual smoke check

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — entire suite green, including all `src/play/r3f` tests and untouched existing tests.

- [ ] **Step 2: Type-check / build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` and `vite build` succeed with no type errors.

- [ ] **Step 3: Manual smoke (human-in-the-loop)**

Run: `cd frontend && npm run dev`, open a game, and append `?ui=3d` to the play URL.
Verify, against the spec's 3D-depth acceptance criteria:
- The table is rendered in perspective with visible depth (near cards larger, far cards smaller).
- Your board is in the foreground; the opponent's board is across the table, further back.
- Hovering a card lifts it; clicking opens the action menu (CardViewerV2); a tapped permanent is rotated.
- A card changing zones glides to its new position.
- Phase track, priority controls, targeting, combat flow, and narration are visible as a DOM overlay and remain interactive.
- Visiting `?ui=3d` in a browser without WebGL (or with it disabled) falls back to the 2D shell.

- [ ] **Step 4: Commit any smoke-fix follow-ups** (only if changes were needed)

```bash
git add -A
git commit -m "fix(play-3d): smoke-test follow-ups"
```

---

## Self-Review

**Spec coverage:**
- Opt-in `?ui=3d` shell alongside 2D → Tasks 1, 12. ✓
- Consumes `GameView` + callback bag, no engine changes → Tasks 3, 6, 11 (uses `DesktopBattlefieldProps`); engine untouched. ✓
- Perspective 3D depth, solid cards, lift/tap → Tasks 8, 11 (perspective camera), CardMesh. ✓
- Stylized frames + (art optional/later), full art on inspect → Task 5 (frame signature/cache), Task 11 reuses `CardViewerV2` for the full-card inspect view. (Per-type frame theming + art inset textures are explicitly later-milestone; Milestone 1 ships ownership-colored frames + the DOM viewer for full detail.) ✓
- HUD/controls/modals as DOM overlay reusing v2 → Task 11. ✓
- Driving scene from GameView + zone-change glide → Tasks 3, 4, 13. ✓
- Interaction → same callbacks → Tasks 6, 11 (CardViewerV2 → props.onAction; targeting/combat via reused v2 controls). ✓
- Performance/mobile (DPR clamp, frameloop demand) → Task 11; responsive single canvas → Task 12 (3D used for all viewport sizes). ✓
- Error handling/fallback (WebGL unavailable) → Tasks 7, 12. ✓
- Testing strategy (pure seams + test-renderer + DOM) → Tasks 2–10 pure/test-renderer, 11–12 testing-library. ✓
- Milestone 1 = 1v1 vertical slice → whole plan; multiplayer/particles/postprocessing/camera-swing explicitly deferred. ✓

**Deferred to later milestones (intentionally not in this plan):** 4-seat rendering & camera swing-to-focus, particle/postprocessing effects, per-card-type frame theming + lazy art-inset textures, `prefers-reduced-motion` minimization, drei `PerformanceMonitor` adaptive quality, LOD, instancing. These are named in the spec's "Later milestones" and "Performance" sections and are not Milestone-1 acceptance criteria.

**Placeholder scan:** No "TBD"/"implement later" in task steps. The one external dependency (a shared `PlayExperience` props fixture in Task 12) has explicit creation instructions if absent.

**Type consistency:** `Vec3`, `ZoneRow`, `Placement`, `PlacementDiff`, `ObjectEntry` names are used identically across Tasks 2–13. `DesktopBattlefieldProps` is the single shell prop contract used by Tasks 11–12. `frameSignature`/`createFrameCache`, `buildPlacements`, `diffPlacements`/`lerpVec3`, `buildObjectIndex`/`toCardView`, `supportsWebGL`, `getPlayUiMode`, `stepToward` signatures match between their defining task and consumers.
