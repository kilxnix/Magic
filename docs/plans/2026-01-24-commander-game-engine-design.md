# Commander Game Engine — Design Document

## Overview

A fully offline, on-device MTG Commander rules engine in TypeScript, integrated with the existing deck generator. Players test their generated decks against 1-3 AI opponents in full Commander games with save/resume support. Deployed as a React Native mobile app.

## Approach

**Hybrid architecture:**
- Core rules engine (phases, stack, priority, state-based actions, combat) inspired by MTG Forge's proven design, ported faithfully to TypeScript
- Card effect system built fresh — oracle text is parsed into atomic effect primitives so ~94% of cards work automatically without manual coding
- Complex cards (Doubling Season, Panharmonicon, etc.) get manual override definitions

## Architecture

```
┌─────────────────────────────────────────────────┐
│                React Native UI                   │
│  (battlefield-first, floating stats, hand overlay)│
├─────────────────────────────────────────────────┤
│              Game State Manager                  │
│  Zones │ Stack │ Turn Structure │ Priority       │
│  Combat Manager │ State-Based Actions            │
├─────────────────────────────────────────────────┤
│              Effect System                       │
│  Oracle Text Parser │ Effect Primitives          │
│  Targeting │ Triggers & Conditions               │
│  Replacement Effects │ Continuous Effects/Layers │
├─────────────────────────────────────────────────┤
│           Card Definition Layer                  │
│  oracle_text → parsed effects → game actions     │
│  + manual overrides for complex cards            │
├─────────────────────────────────────────────────┤
│              AI Decision Engine                  │
│  Evaluator │ Threat Assessment │ Personalities   │
└─────────────────────────────────────────────────┘
```

## Core Rules Engine

### Zones (7 types)
- Library (ordered, private), Hand (private), Battlefield (public)
- Graveyard (public, ordered), Exile (public), Stack (public), Command Zone (public)

### Turn Structure
Untap → Upkeep → Draw → Main 1 → Combat (Begin → Declare Attackers → Declare Blockers → Damage → End) → Main 2 → End → Cleanup

Priority passes between all players at each step.

### Stack Resolution
1. Player takes action (cast/activate)
2. Action goes on stack
3. Check triggers → triggered abilities go on stack (APNAP order)
4. Active player gets priority (can add more or pass)
5. Priority passes to each opponent in turn order
6. All players pass in sequence → top item resolves
7. Check state-based actions → check new triggers → repeat
8. Stack empty → proceed

### State-Based Actions
- Creature toughness ≤ 0 → dies
- Player life ≤ 0 → loses
- Draw from empty library → loses
- Commander damage ≥ 21 from one commander → loses
- Legendary rule (two same-name → controller chooses one)
- +1/+1 and -1/-1 counters cancel
- Planeswalker 0 loyalty → dies
- Aura/equipment with invalid target → goes to graveyard

### Commander-Specific Rules
- Commander damage tracked per-opponent per-commander
- Command zone: can cast from there, +{2} tax per previous cast
- Commander dies/exiled → owner chooses command zone or normal destination
- Color identity enforced at deck building (existing generator handles this)
- Multiplayer priority: turn order clockwise from active player

## Effect System

### Effect Primitives (~30 building blocks)

**Movement:**
- Draw(player, count)
- Discard(player, count, filter?)
- Destroy(target)
- Exile(target)
- Sacrifice(player, filter?)
- ReturnToHand(target)
- ReturnFromGraveyard(target, zone)
- MillCards(player, count)
- SearchLibrary(player, filter, zone)

**Damage/Life:**
- DealDamage(source, target, amount)
- GainLife(player, amount)
- LoseLife(player, amount)

**Battlefield:**
- CreateToken(player, token_def, count)
- AddCounters(target, type, count)
- RemoveCounters(target, type, count)
- Tap(target) / Untap(target)
- GainControl(player, target)

**Modifiers:**
- ModifyPT(target, power, toughness)
- GrantAbility(target, keyword)
- SetProtection(target, quality)

**Resources:**
- AddMana(player, colors, amount)
- ReduceCost(filter, amount)

### Oracle Text Parser

Breaks card text into structured effect trees:

```
"When ~ enters the battlefield, destroy target creature an opponent controls."
→ { trigger: ETB(self), target: creature(opponent), effects: [Destroy(target)] }

"At the beginning of your upkeep, draw a card and lose 1 life."
→ { trigger: PhaseStart(upkeep, controller), effects: [Draw(controller,1), LoseLife(controller,1)] }
```

### Trigger Types
- Event: ETB, Dies, Attacks, OnCast, OnDamage, OnLifeGain
- Phase: PhaseStart(phase, player)
- State: continuous condition checks
- Replacement: "If would… instead" (don't use stack)

### Keywords (handled natively)
Flying, trample, first strike, double strike, deathtouch, lifelink, haste, vigilance, reach, menace, ward, hexproof, shroud, indestructible, flash, defender

## AI Decision Engine

### Decision Layers
1. **Legal Actions** — what can the AI do right now?
2. **Card Evaluation** — score each action by board impact
3. **Threat Assessment** — who's winning? who attacked me? gang-up logic
4. **Timing** — hold removal? counter now or wait? leave mana open?

### Difficulty Levels (aligned with Commander brackets)

| Bracket | Behavior |
|---------|----------|
| 1-2 | Plays on curve, attacks randomly, doesn't hold interaction |
| 3 | Targets biggest threat, holds some removal, basic sequencing |
| 4 | Threat assessment, sandbagging, reads open mana, retaliates |
| 5 | Optimal sequencing, combo awareness, bluff reads, politics |

### AI Personalities
- **Aggressive** — swings wide, pressures life totals, hits open players
- **Greedy** — ramps hard, ignores threats, goes for big plays
- **Political** — distributes damage, retaliates, targets the archenemy
- **Balanced** — adapts to board state, plays "correctly"

Lower difficulty AIs make "mistakes" — hitting weak players for resources, ignoring the actual threat, overcommitting into board wipes.

## Game Persistence

Full game state serialized to JSON, stored locally (AsyncStorage/SQLite):
- All zone contents per player (with card state: tapped, counters, attachments)
- Stack contents, priority holder, current phase/step
- Continuous effects, pending triggers
- Commander damage matrix, commander tax counts
- AI profiles (personality + difficulty)
- Links back to deck generator deck IDs

Multiple saved games supported.

## Mobile UI Design

### Battlefield-First Layout
- Your board always visible (bottom half of screen)
- Opponent boards explorable between phases (swipe/tap to browse)
- All stats/info as floating, draggable, dismissable overlays

### Floating Elements
- Life total badges (tap to expand: commander damage, poison)
- Phase/turn indicator (corner gem, tap to expand)
- Stack icon (badge with count, tap for full stack view)
- Graveyard/exile pile icons (tap to browse)
- Mana pool (appears only when mana is floating)

### Hand
- Hidden by default (maximizes battlefield)
- Swipe up from bottom to reveal as overlay
- Auto-hides after passing priority
- Card count badge always visible

### Interactions
- Tap permanent → tap it
- Long-press → card detail/zoom
- Drag from hand → cast (engine validates)
- Tap valid targets (highlighted/glowing)
- Tap creatures → declare attackers → tap opponent to attack
- Drag blockers onto attackers

### Table View (pinch-zoom out)
4-quadrant overhead view showing all players' boards condensed. Tap a quadrant to zoom in.

## Build Phases

| Phase | Milestone |
|-------|-----------|
| 1 | Core rules: turns, phases, priority, lands, mana |
| 2 | Stack + casting: spells go on stack, resolve, pay costs |
| 3 | Combat: attackers, blockers, damage, creatures die |
| 4 | Effect parser (basic): destroy, draw, ETB, simple targets |
| 5 | Keywords: flying, trample, deathtouch, lifelink, haste, etc. |
| 6 | Triggers + SBAs: "whenever" fires, 0 toughness dies, legend rule |
| 7 | Commander rules: command zone, tax, cmdr damage, multiplayer |
| 8 | Basic AI: plays on curve, attacks favorably, uses removal |
| 9 | Mobile UI: playable game, battlefield view, hand overlay, stats |
| 10 | Effect parser (advanced): modal, X costs, replacement, tokens |
| 11 | AI personalities: difficulty levels, politics, grudges |
| 12 | Save/resume: pause mid-game, pick up later |
| 13 | Deck generator integration: "Test this deck" launches a game |

**Phase 1-3:** Working game — lands, vanilla creatures, combat.
**Phase 4-6:** Feels like Magic — spells do things, triggers fire.
**Phase 7-9:** Playable Commander on phone.
**Phase 10-13:** Polished, integrated with deck generator.

## Dependencies

- React Native (Expo or bare)
- TypeScript
- AsyncStorage or expo-sqlite for persistence
- React Native Gesture Handler (drag, swipe, pinch)
- React Native Reanimated (card animations)
- Existing cards_min.jsonl (30k cards with oracle_text) as card database

## Target Metrics

- 94% of cards work automatically through oracle text parsing
- AI responds within 2 seconds per decision on-device
- Full game state saves in <100ms
- Supports 2-4 player Commander games
- Fully offline — no network calls during gameplay
