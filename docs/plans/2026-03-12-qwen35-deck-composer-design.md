# Qwen3.5-4B Deck Composer — Design Document

**Date:** 2026-03-12
**Status:** Approved
**Goal:** Replace FAISS-only deck generation with a fine-tuned Qwen3.5-4B model that produces human-like Commander decklists.

## Overview

Train a Qwen3.5-4B-Instruct model with two LoRA adapters:
- **mtg-scorer** — rates card-commander fit (0-10 with explanation)
- **mtg-composer** — generates structured 99-card decklists grouped by role

Two-stage architecture: FAISS narrows ~300 candidates, model composes the final 99, validation layer catches errors.

## 1. Data Pipeline

### Problem
Existing `commander_decks.json` (12,660 decks) is mostly unusable — only 220 decks have a valid commander field AND 95+ cards. The "commander" field frequently contains a random card name rather than the actual commander.

### Scraping Sources

| Source | Target Volume | Priority | Notes |
|--------|--------------|----------|-------|
| Moxfield | 40k+ decks | Primary | Public API, explicit commander field, popularity sort |
| Archidekt | 15k+ decks | Secondary | Public deck browser, format filter |
| EDHREC | ~3,700 average decks | Curated | One consensus deck per commander — gold-standard data |

Rate limits: 200ms between requests for Moxfield/Archidekt, 500ms for EDHREC. All scraping is resumable.

### Quality Filters

```
Raw decks (~60k)
  → Filter: exactly 100 cards (incl. commander)        → ~50k
  → Filter: commander is valid legendary creature       → ~48k
  → Filter: all cards resolve in cards_min.jsonl        → ~45k
  → Deduplicate: >90% card overlap = same deck          → ~40k
  → Enrich: add oracle text, CMC, colors from card DB
  → Categorize: tag each card's role via functional_tags.py
  → Estimate bracket: count tutors, combos, fast mana per rules.py
  → Split: 90% train / 5% validation / 5% test
```

### Storage
`data/training_decks.jsonl` — one deck per line:
```json
{
  "commander": "Atraxa, Praetors' Voice",
  "partner": null,
  "cards": ["Doubling Season", "Deepglow Skate", ...],
  "lands": ["Command Tower", "Breeding Pool", ...],
  "tags": {"ramp": 10, "removal": 8, "draw": 10},
  "source": "moxfield",
  "bracket_estimate": 3
}
```

## 2. Training Data Formats

### Stage 1 — Scorer Dataset

Card-commander fit rating pairs. ~500k examples from ~40k decks (10 per deck).

**Positive pair (card in deck):**
```
<|im_start|>system
You are an MTG Commander deckbuilding expert. Rate how well a card fits in this commander's deck.<|im_end|>
<|im_start|>user
Commander: Atraxa, Praetors' Voice (WUBG)
Theme: Superfriends
Bracket: 3
Card: Doubling Season
Type: Enchantment
Cost: {4}{G}
Text: If an effect would create one or more tokens under your control, it creates twice that many instead. If an effect would put one or more counters on a permanent you control, it puts twice that many instead.
Rate this card's fit from 0-10.<|im_end|>
<|im_start|>assistant
9 - Doubling Season is a cornerstone of Atraxa Superfriends. It doubles loyalty counters from planeswalker ETBs, often enabling immediate ultimates. The green cost fits Atraxa's color identity perfectly.<|im_end|>
```

- **Positive pairs:** Cards in the deck → scores 7-10, explanation from synergy analysis
- **Hard negatives:** Same-color cards NOT in the deck → scores 1-5
- **Easy negatives:** Wrong color identity → score 0

### Stage 2 — Composer Dataset

Full deck generation. ~40k examples (one per deck).

```
<|im_start|>system
You are an expert MTG Commander deckbuilder. Build a 99-card deck for the given commander.<|im_end|>
<|im_start|>user
Commander: Atraxa, Praetors' Voice
Colors: WUBG
Bracket: 3
Theme: Superfriends<|im_end|>
<|im_start|>assistant
## Ramp (10)
Sol Ring
Arcane Signet
Fellwar Stone
...
## Card Draw (10)
Sylvan Library
Rhystic Study
...
## Removal (8)
Swords to Plowshares
Anguished Unmaking
...
## Lands (36)
Command Tower
Breeding Pool
...<|im_end|>
```

Cards grouped by functional role — teaches the model deck *structure* (role balance, category quotas), not just card names.

## 3. Model Architecture & Training

### Base Model
**Qwen3.5-4B-Instruct** — newest architecture (Feb 2026), dense 4B params, fits 16GB 5070 Ti at Q8 (~5GB) or FP16 (~8GB).

### Two LoRA Adapters on One Base

| Parameter | Scorer (Adapter A) | Composer (Adapter B) |
|-----------|-------------------|---------------------|
| LoRA rank | 16 | 32 |
| LoRA alpha | 32 | 64 |
| Target modules | q,k,v,o,gate,up,down_proj | same |
| Batch size | 16 | 4 |
| Gradient accumulation | 2 | 8 |
| Learning rate | 2e-4 | 1e-4 |
| Epochs | 3 | 5 |
| Max seq length | 512 | 4096 |
| Warmup ratio | 0.05 | 0.05 |
| Quantization | 4-bit QLoRA | 4-bit QLoRA |
| Est. training time (A100) | ~1 hour | ~3-4 hours |
| Trainable params | ~20M | ~40M |

### Why One Base + Two Adapters
- Load 4B params into VRAM once (~8GB)
- Swap adapters in <100ms
- Half the disk space vs two full models
- Same Unsloth training pipeline for both

### Post-Training
1. Merge LoRA weights into base model
2. Export to GGUF Q8_K_M for local inference
3. Serve via `llama-cpp-python` (drop-in replacement for current QwenScorer)

### Evaluation Metrics
- **Scorer:** Spearman correlation between predicted scores and actual deck inclusion on 5% holdout
- **Composer:** % cards legal for color identity, functional role coverage (ramp/draw/removal present), Jaccard overlap with real human decks for same commander

## 4. Integration with Existing System

### New Deck Generation Flow

```
User Request (commander, bracket, theme, budget)
  │
  ├─ Stage 1: CANDIDATE NARROWING (fast, ~200ms)
  │   ├─ FAISS semantic search → top 300 candidates (existing)
  │   ├─ Color identity filter (existing rules.py)
  │   ├─ Bracket restriction filter (existing rules.py)
  │   └─ Budget filter (existing price_service.py)
  │
  ├─ Stage 2: MODEL COMPOSITION (slower, ~10-30s on 5070 Ti)
  │   ├─ Feed commander + constraints + 300 candidates to mtg-composer
  │   ├─ Model outputs structured 99-card list grouped by role
  │   └─ Falls back to current FAISS pipeline if model unavailable
  │
  └─ Stage 3: VALIDATION & REPAIR (fast, ~50ms)
      ├─ Verify all cards exist in cards_min.jsonl
      ├─ Verify color identity compliance
      ├─ Verify banned list compliance
      ├─ Check mana curve isn't wildly off
      ├─ Fill gaps (if model outputs <99 valid cards, backfill from FAISS)
      └─ Return final 100-card deck
```

### Key Design Decisions
1. **FAISS stays** — fast first filter, keeps model context window manageable
2. **Model is optional** — graceful fallback to existing pipeline if no GPU/missing files
3. **Validation catches hallucinations** — backfills invented card names from FAISS
4. **Scorer replaces both GPT2Scorer and QwenScorer** — one better model instead of two weak ones

### File Structure

```
backend/
  model_scorers.py          ← update: add Qwen35Scorer, keep old as fallback
  deck_generator.py         ← update: add model-based composition path
  model_composer.py         ← new: deck composition via mtg-composer adapter
models/
  Qwen35/
    base/                   ← Qwen3.5-4B-Instruct GGUF (Q8, ~5GB)
    adapters/
      mtg-scorer/           ← LoRA adapter files
      mtg-composer/         ← LoRA adapter files
training/
  scrape_decks.py           ← data scraping pipeline (Moxfield, Archidekt, EDHREC)
  prepare_scorer_data.py    ← generate scorer training pairs
  prepare_composer_data.py  ← generate composer training sequences
  train_scorer.ipynb        ← Colab notebook for scorer adapter
  train_composer.ipynb      ← Colab notebook for composer adapter
  evaluate.py               ← evaluation metrics
```

## 5. Hardware & Infrastructure

| Stage | Hardware | Time |
|-------|----------|------|
| Scraping | Any machine (CPU) | ~4-6 hours |
| Data prep | Any machine (CPU) | ~30 minutes |
| Scorer training | Google Colab Pro A100 | ~1 hour |
| Composer training | Google Colab Pro A100 | ~3-4 hours |
| Evaluation | Colab or local | ~2 hours |
| Local inference | 5070 Ti (16GB VRAM) | ~10-30s per deck |

### Local Inference Requirements (5070 Ti)
- Qwen3.5-4B Q8 GGUF: ~5GB VRAM
- LoRA adapter loaded: +negligible
- KV cache (4096 context): ~1-2GB
- Total: ~7GB — well within 16GB budget
