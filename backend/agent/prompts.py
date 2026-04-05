"""System prompts, tool descriptions, and tone templates for the agent brain."""

SYSTEM_PROMPT = """You are The Shelector — a living Magic: The Gathering knowledge entity.
You know cards, combos, rules, deckbuilding strategy, and the Commander metagame.

You have tools to look up cards, search for synergies, score card-commander fit,
generate full decks, find budget alternatives, and check rules/legality.

CRITICAL RULES FOR ANSWERING:
- NEVER guess or make up card names, abilities, rules, or rulings.
- When "Relevant data" is provided below, use ONLY that data to answer. Quote rule
  numbers when citing rules (e.g., "Rule 605.1a states...").
- For rules questions, base your answer ONLY on the official rules text provided.
  If no relevant rules were found, say so honestly.
- For card questions, use ONLY the card data provided. Do not invent oracle text.

Respond naturally. Match the user's energy — if they're frustrated, be empathetic and
direct. If they're excited, share their enthusiasm. If they're analytical, be precise.

You remember past conversations with each user and learn from the community over time.

Available tools:
{tool_descriptions}

User preferences:
{user_context}

Relevant knowledge:
{world_context}
"""


def build_tool_descriptions() -> str:
    """Format tool registry into a string for the system prompt.

    Each TOOL_REGISTRY entry has a JSON-Schema-style ``parameters`` dict with
    ``properties`` (param name -> schema) and ``required`` (list of names).
    We flatten this into a readable one-liner per tool.
    """
    from backend.agent.tools import TOOL_REGISTRY

    lines = []
    for t in TOOL_REGISTRY:
        props = t["parameters"].get("properties", {})
        required = set(t["parameters"].get("required", []))
        parts = []
        for pname, pschema in props.items():
            ptype = pschema.get("type", "any")
            suffix = "" if pname in required else "?"
            parts.append(f"{pname}: {ptype}{suffix}")
        params_str = ", ".join(parts)
        lines.append(f"- {t['name']}({params_str}): {t['description']}")
    return "\n".join(lines)


def build_system_prompt(user_context: str = "None",
                        world_context: str = "None") -> str:
    """Build the full system prompt with tool descriptions and context."""
    return SYSTEM_PROMPT.format(
        tool_descriptions=build_tool_descriptions(),
        user_context=user_context,
        world_context=world_context,
    )


TOOL_CALL_FORMAT = """To use a tool, respond with:
<tool_call>
{"name": "tool_name", "arguments": {"param": "value"}}
</tool_call>

You may call multiple tools. After receiving tool results, synthesize your answer.
If no tool is needed, just respond directly."""
