# Playing Field Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a flag-gated, ground-up visual redesign ("v2") of the in-browser Commander playing field — the deepened "Artisan Table" look — on desktop and mobile, adding an explorable zone (graveyard/exile/command) browser and a universal floating card viewer, then deploy it to the IONOS VPS.

**Architecture:** Reuse the entire data layer (engine → `useCommanderEngine`/`engineAdapter` → `useGameView`/`buildGameView` → `GameView`). Build a new theme + primitives layer and a parallel "v2" set of presentational components and two v2 shells that consume the *same* `GameView` and `DesktopBattlefieldProps` contract. A feature flag (`?ui=v2`) selects v2 shells inside `PlayExperience`; v1 stays the untouched fallback. No engine changes; one small upstream addition surfaces the exile zone.

**Tech Stack:** React 18 + TypeScript, Vite, Tailwind CSS 3.4, Vitest + jsdom + React Testing Library, the local `commander-engine` package.

## Global Constraints

These apply to **every** task. Values are copied verbatim from the design spec (`docs/superpowers/specs/2026-06-19-playing-field-redesign-design.md`).

- **Working directory for all frontend commands:** `frontend/`. Run tests with `npm run test` (alias for `vitest run`); a single file with `npx vitest run src/play/v2/<file>.test.tsx`; typecheck/build with `npm run build` (`tsc -b && vite build`); lint with `npm run lint`.
- **No engine changes.** Components consume `GameView` and fire the callbacks in `DesktopBattlefieldProps`. Never import from `commander-engine` in v2 components. The only non-`play/` file touched is `frontend/src/hooks/useShelectorGame.ts` (Task 2, exile surfacing).
- **Card art** is resolved by NAME via `<CardImage cardName={...} />` (prop is `cardName`, not `name`). Sizes: `'normal' | 'small'`.
- **Classname helper:** `import { cn } from '../../lib/utils'` — `cn(...inputs: ClassValue[])` (clsx + tailwind-merge).
- **Layout invariants (non-negotiable, from `playView.layout.ts`):** nothing is `position: fixed`; no absolute full-screen overlay over the board. The board lives in a `relative isolate` container; ALL overlays (targeting, combat, zone explorer, card viewer) anchor to that container via `absolute inset-0`, never the viewport. Every region carries an `svh` cap and scrolls within itself; the board scales-to-fit and never scrolls.
- **Reduced motion:** rely on the existing global `@media (prefers-reduced-motion: reduce)` rule in `src/index.css`; do not add motion that ignores it.
- **Design tokens (Tailwind names introduced in Task 1, used everywhere after):**
  - `table-felt #14251c`, `table-vignette #080b0a`, `table-frame #26190d`, `table-leather #281c10`, `table-leather2 #32230f`, `table-border #5a4324`, `table-border-hi #7a5a2a`
  - `card-stock #e3d2a6`, `card-border #9a824f`, `card-ink #2a1f10`, `card-badge #8a6f3f`
  - `brass #b8842c`, `brass-deep #9a6c1f`, `brass-on #241804`
  - `gold-label #d8b86a`, `gold-bright #ead6a4`, `gold-muted #a88c5e`
  - `ember #cf6a52`, `oxblood #8a2a1e`, `ring-combat #c79a45`
  - `mana-w #ece0ba`, `mana-u #2f5f86`, `mana-b #241c14`, `mana-r #9a3326`, `mana-g #2f6b40`
  - Font family `display` = `"Cormorant Garamond", Georgia, serif` (card names, life, zone titles, primary buttons). Body stays `Inter` (`font-sans`).
- **Shared types (introduced in Tasks 3–4, in `frontend/src/play/gameView.types.ts`), referenced by later tasks:**

  ```ts
  export interface ZoneCardView {
    id: string;
    name: string;
    legalActions: LegalAction[]; // [] where the zone affords you no action
  }

  export type CardZone =
    | 'battlefield' | 'hand' | 'stack' | 'graveyard' | 'exile' | 'command';

  export interface CardView {
    id: string;
    name: string;
    zone: CardZone;
    power?: number;
    toughness?: number;
    counters?: Record<string, number>;
    tapped?: boolean;
    isAttacking?: boolean;
    isBlocking?: boolean;
    statuses: string[];          // human-readable chips, e.g. ["Tapped","Attacking"]
    legalActions: LegalAction[];
  }
  ```

- **v2 directory:** everything new lives under `frontend/src/play/v2/` (`theme.ts`, `primitives/`, `components/`, `shells/`), except the `gameView.types.ts` / `useGameView.ts` / hook edits.
- **Commits:** one per task minimum, conventional-commit style, ending with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

---

### Task 1: Theme tokens + Cormorant font

**Files:**
- Modify: `frontend/tailwind.config.js` (extend `colors` + `fontFamily`)
- Modify: `frontend/index.html` (add Cormorant Garamond to the Google Fonts `<link>`)
- Create: `frontend/src/play/v2/theme.ts` (raw hex constants for non-class uses)
- Test: `frontend/src/play/v2/theme.test.ts`

**Interfaces:**
- Produces: Tailwind classes `bg-table-leather`, `text-gold-bright`, `font-display`, `text-ember`, `bg-mana-g`, etc. (the Global Constraints token list). `theme.ts` exports `TABLE`, `CARD`, `BRASS`, `GOLD`, `STATUS`, `MANA` const objects and `manaHex(color: 'W'|'U'|'B'|'R'|'G'|'C'): string`.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/play/v2/theme.test.ts
import { describe, expect, it } from 'vitest';
import { TABLE, MANA, manaHex } from './theme';

describe('v2 theme tokens', () => {
  it('exposes the locked felt + leather hexes', () => {
    expect(TABLE.felt).toBe('#14251c');
    expect(TABLE.leather).toBe('#281c10');
  });
  it('maps mana colors to hex, defaulting colorless to the black token', () => {
    expect(manaHex('G')).toBe(MANA.G);
    expect(manaHex('C')).toBe('#bfb39a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/theme.test.ts`
Expected: FAIL — `Cannot find module './theme'`.

- [ ] **Step 3: Write the theme constants**

```ts
// frontend/src/play/v2/theme.ts
// Raw hexes for places Tailwind classes can't reach (inline styles, canvas,
// dynamic mana colors). Tailwind class names are the primary styling path;
// these mirror the same values (see tailwind.config.js + Global Constraints).
export const TABLE = {
  felt: '#14251c', vignette: '#080b0a', frame: '#26190d',
  leather: '#281c10', leather2: '#32230f', border: '#5a4324', borderHi: '#7a5a2a',
} as const;
export const CARD = { stock: '#e3d2a6', border: '#9a824f', ink: '#2a1f10', badge: '#8a6f3f' } as const;
export const BRASS = { base: '#b8842c', deep: '#9a6c1f', on: '#241804' } as const;
export const GOLD = { label: '#d8b86a', bright: '#ead6a4', muted: '#a88c5e' } as const;
export const STATUS = { ember: '#cf6a52', oxblood: '#8a2a1e', ring: '#c79a45' } as const;
export const MANA = { W: '#ece0ba', U: '#2f5f86', B: '#241c14', R: '#9a3326', G: '#2f6b40' } as const;

export function manaHex(color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'): string {
  if (color === 'C') return '#bfb39a';
  return MANA[color];
}
```

- [ ] **Step 4: Extend the Tailwind config**

In `frontend/tailwind.config.js`, inside `theme.extend`, add a `display` font family and the token colors (merge into the existing `extend` object — keep `stone`, fonts, keyframes intact):

```js
fontFamily: {
  sans: ['Inter', 'system-ui', 'sans-serif'],
  serif: ['Merriweather', 'Georgia', 'serif'],
  display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
  mono: ['JetBrains Mono', 'monospace'],
},
colors: {
  // ...keep existing stone scale...
  table: {
    felt: '#14251c', vignette: '#080b0a', frame: '#26190d',
    leather: '#281c10', leather2: '#32230f', border: '#5a4324', 'border-hi': '#7a5a2a',
  },
  card: { stock: '#e3d2a6', border: '#9a824f', ink: '#2a1f10', badge: '#8a6f3f' },
  brass: { DEFAULT: '#b8842c', deep: '#9a6c1f', on: '#241804' },
  gold: { label: '#d8b86a', bright: '#ead6a4', muted: '#a88c5e' },
  ember: '#cf6a52',
  oxblood: '#8a2a1e',
  'ring-combat': '#c79a45',
  mana: { w: '#ece0ba', u: '#2f5f86', b: '#241c14', r: '#9a3326', g: '#2f6b40' },
},
```

- [ ] **Step 5: Load the Cormorant font**

In `frontend/index.html`, replace the existing fonts `<link href="https://fonts.googleapis.com/css2?...">` so the family list also includes Cormorant Garamond:

```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet">
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/play/v2/theme.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Verify Tailwind compiles the new tokens**

Run: `npm run build`
Expected: build succeeds (no Tailwind/TS errors).

- [ ] **Step 8: Commit**

```bash
git add frontend/tailwind.config.js frontend/index.html frontend/src/play/v2/theme.ts frontend/src/play/v2/theme.test.ts
git commit -m "feat(play-v2): add Artisan-deep theme tokens + Cormorant font"
```

---

### Task 2: Surface the exile zone in `SimpleGameState`

**Files:**
- Modify: `frontend/src/hooks/useShelectorGame.ts` (the `SimpleGameState` interface ~line 248, and `deriveSimpleState` ~lines 2099–2262)
- Test: `frontend/src/hooks/useShelectorGame.exile.test.ts`

**Interfaces:**
- Consumes: existing `mapCards(engine, zone, playerId): SimpleCard[]` helper and `deriveSimpleState`.
- Produces: `SimpleGameState` gains `humanExile: SimpleCard[]`, `aiExiles: Record<string, SimpleCard[]>`, and `aiExile: SimpleCard[]` (first-AI alias). Used by Task 3.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/hooks/useShelectorGame.exile.test.ts
import { describe, expect, it } from 'vitest';
import {
  createPlayer, type CardDefinition, type CardInstance, type GameState,
} from 'commander-engine';
import { deriveSimpleState } from './useShelectorGame';

// Minimal engine state with one card in the human's exile zone.
function stateWithExiledCard(): { state: GameState; humanId: string } {
  const human = createPlayer('p1', 'You');
  const ai = createPlayer('p2', 'Rival');
  const def: CardDefinition = {
    id: 'd1', name: 'Banisher Priest', type_line: 'Creature — Human Cleric',
    oracle_text: '', mana_cost: '{1}{W}{W}', cmc: 3, colors: ['W'],
    color_identity: ['W'], keywords: [], card_types: ['creature'], power: 2, toughness: 2,
  } as CardDefinition;
  const inst: CardInstance = {
    instanceId: 'i1', definitionId: 'd1', ownerId: 'p1', zone: 'exile',
    tapped: false, summoningSick: false, counters: {}, damage: 0, isCommander: false,
  } as CardInstance;
  const state = {
    players: [human, ai], cards: new Map([['i1', inst]]),
    cardDefinitions: new Map([['d1', def]]),
    activePlayerIndex: 0, priorityPlayerIndex: 0,
    phase: 'precombat_main', step: 'precombat_main', turnNumber: 1,
    hasPriorityPassed: [false, false], stack: [], combat: null,
    battlefieldAbilities: new Map(), pendingTriggers: [],
  } as unknown as GameState;
  return { state, humanId: 'p1' };
}

describe('deriveSimpleState exile surfacing', () => {
  it('projects the human exile zone contents', () => {
    const { state, humanId } = stateWithExiledCard();
    const simple = deriveSimpleState(state, humanId, ['p2'], 'You', { p2: 'Rival' });
    expect(simple.humanExile.map(c => c.name)).toEqual(['Banisher Priest']);
    expect(simple.aiExiles.p2).toEqual([]);
    expect(simple.aiExile).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/useShelectorGame.exile.test.ts`
Expected: FAIL — `Property 'humanExile' does not exist` (TS) or runtime `undefined`.

- [ ] **Step 3: Add the fields to the interface**

In `SimpleGameState` (after `humanCommandZone: SimpleCard[];`) add:

```ts
  humanExile: SimpleCard[];
```

In the multiplayer record block (after `aiCommandZones: Record<string, SimpleCard[]>;`) add:

```ts
  aiExiles: Record<string, SimpleCard[]>;
```

In the backward-compatible single-AI alias block (after `aiCommandZone: SimpleCard[];`) add:

```ts
  aiExile: SimpleCard[];
```

- [ ] **Step 4: Populate them in `deriveSimpleState`**

Mirror the graveyard pattern. After `const humanCommandZone = mapCards(engine, 'command', humanId);` add:

```ts
  const humanExile = mapCards(engine, 'exile', humanId);
```

Add an `aiExiles` accumulator next to `aiGraveyards`/`aiCommandZones`:

```ts
  const aiExiles: Record<string, SimpleCard[]> = {};
```

Inside the `for (const aiId of aiIds)` loop, after `aiCommandZones[aiId] = mapCards(engine, 'command', aiId);` add:

```ts
    aiExiles[aiId] = mapCards(engine, 'exile', aiId);
```

In the returned object, add `humanExile,` near `humanCommandZone,`; add `aiExiles,` near `aiCommandZones,`; and add the alias near the other first-AI aliases:

```ts
    aiExile: aiExiles[firstAiId] || [],
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/hooks/useShelectorGame.exile.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck the rest of the app for the new required fields**

Run: `npm run build`
Expected: succeeds. If any test/mock that builds a `SimpleGameState` literal now errors on the missing fields, add `humanExile: [], aiExiles: {}, aiExile: []` to that literal (search `humanCommandZone:` in tests/fixtures to find them).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/useShelectorGame.ts frontend/src/hooks/useShelectorGame.exile.test.ts
git commit -m "feat(play): surface exile zone contents on SimpleGameState"
```

---

### Task 3: Expose zone contents on `GameView`

**Files:**
- Modify: `frontend/src/play/gameView.types.ts` (add `ZoneCardView`; extend `YouView` + `OpponentBoard`)
- Modify: `frontend/src/play/useGameView.ts` (`buildGameView`: map graveyard/exile contents)
- Test: `frontend/src/play/useGameView.zones.test.ts`

**Interfaces:**
- Consumes: `SimpleGameState.humanGraveyard/humanExile/aiGraveyards/aiExiles` (Task 2), the existing `legalActionsByObject` `legalFor(id)`.
- Produces: `YouView.graveyard: ZoneCardView[]`, `YouView.exile: ZoneCardView[]`, `OpponentBoard.graveyard: ZoneCardView[]`, `OpponentBoard.exile: ZoneCardView[]`. (Counts `graveyardCount`/`libraryCount`/`exileCount` stay.)

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/play/useGameView.zones.test.ts
import { describe, expect, it } from 'vitest';
import { buildGameView } from './useGameView';
import type { GameViewInput, SimpleGameState } from './gameView.types';

function baseState(): SimpleGameState {
  const player = {
    id: 'p1', name: 'You', life: 40, poisonCounters: 0, commanderDamage: {},
    playerCounters: {}, handCount: 0, libraryCount: 99,
  };
  const card = (id: string, name: string) => ({
    instanceId: id, name, manaCost: '', typeLine: 'Sorcery', oracleText: '',
    keywords: [], tapped: false, zone: 'graveyard' as const, ownerId: 'p1',
    cardTypes: ['sorcery'], isCommander: false, counters: {}, damage: 0, isToken: false,
  });
  return {
    turnNumber: 1, phase: 'precombat_main', step: 'precombat_main',
    activePlayerId: 'p1', priorityPlayerId: 'p1', humanPlayer: player, humanCommander: 'Cmd',
    humanHand: [], humanBattlefield: [], humanGraveyard: [card('g1', 'Cultivate')],
    humanCommandZone: [], humanExile: [card('x1', 'Path to Exile')],
    stack: [], gameOver: false, winnerId: null,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, diceRolls: [], lastDiceRoll: null,
    aiPlayers: [], aiHands: {}, aiBattlefields: {}, aiGraveyards: {}, aiCommandZones: {},
    aiExiles: {}, aiCommanderNames: {},
    aiPlayer: player, aiCommander: '', aiHand: [], aiBattlefield: [],
    aiGraveyard: [], aiCommandZone: [], aiExile: [],
  } as unknown as SimpleGameState;
}

describe('buildGameView zone contents', () => {
  it('maps your graveyard and exile contents to ZoneCardView lists', () => {
    const input: GameViewInput = {
      gameState: baseState(), legalActions: [], isHumanTurn: true, winner: null, guided: false,
    };
    const view = buildGameView(input);
    expect(view.you.graveyard.map(c => c.name)).toEqual(['Cultivate']);
    expect(view.you.exile.map(c => c.name)).toEqual(['Path to Exile']);
    expect(view.you.graveyardCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/useGameView.zones.test.ts`
Expected: FAIL — `view.you.graveyard` is `undefined`.

- [ ] **Step 3: Add `ZoneCardView` + extend the view types**

In `frontend/src/play/gameView.types.ts`, add after `HandCardView`:

```ts
export interface ZoneCardView {
  id: string;
  name: string;
  legalActions: LegalAction[];
}
```

Add to `OpponentBoard` (it already has `graveyardCount`, `exileCount`, `commandZone`):

```ts
  graveyard: ZoneCardView[];
  exile: ZoneCardView[];
```

Add to `YouView` (after `hand: HandCardView[];`):

```ts
  graveyard: ZoneCardView[];
  exile: ZoneCardView[];
```

- [ ] **Step 4: Map the contents in `buildGameView`**

In `frontend/src/play/useGameView.ts`, add a helper near `toPermanentView`:

```ts
function toZoneCardView(card: SimpleCard, legalFor: (id: string) => LegalAction[]): ZoneCardView {
  return { id: card.instanceId, name: card.name, legalActions: legalFor(card.instanceId) };
}
```

Import `ZoneCardView` in the type import block. In the `you` object add:

```ts
    graveyard: gameState.humanGraveyard.map(c => toZoneCardView(c, legalFor)),
    exile: gameState.humanExile.map(c => toZoneCardView(c, legalFor)),
```

In the opponents `.map(...)` return object add (opponents afford you no zone actions):

```ts
      graveyard: (gameState.aiGraveyards[player.id] ?? []).map(c => ({ id: c.instanceId, name: c.name, legalActions: [] })),
      exile: (gameState.aiExiles[player.id] ?? []).map(c => ({ id: c.instanceId, name: c.name, legalActions: [] })),
```

Also fix the now-real exile count: replace `exileCount: 0,` with `exileCount: (gameState.aiExiles[player.id] ?? []).length,`.

Update `EMPTY_VIEW.you` to include `graveyard: [], exile: [],`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/play/useGameView.zones.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: succeeds (any fixture building `YouView`/`OpponentBoard` literals gets `graveyard: [], exile: []` added).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/play/gameView.types.ts frontend/src/play/useGameView.ts frontend/src/play/useGameView.zones.test.ts
git commit -m "feat(play): expose graveyard/exile zone contents on GameView"
```

---

### Task 4: `CardView` type + adapters

**Files:**
- Modify: `frontend/src/play/gameView.types.ts` (add `CardZone`, `CardView` — see Global Constraints for the exact shape)
- Create: `frontend/src/play/v2/cardView.ts` (adapter builders)
- Test: `frontend/src/play/v2/cardView.test.ts`

**Interfaces:**
- Consumes: `PermanentView`, `HandCardView`, `StackItemView`, `ZoneCardView` from `gameView.types`.
- Produces: `cardViewFromPermanent(p, zone)`, `cardViewFromHand(h)`, `cardViewFromZone(z, zone)`, `cardViewFromStack(s)` — all `=> CardView`. Used by the card viewer (Task 12) and every component that opens it.

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/play/v2/cardView.test.ts
import { describe, expect, it } from 'vitest';
import { cardViewFromPermanent, cardViewFromZone } from './cardView';
import type { PermanentView, ZoneCardView } from '../gameView.types';

describe('cardView adapters', () => {
  it('builds a CardView from a battlefield permanent with live state + status chips', () => {
    const perm: PermanentView = {
      id: 'i1', name: 'Avenger of Zendikar', tapped: false, power: 5, toughness: 5,
      counters: { '+1/+1': 2 }, isLand: false, isCreature: true, isAttacking: true, legalActions: [],
    };
    const cv = cardViewFromPermanent(perm, 'battlefield');
    expect(cv).toMatchObject({ id: 'i1', name: 'Avenger of Zendikar', zone: 'battlefield', power: 5, isAttacking: true });
    expect(cv.statuses).toContain('Attacking');
  });
  it('builds a CardView from a graveyard ZoneCardView', () => {
    const z: ZoneCardView = { id: 'g1', name: 'Eternal Witness', legalActions: [] };
    const cv = cardViewFromZone(z, 'graveyard');
    expect(cv).toMatchObject({ id: 'g1', name: 'Eternal Witness', zone: 'graveyard' });
    expect(cv.statuses).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/cardView.test.ts`
Expected: FAIL — `Cannot find module './cardView'`.

- [ ] **Step 3: Add `CardZone` + `CardView`**

Add to `frontend/src/play/gameView.types.ts` the `CardZone` and `CardView` definitions exactly as in Global Constraints.

- [ ] **Step 4: Write the adapters**

```ts
// frontend/src/play/v2/cardView.ts
import type {
  CardView, CardZone, PermanentView, HandCardView, ZoneCardView, StackItemView,
} from '../gameView.types';

function permStatuses(p: PermanentView): string[] {
  const s: string[] = [];
  if (p.tapped) s.push('Tapped');
  if (p.isAttacking) s.push('Attacking');
  if (p.isBlocking) s.push('Blocking');
  for (const [k, n] of Object.entries(p.counters ?? {})) if (n) s.push(`${n}× ${k}`);
  return s;
}

export function cardViewFromPermanent(p: PermanentView, zone: CardZone): CardView {
  return {
    id: p.id, name: p.name, zone, power: p.power, toughness: p.toughness,
    counters: p.counters, tapped: p.tapped, isAttacking: p.isAttacking, isBlocking: p.isBlocking,
    statuses: permStatuses(p), legalActions: p.legalActions,
  };
}

export function cardViewFromHand(h: HandCardView): CardView {
  return { id: h.id, name: h.name, zone: 'hand', statuses: [], legalActions: h.legalActions };
}

export function cardViewFromZone(z: ZoneCardView, zone: CardZone): CardView {
  return { id: z.id, name: z.name, zone, statuses: [], legalActions: z.legalActions };
}

export function cardViewFromStack(s: StackItemView): CardView {
  return { id: s.id, name: s.title, zone: 'stack', statuses: [s.description].filter(Boolean), legalActions: [] };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/play/v2/cardView.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/play/gameView.types.ts frontend/src/play/v2/cardView.ts frontend/src/play/v2/cardView.test.ts
git commit -m "feat(play-v2): add CardView type + zone adapters"
```

---

### Task 5: v2 primitives

**Files:**
- Create: `frontend/src/play/v2/primitives/Panel.tsx`, `CardFace.tsx`, `Pip.tsx`, `Badge.tsx`, `BrassButton.tsx`, `ZoneCounter.tsx`, `ModalShell.tsx`, `index.ts`
- Test: `frontend/src/play/v2/primitives/primitives.test.tsx`

**Interfaces:**
- Produces:
  - `Panel({ className?, children })` — leather surface (`bg-table-leather border border-table-border rounded-xl`).
  - `CardFace({ cardName, className?, size?, onClick?, children? })` — aged-stock card frame wrapping `<CardImage>`; `children` overlay (badges).
  - `Pip({ color, filled?, size? })` — mana/counter dot; `color: 'W'|'U'|'B'|'R'|'G'|'C'`.
  - `Badge({ children, tone? })` — `tone: 'pt'|'count'|'brass'` small label.
  - `BrassButton({ children, onClick, tone?, disabled? })` — `tone: 'primary'|'neutral'|'danger'`.
  - `ZoneCounter({ icon, label, count, onClick? })` — clickable zone chip.
  - `ModalShell({ title, onClose, children, side? })` — **board-anchored** (`absolute inset-0`) dim backdrop + centered leather panel; `Escape`/backdrop closes. Never `position: fixed`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/primitives/primitives.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BrassButton, ModalShell, ZoneCounter } from './index';

describe('v2 primitives', () => {
  it('BrassButton fires onClick and respects disabled', () => {
    const onClick = vi.fn();
    const { rerender } = render(<BrassButton onClick={onClick}>Pass</BrassButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<BrassButton onClick={onClick} disabled>Pass</BrassButton>);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('ZoneCounter shows label + count and is clickable', () => {
    const onClick = vi.fn();
    render(<ZoneCounter icon="grave" label="Graveyard" count={7} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /graveyard 7/i }));
    expect(onClick).toHaveBeenCalled();
  });

  it('ModalShell closes on backdrop click and is not position:fixed', () => {
    const onClose = vi.fn();
    const { container } = render(<ModalShell title="Graveyard" onClose={onClose}>body</ModalShell>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('absolute');
    expect(root.className).not.toContain('fixed');
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/primitives/primitives.test.tsx`
Expected: FAIL — `Cannot find module './index'`.

- [ ] **Step 3: Implement the primitives**

```tsx
// frontend/src/play/v2/primitives/Panel.tsx
import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-xl border border-table-border bg-table-leather', className)}>{children}</div>;
}
```

```tsx
// frontend/src/play/v2/primitives/Pip.tsx
import { manaHex } from '../theme';
export function Pip({ color, size = 14 }: { color: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: manaHex(color) }}
      className="inline-block rounded-full border border-black/30"
    />
  );
}
```

```tsx
// frontend/src/play/v2/primitives/Badge.tsx
import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
const TONE = {
  pt: 'bg-card-stock text-card-ink border-card-badge',
  count: 'bg-table-leather2 text-gold-bright border-table-border',
  brass: 'bg-brass text-brass-on border-brass-deep',
} as const;
export function Badge({ children, tone = 'count' }: { children: ReactNode; tone?: keyof typeof TONE }) {
  return <span className={cn('rounded border px-1.5 text-[11px] font-bold leading-tight', TONE[tone])}>{children}</span>;
}
```

```tsx
// frontend/src/play/v2/primitives/BrassButton.tsx
import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
const TONE = {
  primary: 'bg-brass border-brass-deep text-brass-on',
  neutral: 'bg-table-leather border-table-border text-gold-bright',
  danger: 'bg-oxblood border-oxblood text-[#f2d2c6]',
} as const;
export function BrassButton({
  children, onClick, tone = 'neutral', disabled,
}: { children: ReactNode; onClick(): void; tone?: keyof typeof TONE; disabled?: boolean }) {
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      className={cn('rounded-lg border px-3 py-2 font-display text-sm font-bold disabled:opacity-50', TONE[tone])}
    >
      {children}
    </button>
  );
}
```

```tsx
// frontend/src/play/v2/primitives/ZoneCounter.tsx
import { cn } from '../../../lib/utils';
const ICON = { grave: 'ti-skull', exile: 'ti-flame', library: 'ti-stack-2', command: 'ti-crown' } as const;
export function ZoneCounter({
  icon, label, count, onClick,
}: { icon: keyof typeof ICON; label: string; count: number; onClick?(): void }) {
  return (
    <button
      type="button" onClick={onClick} aria-label={`${label} ${count}`}
      className={cn('flex items-center gap-1 rounded-md border border-table-border bg-table-leather2 px-2 py-1 text-gold-muted',
        onClick ? 'hover:text-gold-bright' : 'cursor-default')}
    >
      <i className={cn('ti', `ti-${ICON[icon].replace('ti-', '')}`)} aria-hidden />
      <span className="text-[11px]">{label}</span>
      <span className="text-[12px] font-bold text-gold-bright">{count}</span>
    </button>
  );
}
```

> Note: the project does not bundle a `ti` (Tabler) webfont by default. If `<i class="ti …">` renders blank in the app, swap the icon for a `lucide-react` icon (already a dependency) — e.g. `import { Skull, Flame, Layers, Crown } from 'lucide-react'`. Keep the same prop API.

```tsx
// frontend/src/play/v2/primitives/CardFace.tsx
import type { ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { CardImage } from '../../../components/CardImage';
export function CardFace({
  cardName, className, size = 'small', onClick, children,
}: { cardName: string; className?: string; size?: 'normal' | 'small'; onClick?(): void; children?: ReactNode }) {
  return (
    <div
      onClick={onClick}
      className={cn('relative overflow-hidden rounded-lg border border-card-border bg-card-stock', onClick && 'cursor-pointer', className)}
    >
      <CardImage cardName={cardName} size={size} showHoverZoom={false} className="h-full w-full object-cover" />
      {children}
    </div>
  );
}
```

```tsx
// frontend/src/play/v2/primitives/ModalShell.tsx
import { useEffect, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';
export function ModalShell({
  title, onClose, children, side,
}: { title: string; onClose(): void; children: ReactNode; side?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-3">
      <div data-testid="modal-backdrop" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className={cn('relative max-h-full w-full max-w-3xl overflow-hidden rounded-xl border border-table-border-hi bg-table-leather2 p-4')}>
        <div className="mb-3 flex items-center gap-3">
          <h2 className="font-display text-2xl font-bold text-gold-bright">{title}</h2>
          {side}
          <button type="button" aria-label="Close" onClick={onClose}
            className="ml-auto rounded-md border border-table-border px-2 py-1 text-gold-bright">✕</button>
        </div>
        <div className="max-h-[70svh] overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  );
}
```

```ts
// frontend/src/play/v2/primitives/index.ts
export { Panel } from './Panel';
export { CardFace } from './CardFace';
export { Pip } from './Pip';
export { Badge } from './Badge';
export { BrassButton } from './BrassButton';
export { ZoneCounter } from './ZoneCounter';
export { ModalShell } from './ModalShell';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/primitives/primitives.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/primitives
git commit -m "feat(play-v2): add themed primitives (Panel, CardFace, Pip, Badge, BrassButton, ZoneCounter, ModalShell)"
```

---

### Task 6: `PermanentTileV2`

**Files:**
- Create: `frontend/src/play/v2/components/PermanentTileV2.tsx`
- Test: `frontend/src/play/v2/components/PermanentTileV2.test.tsx`

**Interfaces:**
- Consumes: `PermanentView`, `LegalAction`, `cardViewFromPermanent` (Task 4), `CardFace`/`Badge` (Task 5).
- Produces: `PermanentTileV2({ permanent, zone?, onAction, onView })`. `zone?: CardZone` (default `'battlefield'`). `onView(cv: CardView)` opens the card viewer; `onAction(a: LegalAction)` commits.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/PermanentTileV2.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PermanentTileV2 } from './PermanentTileV2';
import type { PermanentView } from '../../gameView.types';

const tile: PermanentView = {
  id: 'i1', name: 'Avenger of Zendikar', tapped: false, power: 5, toughness: 5,
  isLand: false, isCreature: true, isAttacking: true, legalActions: [], counters: { '+1/+1': 1 },
};

describe('PermanentTileV2', () => {
  it('renders P/T and opens the viewer on examine', () => {
    const onView = vi.fn();
    render(<PermanentTileV2 permanent={tile} onAction={() => {}} onView={onView} />);
    expect(screen.getByText('5/5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /examine avenger/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1', zone: 'battlefield' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/PermanentTileV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/components/PermanentTileV2.tsx
import { cn } from '../../../lib/utils';
import { CardFace, Badge } from '../primitives';
import { cardViewFromPermanent } from '../cardView';
import type { CardView, CardZone, LegalAction, PermanentView } from '../../gameView.types';

export function PermanentTileV2({
  permanent, zone = 'battlefield', onAction, onView,
}: {
  permanent: PermanentView; zone?: CardZone;
  onAction(a: LegalAction): void; onView(cv: CardView): void;
}) {
  const primary = permanent.legalActions[0];
  return (
    <div className={cn('relative h-[82px] w-[60px] animate-tile-in', permanent.tapped && 'rotate-[10deg] opacity-70',
      permanent.isAttacking && 'outline outline-2 outline-offset-1 outline-ring-combat')}>
      <CardFace cardName={permanent.name} onClick={() => (primary ? onAction(primary) : onView(cardViewFromPermanent(permanent, zone)))}>
        {permanent.stackCount && permanent.stackCount > 1 ? (
          <span className="absolute left-1 top-1"><Badge tone="count">×{permanent.stackCount}</Badge></span>
        ) : null}
        {permanent.isCreature && permanent.power != null ? (
          <span className="absolute bottom-1 right-1"><Badge tone="pt">{permanent.power}/{permanent.toughness}</Badge></span>
        ) : null}
      </CardFace>
      <button
        type="button" aria-label={`Examine ${permanent.name}`}
        onClick={() => onView(cardViewFromPermanent(permanent, zone))}
        className="absolute right-0.5 top-0.5 rounded bg-black/50 px-1 text-[10px] text-gold-bright"
      >i</button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/PermanentTileV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/components/PermanentTileV2.tsx frontend/src/play/v2/components/PermanentTileV2.test.tsx
git commit -m "feat(play-v2): PermanentTileV2"
```

---

### Task 7: `YouHudV2` + `PlayerBoardV2`

**Files:**
- Create: `frontend/src/play/v2/components/YouHudV2.tsx`, `frontend/src/play/v2/components/PlayerBoardV2.tsx`
- Test: `frontend/src/play/v2/components/PlayerBoardV2.test.tsx`

**Interfaces:**
- Consumes: `YouView`, `PermanentTileV2` (Task 6), `Panel`/`Pip`/`ZoneCounter`/`Badge` (Task 5), `cardViewFromPermanent`.
- Produces:
  - `YouHudV2({ you, onOpenZone })` — life (ember, display font), hand/library counts, mana pips, and `ZoneCounter`s for Graveyard/Exile/Library/Command. `onOpenZone(zone: 'graveyard'|'exile'|'command'|'library')`.
  - `PlayerBoardV2({ you, onAction, onView, onOpenZone })` — buckets (creatures / artifacts+enchantments / lands grouped / other) as rows of `PermanentTileV2`, with `YouHudV2` on top.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/PlayerBoardV2.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlayerBoardV2 } from './PlayerBoardV2';
import type { YouView } from '../../gameView.types';

const you: YouView = {
  life: 38, poison: 0, maxCommanderDamageTaken: 0,
  manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  commandZone: [], graveyardCount: 7, libraryCount: 71, handCount: 5,
  creatures: [{ id: 'c1', name: 'Llanowar Elves', tapped: false, power: 1, toughness: 1, isLand: false, isCreature: true, legalActions: [] }],
  artifacts: [], enchantments: [], lands: [], other: [], hand: [],
  graveyard: [], exile: [],
};

describe('PlayerBoardV2', () => {
  it('shows your life and opens a zone from the HUD', () => {
    const onOpenZone = vi.fn();
    render(<PlayerBoardV2 you={you} onAction={() => {}} onView={() => {}} onOpenZone={onOpenZone} />);
    expect(screen.getByText('38')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /graveyard 7/i }));
    expect(onOpenZone).toHaveBeenCalledWith('graveyard');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/PlayerBoardV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `YouHudV2`**

```tsx
// frontend/src/play/v2/components/YouHudV2.tsx
import { Panel, Pip, ZoneCounter } from '../primitives';
import type { YouView } from '../../gameView.types';

export type ZoneKey = 'graveyard' | 'exile' | 'command' | 'library';

export function YouHudV2({ you, onOpenZone }: { you: YouView; onOpenZone(zone: ZoneKey): void }) {
  return (
    <Panel className="flex items-center gap-3 px-3 py-2">
      <span className="font-display text-3xl font-bold text-ember">{you.life}</span>
      <span className="text-[11px] text-gold-muted">Hand {you.handCount} · Library {you.libraryCount}</span>
      <span className="flex gap-1">
        {(['W', 'U', 'B', 'R', 'G', 'C'] as const).filter(c => you.manaPool[c] > 0).map(c => <Pip key={c} color={c} />)}
      </span>
      <span className="ml-auto flex gap-1.5">
        <ZoneCounter icon="grave" label="Graveyard" count={you.graveyardCount} onClick={() => onOpenZone('graveyard')} />
        <ZoneCounter icon="exile" label="Exile" count={you.exile.length} onClick={() => onOpenZone('exile')} />
        <ZoneCounter icon="command" label="Command" count={you.commandZone.length} onClick={() => onOpenZone('command')} />
        <ZoneCounter icon="library" label="Library" count={you.libraryCount} />
      </span>
    </Panel>
  );
}
```

- [ ] **Step 4: Implement `PlayerBoardV2`**

```tsx
// frontend/src/play/v2/components/PlayerBoardV2.tsx
import { PermanentTileV2 } from './PermanentTileV2';
import { YouHudV2, type ZoneKey } from './YouHudV2';
import type { CardView, LegalAction, PermanentView, YouView } from '../../gameView.types';

function Row({ items, onAction, onView }: { items: PermanentView[]; onAction(a: LegalAction): void; onView(cv: CardView): void }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(p => <PermanentTileV2 key={p.id} permanent={p} onAction={onAction} onView={onView} />)}
    </div>
  );
}

export function PlayerBoardV2({
  you, onAction, onView, onOpenZone,
}: { you: YouView; onAction(a: LegalAction): void; onView(cv: CardView): void; onOpenZone(zone: ZoneKey): void }) {
  return (
    <div className="flex h-full flex-col gap-2">
      <YouHudV2 you={you} onOpenZone={onOpenZone} />
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden">
        <Row items={you.creatures} onAction={onAction} onView={onView} />
        <Row items={[...you.artifacts, ...you.enchantments, ...you.other]} onAction={onAction} onView={onView} />
        <Row items={you.lands} onAction={onAction} onView={onView} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/PlayerBoardV2.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/play/v2/components/YouHudV2.tsx frontend/src/play/v2/components/PlayerBoardV2.tsx frontend/src/play/v2/components/PlayerBoardV2.test.tsx
git commit -m "feat(play-v2): YouHudV2 + PlayerBoardV2 with zone counters"
```

---

### Task 8: `OpponentRailV2`

**Files:**
- Create: `frontend/src/play/v2/components/OpponentChipV2.tsx`, `frontend/src/play/v2/components/OpponentRailV2.tsx`
- Test: `frontend/src/play/v2/components/OpponentRailV2.test.tsx`

**Interfaces:**
- Consumes: `OpponentBoard`, `OpponentGlance`, `Panel`/`Badge`.
- Produces: `OpponentRailV2({ opponents, onExplore })` — a horizontal row of `OpponentChipV2`; clicking a chip calls `onExplore(playerId)` to open that opponent in the zone explorer (Task 13). `OpponentChipV2({ board, onExplore })` shows initial avatar, name, commander, life (ember), creature count, and any flags.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/OpponentRailV2.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OpponentRailV2 } from './OpponentRailV2';
import type { OpponentBoard } from '../../gameView.types';

const opp: OpponentBoard = {
  glance: {
    playerId: 'p2', name: 'Nezuko', life: 33, commanderDamageToYou: 0, handCount: 4,
    openMana: 2, creatureCount: 3, totalPower: 9, flags: [],
  },
  creatures: [], lands: [], other: [], graveyardCount: 5, exileCount: 0, commandZone: [],
  graveyard: [], exile: [],
};

describe('OpponentRailV2', () => {
  it('renders an opponent chip and explores on click', () => {
    const onExplore = vi.fn();
    render(<OpponentRailV2 opponents={[opp]} onExplore={onExplore} />);
    expect(screen.getByText('Nezuko')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /explore nezuko/i }));
    expect(onExplore).toHaveBeenCalledWith('p2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/OpponentRailV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/components/OpponentChipV2.tsx
import { Panel } from '../primitives';
import type { OpponentBoard } from '../../gameView.types';

export function OpponentChipV2({ board, onExplore }: { board: OpponentBoard; onExplore(id: string): void }) {
  const g = board.glance;
  return (
    <button type="button" aria-label={`Explore ${g.name}`} onClick={() => onExplore(g.playerId)} className="w-full text-left">
      <Panel className="flex items-center gap-2 px-2 py-1.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-table-frame font-display text-sm text-gold-bright">
          {g.name.charAt(0)}
        </span>
        <span className="min-w-0">
          <span className="block truncate font-display text-[15px] font-bold text-gold-bright">{g.name}</span>
          <span className="block truncate text-[11px] text-gold-muted">{g.creatureCount} creatures{g.contextNote ? ` · ${g.contextNote}` : ''}</span>
        </span>
        <span className="ml-auto font-bold text-ember">♥ {g.life}</span>
      </Panel>
    </button>
  );
}
```

```tsx
// frontend/src/play/v2/components/OpponentRailV2.tsx
import { OpponentChipV2 } from './OpponentChipV2';
import type { OpponentBoard } from '../../gameView.types';

export function OpponentRailV2({ opponents, onExplore }: { opponents: OpponentBoard[]; onExplore(id: string): void }) {
  return (
    <div className="flex gap-2 overflow-x-auto overscroll-contain">
      {opponents.map(o => (
        <div key={o.glance.playerId} className="w-[clamp(11rem,16vw,15rem)] shrink-0">
          <OpponentChipV2 board={o} onExplore={onExplore} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/OpponentRailV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/components/OpponentChipV2.tsx frontend/src/play/v2/components/OpponentRailV2.tsx frontend/src/play/v2/components/OpponentRailV2.test.tsx
git commit -m "feat(play-v2): OpponentRailV2 + OpponentChipV2"
```

---

### Task 9: `HandViewV2`

**Files:**
- Create: `frontend/src/play/v2/components/HandViewV2.tsx`
- Test: `frontend/src/play/v2/components/HandViewV2.test.tsx`

**Interfaces:**
- Consumes: `HandCardView`, `CardFace`, `cardViewFromHand`.
- Produces: `HandViewV2({ hand, onAction, onView })` — a fanned row of `CardFace`s; clicking a card with a primary legal action commits it, else opens the viewer; an explicit examine affordance always opens the viewer.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/HandViewV2.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HandViewV2 } from './HandViewV2';
import type { HandCardView } from '../../gameView.types';

const hand: HandCardView[] = [{ id: 'h1', name: 'Cultivate', manaCost: '{2}{G}', legalActions: [] }];

describe('HandViewV2', () => {
  it('opens the viewer when a card has no primary action', () => {
    const onView = vi.fn();
    render(<HandViewV2 hand={hand} onAction={() => {}} onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: /cultivate/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 'h1', zone: 'hand' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/HandViewV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/components/HandViewV2.tsx
import { CardFace } from '../primitives';
import { cardViewFromHand } from '../cardView';
import type { CardView, HandCardView, LegalAction } from '../../gameView.types';

export function HandViewV2({
  hand, onAction, onView,
}: { hand: HandCardView[]; onAction(a: LegalAction): void; onView(cv: CardView): void }) {
  const mid = (hand.length - 1) / 2;
  return (
    <div className="flex h-full items-end justify-center">
      {hand.map((c, i) => {
        const primary = c.legalActions[0];
        return (
          <button
            key={c.id} type="button" aria-label={c.name}
            onClick={() => (primary ? onAction(primary) : onView(cardViewFromHand(c)))}
            style={{ transform: `rotate(${(i - mid) * 5}deg) translateY(${Math.abs(i - mid) * 4}px)`, marginLeft: i === 0 ? 0 : -14 }}
            className="origin-bottom"
          >
            <CardFace cardName={c.name} className="h-[88px] w-[62px]" />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/HandViewV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/components/HandViewV2.tsx frontend/src/play/v2/components/HandViewV2.test.tsx
git commit -m "feat(play-v2): HandViewV2"
```

---

### Task 10: `PhaseTrackV2` + `StackViewV2` + `PriorityControlsV2`

**Files:**
- Create: `frontend/src/play/v2/components/PhaseTrackV2.tsx`, `StackViewV2.tsx`, `PriorityControlsV2.tsx`
- Test: `frontend/src/play/v2/components/priorityCluster.test.tsx`

**Interfaces:**
- Consumes: `PriorityContext`, `StackItemView`, `Panel`/`BrassButton`, `cardViewFromStack`.
- Produces:
  - `PhaseTrackV2({ priority })` — turn ownership label + 5 phase pips (Beginning/Main 1/Combat/Main 2/End) with `priority.phaseLabel` matched to highlight the active one.
  - `StackViewV2({ stack, onView })` — top-down list of stack items; clicking one opens the viewer.
  - `PriorityControlsV2({ priority, alwaysStop, onPass, onHold, onToggleAlwaysStop })` — Pass (primary), Hold, Always-stop toggle; disabled states from `priority.canPass`/`canHold`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/priorityCluster.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PriorityControlsV2 } from './PriorityControlsV2';
import { StackViewV2 } from './StackViewV2';
import type { PriorityContext, StackItemView } from '../../gameView.types';

const priority: PriorityContext = {
  hasPriority: true, isYourTurn: true, phaseLabel: 'Combat',
  hasMeaningfulResponse: true, canPass: true, canHold: true,
};

describe('priority cluster', () => {
  it('Pass fires onPass', () => {
    const onPass = vi.fn();
    render(<PriorityControlsV2 priority={priority} alwaysStop={false} onPass={onPass} onHold={() => {}} onToggleAlwaysStop={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pass' }));
    expect(onPass).toHaveBeenCalled();
  });
  it('stack item opens the viewer', () => {
    const onView = vi.fn();
    const stack: StackItemView[] = [{ id: 's1', controllerName: 'You', title: 'Cultivate', description: 'Search for two basics', resolvesNext: true }];
    render(<StackViewV2 stack={stack} onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: /cultivate/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 's1', zone: 'stack' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/priorityCluster.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three components**

```tsx
// frontend/src/play/v2/components/PhaseTrackV2.tsx
import { Panel } from '../primitives';
import { cn } from '../../../lib/utils';
import type { PriorityContext } from '../../gameView.types';
const PHASES = ['Beginning', 'Main 1', 'Combat', 'Main 2', 'End'];
export function PhaseTrackV2({ priority }: { priority: PriorityContext }) {
  return (
    <Panel className="flex items-center gap-2 px-3 py-2">
      <span className="font-display text-[15px] font-bold text-gold-bright">{priority.isYourTurn ? 'Your turn' : 'Their turn'}</span>
      <span className="flex gap-1">
        {PHASES.map(p => (
          <span key={p} className={cn('rounded-full border px-2 py-0.5 text-[11px]',
            priority.phaseLabel.toLowerCase().startsWith(p.toLowerCase().slice(0, 4))
              ? 'border-brass-deep bg-brass text-brass-on font-semibold'
              : 'border-table-border text-gold-muted')}>{p}</span>
        ))}
      </span>
    </Panel>
  );
}
```

```tsx
// frontend/src/play/v2/components/StackViewV2.tsx
import { Panel } from '../primitives';
import { cn } from '../../../lib/utils';
import { cardViewFromStack } from '../cardView';
import type { CardView, StackItemView } from '../../gameView.types';
export function StackViewV2({ stack, onView }: { stack: StackItemView[]; onView(cv: CardView): void }) {
  if (stack.length === 0) return null;
  return (
    <Panel className="flex flex-col gap-1 p-2">
      {stack.map(s => (
        <button key={s.id} type="button" aria-label={s.title} onClick={() => onView(cardViewFromStack(s))}
          className={cn('rounded-md border px-2 py-1 text-left', s.resolvesNext ? 'border-brass-deep bg-table-leather2' : 'border-table-border')}>
          <span className="block font-display text-[14px] font-bold text-gold-bright">{s.title}</span>
          <span className="block text-[11px] text-gold-muted">{s.controllerName} · {s.description}</span>
        </button>
      ))}
    </Panel>
  );
}
```

```tsx
// frontend/src/play/v2/components/PriorityControlsV2.tsx
import { BrassButton } from '../primitives';
import { cn } from '../../../lib/utils';
import type { PriorityContext } from '../../gameView.types';
export function PriorityControlsV2({
  priority, alwaysStop, onPass, onHold, onToggleAlwaysStop,
}: {
  priority: PriorityContext; alwaysStop: boolean;
  onPass(): void; onHold(): void; onToggleAlwaysStop(): void;
}) {
  return (
    <div className="flex items-center gap-2">
      <BrassButton tone="primary" onClick={onPass} disabled={!priority.canPass}>Pass</BrassButton>
      <BrassButton tone="neutral" onClick={onHold} disabled={!priority.canHold}>Hold</BrassButton>
      <button type="button" onClick={onToggleAlwaysStop}
        className={cn('rounded-md border px-2 py-1 text-[11px]', alwaysStop ? 'border-brass-deep bg-brass text-brass-on' : 'border-table-border text-gold-muted')}>
        Always stop
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/priorityCluster.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/components/PhaseTrackV2.tsx frontend/src/play/v2/components/StackViewV2.tsx frontend/src/play/v2/components/PriorityControlsV2.tsx frontend/src/play/v2/components/priorityCluster.test.tsx
git commit -m "feat(play-v2): phase track + stack + priority controls"
```

---

### Task 11: `NarrationFeedV2`

**Files:**
- Create: `frontend/src/play/v2/components/NarrationFeedV2.tsx`
- Test: `frontend/src/play/v2/components/NarrationFeedV2.test.tsx`

**Interfaces:**
- Consumes: `NarrationEntry`, `Panel`.
- Produces: `NarrationFeedV2({ narration })` — a capped, internally-scrolling log; newest last; entry color keyed by `kind`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/NarrationFeedV2.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NarrationFeedV2 } from './NarrationFeedV2';
import type { NarrationEntry } from '../../gameView.types';

describe('NarrationFeedV2', () => {
  it('renders log entries', () => {
    const entries: NarrationEntry[] = [{ id: 'n1', kind: 'resolve', text: 'Cultivate resolves' }];
    render(<NarrationFeedV2 narration={entries} />);
    expect(screen.getByText('Cultivate resolves')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/NarrationFeedV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/components/NarrationFeedV2.tsx
import { Panel } from '../primitives';
import { cn } from '../../../lib/utils';
import type { NarrationEntry } from '../../gameView.types';
const TONE = { trigger: 'text-gold-label', resolve: 'text-gold-bright', phase: 'text-gold-muted', action: 'text-gold-bright' };
export function NarrationFeedV2({ narration }: { narration: NarrationEntry[] }) {
  return (
    <Panel className="flex h-full min-h-0 flex-col p-2">
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain text-[12px]">
        {narration.map(e => <div key={e.id} className={cn('leading-snug', TONE[e.kind])}>{e.text}</div>)}
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/NarrationFeedV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/components/NarrationFeedV2.tsx frontend/src/play/v2/components/NarrationFeedV2.test.tsx
git commit -m "feat(play-v2): NarrationFeedV2"
```

---

### Task 12: `CardViewerV2` (universal floating viewer)

**Files:**
- Create: `frontend/src/play/v2/components/CardViewerV2.tsx`
- Test: `frontend/src/play/v2/components/CardViewerV2.test.tsx`

**Interfaces:**
- Consumes: `CardView`, `LegalAction`, `ModalShell`/`CardFace`/`Badge`, `<CardImage>`.
- Produces: `CardViewerV2({ card, onClose, onAction })` — board-anchored modal showing the large card image (by name), live-state chips (`card.statuses`), counters, and any `legalActions` as `BrassButton`s. `card: CardView | null` (null renders nothing).

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/CardViewerV2.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CardViewerV2 } from './CardViewerV2';
import type { CardView } from '../../gameView.types';

const card: CardView = {
  id: 'i1', name: 'Eternal Witness', zone: 'graveyard', power: 2, toughness: 1,
  statuses: ['In graveyard'], legalActions: [],
};

describe('CardViewerV2', () => {
  it('renders nothing when card is null', () => {
    const { container } = render(<CardViewerV2 card={null} onClose={() => {}} onAction={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
  it('shows the card name + status and closes', () => {
    const onClose = vi.fn();
    render(<CardViewerV2 card={card} onClose={onClose} onAction={() => {}} />);
    expect(screen.getAllByText('Eternal Witness').length).toBeGreaterThan(0);
    expect(screen.getByText('In graveyard')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/CardViewerV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/components/CardViewerV2.tsx
import { ModalShell, Badge, BrassButton } from '../primitives';
import { CardImage } from '../../../components/CardImage';
import type { CardView, LegalAction } from '../../gameView.types';

export function CardViewerV2({
  card, onClose, onAction,
}: { card: CardView | null; onClose(): void; onAction(a: LegalAction): void }) {
  if (!card) return null;
  return (
    <ModalShell title={card.name} onClose={onClose}>
      <div className="flex gap-4">
        <div className="w-[230px] shrink-0 overflow-hidden rounded-lg border border-card-border">
          <CardImage cardName={card.name} size="normal" showHoverZoom={false} className="w-full" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {card.power != null ? <span className="font-display text-2xl text-gold-bright">{card.power} / {card.toughness}</span> : null}
          <div className="flex flex-wrap gap-1">
            {card.statuses.map(s => <Badge key={s} tone="count">{s}</Badge>)}
          </div>
          <div className="mt-auto flex flex-wrap gap-2">
            {card.legalActions.map((a, i) => <BrassButton key={i} tone="primary" onClick={() => onAction(a)}>{a.label}</BrassButton>)}
          </div>
        </div>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/CardViewerV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/components/CardViewerV2.tsx frontend/src/play/v2/components/CardViewerV2.test.tsx
git commit -m "feat(play-v2): universal CardViewerV2"
```

---

### Task 13: `ZoneExplorerV2`

**Files:**
- Create: `frontend/src/play/v2/components/ZoneExplorerV2.tsx`
- Test: `frontend/src/play/v2/components/ZoneExplorerV2.test.tsx`

**Interfaces:**
- Consumes: `GameView`, `ZoneCardView`, `PermanentView`, `ModalShell`/`CardFace`, `cardViewFromZone`/`cardViewFromPermanent`.
- Produces: `ZoneExplorerV2({ view, target, onClose, onView })` where `target: { playerId: string; zone: ZoneKey }`. Resolves the player (you or an opponent) + zone, renders the contents as a grid of `CardFace` thumbnails with tabs to switch zone; selecting a thumbnail calls `onView(CardView)`. `ZoneKey = 'graveyard' | 'exile' | 'command' | 'library'`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/ZoneExplorerV2.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ZoneExplorerV2 } from './ZoneExplorerV2';
import type { GameView } from '../../gameView.types';

function viewWithGraveyard(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0,
      manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }, commandZone: [],
      graveyardCount: 1, libraryCount: 99, handCount: 0,
      creatures: [], artifacts: [], enchantments: [], lands: [], other: [], hand: [],
      graveyard: [{ id: 'g1', name: 'Eternal Witness', legalActions: [] }], exile: [],
    },
    opponents: [], stack: [],
    priority: { hasPriority: false, isYourTurn: true, phaseLabel: '', hasMeaningfulResponse: false, canPass: false, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}

describe('ZoneExplorerV2', () => {
  it('lists your graveyard and opens a card in the viewer', () => {
    const onView = vi.fn();
    render(<ZoneExplorerV2 view={viewWithGraveyard()} target={{ playerId: 'you', zone: 'graveyard' }} onClose={() => {}} onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: /eternal witness/i }));
    expect(onView).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1', zone: 'graveyard' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/ZoneExplorerV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/components/ZoneExplorerV2.tsx
import { useState } from 'react';
import { ModalShell, CardFace } from '../primitives';
import { cn } from '../../../lib/utils';
import { cardViewFromZone, cardViewFromPermanent } from '../cardView';
import type { CardView, GameView, PermanentView, ZoneCardView } from '../../gameView.types';
import type { ZoneKey } from './YouHudV2';

export type { ZoneKey }; // single source of truth lives in YouHudV2 (Task 7)
const TABS: { key: ZoneKey; label: string }[] = [
  { key: 'graveyard', label: 'Graveyard' }, { key: 'exile', label: 'Exile' }, { key: 'command', label: 'Command' },
];

// Returns thumbnails for a player+zone. Command zone holds PermanentViews; others ZoneCardViews.
function entries(view: GameView, playerId: string, zone: ZoneKey): { id: string; name: string; cv: CardView }[] {
  const isYou = playerId === 'you';
  if (zone === 'command') {
    const cz: PermanentView[] = isYou ? view.you.commandZone : (view.opponents.find(o => o.glance.playerId === playerId)?.commandZone ?? []);
    return cz.map(p => ({ id: p.id, name: p.name, cv: cardViewFromPermanent(p, 'command') }));
  }
  if (zone === 'library') return []; // hidden by default — count only
  const list: ZoneCardView[] = isYou
    ? (zone === 'graveyard' ? view.you.graveyard : view.you.exile)
    : (() => { const o = view.opponents.find(op => op.glance.playerId === playerId); return o ? (zone === 'graveyard' ? o.graveyard : o.exile) : []; })();
  return list.map(z => ({ id: z.id, name: z.name, cv: cardViewFromZone(z, zone) }));
}

export function ZoneExplorerV2({
  view, target, onClose, onView,
}: { view: GameView; target: { playerId: string; zone: ZoneKey }; onClose(): void; onView(cv: CardView): void }) {
  const [zone, setZone] = useState<ZoneKey>(target.zone);
  const playerName = target.playerId === 'you' ? 'You' : (view.opponents.find(o => o.glance.playerId === target.playerId)?.glance.name ?? 'Opponent');
  const items = entries(view, target.playerId, zone);
  const tabs = (
    <span className="flex gap-1.5">
      {TABS.map(t => (
        <button key={t.key} type="button" onClick={() => setZone(t.key)}
          className={cn('rounded-full border px-2.5 py-0.5 text-[11px]', zone === t.key ? 'border-brass-deep bg-brass text-brass-on font-semibold' : 'border-table-border text-gold-muted')}>
          {t.label}
        </button>
      ))}
    </span>
  );
  return (
    <ModalShell title={`${playerName} · ${zone[0].toUpperCase()}${zone.slice(1)}`} onClose={onClose} side={tabs}>
      {items.length === 0 ? (
        <p className="py-8 text-center text-gold-muted">No cards here.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map(it => (
            <button key={it.id} type="button" aria-label={it.name} onClick={() => onView(it.cv)}>
              <CardFace cardName={it.name} className="h-[88px] w-[62px]" />
            </button>
          ))}
        </div>
      )}
    </ModalShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/ZoneExplorerV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/components/ZoneExplorerV2.tsx frontend/src/play/v2/components/ZoneExplorerV2.test.tsx
git commit -m "feat(play-v2): ZoneExplorerV2 (graveyard/exile/command, any player)"
```

---

### Task 14: `CombatFlowV2` + `TargetingLayerV2`

**Files:**
- Create: `frontend/src/play/v2/components/CombatFlowV2.tsx`, `TargetingLayerV2.tsx`
- Test: `frontend/src/play/v2/components/combatTargeting.test.tsx`

**Interfaces:**
- Consumes: `CombatContext`, `TargetingContext`, `Panel`/`BrassButton`.
- Produces:
  - `TargetingLayerV2({ targeting, onToggleTarget, onConfirm, onCancel })` — board-anchored prompt banner listing `targeting.legalTargets` as toggle chips; Confirm enabled when selection count is within `[minTargets, maxTargets]`.
  - `CombatFlowV2({ combat, selectedDefenderId, onAssign, onConfirm, onSkip, onSelectDefender })` — renders the attacker/blocker step from `combat.step`; lists `combat.eligible` combatants + `combat.eligibleDefenders`; Confirm/Skip buttons.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/components/combatTargeting.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TargetingLayerV2 } from './TargetingLayerV2';
import type { TargetingContext } from '../../gameView.types';

const targeting: TargetingContext = {
  active: true, prompt: 'Choose target creature', minTargets: 1, maxTargets: 1,
  legalTargetIds: ['t1'], legalTargets: [{ id: 't1', name: 'Llanowar Elves' }], selectedTargetIds: [],
};

describe('TargetingLayerV2', () => {
  it('toggles a target and disables Confirm until min is met', () => {
    const onToggle = vi.fn();
    render(<TargetingLayerV2 targeting={targeting} onToggleTarget={onToggle} onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /llanowar elves/i }));
    expect(onToggle).toHaveBeenCalledWith('t1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/combatTargeting.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/components/TargetingLayerV2.tsx
import { Panel, BrassButton } from '../primitives';
import { cn } from '../../../lib/utils';
import type { TargetingContext } from '../../gameView.types';
export function TargetingLayerV2({
  targeting, onToggleTarget, onConfirm, onCancel,
}: { targeting: TargetingContext; onToggleTarget(id: string): void; onConfirm(): void; onCancel(): void }) {
  if (!targeting.active) return null;
  const n = targeting.selectedTargetIds.length;
  const ready = n >= targeting.minTargets && n <= targeting.maxTargets;
  return (
    <Panel className="flex flex-col gap-2 border-brass-deep p-2">
      <span className="font-display text-[15px] text-gold-bright">{targeting.prompt}</span>
      <div className="flex flex-wrap gap-1.5">
        {targeting.legalTargets.map(t => (
          <button key={t.id} type="button" aria-label={t.name} onClick={() => onToggleTarget(t.id)}
            className={cn('rounded-md border px-2 py-1 text-[12px]',
              targeting.selectedTargetIds.includes(t.id) ? 'border-brass-deep bg-brass text-brass-on' : 'border-table-border text-gold-bright')}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <BrassButton tone="primary" onClick={onConfirm} disabled={!ready}>Confirm</BrassButton>
        <BrassButton tone="neutral" onClick={onCancel}>Cancel</BrassButton>
      </div>
    </Panel>
  );
}
```

```tsx
// frontend/src/play/v2/components/CombatFlowV2.tsx
import { Panel, BrassButton } from '../primitives';
import { cn } from '../../../lib/utils';
import type { CombatContext } from '../../gameView.types';
export function CombatFlowV2({
  combat, selectedDefenderId, onAssign, onConfirm, onSkip, onSelectDefender,
}: {
  combat: CombatContext; selectedDefenderId: string | null;
  onAssign(a: string, b: string): void; onConfirm(): void; onSkip(): void; onSelectDefender(id: string): void;
}) {
  if (combat.step === 'none') return null;
  const title = combat.step === 'declare-attackers' ? 'Declare attackers' : combat.step === 'declare-blockers' ? 'Declare blockers' : 'Assign combat damage';
  return (
    <Panel className="flex flex-col gap-2 border-oxblood p-2">
      <span className="font-display text-[15px] text-gold-bright">{title}</span>
      {combat.step === 'declare-attackers' && combat.eligibleDefenders.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {combat.eligibleDefenders.map(d => (
            <button key={d.id} type="button" onClick={() => onSelectDefender(d.id)}
              className={cn('rounded-md border px-2 py-1 text-[12px]', selectedDefenderId === d.id ? 'border-brass-deep bg-brass text-brass-on' : 'border-table-border text-gold-bright')}>
              {d.name}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {combat.eligible.map(c => (
          <button key={c.id} type="button" aria-label={c.name} onClick={() => onAssign(c.id, selectedDefenderId ?? '')}
            className="rounded-md border border-table-border px-2 py-1 text-[12px] text-gold-bright">
            {c.name}{c.power != null ? ` ${c.power}/${c.toughness}` : ''}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <BrassButton tone="danger" onClick={onConfirm}>Confirm</BrassButton>
        <BrassButton tone="neutral" onClick={onSkip}>Skip</BrassButton>
      </div>
    </Panel>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/combatTargeting.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/components/CombatFlowV2.tsx frontend/src/play/v2/components/TargetingLayerV2.tsx frontend/src/play/v2/components/combatTargeting.test.tsx
git commit -m "feat(play-v2): CombatFlowV2 + TargetingLayerV2"
```

---

### Task 15: `DesktopBattlefieldV2` shell

**Files:**
- Create: `frontend/src/play/v2/shells/DesktopBattlefieldV2.tsx`
- Test: `frontend/src/play/v2/shells/DesktopBattlefieldV2.test.tsx`

**Interfaces:**
- Consumes: `DesktopBattlefieldProps` (from `../../shells/DesktopBattlefield` — re-import the type), all v2 components, `ZoneExplorerV2`/`CardViewerV2`, `DESKTOP_BATTLEFIELD_LAYOUT` from `../../playView.layout`.
- Produces: `DesktopBattlefieldV2(props: DesktopBattlefieldProps)` — same prop contract as v1; **owns local overlay state** for the zone explorer + card viewer (opened from v2 components via `onView`/`onOpenZone`/`onExplore`). Renders inside the existing 3-column grid; overlays are board-anchored (`absolute inset-0`) within the `relative isolate` center column.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/shells/DesktopBattlefieldV2.test.tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DesktopBattlefieldV2 } from './DesktopBattlefieldV2';
import type { DesktopBattlefieldProps } from '../../shells/DesktopBattlefield';
import type { GameView } from '../../gameView.types';

function emptyView(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 2, libraryCount: 99, handCount: 0,
      creatures: [], artifacts: [], enchantments: [], lands: [], other: [], hand: [],
      graveyard: [{ id: 'g1', name: 'Cultivate', legalActions: [] }], exile: [],
    },
    opponents: [], stack: [],
    priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main 1', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}
function props(): DesktopBattlefieldProps {
  const noop = () => {};
  return {
    view: emptyView(), alwaysStop: false, onAction: noop, onExamine: noop, onPass: noop, onHold: noop,
    onToggleAlwaysStop: noop, onExploreOpponent: noop, onRespond: noop, onLetResolve: noop,
    onToggleTarget: noop, onConfirmTarget: noop, onCancelTarget: noop, onAssignCombat: noop,
    onConfirmCombat: noop, onSkipCombat: noop, selectedDefenderId: null, onSelectDefender: noop,
  };
}

describe('DesktopBattlefieldV2', () => {
  it('opens the zone explorer from the HUD graveyard counter', () => {
    render(<DesktopBattlefieldV2 {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /graveyard 2/i }));
    // Explorer modal renders the contents
    expect(screen.getByRole('button', { name: /cultivate/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/shells/DesktopBattlefieldV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/shells/DesktopBattlefieldV2.tsx
import { useState } from 'react';
import type { DesktopBattlefieldProps } from '../../shells/DesktopBattlefield';
import { DESKTOP_BATTLEFIELD_LAYOUT as L } from '../../playView.layout';
import type { CardView } from '../../gameView.types';
import { OpponentRailV2 } from '../components/OpponentRailV2';
import { PlayerBoardV2 } from '../components/PlayerBoardV2';
import { HandViewV2 } from '../components/HandViewV2';
import { StackViewV2 } from '../components/StackViewV2';
import { PhaseTrackV2 } from '../components/PhaseTrackV2';
import { PriorityControlsV2 } from '../components/PriorityControlsV2';
import { NarrationFeedV2 } from '../components/NarrationFeedV2';
import { CombatFlowV2 } from '../components/CombatFlowV2';
import { TargetingLayerV2 } from '../components/TargetingLayerV2';
import { CardViewerV2 } from '../components/CardViewerV2';
import { ZoneExplorerV2, type ZoneKey } from '../components/ZoneExplorerV2';

export function DesktopBattlefieldV2(props: DesktopBattlefieldProps) {
  const { view } = props;
  const [viewer, setViewer] = useState<CardView | null>(null);
  const [explorer, setExplorer] = useState<{ playerId: string; zone: ZoneKey } | null>(null);

  return (
    <div className={L.shell}>
      <div className={L.grid}>
        <div className={L.leftRail}>
          <PhaseTrackV2 priority={view.priority} />
          <PriorityControlsV2 priority={view.priority} alwaysStop={props.alwaysStop}
            onPass={props.onPass} onHold={props.onHold} onToggleAlwaysStop={props.onToggleAlwaysStop} />
        </div>

        <div className={L.centerColumn}>
          <div className={L.opponentsStrip}>
            <OpponentRailV2 opponents={view.opponents} onExplore={id => setExplorer({ playerId: id, zone: 'graveyard' })} />
          </div>
          <div className={L.stackSlot}><StackViewV2 stack={view.stack} onView={setViewer} /></div>
          <div className={L.playerBoardArea}>
            <PlayerBoardV2 you={view.you} onAction={props.onAction} onView={setViewer}
              onOpenZone={zone => setExplorer({ playerId: 'you', zone })} />
          </div>
          <div className={L.decisionSlot}>
            <TargetingLayerV2 targeting={view.targeting} onToggleTarget={props.onToggleTarget}
              onConfirm={props.onConfirmTarget} onCancel={props.onCancelTarget} />
            <CombatFlowV2 combat={view.combat} selectedDefenderId={props.selectedDefenderId}
              onAssign={props.onAssignCombat} onConfirm={props.onConfirmCombat} onSkip={props.onSkipCombat}
              onSelectDefender={props.onSelectDefender} />
          </div>
          <div className={L.handRail}><HandViewV2 hand={view.you.hand} onAction={props.onAction} onView={setViewer} /></div>

          {explorer ? (
            <ZoneExplorerV2 view={view} target={explorer} onClose={() => setExplorer(null)}
              onView={cv => { setViewer(cv); setExplorer(null); }} />
          ) : null}
          {viewer ? <CardViewerV2 card={viewer} onClose={() => setViewer(null)}
            onAction={a => { props.onAction(a); setViewer(null); }} /> : null}
        </div>

        <div className={L.rightRail}><NarrationFeedV2 narration={view.narration} /></div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/shells/DesktopBattlefieldV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/shells/DesktopBattlefieldV2.tsx frontend/src/play/v2/shells/DesktopBattlefieldV2.test.tsx
git commit -m "feat(play-v2): DesktopBattlefieldV2 shell with board-anchored overlays"
```

---

### Task 16: `MobileTableV2` shell

**Files:**
- Create: `frontend/src/play/v2/shells/MobileTableV2.tsx`
- Test: `frontend/src/play/v2/shells/MobileTableV2.test.tsx`

**Interfaces:**
- Consumes: `MobileTableProps` (= `DesktopBattlefieldProps`), all v2 components, `MOBILE_TABLE_LAYOUT` from `../../playView.layout`, `shouldSurfaceDecisionSheet` from `../../playView.layout`.
- Produces: `MobileTableV2(props: DesktopBattlefieldProps)` — single in-flow vertical column (opponents strip · board · decision sheet · priority · hand pull-up); same overlay state pattern as Task 15, overlays board-anchored within the `relative isolate` board area.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/play/v2/shells/MobileTableV2.test.tsx
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MobileTableV2 } from './MobileTableV2';
import type { DesktopBattlefieldProps } from '../../shells/DesktopBattlefield';
import type { GameView } from '../../gameView.types';

function view(): GameView {
  return {
    you: {
      life: 40, poison: 0, maxCommanderDamageTaken: 0, manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
      commandZone: [], graveyardCount: 1, libraryCount: 99, handCount: 0,
      creatures: [], artifacts: [], enchantments: [], lands: [], other: [], hand: [],
      graveyard: [{ id: 'g1', name: 'Cultivate', legalActions: [] }], exile: [],
    },
    opponents: [], stack: [],
    priority: { hasPriority: true, isYourTurn: true, phaseLabel: 'Main 1', hasMeaningfulResponse: false, canPass: true, canHold: false },
    targeting: { active: false, prompt: '', minTargets: 0, maxTargets: 0, legalTargetIds: [], legalTargets: [], selectedTargetIds: [] },
    combat: { step: 'none', eligibleIds: [], eligible: [], eligibleDefenders: [], assignments: {} },
    narration: [], guided: false, isYourTurn: true, winner: null,
  };
}
function props(): DesktopBattlefieldProps {
  const noop = () => {};
  return {
    view: view(), alwaysStop: false, onAction: noop, onExamine: noop, onPass: noop, onHold: noop,
    onToggleAlwaysStop: noop, onExploreOpponent: noop, onRespond: noop, onLetResolve: noop,
    onToggleTarget: noop, onConfirmTarget: noop, onCancelTarget: noop, onAssignCombat: noop,
    onConfirmCombat: noop, onSkipCombat: noop, selectedDefenderId: null, onSelectDefender: noop,
  };
}

describe('MobileTableV2', () => {
  it('opens the zone explorer from the HUD', () => {
    render(<MobileTableV2 {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: /graveyard 1/i }));
    expect(screen.getByRole('button', { name: /cultivate/i })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/shells/MobileTableV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/src/play/v2/shells/MobileTableV2.tsx
import { useState } from 'react';
import type { DesktopBattlefieldProps } from '../../shells/DesktopBattlefield';
import { MOBILE_TABLE_LAYOUT as L, shouldSurfaceDecisionSheet } from '../../playView.layout';
import type { CardView } from '../../gameView.types';
import { OpponentRailV2 } from '../components/OpponentRailV2';
import { PlayerBoardV2 } from '../components/PlayerBoardV2';
import { HandViewV2 } from '../components/HandViewV2';
import { StackViewV2 } from '../components/StackViewV2';
import { PriorityControlsV2 } from '../components/PriorityControlsV2';
import { CombatFlowV2 } from '../components/CombatFlowV2';
import { TargetingLayerV2 } from '../components/TargetingLayerV2';
import { CardViewerV2 } from '../components/CardViewerV2';
import { ZoneExplorerV2, type ZoneKey } from '../components/ZoneExplorerV2';

export function MobileTableV2(props: DesktopBattlefieldProps) {
  const { view } = props;
  const [viewer, setViewer] = useState<CardView | null>(null);
  const [explorer, setExplorer] = useState<{ playerId: string; zone: ZoneKey } | null>(null);
  const showSheet = shouldSurfaceDecisionSheet(view) || view.targeting.active || view.combat.step !== 'none';

  return (
    <div className={L.shell}>
      <div className={L.opponentsStrip}>
        <OpponentRailV2 opponents={view.opponents} onExplore={id => setExplorer({ playerId: id, zone: 'graveyard' })} />
      </div>

      <div className={L.boardArea}>
        <PlayerBoardV2 you={view.you} onAction={props.onAction} onView={setViewer}
          onOpenZone={zone => setExplorer({ playerId: 'you', zone })} />
        {explorer ? (
          <ZoneExplorerV2 view={view} target={explorer} onClose={() => setExplorer(null)}
            onView={cv => { setViewer(cv); setExplorer(null); }} />
        ) : null}
        {viewer ? <CardViewerV2 card={viewer} onClose={() => setViewer(null)}
          onAction={a => { props.onAction(a); setViewer(null); }} /> : null}
      </div>

      {showSheet ? (
        <div className={L.decisionSheet}>
          <StackViewV2 stack={view.stack} onView={setViewer} />
          <TargetingLayerV2 targeting={view.targeting} onToggleTarget={props.onToggleTarget}
            onConfirm={props.onConfirmTarget} onCancel={props.onCancelTarget} />
          <CombatFlowV2 combat={view.combat} selectedDefenderId={props.selectedDefenderId}
            onAssign={props.onAssignCombat} onConfirm={props.onConfirmCombat} onSkip={props.onSkipCombat}
            onSelectDefender={props.onSelectDefender} />
        </div>
      ) : null}

      <div className={L.prioritySlot}>
        <PriorityControlsV2 priority={view.priority} alwaysStop={props.alwaysStop}
          onPass={props.onPass} onHold={props.onHold} onToggleAlwaysStop={props.onToggleAlwaysStop} />
      </div>

      <details className={L.handPullup}>
        <summary className={L.handPullupSummary}>Hand ({view.you.hand.length})</summary>
        <div className={L.handPullupBody}>
          <HandViewV2 hand={view.you.hand} onAction={props.onAction} onView={setViewer} />
        </div>
      </details>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/shells/MobileTableV2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/play/v2/shells/MobileTableV2.tsx frontend/src/play/v2/shells/MobileTableV2.test.tsx
git commit -m "feat(play-v2): MobileTableV2 shell"
```

---

### Task 17: Flag wiring (`?ui=v2`) + dev toggle

**Files:**
- Create: `frontend/src/play/v2/uiFlag.ts`
- Modify: `frontend/src/play/PlayExperience.tsx` (shell selection ~line 824)
- Modify: `frontend/src/pages/PlayPage.tsx` (`useNewPlayUi` ~lines 301–308)
- Test: `frontend/src/play/v2/uiFlag.test.ts`

**Interfaces:**
- Consumes: nothing engine-side.
- Produces: `isPlayUiV2(search?: string): boolean` — true when the URL query has `ui=v2` OR `localStorage['mb.play.ui'] === 'v2'`. Used by `PlayPage` (to force `PlayExperience` on) and `PlayExperience` (to pick v2 shells).

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/play/v2/uiFlag.test.ts
import { describe, expect, it } from 'vitest';
import { isPlayUiV2 } from './uiFlag';

describe('isPlayUiV2', () => {
  it('is true when ui=v2 is in the query', () => {
    expect(isPlayUiV2('?ui=v2')).toBe(true);
    expect(isPlayUiV2('?ui=v1')).toBe(false);
    expect(isPlayUiV2('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/play/v2/uiFlag.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the flag resolver**

```ts
// frontend/src/play/v2/uiFlag.ts
const STORAGE_KEY = 'mb.play.ui';

export function isPlayUiV2(search?: string): boolean {
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  if (new URLSearchParams(query).get('ui') === 'v2') return true;
  try {
    return typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'v2';
  } catch {
    return false;
  }
}

export function setPlayUiV2(on: boolean): void {
  try { localStorage?.setItem(STORAGE_KEY, on ? 'v2' : 'v1'); } catch { /* storage unavailable */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/play/v2/uiFlag.test.ts`
Expected: PASS.

- [ ] **Step 5: Force `PlayExperience` on when `ui=v2`**

In `frontend/src/pages/PlayPage.tsx`, update `useNewPlayUi` (lines 301–308) so `?ui=v2` also enables the experience:

```ts
const useNewPlayUi = useMemo(
  () =>
    typeof window !== 'undefined' &&
    (new URLSearchParams(window.location.search).get('newui') === '1' ||
      new URLSearchParams(window.location.search).get('ui') === 'v2'),
  [],
);
```

- [ ] **Step 6: Select v2 shells in `PlayExperience`**

In `frontend/src/play/PlayExperience.tsx`, add imports near the existing shell imports:

```ts
import { isPlayUiV2 } from './v2/uiFlag';
import { DesktopBattlefieldV2 } from './v2/shells/DesktopBattlefieldV2';
import { MobileTableV2 } from './v2/shells/MobileTableV2';
```

Near the `const isDesktop = useIsDesktop();` line (~824), add:

```ts
const uiV2 = isPlayUiV2();
const Desktop = uiV2 ? DesktopBattlefieldV2 : DesktopBattlefield;
const Mobile = uiV2 ? MobileTableV2 : MobileTable;
```

Replace the shell render line with:

```tsx
{isDesktop ? <Desktop {...shellProps} /> : <Mobile {...shellProps} />}
```

- [ ] **Step 7: Verify the build + full test suite**

Run: `npm run build && npm run test`
Expected: build succeeds; all tests pass.

- [ ] **Step 8: Manual smoke**

Run `npm run dev`, open `http://localhost:5173/play?ui=v2`, start a game. Confirm the deepened Artisan board renders, a graveyard counter opens the explorer, and clicking a card opens the viewer. Resize below 1024px to confirm the mobile shell. Then open `/play?newui=1` (no `ui=v2`) and confirm v1 still renders unchanged.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/play/v2/uiFlag.ts frontend/src/play/v2/uiFlag.test.ts frontend/src/play/PlayExperience.tsx frontend/src/pages/PlayPage.tsx
git commit -m "feat(play-v2): wire ?ui=v2 flag to select v2 shells"
```

---

### Task 18: Re-theme the prompt overlays (mulligan, discard, tutor, etc.)

**Files:**
- Create: `frontend/src/play/v2/components/PromptModalsV2.tsx` (thin themed wrappers using `ModalShell`)
- Modify: `frontend/src/play/v2/shells/DesktopBattlefieldV2.tsx` + `MobileTableV2.tsx` (render the v2 prompt modals when a `prompts` prop is present)
- Modify: `frontend/src/play/shells/DesktopBattlefield.tsx` — **read-only check**: confirm whether the existing shells receive `prompts`; if `PlayPrompts` is threaded to shells, add it to the v2 shell props; otherwise the prompt overlays remain owned by `PlayExperience` and this task only restyles them.
- Test: `frontend/src/play/v2/components/PromptModalsV2.test.tsx`

> Scope note: the prompt resolvers (`onKeep`, `onMulligan`, `onDiscard`, …) are reused verbatim from the `PlayPrompts` bag — **no logic changes**, only `ModalShell` theming. If `PlayExperience` already renders the prompt overlays above the shell (so they appear for v2 automatically), this task is purely visual polish and MAY be deferred without blocking the redesign. Verify by running `/play?ui=v2` and triggering a mulligan: if the existing mulligan overlay appears and works, defer; if not, implement the v2 prompt modals here.

- [ ] **Step 1: Determine ownership**

Read `frontend/src/play/PlayExperience.tsx` around where `prompts` is consumed. Decide: (a) prompts render in `PlayExperience` (shared by both shells) → restyle there or defer; (b) prompts are shell-owned → implement v2 wrappers. Write down the finding as a comment at the top of `PromptModalsV2.tsx`.

- [ ] **Step 2: Write the failing test (mulligan wrapper as the representative case)**

```tsx
// frontend/src/play/v2/components/PromptModalsV2.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MulliganModalV2 } from './PromptModalsV2';

describe('MulliganModalV2', () => {
  it('keeps the hand on Keep', () => {
    const onKeep = vi.fn();
    render(<MulliganModalV2 count={7} bottomCount={0} onKeep={onKeep} onMulligan={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /keep/i }));
    expect(onKeep).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/play/v2/components/PromptModalsV2.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the representative wrapper**

```tsx
// frontend/src/play/v2/components/PromptModalsV2.tsx
import { ModalShell, BrassButton } from '../primitives';

export function MulliganModalV2({
  count, bottomCount, onKeep, onMulligan,
}: { count: number; bottomCount: number; onKeep(): void; onMulligan(): void }) {
  return (
    <ModalShell title="Opening hand" onClose={onKeep}>
      <p className="mb-3 text-gold-muted">{bottomCount > 0 ? `Put ${bottomCount} card(s) on the bottom.` : `You drew ${count} cards.`}</p>
      <div className="flex gap-2">
        <BrassButton tone="primary" onClick={onKeep}>Keep</BrassButton>
        <BrassButton tone="neutral" onClick={onMulligan}>Mulligan</BrassButton>
      </div>
    </ModalShell>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/play/v2/components/PromptModalsV2.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire (only if Step 1 found prompts are shell-owned)**

If shell-owned, add the `prompts?: PlayPrompts` field to the v2 shell props and render `MulliganModalV2` (and siblings) from the `prompts` bag inside each v2 shell's board container, mirroring how v1 renders them. If `PlayExperience`-owned, skip wiring — the prompts already appear.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/play/v2/components/PromptModalsV2.tsx frontend/src/play/v2/components/PromptModalsV2.test.tsx frontend/src/play/v2/shells/
git commit -m "feat(play-v2): themed prompt modals (mulligan representative)"
```

---

### Task 19: Deploy to the IONOS VPS (`deckreps.app`)

> Ops task — runs after the redesign is merged to the deploy branch. Requires SSH access to the VPS and (for §10.1) the production `ADMIN_TOKEN`. Reference: `docs/ionos-vps-deploy.md` §12.

**Files:** none (operational).

- [ ] **Step 1: Pre-flight — green build locally**

From `frontend/`: `npm run build && npm run test`
Expected: build succeeds, all tests pass. Do not deploy on red.

- [ ] **Step 2: Merge + push the deploy branch**

```bash
git checkout master
git merge --no-ff game-reliability-refactor
git push origin master
```

(If the project deploys from a different branch, push that branch instead. Confirm which branch the VPS `git pull`s before merging.)

- [ ] **Step 3: Snapshot runtime on the VPS**

```bash
ssh deckreps@YOUR_VPS_IP
cd /opt/deckreps/app
BACKUP_DIR=/opt/deckreps/backups ./deploy/backup-runtime.sh
```

- [ ] **Step 4: Pull + rebuild + restart**

```bash
git pull
docker compose up -d --build
docker compose ps
```

Expected: both `web` and `shelector` services `Up` (shelector `healthy`).

- [ ] **Step 5: Verify health (runbook §10)**

```bash
curl -I https://deckreps.app
curl https://deckreps.app/api/health
curl https://deckreps.app/api/readiness
curl https://deckreps.app/shelector-api/health
```

Expected: `200`/healthy responses.

- [ ] **Step 6: Verify the live game (runbook §10.1)**

From the workstation (PowerShell), with the production token:

```powershell
$env:DECKREPS_BASE_URL='https://deckreps.app'
$env:DECKREPS_QA_ADMIN_TOKEN='<production ADMIN_TOKEN>'
$env:GOLDFISH_POD_ACTIONS='120'
node scripts/goldfish_pod_ui_playtest.js
```

Expected: 3- and 4-player pods import 99-card decks, real engine starts, zero pending/rejected actions.

- [ ] **Step 7: Smoke the redesign live**

Open `https://deckreps.app/play?ui=v2`, start a game, and confirm: deepened Artisan board renders; graveyard counter opens the explorer; card viewer opens for any card; mobile width works. Confirm `https://deckreps.app/play?newui=1` (no `ui=v2`) still shows v1 unchanged.

- [ ] **Step 8: Rollback path (only if a check fails)**

```bash
cd /opt/deckreps/app
./deploy/rollback-app.sh
docker compose ps
```

Then re-verify §10. Investigate the failure before re-attempting.

- [ ] **Step 9: Record the deploy**

Note the deployed commit SHA and the date in `docs/launch-readiness.md` (or the project's deploy log).

---

## Self-Review

**Spec coverage:** §3 visual language → Task 1 (tokens/fonts) + every component task uses them. §4.2 view-model zone contents → Tasks 2–3. §4.3 CardView → Task 4. §4.4 primitives → Task 5. §4.5 component set → Tasks 6–14, 18. §4.6 zone explorer + universal viewer + exile dependency → Tasks 2, 12, 13. §4.7 shells + flag → Tasks 15–17. §4.8 invariants → enforced in Task 5 `ModalShell` (board-anchored, asserted in test), Tasks 15–16 (overlays in `relative isolate` columns, layout constants reused). §5 data flow → shells consume `DesktopBattlefieldProps` unchanged. §6 testing → every task is TDD with Vitest. §7 rollout / §8 deploy → Task 19. §11 success criteria → covered across tasks + Task 19 smoke.

**Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N" — each task carries full code and exact commands. Task 18 explicitly allows *deferral* (a scoping decision, not a placeholder) with a concrete verification to decide.

**Type consistency:** `CardView`/`ZoneCardView`/`CardZone` defined once (Global Constraints + Tasks 3–4) and consumed by Tasks 6, 9, 10, 12, 13. `onView(cv: CardView)`, `onOpenZone(zone: ZoneKey)`, `onExplore(playerId)`, `onAction(a: LegalAction)` are used with the same signatures across components and both shells. `ZoneKey` has a single source of truth: it is defined and exported by `YouHudV2` (Task 7) and re-exported by `ZoneExplorerV2` (Task 13), so both shells importing it from `./ZoneExplorerV2` and `PlayerBoardV2` importing it from `./YouHudV2` resolve to the same type. Both shells implement `DesktopBattlefieldProps` verbatim (Task 15 imports the type; Task 16 reuses it).
