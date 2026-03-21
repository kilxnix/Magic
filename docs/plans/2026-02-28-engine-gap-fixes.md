# Engine Gap Fixes — Make Implemented Phases Fully Functional

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix functional gaps in the engine so all 13 implemented phases actually work end-to-end during gameplay.

**Architecture:** The engine has 590 passing tests but several features are parsed/defined without being wired into resolution. We fix: modal spell resolution, first strike damage steps, "dies" triggers, and replacement effect integration. Each fix is isolated — no cascading dependencies between tasks.

**Tech Stack:** TypeScript, Vitest, immutable state pattern (spread operators on GameState)

---

### Task 1: Modal Spell Resolution

The parser correctly detects "Choose one —" / "Choose two —" and builds a `ModalSpell` AST, but `resolveTopOfStack()` in `stack.ts` has no handling for `kind: 'Modal'` — these spells resolve as "unparsed" (no effect).

**Files:**
- Modify: `engine/src/stack.ts:298-317` (spell resolution for non-permanents)
- Modify: `engine/src/types.ts` (add `chosenModes` to `SpellStackItem`)
- Test: `engine/src/stack.test.ts`

**Step 1: Write the failing test**

Add to `engine/src/stack.test.ts`:

```typescript
describe('modal spell resolution', () => {
  it('should resolve a modal spell by executing the chosen mode effects', () => {
    // Create a "Choose one" spell with two modes:
    // Mode 1: Deal 3 damage to target creature
    // Mode 2: Draw a card
    const modalSpellDef: CardDefinition = {
      id: 'modal-spell',
      name: 'Modal Test Spell',
      type_line: 'Instant',
      oracle_text: 'Choose one —\n• ~ deals 3 damage to target creature.\n• Draw a card.',
      mana_cost: '{R}',
      cmc: 1,
      colors: ['R'],
      color_identity: ['R'],
      keywords: [],
      card_types: ['instant'],
    };

    // Set up state with the modal spell on the stack, choosing mode 0 (deal damage)
    // Cast with chosenModes: [0] to select the first mode
    const state = createTestState();
    state.cardDefinitions.set('modal-spell', modalSpellDef);

    const spellInstance: CardInstance = {
      instanceId: 'modal-inst',
      definitionId: 'modal-spell',
      ownerId: 'p1',
      zone: 'stack',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    };
    state.cards.set('modal-inst', spellInstance);

    // Put a creature on battlefield to target
    const creatureDef: CardDefinition = {
      id: 'creature-def',
      name: 'Test Creature',
      type_line: 'Creature',
      oracle_text: '',
      mana_cost: '{G}',
      cmc: 1,
      colors: ['G'],
      color_identity: ['G'],
      keywords: [],
      card_types: ['creature'],
      power: 3,
      toughness: 4,
    };
    state.cardDefinitions.set('creature-def', creatureDef);

    const creatureInstance: CardInstance = {
      instanceId: 'creature-inst',
      definitionId: 'creature-def',
      ownerId: 'p2',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    };
    state.cards.set('creature-inst', creatureInstance);

    // Add modal spell to stack with chosen mode 0 and target
    const stackItem: SpellStackItem = {
      kind: 'Spell',
      id: 'stack_modal_1',
      cardInstanceId: 'modal-inst',
      casterId: 'p1',
      targets: ['creature-inst'],
      chosenModes: [0],
    };
    state.stack = [stackItem];

    const result = resolveTopOfStack(state);

    // Spell should go to graveyard
    expect(result.cards.get('modal-inst')!.zone).toBe('graveyard');
    // Creature should have taken 3 damage
    expect(result.cards.get('creature-inst')!.damage).toBe(3);
    // Stack should be empty
    expect(result.stack.length).toBe(0);
  });

  it('should resolve second mode of a modal spell', () => {
    const modalSpellDef: CardDefinition = {
      id: 'modal-spell-2',
      name: 'Modal Draw Spell',
      type_line: 'Instant',
      oracle_text: 'Choose one —\n• ~ deals 3 damage to target creature.\n• Draw a card.',
      mana_cost: '{U}',
      cmc: 1,
      colors: ['U'],
      color_identity: ['U'],
      keywords: [],
      card_types: ['instant'],
    };

    const state = createTestState();
    state.cardDefinitions.set('modal-spell-2', modalSpellDef);

    const spellInstance: CardInstance = {
      instanceId: 'modal-inst-2',
      definitionId: 'modal-spell-2',
      ownerId: 'p1',
      zone: 'stack',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    };
    state.cards.set('modal-inst-2', spellInstance);

    // Ensure p1 has library cards to draw
    const libraryCard: CardInstance = {
      instanceId: 'library-card-1',
      definitionId: 'modal-spell-2',
      ownerId: 'p1',
      zone: 'library',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 0,
      isCommander: false,
    };
    state.cards.set('library-card-1', libraryCard);

    // Choose mode 1 (draw a card), no targets needed
    const stackItem: SpellStackItem = {
      kind: 'Spell',
      id: 'stack_modal_2',
      cardInstanceId: 'modal-inst-2',
      casterId: 'p1',
      targets: [],
      chosenModes: [1],
    };
    state.stack = [stackItem];

    const result = resolveTopOfStack(state);

    // Spell should go to graveyard
    expect(result.cards.get('modal-inst-2')!.zone).toBe('graveyard');
    // Library card should have moved to hand
    expect(result.cards.get('library-card-1')!.zone).toBe('hand');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd engine && npm run test -- --reporter verbose 2>&1 | grep -E "(modal|FAIL)"`
Expected: FAIL — `chosenModes` property doesn't exist on `SpellStackItem`

**Step 3: Add `chosenModes` to SpellStackItem**

In `engine/src/types.ts`, add `chosenModes?: number[]` to `SpellStackItem`:

```typescript
export interface SpellStackItem {
  kind: 'Spell';
  id: string;
  cardInstanceId: string;
  casterId: string;
  targets: string[];
  chosenModes?: number[];  // indices into modal choices
}
```

**Step 4: Add modal resolution to `resolveTopOfStack`**

In `engine/src/stack.ts`, in the non-permanent spell resolution section (around line 298-317), add handling for `kind: 'Modal'` before the existing `kind: 'Spell'` check:

```typescript
// In the else block (non-permanent spells), after checking override:
const parsed = parseOracleText(def.oracle_text, def.mana_cost);

if (parsed.kind === 'Modal' && spellItem.chosenModes && spellItem.chosenModes.length > 0) {
  // Collect effects and targets from chosen modes
  const allEffects: Effect[] = [];
  const allTargetSpecs: TargetSpec[] = [];
  for (const modeIndex of spellItem.chosenModes) {
    const choice = parsed.modal.choices[modeIndex];
    if (choice) {
      allEffects.push(...choice.effects);
      allTargetSpecs.push(...choice.targets.map(t => ({
        id: t.id,
        type: t.type as any,
        count: 1,
      })));
    }
  }

  if (allTargetSpecs.length > 0) {
    validateTargetChoices(intermediateState, spellItem.casterId, allTargetSpecs, spellItem.targets);
  }

  resultState = executeEffectsWithSBA(
    intermediateState,
    allEffects,
    spellItem.casterId,
    spellItem.targets,
    allTargetSpecs,
  );
} else if (parsed.kind === 'Spell') {
  // ... existing Spell handling
```

**Step 5: Run tests to verify they pass**

Run: `cd engine && npm run test`
Expected: All tests pass including new modal tests

**Step 6: Commit**

```bash
git add engine/src/types.ts engine/src/stack.ts engine/src/stack.test.ts
git commit -m "feat(engine): wire modal spell resolution into stack"
```

---

### Task 2: First Strike / Double Strike Damage Steps

Currently `resolveCombatDamage()` applies all damage in one step. First strikers should deal damage first, then regular creatures. Double strike deals in both steps.

**Files:**
- Modify: `engine/src/combat.ts:204-295` (resolveCombatDamage)
- Modify: `engine/src/turn-manager.ts` (skip first_strike_damage step when no first/double strikers)
- Test: `engine/src/combat.test.ts`

**Step 1: Write the failing test**

Add to `engine/src/combat.test.ts`:

```typescript
describe('first strike damage', () => {
  it('first strike creature kills blocker before blocker deals damage', () => {
    // First striker (3/2) vs normal creature (2/3)
    // First strike step: 3 damage kills the 2/3
    // Normal step: dead creature deals no damage back
    const state = createCombatState({
      attacker: { power: 3, toughness: 2, keywords: ['First Strike'] },
      blocker: { power: 2, toughness: 3, keywords: [] },
    });

    const result = resolveCombatDamage(state);
    // Blocker should have lethal damage (3 >= 3 toughness)
    const blocker = result.cards.get('blocker-inst')!;
    expect(blocker.damage).toBe(3);
    // Attacker should have 0 damage (blocker died in first strike step)
    const attacker = result.cards.get('attacker-inst')!;
    expect(attacker.damage).toBe(0);
  });

  it('double strike creature deals damage in both steps', () => {
    // Double striker (2/2) attacks player directly (unblocked)
    // First strike step: 2 damage
    // Normal step: 2 damage
    // Total: 4 damage to player
    const state = createCombatState({
      attacker: { power: 2, toughness: 2, keywords: ['Double Strike'] },
      unblocked: true,
    });

    const result = resolveCombatDamage(state);
    const defender = result.players.find(p => p.id === 'p2')!;
    // Should take 4 damage total (2 + 2), so 40 - 4 = 36 life
    expect(defender.life).toBe(36);
  });

  it('normal combat still works when no first strikers', () => {
    // 3/3 vs 2/4 — normal damage exchange
    const state = createCombatState({
      attacker: { power: 3, toughness: 3, keywords: [] },
      blocker: { power: 2, toughness: 4, keywords: [] },
    });

    const result = resolveCombatDamage(state);
    const blocker = result.cards.get('blocker-inst')!;
    expect(blocker.damage).toBe(3);
    const attacker = result.cards.get('attacker-inst')!;
    expect(attacker.damage).toBe(2);
  });
});
```

Note: `createCombatState` is a test helper that sets up a combat scenario. If it doesn't exist, create it in the test file.

**Step 2: Run test to verify it fails**

Run: `cd engine && npm run test -- src/combat.test.ts --reporter verbose 2>&1 | grep -E "(first strike|FAIL)"`
Expected: FAIL — first striker takes damage back because all damage is simultaneous

**Step 3: Implement two-step combat damage**

Replace `resolveCombatDamage` in `engine/src/combat.ts`:

```typescript
export function resolveCombatDamage(state: GameState): GameState {
  if (!state.combat) throw new Error("No combat state");

  // Check if any attacker or blocker has first strike or double strike
  const hasFirstStrikers = checkForFirstStrikers(state);

  if (!hasFirstStrikers) {
    // No first strikers — single damage step (existing behavior)
    return resolveDamageStep(state, 'normal');
  }

  // Two-step damage:
  // Step 1: First strike + double strike creatures deal damage
  let afterFirstStrike = resolveDamageStep(state, 'first');
  // Check SBAs between steps (creatures die from first strike damage)
  afterFirstStrike = checkStateBasedActions(afterFirstStrike);
  // Step 2: Normal + double strike creatures deal damage
  return resolveDamageStep(afterFirstStrike, 'normal');
}
```

With helper functions:

```typescript
function checkForFirstStrikers(state: GameState): boolean {
  if (!state.combat) return false;

  for (const attacker of state.combat.attackers) {
    if (instanceHasKeyword(state, attacker.cardInstanceId, 'First Strike') ||
        instanceHasKeyword(state, attacker.cardInstanceId, 'Double Strike')) {
      return true;
    }
  }
  for (const blocker of state.combat.blockers) {
    if (instanceHasKeyword(state, blocker.cardInstanceId, 'First Strike') ||
        instanceHasKeyword(state, blocker.cardInstanceId, 'Double Strike')) {
      return true;
    }
  }
  return false;
}

// 'first' = only first strike / double strike deal damage
// 'normal' = only non-first-strike / double strike deal damage
function creatureDealsInStep(state: GameState, instanceId: string, step: 'first' | 'normal'): boolean {
  const hasFS = instanceHasKeyword(state, instanceId, 'First Strike');
  const hasDS = instanceHasKeyword(state, instanceId, 'Double Strike');

  if (step === 'first') return hasFS || hasDS;
  if (step === 'normal') return !hasFS || hasDS; // double strike deals in both
  return false;
}
```

`resolveDamageStep` contains the same logic as current `resolveCombatDamage` but filters which creatures deal damage based on `creatureDealsInStep()`. Critically:
- Only creatures still on the battlefield (zone === 'battlefield') deal damage
- The `combat` state is only cleared (set to null) after the final damage step

**Step 4: Run tests**

Run: `cd engine && npm run test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add engine/src/combat.ts engine/src/combat.test.ts
git commit -m "feat(engine): implement first strike and double strike damage steps"
```

---

### Task 3: "Dies" Triggers

Currently only ETB triggers fire. When creatures die (move from battlefield to graveyard via SBAs or effects), "dies" triggers should fire. This requires:
1. Extending the `Trigger` type to support `'Dies'`
2. Registering "dies" abilities from oracle text
3. Detecting zone changes in SBAs and creating pending triggers

**Files:**
- Modify: `engine/src/effects/ast.ts:178` (extend Trigger type)
- Modify: `engine/src/effects/parser.ts` (parse "when ~ dies" prefix)
- Modify: `engine/src/state-based.ts` (detect deaths, create pending triggers)
- Modify: `engine/src/stack.ts` (register "dies" abilities like ETB)
- Test: `engine/src/stack.test.ts` (new "dies" trigger tests)

**Step 1: Write the failing test**

```typescript
describe('dies triggers', () => {
  it('should fire "when ~ dies" trigger when creature dies from lethal damage', () => {
    // Creature with "When ~ dies, draw a card" takes lethal damage
    const state = createTestState();

    const creatureDef: CardDefinition = {
      id: 'dies-creature',
      name: 'Dies Draw Creature',
      type_line: 'Creature',
      oracle_text: 'When ~ dies, draw a card.',
      mana_cost: '{B}',
      cmc: 1,
      colors: ['B'],
      color_identity: ['B'],
      keywords: [],
      card_types: ['creature'],
      power: 1,
      toughness: 1,
    };
    state.cardDefinitions.set('dies-creature', creatureDef);

    const creatureInstance: CardInstance = {
      instanceId: 'dies-inst',
      definitionId: 'dies-creature',
      ownerId: 'p1',
      zone: 'battlefield',
      tapped: false,
      summoningSick: false,
      counters: {},
      damage: 1, // lethal for 1 toughness
      isCommander: false,
    };
    state.cards.set('dies-inst', creatureInstance);

    // Register the dies ability on the battlefield
    // (This happens when the creature enters the battlefield)
    state.battlefieldAbilities = new Map();
    // We need to register dies triggers — checkSBAs should detect the death

    const result = checkStateBasedActions(state);

    // Creature should be in graveyard
    expect(result.cards.get('dies-inst')!.zone).toBe('graveyard');
    // Should have a pending trigger
    expect(result.pendingTriggers.length).toBe(1);
    expect(result.pendingTriggers[0].sourceInstanceId).toBe('dies-inst');
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `checkStateBasedActions` doesn't create pending triggers

**Step 3: Extend Trigger type**

In `engine/src/effects/ast.ts:178`, change:
```typescript
export type Trigger =
  | { kind: 'ETB'; who: 'self' | 'any' | 'controller' }
  | { kind: 'Dies'; who: 'self' | 'any' };
```

Also update the `TriggeredAbilityRef` in `engine/src/types.ts`:
```typescript
export interface TriggeredAbilityRef {
  kind: 'TriggeredAbility';
  trigger: { kind: 'ETB'; who: 'self' | 'any' | 'controller' }
    | { kind: 'Dies'; who: 'self' | 'any' };
  effects: unknown[];
}
```

**Step 4: Add "dies" prefix parsing**

In `engine/src/effects/parser.ts`, add a `matchDiesPrefix` function similar to `matchETBPrefix`:

```typescript
function matchDiesPrefix(tokens: string[]): number {
  // "when ~ dies ,"
  if (tokens.length < 3) return -1;

  const first = tokens[0];
  if (first !== 'when' && first !== 'whenever') return -1;
  if (tokens[1] !== '~') return -1;
  if (tokens[2] !== 'dies') return -1;

  let idx = 3;
  if (tokens[idx] === ',') idx++;

  return idx;
}
```

Then in `parseOracleText`, after the ETB check, add:

```typescript
const diesIndex = matchDiesPrefix(tokens);
if (diesIndex > 0) {
  const effectResult = parseEffectClause(tokens, diesIndex);
  if (effectResult) {
    const ability: TriggeredAbility = {
      kind: 'TriggeredAbility',
      trigger: { kind: 'Dies', who: 'self' },
      effects: effectResult.effects,
    };
    return {
      kind: 'Dies',
      ability,
      targets: effectResult.targets,
    };
  }
  return { kind: 'Unparsed', reason: 'Could not parse dies effect clause' };
}
```

Add `'Dies'` to the `ParsedOracle` union:

```typescript
export type ParsedOracle =
  | { kind: 'Spell'; effects: Effect[]; targets: TargetSpec[]; xCost?: boolean }
  | { kind: 'ETB'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Dies'; ability: TriggeredAbility; targets: TargetSpec[] }
  | { kind: 'Modal'; modal: ModalSpell; xCost?: boolean }
  | { kind: 'Unparsed'; reason: string };
```

**Step 5: Register "dies" abilities when permanents enter battlefield**

In `engine/src/stack.ts`, extend `registerETBAbilities` to also register dies abilities (rename to `registerBattlefieldAbilities`):

```typescript
function registerBattlefieldAbilities(state: GameState, instanceId: string): GameState {
  const card = state.cards.get(instanceId);
  if (!card) return state;

  const def = state.cardDefinitions.get(card.definitionId);
  if (!def) return state;

  // Existing ETB override/parsing logic...
  // (keep as-is)

  // Also check for dies triggers
  const parsed = parseOracleText(def.oracle_text);
  if (parsed.kind === 'Dies') {
    const newAbilities = new Map(state.battlefieldAbilities);
    const existing = newAbilities.get(instanceId) || [];
    newAbilities.set(instanceId, [...existing, parsed.ability as TriggeredAbilityRef]);
    return { ...state, battlefieldAbilities: newAbilities };
  }

  return state;
}
```

**Step 6: Detect deaths in SBAs and create pending triggers**

In `engine/src/state-based.ts`, modify `checkStateBasedActions` to track which creatures die and create pending triggers for them:

```typescript
// After moving a creature to graveyard in SBAs (both 0-toughness and lethal damage checks),
// collect the instanceId + ownerId in a `creaturesDied` array.

// After the SBA loop, for each dead creature:
// 1. Check state.battlefieldAbilities for dies triggers
// 2. Create pending triggers for any with trigger.kind === 'Dies'

const creaturesDied: { instanceId: string; ownerId: string }[] = [];

// In the lethal damage / 0-toughness sections, when moving to graveyard:
creaturesDied.push({ instanceId: id, ownerId: card.ownerId });

// After the while loop:
let newPendingTriggers = [...state.pendingTriggers];
for (const dead of creaturesDied) {
  const abilities = state.battlefieldAbilities.get(dead.instanceId);
  if (!abilities) continue;
  for (const ability of abilities) {
    if (ability.trigger.kind === 'Dies' && ability.trigger.who === 'self') {
      newPendingTriggers.push({
        id: `trigger_dies_${dead.instanceId}_${Date.now()}`,
        sourceInstanceId: dead.instanceId,
        controllerId: dead.ownerId,
        ability,
        requiredTargets: [],
      });
    }
  }
}
```

**Step 7: Run tests**

Run: `cd engine && npm run test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add engine/src/effects/ast.ts engine/src/effects/parser.ts engine/src/state-based.ts engine/src/stack.ts engine/src/types.ts engine/src/stack.test.ts
git commit -m "feat(engine): implement dies triggers with SBA detection"
```

---

### Task 4: Replacement Effects Integration

The replacement effects framework exists in `replacement.ts` but is never called during actual gameplay. We need to call `applyReplacements()` from the executor when damage is dealt, life is gained, and creatures die.

**Files:**
- Modify: `engine/src/effects/executor.ts` (call applyReplacements before executing effects)
- Modify: `engine/src/state-based.ts` (call applyReplacements when creatures die)
- Test: `engine/src/effects/replacement.test.ts` (add integration tests)

**Step 1: Write the failing test**

Add to `engine/src/effects/replacement.test.ts`:

```typescript
describe('replacement effects integration', () => {
  it('damage prevention replaces damage dealt by spells', () => {
    // Register damage prevention for player p1
    // Cast Lightning Bolt targeting p1
    // Damage should be prevented
    const state = createTestState();
    clearReplacements();

    registerReplacement(createDamagePreventionEffect(
      'prevention-source', 'p1', 'p1', 'all'
    ));

    // Execute a DealDamage effect targeting p1
    const effects: Effect[] = [{
      kind: 'DealDamage',
      source: { kind: 'ThisSpell' },
      target: { kind: 'Player', playerId: 'p1' },
      amount: 3,
    }];

    const result = executeEffectsWithSBA(state, effects, 'p2', [], []);

    // p1 should NOT have lost life (damage was prevented)
    const p1 = result.players.find(p => p.id === 'p1')!;
    expect(p1.life).toBe(40);

    clearReplacements();
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — p1 loses 3 life because replacement effects aren't checked

**Step 3: Integrate replacements into executor**

In `engine/src/effects/executor.ts`, before `executeDealDamage` applies damage, call `applyReplacements`:

```typescript
import { applyReplacements, ReplacementEvent } from './replacement';

function executeDealDamage(state: GameState, targetId: string, amount: number): GameState {
  // Check replacement effects
  const event: ReplacementEvent = {
    type: 'DamageDealt',
    targetId,
    amount,
  };
  const { event: replacedEvent } = applyReplacements(state, event);

  if (!replacedEvent) return state; // Damage was fully prevented
  const finalAmount = replacedEvent.amount ?? amount;
  if (finalAmount <= 0) return state;

  // ... existing damage logic with finalAmount instead of amount
```

Do the same for `executeGainLife` (LifeGained), `executeDraw` (CardDrawn), `executeAddCounters` (CounterAdded), and `executeCreateToken` (TokenCreated).

**Step 4: Run tests**

Run: `cd engine && npm run test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add engine/src/effects/executor.ts engine/src/effects/replacement.test.ts
git commit -m "feat(engine): integrate replacement effects into executor"
```

---

### Task 5: "Each Opponent" / "All Creatures" Targeting

Many Commander cards affect all opponents or all creatures. The parser currently only handles single-target patterns. Add "each opponent" and "destroy all creatures" patterns.

**Files:**
- Modify: `engine/src/effects/parser.ts` (add new patterns)
- Modify: `engine/src/effects/ast.ts` (add `EachOpponent` target ref if needed)
- Modify: `engine/src/effects/executor.ts` (handle new TargetRef kinds)
- Test: `engine/src/effects/parser.test.ts`

**Step 1: Write the failing test**

Add to `engine/src/effects/parser.test.ts`:

```typescript
describe('each opponent patterns', () => {
  it('should parse "each opponent loses N life"', () => {
    const result = parseOracleText('Each opponent loses 2 life.');
    expect(result.kind).toBe('Spell');
    if (result.kind === 'Spell') {
      expect(result.effects[0].kind).toBe('LoseLife');
      expect((result.effects[0] as any).player.kind).toBe('EachOpponent');
    }
  });

  it('should parse "destroy all creatures"', () => {
    const result = parseOracleText('Destroy all creatures.');
    expect(result.kind).toBe('Spell');
    if (result.kind === 'Spell') {
      expect(result.effects[0].kind).toBe('Destroy');
      expect((result.effects[0] as any).target.kind).toBe('AllCreatures');
    }
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — parser returns `{ kind: 'Unparsed' }`

**Step 3: Add new TargetRef kinds**

In `engine/src/effects/ast.ts`:

```typescript
export type TargetRef =
  | { kind: 'Chosen'; targetId: string }
  | { kind: 'Controller' }
  | { kind: 'Player'; playerId: string }
  | { kind: 'EachOpponent' }
  | { kind: 'AllCreatures' };
```

**Step 4: Add parser patterns**

In `engine/src/effects/parser.ts`, add `matchEachOpponent` and `matchDestroyAll`:

```typescript
function matchEachOpponentLosesLife(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // "each opponent loses N life"
  if (slice.length < 4) return null;
  if (slice[0] !== 'each') return null;
  if (slice[1] !== 'opponent') return null;
  if (slice[2] !== 'loses') return null;
  const amount = parseInt(slice[3], 10);
  if (isNaN(amount)) return null;
  if (slice[4] !== 'life') return null;

  let consumed = 5;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'LoseLife',
    player: { kind: 'EachOpponent' },
    amount,
  };
  return { effects: [effect], targets: [], consumed };
}

function matchDestroyAll(tokens: string[], startIndex: number): PatternResult {
  const slice = tokens.slice(startIndex);
  // "destroy all creatures"
  if (slice.length < 3) return null;
  if (slice[0] !== 'destroy') return null;
  if (slice[1] !== 'all') return null;
  if (slice[2] !== 'creatures') return null;

  let consumed = 3;
  if (tokens[startIndex + consumed] === '.') consumed++;

  const effect: Effect = {
    kind: 'Destroy',
    target: { kind: 'AllCreatures' },
  };
  return { effects: [effect], targets: [], consumed };
}
```

Add these to the patterns array in `parseEffectClause`, before the existing destroy pattern.

**Step 5: Handle new TargetRef kinds in executor**

In `engine/src/effects/executor.ts`, extend `resolveTargetRef` and the effect executors:

For `EachOpponent`: in `executeLoseLife`, when the target ref is `EachOpponent`, iterate over all opponents of the caster and apply the effect.

For `AllCreatures`: in `executeDestroy`, when target ref is `AllCreatures`, destroy every creature on the battlefield.

Add a new dispatch layer in `executeEffect`:

```typescript
case 'LoseLife': {
  if (effect.player.kind === 'EachOpponent') {
    const amount = resolveAmount(effect.amount, xValue);
    let s = state;
    for (const p of state.players) {
      if (p.id !== casterId && !p.hasLost) {
        s = executeLoseLife(s, p.id, amount);
      }
    }
    return s;
  }
  // ... existing single-player logic
}

case 'Destroy': {
  if (effect.target.kind === 'AllCreatures') {
    let s = state;
    for (const [id, card] of state.cards) {
      if (card.zone !== 'battlefield') continue;
      const def = state.cardDefinitions.get(card.definitionId);
      if (!def || !def.card_types.includes('creature')) continue;
      s = executeDestroy(s, id);
    }
    return s;
  }
  // ... existing single-target logic
}
```

**Step 6: Run tests**

Run: `cd engine && npm run test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add engine/src/effects/ast.ts engine/src/effects/parser.ts engine/src/effects/executor.ts engine/src/effects/parser.test.ts
git commit -m "feat(engine): add 'each opponent' and 'destroy all creatures' patterns"
```

---

### Task 6: Scry Implementation

Scry is currently a no-op. Implement basic scry: look at top N cards, AI auto-selects (keep best on top, put worst on bottom). Human player scry would need UI integration later, but the engine function should be functional.

**Files:**
- Modify: `engine/src/effects/executor.ts:362-366` (implement scry)
- Test: `engine/src/effects/executor.test.ts`

**Step 1: Write the failing test**

```typescript
describe('scry', () => {
  it('should reorder top cards (putting lowest CMC on bottom for AI)', () => {
    const state = createTestState();
    // Put 3 cards in library with different CMCs
    const card1 = createLibraryCard(state, 'p1', 'card1', { cmc: 5 });
    const card2 = createLibraryCard(state, 'p1', 'card2', { cmc: 2 });
    const card3 = createLibraryCard(state, 'p1', 'card3', { cmc: 1 });

    // Scry 2 — looks at top 2 cards
    const effects: Effect[] = [{
      kind: 'Scry',
      player: { kind: 'Controller' },
      count: 2,
    }];

    const result = executeEffects(state, effects, 'p1', [], [], 0);

    // At minimum, cards should still be in library (not lost)
    const libraryCards = [...result.cards.values()].filter(
      c => c.ownerId === 'p1' && c.zone === 'library'
    );
    expect(libraryCards.length).toBe(3);
  });
});
```

**Step 2: Implement basic scry**

```typescript
function executeScry(state: GameState, playerId: string, count: number): GameState {
  const newCards = new Map(state.cards);

  // Get top N library cards (by Map iteration order)
  const libraryCards: CardInstance[] = [];
  for (const [, card] of state.cards) {
    if (card.ownerId === playerId && card.zone === 'library') {
      libraryCards.push(card);
    }
  }

  const toScry = Math.min(count, libraryCards.length);
  if (toScry === 0) return state;

  // AI heuristic: keep higher CMC cards on top, put lower CMC on bottom
  // This is a simple approximation — real scry needs player interaction
  const scryCards = libraryCards.slice(0, toScry);
  const remainingLibrary = libraryCards.slice(toScry);

  // Sort scried cards: higher CMC stays on top (keep), lower goes to bottom
  const sorted = [...scryCards].sort((a, b) => {
    const defA = state.cardDefinitions.get(a.definitionId);
    const defB = state.cardDefinitions.get(b.definitionId);
    return (defB?.cmc ?? 0) - (defA?.cmc ?? 0);
  });

  // Split: top half stays on top, bottom half goes to bottom of library
  const keepCount = Math.ceil(sorted.length / 2);
  const keepOnTop = sorted.slice(0, keepCount);
  const sendToBottom = sorted.slice(keepCount);

  // Rebuild library: keepOnTop + remaining + sendToBottom
  const rebuiltLibrary = [...keepOnTop, ...remainingLibrary, ...sendToBottom];

  // Remove old library cards and re-add in new order
  const nonLibrary: [string, CardInstance][] = [];
  for (const [id, card] of newCards) {
    if (card.ownerId !== playerId || card.zone !== 'library') {
      nonLibrary.push([id, card]);
    }
  }

  const resultCards = new Map<string, CardInstance>();
  for (const [id, card] of nonLibrary) {
    resultCards.set(id, card);
  }
  for (const card of rebuiltLibrary) {
    resultCards.set(card.instanceId, card);
  }

  return { ...state, cards: resultCards };
}
```

**Step 3: Run tests**

Run: `cd engine && npm run test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add engine/src/effects/executor.ts engine/src/effects/executor.test.ts
git commit -m "feat(engine): implement scry with AI heuristic card ordering"
```

---

### Task 7: Update AI to Cast Modal Spells

The AI legal action generation and decision engine need to handle modal spells: choose which mode(s), provide `chosenModes` when casting.

**Files:**
- Modify: `engine/src/ai/legal-actions.ts` (detect modal spells, generate mode choices)
- Modify: `engine/src/ai/agent.ts` (pass chosenModes when casting)
- Modify: `engine/src/ai/types.ts` (add chosenModes to CastSpellAction)
- Test: `engine/src/ai/legal-actions.test.ts`

**Step 1: Write the failing test**

```typescript
describe('modal spell actions', () => {
  it('should generate cast actions with chosenModes for modal spells', () => {
    const state = createAITestState();
    // Give AI a modal spell in hand
    addCardToHand(state, 'ai-player', 'modal-spell', {
      oracle_text: 'Choose one —\n• ~ deals 3 damage to target creature.\n• Draw a card.',
      mana_cost: '{R}',
      card_types: ['instant'],
    });
    // Give AI enough mana
    addManaToPool(state, 'ai-player', { R: 1 });

    const actions = getLegalActions(state, 'ai-player');
    const castActions = actions.filter(a => a.kind === 'CastSpell');

    // Should have at least one cast action for the modal spell
    expect(castActions.length).toBeGreaterThan(0);
    // Each cast action should have chosenModes
    const modalAction = castActions.find(a => a.cardInstanceId === 'modal-spell-inst');
    expect(modalAction).toBeDefined();
    expect(modalAction!.chosenModes).toBeDefined();
    expect(modalAction!.chosenModes!.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Add chosenModes to CastSpellAction type**

In `engine/src/ai/types.ts`:
```typescript
export interface CastSpellAction {
  kind: 'CastSpell';
  cardInstanceId: string;
  targets: string[];
  chosenModes?: number[];
}
```

**Step 3: Generate modal actions in legal-actions.ts**

When generating CastSpell actions, check if the spell is modal. If so, generate one action per valid mode (for "Choose one") or combination (for "Choose two").

**Step 4: Pass chosenModes in agent.ts**

When the AI applies a CastSpellAction, include `chosenModes` on the stack item.

**Step 5: Run tests**

Run: `cd engine && npm run test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add engine/src/ai/types.ts engine/src/ai/legal-actions.ts engine/src/ai/agent.ts engine/src/ai/legal-actions.test.ts
git commit -m "feat(engine): AI support for modal spell casting"
```

---

## Implementation Priority

| Task | Impact | Effort | Priority |
|------|--------|--------|----------|
| Task 1: Modal spell resolution | HIGH | Small | 1st |
| Task 2: First strike damage | HIGH | Medium | 2nd |
| Task 3: Dies triggers | HIGH | Medium | 3rd |
| Task 5: Each/All targeting | HIGH | Medium | 4th |
| Task 4: Replacement integration | MEDIUM | Small | 5th |
| Task 6: Scry implementation | LOW | Small | 6th |
| Task 7: AI modal support | MEDIUM | Medium | 7th |

Tasks 1-3 are critical for gameplay correctness. Tasks 4-7 expand card coverage.
