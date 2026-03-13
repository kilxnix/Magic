# backend/model_composer.py
"""Model-based deck composer using a fine-tuned Qwen3.5-4B GGUF model."""

import logging
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

# Model paths
MODELS_DIR = Path(__file__).parent.parent / "models"
COMPOSER_MODEL_PATH = MODELS_DIR / "Qwen35" / "mtg-composer-gguf"
SCORER_MODEL_PATH = MODELS_DIR / "Qwen35" / "mtg-scorer-gguf"

# System prompt for the composer model
COMPOSER_SYSTEM = (
    "You are an expert MTG Commander deckbuilder. "
    "Build a 99-card deck for the given commander."
)


class DeckComposer:
    """Compose Commander decks using a fine-tuned Qwen GGUF model."""

    def __init__(self):
        self.llm = None

    def _load_model(self):
        """Lazy-load the Qwen GGUF composer model."""
        if self.llm is not None:
            return

        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError(
                "llama-cpp-python required for DeckComposer. "
                "Install with: pip install llama-cpp-python"
            )

        gguf_files = list(COMPOSER_MODEL_PATH.glob("*.gguf"))
        if not gguf_files:
            raise FileNotFoundError(
                f"No GGUF model file found in {COMPOSER_MODEL_PATH}"
            )

        model_file = gguf_files[0]
        logger.info(f"Loading composer model from {model_file}")

        self.llm = Llama(
            model_path=str(model_file),
            n_ctx=4096,
            n_gpu_layers=-1,
            verbose=False,
        )

    @staticmethod
    def _build_prompt(
        commander_name: str,
        colors: List[str],
        bracket: int,
        theme: str,
    ) -> str:
        """
        Build the user prompt for deck composition.

        Args:
            commander_name: Name of the Commander card
            colors: List of color symbols, e.g. ['W', 'U', 'B']
            bracket: Power level bracket (1-5)
            theme: Deck theme or strategy description

        Returns:
            Formatted prompt string
        """
        color_str = "".join(colors) if colors else "Colorless"
        return (
            f"Build a 99-card Commander deck for {commander_name}.\n"
            f"Colors: {color_str}\n"
            f"Power Level (Bracket): {bracket}\n"
            f"Theme/Strategy: {theme}\n\n"
            "List cards grouped by category using '## Category (N)' headers. "
            "End with '## Lands (N)' for the land base. "
            "One card per line."
        )

    @staticmethod
    def _parse_model_output(output: str) -> Tuple[List[str], List[str]]:
        """
        Parse model output into cards and lands lists.

        Expected format:
            ## Category (N)
            Card Name
            1. Card Name
            ## Lands (N)
            Land Name

        Args:
            output: Raw text output from the model

        Returns:
            Tuple of (cards, lands) — both are lists of card name strings.
            Cards in land sections go into lands; all others go into cards.
        """
        cards: List[str] = []
        lands: List[str] = []
        in_lands = False

        for raw_line in output.splitlines():
            line = raw_line.strip()

            # Skip empty lines
            if not line:
                continue

            # Section headers: ## Category (N)
            if line.startswith("#"):
                # Detect whether we've entered the lands section
                lower = line.lower()
                if "land" in lower:
                    in_lands = True
                else:
                    in_lands = False
                continue

            # Skip lines beginning with common list markers (*, -)
            if line.startswith("*") or line.startswith("-"):
                continue

            # Skip lines that are too long to be a card name
            if len(line) > 80:
                continue

            # Strip leading "N. " or "N) " numbering (e.g. "1. Sol Ring")
            if len(line) >= 3 and line[0].isdigit():
                # Find where the actual name starts after the number prefix
                idx = 0
                while idx < len(line) and (line[idx].isdigit() or line[idx] in ". )"):
                    idx += 1
                name = line[idx:].strip()
            else:
                name = line

            if not name:
                continue

            if in_lands:
                lands.append(name)
            else:
                cards.append(name)

        return cards, lands

    @staticmethod
    def _validate_cards(
        cards: List[str],
        lands: List[str],
        card_db: dict,
        commander_identity: List[str],
    ) -> Tuple[List[str], List[str]]:
        """
        Validate cards against the card database and color identity.

        Args:
            cards: Non-land card names from model output
            lands: Land card names from model output
            card_db: Mapping of card name -> card data dict
            commander_identity: List of color symbols for the commander

        Returns:
            Tuple of (valid_cards, valid_lands) — only cards that exist in
            card_db and comply with color identity (lands only need to exist).
        """
        identity_set = set(commander_identity)

        valid_cards: List[str] = []
        for name in cards:
            data = card_db.get(name)
            if data is None:
                logger.debug(f"Composer: card not in database, skipping: {name!r}")
                continue
            card_identity = set(data.get("color_identity") or [])
            if not card_identity.issubset(identity_set):
                logger.debug(
                    f"Composer: color identity mismatch for {name!r} "
                    f"({card_identity} not subset of {identity_set})"
                )
                continue
            valid_cards.append(name)

        valid_lands: List[str] = []
        for name in lands:
            if card_db.get(name) is not None:
                valid_lands.append(name)
            else:
                logger.debug(f"Composer: land not in database, skipping: {name!r}")

        return valid_cards, valid_lands

    def compose_deck(
        self,
        commander_name: str,
        colors: List[str],
        bracket: int,
        theme: str,
        card_db: dict,
    ) -> Tuple[List[str], List[str]]:
        """
        Compose a Commander deck using the GGUF model.

        Args:
            commander_name: Name of the Commander card
            colors: List of color symbols for the commander
            bracket: Power level bracket (1-5)
            theme: Deck theme or strategy description
            card_db: Mapping of card name -> card data dict

        Returns:
            Tuple of (cards, lands) after validation against card_db
        """
        self._load_model()

        user_prompt = self._build_prompt(commander_name, colors, bracket, theme)

        # Qwen chat template format
        full_prompt = (
            f"<|im_start|>system\n{COMPOSER_SYSTEM}<|im_end|>\n"
            f"<|im_start|>user\n{user_prompt}<|im_end|>\n"
            f"<|im_start|>assistant\n"
        )

        logger.info(
            f"Composing deck for {commander_name} (bracket {bracket}, theme: {theme})"
        )

        output = self.llm(
            full_prompt,
            max_tokens=3000,
            temperature=0.7,
            top_p=0.9,
            stop=["<|im_end|>"],
        )

        raw_text = output["choices"][0]["text"]
        cards, lands = self._parse_model_output(raw_text)
        cards, lands = self._validate_cards(cards, lands, card_db, colors)

        logger.info(
            f"Composer produced {len(cards)} non-land cards and {len(lands)} lands "
            f"(after validation)"
        )

        return cards, lands


# Singleton instance
_composer: Optional[DeckComposer] = None


def get_composer() -> DeckComposer:
    """Get or create the DeckComposer singleton."""
    global _composer
    if _composer is None:
        _composer = DeckComposer()
    return _composer
