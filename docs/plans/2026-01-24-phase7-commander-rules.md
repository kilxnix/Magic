# Phase 7: Commander Rules — Implementation Plan

**Goal:** Implement Commander-specific rules (command zone, tax, commander damage, replacement on death/exile) for 2–4 player games.

**Phase 7 scope:**
- Command zone support per player
- Casting commander from command zone with increasing tax
- Commander damage tracking per opponent per commander
- Replacement choice when commander would change zones (die/exile): allow command zone move
- Multiplayer turn order + priority already exist; ensure commander-specific state is wired cleanly

---

## Task 1: GameState Commander Metadata

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/game-state.ts`
- Create: `engine/src/commander/commander-state.test.ts`

**Add to PlayerState:**
- `commanderInstanceId: string`
- `commanderCastCount: number`

**Add to GameState:**
- `commanderDamage: Record<string, Record<string, number>>`
  - `commanderDamage[attackerCommanderInstanceId][defendingPlayerId] = total`

**Tests:**
- initGameState populates commander instance id and initializes matrices

**Commit:**
```bash
git add engine/src/types.ts engine/src/game-state.ts engine/src/commander/commander-state.test.ts
git commit -m "feat(engine): add commander state (tax and commander damage matrix)"
```

---

## Task 2: Command Zone as a Real Zone

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/game-state.ts`
- Modify: `engine/src/zones.ts` (or create if zones helpers don’t exist yet)
- Create: `engine/src/commander/command-zone.test.ts`

**Behavior:**
- Add `zone: 'command'` to `Zone` union
- Ensure `getCardsInZone` supports command zone
- Ensure commander starts in command zone (or library with special handling; pick one and stay consistent)

**Commit:**
```bash
git add engine/src/types.ts engine/src/game-state.ts engine/src/commander/command-zone.test.ts
git commit -m "feat(engine): add command zone"
```

---

## Task 3: Casting Commander from Command Zone + Tax

**Files:**
- Modify: `engine/src/stack.ts`
- Modify: `engine/src/mana.ts`
- Create: `engine/src/commander/commander-tax.integration.test.ts`

**Rules:**
- Commander can be cast from command zone.
- Additional cost: `{2}` generic per previous time you cast that commander.

**Implementation approach (v0):**
- Extend `canCastSpell` to allow `zone === 'command'` for commander instance.
- Compute total cost = printed mana cost + `{2} * commanderCastCount`.
- On successful `castSpell`, if casting commander from command zone:
  - increment `commanderCastCount` for that player

**Commit:**
```bash
git add engine/src/stack.ts engine/src/commander/commander-tax.integration.test.ts
git commit -m "feat(engine): support casting commander from command zone with tax"
```

---

## Task 4: Commander Replacement on Zone Change (Death/Exile)

**Files:**
- Modify: `engine/src/state-based.ts`
- Modify: `engine/src/effects/executor.ts`
- Create: `engine/src/commander/replacement.test.ts`

**Rules (v0):**
- If commander would go to graveyard or exile, its owner may move it to command zone instead.

**Implementation (Phase 7 simplification):**
- Implement deterministic choice:
  - default to command zone (until UI exists)
  - add TODO hooks for UI choice later

**Tests:**
- Destroying a commander results in command zone placement

**Commit:**
```bash
git add engine/src/state-based.ts engine/src/effects/executor.ts engine/src/commander/replacement.test.ts
git commit -m "feat(engine): commander replacement to command zone on death/exile"
```

---

## Task 5: Track Commander Damage from Combat

**Files:**
- Modify: `engine/src/combat.ts`
- Modify: `engine/src/state-based.ts`
- Create: `engine/src/commander/commander-damage.integration.test.ts`

**Rules:**
- If a commander deals combat damage to a player, track it per commander.
- If a player has 21+ commander damage from the same commander, they lose (SBA).

**Implementation:**
- In `resolveCombatDamage`, when an unblocked attacker hits a player:
  - if attacker is that player’s commander instance OR is marked `isCommander` on CardInstance, update matrix
- In SBAs, mark player lost when threshold met

**Commit:**
```bash
git add engine/src/combat.ts engine/src/state-based.ts engine/src/commander/commander-damage.integration.test.ts
git commit -m "feat(engine): track commander damage and 21-damage loss condition"
```

---

## Acceptance Criteria (Phase 7 complete)

- ✅ Command zone exists and is queryable.
- ✅ Commanders can be cast from command zone with correct tax.
- ✅ Commanders can be moved to command zone on death/exile (deterministic placeholder).
- ✅ Commander combat damage is tracked and 21+ causes loss via SBAs.
- ✅ Multiplayer still functions and tests pass.
