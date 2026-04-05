"""AgentBrain — the orchestration loop for the MTG knowledge agent.

Processes user messages, calls tools as needed, and synthesizes responses
using a locally-loaded Qwen3-4B model.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from backend.agent.memory import WorkingMemory, UserMemory, WorldMemory
from backend.agent.prompts import build_system_prompt, TOOL_CALL_FORMAT
from backend.agent.rules_rag import get_rules_rag
from backend.agent.tools import TOOL_MAP, tool_get_card, tool_search_cards, tool_detect_tags, tool_check_rules, tool_get_bracket_info

logger = logging.getLogger(__name__)

# ── Intent patterns for keyword-based routing ──────────────────────────
_CARD_NAME_RE = re.compile(r'"([^"]+)"')  # quoted card names
_BRACKET_RE = re.compile(r'\bbracket\s*(\d)', re.IGNORECASE)

_INTENT_KEYWORDS = {
    "build_deck": ["build", "deck", "generate", "make me", "brew", "create a deck"],
    "card_info": ["what is", "what does", "tell me about", "how does", "explain"],
    "rules": ["legal", "banned", "allowed", "can i play", "can i use", "bracket", "rules",
              "stack", "priority", "respond", "counter", "target", "trigger", "ability",
              "mana ability", "state-based", "combat", "damage", "exile", "sacrifice",
              "graveyard", "cast", "resolve", "phase", "step", "layer", "replacement",
              "legend rule", "commander damage", "color identity", "can that", "can you",
              "does it", "how does", "what happens", "when does", "is it possible"],
    "alternatives": ["alternative", "substitute", "replace", "budget", "cheaper", "swap"],
    "search": ["find", "search", "cards that", "cards with", "looking for", "any cards"],
    "score": ["how good is", "rate", "score", "fit", "synergy"],
    "optimize": ["optimize", "improve", "weakness", "wrong with", "what's missing"],
}

# Regex for parsing <tool_call>...</tool_call> blocks
_TOOL_CALL_RE = re.compile(
    r"<tool_call>\s*(\{.*?\})\s*</tool_call>",
    re.DOTALL,
)


class AgentBrain:
    """Orchestration loop: message in -> tool calls -> response out."""

    def __init__(self, model_path: Optional[str] = None,
                 lora_path: Optional[str] = None) -> None:
        self.model_path = model_path or "Qwen/Qwen2.5-3B-Instruct"
        self.lora_path = lora_path  # None = no LoRA (base instruct model + RAG)
        self.user_memory = UserMemory()
        self.world_memory = WorldMemory()
        self._sessions: Dict[str, WorkingMemory] = {}
        self._model = None
        self._tokenizer = None

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    def _get_session(self, session_id: str) -> WorkingMemory:
        """Return (or create) the WorkingMemory for *session_id*."""
        if session_id not in self._sessions:
            self._sessions[session_id] = WorkingMemory()
        return self._sessions[session_id]

    # ------------------------------------------------------------------
    # Model loading & generation
    # ------------------------------------------------------------------

    def _load_model(self) -> None:
        """Lazy-load the brain model, optionally with LoRA adapter."""
        if self._model is not None:
            return

        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        logger.info("Loading base model: %s", self.model_path)
        self._tokenizer = AutoTokenizer.from_pretrained(
            self.model_path,
            trust_remote_code=True,
        )
        self._model = AutoModelForCausalLM.from_pretrained(
            self.model_path,
            dtype=torch.bfloat16,
            device_map="auto",
            trust_remote_code=True,
        )

        # Apply LoRA adapter if available
        if self.lora_path:
            from pathlib import Path
            adapter_path = Path(self.lora_path)
            if adapter_path.exists() and (adapter_path / "adapter_config.json").exists():
                try:
                    from peft import PeftModel
                    logger.info("Applying LoRA adapter: %s", self.lora_path)
                    self._model = PeftModel.from_pretrained(
                        self._model, self.lora_path
                    )
                except Exception as e:
                    logger.warning("LoRA adapter failed to load: %s", e)

        self._model.eval()
        logger.info("Shelector brain loaded.")

    def _generate(self, messages: List[Dict[str, str]], max_tokens: int = 1024) -> str:
        """Apply chat template and generate a response.

        Parameters
        ----------
        messages:
            List of ``{"role": ..., "content": ...}`` dicts.
        max_tokens:
            Maximum new tokens to generate.

        Returns
        -------
        str
            The model's decoded response text.
        """
        self._load_model()

        text = self._tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True,
            enable_thinking=False,
        )
        inputs = self._tokenizer(text, return_tensors="pt").to(self._model.device)
        output_ids = self._model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            temperature=0.7,
            do_sample=True,
            repetition_penalty=1.1,
        )
        # Decode only the newly generated tokens
        generated = output_ids[0][inputs["input_ids"].shape[-1]:]
        return self._tokenizer.decode(generated, skip_special_tokens=True)

    # ------------------------------------------------------------------
    # Tool-call parsing & execution
    # ------------------------------------------------------------------

    def _parse_tool_calls(self, text: str) -> List[Dict[str, Any]]:
        """Extract ``<tool_call>`` blocks from *text*.

        Returns a list of dicts, each with ``name`` (str) and ``arguments`` (dict).
        Malformed JSON blocks are silently skipped.
        """
        calls: List[Dict[str, Any]] = []
        for match in _TOOL_CALL_RE.finditer(text):
            try:
                payload = json.loads(match.group(1))
                if "name" in payload:
                    calls.append({
                        "name": payload["name"],
                        "arguments": payload.get("arguments", {}),
                    })
            except (json.JSONDecodeError, TypeError):
                logger.warning("Skipping malformed tool_call block: %s", match.group(0))
        return calls

    def _strip_tool_calls(self, text: str) -> str:
        """Remove all ``<tool_call>...</tool_call>`` blocks from *text*."""
        return _TOOL_CALL_RE.sub("", text).strip()

    def _execute_tools(self, calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Look up each tool in TOOL_MAP and execute it.

        Returns a list of result dicts: ``{"name", "result" | "error"}``.
        """
        results: List[Dict[str, Any]] = []
        for call in calls:
            name = call["name"]
            args = call.get("arguments", {})
            fn = TOOL_MAP.get(name)
            if fn is None:
                results.append({"name": name, "error": f"Unknown tool: {name}"})
                continue
            try:
                result = fn(**args)
                results.append({"name": name, "result": result})
            except Exception as exc:  # noqa: BLE001
                logger.exception("Tool %s failed", name)
                results.append({"name": name, "error": str(exc)})
        return results

    # ------------------------------------------------------------------
    # Intent routing (pre-fetches tool results before LLM generation)
    # ------------------------------------------------------------------

    def _detect_intent(self, message: str) -> List[str]:
        """Detect user intent from keywords. Returns list of intent names."""
        msg_lower = message.lower()
        intents = []
        for intent, keywords in _INTENT_KEYWORDS.items():
            if any(kw in msg_lower for kw in keywords):
                intents.append(intent)
        return intents or ["general"]

    def _extract_card_names(self, message: str) -> List[str]:
        """Extract quoted card names from the message."""
        return _CARD_NAME_RE.findall(message)

    def _pre_fetch_context(self, message: str, intents: List[str]) -> str:
        """Run relevant tools based on detected intent. Returns context string."""
        results = []
        card_names = self._extract_card_names(message)
        bracket_match = _BRACKET_RE.search(message)

        # Look up any quoted card names + their official rulings
        rag = get_rules_rag()
        for name in card_names:
            try:
                card_data = tool_get_card(name)
                if card_data.get("found"):
                    results.append(f"Card lookup [{name}]: {json.dumps(card_data)}")
                    tags = tool_detect_tags(
                        card_data.get("oracle_text", ""),
                        card_data.get("type_line", ""),
                    )
                    results.append(f"Tags [{name}]: {json.dumps(tags)}")
                    # Include official rulings for this card
                    card_rulings = rag.search_card_rulings(name)
                    if card_rulings:
                        results.append(f"Official rulings for {name}:")
                        for ruling in card_rulings[:5]:
                            results.append(f"  - {ruling}")
            except Exception:
                pass

        # Intent-specific lookups
        if "rules" in intents:
            # RAG: search comprehensive rules + card-specific rulings
            rag = get_rules_rag()
            rules_context = rag.search_all(
                message,
                card_names=card_names or None,
                limit=8,
            )
            if rules_context:
                results.append(rules_context)

            if bracket_match:
                bracket = int(bracket_match.group(1))
                info = tool_get_bracket_info(bracket)
                results.append(f"Bracket {bracket} info: {json.dumps(info)}")
                for name in card_names:
                    try:
                        rules = tool_check_rules(name, bracket)
                        results.append(f"Rules check [{name}]: {json.dumps(rules)}")
                    except Exception:
                        pass

        if "search" in intents or "card_info" in intents:
            # Semantic search for the user's query
            try:
                search_results = tool_search_cards(message, k=10)
                if search_results.get("cards"):
                    top_cards = [c["name"] for c in search_results["cards"][:10]]
                    results.append(f"Search results: {json.dumps(top_cards)}")
            except Exception:
                pass

        if "card_info" in intents and not card_names:
            # Try to find the card name from the message
            for prefix in ["what is ", "what does ", "tell me about ", "explain ",
                           "how does ", "how good is "]:
                if prefix in message.lower():
                    after = message.lower().split(prefix, 1)[1]
                    # Cut at conjunctions/punctuation to isolate the card name
                    candidate = re.split(r'\b(?:and|or|in|for|with|why|how|when)\b|[?,.]', after)[0].strip()
                    if not candidate:
                        break
                    try:
                        # Try exact match first
                        card_data = tool_get_card(candidate.title())
                        if not card_data.get("found"):
                            # Fuzzy: search and take top result
                            search_results = tool_search_cards(candidate, k=3)
                            if search_results.get("cards"):
                                card_data = tool_get_card(search_results["cards"][0]["name"])
                        if card_data.get("found"):
                            results.append(f"Card lookup [{card_data['name']}]: {json.dumps(card_data)}")
                            tags = tool_detect_tags(
                                card_data.get("oracle_text", ""),
                                card_data.get("type_line", ""),
                            )
                            results.append(f"Tags [{card_data['name']}]: {json.dumps(tags)}")
                    except Exception:
                        pass
                    break

        return "\n".join(results) if results else ""

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def chat(
        self,
        message: str,
        session_id: str = "default",
        user_id: str = "anon",
    ) -> str:
        """Process a user message and return the agent's response.

        Steps:
        1. Detect intent and pre-fetch relevant tool data.
        2. Build context from memory + tool results.
        3. Generate response with the model.
        4. If model also makes tool calls, execute those too.
        """
        wm = self._get_session(session_id)

        # User prefs
        user_prefs = self.user_memory.get_all(user_id)
        user_context = json.dumps(user_prefs, indent=2) if user_prefs else "None"

        # World knowledge
        insights = self.world_memory.search(message, limit=3)
        world_context = (
            "\n".join(f"- {ins['content']}" for ins in insights)
            if insights else "None"
        )

        # Detect intent and pre-fetch tool data
        intents = self._detect_intent(message)
        prefetched = self._pre_fetch_context(message, intents)
        logger.info("Intents: %s, prefetched %d chars", intents, len(prefetched))

        # Build system prompt
        system_prompt = build_system_prompt(user_context, world_context)
        if prefetched:
            system_prompt += f"\n\nRelevant data (retrieved for this query):\n{prefetched}"
        system_prompt += "\n\n" + TOOL_CALL_FORMAT

        # Add user message to working memory
        wm.add("user", message)

        # Build messages
        messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_prompt},
        ] + wm.get_messages()

        # Generate (with tool-call fallback loop)
        final_text = ""
        for _round in range(3):
            response_text = self._generate(messages, max_tokens=1024)
            tool_calls = self._parse_tool_calls(response_text)

            if not tool_calls:
                final_text = response_text
                break

            tool_results = self._execute_tools(tool_calls)
            results_text = "\n".join(
                f"[{r['name']}]: {json.dumps(r.get('result', r.get('error')))}"
                for r in tool_results
            )
            messages.append({"role": "assistant", "content": response_text})
            messages.append({"role": "user", "content": f"Tool results:\n{results_text}"})
        else:
            final_text = response_text  # type: ignore[possibly-undefined]

        clean_response = self._strip_tool_calls(final_text)
        wm.add("assistant", clean_response)
        return clean_response
