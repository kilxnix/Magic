# Phase 8: Basic AI — Implementation Plan

**Goal:** Build a baseline AI that can play legal turns, cast spells, attack/block sensibly, and use simple removal.

**Phase 8 scope:**
- Legal action enumeration from a `GameState`
- Simple evaluation/scoring of actions
- Basic combat heuristics (favorable attacks/blocks)
- Basic targeting (prefer removing biggest threat)
- Difficulty tiers aligned with Commander brackets 1–5 (but only basic behaviors implemented here)

**Non-goals (later):** politics, bluffing, full personalities (Phase 11).

---

## Task 1: AI Interfaces + Action Model

**Files:**
- Create: `engine/src/ai/types.ts`
- Create: `engine/src/ai/types.test.ts`

**Design:**
- `export type AIAction = CastSpellAction | AttackAction | BlockAction | PassPriorityAction;`
- Include `targets: string[]` and any needed context.

**Commit:**
```bash
git add engine/src/ai/types.ts engine/src/ai/types.test.ts
git commit -m "feat(engine): add AI action types"
```

---

## Task 2: Legal Action Generation

**Files:**
- Create: `engine/src/ai/legal-actions.ts`
- Create: `engine/src/ai/legal-actions.test.ts`

**Requirements (v0):**
- If player has priority:
  - generate cast actions for castable spells in hand (using `canCastSpell`)
  - generate `PassPriority`
- During declare attackers/blockers steps:
  - generate attacker/blocker sets (bounded search: only consider up to N candidate creatures)

**Commit:**
```bash
git add engine/src/ai/legal-actions.ts engine/src/ai/legal-actions.test.ts
git commit -m "feat(engine): generate legal actions for AI"
```

---

## Task 3: Heuristic Evaluator

**Files:**
- Create: `engine/src/ai/evaluate.ts`
- Create: `engine/src/ai/evaluate.test.ts`

**Heuristics (v0):**
- Prefer using mana (cast on curve)
- Prefer removing higher power/toughness threats
- Prefer attacks where attacker survives and defender takes damage
- Prefer blocks that trade up

**Commit:**
```bash
git add engine/src/ai/evaluate.ts engine/src/ai/evaluate.test.ts
git commit -m "feat(engine): add basic AI heuristic evaluator"
```

---

## Task 4: Target Selection Helpers

**Files:**
- Create: `engine/src/ai/targeting.ts`
- Create: `engine/src/ai/targeting.test.ts`

**Behavior:**
- Given a `TargetSpec[]`, pick legal targets based on heuristics:
  - removal: highest power/toughness or keyword threat
  - damage: prefer players near death or creatures that die

**Commit:**
```bash
git add engine/src/ai/targeting.ts engine/src/ai/targeting.test.ts
git commit -m "feat(engine): add AI target selection helpers"
```

---

## Task 5: Decision Loop Integration

**Files:**
- Create: `engine/src/ai/agent.ts`
- Modify: `engine/src/turn-manager.ts` (or wherever priority loop lives)
- Create: `engine/src/ai/integration.test.ts`

**Behavior:**
- When it’s an AI player’s priority:
  - enumerate legal actions
  - score them
  - choose the best
  - apply it using existing engine functions (castSpell/declareAttackers/declareBlockers)

**Commit:**
```bash
git add engine/src/ai/agent.ts engine/src/ai/integration.test.ts
git commit -m "feat(engine): integrate basic AI decisions into priority loop"
```

---

## Task 6: Difficulty Tiers (Bracket Mapping)

**Files:**
- Modify: `engine/src/ai/agent.ts`
- Create: `engine/src/ai/difficulty.test.ts`

**Behavior:**
- Bracket 1–2: random-ish among decent actions, no holding interaction
- Bracket 3: prefer removal on biggest threat
- Bracket 4–5: (placeholder) add minor lookahead and “hold removal if no good target”

**Commit:**
```bash
git add engine/src/ai/agent.ts engine/src/ai/difficulty.test.ts
git commit -m "feat(engine): add AI difficulty tiers"
```

---

## Acceptance Criteria (Phase 8 complete)

- ✅ AI can complete turns without illegal actions.
- ✅ AI casts spells and selects targets legally.
- ✅ AI attacks/blocks with basic favorable heuristics.
- ✅ Difficulty tiers change behavior in observable ways.
- ✅ `cd engine && npx vitest run` passes.
