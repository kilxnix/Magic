# Table-First Game Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the floating board into a table-first layout where the battlefield gets the center of the screen and hand/actions sit on slim edge bars.

**Architecture:** Keep all game state and card interaction behavior unchanged. Use `frontend/src/lib/gameBoardLayout.ts` as a small tested layout contract, then apply those classes in `frontend/src/components/GameBoard.tsx`.

**Tech Stack:** React, TypeScript, Tailwind utility classes, Vitest.

---

### Task 1: Layout Contract

**Files:**
- Modify: `frontend/src/lib/gameBoardLayout.ts`
- Modify: `frontend/tests/gameBoardLayout.test.ts`

- [ ] Add tested class contracts for `table`, `opponentStrip`, `actionsDock`, and `handDock`.
- [ ] Verify the test fails before implementing those new keys.
- [ ] Add the constants.
- [ ] Verify the test passes.

### Task 2: GameBoard Table Layout

**Files:**
- Modify: `frontend/src/components/GameBoard.tsx`

- [ ] Import `FLOATING_TABLE_LAYOUT`.
- [ ] Reduce shell bottom padding from the old large tray size to a compact dock size.
- [ ] Collapse the opponent hand from always-visible card tiles to a compact text/status strip.
- [ ] Keep opponent battlefield visible as a compact strip.
- [ ] Move actions to a slim command bar just above the hand dock.
- [ ] Shrink the hand dock and card tiles so it is roughly one card tall.
- [ ] Move last-played into a small edge toast instead of the table center.

### Task 3: Verification

**Files:**
- Existing test files.

- [ ] Run focused Vitest suite.
- [ ] Run `npm run build`.
- [ ] Check `/play` returns HTTP 200.
