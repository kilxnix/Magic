# Phase 6: Triggers + Expanded SBAs — Implementation Plan

**Goal:** Add a real triggered ability engine + broaden state-based actions so the game loop matches MTG’s “SBA → triggers → stack” cadence.

**Phase 6 scope:**
- Trigger representation in `GameState`
- Trigger detection and queueing in APNAP order
- Putting triggered abilities on the stack as `StackItem` entries
- Expanded SBAs:
  - Creature toughness ≤ 0 dies (requires counters/modifiers later; for now just damage + base toughness)
  - Player loses on draw from empty library
  - Legend rule (two+ legendary permanents with same name controlled by same player)
  - +1/+1 and -1/-1 counters cancel (introduce counters model)

**Depends on:** Phase 4 effect system (TriggeredAbility AST + executor)

---

## Task 1: Trigger Data Model on GameState

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/game-state.ts`
- Create: `engine/src/triggers.test.ts`

**Step 1: Tests**
- `GameState` contains:
  - `battlefieldAbilities: Map<string, TriggeredAbility[]>` (instanceId → abilities)
  - `pendingTriggers: TriggeredOnStack[]` (queue)

**Step 2: Types**
Add:
- `export interface TriggeredOnStack { id: string; controllerId: string; sourceInstanceId: string; ability: TriggeredAbility; chosenTargets: string[] }`

**Commit:**
```bash
git add engine/src/types.ts engine/src/game-state.ts engine/src/triggers.test.ts
git commit -m "feat(engine): add GameState trigger storage and pending trigger queue"
```

---

## Task 2: Register ETB Abilities When Permanents Enter

**Files:**
- Modify: `engine/src/stack.ts`
- Modify: `engine/src/effects/parser.ts`
- Create: `engine/src/etb-registration.integration.test.ts`

**Behavior:**
- When a permanent resolves onto battlefield:
  - parse oracle text (or override) for ETB triggered abilities
  - store them in `battlefieldAbilities` keyed by the permanent’s instanceId

**Tests:**
- A permanent with `When ~ enters the battlefield, draw a card.` has its ability registered

**Commit:**
```bash
git add engine/src/stack.ts engine/src/etb-registration.integration.test.ts
git commit -m "feat(engine): register ETB triggered abilities on battlefield permanents"
```

---

## Task 3: Event Bus + Trigger Detection

**Files:**
- Create: `engine/src/events.ts`
- Create: `engine/src/triggers.ts`
- Create: `engine/src/triggers.integration.test.ts`

**Event model (v0):**
- `PermanentEntersBattlefield { permanentId, controllerId }`
- (future) `CreatureDies`, `SpellCast`, etc.

**Trigger detection:**
- `collectTriggers(state, event): TriggeredOnStack[]`
- Only ETB triggers in Phase 6

**APNAP ordering:**
- When an event occurs, triggers are gathered and queued in:
  - Active player’s triggers, then next player clockwise, etc.

**Tests:**
- In multiplayer, triggers from different players are queued APNAP

**Commit:**
```bash
git add engine/src/events.ts engine/src/triggers.ts engine/src/triggers.integration.test.ts
git commit -m "feat(engine): add trigger detection and APNAP ordering"
```

---

## Task 4: Put Pending Triggers on the Stack

**Files:**
- Modify: `engine/src/stack.ts`
- Modify: `engine/src/types.ts`
- Create: `engine/src/trigger-stack.integration.test.ts`

**Behavior:**
- After a spell/permanent resolves, engine does:
  1) `checkStateBasedActions`
  2) detect triggers created by the resolution/event
  3) push triggered abilities onto stack as stack items (new kind)

**StackItem update:**
- Extend `StackItem` to support:
  - `kind: 'Spell' | 'TriggeredAbility'`
  - For triggered abilities: store `ability` and `sourceInstanceId`

**Resolution:**
- When resolving a triggered ability item, execute its effects via executor

**Tests:**
- ETB draw ability is put on stack and resolves after permanent enters

**Commit:**
```bash
git add engine/src/types.ts engine/src/stack.ts engine/src/trigger-stack.integration.test.ts
git commit -m "feat(engine): put triggered abilities on stack and resolve them"
```

---

## Task 5: Expanded SBAs — Legend Rule + Empty Library Loss

**Files:**
- Modify: `engine/src/state-based.ts`
- Create: `engine/src/state-based.legend.test.ts`

**Rules (v0):**
- **Legend rule:** if a player controls 2+ legendary permanents with the same name, that player chooses one to keep, others go to graveyard.
  - For Phase 6: implement as deterministic default (keep the first), plus a TODO for UI choice.
- **Empty library loss:** if a player attempts to draw with 0 cards in library, they lose.
  - Implement in `drawCards` helper used by executor.

**Commit:**
```bash
git add engine/src/state-based.ts engine/src/state-based.legend.test.ts engine/src/effects/executor.ts
git commit -m "feat(engine): expanded SBAs (legend rule, empty library loss)"
```

---

## Task 6: Counters Model + +1/+1 and -1/-1 Cancellation

**Files:**
- Modify: `engine/src/types.ts`
- Modify: `engine/src/state-based.ts`
- Create: `engine/src/counters.test.ts`

**Data model:**
- Add `counters: Record<string, number>` on `CardInstance` (keys: `'+1/+1'`, `'-1/-1'`, etc.)

**SBA:**
- If a creature has both +1/+1 and -1/-1 counters, cancel them pairwise.

**Tests:**
- Creature with +2/+2 and -1/-1 ends with +1/+1

**Commit:**
```bash
git add engine/src/types.ts engine/src/state-based.ts engine/src/counters.test.ts
git commit -m "feat(engine): add counters model and cancel +1/+1/-1/-1"
```

---

## Acceptance Criteria (Phase 6 complete)

- ✅ Permanents can have ETB triggers registered and fired via the stack.
- ✅ Trigger ordering follows APNAP in multiplayer.
- ✅ Stack can contain both spells and triggered abilities, and both resolve through the executor.
- ✅ SBAs include empty-library loss and legend rule (deterministic placeholder choice).
- ✅ +1/+1 and -1/-1 counters cancel as an SBA.
- ✅ `cd engine && npx vitest run` passes.
