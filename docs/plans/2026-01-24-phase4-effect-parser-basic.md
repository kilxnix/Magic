# Phase 4: Effect Parser (Basic) — Implementation Plan

**Goal:** Start the “real” oracle-text effect system: tokenize → parse → typed AST → target validation → execute effects during stack resolution.

**Phase 4 scope (basic, architecturally correct):**
- Parser pipeline and a typed AST for *spells and triggered abilities*.
- A small set of primitives + targeting:
  - **Draw**
  - **Destroy**
  - **DealDamage** ("any target" + creature/player)
  - (Optional if time allows) **GainLife / LoseLife**
- **ETB triggered ability parsing** ("When/Whenever ~ enters the battlefield, …")
- **Manual overrides registry** for complex or messy oracle text
- **Integration into stack resolution**:
  - Instants/sorceries resolve by executing parsed/overridden effects, then go to graveyard.
  - Permanents resolve by entering battlefield (as today). For Phase 4 we parse ETB abilities but do **not** require a full trigger engine yet.

**Non-goals (later phases):**
- Modal spells, X costs, replacement effects, continuous effects/layers
- Full trigger engine firing in APNAP order

**Tech:** TypeScript, Vitest. Builds on Phase 1–3 (`stack.ts`, `state-based.ts`, combat).

---

## Architecture Decisions (Phase 4)

### 1) New module layout
Create a new folder:

- `engine/src/effects/`
  - `tokens.ts` — tokenizer output
  - `ast.ts` — AST node types
  - `parser.ts` — parse oracle_text → AST/effect list
  - `targets.ts` — target specs + validation helpers
  - `executor.ts` — execute effects against `GameState`
  - `overrides.ts` — manual overrides registry

### 2) AST model (v0)
We want a *declarative* tree we can execute.

- **Spell**: `Effect[]`
- **Triggered ability**: `{ trigger, effects }`

Core nodes:
- `Draw(playerRef, count)`
- `Destroy(targetRef)`
- `DealDamage(sourceRef?, targetRef, amount)`

### 3) Targeting model (v0)
We keep targeting simple and compatible with `StackItem.targets: string[]` that already exists.

- Parser produces a list of required `TargetSpec[]` in order (stable IDs).
- When casting, caller supplies `targets: string[]` in the same order.
- Validation ensures:
  - each chosen id exists in `state.cards` or `state.players`
  - matches creature/player/any
  - meets basic constraints ("an opponent controls")

### 4) Integration point
Extend `resolveTopOfStack` in `engine/src/stack.ts`:

- For **instants/sorceries**:
  1) Determine effects: override > parse oracle_text
  2) Validate targets against `topItem.targets`
  3) Execute effects
  4) Move spell to graveyard (already happens)
  5) Run `checkStateBasedActions` after resolution (so lethal damage kills creatures)

- For **permanents**: keep existing placement onto battlefield.

---

## Task 1: Create Effect System Types (AST + Target Specs)

**Files:**
- Create: `engine/src/effects/ast.ts`
- Create: `engine/src/effects/targets.ts`
- Create: `engine/src/effects/ast.test.ts`

**Step 1: Write tests (typing + simple runtime assertions)** (`engine/src/effects/ast.test.ts`)
- Construct a `DealDamage` effect with a `TargetRef`.
- Construct a `TriggeredAbility` ETB node.

**Step 2: Implement `ast.ts`**
Define:
- `export type Effect = DrawEffect | DestroyEffect | DealDamageEffect | GainLifeEffect | LoseLifeEffect;`
- `export interface DrawEffect { kind: 'Draw'; player: TargetRef; count: number }`
- `export interface DestroyEffect { kind: 'Destroy'; target: TargetRef }`
- `export interface DealDamageEffect { kind: 'DealDamage'; source?: SourceRef; target: TargetRef; amount: number }`
- `export interface TriggeredAbility { kind: 'TriggeredAbility'; trigger: Trigger; effects: Effect[] }`
- `export type Trigger = { kind: 'ETB'; who: 'self' | 'any' | 'controller' }`

Target references:
- `export type TargetRef = { kind: 'Chosen'; targetId: string } | { kind: 'Controller' } | { kind: 'Player'; playerId: string }`
- `export type SourceRef = { kind: 'ThisSpell' } | { kind: 'ThisPermanent' }`

**Step 3: Implement `targets.ts`**
Define:
- `export type TargetType = 'Creature' | 'Player' | 'Any'`
- `export interface TargetSpec { id: string; type: TargetType; count: number; constraints?: { opponentControls?: boolean } }`
- `export function validateTargetChoices(state: GameState, casterId: string, specs: TargetSpec[], chosenIds: string[]): void` (throws on invalid)

**Step 4: Run tests**
```bash
cd engine && npx vitest run src/effects/ast.test.ts
```

**Step 5: Commit**
```bash
git add engine/src/effects/ast.ts engine/src/effects/targets.ts engine/src/effects/ast.test.ts
git commit -m "feat(engine): add effects AST and target specs"
```

---

## Task 2: Tokenizer (oracle_text → tokens)

**Files:**
- Create: `engine/src/effects/tokens.ts`
- Create: `engine/src/effects/tokens.test.ts`

**Tokenizer requirements (v0):**
- Lowercase normalization (preserve numbers)
- Split punctuation, parentheses, em-dashes
- Preserve `{G}` / `{1}{R}` chunks as tokens
- Preserve commas for clause splitting

**Tests:**
- `Lightning Bolt deals 3 damage to any target.`
- `Destroy target creature an opponent controls.`
- `When ~ enters the battlefield, draw a card.`

**Run:**
```bash
cd engine && npx vitest run src/effects/tokens.test.ts
```

**Commit:**
```bash
git add engine/src/effects/tokens.ts engine/src/effects/tokens.test.ts
git commit -m "feat(engine): add oracle text tokenizer"
```

---

## Task 3: Parser v0 (tokens → AST + required targets)

**Files:**
- Create: `engine/src/effects/parser.ts`
- Create: `engine/src/effects/parser.test.ts`

**Parser output (v0):**
```ts
export type ParsedOracle =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[] }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] };
```

**Supported patterns (ordered):**

1) Deal damage
- `~ deals N damage to any target.`
- `~ deals N damage to target creature.`
- `~ deals N damage to target player.`

2) Destroy
- `destroy target creature`
- `destroy target creature an opponent controls`

3) Draw
- `draw a card`
- `draw N cards`

4) ETB wrapper
- `when ~ enters the battlefield, <effect-clause>`
- `whenever ~ enters the battlefield, <effect-clause>`

**Testing:**
- Golden tests: oracle_text → JSON (stable snapshot-ish)

**Run:**
```bash
cd engine && npx vitest run src/effects/parser.test.ts
```

**Commit:**
```bash
git add engine/src/effects/parser.ts engine/src/effects/parser.test.ts
git commit -m "feat(engine): parse basic oracle patterns into effect AST"
```

---

## Task 4: Overrides registry

**Files:**
- Create: `engine/src/effects/overrides.ts`
- Create: `engine/src/effects/overrides.test.ts`

**Requirements:**
- Lookup by `definitionId` (preferred) with optional fallback by `card name`
- Override can supply:
  - `{ kind: 'Spell', effects, targets }`
  - `{ kind: 'ETB', ability, targets }`

**Tests:**
- Register an override and ensure lookup works
- Ensure missing override returns null

**Commit:**
```bash
git add engine/src/effects/overrides.ts engine/src/effects/overrides.test.ts
git commit -m "feat(engine): add effect overrides registry"
```

---

## Task 5: Effect executor (AST → GameState transitions)

**Files:**
- Create: `engine/src/effects/executor.ts`
- Create: `engine/src/effects/executor.test.ts`

**Executor responsibilities (v0):**
- `Draw`: move N cards from library to hand
- `Destroy`: move creature/permanent to graveyard
- `DealDamage`:
  - creature → increment `CardInstance.damage`
  - player → decrement `Player.life`
- Call `checkStateBasedActions` after executing a top-level spell’s effect list

**Tests:**
- Draw effect draws from top of library
- Destroy moves a battlefield creature to graveyard
- Damage marks damage and SBA kills creature if lethal
- Damage to player reduces life

**Commit:**
```bash
git add engine/src/effects/executor.ts engine/src/effects/executor.test.ts
git commit -m "feat(engine): execute basic effects (draw/destroy/damage)"
```

---

## Task 6: Integrate effect resolution into stack

**Files:**
- Modify: `engine/src/stack.ts`
- Create/Modify: `engine/src/stack-effects.integration.test.ts`

**Behavior:**
- When resolving an instant/sorcery:
  - determine effect definition: override > parse oracle_text
  - validate required targets using `topItem.targets`
  - execute effects
  - move spell to graveyard (existing)
  - run SBAs after effects

**Integration tests:**
- Cast Lightning Bolt targeting a creature → creature takes damage; if lethal, dies after resolution
- Cast `Destroy target creature` targeting a creature → creature in graveyard after resolution

**Commit:**
```bash
git add engine/src/stack.ts engine/src/stack-effects.integration.test.ts
git commit -m "feat(engine): resolve instant/sorcery effects during stack resolution"
```

---

## Task 7: Barrel exports

**Files:**
- Modify: `engine/src/index.ts`

Add:
```ts
export * from './effects/ast';
export * from './effects/parser';
export * from './effects/executor';
export * from './effects/targets';
export * from './effects/overrides';
```

**Run:**
```bash
cd engine && npx tsc --noEmit && npx vitest run
```

**Commit:**
```bash
git add engine/src/index.ts
git commit -m "feat(engine): export effects modules"
```

---

## Acceptance Criteria (Phase 4 complete)

- ✅ `cd engine && npx vitest run` passes.
- ✅ Spells like **Lightning Bolt** and **Destroy target creature** can be parsed OR overridden and executed.
- ✅ Target validation rejects illegal targets.
- ✅ Damage to creatures can cause death via SBAs after spell resolution.
- ✅ ETB parsing produces a `TriggeredAbility` node (firing triggers will be Phase 6).
