# Game Reliability Refactor — Design Spec

**Date:** 2026-04-22
**Project:** Magic Brains / Commander Game Engine (Shelector)
**Scope:** End-to-end action reliability, card-text regex rewrite, win condition system (including infinite-combo detection), and counters system coverage

## Motivation

The Shelector game is functional — games start, AI plays, turns advance, decks import — but three structural issues limit reliability:

1. **Actions fail silently or crash.** Engine actions (`playLand`, `castSpell`, `activateAbility`, etc.) throw on every failure path. The UI hook swallows throws, leaving the player with a no-op click and no feedback. The AI path crashes on illegal action selection rather than retrying. Spells can't be cast in the current UI partly because mana-tap failures surface as silent throws.
2. **Card-text parsing regex is brittle.** `card-parser-cache.ts` uses substring tricks like `indexOf('sacrifice') < indexOf('add')` that fail on common cards; `entersTheBattlefieldTapped` in `actions.ts` false-positives on "doesn't enter the battlefield tapped"; equipment, search, and tax parsers have fragile endings. No fixture corpus tests these against real oracle text.
3. **Win conditions are incomplete.** Life ≤ 0 and commander damage ≥ 21 work. Empty library is detected only from the executor path. Poison is missing. Infinite combos are undetected — a genuine combo (Basalt Monolith + Rings of Brighthearth) would loop the engine until it crashes or hits a test timeout. No UI end-game flow exists beyond a `gameOver` boolean.
4. **Counters beyond +1/+1 and -1/-1 are under-supported.** Loyalty counters, stun counters, poison counters, keyword counters (flying counter, etc.), and charge counters all need parsing, state-based handling, and in some cases continuous-effect integration.

## Goals

- Every public engine action returns a structured `ActionResult` — the UI and AI never receive a bare throw.
- Card-text regex is rewritten against a fixture corpus of ~200 real oracle texts so brittle patterns are caught by tests.
- A uniform `checkWinConditions` runs after every successful action and surfaces terminal conditions and possible infinite loops as events the UI consumes.
- The end-game UI modal lets the player choose how to resolve terminal or loop states: play it out, concede, declare a draw, start a new game, or review the game log.
- Counters (+1/+1, -1/-1, loyalty, stun, poison, keyword-grant, charge) parse from oracle text, interact with SBAs correctly, and grant keywords continuously where applicable.

## Non-Goals

- Rewriting the 62 token-indexed pattern matchers in `parser.ts` — those are not regex-based, and the user's scope was regex.
- Adding new card-effect primitives beyond what the counter work requires.
- UI visual redesign beyond the end-game modal (PWA / mobile UI are deferred per the existing project memory).
- Supporting every infinite combo in the game — the detector is heuristic and will catch common categories (state repeats, same-source re-trigger depth, unbounded life/mana growth); exotic combos may not trigger.

## Architecture

### Parallel public action API

The existing throwing functions in `engine/src/actions.ts` and related files stay as internal implementation — 830 existing tests depend on them. A new `engine/src/actions-public.ts` module exposes a parallel `try*` API that UI and AI code call instead:

```ts
export type ActionFailure =
  | 'not_your_turn'
  | 'wrong_phase'
  | 'illegal_target'
  | 'insufficient_mana'
  | 'already_tapped'
  | 'not_in_zone'
  | 'land_already_played'
  | 'card_not_found'
  | 'summoning_sick'
  | 'priority_not_yours'
  | 'internal_error';

export type GameEvent =
  | { kind: 'LandPlayed'; playerId: string; cardId: string }
  | { kind: 'SpellCast'; playerId: string; cardId: string }
  | { kind: 'AbilityActivated'; playerId: string; cardId: string; abilityIndex: number }
  | { kind: 'CreatureDied'; cardId: string; ownerId: string }
  | { kind: 'PlayerLost'; playerId: string; reason: WinReason }
  | { kind: 'PossibleLoop'; signature: LoopSignature; category: LoopCategory }
  | { kind: 'WinCheckFailed'; message: string };

export type ActionResult<T = GameState> =
  | { ok: true; state: T; events: GameEvent[] }
  | { ok: false; reason: ActionFailure; message: string };

export function tryPlayLand(state: GameState, playerId: string, cardInstanceId: string): ActionResult;
export function tryCastSpell(state: GameState, playerId: string, cardInstanceId: string, targets: string[], manaPayment: ManaPayment): ActionResult;
export function tryActivateAbility(state: GameState, playerId: string, cardInstanceId: string, abilityIndex: number, targets: string[]): ActionResult;
export function tryTapLandForMana(state: GameState, playerId: string, cardInstanceId: string, color: ManaColor): ActionResult;
export function tryDeclareAttackers(state: GameState, playerId: string, attackers: AttackerDecl[]): ActionResult;
export function tryDeclareBlockers(state: GameState, playerId: string, blockers: BlockerDecl[]): ActionResult;
export function tryPassPriority(state: GameState, playerId: string): ActionResult;
export function tryEquip(state: GameState, playerId: string, equipmentId: string, creatureId: string): ActionResult;
```

Each `try*` calls the corresponding `can*` predicate first (when one exists) to pick a specific `ActionFailure` code, then calls the internal throwing function inside a `try/catch` to guard against internal errors. After a successful action, `checkWinConditions` runs and its result is merged into the event list.

### Card-text regex rewrite

Rewrites stay in the same files. The approach is: identify brittle patterns, replace with regex that is tested against a fixture corpus.

**`engine/src/cards/card-parser-cache.ts`:**
- `parseEquipCost` — broaden to handle `equip {N}`, `equip {W}`, `equip {N}{W}`, `equip — sacrifice a creature`, `equip creature-type {N}` (for typal equip).
- `parseEquipmentBonus` — add hybrid/phyrexian mana ignoring; parse "+N/+N and has …" correctly; handle stacked bonuses from a single clause.
- `parseManaProduction` — replace `indexOf('sacrifice') < indexOf('add')` with proper regex anchored to the ability clause; handle "add one mana of any color", "add two mana in any combination of colors", filter lands, and sacrifice-cost lands.
- `parseSearchAbility` — replace greedy `(.+?)` with a disjunction anchored on `card`/`,`/`.`; correctly classify destination for "reveal it, put it in your hand, then shuffle" cases; recognize "up to N" counts.
- `parseUnlessTax` — expand trigger kinds, capture the tax amount with a regex that handles `{X}`, and capture effect count.

**`engine/src/effects/parser.ts`** (only the regex lines, not the token matchers):
- P/T parsing regex handles `+0/+2`, `-1/+0`, sign edge cases.
- Loyalty cost regex handles em-dash (`−`), en-dash (`–`), ASCII hyphen uniformly, and `0:` (no sign).

**`engine/src/actions.ts`:**
- `entersTheBattlefieldTapped` rewritten as a regex with a negation guard: the card enters tapped only if the oracle text contains "enters" plus "tapped" in a clause that is not negated by "unless", "doesn't", or "does not".

**`engine/src/effects/tokens.ts`:**
- Tokenizer is solid; add test for `~` (self-reference) replacement through a full parse round-trip.

### Win conditions

New `engine/src/win-conditions.ts`:

```ts
export type WinReason = 'life' | 'commander_damage' | 'empty_library' | 'poison' | 'concede';
export type LoopCategory = 'state_repeat' | 'trigger_self_loop' | 'unbounded_growth';
export type LoopSignature = { category: LoopCategory; sources: string[]; hash: string };

export type WinConditionResult = {
  losers: { playerId: string; reason: WinReason }[];
  loop?: LoopSignature;
};

export function checkWinConditions(
  state: GameState,
  detector: LoopDetector,
): WinConditionResult;

export class LoopDetector {
  observe(state: GameState, actionKind: string): LoopSignature | null;
  reset(): void;
}
```

Terminal checks:
- Life ≤ 0 — read from player state (existing SBA still marks `hasLost`; this function re-surfaces it as a structured result).
- Commander damage ≥ 21 per source — existing SBA.
- Empty library on draw — promoted: any `Draw` effect that would draw from an empty library marks loss via `markPlayerLostFromEmptyLibrary`.
- Poison counters ≥ 10 — new SBA addition.

`LoopDetector` heuristics:
- **state_repeat** — after each action, compute a fingerprint: hash of `{zones-by-player, life, poison, mana pools, stack, phase, activePlayerIndex}`. Maintain a ring buffer of last 20 fingerprints with counts. If any fingerprint count reaches 3, flag a loop.
- **trigger_self_loop** — during stack resolution, count triggers per source-instance. If the same source re-triggers > 50 times in one action chain, flag a loop. The counter resets at each action boundary (when priority returns to a player).
- **unbounded_growth** — track life and mana deltas per action chain. If either swings by > 1000 within a single action's resolution cascade, flag a loop.

The signature's `sources` array names the card instances implicated (for display in the modal).

### End-game UI flow

`frontend/src/components/shelector/EndGameModal.tsx` — new component. States:

- **Terminal win/loss:** "You lost by {reason}" / "You won — all opponents eliminated". Actions: Review log, New game.
- **Possible loop:** "It looks like this might be an infinite combo ({sources}). What should happen?". Actions: Play it out (one more round, re-check), Declare as draw (game ends with no winner), Concede (current player marked lost), New game, Review log.

The modal reads from the hook's new `lastEvent` state. The hook opens the modal when `events` contains a `PlayerLost` with a human involvement OR a `PossibleLoop`. For AI-only loops (no human player), the hook auto-resolves the loop as the AI's combo completing (skips modal) and sets terminal state if the AI won.

### Counters

Support tiers:

- **Already working:** +1/+1 and -1/-1 cancellation, toughness math, loyalty storage on planeswalkers.
- **Needs SBA:** planeswalker with 0 loyalty → graveyard. Stun counter: next untap consumes one stun counter instead of untapping that permanent (turn-manager, not SBA).
- **Needs parsing additions in `effects/parser.ts`:** counter add/remove token matchers for +1/+1, -1/-1, charge, loyalty, stun, poison, keyword-named (flying, trample, lifelink, deathtouch, vigilance, menace, reach, first strike, double strike, haste, hexproof, indestructible, unblockable).
- **Needs continuous-effects integration in `effects/continuous.ts`:** when a permanent has a keyword counter, it gains that keyword. Grant is removed when the counter is removed.
- **Ties into win-conditions:** poison counters ≥ 10 loses.

## Components and Data Flow

### New files

- `engine/src/actions-public.ts` — `try*` wrappers, `ActionResult`, `ActionFailure`, `GameEvent`
- `engine/src/win-conditions.ts` — `checkWinConditions`, `LoopDetector`, `WinReason`, `LoopSignature`
- `engine/src/cards/card-parser-cache.test.ts` — fixture-driven regex tests
- `engine/src/cards/card-parser-fixtures.ts` — curated `{ oracleText, expected }` pairs
- `engine/src/counters.test.ts` — counter lifecycle and interaction tests
- `engine/src/loop-detector.test.ts` — fingerprint hashing, buffer cycling, false-positive guards
- `engine/src/actions-public.test.ts` — one success + one per failure code for each `try*`
- `frontend/src/components/shelector/EndGameModal.tsx` — end-game UI

### Modified files

- `engine/src/actions.ts` — rewrite `entersTheBattlefieldTapped` with negation guard
- `engine/src/cards/card-parser-cache.ts` — rewrite five parser functions listed above
- `engine/src/effects/parser.ts` — fix P/T, loyalty regex; add counter-pattern token matchers
- `engine/src/effects/continuous.ts` — keyword counter → granted keyword layer
- `engine/src/state-based.ts` — planeswalker 0-loyalty SBA, poison ≥ 10 SBA
- `engine/src/turn-manager.ts` — stun counter consumption on untap step
- `engine/src/combat.ts` — fix the "No combat state" bug blocking `combat-damage-applies.test.ts`
- `engine/src/types.ts` — add `poisonCounters` to player; `GameEvent` union; stun counter key standardized
- `frontend/src/hooks/useShelectorGame.ts` — replace direct engine calls with `try*`; consume events; surface loop/win to modal
- `engine/src/ai/decision-engine.ts` and `engine/src/ai/legal-actions.ts` — use `try*` with retry budget of 5; pass priority on exhaustion

### Data flow — player action

```
UI click
  -> useShelectorGame.playLand(cardId)
  -> tryPlayLand(state, pid, cardId): ActionResult
     -> canPlayLand returns reason -> { ok: false, reason, message }
     -> else: internal playLand (may throw) caught by try*
        -> events collected: [LandPlayed]
        -> checkWinConditions(state, detector) -> merged into events
  -> hook: if ok, commit state; if events include PossibleLoop or PlayerLost, open modal
  -> if !ok, surface reason as toast ("can't play land: wrong phase")
```

### Data flow — AI turn

```
runAITurn
  -> chooseAction(state): AIAction
  -> try* corresponding to AIAction.kind
     -> !ok with 'illegal_target' | 'insufficient_mana': pick next candidate, retry (<= 5)
     -> !ok with 'internal_error': log, pass priority, continue
     -> ok: continue; checkWinConditions runs
       -> PossibleLoop during AI-only interaction: auto-resolve as AI combo, mark AI as winner if only human remains
       -> PossibleLoop with human involvement: halt AI, open modal
```

## Error Handling

- `try*` wrappers: known throw messages map to `ActionFailure` codes via explicit predicate checks. Unknown throws become `'internal_error'` with the original message preserved in `message` for the UI to log.
- `checkWinConditions` never throws. On internal errors, emits `GameEvent: WinCheckFailed` and returns `{ losers: [], loop: undefined }` so the game continues.
- `LoopDetector` is defensive. False-positive fingerprint collisions cost one modal prompt; the modal's "Play it out" branch advances one action and re-checks. If the same signature reappears after 3 more rounds, the modal escalates with a "this appears to be a true loop — declare as draw?" message.
- AI retry budget is 5 attempts per decision point. On exhaustion, AI passes priority and logs `aiStallFailure`. Prevents infinite retry loops.
- Internal engine throws remain for contract violations (e.g., `tapLandForMana` called on a card not on the battlefield). `try*` converts these to `'internal_error'` rather than surfacing them to users as stack traces.

## Testing

### Unit tests

- `actions-public.test.ts` — for each `try*`: one success case, one case per applicable `ActionFailure` code. ~60 tests total.
- `card-parser-cache.test.ts` — loads `card-parser-fixtures.ts`; each fixture asserts expected parsed output. Includes tricky cases:
  - "doesn't enter the battlefield tapped"
  - "enters the battlefield tapped unless you control a Mountain"
  - "{T}, Sacrifice ~: Add one mana of any color"
  - Hybrid mana (`{U/R}`) in equip cost
  - Loyalty abilities with `+1`, `-3`, `-8`, and `0:`
  - P/T patterns with `+0/+2`, `-1/+0`
  - Self-reference (`~`) substitution through a full parse
- `win-conditions.test.ts` — one test per terminal reason. Plus loop scenarios:
  - Basalt Monolith + Rings of Brighthearth infinite mana (fingerprint repeat)
  - Worldgorger Dragon + Animate Dead (trigger self-loop)
  - Aetherflux Reservoir + Bolas's Citadel mill/life-swing scenario (unbounded growth via life or mill count exceeding the threshold in one action chain)
  - False-positive guard: same land tapped/untapped across two normal turns does NOT trigger
- `loop-detector.test.ts` — fingerprint hash collision resistance, buffer wraparound, reset at action boundaries
- `counters.test.ts` — +1/+1 and -1/-1 cancel, loyalty add/remove and 0-loyalty death, stun counter consumes one untap then clears, keyword counter grants and revokes keyword, charge counter accumulation and consumption, poison accumulation across multiple sources and 10-poison loss

### Integration tests

- `shelector-game-loop.test.ts` — full game from deck import through several turns, triggers a loop scenario, asserts `PossibleLoop` event fires with correct signature and category.
- Fix `combat-damage-applies.test.ts` — the "No combat state" flow bug in `combat.ts`.
- Fix `shelector-real-playtest.test.ts` — skip gracefully if `localhost:8100` is unavailable rather than fail.

### Acceptance criteria

- All 830 existing tests continue to pass.
- All new tests pass.
- `cd engine && npm run test` shows 0 failures.
- Manual smoke test: import a deck, play 5 turns, cast a spell, observe win-condition modal by dropping to 0 life.

## Dependencies and Order

Three phases. Each phase leaves tests green before the next begins.

**Phase 1 — Action Result API (no behavioral change).** Build `actions-public.ts`, migrate `useShelectorGame.ts` and the AI call sites. Existing action functions and all 830 tests unchanged. New test file `actions-public.test.ts` passes.

**Phase 2 — Regex rewrite and counters.** Fixture corpus, parser-cache rewrites, counter parsing and continuous-effects, stun/poison/planeswalker SBAs. Existing tests stay green; new tests pass.

**Phase 3 — Win condition system and UI.** `win-conditions.ts`, `LoopDetector`, end-game modal, hook event consumption. Fix `combat-damage-applies.test.ts`. Full integration test passes.

## Open Questions

None requiring a blocking decision. Two minor items that can be decided during implementation:

- Exact thresholds for loop detection (3 fingerprint repeats, 50 re-triggers, 1000 life/mana swing) — tune against the fixture combos if they produce false positives.
- Whether to persist the `LoopDetector` state in save-game snapshots. Default: no (rebuild from recent action history on resume).

