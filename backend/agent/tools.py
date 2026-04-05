"""Tool wrappers that expose backend components to the agent brain."""

from typing import Any, Dict, List, Optional, Set


# ---------------------------------------------------------------------------
# Lightweight tools (no model loading)
# ---------------------------------------------------------------------------

def tool_detect_tags(
    oracle_text: str,
    type_line: str = "",
    keywords: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Detect functional tags from a card's oracle text and type line.

    Returns a dict with ``tags`` (sorted list) and ``primary_function``.
    """
    from backend.functional_tags import detect_tags, get_primary_function

    tags: Set[str] = detect_tags(oracle_text, type_line=type_line, keywords=keywords)
    primary: str = get_primary_function(tags)
    return {"tags": sorted(tags), "primary_function": primary}


def tool_get_bracket_info(bracket: int) -> Dict[str, Any]:
    """Return the restriction dict for a Commander bracket (1-5)."""
    from backend.rules import get_bracket_restrictions

    info = get_bracket_restrictions(bracket)
    return dict(info)  # return a plain dict copy


def tool_check_rules(card_name: str, bracket: int = 3) -> Dict[str, Any]:
    """Check if a card is banned and get bracket restrictions.

    Returns ``{"card_name", "banned", "bracket", "restrictions"}``.
    """
    from backend.rules import is_card_banned, get_bracket_restrictions

    banned = is_card_banned(card_name)
    restrictions = get_bracket_restrictions(bracket)
    return {
        "card_name": card_name,
        "banned": banned,
        "bracket": bracket,
        "restrictions": dict(restrictions),
    }


def tool_get_card(name: str) -> Dict[str, Any]:
    """Look up a single card by exact name.

    Lazy-imports the DeckGenerator so models are only loaded on demand.
    Returns the card dict or ``{"found": False}`` when not found.
    """
    from backend.deck_generator import get_generator

    gen = get_generator()
    if not gen._loaded:
        gen.load()
    card = gen.card_by_name.get(name)
    if card is None:
        return {"found": False}
    result = dict(card)
    result["found"] = True
    return result


def tool_search_cards(query: str, k: int = 20) -> List[Dict[str, Any]]:
    """Semantic search for cards matching *query*.

    Lazy-imports the DeckGenerator. Returns up to *k* card summary dicts.
    """
    from backend.deck_generator import get_generator

    gen = get_generator()
    results = gen.search_cards(query, k=k)
    # Return concise summaries to keep token usage down
    summaries = []
    for card in results:
        summaries.append({
            "name": card.get("name"),
            "type_line": card.get("type_line"),
            "mana_cost": card.get("mana_cost"),
            "oracle_text": card.get("oracle_text", ""),
            "color_identity": card.get("color_identity", []),
            "cmc": card.get("cmc"),
            "score": card.get("score"),
        })
    return summaries


# ---------------------------------------------------------------------------
# Heavy tools (require model loading — lazy import)
# ---------------------------------------------------------------------------

def tool_score_card(
    card_name: str,
    commander_name: str,
    card_text: str = "",
    commander_text: str = "",
    commander_colors: str = "",
) -> Dict[str, Any]:
    """Score how well *card_name* fits in a deck led by *commander_name*.

    Uses the Qwen 3.5 scorer (lazy-loaded). Returns ``{"score": float}``.
    """
    from backend.model_scorers import get_qwen35_scorer

    scorer = get_qwen35_scorer()
    score = scorer.score_similarity(
        source_card=commander_name,
        candidate_card=card_name,
        source_text=commander_text,
        candidate_text=card_text,
        commander_name=commander_name,
        commander_colors=commander_colors,
    )
    return {"card_name": card_name, "commander_name": commander_name, "score": float(score)}


def tool_compose_deck(
    commander_name: str,
    colors: str,
    bracket: int = 3,
    theme: str = "goodstuff",
) -> Dict[str, Any]:
    """Generate a full Commander deck using the LLM deck composer.

    Lazy-imports the DeckGenerator. *colors* is unused by the generator
    directly but kept for the agent's reference.
    """
    from backend.deck_generator import get_generator

    gen = get_generator()
    result = gen.generate_deck_with_model(
        commander_name=commander_name,
        bracket=bracket,
        theme=theme,
    )
    return result


def tool_find_alternatives(
    card_name: str,
    max_price: Optional[float] = None,
    top_k: int = 5,
    color_identity: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """Find alternative cards for *card_name* using ensemble scoring.

    Lazy-imports the CardAlternativeFinder. Returns a list of alternative dicts.
    """
    from backend.card_alternatives import get_alternative_finder

    finder = get_alternative_finder()
    alternatives = finder.find_alternatives(
        card_name=card_name,
        max_price=max_price,
        top_k=top_k,
        color_identity=color_identity,
    )
    # Convert dataclass instances to plain dicts
    results = []
    for alt in alternatives:
        results.append({
            "name": alt.name,
            "oracle_text": alt.oracle_text,
            "type_line": alt.type_line,
            "mana_cost": alt.mana_cost,
            "cmc": alt.cmc,
            "color_identity": alt.color_identity,
            "price_usd": alt.price_usd,
            "price_category": alt.price_category,
            "functional_tags": alt.functional_tags,
            "faiss_score": alt.faiss_score,
            "gpt2_score": alt.gpt2_score,
            "qwen_score": alt.qwen_score,
            "tag_score": alt.tag_score,
            "final_score": alt.final_score,
        })
    return results


# ---------------------------------------------------------------------------
# TOOL_REGISTRY & TOOL_MAP
# ---------------------------------------------------------------------------

TOOL_REGISTRY: List[Dict[str, Any]] = [
    {
        "name": "detect_tags",
        "description": (
            "Detect functional tags (removal, ramp, card-draw, etc.) from a "
            "card's oracle text. Returns tags and a primary_function label."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "oracle_text": {
                    "type": "string",
                    "description": "The card's oracle text.",
                },
                "type_line": {
                    "type": "string",
                    "description": "The card's type line (e.g. 'Instant').",
                },
                "keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of keywords from the card.",
                },
            },
            "required": ["oracle_text"],
        },
        "function": tool_detect_tags,
    },
    {
        "name": "get_bracket_info",
        "description": (
            "Get the rules and restrictions for a Commander bracket (1-5). "
            "Returns name, description, power range, and what is allowed."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "bracket": {
                    "type": "integer",
                    "description": "Bracket number 1-5.",
                },
            },
            "required": ["bracket"],
        },
        "function": tool_get_bracket_info,
    },
    {
        "name": "check_rules",
        "description": (
            "Check whether a card is banned in Commander and retrieve the "
            "bracket restrictions for context."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_name": {
                    "type": "string",
                    "description": "Exact card name to check.",
                },
                "bracket": {
                    "type": "integer",
                    "description": "Bracket to check restrictions for (default 3).",
                },
            },
            "required": ["card_name"],
        },
        "function": tool_check_rules,
    },
    {
        "name": "get_card",
        "description": (
            "Look up a card by exact name. Returns full card data or "
            "{'found': False} if not found."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Exact card name.",
                },
            },
            "required": ["name"],
        },
        "function": tool_get_card,
    },
    {
        "name": "search_cards",
        "description": (
            "Semantic search for cards matching a text query. Returns up to k "
            "card summaries ranked by relevance."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural-language search query.",
                },
                "k": {
                    "type": "integer",
                    "description": "Max results to return (default 20).",
                },
            },
            "required": ["query"],
        },
        "function": tool_search_cards,
    },
    {
        "name": "score_card",
        "description": (
            "Score how well a card fits in a commander's deck using the Qwen "
            "model. Returns a 0-1 score."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_name": {
                    "type": "string",
                    "description": "Name of the card to score.",
                },
                "commander_name": {
                    "type": "string",
                    "description": "Name of the commander.",
                },
                "card_text": {
                    "type": "string",
                    "description": "Oracle text of the card.",
                },
                "commander_text": {
                    "type": "string",
                    "description": "Oracle text of the commander.",
                },
                "commander_colors": {
                    "type": "string",
                    "description": "Color identity string (e.g. 'WUB').",
                },
            },
            "required": ["card_name", "commander_name"],
        },
        "function": tool_score_card,
    },
    {
        "name": "compose_deck",
        "description": (
            "Generate a full 100-card Commander deck for a given commander, "
            "bracket, and theme."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "commander_name": {
                    "type": "string",
                    "description": "Name of the commander.",
                },
                "colors": {
                    "type": "string",
                    "description": "Color identity string (e.g. 'BG').",
                },
                "bracket": {
                    "type": "integer",
                    "description": "Power bracket 1-5 (default 3).",
                },
                "theme": {
                    "type": "string",
                    "description": "Deck theme (default 'goodstuff').",
                },
            },
            "required": ["commander_name", "colors"],
        },
        "function": tool_compose_deck,
    },
    {
        "name": "find_alternatives",
        "description": (
            "Find alternative cards for a given card using ensemble scoring "
            "(FAISS + GPT2 + Qwen + functional tags)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "card_name": {
                    "type": "string",
                    "description": "Name of the card to find alternatives for.",
                },
                "max_price": {
                    "type": "number",
                    "description": "Maximum price in USD for alternatives.",
                },
                "top_k": {
                    "type": "integer",
                    "description": "Number of alternatives to return (default 5).",
                },
                "color_identity": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Color identity filter (e.g. ['B', 'G']).",
                },
            },
            "required": ["card_name"],
        },
        "function": tool_find_alternatives,
    },
]

TOOL_MAP: Dict[str, Any] = {entry["name"]: entry["function"] for entry in TOOL_REGISTRY}
