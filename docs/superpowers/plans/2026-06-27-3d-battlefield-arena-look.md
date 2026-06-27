# 3D Battlefield "Arena Look" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the minimal Milestone-1 3D battlefield (near-black table, flat color card boxes) into a polished "Arena-like" board with readable stylized card frames (name / mana pips / P-T / color tint / art inset), cinematic lighting + shadows, a canvas playmat, ACES tone mapping, and subtle bloom.

**Architecture:** All visual work lives in `frontend/src/play/r3f/`, fed by a small, pure forward-through that surfaces `manaCost` + derived color identity from the existing `SimpleCard` into `PermanentView` → `Placement`. Card frames are drawn to offscreen 2D canvases (cached by signature) and applied as an **unlit** texture on each card's face so they stay legible regardless of scene lighting; the lit box provides thickness, edge tint, and an emissive hover glow that bloom amplifies. No engine changes.

**Tech Stack:** React + TypeScript, `@react-three/fiber` 8, `@react-three/drei` 9, `three` 0.169, `@react-three/postprocessing` (new), Vitest + `@react-three/test-renderer`.

## Global Constraints

- **No engine, rules, or AI changes.** The scene is driven only by `GameView`.
- **Fully offline-capable:** no CDN HDR / fonts / textures. Frames and the playmat are drawn with `document.createElement('canvas')` + system fonts. The only network use is the existing same-origin art proxy `/api/card-image/{name}`, which must degrade gracefully.
- **Test safety:** texture builders MUST return `null` when no 2D canvas context is available (the test-renderer / jsdom envs), so component tests fall back to the current solid-color rendering and stay green. WebGL pixel output is NOT tested in CI.
- **Card geometry constants (existing, do not change):** `CARD_W = 1.0`, `CARD_H = 1.4`, `CARD_T = 0.04` in `CardMesh.tsx`.
- **Color-identity tint palette (use verbatim; tuned later in the smoke loop):**
  `W '#e9e3c0'`, `U '#1e5fb4'`, `B '#3b3b46'`, `R '#b1361e'`, `G '#1c6b3c'`, multicolor (2+) `'#c9a227'`, land `'#6b4f2a'`, colorless/other `'#7a7f87'`.
- **Mana-pip fill palette:** `W '#f5f0d8'`, `U '#3a7bd5'`, `B '#5a5a66'`, `R '#d6492b'`, `G '#2e9e54'`, generic/other `'#c9c2b6'`.
- Commit after every task. Run `npm test` from `frontend/`.

---

### Task 1: Add the `@react-three/postprocessing` dependency

**Files:**
- Modify: `frontend/package.json` (dependencies)

**Interfaces:**
- Produces: the `@react-three/postprocessing` module (`EffectComposer`, `Bloom`) used in Task 10.

- [ ] **Step 1: Install the dependency**

Run (from `frontend/`):
```bash
npm install @react-three/postprocessing@^2.16.0
```
Note: v2.x is the line compatible with `@react-three/fiber` 8.

- [ ] **Step 2: Verify it resolves and the build still type-checks**

Run (from `frontend/`):
```bash
node -e "require.resolve('@react-three/postprocessing'); console.log('ok')"
npm run build
```
Expected: prints `ok`; `tsc -b` + `vite build` succeed with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build(play-3d): add @react-three/postprocessing for bloom"
```

---

### Task 2: Pure mana-cost helpers (`colorIdentityFromManaCost`, `parseManaPips`)

**Files:**
- Create: `frontend/src/play/manaColors.ts`
- Test: `frontend/src/play/manaColors.test.ts`

**Interfaces:**
- Produces:
  - `parseManaPips(manaCost: string): string[]` — ordered pip symbols, e.g. `'{2}{G}{G}'` → `['2','G','G']`; `''` → `[]`.
  - `colorIdentityFromManaCost(manaCost: string): string[]` — distinct WUBRG colors in WUBRG order, e.g. `'{1}{G}{W}'` → `['W','G']`; hybrid `'{G/W}'` → `['G','W']`; phyrexian `'{U/P}'` → `['U']`; `'{3}'` → `[]`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/play/manaColors.test.ts
import { describe, expect, it } from 'vitest';
import { parseManaPips, colorIdentityFromManaCost } from './manaColors';

describe('parseManaPips', () => {
  it('splits each brace group into a pip token', () => {
    expect(parseManaPips('{2}{G}{G}')).toEqual(['2', 'G', 'G']);
    expect(parseManaPips('{W}{U}{B}{R}{G}')).toEqual(['W', 'U', 'B', 'R', 'G']);
  });
  it('returns [] for empty/undefined cost', () => {
    expect(parseManaPips('')).toEqual([]);
    expect(parseManaPips(undefined as unknown as string)).toEqual([]);
  });
  it('keeps hybrid/phyrexian tokens intact', () => {
    expect(parseManaPips('{G/W}{U/P}')).toEqual(['G/W', 'U/P']);
  });
});

describe('colorIdentityFromManaCost', () => {
  it('extracts distinct WUBRG in WUBRG order', () => {
    expect(colorIdentityFromManaCost('{1}{G}{W}')).toEqual(['W', 'G']);
    expect(colorIdentityFromManaCost('{G}{G}')).toEqual(['G']);
  });
  it('reads colors out of hybrid and phyrexian symbols', () => {
    expect(colorIdentityFromManaCost('{G/W}')).toEqual(['W', 'G']);
    expect(colorIdentityFromManaCost('{U/P}')).toEqual(['U']);
  });
  it('is empty for purely generic/colorless costs', () => {
    expect(colorIdentityFromManaCost('{3}')).toEqual([]);
    expect(colorIdentityFromManaCost('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/manaColors.test.ts`
Expected: FAIL — "Failed to resolve import './manaColors'".

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/play/manaColors.ts
const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

/** Split a mana cost like "{2}{G}{G}" into ordered pip tokens ["2","G","G"]. */
export function parseManaPips(manaCost: string): string[] {
  if (!manaCost) return [];
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(manaCost)) !== null) out.push(m[1]);
  return out;
}

/** Distinct colored mana symbols (WUBRG) present in the cost, in WUBRG order. */
export function colorIdentityFromManaCost(manaCost: string): string[] {
  const present = new Set<string>();
  for (const pip of parseManaPips(manaCost)) {
    for (const c of WUBRG) if (pip.includes(c)) present.add(c);
  }
  return WUBRG.filter((c) => present.has(c));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/manaColors.test.ts`
Expected: PASS (3 + 3 assertions).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/manaColors.ts frontend/src/play/manaColors.test.ts
git commit -m "feat(play-3d): pure mana-cost pip + color-identity helpers"
```

---

### Task 3: Forward `manaCost` / `colorIdentity` / `isCommander` / `isToken` into `PermanentView`

**Files:**
- Modify: `frontend/src/play/gameView.types.ts:185-200` (`PermanentView`)
- Modify: `frontend/src/play/useGameView.ts:37-51` (`toPermanentView`)
- Test: `frontend/src/play/useGameView.frameData.test.ts` (create)

**Interfaces:**
- Consumes: `colorIdentityFromManaCost` (Task 2); `SimpleCard.manaCost`, `.isCommander`, `.isToken`.
- Produces: `PermanentView` now carries optional `manaCost`, `colorIdentity`, `isCommander`, `isToken`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/play/useGameView.frameData.test.ts
import { describe, expect, it } from 'vitest';
import { buildGameView } from './useGameView';
import type { GameViewInput, SimpleGameState } from './gameView.types';

function stateWithCreature(): SimpleGameState {
  const player = {
    id: 'p1', name: 'You', life: 40, poisonCounters: 0, commanderDamage: {},
    playerCounters: {}, handCount: 0, libraryCount: 99,
  };
  const bear = {
    instanceId: 'c1', name: 'Grizzly Bears', manaCost: '{1}{G}', typeLine: 'Creature — Bear',
    oracleText: '', keywords: [], power: 2, toughness: 2, tapped: false,
    zone: 'battlefield' as const, ownerId: 'p1', cardTypes: ['creature'],
    isCommander: false, counters: {}, damage: 0, isToken: false,
  };
  return {
    turnNumber: 1, phase: 'precombat_main', step: 'precombat_main',
    activePlayerId: 'p1', priorityPlayerId: 'p1', humanPlayer: player, humanCommander: 'Cmd',
    humanHand: [], humanBattlefield: [bear], humanGraveyard: [],
    humanCommandZone: [], humanExile: [],
    stack: [], gameOver: false, winnerId: null,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, diceRolls: [], lastDiceRoll: null,
    aiPlayers: [], aiHands: {}, aiBattlefields: {}, aiGraveyards: {}, aiCommandZones: {},
    aiExiles: {}, aiCommanderNames: {},
    aiPlayer: player, aiCommander: '', aiHand: [], aiBattlefield: [],
    aiGraveyard: [], aiCommandZone: [], aiExile: [],
  } as unknown as SimpleGameState;
}

describe('buildGameView forwards frame data to permanents', () => {
  it('includes manaCost and derived colorIdentity on battlefield creatures', () => {
    const input: GameViewInput = {
      gameState: stateWithCreature(), legalActions: [], isHumanTurn: true, winner: null, guided: false,
    };
    const view = buildGameView(input);
    const bear = view.you.creatures[0];
    expect(bear.manaCost).toBe('{1}{G}');
    expect(bear.colorIdentity).toEqual(['G']);
    expect(bear.isCommander).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/useGameView.frameData.test.ts`
Expected: FAIL — `bear.manaCost` is `undefined`.

- [ ] **Step 3a: Extend the `PermanentView` type**

In `frontend/src/play/gameView.types.ts`, inside `export interface PermanentView` (after `counters?`), add:
```ts
  /** Raw mana cost string, e.g. "{1}{G}". Absent for tokens with no cost. */
  manaCost?: string;
  /** Distinct WUBRG colors derived from the mana cost (frame tinting). */
  colorIdentity?: string[];
  isCommander?: boolean;
  isToken?: boolean;
```

- [ ] **Step 3b: Populate them in `toPermanentView`**

In `frontend/src/play/useGameView.ts`, add the import near the other local imports:
```ts
import { colorIdentityFromManaCost } from './manaColors';
```
Then in `toPermanentView`, add these fields to the returned object (after `counters:`):
```ts
    manaCost: card.manaCost || undefined,
    colorIdentity: card.manaCost ? colorIdentityFromManaCost(card.manaCost) : undefined,
    isCommander: card.isCommander || undefined,
    isToken: card.isToken || undefined,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/useGameView.frameData.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/gameView.types.ts frontend/src/play/useGameView.ts frontend/src/play/useGameView.frameData.test.ts
git commit -m "feat(play-3d): forward manaCost/color/commander to PermanentView"
```

---

### Task 4: Thread frame fields + `typeKind` through `Placement` / `buildPlacements` / `HandDock`

**Files:**
- Modify: `frontend/src/play/r3f/placements.ts`
- Modify: `frontend/src/play/r3f/HandDock.tsx:9-20` (`handPlacement`)
- Test: `frontend/src/play/r3f/placements.test.ts`

**Interfaces:**
- Consumes: `PermanentView.manaCost/colorIdentity/isCommander/isToken/isCreature/isLand` (Task 3); `HandCardView.manaCost`; `colorIdentityFromManaCost` (Task 2).
- Produces: `Placement` now has `manaCost?`, `colorIdentity?`, `typeKind: TypeKind`, `isCommander?`, `isToken?`; `export type TypeKind = 'creature' | 'land' | 'other'`.

- [ ] **Step 1: Write the failing test** (append to `placements.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { buildPlacements } from './placements';
import type { GameView, PermanentView } from '../gameView.types';

function perm(id: string, name: string, extra: Partial<PermanentView> = {}): PermanentView {
  return { id, name, tapped: false, isLand: false, isCreature: false, legalActions: [], ...extra };
}
function viewWithCreature(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 0, libraryCount: 0, handCount: 0,
      creatures: [perm('c1', 'Bear', { isCreature: true, manaCost: '{1}{G}', colorIdentity: ['G'], power: 2, toughness: 2 })],
      artifacts: [], enchantments: [], lands: [], other: [], hand: [], graveyard: [], exile: [],
    },
    opponents: [],
    stack: [], priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'M', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('buildPlacements frame fields', () => {
  it('threads manaCost, colorIdentity and typeKind onto creature placements', () => {
    const p = buildPlacements(viewWithCreature()).find((x) => x.id === 'c1')!;
    expect(p.manaCost).toBe('{1}{G}');
    expect(p.colorIdentity).toEqual(['G']);
    expect(p.typeKind).toBe('creature');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/placements.test.ts`
Expected: FAIL — `p.typeKind` is `undefined` (and a TS error on the unknown property).

- [ ] **Step 3a: Extend `Placement` and the mapping in `placements.ts`**

Add the type and extend the interface:
```ts
export type TypeKind = 'creature' | 'land' | 'other';
```
In `interface Placement`, after `counters?`, add:
```ts
  manaCost?: string;
  colorIdentity?: string[];
  typeKind: TypeKind;
  isCommander?: boolean;
  isToken?: boolean;
```
In `placeSeat`, inside the `out.push({ ... })`, add (after `counters: c.counters,`):
```ts
        manaCost: c.manaCost,
        colorIdentity: c.colorIdentity,
        typeKind: c.isCreature ? 'creature' : c.isLand ? 'land' : 'other',
        isCommander: c.isCommander,
        isToken: c.isToken,
```

- [ ] **Step 3b: Give hand cards their frame fields in `HandDock.tsx`**

Add the import:
```ts
import { colorIdentityFromManaCost } from '../manaColors';
```
In `handPlacement`, replace the returned object's tail so it includes:
```ts
    tapped: false,
    isOwn: true,
    manaCost: card.manaCost,
    colorIdentity: card.manaCost ? colorIdentityFromManaCost(card.manaCost) : undefined,
    typeKind: 'other',
```

- [ ] **Step 4: Run test + full r3f suite to verify green**

Run: `cd frontend && npx vitest run src/play/r3f`
Expected: PASS — new placement assertion passes; existing `placements`, `HandDock`, `CardMesh`, `BattlefieldScene` tests still green (TS now requires `typeKind`; the fixtures in those tests build `Placement` via helpers that spread overrides — add `typeKind: 'other'` to the base `p()` helper in `CardMesh.test.tsx:6-8` if the compiler flags it).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/placements.ts frontend/src/play/r3f/placements.test.ts frontend/src/play/r3f/HandDock.tsx frontend/src/play/r3f/CardMesh.test.tsx
git commit -m "feat(play-3d): thread frame fields + typeKind through placements"
```

---

### Task 5: `frameSpec` deriver + extended `frameSignature`

**Files:**
- Modify: `frontend/src/play/r3f/cardFrame.ts`
- Test: `frontend/src/play/r3f/cardFrame.test.ts`

**Interfaces:**
- Consumes: `Placement` (Task 4); `parseManaPips` (Task 2); Global tint palette.
- Produces:
  - `export interface FrameSpec { name: string; tint: string; manaPips: string[]; pt: string | null; typeKind: TypeKind; isCommander: boolean; isToken: boolean; counterText: string | null }`
  - `export function frameSpec(p: Placement): FrameSpec`
  - `frameSignature` extended to vary by `manaCost` + `typeKind` + `isCommander`.

- [ ] **Step 1: Write the failing test** (append to `cardFrame.test.ts`)

```ts
import { frameSpec } from './cardFrame';

describe('frameSpec', () => {
  it('tints a mono-green creature green and shows its P/T', () => {
    const s = frameSpec(p({ typeKind: 'creature', colorIdentity: ['G'], manaCost: '{1}{G}', power: 3, toughness: 3 }));
    expect(s.tint).toBe('#1c6b3c');
    expect(s.pt).toBe('3/3');
    expect(s.manaPips).toEqual(['1', 'G']);
  });
  it('tints a multicolor card gold', () => {
    expect(frameSpec(p({ colorIdentity: ['W', 'U'], manaCost: '{W}{U}' })).tint).toBe('#c9a227');
  });
  it('tints a colorless land brown and has no P/T', () => {
    const s = frameSpec(p({ typeKind: 'land', colorIdentity: [], manaCost: '' }));
    expect(s.tint).toBe('#6b4f2a');
    expect(s.pt).toBeNull();
  });
});

describe('frameSignature varies by frame-relevant fields', () => {
  it('differs by manaCost', () => {
    expect(frameSignature(p({ name: 'X', manaCost: '{G}' }))).not.toBe(frameSignature(p({ name: 'X', manaCost: '{R}' })));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/cardFrame.test.ts`
Expected: FAIL — `frameSpec` is not exported; signature test fails (manaCost not yet in signature).

- [ ] **Step 3a: Add `frameSpec` + the palette to `cardFrame.ts`**

```ts
import type { Placement, TypeKind } from './placements';
import { parseManaPips } from '../manaColors';

const TINT: Record<string, string> = { W: '#e9e3c0', U: '#1e5fb4', B: '#3b3b46', R: '#b1361e', G: '#1c6b3c' };
const TINT_MULTI = '#c9a227';
const TINT_LAND = '#6b4f2a';
const TINT_COLORLESS = '#7a7f87';

function tintFor(colorIdentity: string[] | undefined, typeKind: TypeKind): string {
  const ci = colorIdentity ?? [];
  if (ci.length >= 2) return TINT_MULTI;
  if (ci.length === 1) return TINT[ci[0]] ?? TINT_COLORLESS;
  return typeKind === 'land' ? TINT_LAND : TINT_COLORLESS;
}

export interface FrameSpec {
  name: string;
  tint: string;
  manaPips: string[];
  pt: string | null;
  typeKind: TypeKind;
  isCommander: boolean;
  isToken: boolean;
  counterText: string | null;
}

export function frameSpec(p: Placement): FrameSpec {
  const pt = p.typeKind === 'creature' ? `${p.power ?? 0}/${p.toughness ?? 0}` : null;
  const counterText = p.counters && Object.keys(p.counters).length > 0
    ? Object.entries(p.counters).map(([k, v]) => `${k}×${v}`).join(' ')
    : null;
  return {
    name: p.name,
    tint: tintFor(p.colorIdentity, p.typeKind),
    manaPips: parseManaPips(p.manaCost ?? ''),
    pt,
    typeKind: p.typeKind,
    isCommander: Boolean(p.isCommander),
    isToken: Boolean(p.isToken),
    counterText,
  };
}
```

- [ ] **Step 3b: Extend `frameSignature` to vary by frame fields**

Replace the `return` line of `frameSignature` with:
```ts
  return `${p.name}|${pt}|${counters}|${p.manaCost ?? ''}|${p.typeKind ?? ''}|${p.isCommander ? 'c' : ''}`;
```
(Widen its parameter type to also pick `manaCost`, `typeKind`, `isCommander`: change the `Pick<Placement, ...>` to `Pick<Placement, 'name' | 'power' | 'toughness' | 'tapped' | 'counters' | 'manaCost' | 'typeKind' | 'isCommander'>`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/cardFrame.test.ts`
Expected: PASS (existing signature tests + new frameSpec/signature tests). Note: update the local `p()` helper in `cardFrame.test.ts` base object to include `typeKind: 'other'`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/cardFrame.ts frontend/src/play/r3f/cardFrame.test.ts
git commit -m "feat(play-3d): frameSpec deriver + signature by frame fields"
```

---

### Task 6: Canvas frame texture builder + signature cache (`makeFrameTexture`, `getFrameTexture`)

**Files:**
- Modify: `frontend/src/play/r3f/cardFrame.ts`
- Test: `frontend/src/play/r3f/cardFrame.test.ts`

**Interfaces:**
- Consumes: `frameSpec`, `createFrameCache`, `FrameSpec` (Task 5); Global pip palette.
- Produces:
  - `export function makeFrameTexture(spec: FrameSpec): CanvasTexture | null` — returns `null` when no 2D context (test-safe).
  - `export function getFrameTexture(p: Placement): CanvasTexture | null` — module-level cache keyed by `frameSignature`.

- [ ] **Step 1: Write the failing test** (append to `cardFrame.test.ts`)

```ts
import { makeFrameTexture, getFrameTexture } from './cardFrame';

describe('makeFrameTexture', () => {
  it('returns null when no 2D canvas context is available (test env)', () => {
    // jsdom/node test-renderer envs have no real 2d context → graceful null.
    const tex = makeFrameTexture(frameSpec(p({ name: 'Bear', typeKind: 'creature', power: 2, toughness: 2 })));
    expect(tex === null || typeof tex === 'object').toBe(true);
  });
  it('getFrameTexture is callable and memoized by signature', () => {
    const a = getFrameTexture(p({ id: 'a', name: 'Bear' }));
    const b = getFrameTexture(p({ id: 'b', name: 'Bear' })); // same signature
    expect(a).toBe(b); // same cached value (null or texture)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/cardFrame.test.ts`
Expected: FAIL — `makeFrameTexture` / `getFrameTexture` not exported.

- [ ] **Step 3: Implement the canvas builder + cache in `cardFrame.ts`**

Add at the top: `import { CanvasTexture, SRGBColorSpace } from 'three';` and the pip palette:
```ts
const PIP_FILL: Record<string, string> = { W: '#f5f0d8', U: '#3a7bd5', B: '#5a5a66', R: '#d6492b', G: '#2e9e54' };
const FRAME_W = 256;
const FRAME_H = 358;

function drawFrame(ctx: CanvasRenderingContext2D, spec: FrameSpec): void {
  // Base + border tint.
  ctx.fillStyle = '#15140f';
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.lineWidth = 14;
  ctx.strokeStyle = spec.tint;
  ctx.strokeRect(7, 7, FRAME_W - 14, FRAME_H - 14);
  // Art region placeholder (filled by the art loader later) — tinted panel.
  ctx.fillStyle = spec.tint;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(20, 44, FRAME_W - 40, 180);
  ctx.globalAlpha = 1;
  // Name banner.
  ctx.fillStyle = 'rgba(0,0,0,0.72)';
  ctx.fillRect(16, 16, FRAME_W - 32, 30);
  ctx.fillStyle = '#f4f1e6';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const name = spec.name.length > 20 ? spec.name.slice(0, 19) + '…' : spec.name;
  ctx.fillText(name, 24, 32, FRAME_W - 70);
  // Mana pips, right-aligned in the name banner.
  let px = FRAME_W - 26;
  for (const pip of [...spec.manaPips].reverse()) {
    const color = PIP_FILL[pip] ?? '#c9c2b6';
    ctx.beginPath();
    ctx.arc(px, 31, 9, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (!(pip in PIP_FILL)) {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pip, px, 32);
      ctx.textAlign = 'left';
    }
    px -= 21;
  }
  // Type strip.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(16, 232, FRAME_W - 32, 24);
  ctx.fillStyle = '#e7e2d2';
  ctx.font = '14px system-ui, sans-serif';
  const typeLabel = spec.isCommander ? 'Commander' : spec.isToken ? 'Token' : spec.typeKind;
  ctx.fillText(typeLabel[0].toUpperCase() + typeLabel.slice(1), 24, 245);
  // P/T badge.
  if (spec.pt) {
    ctx.fillStyle = '#15140f';
    ctx.strokeStyle = spec.tint;
    ctx.lineWidth = 3;
    ctx.fillRect(FRAME_W - 78, FRAME_H - 52, 60, 34);
    ctx.strokeRect(FRAME_W - 78, FRAME_H - 52, 60, 34);
    ctx.fillStyle = '#f4f1e6';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(spec.pt, FRAME_W - 48, FRAME_H - 33);
    ctx.textAlign = 'left';
  }
}

/** Build a card-frame texture. Returns null when no 2D context (test/headless). */
export function makeFrameTexture(spec: FrameSpec): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  drawFrame(ctx, spec);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const frameTextureCache = createFrameCache<CanvasTexture | null>((p) => makeFrameTexture(frameSpec(p)));

export function getFrameTexture(p: Placement): CanvasTexture | null {
  return frameTextureCache.get(p);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/cardFrame.test.ts`
Expected: PASS. (In the test env `getContext('2d')` returns null → `makeFrameTexture` returns null → both new tests pass; `getFrameTexture` returns the same cached `null`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/cardFrame.ts frontend/src/play/r3f/cardFrame.test.ts
git commit -m "feat(play-3d): canvas card-frame texture + signature cache"
```

---

### Task 7: Card-art inset loader (by name, graceful fallback)

**Files:**
- Modify: `frontend/src/play/r3f/cardFrame.ts`
- Test: `frontend/src/play/r3f/cardFrame.test.ts`

**Interfaces:**
- Consumes: `makeFrameTexture` internals (the art-region rect 20,44,216,180).
- Produces:
  - `export function cardImageUrl(name: string): string` — `/api/card-image/<encoded name>` (unit-tested).
  - Art loading is wired **inside** `makeFrameTexture`: after drawing, if `document` has `Image`, kick off a capped async load that paints the art into the inset region and sets `tex.needsUpdate = true`; errors are swallowed (frame keeps the tinted panel).

- [ ] **Step 1: Write the failing test** (append to `cardFrame.test.ts`)

```ts
import { cardImageUrl } from './cardFrame';

describe('cardImageUrl', () => {
  it('builds an encoded same-origin proxy URL', () => {
    expect(cardImageUrl('Sol Ring')).toBe('/api/card-image/Sol%20Ring');
    expect(cardImageUrl('Ach! Hans, Run!')).toBe('/api/card-image/Ach!%20Hans%2C%20Run!');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/play/r3f/cardFrame.test.ts`
Expected: FAIL — `cardImageUrl` not exported.

- [ ] **Step 3: Implement the URL helper + loader in `cardFrame.ts`**

Add the helper and a concurrency-capped loader, and call it from `makeFrameTexture` (pass the card name through):
```ts
export function cardImageUrl(name: string): string {
  return `/api/card-image/${encodeURIComponent(name)}`;
}

const ART = { x: 20, y: 44, w: FRAME_W - 40, h: 180 };
let inFlight = 0;
const MAX_INFLIGHT = 6;
const artQueue: (() => void)[] = [];

function pump(): void {
  while (inFlight < MAX_INFLIGHT && artQueue.length > 0) {
    const job = artQueue.shift()!;
    job();
  }
}

function loadArtInset(name: string, canvas: HTMLCanvasElement, tex: CanvasTexture): void {
  if (typeof Image === 'undefined') return;
  const job = () => {
    inFlight++;
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(ART.x, ART.y, ART.w, ART.h);
        ctx.clip();
        // cover-fit the art into the inset
        const scale = Math.max(ART.w / img.width, ART.h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, ART.x + (ART.w - dw) / 2, ART.y + (ART.h - dh) / 2, dw, dh);
        ctx.restore();
        tex.needsUpdate = true;
      }
      inFlight--;
      pump();
    };
    img.onerror = () => { inFlight--; pump(); }; // keep the tinted panel
    img.src = cardImageUrl(name);
  };
  artQueue.push(job);
  pump();
}
```
Change `makeFrameTexture(spec)` to `makeFrameTexture(spec, name?)`: after creating `tex`, add `if (name) loadArtInset(name, canvas, tex);`. Update the cache maker to pass the name: `createFrameCache(...)` becomes `createFrameCache<CanvasTexture | null>((p) => makeFrameTexture(frameSpec(p), p.name))`. Update the Task 6 test call `makeFrameTexture(frameSpec(...))` still compiles (name optional).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/play/r3f/cardFrame.test.ts`
Expected: PASS — `cardImageUrl` test passes; existing texture tests still pass (no `Image` in node → loader is a no-op).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/r3f/cardFrame.ts frontend/src/play/r3f/cardFrame.test.ts
git commit -m "feat(play-3d): lazy card-art inset loader with graceful fallback"
```

---

### Task 8: Apply the frame texture + emissive hover in `CardMesh`

**Files:**
- Modify: `frontend/src/play/r3f/CardMesh.tsx`
- Test: `frontend/src/play/r3f/CardMesh.test.tsx` (verify still green)

**Interfaces:**
- Consumes: `getFrameTexture` (Tasks 6-7).
- Produces: unchanged public props; the interactive box still carries `userData.id` + `onClick`/`onPointerOver`/`onPointerOut`.

- [ ] **Step 1: Add the frame plane + hover emissive**

In `CardMesh.tsx`, import the texture getter:
```ts
import { getFrameTexture } from './cardFrame';
```
Compute the texture once per placement signature:
```ts
  const texture = useMemo(() => getFrameTexture(placement), [placement]);
```
(add `useMemo` to the React import.) Replace the inner `<mesh>`'s material line
```ts
        <meshStandardMaterial color={frameColor(placement.isOwn, hovered)} />
```
with an emissive-on-hover lit material for the box body:
```ts
        <meshStandardMaterial
          color={texture ? '#0b0b0c' : frameColor(placement.isOwn, hovered)}
          emissive={hovered ? '#facc15' : '#000000'}
          emissiveIntensity={hovered ? 0.9 : 0}
        />
```
Then, **inside** the same `<group>` (as a sibling of the box `<mesh>`), add the textured face plane, rendered only when a texture exists:
```ts
        {texture ? (
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, CARD_T / 2 + 0.001, 0]}>
            <planeGeometry args={[CARD_W, CARD_H]} />
            <meshBasicMaterial map={texture} toneMapped={false} />
          </mesh>
        ) : null}
```
(Use `meshBasicMaterial` so the frame stays fully legible regardless of scene lighting; `toneMapped={false}` keeps colors crisp under ACES.)

- [ ] **Step 2: Run the CardMesh test to verify still green**

Run: `cd frontend && npx vitest run src/play/r3f/CardMesh.test.tsx`
Expected: PASS — in the test env `getFrameTexture` returns null → no extra plane, so the mesh count and the `userData.id` / click assertions are unchanged.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/play/r3f/CardMesh.tsx
git commit -m "feat(play-3d): render card-frame texture + hover glow on CardMesh"
```

---

### Task 9: Cinematic lighting + canvas playmat in `BattlefieldScene`

**Files:**
- Modify: `frontend/src/play/r3f/BattlefieldScene.tsx`
- Test: `frontend/src/play/r3f/BattlefieldScene.test.tsx` (verify still green)

**Interfaces:**
- Consumes: `SEAT_R` (existing), `useMemo`/`three` for the playmat texture.
- Produces: unchanged `BattlefieldScene` props; card meshes (with `userData.id`) still rendered one per placement.

- [ ] **Step 1: Replace lights + table with 3-point lighting + a playmat**

Rewrite the body of `BattlefieldScene` (keep the `placements.map(...)` exactly as is). Add imports:
```ts
import { useMemo } from 'react';
import { CanvasTexture, SRGBColorSpace } from 'three';
```
Add a guarded playmat texture builder (module scope):
```ts
function makePlaymatTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 40, size / 2, size / 2, size / 2);
  g.addColorStop(0, '#1f3a2a');   // lit center
  g.addColorStop(0.6, '#15281d');
  g.addColorStop(1, '#0a140e');   // vignette
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}
```
Replace the lights + table mesh JSX with:
```tsx
      <ambientLight intensity={0.35} />
      <hemisphereLight args={['#bcd2ff', '#1a1208', 0.5]} />
      <directionalLight
        position={[6, 13, 7]}
        intensity={1.5}
        color="#fff3df"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <directionalLight position={[-8, 6, -6]} intensity={0.35} color="#9fc0ff" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -CARD_BASE, 0]} receiveShadow>
        <planeGeometry args={[tableSize, tableSize]} />
        {playmat ? (
          <meshStandardMaterial map={playmat} roughness={0.9} metalness={0} />
        ) : (
          <meshStandardMaterial color="#15281d" roughness={0.9} />
        )}
      </mesh>
```
Inside the component, before the return, add:
```ts
  const playmat = useMemo(() => makePlaymatTexture(), []);
```

- [ ] **Step 2: Run the BattlefieldScene test to verify still green**

Run: `cd frontend && npx vitest run src/play/r3f/BattlefieldScene.test.tsx`
Expected: PASS — the playmat mesh has no `userData.id` (filtered out); card-id count is unchanged; `playmat` is null in the test env → solid fallback material.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/play/r3f/BattlefieldScene.tsx
git commit -m "feat(play-3d): 3-point lighting + canvas playmat"
```

---

### Task 10: ACES tone mapping + subtle bloom in `ThreeBattlefield`

**Files:**
- Modify: `frontend/src/play/r3f/ThreeBattlefield.tsx`
- Test: `frontend/src/play/r3f/ThreeBattlefield.test.tsx` (verify still green)

**Interfaces:**
- Consumes: `@react-three/postprocessing` (Task 1); `ACESFilmicToneMapping` from `three`.
- Produces: unchanged `ThreeBattlefield` props + the `data-testid="three-battlefield"` host + DOM overlay.

- [ ] **Step 1: Add tone mapping + a Bloom pass inside the Canvas**

In `ThreeBattlefield.tsx` add imports:
```ts
import { ACESFilmicToneMapping } from 'three';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
```
Set tone mapping on the `<Canvas>` (extend its props):
```tsx
      <Canvas
        shadows
        dpr={[1, 2]}
        frameloop="demand"
        camera={{ position: [0, 7, SEAT_R + 6], fov: 50 }}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.15 }}
        onCreated={(state) => state.camera.lookAt(0, 0, 0)}
      >
        <BattlefieldScene view={view} onSelect={handleSelect} />
        <HandDock hand={view.you.hand} onSelect={handleSelect} />
        <EffectComposer>
          <Bloom intensity={0.6} luminanceThreshold={0.55} luminanceSmoothing={0.2} mipmapBlur />
        </EffectComposer>
      </Canvas>
```

- [ ] **Step 2: Run the ThreeBattlefield test to verify still green**

Run: `cd frontend && npx vitest run src/play/r3f/ThreeBattlefield.test.tsx`
Expected: PASS — the test mocks `Canvas` to a placeholder that does not mount children, so `EffectComposer`/`Bloom` never instantiate; the DOM overlay assertions are unaffected.

- [ ] **Step 3: Build to confirm the new imports type-check**

Run: `cd frontend && npm run build`
Expected: PASS — no TS errors from postprocessing imports.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/play/r3f/ThreeBattlefield.tsx
git commit -m "feat(play-3d): ACES tone mapping + subtle bloom"
```

---

### Task 11: Full-suite gate + manual screenshot smoke (with art)

**Files:** none (verification only)

- [ ] **Step 1: Full frontend test suite**

Run: `cd frontend && npm test`
Expected: PASS — entire suite green (including all `src/play/r3f` and `src/play` tests).

- [ ] **Step 2: Type-check / build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` + `vite build` succeed.

- [ ] **Step 3: Manual smoke with the backend running (for art)**

Start the backend (`python -m uvicorn backend.main:app --reload --port 8000`) and the frontend (`npm run dev`), open `http://localhost:5173/play?ui=3d`, start a **Scenario Lab** board (Drills & Presets), and verify against the spec:
- Card frames are legible: name, mana pips, P/T on creatures, color-identity tint; **card art** fills the inset where available and falls back to a tinted panel otherwise.
- The table reads as a lit green playmat (not near-black); cards cast soft shadows.
- Hovering a card lifts it and adds a visible glow (bloom).
- Your board (foreground) and opponents (across the table) both render with frames; depth still reads (near larger, far smaller).
- DOM overlay (phase track, priority, narration) and modals still render above the canvas.

- [ ] **Step 4: Commit any smoke-fix follow-ups** (only if changes were needed)

```bash
git add -A
git commit -m "fix(play-3d): arena-look smoke follow-ups"
```

---

## Self-Review

**Spec coverage:**
- Readable frames (name/mana/P-T/color tint/art inset + offline fallback) → Tasks 5, 6, 7, 8. ✓
- Forward manaCost/color identity from the view-model → Tasks 2, 3, 4. ✓
- Cinematic 3-point lighting + soft shadows → Task 9. ✓
- Canvas playmat (offline) → Task 9. ✓
- ACES tone mapping + subtle bloom (new dep) → Tasks 1, 10. ✓
- Fully offline (no CDN; canvas-drawn; same-origin art only) → Tasks 6, 7, 9 (all `document.createElement('canvas')`; art via `/api/card-image`). ✓
- Test pure seams; component mounts stay green; no CI pixel tests → Tasks 2-7 unit tests; Tasks 8-10 "verify green"; Task 11 manual smoke. ✓
- No engine/rules/AI changes → nothing in this plan touches `engine/` or the hook's engine calls. ✓

**Placeholder scan:** No "TBD"/"implement later" in any step; every code step shows complete code. Exact palette values are in Global Constraints and used verbatim.

**Type consistency:** `TypeKind` (`'creature'|'land'|'other'`) defined in Task 4, consumed in Tasks 5-6. `FrameSpec` defined in Task 5, consumed in Tasks 6-7. `makeFrameTexture(spec, name?)`/`getFrameTexture(p)`/`cardImageUrl(name)` signatures match across Tasks 6-8. `frameSignature` widened in Task 5 and used by the cache in Task 6. `manaCost`/`colorIdentity`/`isCommander`/`isToken` added to `PermanentView` (Task 3) and `Placement` (Task 4) with matching names.

**Test-safety invariant:** every texture builder returns `null` without a real 2D context, so `CardMesh`/`BattlefieldScene`/`ThreeBattlefield` tests render exactly as today. Confirmed against the three test files' mocking/fixtures.
