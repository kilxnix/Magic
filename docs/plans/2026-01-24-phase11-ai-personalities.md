# Phase 11: AI Personalities — Implementation Plan

**Goal:** Add distinct AI personalities and difficulty levels (Commander brackets 1–5) including threat assessment, politics-lite, and grudges.

**Depends on:** Phase 8 basic AI.

---

## Task 1: Personality Profiles

**Files:**
- Modify: `engine/src/ai/types.ts`
- Create: `engine/src/ai/personalities.ts`
- Create: `engine/src/ai/personalities.test.ts`

**Profiles:**
- Aggressive
- Greedy
- Political
- Balanced

Each profile defines weights:
- board development vs interaction
- attack aggressiveness
- removal eagerness
- grudges/retaliation bias

**Commit:**
```bash
git add engine/src/ai/personalities.ts engine/src/ai/personalities.test.ts engine/src/ai/types.ts
git commit -m "feat(engine): add AI personality profiles"
```

---

## Task 2: Threat Assessment Model

**Files:**
- Create: `engine/src/ai/threat.ts`
- Create: `engine/src/ai/threat.test.ts`

**Heuristics (v0):**
- high life + large board + commander damage dealt + cards in hand (if visible) → higher threat
- focus on archenemy when obvious

**Commit:**
```bash
git add engine/src/ai/threat.ts engine/src/ai/threat.test.ts
git commit -m "feat(engine): add threat assessment"
```

---

## Task 3: Politics-lite + Grudge Tracking

**Files:**
- Modify: `engine/src/types.ts`
- Create: `engine/src/ai/grudges.ts`
- Create: `engine/src/ai/grudges.test.ts`

**State:**
- Track recent damage sources per player:
  - `recentAttacks: { attackerId, defenderId, turnNumber }[]`

**Behavior:**
- Political AI spreads attacks unless someone is threat/has hurt it
- Grudges bias target selection toward players who attacked you recently

**Commit:**
```bash
git add engine/src/types.ts engine/src/ai/grudges.ts engine/src/ai/grudges.test.ts
git commit -m "feat(engine): add grudge tracking and politics heuristics"
```

---

## Task 4: Difficulty Tiers 1–5 (Behavior Differences)

**Files:**
- Modify: `engine/src/ai/agent.ts`
- Create: `engine/src/ai/difficulty-advanced.test.ts`

**Implementation ideas:**
- Tier 1–2: noisy action selection, poor threat eval, no holding interaction
- Tier 3: targets biggest threat, basic sequencing
- Tier 4: holds removal/counters more, avoids bad attacks, can “sandbag”
- Tier 5: limited lookahead (simulate 1 ply with opponent response approximations)

**Commit:**
```bash
git add engine/src/ai/agent.ts engine/src/ai/difficulty-advanced.test.ts
git commit -m "feat(engine): expand AI difficulty behaviors and limited lookahead"
```

---

## Task 5: Multiplayer Target Selection Integration

**Files:**
- Modify: `engine/src/ai/targeting.ts`
- Create: `engine/src/ai/multiplayer.integration.test.ts`

**Behavior:**
- Removal targets archenemy at higher tiers
- Aggressive AI prioritizes weakest player for lethal when possible
- Political AI avoids focusing one player early

**Commit:**
```bash
git add engine/src/ai/targeting.ts engine/src/ai/multiplayer.integration.test.ts
git commit -m "feat(engine): multiplayer targeting with threat/politics"
```

---

## Acceptance Criteria (Phase 11 complete)

- ✅ Personalities produce noticeably different play styles.
- ✅ Threat assessment influences removal/attack decisions.
- ✅ Grudges and retaliation work without breaking legality.
- ✅ Difficulty tiers 1–5 change mistake rate and strategic depth.
- ✅ `cd engine && npx vitest run` passes.
