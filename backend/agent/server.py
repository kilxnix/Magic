"""Standalone FastAPI server for the MTG Agent Brain.

Run:  python -m backend.agent.server
Listens on port 8100.
"""

import json
import logging
import random
import re
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.agent.brain import AgentBrain
from backend.agent.deck_import import (
    BASIC_LAND_NAMES,
    fill_missing_slots,
    parse_decklist,
    validate_constructed_deck,
    validate_deck,
)
from backend.agent.game_bridge import format_decide_prompt, parse_action_choice

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="The Shelector", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

brain = AgentBrain()
_model_unavailable_reason: str | None = None


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None
    user_id: str = "anon"


class ChatResponse(BaseModel):
    response: str
    session_id: str


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    session_id = req.session_id or str(uuid.uuid4())
    response = brain.chat(
        message=req.message,
        session_id=session_id,
        user_id=req.user_id,
    )
    return ChatResponse(response=response, session_id=session_id)


@app.post("/session/{session_id}/clear")
async def clear_session(session_id: str):
    wm = brain._get_session(session_id)
    wm.clear()
    return {"cleared": session_id}


@app.get("/health")
async def health():
    return {"status": "ok", "model_loaded": brain._model is not None}


# ---------------------------------------------------------------------------
# Spawn-opponent endpoint
# ---------------------------------------------------------------------------

_DECK_POOL_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "ai_decks" / "deck_pool.json"
_CARDS_JSONL_PATH = Path(__file__).resolve().parent.parent.parent / "mtg_data" / "cards_min.jsonl"
_AI_PERSONALITIES = ["Aggressive", "Balanced", "Political", "Greedy"]

# Cached legendary creatures list (loaded once on first use)
_legendary_creatures_cache: list[dict[str, Any]] | None = None


def _load_legendary_creatures() -> list[dict[str, Any]]:
    """Load all commander-legal legendary creatures from the card database."""
    global _legendary_creatures_cache
    if _legendary_creatures_cache is not None:
        return _legendary_creatures_cache

    if not _CARDS_JSONL_PATH.exists():
        return []

    legends: list[dict[str, Any]] = []
    with open(_CARDS_JSONL_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                card = json.loads(line)
            except json.JSONDecodeError:
                continue
            type_line = card.get("type_line", "")
            legalities = card.get("legalities", {})
            # Must be Legendary Creature and legal in Commander
            if ("Legendary" in type_line and "Creature" in type_line
                    and legalities.get("commander") == "legal"):
                legends.append(card)

    _legendary_creatures_cache = legends
    logger.info("Loaded %d legendary creatures from card database", len(legends))
    return legends


def _pick_counter_colors(human_colors: list[str] | None) -> list[str]:
    """Pick colors that counter the human's color identity.

    Strategy: prefer colors the human lacks, especially white (best removal)
    and blue (counterspells).
    """
    all_colors = {"W", "U", "B", "R", "G"}
    human_set = {c.upper() for c in (human_colors or [])}
    missing = all_colors - human_set

    if not missing:
        # Human has all 5 colors — just pick 2-3 randomly
        return random.sample(sorted(all_colors), random.randint(2, 3))

    # Priority order for counter-colors
    priority = []
    if "W" in missing:
        priority.append("W")  # best removal, board wipes
    if "U" in missing:
        priority.append("U")  # counterspells, card draw
    if "B" in missing:
        priority.append("B")  # tutors, removal
    # Add remaining missing colors
    for c in missing:
        if c not in priority:
            priority.append(c)

    # Pick 1-3 counter-colors (at least 1 high-priority)
    num_colors = min(len(priority), random.randint(1, 3))
    return priority[:num_colors]


def _classify_strategy(human_commander: str | None) -> str:
    """Very simple heuristic to classify human strategy from commander name.

    Returns 'aggro', 'control', 'combo', or 'midrange'.
    Handles partner commanders joined with ' // '.
    """
    if not human_commander:
        return "midrange"

    # Load the commander card data for a better guess
    legends = _load_legendary_creatures()
    full_name_match = any(
        card.get("name", "").lower() == human_commander.lower()
        for card in legends
    )
    # Split partner commanders only when the full "A // B" string is not a card.
    names = (
        [n.strip() for n in human_commander.split(" // ")]
        if " // " in human_commander and not full_name_match
        else [human_commander]
    )
    cmd_data = None
    for part in names:
        part_lower = part.lower()
        for card in legends:
            if card.get("name", "").lower() == part_lower:
                cmd_data = card
                break
        if cmd_data:
            break

    if not cmd_data:
        return "midrange"

    oracle = (cmd_data.get("oracle_text") or "").lower()
    type_line = (cmd_data.get("type_line") or "").lower()
    cmc = cmd_data.get("cmc", 4)

    # Combo indicators
    combo_keywords = ["infinite", "combo", "whenever you cast", "untap",
                      "search your library", "tutor"]
    if any(kw in oracle for kw in combo_keywords):
        return "combo"

    # Control indicators
    control_keywords = ["counter", "exile", "destroy target", "each opponent",
                        "opponents can't", "return target"]
    if sum(1 for kw in control_keywords if kw in oracle) >= 2:
        return "control"

    # Aggro indicators
    if cmc <= 3 and ("haste" in oracle or "attack" in oracle or "combat" in oracle
                      or "token" in oracle):
        return "aggro"

    return "midrange"


class SpawnRequest(BaseModel):
    bracket: int = 3
    avoid_colors: list[str] = []
    mode: str = "random"  # "random", "counter", "pool"
    human_commander: str | None = None  # for counter mode
    human_colors: list[str] | None = None  # for counter mode


class SpawnResponse(BaseModel):
    commander: str
    deck_name: str
    personality: str
    colors: list[str]
    deck_id: str
    strategy: str = "midrange"


@app.post("/spawn-opponent", response_model=SpawnResponse)
async def spawn_opponent(req: SpawnRequest):
    """Pick an AI commander based on mode: random, counter, or pool."""

    if req.mode == "pool":
        return _spawn_from_pool(req)
    elif req.mode == "counter":
        return _spawn_counter(req)
    else:
        return _spawn_random(req)


def _spawn_from_pool(req: SpawnRequest) -> SpawnResponse:
    """Original behavior: pick from the static deck pool."""
    if not _DECK_POOL_PATH.exists():
        raise HTTPException(status_code=500, detail="Deck pool file not found")

    with open(_DECK_POOL_PATH, "r", encoding="utf-8") as f:
        pool = json.load(f)

    decks: list[dict[str, Any]] = pool.get("decks", [])
    if not decks:
        raise HTTPException(status_code=500, detail="Deck pool is empty")

    # Filter by bracket range
    eligible = [
        d for d in decks
        if d.get("minBracket", 1) <= req.bracket <= d.get("maxBracket", 5)
    ]

    # Optionally filter out certain colours
    if req.avoid_colors:
        avoid_set = {c.upper() for c in req.avoid_colors}
        eligible = [
            d for d in eligible
            if not avoid_set.intersection({c.upper() for c in d.get("colors", [])})
        ]

    if not eligible:
        # Fallback: relax colour constraint
        eligible = [
            d for d in decks
            if d.get("minBracket", 1) <= req.bracket <= d.get("maxBracket", 5)
        ]

    if not eligible:
        raise HTTPException(
            status_code=404,
            detail=f"No decks match bracket {req.bracket}",
        )

    chosen = random.choice(eligible)
    personality = random.choice(_AI_PERSONALITIES)

    return SpawnResponse(
        commander=chosen["commander"],
        deck_name=chosen.get("theme", chosen["commander"]),
        personality=personality,
        colors=chosen.get("colors", []),
        deck_id=chosen["id"],
        strategy="midrange",
    )


def _filter_legends_by_colors(
    legends: list[dict[str, Any]],
    avoid_colors: list[str],
    require_colors: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Filter legendary creatures by color constraints."""
    avoid_set = {c.upper() for c in avoid_colors} if avoid_colors else set()
    require_set = {c.upper() for c in require_colors} if require_colors else None

    filtered = []
    for card in legends:
        ci = {c.upper() for c in (card.get("color_identity") or [])}
        # Skip colorless commanders (usually boring as AI opponents)
        if not ci:
            continue
        # Must not contain any avoided colors
        if avoid_set and ci & avoid_set:
            continue
        # If require_colors specified, commander must have at least one
        if require_set and not (ci & require_set):
            continue
        filtered.append(card)

    return filtered


def _spawn_random(req: SpawnRequest) -> SpawnResponse:
    """Pick a random legendary creature from the card database."""
    legends = _load_legendary_creatures()
    if not legends:
        # Fallback to pool mode
        return _spawn_from_pool(req)

    eligible = _filter_legends_by_colors(legends, req.avoid_colors)

    if not eligible:
        # Relax color constraint
        eligible = [c for c in legends if c.get("color_identity")]

    if not eligible:
        return _spawn_from_pool(req)

    chosen = random.choice(eligible)
    personality = random.choice(_AI_PERSONALITIES)
    colors = chosen.get("color_identity") or []
    commander_name = chosen.get("name", "Unknown Commander")

    return SpawnResponse(
        commander=commander_name,
        deck_name=commander_name,
        personality=personality,
        colors=colors,
        deck_id=f"random-{uuid.uuid4().hex[:8]}",
        strategy="midrange",
    )


def _spawn_counter(req: SpawnRequest) -> SpawnResponse:
    """Pick a commander that strategically counters the human's deck."""
    legends = _load_legendary_creatures()
    if not legends:
        return _spawn_from_pool(req)

    # Determine counter-colors
    counter_colors = _pick_counter_colors(req.human_colors)

    # Classify human strategy to pick opposing archetype
    human_strategy = _classify_strategy(req.human_commander)

    # Filter legends to counter-colors
    eligible = _filter_legends_by_colors(
        legends,
        avoid_colors=req.avoid_colors,
        require_colors=counter_colors,
    )

    if not eligible:
        # Fallback: any commander with at least one counter-color
        eligible = _filter_legends_by_colors(legends, avoid_colors=[])
        eligible = [
            c for c in eligible
            if {cc.upper() for cc in (c.get("color_identity") or [])}
            & {cc.upper() for cc in counter_colors}
        ]

    if not eligible:
        return _spawn_random(req)

    # Further refine based on opposing strategy
    refined = eligible
    if human_strategy == "aggro":
        # Pick commanders with control/wipe text
        refined = [
            c for c in eligible
            if any(kw in (c.get("oracle_text") or "").lower()
                   for kw in ["destroy all", "exile all", "each opponent",
                              "counter target", "return all", "board"])
        ]
    elif human_strategy == "control":
        # Pick aggressive/token/go-wide commanders
        refined = [
            c for c in eligible
            if any(kw in (c.get("oracle_text") or "").lower()
                   for kw in ["attack", "combat", "token", "haste",
                              "power", "creature token"])
        ]
    elif human_strategy == "combo":
        # Pick disruptive commanders
        refined = [
            c for c in eligible
            if any(kw in (c.get("oracle_text") or "").lower()
                   for kw in ["can't", "counter", "exile", "sacrifice",
                              "opponent", "destroy target"])
        ]

    # Use refined list if it has candidates, otherwise fall back to eligible
    pool = refined if refined else eligible
    chosen = random.choice(pool)
    personality = random.choice(_AI_PERSONALITIES)
    colors = chosen.get("color_identity") or []
    commander_name = chosen.get("name", "Unknown Commander")

    # Determine counter strategy label
    counter_strategy = {
        "aggro": "control",
        "control": "aggro",
        "combo": "disruption",
        "midrange": "midrange",
    }.get(human_strategy, "midrange")

    return SpawnResponse(
        commander=commander_name,
        deck_name=commander_name,
        personality=personality,
        colors=colors,
        deck_id=f"counter-{uuid.uuid4().hex[:8]}",
        strategy=counter_strategy,
    )


# ---------------------------------------------------------------------------
# Decide endpoint
# ---------------------------------------------------------------------------

class DecideRequest(BaseModel):
    game_state: dict
    cards: dict
    definitions: dict
    legal_actions: list
    player_id: str = "shelector"
    personality: str = "Balanced"


class DecideResponse(BaseModel):
    action: dict
    narration: str


def _fallback_decide_action(legal_actions: list) -> dict:
    """Pick a simple legal action when the LLM is unavailable."""
    if not legal_actions:
        return {"kind": "PassPriority"}

    priority = [
        "PlayLand",
        "CastSpell",
        "DeclareAttackers",
        "DeclareBlockers",
        "ActivateAbility",
        "ActivateManaAbility",
        "PassPriority",
    ]
    for kind in priority:
        for action in legal_actions:
            if action.get("kind") == kind:
                return action

    return legal_actions[0]


@app.post("/decide", response_model=DecideResponse)
async def decide(req: DecideRequest):
    """Given game state and legal actions, pick an action and narrate it."""
    global _model_unavailable_reason

    if not req.legal_actions:
        return DecideResponse(
            action={"kind": "PassPriority"},
            narration="No legal actions available — passing priority.",
        )

    # Build the prompt for the LLM
    prompt = format_decide_prompt(
        state=req.game_state,
        cards=req.cards,
        definitions=req.definitions,
        legal_actions=req.legal_actions,
        my_player_id=req.player_id,
        personality=req.personality,
    )

    system_msg = (
        f"You are a {req.personality} AI opponent in a Commander game. "
        "Pick the best legal action by responding with its number. "
        "Then give a brief one-sentence narration explaining your choice. "
        "Format: <number> - <narration>"
    )

    try:
        if _model_unavailable_reason:
            raise RuntimeError(_model_unavailable_reason)
        messages = [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": prompt},
        ]
        raw_response = brain._generate(messages, max_tokens=256)
        action = parse_action_choice(raw_response, req.legal_actions)
    except Exception as exc:
        if not _model_unavailable_reason:
            _model_unavailable_reason = str(exc)
        logger.warning("Shelector model unavailable; using fallback action: %s", exc)
        action = _fallback_decide_action(req.legal_actions)
        return DecideResponse(
            action=action,
            narration=(
                "The local model is unavailable, so I chose a basic legal "
                f"{action.get('kind', 'action')}."
            ),
        )

    # Extract narration (everything after the number and optional dash/colon)
    narration = raw_response.strip()
    narration_match = re.search(r"^\s*\[?\d+\]?\s*[-:.]?\s*(.+)", narration, re.DOTALL)
    if narration_match:
        narration = narration_match.group(1).strip()
    # Truncate to first sentence if very long
    if len(narration) > 300:
        narration = narration[:300].rsplit(".", 1)[0] + "."

    return DecideResponse(action=action, narration=narration)


# ---------------------------------------------------------------------------
# Import-deck endpoint
# ---------------------------------------------------------------------------

class ImportDeckRequest(BaseModel):
    decklist_text: str
    bracket: int = 3
    fill_missing: bool = True  # auto-fill with Shelector picks
    format: str = "commander"


class CardData(BaseModel):
    name: str
    type_line: str = ""
    mana_cost: str = ""
    cmc: float = 0
    oracle_text: str = ""
    power: str | None = None
    toughness: str | None = None
    colors: list[str] = []
    color_identity: list[str] = []
    keywords: list[str] = []


def _first_card_face(db_entry: dict[str, Any]) -> dict[str, Any]:
    faces = db_entry.get("card_faces") or []
    return faces[0] if faces and isinstance(faces[0], dict) else {}


def _face_fallback(db_entry: dict[str, Any], face: dict[str, Any], key: str, default: Any) -> Any:
    value = db_entry.get(key)
    if value is None or value == "" or value == []:
        face_value = face.get(key)
        if face_value is not None and face_value != "" and face_value != []:
            return face_value
        return default
    return value


def _card_data_from_db(name: str, db_entry: dict[str, Any]) -> CardData:
    face = _first_card_face(db_entry)
    power = _face_fallback(db_entry, face, "power", None)
    toughness = _face_fallback(db_entry, face, "toughness", None)
    return CardData(
        name=db_entry.get("name") or name,
        type_line=_face_fallback(db_entry, face, "type_line", ""),
        mana_cost=_face_fallback(db_entry, face, "mana_cost", ""),
        cmc=db_entry.get("cmc") or 0,
        oracle_text=_face_fallback(db_entry, face, "oracle_text", ""),
        power=str(power) if power is not None else None,
        toughness=str(toughness) if toughness is not None else None,
        colors=_face_fallback(db_entry, face, "colors", []),
        color_identity=db_entry.get("color_identity") or [],
        keywords=db_entry.get("keywords") or [],
    )


class ImportDeckResponse(BaseModel):
    commander: str | None
    commander_data: CardData | None = None
    cards: list[str]
    lands: list[str]
    sideboard: list[str] = []
    card_data: dict[str, CardData] = {}  # name -> full card info
    total: int
    valid: bool
    errors: list[str]
    warnings: list[str]
    filled_cards: list[str]


@app.post("/import-deck", response_model=ImportDeckResponse)
async def import_deck(req: ImportDeckRequest):
    """Parse, validate, and optionally fill a pasted decklist."""
    # Step 1: Parse
    format_name = (req.format or "commander").lower()
    parsed = parse_decklist(req.decklist_text, singleton=format_name == "commander")

    # Step 2: Get card_db from the deck generator
    from backend.deck_generator import get_generator

    gen = get_generator()
    card_db = gen.card_by_name

    # Step 3: Validate
    if format_name == "standard":
        validation = validate_constructed_deck(parsed, card_db, format_name="standard")
    else:
        validation = validate_deck(parsed, card_db)

    # Step 4: Fill missing slots if requested
    filled_cards: list[str] = []
    if format_name == "commander" and req.fill_missing and validation["missing_slots"] > 0 and parsed.get("commander"):
        parsed = fill_missing_slots(parsed, card_db, bracket=req.bracket)
        filled_cards = parsed.get("filled_cards", [])
        # Re-validate after filling — remove any cards that violate color identity
        raw_commander = parsed.get("commander", "")
        commander_names = parsed.get("commanders") or (
            [raw_commander]
            if raw_commander in card_db
            else [n.strip() for n in raw_commander.split(" // ") if n.strip()]
        )
        cmd_colors: set[str] = set()
        for cmd_name in commander_names:
            cmd_entry = card_db.get(cmd_name)
            if cmd_entry:
                cmd_colors.update(cmd_entry.get("color_identity") or [])
        if cmd_colors:
            parsed["cards"] = [
                c for c in parsed.get("cards", [])
                if c in BASIC_LAND_NAMES or
                set((card_db.get(c) or {}).get("color_identity") or []).issubset(cmd_colors)
            ]
            filled_cards = [c for c in filled_cards if c in parsed["cards"]]
            parsed["filled_cards"] = filled_cards
        # Recalculate total
        parsed["total"] = len(commander_names) + len(parsed["cards"]) + len(parsed.get("lands", []))
        validation = validate_deck(parsed, card_db)

    # Build full card data for every card in the deck
    all_names = set(parsed.get("cards", []) + parsed.get("lands", []) + parsed.get("sideboard", []))
    raw_commander = parsed.get("commander") or ""
    commander_names = parsed.get("commanders") or (
        [raw_commander]
        if raw_commander in card_db
        else [n.strip() for n in raw_commander.split(" // ") if n.strip()]
    )
    for cmd_name in commander_names:
        all_names.add(cmd_name)
    card_data_map: dict[str, CardData] = {}
    for name in all_names:
        db_entry = card_db.get(name)
        if db_entry:
            card_data_map[name] = _card_data_from_db(name, db_entry)

    commander_data = None
    for cmd_name in commander_names:
        if cmd_name in card_data_map:
            commander_data = card_data_map[cmd_name]
            break

    return ImportDeckResponse(
        commander=parsed.get("commander"),
        commander_data=commander_data,
        cards=parsed.get("cards", []),
        lands=parsed.get("lands", []),
        sideboard=parsed.get("sideboard", []),
        card_data=card_data_map,
        total=parsed.get("total", 0),
        valid=validation["valid"],
        errors=validation["errors"],
        warnings=validation["warnings"],
        filled_cards=filled_cards,
    )


# ---------------------------------------------------------------------------
# Generate AI Deck endpoint
# ---------------------------------------------------------------------------

class GenerateAIDeckRequest(BaseModel):
    commander: str
    bracket: int = 3


class GenerateAIDeckResponse(BaseModel):
    commander: str
    cards: list[str]
    lands: list[str]
    card_data: dict[str, CardData]


@app.post("/generate-ai-deck", response_model=GenerateAIDeckResponse)
async def generate_ai_deck(req: GenerateAIDeckRequest):
    """Generate a full deck for the AI opponent using the deck generator."""
    from backend.deck_generator import get_generator

    gen = get_generator()
    result = gen.generate_deck(commander_name=req.commander, bracket=req.bracket)

    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])

    # Get commander's color identity for filtering (handle partner ' // ' names)
    commander_name = result.get("commander", req.commander)
    commander_names = (
        [commander_name]
        if commander_name in gen.card_by_name
        else [n.strip() for n in commander_name.split(" // ") if n.strip()]
    )
    if len(commander_names) > 1:
        cmd_colors: set[str] = set()
        for pn in commander_names:
            pd = gen.card_by_name.get(pn, {})
            cmd_colors.update(pd.get("color_identity") or [])
        cmd_data = gen.card_by_name.get(commander_names[0], {})
    else:
        cmd_data = gen.card_by_name.get(commander_name, {})
        cmd_colors = set(cmd_data.get("color_identity") or [])

    # Extract card names from the categories dict (type-based categories)
    categories = result.get("categories", {})
    land_names: list[str] = []
    card_names: list[str] = []

    for category_key, names_list in categories.items():
        for name in names_list:
            if category_key == "Commander":
                continue
            # Enforce color identity — skip cards outside commander's colors
            card_data = gen.card_by_name.get(name, {})
            card_ci = set(card_data.get("color_identity") or [])
            type_line = (card_data.get("type_line") or "").lower()
            # Basic lands and colorless cards are always legal
            is_basic = name in {"Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"}
            is_land = "land" in type_line
            if not is_basic and card_ci and not card_ci.issubset(cmd_colors):
                continue  # Illegal — skip this card
            # Skip token cards
            if "token" in type_line:
                continue
            if category_key == "Lands" or is_land:
                land_names.append(name)
            else:
                card_names.append(name)

    # Backfill if filtering removed too many cards
    total_nonland = len(card_names)
    if total_nonland < 60:
        # Search for more color-legal cards
        oracle = cmd_data.get("oracle_text") or commander_name
        existing = set(card_names + land_names)
        existing.update(commander_names)
        extra = gen.search_cards(oracle, k=(99 - total_nonland - len(land_names)) * 3)
        for card in extra:
            if len(card_names) + len(land_names) >= 99:
                break
            cname = card.get("name", "")
            if not cname or cname in existing:
                continue
            cci = set(card.get("color_identity") or [])
            tl = (card.get("type_line") or "").lower()
            if cci and not cci.issubset(cmd_colors):
                continue
            if "token" in tl:
                continue
            if cname in BASIC_LAND_NAMES:
                continue
            existing.add(cname)
            if "land" in tl:
                land_names.append(cname)
            else:
                card_names.append(cname)

        # If still short, pad with basic lands matching commander colors
        color_to_basic = {"W": "Plains", "U": "Island", "B": "Swamp", "R": "Mountain", "G": "Forest"}
        basics = [color_to_basic[c] for c in cmd_colors if c in color_to_basic]
        if not basics:
            basics = ["Wastes"]
        idx = 0
        while len(card_names) + len(land_names) < 99:
            land_names.append(basics[idx % len(basics)])
            idx += 1

    # Build full card data for every card (including commander(s))
    all_names = set(card_names + land_names)
    all_names.update(commander_names)
    card_data_map: dict[str, CardData] = {}
    for name in all_names:
        db_entry = gen.card_by_name.get(name)
        if db_entry:
            card_data_map[name] = _card_data_from_db(name, db_entry)

    return GenerateAIDeckResponse(
        commander=result.get("commander", req.commander),
        cards=card_names,
        lands=land_names,
        card_data=card_data_map,
    )


# ---------------------------------------------------------------------------
# Evaluate-cards endpoint (used by deck generator for AI-enhanced ranking)
# ---------------------------------------------------------------------------

class EvaluateCardsRequest(BaseModel):
    commander: str
    theme: str = ""
    bracket: int = 3
    candidates: list[str]  # card names to evaluate
    slots_needed: int = 10


class EvaluateCardsResponse(BaseModel):
    ranked_cards: list[str]  # ordered best to worst
    reasoning: str


@app.post("/evaluate-cards", response_model=EvaluateCardsResponse)
async def evaluate_cards(req: EvaluateCardsRequest):
    """Use the Shelector brain to rank candidate cards for a commander/theme.

    The deck generator calls this after FAISS search to re-rank results
    with LLM intelligence.
    """
    # Build a concise prompt for the brain
    theme_desc = f" with a '{req.theme}' theme" if req.theme else ""
    candidate_list = ", ".join(req.candidates[:40])  # cap to avoid token overflow

    system_msg = (
        "You are The Shelector, an expert MTG Commander deck-building AI. "
        "You rank card candidates for a given commander, theme, and power bracket. "
        "Respond ONLY with a JSON object: {\"ranked\": [\"Card1\", \"Card2\", ...], \"reasoning\": \"...\"} "
        "List the best cards first. Only include card names from the provided candidates. "
        f"Return exactly {req.slots_needed} cards (or fewer if not enough good options)."
    )

    user_msg = (
        f"Commander: {req.commander}\n"
        f"Bracket: {req.bracket}{theme_desc}\n"
        f"Slots to fill: {req.slots_needed}\n"
        f"Candidate cards: {candidate_list}\n\n"
        "Rank these candidates from best to worst for this deck. "
        "Consider synergy with the commander, mana curve, and the power bracket."
    )

    try:
        brain._load_model()
        messages = [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": user_msg},
        ]
        raw = brain._generate(messages, max_tokens=512)

        # Parse the JSON response
        ranked: list[str] = []
        reasoning = ""

        # Try to extract JSON from the response
        json_match = re.search(r'\{[^{}]*"ranked"\s*:\s*\[.*?\][^{}]*\}', raw, re.DOTALL)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                ranked = [c for c in parsed.get("ranked", []) if c in req.candidates]
                reasoning = parsed.get("reasoning", "")
            except json.JSONDecodeError:
                pass

        # Fallback: extract card names mentioned in order
        if not ranked:
            for candidate in req.candidates:
                if candidate.lower() in raw.lower():
                    ranked.append(candidate)
            reasoning = raw[:500] if not reasoning else reasoning

        # If we still have nothing, return candidates in original order
        if not ranked:
            ranked = req.candidates[:req.slots_needed]
            reasoning = "Shelector could not parse a ranking; returning FAISS order."

        return EvaluateCardsResponse(
            ranked_cards=ranked[:req.slots_needed],
            reasoning=reasoning[:1000],
        )

    except Exception as e:
        logger.error("Shelector evaluate-cards failed: %s", e)
        # Graceful fallback — return candidates in FAISS order
        return EvaluateCardsResponse(
            ranked_cards=req.candidates[:req.slots_needed],
            reasoning=f"Shelector unavailable ({e}); using FAISS ranking.",
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8100)
