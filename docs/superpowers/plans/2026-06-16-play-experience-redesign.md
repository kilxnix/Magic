# Play Experience Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the in-game play experience's view + interaction layer on top of the untouched `useShelectorGame` engine hook — a responsive battlefield (desktop) / floating table (mobile), a consistent engine-driven interaction grammar with no dead-ends, a learning-grade visible stack, and an opt-in guided mode.

**Architecture:** Keep `useShelectorGame` exactly as-is (engine state + dispatch). Add a pure `useGameView` selector layer that derives everything the UI needs (`GameView`). Presentational components consume `GameView` and emit engine actions via callbacks; two layout shells compose the same components by viewport. No game logic in components.

**Tech Stack:** React + TypeScript + Vite, Tailwind, vitest. Engine is the existing in-browser TS rules engine surfaced through `useShelectorGame`.

**Spec:** `docs/superpowers/specs/2026-06-16-play-experience-redesign.md`

**Version control note:** This repo is not git-initialized. Either run `git init` once at the start (recommended — gives per-task rollback) and treat each "Checkpoint" as a commit, or treat checkpoints as logical save points. Deploy continues to be scp + `docker compose build web` per the project's existing flow.

---

## File structure

New module `frontend/src/play/` (the rebuilt experience lives here; the old `GameBoard.tsx` stays until Task 16 cuts over behind a flag):

- `play/gameView.types.ts` — the `GameView` contract (types only). One responsibility: the shared shape.
- `play/useGameView.ts` — pure derivation `engineState → GameView`. No React state, no side effects.
- `play/selectors/` — focused pure selectors used by `useGameView`:
  - `opponentGlance.ts` — engine player → `OpponentGlance` (life, hand, open mana, threat).
  - `stackView.ts` — engine stack → `StackItemView[]` with plain-language descriptions + `resolvesNext`.
  - `legalActions.ts` — engine legal-action set for an object → `LegalAction[]` with labels.
  - `priority.ts` — `PriorityContext` (has-priority, meaningful-response, can-pass/hold).
  - `targeting.ts`, `combat.ts`, `narration.ts` — the remaining contexts.
- `play/components/` — presentational, prop-driven, no engine access:
  `PermanentTile.tsx`, `PlayerBoard.tsx`, `OpponentCard.tsx`, `OpponentExplorer.tsx`, `StackView.tsx`, `HandView.tsx`, `ActionMenu.tsx`, `PriorityStrip.tsx`, `TargetingLayer.tsx`, `CombatFlow.tsx`, `NarrationFeed.tsx`.
- `play/shells/DesktopBattlefield.tsx`, `play/shells/MobileTable.tsx` — compose the same components.
- `play/playView.layout.ts` — Tailwind class constants per surface (mirrors the existing `gameBoardLayout.ts` pattern).
- `play/PlayExperience.tsx` — top level: wires `useShelectorGame → useGameView`, picks the shell by viewport, owns the guided-play toggle + targeting/combat interaction state, routes component callbacks to engine dispatch.
- Tests under `frontend/tests/play/`.

---

## Task 0: Engine-hook + play-code API inventory

**Files:**
- Read: `frontend/src/hooks/useShelectorGame.ts`, `frontend/src/components/GameBoard.tsx`, `frontend/src/lib/gameBoardLayout.ts`, the engine action/state types it imports (engine `index.ts` exports), `frontend/src/lib/qaGameScenarios.ts`.
- Create: `docs/superpowers/plans/notes/engine-hook-api.md`

- [ ] **Step 1: Inventory what `useShelectorGame` returns and accepts.** Document: the game-state object shape (players, zones, battlefield, hand, stack, combat, priority/turn, phase), the dispatch/action API (how an action is submitted — names, payload shapes), how legal/eligible actions are queried today (the existing GameBoard derives attackers/blockers/eligible casts — record exactly how), and how examine/zoom + opponent explore work today.
- [ ] **Step 2: Record the mapping** from engine fields → each `GameView` field this plan defines (Task 1). Flag any `GameView` field with no clear engine source as an OPEN ITEM with the closest available data.
- [ ] **Step 3: Checkpoint.** Save the notes file. This is the source of truth the later tasks build against; if a later task's selector can't be written as specified, this note is where the deviation is reconciled.

Acceptance: the notes file lists every `GameView` field with its engine source (or an explicit OPEN ITEM). No code yet.

---

## Task 1: `GameView` contract (types)

**Files:**
- Create: `frontend/src/play/gameView.types.ts`

- [ ] **Step 1: Write the contract.** Exact types (adjust field sources per Task 0 notes, keep names stable — later tasks reference these):

```typescript
export type ObjectId = string;

export type LegalActionKind =
  | 'cast' | 'play-land' | 'activate' | 'attack' | 'block'
  | 'choose-target' | 'pass' | 'hold' | 'mulligan' | 'examine';

export interface LegalAction {
  id: string;                 // engine action id to dispatch
  kind: LegalActionKind;
  label: string;              // e.g. "Cast — {1}{B}"
  whyDisabled?: string;       // present only when shown-but-illegal (guided "why?")
}

export interface PermanentView {
  id: ObjectId;
  name: string;
  imageUri?: string;
  tapped: boolean;
  power?: number;
  toughness?: number;
  counters?: Record<string, number>;
  isLand: boolean;
  isCreature: boolean;
  isAttacking?: boolean;
  isBlocking?: boolean;
  legalActions: LegalAction[];
}

export interface HandCardView {
  id: ObjectId;
  name: string;
  imageUri?: string;
  manaCost?: string;
  legalActions: LegalAction[];
}

export interface OpponentGlance {
  playerId: ObjectId;
  name: string;
  life: number;
  commanderDamageToYou: number;
  handCount: number;
  openMana: number;           // count of untapped mana sources
  creatureCount: number;
  totalPower: number;
  flags: Array<'commander-out' | 'table-threat'>;
  contextNote?: string;       // contextual glance, e.g. "2 untapped blockers"
}

export interface OpponentBoard {
  glance: OpponentGlance;
  creatures: PermanentView[];
  lands: PermanentView[];
  other: PermanentView[];
  graveyardCount: number;
  exileCount: number;
  commandZone: PermanentView[];
}

export interface StackItemView {
  id: ObjectId;
  controllerName: string;
  title: string;              // card / ability name
  description: string;        // plain language: "counter target spell · targeting Cultivate"
  resolvesNext: boolean;
}

export interface PriorityContext {
  hasPriority: boolean;
  phaseLabel: string;         // "your priority · main 2"
  hasMeaningfulResponse: boolean;
  canPass: boolean;
  canHold: boolean;
}

export interface TargetingContext {
  active: boolean;
  prompt: string;             // "choose 1 target"
  minTargets: number;
  maxTargets: number;
  legalTargetIds: ObjectId[];
  selectedTargetIds: ObjectId[];
}

export type CombatStep = 'none' | 'declare-attackers' | 'declare-blockers' | 'order-damage';

export interface CombatContext {
  step: CombatStep;
  eligibleIds: ObjectId[];        // attackers or blockers depending on step
  assignments: Record<ObjectId, ObjectId>; // attacker→defender or blocker→attacker
}

export interface NarrationEntry {
  id: string;
  kind: 'trigger' | 'resolve' | 'phase' | 'action';
  text: string;
}

export interface YouView {
  life: number;
  creatures: PermanentView[];
  lands: PermanentView[];
  other: PermanentView[];
  hand: HandCardView[];
}

export interface GameView {
  you: YouView;
  opponents: OpponentGlance[];
  stack: StackItemView[];
  priority: PriorityContext;
  targeting: TargetingContext;
  combat: CombatContext;
  narration: NarrationEntry[];
  guided: boolean;
  isYourTurn: boolean;
  winner?: string | null;
}
```

- [ ] **Step 2: Build.** Run: `cd frontend && npx tsc --noEmit`. Expected: PASS (types only).
- [ ] **Step 3: Checkpoint.**

---

## Task 2: Pure selectors + `useGameView` (TDD)

Each selector is pure (`engineState → slice of GameView`) and unit-tested. Build a small `makeEngineState(overrides)` test fixture from the Task 0 inventory, then TDD each selector. Below are the load-bearing tests; write one test file per selector.

**Files:**
- Create: `frontend/src/play/selectors/{opponentGlance,stackView,legalActions,priority,targeting,combat,narration}.ts`, `frontend/src/play/useGameView.ts`
- Create: `frontend/tests/play/selectors/*.test.ts`, `frontend/tests/play/fixtures/engineState.ts`

- [ ] **Step 1: Fixture.** Build `makeEngineState(overrides)` returning a minimal engine-state object matching the real shape from Task 0, with helpers to add players/permanents/stack items/untapped lands.

- [ ] **Step 2: `opponentGlance` — failing test.**

```typescript
import { describe, expect, it } from 'vitest';
import { opponentGlance } from '../../../src/play/selectors/opponentGlance';
import { makeEngineState, addOpponent } from '../fixtures/engineState';

it('summarizes life, hand, open mana, and board threat', () => {
  const s = addOpponent(makeEngineState(), {
    name: 'Kuja', life: 21, hand: 2, untappedLands: 0,
    creatures: [{ power: 4 }, { power: 4 }, { power: 16, tapped: true }],
  });
  const g = opponentGlance(s, 'Kuja');
  expect(g).toMatchObject({ name: 'Kuja', life: 21, handCount: 2, openMana: 0, creatureCount: 3, totalPower: 24 });
});
```

- [ ] **Step 3: Run → FAIL.** `cd frontend && npx vitest run tests/play/selectors/opponentGlance.test.ts` → fails (no module).
- [ ] **Step 4: Implement `opponentGlance`** to pass (map engine player → `OpponentGlance`; `openMana` = count untapped mana sources; `totalPower` = sum creature power). Re-run → PASS.

- [ ] **Step 5: `stackView` — failing test (LIFO + plain language + resolvesNext).**

```typescript
it('orders the stack top-first and marks the top as resolvesNext', () => {
  const s = makeStack([
    { controller: 'Kuja', title: 'Cultivate', description: 'search for 2 basic lands' },
    { controller: 'You', title: 'Counterspell', description: 'counter target spell · targeting Cultivate' },
  ]); // pushed in cast order; Counterspell last
  const v = stackView(s);
  expect(v[0].title).toBe('Counterspell');
  expect(v[0].resolvesNext).toBe(true);
  expect(v[1].title).toBe('Cultivate');
});
```

- [ ] **Step 6: Run → FAIL, implement `stackView`, re-run → PASS.**

- [ ] **Step 7: `priority` — failing test (no-dead-ends: pass always available when you have priority).**

```typescript
it('always offers pass when you hold priority, even with no responses', () => {
  const p = priority(makeEngineState({ youHavePriority: true, playableInstants: 0 }), 'You');
  expect(p.hasPriority).toBe(true);
  expect(p.canPass).toBe(true);
  expect(p.hasMeaningfulResponse).toBe(false);
});
```

- [ ] **Step 8: Run → FAIL, implement `priority`, re-run → PASS.**

- [ ] **Step 9: `legalActions` — failing test (only engine-legal actions; unpayable kicker hidden).**

```typescript
it('returns only engine-legal actions for an object', () => {
  const card = makeHandCard({ name: 'Vault Skirge', canCast: true, canKick: false });
  const actions = legalActions(makeEngineState(), card);
  expect(actions.map(a => a.kind)).toContain('cast');
  expect(actions.find(a => a.label.includes('kicker'))).toBeUndefined();
});
```

- [ ] **Step 10: Run → FAIL, implement `legalActions`, re-run → PASS.**

- [ ] **Step 11: `targeting`, `combat`, `narration` selectors** — same TDD loop. Minimum tests: targeting splits legal vs not and respects min/max; combat reports the current step + eligible ids; narration turns a trigger event into a plain-language line.

- [ ] **Step 12: `useGameView`** — compose the selectors into one `GameView`. Test: given an engine state with an opponent, a 2-item stack, and your priority, `useGameView(state, { guided: true })` returns a `GameView` whose `opponents[0]`, `stack`, and `priority` match the per-selector expectations, and `guided === true`.

- [ ] **Step 13: Run all selector tests.** `cd frontend && npx vitest run tests/play/` → PASS.
- [ ] **Step 14: Checkpoint.**

---

## Tasks 3–13: Presentational components

Each component is prop-driven (consumes `GameView` slices, emits callbacks), no engine access, works at both desktop and mobile sizes via `playView.layout.ts` classes, and follows the approved spec mockups. For each: define the props interface from `gameView.types.ts`, implement the markup per the spec, and gate on `npx tsc --noEmit` + a render test (`@testing-library/react`) asserting the key behavior. Build them in this order (later ones compose earlier ones):

- [ ] **Task 3 — `PermanentTile`**: props `{ permanent: PermanentView; onAction(actionId), onExamine() }`. Renders art/name/PT/tapped/counters; tap → `ActionMenu` of `permanent.legalActions`; long-press/right-click → examine. Render test: clicking a tile surfaces its legal-action labels; examine never emits an action.
- [ ] **Task 4 — `ActionMenu`**: props `{ actions: LegalAction[]; onPick(id) }`. Lists exactly the actions; disabled ones (with `whyDisabled`) shown only in guided mode. Test: renders one row per action; picking emits its id.
- [ ] **Task 5 — `PlayerBoard`**: props `{ you: YouView; ... }`. Lands row + creatures row + other; composes `PermanentTile`. Test: renders the right counts per row.
- [ ] **Task 6 — `OpponentCard`** (collapsed glance): props `{ glance: OpponentGlance; onExplore() }`. Shows life, hand, **open mana (emphasized)**, threat, flags, `contextNote`; tap → `onExplore`. Test: open-mana 0 renders muted, >0 renders emphasized; tapping calls `onExplore`.
- [ ] **Task 7 — `OpponentExplorer`**: props `{ board: OpponentBoard; onClose() }`. Full board: creatures, lands (untapped count), other, graveyard/exile/command-zone chips. Desktop = dismissible overlay (normal-flow faux-viewport, never `position: fixed`), mobile = full-screen. Test: renders all zones; close emits.
- [ ] **Task 8 — `StackView`** (learning-grade): props `{ stack: StackItemView[]; guided: boolean; onRespond(), onLetResolve() }`. Top item flagged "resolves next"; each item shows title + plain-language description; empty state reads "stack is empty"; in guided mode shows the LIFO explanation line. Test: top item has the resolves-next marker; empty stack renders the empty message.
- [ ] **Task 9 — `HandView`**: props `{ hand: HandCardView[]; onAction(cardId, actionId) }`. Fanned (desktop) / swipe-up (mobile) via layout classes; tap a card → `ActionMenu`. Test: renders one card per hand entry.
- [ ] **Task 10 — `PriorityStrip`**: props `{ priority: PriorityContext; onPass(), onHold(), alwaysStop, onToggleAlwaysStop() }`. Shows phase + whether a response exists; pass/hold controls; the "nothing playable → auto-pass" hint + always-stop toggle. Test: with `hasMeaningfulResponse=false` and auto-pass, `onPass` is the offered default; always-stop toggle flips state.
- [ ] **Task 11 — `TargetingLayer`**: props `{ targeting: TargetingContext; onToggleTarget(id), onConfirm(), onCancel() }`. Highlights `legalTargetIds`, dims others, enables confirm only when selection count is in [min,max]. Test: confirm disabled below min, enabled within range.
- [ ] **Task 12 — `CombatFlow`**: props `{ combat: CombatContext; onAssign(a,b), onConfirm() }`. Guided sequence per `combat.step`; uses `eligibleIds`/`assignments`. Test: in `declare-attackers`, only eligible tiles are selectable; confirm emits the assignments.
- [ ] **Task 13 — `NarrationFeed`**: props `{ entries: NarrationEntry[] }`. Calm scrollable side-rail (desktop) / pull-up (mobile); newest last; never intercepts board clicks (no overlay over interactive area). Test: renders entries in order; container is `pointer-events` safe over the board (regression guard for the feed-blocking bug).

After each: `cd frontend && npx tsc --noEmit && npx vitest run tests/play/components/<name>.test.tsx` → PASS, then Checkpoint.

---

## Task 14: Layout shells

**Files:**
- Create: `frontend/src/play/playView.layout.ts`, `frontend/src/play/shells/DesktopBattlefield.tsx`, `frontend/src/play/shells/MobileTable.tsx`

- [ ] **Step 1:** `playView.layout.ts` — class constants per surface (rails, centered stack zone, hand dock, opponent strip) with the svh caps lesson from `gameBoardLayout.ts` carried over so nothing overlaps at zoom.
- [ ] **Step 2:** `DesktopBattlefield` — phase/priority left rail, `NarrationFeed` right rail, `OpponentCard` strip top, `StackView` centered, `PlayerBoard` main, `HandView` bottom. Props: a `GameView` + the callback bag.
- [ ] **Step 3:** `MobileTable` — opponents top strip, board fills, stack/priority bottom sheet (only when it's your decision), `HandView` swipe-up. Same components, same callbacks.
- [ ] **Step 4:** Render test each shell with a fixture `GameView` at the relevant viewport; assert all key regions present and the `NarrationFeed`/docks do not overlap the board's interactive layer.
- [ ] **Step 5: tsc + tests → PASS. Checkpoint.**

---

## Task 15: `PlayExperience` top level

**Files:**
- Create: `frontend/src/play/PlayExperience.tsx`

- [ ] **Step 1:** Wire `useShelectorGame()` → `useGameView(state, { guided })`. Own React state for: `guided` (from the start prompt), targeting selection, combat assignments, `alwaysStop`. Pick the shell by a viewport hook (≥1024px → Desktop, else Mobile). Route every component callback to the engine dispatch from `useShelectorGame` (the ONLY place actions are submitted).
- [ ] **Step 2:** Guided-play start prompt: before the first turn, show a "play guided?" choice that sets `guided`.
- [ ] **Step 3:** Test: a fixture game renders the correct shell per viewport; an `ActionMenu` pick dispatches the matching engine action exactly once; toggling guided flows into `useGameView`.
- [ ] **Step 4: tsc + tests → PASS. Checkpoint.**

---

## Task 16: Integration + no-dead-ends playthrough

**Files:**
- Modify: `frontend/src/pages/PlayPage.tsx` (mount `PlayExperience` behind a `?newui=1` flag / env flag, old `GameBoard` as fallback)
- Create: `frontend/tests/play/playthrough.test.ts` (extend `qaGameScenarios` harness)

- [ ] **Step 1:** Mount `PlayExperience` behind a flag so the old board remains until sign-off.
- [ ] **Step 2:** Scripted full-game playthrough test driving real engine actions through `useGameView` + the callback layer: assert at every priority window at least `pass` is offered (no-dead-ends invariant), the stack reflects pushes/resolves in LIFO order, and a full 1v1 game reaches a `winner` without an illegal-action error — run against both shell configs.
- [ ] **Step 3:** `cd frontend && npx vitest run tests/play/` → PASS. `cd frontend && npm run build` → PASS. Checkpoint.

---

## Task 17: Manual QA + deploy

- [ ] **Step 1:** chrome-devtools pass: launch a game at desktop (1440px) and mobile (390px) viewports; verify cast → target → respond, combat, opponent explore, guided narration, and that nothing overlaps the board. Capture issues as follow-up tasks.
- [ ] **Step 2:** Flip the flag default on once QA passes.
- [ ] **Step 3:** Deploy: `scp -q -r frontend/src deckreps-vps:/opt/deckreps/app/frontend/` then `ssh deckreps-vps "cd /opt/deckreps/app && docker compose build web && docker compose up -d web shelector"`. Confirm "Image Built" (not just health 200), then probe the live site.

---

## Verification summary

- View-model + selectors: pure, unit-tested (Task 2) — the legality/stack/priority logic.
- Components: tsc + render tests (Tasks 3–14) — props/behavior, incl. the feed-no-overlap regression guard.
- Whole-game: scripted playthrough asserting no-dead-ends + LIFO + reaches a winner on both shells (Task 16).
- Manual: chrome-devtools at desktop + mobile (Task 17).
- Engine untouched → no engine regression by construction.
