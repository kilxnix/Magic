# Playable Game Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Commander game fully playable — creatures deal damage, spells have effects, tutors let you pick cards, and someone wins.

**Architecture:** Three layers: (1) Fix the game loop so combat flows correctly and AI attacks, (2) Add overrides for 50+ staple cards so spells actually do things, (3) Add win/loss detection with a victory screen and tutor card-picker UI.

**Tech Stack:** TypeScript engine (`engine/src/`), React frontend (`frontend/src/`), Vitest for engine tests.

---

## Task 1: Fix AI Attack Declaration

The AI never declares attackers — the `declare_attackers` step only handles the human case. The AI just passes through without attacking.

**Files:**
- Modify: `frontend/src/hooks/useShelectorGame.ts` (advanceGameLoop, ~line 1294)

- [ ] **Step 1: Add AI attacker declaration to the game loop**

In `advanceGameLoop`, the `declare_attackers` handler at ~line 1294 only has an `if (isHumanActive)` block. Add an `else` block for AI:

```typescript
if (state.step === 'declare_attackers') {
  if (isHumanActive) {
    // ... existing human logic ...
  } else {
    // AI declares attackers
    try {
      const config = createAIConfig(activeId, 3);
      const decision = makeDecision(state, config);
      if (decision && decision.action.kind === 'DeclareAttackers' && decision.action.attacks.length > 0) {
        state = decision.newState;
        narrateDecisions([decision], state, messages, logEntries);
        state = runSBAAndTriggers(state);
      }
    } catch (aiErr: unknown) {
      console.error('AI attack declaration error:', aiErr);
    }
  }
  // After attackers declared, pass priority through
  state = passAllPriority(state);
  state = advanceStep(state);
  state = runSBAAndTriggers(state);
  continue;
}
```

- [ ] **Step 2: Verify the AI attacks in a live game**

Start a game at `/shelector`, import a deck, let the AI have creatures on the battlefield. On the AI's turn, the chat should show "Attacked with [creature name]" and combat damage should reduce your life total.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useShelectorGame.ts
git commit -m "fix: AI declares attackers during combat phase"
```

---

## Task 2: Fix Combat State Cleanup

The `combat` field on GameState is never cleared after combat ends, which can cause stale combat state to persist into future turns.

**Files:**
- Modify: `engine/src/turn-manager.ts` (~line 34, advanceStep function)

- [ ] **Step 1: Clear combat state when advancing past end_of_combat**

In `advanceStep`, when the current step is `end_of_combat`, the next step will be `end` (postcombat main → ending). Clear the combat field:

```typescript
export function advanceStep(state: GameState): GameState {
  const currentIndex = STEP_ORDER.indexOf(state.step);

  if (currentIndex === STEP_ORDER.length - 1) {
    return advanceToNextTurn(state);
  }

  const nextStep = STEP_ORDER[currentIndex + 1];
  const nextPhase = derivePhase(state.step, nextStep);

  const updatedPlayers = state.players.map(p => ({
    ...p,
    manaPool: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
  }));

  return {
    ...state,
    step: nextStep,
    phase: nextPhase,
    players: updatedPlayers,
    hasPriorityPassed: new Array(state.players.length).fill(false),
    priorityPlayerIndex: state.activePlayerIndex,
    // Clear combat state after end_of_combat step
    combat: state.step === 'end_of_combat' ? null : state.combat,
  };
}
```

- [ ] **Step 2: Also clear combat on turn change**

In `advanceToNextTurn`, ensure combat is cleared:

```typescript
export function advanceToNextTurn(state: GameState): GameState {
  // ... existing code ...
  return {
    ...state,
    // ... existing fields ...
    combat: null,  // Always clear combat on new turn
  };
}
```

- [ ] **Step 3: Run existing tests**

Run: `cd engine && npx vitest run src/turn-manager.test.ts`
Expected: All pass (existing behavior preserved, combat field is additive).

- [ ] **Step 4: Build engine**

Run: `cd engine && npm run build`

- [ ] **Step 5: Commit**

```bash
git add engine/src/turn-manager.ts
git commit -m "fix: clear combat state after end_of_combat and on new turn"
```

---

## Task 3: Game Over Detection and Victory Screen

The engine sets `hasLost` when life <= 0 or commander damage >= 21, and `deriveSimpleState` computes `gameOver`/`winnerId`. The GameBoard already has a victory overlay. But the game loop doesn't break cleanly when someone dies mid-combat or mid-spell, and life changes aren't narrated well.

**Files:**
- Modify: `frontend/src/hooks/useShelectorGame.ts` (submitAction, advanceGameLoop)
- Modify: `frontend/src/components/GameBoard.tsx` (enhance victory screen)

- [ ] **Step 1: Add game-over check after every state mutation in advanceGameLoop**

After every `state = runSBAAndTriggers(state)` call in advanceGameLoop, add:

```typescript
// Check if game ended
const humanDead = state.players.find(p => p.id === humanIdRef.current)?.hasLost;
const allAIDead = aiIdsRef.current.every(id => state.players.find(p => p.id === id)?.hasLost);
if (humanDead || allAIDead) {
  if (humanDead) messages.push({ role: 'system', text: 'You have been defeated!' });
  if (allAIDead) messages.push({ role: 'system', text: 'Victory! You won the game!' });
  break;
}
```

There are ~12 places in the game loop where `runSBAAndTriggers` is called. Extract a helper:

```typescript
const checkGameOver = (s: GameState): boolean => {
  const humanDead = s.players.find(p => p.id === humanIdRef.current)?.hasLost;
  const allAIDead = aiIdsRef.current.every(id => s.players.find(p => p.id === id)?.hasLost);
  if (humanDead) messages.push({ role: 'system', text: 'You have been defeated!' });
  else if (allAIDead) messages.push({ role: 'system', text: 'Victory! You won the game!' });
  return !!(humanDead || allAIDead);
};
```

Then after each `state = runSBAAndTriggers(state)`, add: `if (checkGameOver(state)) break;`

- [ ] **Step 2: Narrate life total changes**

After combat damage resolution (~line 1344), the code already narrates life changes. Enhance it to also narrate when a player dies:

```typescript
if (state.step === 'combat_damage') {
  if (state.combat && state.combat.attackers.length > 0) {
    try {
      state = resolveCombatDamage(state);
      state = runSBAAndTriggers(state);
      // Narrate life totals
      for (const p of state.players) {
        if (p.hasLost) {
          const name = p.id === humanIdRef.current ? 'You' : (aiCommanderNamesRef.current[p.id] || p.id);
          messages.push({ role: 'system', text: `${name} ${p.id === humanIdRef.current ? 'have' : 'has'} been eliminated! (Life: ${p.life})` });
        } else if (p.life < 40) {
          const name = p.id === humanIdRef.current ? 'You' : (aiCommanderNamesRef.current[p.id] || p.id);
          messages.push({ role: 'system', text: `${name}: Life ${p.life}` });
        }
      }
      if (checkGameOver(state)) break;
    } catch (e) {
      console.error('Combat damage error:', e);
    }
  }
  // ... rest of combat_damage handling
}
```

- [ ] **Step 3: Enhance the victory screen in GameBoard.tsx**

Replace the existing game-over overlay (~line 738) with a more informative one:

```tsx
{gameState.gameOver && (
  <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50 backdrop-blur-sm">
    <div className="bg-stone-800 border-2 border-amber-500/50 rounded-2xl p-8 md:p-12 text-center max-w-md mx-4 shadow-2xl">
      <div className={`text-4xl font-bold mb-3 ${
        gameState.winnerId === 'human' ? 'text-amber-400' : 'text-red-400'
      }`}>
        {gameState.winnerId === 'human' ? 'Victory!' : 'Defeat'}
      </div>
      <div className="text-stone-300 text-sm mb-4">
        {gameState.winnerId === 'human'
          ? `You defeated ${gameState.aiCommander}!`
          : `${gameState.aiCommander} has prevailed.`}
      </div>
      <div className="text-stone-500 text-xs mb-6">
        Turn {gameState.turnNumber} — Your life: {gameState.humanPlayer.life}
      </div>
      <button
        onClick={() => window.location.reload()}
        className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg transition-colors"
      >
        Play Again
      </button>
    </div>
  </div>
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useShelectorGame.ts frontend/src/components/GameBoard.tsx
git commit -m "feat: game over detection with victory/defeat screen"
```

---

## Task 4: Add WinGame and LoseGame Effect Types

Cards like Thassa's Oracle or Laboratory Maniac need "you win the game" / "you lose the game" effects.

**Files:**
- Modify: `engine/src/effects/ast.ts`
- Modify: `engine/src/effects/executor.ts`
- Modify: `engine/src/effects/parser.ts`
- Test: `engine/src/effects/executor.test.ts`

- [ ] **Step 1: Add effect types to AST**

In `engine/src/effects/ast.ts`, add to the Effect union:

```typescript
export interface WinGameEffect {
  kind: 'WinGame';
  player: TargetRef;
}

export interface LoseGameEffect {
  kind: 'LoseGame';
  player: TargetRef;
}
```

Add to the Effect union type:
```typescript
export type Effect =
  | ... existing types ...
  | WinGameEffect
  | LoseGameEffect;
```

- [ ] **Step 2: Add executor logic**

In `engine/src/effects/executor.ts`, add cases to the main switch:

```typescript
case 'WinGame': {
  // Mark all opponents as lost
  const winnerId = resolveTargetRef(state, effect.player, casterId);
  const newPlayers = state.players.map(p =>
    p.id !== winnerId ? { ...p, hasLost: true } : p
  );
  state = { ...state, players: newPlayers };
  break;
}

case 'LoseGame': {
  const loserId = resolveTargetRef(state, effect.player, casterId);
  const newPlayers = state.players.map(p =>
    p.id === loserId ? { ...p, hasLost: true } : p
  );
  state = { ...state, players: newPlayers };
  break;
}
```

- [ ] **Step 3: Add parser patterns**

In `engine/src/effects/parser.ts`, add pattern matching for "you win the game" and "you lose the game" oracle text.

- [ ] **Step 4: Build and test**

Run: `cd engine && npm run build && npx vitest run`

- [ ] **Step 5: Commit**

```bash
git add engine/src/effects/ast.ts engine/src/effects/executor.ts engine/src/effects/parser.ts
git commit -m "feat: add WinGame and LoseGame effect types"
```

---

## Task 5: Card Picker UI for Tutors

The `executeSearchLibrary` function auto-picks the first matching card. For a learning tool, the player needs to browse their library and choose.

**Files:**
- Create: `frontend/src/components/CardPickerModal.tsx`
- Modify: `frontend/src/hooks/useShelectorGame.ts`
- Modify: `frontend/src/components/GameBoard.tsx`
- Modify: `frontend/src/pages/ShelectorGamePage.tsx`

- [ ] **Step 1: Create CardPickerModal component**

```tsx
// frontend/src/components/CardPickerModal.tsx
import { useState } from 'react';
import type { SimpleCard } from '../hooks/useShelectorGame';

interface CardPickerModalProps {
  title: string;
  cards: SimpleCard[];
  filter?: string;       // e.g., "basic land", "creature"
  onPick: (cardInstanceId: string) => void;
  onCancel?: () => void;  // Some searches are "you may"
}

export function CardPickerModal({ title, cards, filter, onPick, onCancel }: CardPickerModalProps) {
  const [search, setSearch] = useState('');

  const filtered = cards.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter && !c.typeLine.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-stone-800 border border-stone-600 rounded-xl p-4 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="text-amber-400 font-semibold text-sm mb-2">{title}</div>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full px-3 py-2 bg-stone-900 border border-stone-700 rounded text-stone-200 text-sm mb-3"
          autoFocus
        />
        <div className="flex-1 overflow-y-auto space-y-1">
          {filtered.map(card => (
            <button
              key={card.instanceId}
              onClick={() => onPick(card.instanceId)}
              className="w-full text-left px-3 py-2 rounded bg-stone-700 hover:bg-stone-600 transition-colors"
            >
              <div className="text-stone-200 text-sm font-medium">{card.name}</div>
              <div className="text-stone-400 text-xs">{card.typeLine} — {card.manaCost || 'no cost'}</div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="text-stone-500 text-sm text-center py-4">No matching cards found</div>
          )}
        </div>
        {onCancel && (
          <button onClick={onCancel} className="mt-3 text-stone-400 text-xs hover:text-stone-300">
            Cancel search
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add tutor state to useShelectorGame**

Add state for the card picker:

```typescript
const [tutorPhase, setTutorPhase] = useState(false);
const [tutorCards, setTutorCards] = useState<SimpleCard[]>([]);
const [tutorTitle, setTutorTitle] = useState('');
const [tutorFilter, setTutorFilter] = useState<string | undefined>();
const tutorResolverRef = useRef<((cardInstanceId: string) => void) | null>(null);
```

Add a `resolveTutor` callback:

```typescript
const resolveTutor = useCallback((cardInstanceId: string) => {
  const engine = engineRef.current;
  if (!engine) return;

  // Move chosen card from library to hand
  const card = engine.cards.get(cardInstanceId);
  if (!card) return;
  const def = getCardDefinition(engine, card);

  const newCards = new Map(engine.cards);
  newCards.set(cardInstanceId, { ...card, zone: 'hand' as Zone });

  // Shuffle library (Fisher-Yates on remaining library cards)
  const libraryCards: [string, typeof card][] = [];
  const otherCards: [string, typeof card][] = [];
  for (const [id, c] of newCards) {
    if (c.ownerId === humanIdRef.current && c.zone === 'library') {
      libraryCards.push([id, c]);
    } else {
      otherCards.push([id, c]);
    }
  }
  // Fisher-Yates shuffle
  for (let i = libraryCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [libraryCards[i], libraryCards[j]] = [libraryCards[j], libraryCards[i]];
  }
  const shuffledCards = new Map([...otherCards, ...libraryCards]);
  const newEngine = { ...engine, cards: shuffledCards } as GameStateWithAI;
  engineRef.current = newEngine;

  addMessage('player', `Found ${def.name} and put it into hand. Library shuffled.`);
  setTutorPhase(false);
  setTutorCards([]);

  // Continue game loop
  const loopMessages: { role: ChatMessage['role']; text: string }[] = [];
  const loopLogEntries: GameLogEntry[] = [];
  let state = advanceGameLoop(newEngine, loopMessages, loopLogEntries);
  engineRef.current = state as GameStateWithAI;
  for (const msg of loopMessages) addMessage(msg.role, msg.text);
  if (loopLogEntries.length > 0) setGameLog(prev => [...prev, ...loopLogEntries]);

  syncState();
}, [addMessage, syncState, advanceGameLoop]);
```

Return the tutor state from the hook:
```typescript
return {
  // ... existing fields ...
  tutorPhase,
  tutorCards,
  tutorTitle,
  tutorFilter,
  resolveTutor,
};
```

- [ ] **Step 3: Intercept tutor spell resolution in the game loop**

In `advanceGameLoop` or `submitAction`, when a tutor spell resolves (e.g., Demonic Tutor), instead of executing the "Draw 1" proxy effect, intercept and show the card picker. Detect tutor spells by name:

```typescript
const TUTOR_CARDS = new Set([
  'Demonic Tutor', 'Vampiric Tutor', 'Enlightened Tutor', 'Mystical Tutor',
  'Worldly Tutor', 'Imperial Seal', 'Gamble', 'Diabolic Intent',
  'Diabolic Tutor', 'Scheming Symmetry', 'Wishclaw Talisman',
  'Grim Tutor', 'Personal Tutor', 'Solve the Equation',
]);
```

Before `resolveTopOfStack`, check if the top stack item is a tutor spell cast by the human:

```typescript
// Check for tutor resolution
if (state.stack.length > 0) {
  const top = state.stack[state.stack.length - 1];
  if (top.kind === 'Spell' && top.casterId === humanIdRef.current) {
    const card = state.cards.get(top.cardInstanceId);
    const def = card ? state.cardDefinitions.get(card.definitionId) : undefined;
    if (def && TUTOR_CARDS.has(def.name)) {
      // Show card picker instead of resolving normally
      const libraryCards = getCardsInZone(state, humanIdRef.current, 'library');
      const simpleLibrary = libraryCards.map(c => {
        const d = getCardDefinition(state, c);
        return {
          instanceId: c.instanceId,
          name: d.name,
          typeLine: d.type_line,
          manaCost: d.mana_cost,
          power: d.power?.toString(),
          toughness: d.toughness?.toString(),
          tapped: false,
          counters: {},
        };
      });
      // Remove the spell from stack (it resolves into the search)
      const newStack = state.stack.slice(0, -1);
      const newCards = new Map(state.cards);
      if (card) newCards.set(card.instanceId, { ...card, zone: 'graveyard' as Zone });
      state = { ...state, stack: newStack, cards: newCards };
      engineRef.current = state as GameStateWithAI;

      setTutorTitle(`${def.name}: Search your library for a card`);
      setTutorCards(simpleLibrary);
      setTutorPhase(true);
      messages.push({ role: 'system', text: `${def.name} resolves — search your library.` });
      break; // Pause loop for card selection
    }
  }
}
```

- [ ] **Step 4: Wire CardPickerModal into ShelectorGamePage and GameBoard**

In `ShelectorGamePage.tsx`, destructure the tutor state and pass to GameBoard:

```tsx
const { tutorPhase, tutorCards, tutorTitle, tutorFilter, resolveTutor } = useShelectorGame();

<GameBoard
  // ... existing props ...
  tutorPhase={tutorPhase}
  tutorCards={tutorCards}
  tutorTitle={tutorTitle}
  tutorFilter={tutorFilter}
  onTutorPick={resolveTutor}
/>
```

In `GameBoard.tsx`, add the CardPickerModal props and render it:

```tsx
interface GameBoardProps {
  // ... existing props ...
  tutorPhase?: boolean;
  tutorCards?: SimpleCard[];
  tutorTitle?: string;
  tutorFilter?: string;
  onTutorPick?: (cardInstanceId: string) => void;
}

// In the return JSX:
{tutorPhase && tutorCards && onTutorPick && (
  <CardPickerModal
    title={tutorTitle || 'Search your library'}
    cards={tutorCards}
    filter={tutorFilter}
    onPick={onTutorPick}
  />
)}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CardPickerModal.tsx frontend/src/hooks/useShelectorGame.ts frontend/src/components/GameBoard.tsx frontend/src/pages/ShelectorGamePage.tsx
git commit -m "feat: card picker UI for tutor spells"
```

---

## Task 6: Add Overrides for 50+ Commander Staples

Most spells in real Commander decks have oracle text the parser can handle, but many staples need overrides for correct behavior (especially multi-effect cards). Add overrides in batches.

**Files:**
- Modify: `engine/src/effects/overrides.ts`
- Test: `engine/src/effects/overrides.test.ts` (if exists, otherwise verify via build)

- [ ] **Step 1: Batch 1 — Removal (15 cards)**

Add to `engine/src/effects/overrides.ts`:

```typescript
// === REMOVAL ===

// Path to Exile — exile + opponent searches for basic land
registerOverrideByName('Path to Exile', {
  kind: 'Spell',
  effects: [{ kind: 'Exile', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'creature' as TargetType, count: 1 }],
});

// Generous Gift — destroy any permanent, controller gets 3/3 elephant
registerOverrideByName('Generous Gift', {
  kind: 'Spell',
  effects: [
    { kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } },
    { kind: 'CreateToken', controller: { kind: 'Controller' }, token: { name: 'Elephant', power: 3, toughness: 3, colors: ['G'], types: ['creature'], subtypes: ['Elephant'], keywords: [] }, count: { kind: 'Fixed', value: 1 } },
  ],
  targets: [{ id: 'target_0', type: 'permanent' as TargetType, count: 1 }],
});

// Anguished Unmaking — exile target nonland permanent, lose 3 life
registerOverrideByName('Anguished Unmaking', {
  kind: 'Spell',
  effects: [
    { kind: 'Exile', target: { kind: 'Chosen', targetId: 'target_0' } },
    { kind: 'LoseLife', player: { kind: 'Controller' }, amount: { kind: 'Fixed', value: 3 } },
  ],
  targets: [{ id: 'target_0', type: 'permanent' as TargetType, count: 1 }],
});

// Toxic Deluge — each creature gets -X/-X (simplified: destroy all creatures, lose X life)
registerOverrideByName('Toxic Deluge', {
  kind: 'Spell',
  effects: [
    { kind: 'Destroy', target: { kind: 'AllCreatures' } },
    { kind: 'LoseLife', player: { kind: 'Controller' }, amount: { kind: 'X' } },
  ],
  targets: [],
});

// Blasphemous Act — deal 13 damage to each creature
registerOverrideByName('Blasphemous Act', {
  kind: 'Spell',
  effects: [{ kind: 'DealDamage', target: { kind: 'AllCreatures' }, amount: { kind: 'Fixed', value: 13 } }],
  targets: [],
});

// Vandalblast — destroy target artifact (non-overload mode)
registerOverrideByName('Vandalblast', {
  kind: 'Spell',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'artifact' as TargetType, count: 1 }],
});

// Damn — destroy target creature (non-overload mode)
registerOverrideByName('Damn', {
  kind: 'Spell',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'creature' as TargetType, count: 1 }],
});

// Terminate — destroy target creature (can't be regenerated)
registerOverrideByName('Terminate', {
  kind: 'Spell',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'creature' as TargetType, count: 1 }],
});

// Go for the Throat — destroy target nonartifact creature
registerOverrideByName('Go for the Throat', {
  kind: 'Spell',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'creature' as TargetType, count: 1 }],
});

// Infernal Grasp — destroy target creature, lose 2 life
registerOverrideByName('Infernal Grasp', {
  kind: 'Spell',
  effects: [
    { kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } },
    { kind: 'LoseLife', player: { kind: 'Controller' }, amount: { kind: 'Fixed', value: 2 } },
  ],
  targets: [{ id: 'target_0', type: 'creature' as TargetType, count: 1 }],
});

// Ravenous Chupacabra — ETB: destroy target creature an opponent controls
registerOverrideByName('Ravenous Chupacabra', {
  kind: 'ETB',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'creature' as TargetType, count: 1 }],
});

// Reclamation Sage — ETB: destroy target artifact or enchantment
registerOverrideByName('Reclamation Sage', {
  kind: 'ETB',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'permanent' as TargetType, count: 1 }],
});

// Acidic Slime — ETB: destroy target artifact, enchantment, or land
registerOverrideByName('Acidic Slime', {
  kind: 'ETB',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'permanent' as TargetType, count: 1 }],
});

// Vindicate — destroy target permanent
registerOverrideByName('Vindicate', {
  kind: 'Spell',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'permanent' as TargetType, count: 1 }],
});

// Abrupt Decay — destroy target nonland permanent with CMC 3 or less
registerOverrideByName('Abrupt Decay', {
  kind: 'Spell',
  effects: [{ kind: 'Destroy', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'permanent' as TargetType, count: 1 }],
});
```

- [ ] **Step 2: Batch 2 — Counterspells (10 cards)**

```typescript
// === COUNTERSPELLS ===

// Counterspell — counter target spell
registerOverrideByName('Counterspell', {
  kind: 'Spell',
  effects: [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Swan Song — counter + give opponent a 2/2 bird
registerOverrideByName('Swan Song', {
  kind: 'Spell',
  effects: [
    { kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' } },
    { kind: 'CreateToken', controller: { kind: 'EachOpponent' }, token: { name: 'Bird', power: 2, toughness: 2, colors: ['U'], types: ['creature'], subtypes: ['Bird'], keywords: ['Flying'] }, count: { kind: 'Fixed', value: 1 } },
  ],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Negate — counter target noncreature spell
registerOverrideByName('Negate', {
  kind: 'Spell',
  effects: [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' }, filter: 'noncreature' }],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Dovin's Veto — counter target noncreature spell (can't be countered)
registerOverrideByName("Dovin's Veto", {
  kind: 'Spell',
  effects: [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' }, filter: 'noncreature' }],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Arcane Denial — counter target spell, opponent draws 2
registerOverrideByName('Arcane Denial', {
  kind: 'Spell',
  effects: [
    { kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' } },
  ],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Force of Will — counter target spell (alternate cost not modeled, but effect works)
registerOverrideByName('Force of Will', {
  kind: 'Spell',
  effects: [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Fierce Guardianship — counter target noncreature spell
registerOverrideByName('Fierce Guardianship', {
  kind: 'Spell',
  effects: [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' }, filter: 'noncreature' }],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Deflecting Swat — redirect (simplified: counter target spell)
registerOverrideByName('Deflecting Swat', {
  kind: 'Spell',
  effects: [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Mana Drain — counter target spell (mana gain not modeled)
registerOverrideByName('Mana Drain', {
  kind: 'Spell',
  effects: [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});

// Pact of Negation — counter target spell (trigger not modeled)
registerOverrideByName('Pact of Negation', {
  kind: 'Spell',
  effects: [{ kind: 'CounterSpell', target: { kind: 'Chosen', targetId: 'target_0' } }],
  targets: [{ id: 'target_0', type: 'spell' as TargetType, count: 1 }],
});
```

- [ ] **Step 3: Batch 3 — Card Draw & Selection (10 cards)**

```typescript
// === CARD DRAW & SELECTION ===

// Brainstorm — draw 3, put 2 back (simplified: draw 1 net)
registerOverrideByName('Brainstorm', {
  kind: 'Spell',
  effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 3 } }],
  targets: [],
});

// Ponder — look at top 3, draw 1 (simplified: scry 3, draw 1)
registerOverrideByName('Ponder', {
  kind: 'Spell',
  effects: [
    { kind: 'Scry', player: { kind: 'Controller' }, count: 3 },
    { kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 1 } },
  ],
  targets: [],
});

// Preordain — scry 2, draw 1
registerOverrideByName('Preordain', {
  kind: 'Spell',
  effects: [
    { kind: 'Scry', player: { kind: 'Controller' }, count: 2 },
    { kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 1 } },
  ],
  targets: [],
});

// Night's Whisper — draw 2, lose 2 life
registerOverrideByName("Night's Whisper", {
  kind: 'Spell',
  effects: [
    { kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 2 } },
    { kind: 'LoseLife', player: { kind: 'Controller' }, amount: { kind: 'Fixed', value: 2 } },
  ],
  targets: [],
});

// Sign in Blood — draw 2, lose 2 life (same as Night's Whisper)
registerOverrideByName('Sign in Blood', {
  kind: 'Spell',
  effects: [
    { kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 2 } },
    { kind: 'LoseLife', player: { kind: 'Controller' }, amount: { kind: 'Fixed', value: 2 } },
  ],
  targets: [],
});

// Read the Bones — scry 2, draw 2, lose 2 life
registerOverrideByName('Read the Bones', {
  kind: 'Spell',
  effects: [
    { kind: 'Scry', player: { kind: 'Controller' }, count: 2 },
    { kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 2 } },
    { kind: 'LoseLife', player: { kind: 'Controller' }, amount: { kind: 'Fixed', value: 2 } },
  ],
  targets: [],
});

// Harmonize — draw 3
registerOverrideByName('Harmonize', {
  kind: 'Spell',
  effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 3 } }],
  targets: [],
});

// Fact or Fiction — draw 3 (simplified from 5-card pile split)
registerOverrideByName('Fact or Fiction', {
  kind: 'Spell',
  effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 3 } }],
  targets: [],
});

// Treasure Cruise — draw 3
registerOverrideByName('Treasure Cruise', {
  kind: 'Spell',
  effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 3 } }],
  targets: [],
});

// Dig Through Time — draw 2 (simplified from look-at-7)
registerOverrideByName('Dig Through Time', {
  kind: 'Spell',
  effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 2 } }],
  targets: [],
});
```

- [ ] **Step 4: Batch 4 — Ramp & Mana (10 cards)**

```typescript
// === RAMP & MANA ===

// Rampant Growth — search for basic land, put on battlefield tapped
registerOverrideByName('Rampant Growth', {
  kind: 'Spell',
  effects: [
    { kind: 'SearchLibrary', player: { kind: 'Controller' }, filter: { supertypes: ['Basic'], types: ['Land'] }, destination: 'battlefield', tapped: true },
    { kind: 'ShuffleLibrary', player: { kind: 'Controller' } },
  ],
  targets: [],
});

// Nature's Lore — search for forest, put on battlefield
registerOverrideByName("Nature's Lore", {
  kind: 'Spell',
  effects: [
    { kind: 'SearchLibrary', player: { kind: 'Controller' }, filter: { subtypes: ['Forest'] }, destination: 'battlefield' },
    { kind: 'ShuffleLibrary', player: { kind: 'Controller' } },
  ],
  targets: [],
});

// Three Visits — same as Nature's Lore
registerOverrideByName('Three Visits', {
  kind: 'Spell',
  effects: [
    { kind: 'SearchLibrary', player: { kind: 'Controller' }, filter: { subtypes: ['Forest'] }, destination: 'battlefield' },
    { kind: 'ShuffleLibrary', player: { kind: 'Controller' } },
  ],
  targets: [],
});

// Farseek — search for Plains/Island/Swamp/Mountain
registerOverrideByName('Farseek', {
  kind: 'Spell',
  effects: [
    { kind: 'SearchLibrary', player: { kind: 'Controller' }, filter: { types: ['Land'] }, destination: 'battlefield', tapped: true },
    { kind: 'ShuffleLibrary', player: { kind: 'Controller' } },
  ],
  targets: [],
});

// Sakura-Tribe Elder — sacrifice: search basic land to battlefield tapped
registerOverrideByName('Sakura-Tribe Elder', {
  kind: 'Activated',
  ability: {
    cost: { tap: false, sacrifice: true, mana: null },
    effects: [
      { kind: 'SearchLibrary', player: { kind: 'Controller' }, filter: { supertypes: ['Basic'], types: ['Land'] }, destination: 'battlefield', tapped: true },
      { kind: 'ShuffleLibrary', player: { kind: 'Controller' } },
    ],
    targets: [],
    isManaAbility: false,
  },
  targets: [],
});

// Dark Ritual — add BBB
registerOverrideByName('Dark Ritual', {
  kind: 'Spell',
  effects: [
    { kind: 'GainLife', player: { kind: 'Controller' }, amount: { kind: 'Fixed', value: 0 } },
    // Note: AddMana not in AST — handled by mana system separately
    // Simplified: no direct mana effect, the card "does nothing" mechanically
    // TODO: Add AddMana effect type for ritual spells
  ],
  targets: [],
});

// Arcane Signet — {T}: Add one mana of any color in your commander's identity
// (Handled by mana ability system, not override needed)

// Fellwar Stone — {T}: Add one mana of any type an opponent's land produces
// (Handled by mana ability system)

// Mind Stone — {T}: Add {C}. {1}, {T}, Sacrifice: Draw a card.
registerOverrideByName('Mind Stone', {
  kind: 'Activated',
  ability: {
    cost: { tap: true, sacrifice: true, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 1 } },
    effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 1 } }],
    targets: [],
    isManaAbility: false,
  },
  targets: [],
});

// Solemn Simulacrum — ETB: search for basic land
registerOverrideByName('Solemn Simulacrum', {
  kind: 'ETB',
  effects: [
    { kind: 'SearchLibrary', player: { kind: 'Controller' }, filter: { supertypes: ['Basic'], types: ['Land'] }, destination: 'battlefield', tapped: true },
    { kind: 'ShuffleLibrary', player: { kind: 'Controller' } },
  ],
  targets: [],
});

// Burnished Hart — sacrifice: search for 2 basics
registerOverrideByName('Burnished Hart', {
  kind: 'Activated',
  ability: {
    cost: { tap: false, sacrifice: true, mana: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 3 } },
    effects: [
      { kind: 'SearchLibrary', player: { kind: 'Controller' }, filter: { supertypes: ['Basic'], types: ['Land'] }, destination: 'battlefield', tapped: true },
      { kind: 'ShuffleLibrary', player: { kind: 'Controller' } },
    ],
    targets: [],
    isManaAbility: false,
  },
  targets: [],
});
```

- [ ] **Step 5: Batch 5 — Tutors (5 cards)**

```typescript
// === TUTORS ===
// These use Draw as a proxy. The game loop intercepts known tutor names
// and shows the card picker UI instead (see Task 5).

// Vampiric Tutor — search, put on top (simplified: draw 1, lose 2 life)
registerOverrideByName('Vampiric Tutor', {
  kind: 'Spell',
  effects: [
    { kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 1 } },
    { kind: 'LoseLife', player: { kind: 'Controller' }, amount: { kind: 'Fixed', value: 2 } },
  ],
  targets: [],
});

// Mystical Tutor — search for instant/sorcery, put on top
registerOverrideByName('Mystical Tutor', {
  kind: 'Spell',
  effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 1 } }],
  targets: [],
});

// Worldly Tutor — search for creature, put on top
registerOverrideByName('Worldly Tutor', {
  kind: 'Spell',
  effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 1 } }],
  targets: [],
});

// Imperial Seal — same as Vampiric Tutor
registerOverrideByName('Imperial Seal', {
  kind: 'Spell',
  effects: [
    { kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 1 } },
    { kind: 'LoseLife', player: { kind: 'Controller' }, amount: { kind: 'Fixed', value: 2 } },
  ],
  targets: [],
});

// Diabolic Tutor — search for any card, put in hand
registerOverrideByName('Diabolic Tutor', {
  kind: 'Spell',
  effects: [{ kind: 'Draw', player: { kind: 'Controller' }, count: { kind: 'Fixed', value: 1 } }],
  targets: [],
});
```

- [ ] **Step 6: Build and verify**

Run: `cd engine && npm run build && npx vitest run`
Expected: Build succeeds, all existing tests pass.

- [ ] **Step 7: Commit**

```bash
git add engine/src/effects/overrides.ts
git commit -m "feat: add 50+ Commander staple card overrides"
```

---

## Task 7: Fetch Land Overrides

Fetch lands (Scalding Tarn, Polluted Delta, etc.) need activated ability overrides that sacrifice + search for a land.

**Files:**
- Modify: `engine/src/effects/overrides.ts`

- [ ] **Step 1: Add all 10 original fetch lands + common budget fetches**

```typescript
// === FETCH LANDS ===

const FETCH_LAND_OVERRIDE = (subtypes: string[]) => ({
  kind: 'Activated' as const,
  ability: {
    cost: { tap: true, sacrifice: true, mana: null },
    effects: [
      { kind: 'SearchLibrary' as const, player: { kind: 'Controller' as const }, filter: { subtypes }, destination: 'battlefield' as const },
      { kind: 'ShuffleLibrary' as const, player: { kind: 'Controller' as const } },
    ],
    targets: [],
    isManaAbility: false,
  },
  targets: [],
});

// Enemy fetches
registerOverrideByName('Scalding Tarn', FETCH_LAND_OVERRIDE(['Island', 'Mountain']));
registerOverrideByName('Misty Rainforest', FETCH_LAND_OVERRIDE(['Forest', 'Island']));
registerOverrideByName('Verdant Catacombs', FETCH_LAND_OVERRIDE(['Swamp', 'Forest']));
registerOverrideByName('Marsh Flats', FETCH_LAND_OVERRIDE(['Plains', 'Swamp']));
registerOverrideByName('Arid Mesa', FETCH_LAND_OVERRIDE(['Mountain', 'Plains']));

// Allied fetches
registerOverrideByName('Flooded Strand', FETCH_LAND_OVERRIDE(['Plains', 'Island']));
registerOverrideByName('Polluted Delta', FETCH_LAND_OVERRIDE(['Island', 'Swamp']));
registerOverrideByName('Bloodstained Mire', FETCH_LAND_OVERRIDE(['Swamp', 'Mountain']));
registerOverrideByName('Wooded Foothills', FETCH_LAND_OVERRIDE(['Mountain', 'Forest']));
registerOverrideByName('Windswept Heath', FETCH_LAND_OVERRIDE(['Forest', 'Plains']));

// Budget fetches (any basic)
const BASIC_FETCH = FETCH_LAND_OVERRIDE(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest']);
registerOverrideByName('Prismatic Vista', BASIC_FETCH);
registerOverrideByName('Fabled Passage', BASIC_FETCH);
```

- [ ] **Step 2: Build and verify**

Run: `cd engine && npm run build`

- [ ] **Step 3: Commit**

```bash
git add engine/src/effects/overrides.ts
git commit -m "feat: add fetch land overrides for all 10 fetches + budget variants"
```

---

## Task 8: Verify End-to-End Gameplay

Manual integration test to confirm the full flow works.

- [ ] **Step 1: Build everything**

```bash
cd engine && npm run build
```

- [ ] **Step 2: Start the app**

Ensure backend (8000), Shelector (8100), and frontend (5173) are running.

- [ ] **Step 3: Play a test game**

1. Go to `/shelector`
2. Import a creature-heavy deck (e.g., mono-green stompy)
3. Spawn an AI opponent
4. Play lands, cast creatures
5. Attack with creatures — verify damage narration and life total changes
6. Verify AI attacks back on its turn
7. Continue until someone reaches 0 life
8. Verify game over screen appears with "Victory!" or "Defeat"

- [ ] **Step 4: Test a tutor**

1. Import a deck with Demonic Tutor
2. Cast Demonic Tutor
3. Verify card picker modal appears
4. Select a card
5. Verify card moves to hand and library is shuffled

- [ ] **Step 5: Test counterspells**

1. Import a deck with Counterspell
2. Wait for AI to cast a spell
3. Verify "You can respond" prompt appears
4. Cast Counterspell targeting the AI's spell
5. Verify spell is countered
