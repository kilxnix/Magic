# Price-Aware Card Alternatives System

## Overview

A system that finds cheaper alternatives to MTG cards using ensemble ranking with FAISS semantic search, GPT2, and Qwen models. Includes automatic daily updates for card data and prices from multiple vendors.

## Features

1. **Card Browser** - Select any card, see cheaper alternatives with trade-off explanations
2. **Deck Optimizer** - Analyze a deck, suggest swaps to reduce total cost
3. **Multi-Vendor Prices** - TCGPlayer, CardKingdom, Cardmarket with purchase links
4. **Daily Updates** - Automatic refresh of card data, prices, and images

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Card Alternative Finder                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  User Query: "Find cheaper alternative to Swords to Plowshares" │
│                            │                                     │
│                            ▼                                     │
│  ┌─────────────────────────────────────────┐                    │
│  │  FAISS Semantic Search                   │                    │
│  │  - Find 20 similar cards by effect       │                    │
│  └─────────────────────────────────────────┘                    │
│                            │                                     │
│              ┌─────────────┼─────────────┐                      │
│              ▼             ▼             ▼                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐             │
│  │ GPT2 Model   │ │ Qwen Model   │ │ Price Filter │             │
│  │ Score: 0-1   │ │ Score: 0-1   │ │ (< original) │             │
│  └──────────────┘ └──────────────┘ └──────────────┘             │
│              │             │             │                       │
│              └─────────────┼─────────────┘                      │
│                            ▼                                     │
│  ┌─────────────────────────────────────────┐                    │
│  │  Ensemble Ranker                         │                    │
│  │  - Combine scores with weights           │                    │
│  │  - Return top 5 alternatives             │                    │
│  └─────────────────────────────────────────┘                    │
│                            │                                     │
│                            ▼                                     │
│  ┌─────────────────────────────────────────┐                    │
│  │  Trade-off Explainer (Qwen)              │                    │
│  │  "Path to Exile is $4 cheaper but        │                    │
│  │   gives opponent a land"                 │                    │
│  └─────────────────────────────────────────┘                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Model

### Enhanced Card Structure

```json
{
  "name": "Swords to Plowshares",
  "oracle_text": "Exile target creature. Its controller gains life...",
  "type_line": "Instant",
  "cmc": 1,
  "mana_cost": "{W}",
  "color_identity": ["W"],
  "functional_tags": ["removal", "exile", "instant-speed"],
  "prices": {
    "tcgplayer": {"usd": 2.50, "url": "https://tcgplayer.com/..."},
    "cardkingdom": {"usd": 2.99, "url": "https://cardkingdom.com/..."},
    "cardmarket": {"eur": 1.80, "url": "https://cardmarket.com/..."}
  },
  "price_updated_at": "2026-01-20T00:00:00Z"
}
```

### Price History Table

```sql
CREATE TABLE price_history (
  card_name TEXT,
  source TEXT,       -- tcgplayer, cardkingdom, cardmarket
  price_usd REAL,
  recorded_at TIMESTAMP,
  PRIMARY KEY (card_name, source, recorded_at)
);
```

### Functional Tags

Auto-detected from oracle text using pattern matching:

| Tag | Patterns |
|-----|----------|
| ramp | `add {.}`, `add .* mana`, `search .* library .* land` |
| removal | `destroy target`, `exile target`, `deals \d+ damage to` |
| card-draw | `draw .* card`, `scry \d+` |
| counter | `counter target` |
| protection | `hexproof`, `indestructible`, `protection from` |
| recursion | `return .* from .* graveyard` |

## Ensemble Ranking

### Score Formula

```
Final Score = (FAISS_score × 0.3) + (GPT2_score × 0.25) + (Qwen_score × 0.25) + (Category_match × 0.2)
```

### Component Weights

| Component | Weight | What it measures |
|-----------|--------|------------------|
| FAISS semantic | 0.3 | Text/effect similarity |
| GPT2 model | 0.25 | MTG-specific card quality fit |
| Qwen model | 0.25 | Commander context relevance |
| Category match | 0.2 | Functional tag overlap |

### Category Boost

- Cards sharing functional tags with source card get boosted
- If user explicitly requests a category ("cheaper ramp"), matching tags get extra 0.5 boost

## Daily Update Job

Runs at 3 AM daily via cron:

```
0 3 * * * sheltron cd /home/sheltron/Documents/Magic && ./venv/bin/python backend/daily_update.py
```

### Update Steps

1. **Fetch New Cards** - Download Scryfall bulk data, identify new/updated cards
2. **Update Prices** - Download MTGJson price data, update all card prices with vendor URLs
3. **Regenerate Embeddings** - Generate embeddings for new cards, rebuild FAISS index
4. **Download Images** - Fetch normal + small images for new cards
5. **Generate Tags** - Run pattern matching on new card oracle text

### Failure Handling

- Log errors but continue on partial failures
- Optional: Discord/email notification on failure
- Keep previous data if new fetch fails

## Models Used

| Model | Location | Purpose |
|-------|----------|---------|
| SentenceTransformer | `all-MiniLM-L6-v2` | FAISS embeddings |
| GPT2 | `models/GPT2 Model/` | Card quality scoring |
| Qwen | `models/QWEN Model/*.gguf` | Context relevance + trade-off explanations |

## API Endpoints

```
GET  /api/card/{name}/alternatives?max_price={price}
POST /api/deck/optimize
GET  /api/card/{name}/prices
GET  /api/update/status
POST /api/update/trigger  (manual trigger)
```

## Files to Create/Modify

- `backend/daily_update.py` - Update job script
- `backend/card_alternatives.py` - Ensemble ranking logic
- `backend/functional_tags.py` - Tag detection patterns
- `backend/model_scorers.py` - GPT2 and Qwen scoring
- `backend/price_service.py` - MTGJson price fetching
- `backend/main.py` - New API endpoints
- `frontend/src/components/CardAlternatives.tsx` - UI component
- `frontend/src/components/DeckOptimizer.tsx` - Deck optimization UI
