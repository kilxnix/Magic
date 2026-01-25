# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MTG Commander deck generation and playtesting platform. Two core systems:

1. **Deck Generator** — FastAPI backend + React frontend. Uses semantic search (FAISS + SentenceTransformers) for card similarity, fine-tuned GPT2/Qwen models for card scoring, and comprehensive Commander rules enforcement. Generates 100-card Commander decks tailored to power levels (brackets 1-5), themes, and budgets.

2. **Commander Game Engine** — Fully offline TypeScript rules engine for playtesting generated decks. Players test decks against 1-3 AI opponents in full Commander games with save/resume. Deployed as a React Native mobile app. No internet required during gameplay.

The game engine uses a hybrid approach: core rules (stack, priority, phases, combat, state-based actions) ported from MTG Forge's proven design, with a novel oracle text parser that automatically converts card text into executable game actions (~94% card coverage target).

## Development Commands

```bash
# Start full application (backend + frontend)
./start.sh

# Backend only (port 8000, run from project root)
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Frontend only (port 5173, proxies /api to backend)
cd frontend && npm run dev

# Build frontend for production
cd frontend && npm run build

# Run backend tests
pytest backend/tests/

# Run single test file
pytest backend/tests/test_functional_tags.py -v

# Rebuild FAISS index and embeddings
python -m data.data_pipeline download extract embed index

# Download card images (long-running, resumable)
python -m backend.download_card_images

# Game engine (TypeScript)
cd engine && npm install
cd engine && npm run build
cd engine && npm run test

# Mobile app (React Native)
cd mobile && npm install
cd mobile && npm start
```

## Architecture

### Backend (`backend/`)

FastAPI server on port 8000:

- **main.py** - REST API endpoints: `/api/generate-deck`, `/api/commanders`, `/api/search-cards`, `/api/card-image/{name}`, `/api/brackets`, `/api/budget-tiers`, `/api/deck/{id}`, `/api/card-alternatives`, `/api/optimize-deck`, `/api/card-prices`, `/api/health`
- **deck_generator.py** - Core `DeckGenerator` class: loads FAISS index, searches for synergy cards, builds 100-card decks with mana curve balancing
- **rules.py** - Commander brackets (1-5), banned list (48 cards), card categories (ramp, removal, tutors, game changers)
- **database.py** - SQLite storage for generated decks (`data/decks.db`) and cached card images (`data/card_images.db`)
- **price_service.py** - Scryfall/MTGJson price fetching with memory + disk cache
- **model_scorers.py** - GPT2Scorer and QwenScorer for card similarity (perplexity-based, 0-1 scale)
- **functional_tags.py** - Regex-based card ability detection (removal, ramp, card-draw, tutor, etc.)
- **card_alternatives.py** - Ensemble card substitution finder with scoring breakdowns

### Frontend (`frontend/`)

React + TypeScript + Vite on port 5173:

- **pages/GeneratorPage.tsx** - Commander selection, bracket/theme/budget inputs, deck generation UI
- **pages/DeckViewerPage.tsx** - Full deck display with export formats (Moxfield, Archidekt, MTGO)
- **pages/OptimizerPage.tsx** - Card alternatives finder and deck optimization
- **components/** - DeckDisplay, DeckHistory, CardImage (with Scryfall fallback), CardAlternatives, DeckOptimizer, LiveRibbon
- **types.ts** - TypeScript interfaces for Deck, Commander, Bracket, DeckRequest, CardAlternative

Routes: `/` (generator), `/deck/:id` (viewer), `/optimizer` (optimizer)

### Data Pipeline (`data/` and `mtg_data/`)

- **data/data_pipeline.py** - `MTGDataPipeline` class: downloads Scryfall bulk data, extracts Commander-legal cards, builds 384-dim embeddings, creates FAISS index
- **mtg_data/cards_min.jsonl** - ~30k minimal card objects (id, name, type_line, oracle_text, mana_cost, cmc, colors, color_identity, keywords, legalities, rarity, prices)
- **mtg_data/card_embeddings.npy** - NumPy array (30000, 384) float32
- **mtg_data/card_index.faiss** - FAISS flat index for semantic search

### Game Engine (`engine/`)

TypeScript rules engine — fully offline Commander gameplay:

- **core/game-state.ts** - Master state: players, zones, turn tracking, multiplayer
- **core/turn-manager.ts** - Phase/step progression, priority passing (APNAP for multiplayer)
- **core/stack.ts** - LIFO stack, resolution, trigger checking after each resolution
- **core/state-based.ts** - SBA checks: 0 toughness, 21 commander damage, legend rule, empty library
- **core/combat.ts** - Attackers, blockers, damage assignment, first strike, trample
- **core/mana.ts** - Mana pool, cost payment, {X} handling, color requirements
- **core/commander.ts** - Command zone, tax, commander damage tracking, zone-change replacement
- **effects/parser.ts** - Oracle text → effect tree (target: 94% automatic card coverage)
- **effects/primitives.ts** - ~30 atomic effects: Draw, Destroy, DealDamage, CreateToken, etc.
- **effects/targeting.ts** - Target validation, legal targets, "each/all" resolution
- **effects/triggers.ts** - ETB, dies, cast, phase, state triggers
- **effects/replacement.ts** - "If would… instead" effects (don't use stack)
- **effects/continuous.ts** - Layers system, timestamps, granted abilities
- **effects/keywords.ts** - Flying, trample, deathtouch, lifelink, haste, vigilance, etc.
- **effects/modal.ts** - "Choose one/two", kicker, entwine, X costs
- **ai/evaluator.ts** - Board state scoring, card value heuristics
- **ai/threat-assessment.ts** - Multiplayer threat ranking, gang-up logic
- **ai/decision-engine.ts** - Action selection per difficulty (brackets 1-5)
- **ai/personalities.ts** - Aggressive, greedy, political, balanced AI profiles
- **cards/card-loader.ts** - Loads cards_min.jsonl, parses into Card objects
- **cards/overrides/** - Manual effect definitions for complex cards
- **persistence/save-load.ts** - Full game state serialization to JSON

### Mobile App (`mobile/`)

React Native — battlefield-first Commander UI:

- **screens/GameScreen.tsx** - Full battlefield view (your board always visible)
- **screens/HandOverlay.tsx** - Swipe-up hand panel (hidden by default)
- **screens/OpponentExplorer.tsx** - Browse opponent boards between phases
- **screens/StackOverlay.tsx** - Stack visualization overlay
- **screens/TableView.tsx** - Pinch-zoom 4-player overhead view
- **screens/SavedGames.tsx** - Resume game list
- **components/** - Permanent, FloatingBadge, PhaseIndicator, TargetHighlight, CardZoom
- **hooks/useGameEngine.ts** - Connects UI to engine, dispatches player actions
- **hooks/useAI.ts** - Runs AI decisions in background thread

## Key Constants

**Commander Brackets:**
1. Exhibition (1-3) - No combos, game changers, or MLD
2. Core (3-5) - Precon level, synergy-focused
3. Upgraded (5-7) - Up to 3 game changers allowed
4. Optimized (7-9) - No restrictions except banned list
5. cEDH (9-10) - Tournament competitive

**Ensemble Scoring Weights (card_alternatives.py):**
- FAISS semantic search: 30%
- GPT2 model scoring: 25%
- Qwen model scoring: 25%
- Functional tag matching: 20%

**Mana Curve Targets (deck_generator.py):**
0 CMC (2%), 1 CMC (8%), 2 CMC (20%), 3 CMC (22%), 4 CMC (18%), 5 CMC (12%), 6 CMC (10%), 7+ CMC (8%)

**Price Tiers:** Budget (<$1), Affordable ($1-5), Moderate ($5-20), Premium ($20-50), High-End (>$50)

## API Rate Limiting

Scryfall requires 100ms delay between requests. Code uses `time.sleep(0.1)` and exponential backoff on 429 responses.

## Data Storage

SQLite databases in `data/`:
- `decks.db` - Generated deck records
- `card_images.db` - Cached Scryfall images (~3.7GB)
- `price_history.db` - Price tracking for analytics

## Game Engine Constants

**Effect Primitives:** Draw, Discard, Destroy, Exile, Sacrifice, ReturnToHand, ReturnFromGraveyard, MillCards, SearchLibrary, DealDamage, GainLife, LoseLife, CreateToken, AddCounters, RemoveCounters, Tap, Untap, GainControl, ModifyPT, GrantAbility, SetProtection, AddMana, ReduceCost

**Trigger Types:** ETB, Dies, Attacks, OnCast, OnDamage, OnLifeGain, PhaseStart, StateCheck, Replacement

**AI Difficulty (aligned with brackets):**
- Bracket 1-2: Plays on curve, attacks randomly, no interaction holding
- Bracket 3: Targets biggest threat, holds removal, basic sequencing
- Bracket 4: Threat assessment, sandbagging, reads open mana, retaliates
- Bracket 5: Optimal sequencing, combo awareness, politics

**AI Personalities:** Aggressive (swings wide, hits open players), Greedy (ramps, ignores threats), Political (distributes damage, retaliates), Balanced (adapts to board state)

**Build Phases:**
1. Core rules (turns, phases, priority, lands, mana)
2. Stack + casting (spells resolve, mana payment)
3. Combat (attackers, blockers, damage)
4. Effect parser basic (destroy, draw, ETB, simple targets)
5. Keywords (flying, trample, deathtouch, lifelink, haste, etc.)
6. Triggers + SBAs (whenever fires, 0 toughness dies, legend rule)
7. Commander rules (command zone, tax, commander damage, multiplayer)
8. Basic AI (plays on curve, attacks favorably, uses removal)
9. Mobile UI (battlefield view, hand overlay, floating stats)
10. Effect parser advanced (modal, X costs, replacement, tokens)
11. AI personalities (difficulty levels, politics, grudges)
12. Save/resume (pause mid-game, pick up later)
13. Deck generator integration ("Test this deck" launches game)

## Design Documents

- `docs/plans/2026-01-24-commander-game-engine-design.md` - Full game engine design (architecture, effect system, AI, UI, build phases)

## Environment Variables (optional)

```
SUPABASE_URL  # For cloud storage sync
SUPABASE_KEY
```

## Current Progress

**Game Engine Status:** Phase 8 — Basic AI (complete)
- Phases 1-8 complete (332 tests passing)
- AI module: `engine/src/ai/` with types, legal-actions, evaluate, targeting, agent
- Next: Phase 9 — Mobile UI (battlefield view, hand overlay, floating stats)
