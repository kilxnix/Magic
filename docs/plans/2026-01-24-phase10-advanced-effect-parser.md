# Phase 10: Effect Parser (Advanced) — Implementation Plan

**Goal:** Expand oracle parsing and effect execution coverage toward the “~94% of cards” target: modal choices, X costs, replacement effects, tokens, counters, and search.

**Depends on:** Phase 4 parser/executor + Phase 6 trigger engine.

---

## Task 1: Parser Architecture Upgrade (Composable Grammar)

**Files:**
- Modify: `engine/src/effects/tokens.ts`
- Modify: `engine/src/effects/parser.ts`
- Create: `engine/src/effects/grammar.ts`
- Create: `engine/src/effects/grammar.test.ts`

**Plan:**
- Introduce small composable matchers:
  - `matchNumber`, `matchTarget`, `matchClause`, `matchKeyword`
- Keep pattern priority but make it easier to add patterns.

**Commit:**
```bash
git add engine/src/effects/*
git commit -m "refactor(engine): introduce composable parser grammar helpers"
```

---

## Task 2: Modal Spells (“Choose one — …”)

**Files:**
- Modify: `engine/src/effects/ast.ts`
- Modify: `engine/src/effects/parser.ts`
- Modify: `engine/src/effects/executor.ts`
- Create: `engine/src/effects/modal.test.ts`

**AST:**
- Add `ModalEffect { kind: 'Modal'; modes: { label?: string; effects: Effect[]; targets: TargetSpec[] }[]; choose: number }`

**Execution:**
- Requires `StackItem.modeChoices` (store selected mode indices)

**Commit:**
```bash
git add engine/src/effects engine/src/stack.ts engine/src/effects/modal.test.ts
git commit -m "feat(engine): support modal spells (choose one)"
```

---

## Task 3: X Costs

**Files:**
- Modify: `engine/src/stack.ts`
- Modify: `engine/src/mana.ts`
- Modify: `engine/src/effects/ast.ts`
- Modify: `engine/src/effects/executor.ts`
- Create: `engine/src/effects/x-cost.integration.test.ts`

**Behavior:**
- When casting spells with `{X}` in cost, require `StackItem.xValue`
- Update cost payment to include chosen X
- Allow AST to reference `X` as amount

**Commit:**
```bash
git add engine/src/stack.ts engine/src/mana.ts engine/src/effects engine/src/effects/x-cost.integration.test.ts
git commit -m "feat(engine): support X costs"
```

---

## Task 4: Tokens + CreateToken Primitive

**Files:**
- Modify: `engine/src/effects/ast.ts`
- Modify: `engine/src/effects/executor.ts`
- Modify: `engine/src/game-state.ts`
- Create: `engine/src/effects/tokens-create.integration.test.ts`

**AST:**
- Add `CreateToken { kind: 'CreateToken'; controller: TargetRef; token: TokenDefinition; count: number }`

**Execution:**
- Add helper `createTokenInstance` that adds new `CardInstance` with synthetic `definitionId`.

**Commit:**
```bash
git add engine/src/effects engine/src/game-state.ts engine/src/effects/tokens-create.integration.test.ts
git commit -m "feat(engine): add token creation"
```

---

## Task 5: Counters + AddCounters Primitive

**Files:**
- Modify: `engine/src/effects/ast.ts`
- Modify: `engine/src/effects/executor.ts`
- Create: `engine/src/effects/counters.integration.test.ts`

**AST:**
- Add `AddCounters { kind: 'AddCounters'; target: TargetRef; counterType: string; count: number }`

**Commit:**
```bash
git add engine/src/effects engine/src/effects/counters.integration.test.ts
git commit -m "feat(engine): add counters effects"
```

---

## Task 6: Search Library / Tutor

**Files:**
- Modify: `engine/src/effects/ast.ts`
- Modify: `engine/src/effects/executor.ts`
- Create: `engine/src/effects/search.integration.test.ts`

**Behavior (v0):**
- `SearchLibrary(player, filter, toZone)` with deterministic selection for now (topmost matching) until UI support

**Commit:**
```bash
git add engine/src/effects engine/src/effects/search.integration.test.ts
git commit -m "feat(engine): add search library effect"
```

---

## Task 7: Replacement Effects (Skeleton)

**Files:**
- Create: `engine/src/replacements.ts`
- Modify: `engine/src/stack.ts`
- Modify: `engine/src/effects/parser.ts`
- Create: `engine/src/replacements.test.ts`

**Goal (Phase 10 minimal):**
- Represent a replacement effect and apply it for 1–2 patterns:
  - “If a creature would die, exile it instead.”

**Commit:**
```bash
git add engine/src/replacements.ts engine/src/replacements.test.ts engine/src/stack.ts

git commit -m "feat(engine): add replacement effect skeleton"
```

---

## Acceptance Criteria (Phase 10 complete)

- ✅ Modal spells supported with chosen modes stored on stack items.
- ✅ X costs supported for payment and effect amounts.
- ✅ Tokens and counters effects execute and are represented in state.
- ✅ Search library supported with deterministic placeholder selection (UI upgrade later).
- ✅ Replacement effects have a working minimal pipeline.
- ✅ `cd engine && npx vitest run` passes.
