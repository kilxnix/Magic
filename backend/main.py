"""FastAPI backend for MTG Commander deck generation."""

import logging
from typing import List, Optional

import requests
from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.deck_generator import get_generator
from backend.rules import COMMANDER_BRACKETS, PRICE_TIERS
from backend.database import (
    init_db, save_deck, get_deck, get_recent_decks, get_decks_by_ids,
    init_images_db, get_card_image, get_image_stats, has_card_image
)
from backend.card_alternatives import get_alternative_finder, CardAlternative
from backend.price_service import get_card_prices, get_cheapest_price, get_price_category

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="MTG Commander Deck Generator",
    description="Generate Commander decks using semantic search and deck building rules",
    version="1.0.0"
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+):5173$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class DeckRequest(BaseModel):
    """Request model for deck generation."""
    commander: str = Field(..., description="Commander name (partial match supported)")
    bracket: int = Field(2, ge=1, le=5, description="Power level bracket (1-5)")
    theme: Optional[str] = Field(None, description="Optional deck theme/strategy")
    budget_tier: Optional[str] = Field(
        None,
        description="Budget tier: budget, affordable, moderate, premium, high_end"
    )


class DeckResponse(BaseModel):
    """Response model for generated deck."""
    id: str
    commander: str
    colors: List[str]
    archetype: str
    timestamp: str
    legal_status: str
    card_count: int
    estimated_price: str
    list: List[str]
    bracket: int
    bracket_name: str
    theme: str
    categories: dict


class CommanderInfo(BaseModel):
    """Commander information."""
    name: str
    colors: List[str]
    type_line: str
    mana_cost: Optional[str]
    oracle_text: Optional[str]


class SearchResult(BaseModel):
    """Search result for cards."""
    name: str
    type_line: str
    mana_cost: Optional[str]
    oracle_text: Optional[str]
    colors: List[str]
    score: float


class BracketInfo(BaseModel):
    """Bracket information."""
    id: int
    name: str
    description: str
    power_level: tuple
    expected_turns: Optional[int] = None


class DeckSummary(BaseModel):
    """Summary of a deck for listings."""
    id: str
    commander: str
    colors: List[str]
    bracket: int
    theme: str
    created_at: str


class BatchRequest(BaseModel):
    """Request for batch deck fetching."""
    ids: List[str] = Field(..., max_length=50, description="List of deck IDs")


class CardAlternativeResponse(BaseModel):
    """A card alternative with scoring details."""
    name: str
    oracle_text: str
    type_line: str
    mana_cost: str
    cmc: int
    color_identity: List[str]
    price_usd: Optional[float]
    price_category: str
    functional_tags: List[str]
    faiss_score: float
    gpt2_score: float
    qwen_score: float
    category_score: float
    final_score: float
    price_savings: float
    tradeoff_explanation: str
    purchase_links: dict


class AlternativesResponse(BaseModel):
    """Response for card alternatives lookup."""
    source_card: str
    source_price: Optional[float]
    alternatives: List[CardAlternativeResponse]


class DeckOptimizeRequest(BaseModel):
    """Request for deck optimization."""
    cards: List[str] = Field(..., description="List of card names in the deck")
    target_savings: Optional[float] = Field(None, description="Target dollar amount to save")
    max_swaps: int = Field(10, le=20, description="Maximum number of swaps to suggest")
    color_identity: Optional[List[str]] = Field(None, description="Commander color identity")


class SwapSuggestion(BaseModel):
    """A suggested card swap."""
    original_card: str
    original_price: float
    alternative: CardAlternativeResponse
    savings: float


class DeckOptimizeResponse(BaseModel):
    """Response for deck optimization."""
    total_savings: float
    swap_count: int
    suggestions: List[SwapSuggestion]


class CardPriceResponse(BaseModel):
    """Response for card price lookup."""
    name: str
    cheapest_usd: Optional[float]
    price_category: str
    vendors: dict


@app.on_event("startup")
async def startup_event():
    """Pre-load the deck generator and initialize databases."""
    logger.info("Initializing databases...")
    init_db()
    init_images_db()
    logger.info("Loading deck generator...")
    try:
        generator = get_generator()
        logger.info(f"Loaded {len(generator.cards)} cards")
    except Exception as e:
        logger.error(f"Failed to load deck generator: {e}")
        raise


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}


@app.post("/api/generate-deck", response_model=DeckResponse)
async def generate_deck(request: DeckRequest):
    """
    Generate a Commander deck.

    The deck follows Command Zone rules:
    - Max 34 lands
    - 10+ ramp cards
    - 10+ card draw
    - 8+ removal spells
    - 2+ wincons
    - Rest filled with synergy/theme cards

    Bracket restrictions are applied:
    - Bracket 1-2: No game changers, MLD, combos, extra turns
    - Bracket 3: Limited game changers (3), no MLD, limited combos
    - Bracket 4-5: No restrictions except banned list
    """
    import uuid
    from datetime import datetime

    generator = get_generator()

    # Validate budget tier if provided
    if request.budget_tier and request.budget_tier not in PRICE_TIERS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid budget_tier. Must be one of: {list(PRICE_TIERS.keys())}"
        )

    result = generator.generate_deck(
        commander_name=request.commander,
        bracket=request.bracket,
        theme=request.theme or "",
        budget_tier=request.budget_tier,
    )

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    deck_response = DeckResponse(
        id=str(uuid.uuid4())[:8],
        commander=result["commander"],
        colors=result["colors"],
        archetype=result["archetype"],
        timestamp=datetime.now().isoformat(),
        legal_status=result["legal_status"],
        card_count=result["card_count"],
        estimated_price=result["estimated_price"],
        list=result["list"],
        bracket=result["bracket"],
        bracket_name=result["bracket_name"],
        theme=result["theme"],
        categories=result["categories"],
    )

    # Save to database
    save_deck(deck_response.model_dump())
    logger.info(f"Saved deck {deck_response.id} to database")

    return deck_response


@app.get("/api/commanders", response_model=List[CommanderInfo])
async def list_commanders(
    query: Optional[str] = Query(None, description="Search query for commander name"),
    limit: int = Query(50, le=200, description="Maximum results")
):
    """List available commanders, optionally filtered by search query."""
    generator = get_generator()
    commanders = generator.get_commanders()

    if query:
        query_lower = query.lower()
        commanders = [c for c in commanders if query_lower in c.get('name', '').lower()]

    commanders = commanders[:limit]

    return [
        CommanderInfo(
            name=c.get('name', ''),
            colors=c.get('color_identity', []) or [],
            type_line=c.get('type_line', ''),
            mana_cost=c.get('mana_cost'),
            oracle_text=c.get('oracle_text'),
        )
        for c in commanders
    ]


@app.get("/api/search-cards", response_model=List[SearchResult])
async def search_cards(
    query: str = Query(..., description="Semantic search query"),
    limit: int = Query(20, le=100, description="Maximum results")
):
    """Search for cards using semantic search."""
    generator = get_generator()
    results = generator.search_cards(query, k=limit)

    return [
        SearchResult(
            name=c.get('name', ''),
            type_line=c.get('type_line', ''),
            mana_cost=c.get('mana_cost'),
            oracle_text=c.get('oracle_text'),
            colors=c.get('color_identity', []) or [],
            score=c.get('score', 0.0),
        )
        for c in results
    ]


@app.get("/api/brackets", response_model=List[BracketInfo])
async def list_brackets():
    """List all available power level brackets."""
    return [
        BracketInfo(
            id=bracket_id,
            name=info['name'],
            description=info['description'],
            power_level=info['power_level'],
            expected_turns=info.get('expected_turns'),
        )
        for bracket_id, info in COMMANDER_BRACKETS.items()
    ]


@app.get("/api/budget-tiers")
async def list_budget_tiers():
    """List available budget tiers."""
    return {
        tier: {"min": low, "max": high if high != float('inf') else None}
        for tier, (low, high) in PRICE_TIERS.items()
    }


@app.get("/api/deck/{deck_id}", response_model=DeckResponse)
async def get_deck_by_id(deck_id: str):
    """Fetch a saved deck by its ID."""
    deck = get_deck(deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")
    return DeckResponse(**deck)


@app.get("/api/recent-decks", response_model=List[DeckSummary])
async def list_recent_decks(limit: int = Query(20, le=50)):
    """Get the most recently generated decks (for ticker)."""
    decks = get_recent_decks(limit)
    return [
        DeckSummary(
            id=d['id'],
            commander=d['commander'],
            colors=d['colors'],
            bracket=d['bracket'],
            theme=d['theme'],
            created_at=d['timestamp'],
        )
        for d in decks
    ]


@app.post("/api/decks/batch", response_model=List[DeckResponse])
async def get_decks_batch(request: BatchRequest):
    """Fetch multiple decks by their IDs (for history hydration)."""
    decks = get_decks_by_ids(request.ids)
    return [DeckResponse(**d) for d in decks]


# Game launcher imports and endpoint
from backend.game_launcher import GameLaunchRequest, GameLaunchResponse, launch_game


@app.post("/api/launch-game", response_model=GameLaunchResponse)
async def launch_game_endpoint(request: GameLaunchRequest):
    """
    Launch a Commander game with the specified deck.

    This endpoint prepares a game session with:
    - The user's generated deck
    - 1-3 AI opponents with appropriate decks
    - Configurable difficulty and AI personalities

    Returns game setup info for the mobile app to initialize.
    """
    # Load the user's deck
    deck = get_deck(request.deck_id)
    if not deck:
        raise HTTPException(status_code=404, detail="Deck not found")

    # Launch the game
    try:
        response = launch_game(
            deck_data=deck,
            opponent_count=request.opponent_count,
            difficulty=request.difficulty,
            ai_personalities=request.ai_personalities,
        )
        return response
    except Exception as e:
        logger.error(f"Failed to launch game: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to launch game: {str(e)}")


class CardPrinting(BaseModel):
    """A single printing of a card."""
    id: str
    set_code: str
    set_name: str
    image_uri: Optional[str]
    collector_number: str


class CardPrintingsResponse(BaseModel):
    """Response for card printings lookup."""
    name: str
    printings: List[CardPrinting]


# Simple in-memory cache for card printings
_printings_cache: dict = {}


@app.get("/api/card-printings/{card_name:path}", response_model=CardPrintingsResponse)
async def get_card_printings(card_name: str):
    """
    Get all printings of a card from Scryfall.
    Results are cached to avoid hitting Scryfall rate limits.
    """
    import requests
    import time

    # Check cache first
    cache_key = card_name.lower()
    if cache_key in _printings_cache:
        cached = _printings_cache[cache_key]
        # Cache for 1 hour
        if time.time() - cached['timestamp'] < 3600:
            return CardPrintingsResponse(name=card_name, printings=cached['printings'])

    # Query Scryfall for all printings
    try:
        # Use exact name search with unique prints
        url = f"https://api.scryfall.com/cards/search"
        params = {
            "q": f'!"{card_name}"',
            "unique": "prints",
            "order": "released",
        }
        response = requests.get(url, params=params, timeout=10)

        if response.status_code == 404:
            # No results found
            return CardPrintingsResponse(name=card_name, printings=[])

        response.raise_for_status()
        data = response.json()

        printings = []
        for card in data.get('data', []):
            # Get the best image URI available
            image_uri = None
            if 'image_uris' in card:
                image_uri = card['image_uris'].get('normal') or card['image_uris'].get('large')
            elif 'card_faces' in card and len(card['card_faces']) > 0:
                # Double-faced card - use front face
                face = card['card_faces'][0]
                if 'image_uris' in face:
                    image_uri = face['image_uris'].get('normal') or face['image_uris'].get('large')

            printings.append(CardPrinting(
                id=card['id'],
                set_code=card['set'],
                set_name=card['set_name'],
                image_uri=image_uri,
                collector_number=card.get('collector_number', ''),
            ))

        # Cache the results
        _printings_cache[cache_key] = {
            'timestamp': time.time(),
            'printings': printings,
        }

        return CardPrintingsResponse(name=card_name, printings=printings)

    except requests.RequestException as e:
        logger.error(f"Scryfall API error for {card_name}: {e}")
        raise HTTPException(status_code=502, detail="Failed to fetch card printings from Scryfall")


@app.get("/api/card-image/{card_name:path}")
async def serve_card_image(
    card_name: str,
    set_code: Optional[str] = Query(None, alias="set"),
    size: str = Query("normal", pattern="^(normal|small)$"),
):
    """
    Serve a card image from the local cache.
    Falls back to returning a Scryfall URL if not cached.
    """
    # Try to get from local cache first
    result = get_card_image(card_name, set_code, size)

    if result:
        image_data, content_type = result
        return Response(
            content=image_data,
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=31536000",  # Cache for 1 year
                "X-Image-Source": "local-cache",
            }
        )

    # Not in cache - return redirect info to Scryfall
    # The frontend will handle falling back to Scryfall directly
    from urllib.parse import quote
    encoded_name = quote(card_name)

    if set_code:
        scryfall_url = f"https://api.scryfall.com/cards/named?exact={encoded_name}&set={set_code}&format=image&version={size}"
    else:
        scryfall_url = f"https://api.scryfall.com/cards/named?exact={encoded_name}&format=image&version={size}"

    return {
        "cached": False,
        "scryfall_url": scryfall_url,
    }


@app.get("/api/card-image-check/{card_name:path}")
async def check_card_image_cached(
    card_name: str,
    set_code: Optional[str] = Query(None, alias="set"),
    size: str = Query("normal", pattern="^(normal|small)$"),
):
    """Check if a card image is in the local cache."""
    if set_code:
        is_cached = has_card_image(card_name, set_code, size)
    else:
        # Check if any version exists
        result = get_card_image(card_name, None, size)
        is_cached = result is not None

    return {"cached": is_cached}


@app.get("/api/image-stats")
async def get_image_statistics():
    """Get statistics about the cached card images."""
    stats = get_image_stats()
    return stats


@app.get("/api/card/{card_name:path}/alternatives", response_model=AlternativesResponse)
async def get_card_alternatives(
    card_name: str,
    max_price: Optional[float] = Query(None, description="Maximum price for alternatives"),
    top_k: int = Query(5, le=10, description="Number of alternatives to return"),
    category: Optional[str] = Query(None, description="Filter to category (ramp, removal, etc.)"),
    color_identity: Optional[str] = Query(None, description="Color identity filter (e.g., 'W,U,B')"),
    use_models: bool = Query(True, description="Use GPT2/Qwen models for scoring (slower but better)"),
):
    """
    Find cheaper alternatives to a card using ensemble ranking.

    The ensemble ranking combines:
    - FAISS semantic search (30%) - text/effect similarity
    - GPT2 model score (25%) - MTG-specific quality fit
    - Qwen model score (25%) - Commander context relevance
    - Functional tag match (20%) - category overlap

    Returns alternatives sorted by final score with trade-off explanations.
    """
    finder = get_alternative_finder(use_gpt2=use_models, use_qwen=use_models)

    # Parse color identity
    colors = None
    if color_identity:
        colors = [c.strip().upper() for c in color_identity.split(',')]

    # Get source price for response
    source_price = get_cheapest_price(card_name)

    alternatives = finder.find_alternatives(
        card_name=card_name,
        max_price=max_price,
        top_k=top_k,
        explicit_category=category,
        color_identity=colors,
    )

    return AlternativesResponse(
        source_card=card_name,
        source_price=source_price,
        alternatives=[
            CardAlternativeResponse(
                name=alt.name,
                oracle_text=alt.oracle_text,
                type_line=alt.type_line,
                mana_cost=alt.mana_cost,
                cmc=alt.cmc,
                color_identity=alt.color_identity,
                price_usd=alt.price_usd,
                price_category=alt.price_category,
                functional_tags=alt.functional_tags,
                faiss_score=alt.faiss_score,
                gpt2_score=alt.gpt2_score,
                qwen_score=alt.qwen_score,
                category_score=alt.category_score,
                final_score=alt.final_score,
                price_savings=alt.price_savings,
                tradeoff_explanation=alt.tradeoff_explanation,
                purchase_links=alt.purchase_links,
            )
            for alt in alternatives
        ]
    )


@app.post("/api/deck/optimize", response_model=DeckOptimizeResponse)
async def optimize_deck(request: DeckOptimizeRequest):
    """
    Suggest card swaps to reduce deck cost.

    Analyzes the deck and suggests cheaper alternatives for expensive cards.
    Returns swaps sorted by savings amount.
    """
    finder = get_alternative_finder(use_gpt2=True, use_qwen=True)

    swaps = finder.optimize_deck(
        deck_cards=request.cards,
        target_savings=request.target_savings,
        max_swaps=request.max_swaps,
        color_identity=request.color_identity,
    )

    suggestions = []
    total_savings = 0.0

    for original_card, alternative, savings in swaps:
        original_price = get_cheapest_price(original_card) or 0.0
        total_savings += savings

        suggestions.append(SwapSuggestion(
            original_card=original_card,
            original_price=original_price,
            alternative=CardAlternativeResponse(
                name=alternative.name,
                oracle_text=alternative.oracle_text,
                type_line=alternative.type_line,
                mana_cost=alternative.mana_cost,
                cmc=alternative.cmc,
                color_identity=alternative.color_identity,
                price_usd=alternative.price_usd,
                price_category=alternative.price_category,
                functional_tags=alternative.functional_tags,
                faiss_score=alternative.faiss_score,
                gpt2_score=alternative.gpt2_score,
                qwen_score=alternative.qwen_score,
                category_score=alternative.category_score,
                final_score=alternative.final_score,
                price_savings=alternative.price_savings,
                tradeoff_explanation=alternative.tradeoff_explanation,
                purchase_links=alternative.purchase_links,
            ),
            savings=savings,
        ))

    return DeckOptimizeResponse(
        total_savings=total_savings,
        swap_count=len(suggestions),
        suggestions=suggestions,
    )


@app.get("/api/card/{card_name:path}/prices", response_model=CardPriceResponse)
async def get_card_price_info(card_name: str):
    """
    Get price information for a card from multiple vendors.

    Returns prices from TCGPlayer, CardKingdom, and Cardmarket with purchase links.
    """
    prices = get_card_prices(card_name)
    cheapest = get_cheapest_price(card_name)
    category = get_price_category(cheapest)

    return CardPriceResponse(
        name=card_name,
        cheapest_usd=cheapest,
        price_category=category,
        vendors=prices,
    )


@app.get("/api/update/status")
async def get_update_status():
    """Get the status of the last data update."""
    import json
    from pathlib import Path

    stats_path = Path('data/last_update_stats.json')
    if not stats_path.exists():
        return {
            "status": "never_run",
            "message": "No update has been run yet",
        }

    try:
        with open(stats_path, 'r') as f:
            stats = json.load(f)
        return {
            "status": "completed",
            "last_update": stats,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
        }


@app.post("/api/update/trigger")
async def trigger_update(
    cards: bool = Query(False, description="Update cards and embeddings"),
    prices: bool = Query(False, description="Update prices"),
    images: bool = Query(False, description="Download new images"),
):
    """
    Manually trigger a data update.

    Note: This runs synchronously and may take several minutes.
    For production, consider using a background task queue.
    """
    from backend.daily_update import DailyUpdater

    updater = DailyUpdater(dry_run=False)

    if cards:
        new_cards = updater.update_cards()
        if new_cards > 0:
            updater.update_embeddings()
        return {"status": "completed", "new_cards": new_cards}
    elif prices:
        updated = updater.update_prices()
        return {"status": "completed", "updated_prices": updated}
    elif images:
        downloaded = updater.update_images(limit=100)
        return {"status": "completed", "new_images": downloaded}
    else:
        # Full update
        stats = updater.run_full_update()
        return {"status": "completed", "stats": stats}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
