"""Game State Bridge

Converts TypeScript game-engine JSON into readable text for the LLM,
and parses LLM text responses back into action objects.

The game engine (TypeScript) serialises its state as JSON.  This module
lives on the Python side and serves two purposes:

1. **Summarise** the game state into a compact natural-language prompt so
   the model can reason about the board without seeing raw JSON.
2. **Parse** the model's free-text reply back into a concrete action dict
   that the TypeScript engine can execute.
"""

from __future__ import annotations

import re
from typing import Any

# ---------------------------------------------------------------------------
# Type aliases – all dicts coming from JSON
# ---------------------------------------------------------------------------
GameStateDict = dict[str, Any]
CardsDict = dict[str, dict[str, Any]]       # instanceId → card instance
DefinitionsDict = dict[str, dict[str, Any]]  # defId → card definition
ActionDict = dict[str, Any]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _card_name(instance: dict, definitions: DefinitionsDict) -> str:
    """Resolve a card instance to its human-readable name."""
    def_id = instance.get("definitionId", "")
    defn = definitions.get(def_id)
    if defn:
        return defn.get("name", "Unknown Card")
    return "Unknown Card"


def _card_name_by_instance_id(
    instance_id: str,
    cards: CardsDict,
    definitions: DefinitionsDict,
) -> str:
    """Look up a card name given an instanceId."""
    inst = cards.get(instance_id)
    if inst is None:
        return f"(id:{instance_id})"
    return _card_name(inst, definitions)


def _is_creature(defn: dict) -> bool:
    """Check whether a card definition is a creature."""
    return "creature" in defn.get("card_types", [])


def _format_battlefield_card(instance: dict, definitions: DefinitionsDict) -> str:
    """Return a short description of a battlefield permanent."""
    name = _card_name(instance, definitions)
    parts = [name]

    if instance.get("tapped"):
        parts.append("(tapped)")

    def_id = instance.get("definitionId", "")
    defn = definitions.get(def_id, {})
    if _is_creature(defn):
        p = defn.get("power", "?")
        t = defn.get("toughness", "?")
        parts.append(f"[{p}/{t}]")

    return " ".join(parts)


def _zone_cards(
    cards: CardsDict,
    player_id: str,
    zone: str,
) -> list[dict]:
    """Return card instances owned by *player_id* in the given *zone*."""
    return [
        c for c in cards.values()
        if c.get("ownerId") == player_id and c.get("zone") == zone
    ]

# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def summarize_game_state(
    state: GameStateDict,
    cards: CardsDict,
    definitions: DefinitionsDict,
    my_player_id: str,
) -> str:
    """Produce a readable text snapshot of the current game state.

    Parameters
    ----------
    state : dict
        Serialised ``GameState`` from the TypeScript engine.
    cards : dict
        ``instanceId → CardInstance`` map (JSON object).
    definitions : dict
        ``defId → CardDefinition`` map (JSON object).
    my_player_id : str
        The AI player whose perspective we are rendering from.

    Returns
    -------
    str
        Multi-line human-readable summary.
    """
    lines: list[str] = []

    turn = state.get("turnNumber", "?")
    phase = state.get("phase", "?")
    step = state.get("step", "?")
    lines.append(f"Turn {turn} | Phase: {phase} | Step: {step}")
    lines.append("")

    players: list[dict] = state.get("players", [])
    for player in players:
        pid = player.get("id", "")
        name = player.get("name", pid)
        life = player.get("life", "?")
        is_me = pid == my_player_id

        tag = " (you)" if is_me else ""
        lines.append(f"--- {name}{tag} | Life: {life} ---")

        # Hand
        hand = _zone_cards(cards, pid, "hand")
        if is_me:
            hand_names = [_card_name(c, definitions) for c in hand]
            lines.append(f"  Hand ({len(hand)}): {', '.join(hand_names) if hand_names else '(empty)'}")
        else:
            lines.append(f"  Hand: {len(hand)} card(s)")

        # Battlefield
        bf = _zone_cards(cards, pid, "battlefield")
        if bf:
            bf_strs = [_format_battlefield_card(c, definitions) for c in bf]
            lines.append(f"  Battlefield: {', '.join(bf_strs)}")
        else:
            lines.append("  Battlefield: (empty)")

        # Graveyard
        gy = _zone_cards(cards, pid, "graveyard")
        if gy:
            gy_names = [_card_name(c, definitions) for c in gy]
            lines.append(f"  Graveyard ({len(gy)}): {', '.join(gy_names)}")
        else:
            lines.append("  Graveyard: (empty)")

        # Command zone
        cmd = _zone_cards(cards, pid, "command")
        if cmd:
            cmd_names = [_card_name(c, definitions) for c in cmd]
            lines.append(f"  Command Zone: {', '.join(cmd_names)}")

        lines.append("")

    return "\n".join(lines)


def _describe_action(
    idx: int,
    action: ActionDict,
    cards: CardsDict,
    definitions: DefinitionsDict,
) -> str:
    """Return a one-line description like ``[1] CastSpell: Lightning Bolt → Goblin Token``."""
    kind = action.get("kind", "Unknown")
    label = f"[{idx}] {kind}"

    card_id = action.get("cardInstanceId")
    card_name = ""
    if card_id:
        card_name = _card_name_by_instance_id(card_id, cards, definitions)

    if kind == "CastSpell":
        parts = [label, card_name]
        targets = action.get("targets", [])
        if targets:
            target_names = []
            for t in targets:
                # Targets can be player IDs or card instance IDs
                tname = _card_name_by_instance_id(t, cards, definitions)
                target_names.append(tname)
            parts.append("→ " + ", ".join(target_names))
        return ": ".join(parts[:2]) + (" " + parts[2] if len(parts) > 2 else "")

    if kind == "PlayLand":
        return f"{label}: {card_name}"

    if kind == "ActivateManaAbility":
        color = action.get("color", "?")
        return f"{label}: {card_name} (add {{{color}}})"

    if kind == "ActivateAbility":
        return f"{label}: {card_name} (ability #{action.get('abilityIndex', '?')})"

    if kind == "DeclareAttackers":
        attacks = action.get("attacks", [])
        if not attacks:
            return f"{label}: attack with no creatures"
        names = [
            _card_name_by_instance_id(a["cardInstanceId"], cards, definitions)
            for a in attacks
        ]
        return f"{label}: attack with {', '.join(names)}"

    if kind == "DeclareBlockers":
        blocks = action.get("blocks", [])
        if not blocks:
            return f"{label}: no blocks"
        names = [
            _card_name_by_instance_id(b["cardInstanceId"], cards, definitions)
            for b in blocks
        ]
        return f"{label}: block with {', '.join(names)}"

    if kind == "PassPriority":
        return f"{label}"

    return label


def format_decide_prompt(
    state: GameStateDict,
    cards: CardsDict,
    definitions: DefinitionsDict,
    legal_actions: list[ActionDict],
    my_player_id: str,
    personality: str = "Balanced",
) -> str:
    """Build the full prompt the LLM will see when asked to pick an action.

    Parameters
    ----------
    state, cards, definitions, my_player_id
        Same as :func:`summarize_game_state`.
    legal_actions : list[dict]
        List of serialised ``AIAction`` objects from the engine.
    personality : str
        AI personality flavour text (``Aggressive``, ``Greedy``, etc.).

    Returns
    -------
    str
        Ready-to-send prompt string.
    """
    summary = summarize_game_state(state, cards, definitions, my_player_id)

    action_lines = [
        _describe_action(i + 1, a, cards, definitions)
        for i, a in enumerate(legal_actions)
    ]

    prompt_parts = [
        f"You are a {personality} Commander player.",
        "",
        "=== GAME STATE ===",
        summary,
        "=== LEGAL ACTIONS ===",
        *action_lines,
        "",
        "Pick an action by number (e.g. \"1\") and give a one-sentence narration of why.",
    ]

    return "\n".join(prompt_parts)


def parse_action_choice(
    response: str,
    legal_actions: list[ActionDict],
) -> ActionDict:
    """Extract the chosen action from an LLM free-text response.

    Strategy (in priority order):

    1. Look for a bracketed number like ``[3]`` or a plain leading digit.
    2. Keyword matching (``pass`` → ``PassPriority``, etc.).
    3. Ultimate fallback: ``PassPriority`` if present, else last action.

    Parameters
    ----------
    response : str
        Raw model output.
    legal_actions : list[dict]
        The same list that was presented in the prompt (1-indexed).

    Returns
    -------
    dict
        The selected ``AIAction`` dict.
    """
    if not legal_actions:
        return {"kind": "PassPriority"}

    # --- Strategy 1: number extraction ---
    # Try bracketed number first: [3]
    match = re.search(r"\[(\d+)\]", response)
    if match:
        num = int(match.group(1))
        if 1 <= num <= len(legal_actions):
            return legal_actions[num - 1]

    # Try a bare leading digit / "action 3" / "option 2" / "choose 1"
    match = re.search(r"(?:^|\b)(?:action|option|choose|pick|number)?\s*(\d+)", response, re.IGNORECASE)
    if match:
        num = int(match.group(1))
        if 1 <= num <= len(legal_actions):
            return legal_actions[num - 1]

    # --- Strategy 2: keyword matching ---
    lower = response.lower()

    keyword_map: list[tuple[list[str], str]] = [
        (["pass priority", "pass"], "PassPriority"),
        (["play land", "play a land"], "PlayLand"),
        (["cast", "cast spell"], "CastSpell"),
        (["attack", "declare attackers"], "DeclareAttackers"),
        (["block", "declare blockers"], "DeclareBlockers"),
        (["activate ability"], "ActivateAbility"),
        (["tap", "mana ability", "activate mana"], "ActivateManaAbility"),
    ]

    for keywords, action_kind in keyword_map:
        if any(kw in lower for kw in keywords):
            for action in legal_actions:
                if action.get("kind") == action_kind:
                    return action

    # --- Strategy 3: fallback ---
    # Prefer PassPriority if available
    for action in legal_actions:
        if action.get("kind") == "PassPriority":
            return action

    # Absolute last resort
    return legal_actions[-1]
