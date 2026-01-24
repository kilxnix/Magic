# Phase 5: Keywords — Implementation Plan

**Goal:** Implement core keyword rules natively in the engine so combat and interaction start matching real MTG.

**Phase 5 scope:**
- Keyword data model on `CardInstance`/computed from `CardDefinition.keywords`
- Combat-relevant keywords: **Flying, Reach, Trample, Deathtouch, First Strike, Double Strike, Lifelink, Vigilance, Haste, Menace, Defender**
- Interaction keywords (basic): **Hexproof, Shroud, Indestructible, Ward, Flash**

**Non-goals (later):** continuous effects/layers that grant/remove abilities, complex ward costs, protection, banding, etc.

---

## Task 1: Keyword Query Helpers

**Files:**
- Create: `engine/src/keywords.ts`
- Create: `engine/src/keywords.test.ts`

**Step 1: Write tests**
- `hasKeyword(def, 'Flying')` true/false
- `getKeywordsForInstance(state, instanceId)` returns keywords from definition (and later from continuous effects)

**Step 2: Implement `keywords.ts`**
- `export type Keyword = ...` (union of supported keywords)
- `export function hasKeyword(def: CardDefinition, keyword: Keyword): boolean`
- `export function getKeywordsForInstance(state: GameState, instanceId: string): Set<Keyword>`

**Run:**
```bash
cd engine && npx vitest run src/keywords.test.ts
```

**Commit:**
```bash
git add engine/src/keywords.ts engine/src/keywords.test.ts
git commit -m "feat(engine): add keyword helpers"
```

---

## Task 2: Update Target Validation for Hexproof/Shroud

**Files:**
- Modify: `engine/src/effects/targets.ts`
- Create: `engine/src/effects/targets-keywords.test.ts`

**Rules (v0):**
- `Shroud`: cannot be targeted by any spells/abilities
- `Hexproof`: cannot be targeted by opponents

**Step 1: Tests**
- Opponent cannot target your hexproof creature
- You can target your own hexproof creature
- Nobody can target shroud creature

**Step 2: Implementation**
- Extend `validateTargetChoices` to detect creature keywords via `getKeywordsForInstance`

**Commit:**
```bash
git add engine/src/effects/targets.ts engine/src/effects/targets-keywords.test.ts
git commit -m "feat(engine): enforce hexproof/shroud in target validation"
```

---

## Task 3: Update Combat Validation for Flying/Reach/Menace/Defender

**Files:**
- Modify: `engine/src/combat.ts`
- Modify: `engine/src/combat.test.ts`

**Rules (v0):**
- `Defender`: already prevents attacking; keep via keyword helpers
- `Flying`: can be blocked only by creatures with Flying or Reach
- `Reach`: can block Flying
- `Menace`: must be blocked by 2+ creatures if blocked at all (simplified: if exactly 1 blocker assigned, invalid)

**Step 1: Tests**
- Flying attacker cannot be blocked by non-flying/non-reach
- Reach creature can block flying
- Menace attacker rejects single-block assignment

**Step 2: Implementation**
- Update `canDeclareBlocker` and/or `declareBlockers` validation

**Commit:**
```bash
git add engine/src/combat.ts engine/src/combat.test.ts
git commit -m "feat(engine): combat keyword rules (flying/reach/menace/defender)"
```

---

## Task 4: Combat Damage Modifiers (Trample, Deathtouch, First/Double Strike)

**Files:**
- Modify: `engine/src/combat.ts`
- Create/Modify: `engine/src/combat-keywords.test.ts`

**Rules (v0, simplified but correct enough):**
- `Deathtouch`: any >0 damage from source is lethal to creature (SBA check treats it as lethal)
- `Trample`: excess damage to defending player when attacker is blocked
  - Simplify: assign lethal to first blocker then overflow to player
- `First Strike` / `Double Strike`:
  - Add first-strike damage step: creatures with First/Double strike deal damage first
  - In regular damage step: survivors deal damage; Double strike deals again

**Step 1: Tests**
- Trample 4/4 into 2/2 → blocker dies, defender takes 2
- Deathtouch 1/1 into 5/5 → 5/5 dies
- First strike creature kills before normal step

**Step 2: Implementation**
- Extend `resolveCombatDamage` to two-pass resolution
- Extend SBA check to incorporate deathtouch marks (store a `deathtouchDamageFrom: Set<sourceId>` or a boolean `hasDeathtouchDamage` on card during combat)

**Commit:**
```bash
git add engine/src/combat.ts engine/src/combat-keywords.test.ts engine/src/state-based.ts
# include state-based changes if needed

git commit -m "feat(engine): combat damage keywords (trample/deathtouch/first strike)"
```

---

## Task 5: Lifelink/Vigilance/Haste/Ward/Flash/Indestructible

**Files:**
- Modify: `engine/src/combat.ts`
- Modify: `engine/src/stack.ts`
- Modify: `engine/src/effects/executor.ts`
- Modify: `engine/src/state-based.ts`
- Create: `engine/src/keywords-integration.test.ts`

**Rules (v0):**
- `Lifelink`: damage dealt causes controller to gain that much life (combat + spell damage)
- `Vigilance`: attacking does not tap creature
- `Haste`: ignore summoning sickness for attacking
- `Flash`: already treated as keyword in casting (stack.ts uses `Flash`)
- `Ward`: if targeted by opponent spell, require additional generic mana payment (Phase 5 simplification: treat ward as `{1}` only and enforce via `castSpell` optional parameter `extraCostsPaid`)
- `Indestructible`: ignore "destroy" and lethal damage SBAs (does not die from damage)

**Step 1: Tests**
- Vigilance attacker remains untapped after declaring attackers
- Haste creature can attack the turn it enters
- Lifelink in combat increases controller life
- Destroy effect does nothing to indestructible creature

**Step 2: Implementation**
- Update `declareAttackers` to not tap vigilance attackers
- Update `canDeclareAttacker` for haste
- Update executor for lifelink on `DealDamage`
- Update SBAs to prevent lethal-damage death for indestructible
- Ward: wire a minimal check in `canCastSpell`/`castSpell` when targets chosen

**Commit:**
```bash
git add engine/src/*.ts engine/src/**/*.test.ts
git commit -m "feat(engine): implement core keyword rules"
```

---

## Acceptance Criteria (Phase 5 complete)

- ✅ Combat respects flying/reach/menace/defender.
- ✅ Trample, deathtouch, first/double strike work in simplified but consistent rules.
- ✅ Lifelink, vigilance, haste function in combat.
- ✅ Hexproof/shroud/ward prevent illegal targeting/casting.
- ✅ Indestructible prevents destroy/lethal damage death.
- ✅ `cd engine && npx vitest run` passes.
