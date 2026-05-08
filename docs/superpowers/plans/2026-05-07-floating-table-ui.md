# Floating Table UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the web PWA game screen into a compact floating tabletop layout.

**Architecture:** Keep existing game state and action plumbing unchanged. Change only the React layout shells in `PlayPage.tsx` and `GameBoard.tsx`, plus a tiny testable layout contract helper so the floating-mode class names are covered by unit tests.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest.

---

### Task 1: Layout Contract Helper

**Files:**
- Create: `frontend/src/lib/gameBoardLayout.ts`
- Create: `frontend/tests/gameBoardLayout.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/tests/gameBoardLayout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FLOATING_TABLE_LAYOUT } from '../src/lib/gameBoardLayout';

describe('FLOATING_TABLE_LAYOUT', () => {
  it('keeps permanent game chrome floating instead of reserving side rails', () => {
    expect(FLOATING_TABLE_LAYOUT.shell).toContain('overflow-hidden');
    expect(FLOATING_TABLE_LAYOUT.reviewButton).toContain('fixed');
    expect(FLOATING_TABLE_LAYOUT.reviewRail).toContain('hidden');
    expect(FLOATING_TABLE_LAYOUT.board).toContain('flex-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd frontend
..\engine\node_modules\.bin\vitest.cmd run tests\gameBoardLayout.test.ts --root .
```

Expected: fail because `frontend/src/lib/gameBoardLayout.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/gameBoardLayout.ts`:

```ts
export const FLOATING_TABLE_LAYOUT = {
  shell: 'h-screen bg-stone-950 text-stone-100 flex flex-col overflow-hidden',
  board: 'flex-1 min-h-0 min-w-0',
  reviewButton: 'fixed right-4 top-4 z-40',
  reviewRail: 'hidden',
} as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run the same Vitest command. Expected: pass.

### Task 2: Remove Reserved Review Rail

**Files:**
- Modify: `frontend/src/pages/PlayPage.tsx:379-444`

- [ ] **Step 1: Use the layout helper**

Import `FLOATING_TABLE_LAYOUT` and replace the game shell classes. Remove the persistent `aside` that embeds `GameReview`, and leave `GameReview` as the modal opened by the floating Review button.

- [ ] **Step 2: Verify route still renders**

Run:

```bash
Invoke-WebRequest -Uri 'http://127.0.0.1:5173/play' -UseBasicParsing -TimeoutSec 15
```

Expected: HTTP status 200.

### Task 3: Compact GameBoard Chrome

**Files:**
- Modify: `frontend/src/components/GameBoard.tsx:912-1455`

- [ ] **Step 1: Remove the fixed left rail**

Delete or hide the `xl:flex w-52` rail. Move essential player status into compact floating chips inside the main board shell.

- [ ] **Step 2: Convert phase bar to a floating top strip**

Change the phase bar classes from a full-width static row into an absolutely positioned strip with smaller padding.

- [ ] **Step 3: Make opponent area compact**

Reduce opponent section padding and minimum heights, keep hand/battlefield horizontal scrolling, and remove the extra centered last-played band.

- [ ] **Step 4: Make hand/actions bottom docks**

Use compact `absolute bottom-0` docks with horizontal scrolling. Preserve the mulligan and action buttons.

### Task 4: Verification

**Files:**
- Existing tests only.

- [ ] **Step 1: Run focused tests**

```bash
cd frontend
..\engine\node_modules\.bin\vitest.cmd run tests\gameBoardLayout.test.ts tests\standardPlayDeck.test.ts tests\deckUrlImport.test.ts tests\standardDeckImport.test.ts --root .
```

Expected: all tests pass.

- [ ] **Step 2: Build**

```bash
cd frontend
npm run build
```

Expected: TypeScript and Vite build succeed.

- [ ] **Step 3: Check `/play`**

```bash
Invoke-WebRequest -Uri 'http://127.0.0.1:5173/play' -UseBasicParsing -TimeoutSec 15
```

Expected: HTTP status 200.
