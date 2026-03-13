# backend/model_scorers.py
"""Model-based scorers for card similarity using GPT2 and Qwen."""

import torch
from pathlib import Path
from typing import Optional, Tuple

# Model paths
MODELS_DIR = Path(__file__).parent.parent / "models"
GPT2_MODEL_PATH = MODELS_DIR / "GPT2 Model"
QWEN_MODEL_PATH = MODELS_DIR / "QWEN Model"


class GPT2Scorer:
    """Score card similarity using fine-tuned GPT2 model."""

    def __init__(self):
        self.model = None
        self.tokenizer = None
        self._load_model()

    def _load_model(self):
        """Load the GPT2 model and tokenizer."""
        from transformers import GPT2LMHeadModel, GPT2Tokenizer

        if not GPT2_MODEL_PATH.exists():
            raise FileNotFoundError(f"GPT2 model not found at {GPT2_MODEL_PATH}")

        self.tokenizer = GPT2Tokenizer.from_pretrained(str(GPT2_MODEL_PATH))
        self.model = GPT2LMHeadModel.from_pretrained(str(GPT2_MODEL_PATH))
        self.model.eval()

        # Set pad token if not set
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token

    def score_similarity(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str
    ) -> float:
        """
        Score how similar/substitutable two cards are.

        Uses perplexity-based scoring: if the model finds the candidate
        a natural continuation/replacement in MTG context, score is higher.

        Args:
            source_card: Name of the original card
            candidate_card: Name of the candidate substitute
            source_text: Oracle text of the source card
            candidate_text: Oracle text of the candidate card

        Returns:
            float between 0 and 1, higher means more similar
        """
        # Create a prompt that asks the model to evaluate substitutability
        prompt = f"""In Magic: The Gathering Commander, comparing cards:
Card A: {source_card} - {source_text}
Card B: {candidate_card} - {candidate_text}
These cards are similar because they both"""

        # Tokenize
        inputs = self.tokenizer(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=512
        )

        # Get model output
        with torch.no_grad():
            outputs = self.model(**inputs, labels=inputs["input_ids"])
            loss = outputs.loss.item()

        # Convert loss to similarity score (lower loss = higher similarity)
        # Typical loss range is 2-6, map to 0-1
        score = max(0.0, min(1.0, 1.0 - (loss - 2.0) / 4.0))

        return score

    def batch_score(
        self,
        source_card: str,
        source_text: str,
        candidates: list[Tuple[str, str]]  # [(name, text), ...]
    ) -> list[float]:
        """
        Score multiple candidates against a source card.

        Args:
            source_card: Name of the original card
            source_text: Oracle text of the source card
            candidates: List of (name, oracle_text) tuples for candidates

        Returns:
            List of similarity scores (floats 0-1)
        """
        scores = []
        for cand_name, cand_text in candidates:
            score = self.score_similarity(source_card, cand_name, source_text, cand_text)
            scores.append(score)
        return scores


class QwenScorer:
    """Score card similarity using Qwen GGUF model."""

    def __init__(self):
        self.llm = None
        self._load_model()

    def _load_model(self):
        """Load the Qwen GGUF model using llama-cpp-python."""
        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError(
                "llama-cpp-python required for QwenScorer. "
                "Install with: pip install llama-cpp-python"
            )

        model_file = QWEN_MODEL_PATH / "mtg_brain_card_knowledge.Q4_K_M.gguf"
        if not model_file.exists():
            raise FileNotFoundError(f"Qwen model not found at {model_file}")

        self.llm = Llama(
            model_path=str(model_file),
            n_ctx=2048,
            n_threads=4,
            verbose=False
        )

    def score_similarity(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str
    ) -> float:
        """
        Score similarity using Qwen model.

        Args:
            source_card: Name of the original card
            candidate_card: Name of the candidate substitute
            source_text: Oracle text of the source card
            candidate_text: Oracle text of the candidate card

        Returns:
            float between 0 and 1, higher means more similar
        """
        prompt = f"""<|im_start|>system
You are an MTG expert. Rate card similarity from 0-10.<|im_end|>
<|im_start|>user
How similar is "{candidate_card}" to "{source_card}" as a substitute?
{source_card}: {source_text}
{candidate_card}: {candidate_text}
Reply with just a number 0-10.<|im_end|>
<|im_start|>assistant
"""

        output = self.llm(
            prompt,
            max_tokens=10,
            temperature=0.1,
            stop=["<|im_end|>"]
        )

        # Parse the number from response
        response = output['choices'][0]['text'].strip()
        try:
            score = float(response.split()[0])
            return min(1.0, max(0.0, score / 10.0))
        except (ValueError, IndexError):
            return 0.5  # Default middle score if parsing fails

    def generate_tradeoff_explanation(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str,
        source_price: float,
        candidate_price: float,
        source_cmc: int,
        candidate_cmc: int
    ) -> str:
        """
        Generate a natural language explanation of the trade-offs.

        Args:
            source_card: Name of the original card
            candidate_card: Name of the candidate substitute
            source_text: Oracle text of the source card
            candidate_text: Oracle text of the candidate card
            source_price: Price of the source card in USD
            candidate_price: Price of the candidate card in USD
            source_cmc: Converted mana cost of the source card
            candidate_cmc: Converted mana cost of the candidate card

        Returns:
            A string containing a brief trade-off explanation
        """
        prompt = f"""<|im_start|>system
You are an MTG deck building advisor. Give brief, helpful card comparisons.<|im_end|>
<|im_start|>user
Compare these cards as substitutes:
Original: {source_card} (${source_price:.2f}, {source_cmc} CMC) - {source_text}
Alternative: {candidate_card} (${candidate_price:.2f}, {candidate_cmc} CMC) - {candidate_text}

Give a one-sentence trade-off summary.<|im_end|>
<|im_start|>assistant
"""

        output = self.llm(
            prompt,
            max_tokens=100,
            temperature=0.7,
            stop=["<|im_end|>", "\n\n"]
        )

        return output['choices'][0]['text'].strip()


# Singleton instances
_gpt2_scorer: Optional[GPT2Scorer] = None
_qwen_scorer: Optional[QwenScorer] = None


def get_gpt2_scorer() -> GPT2Scorer:
    """Get or create the GPT2 scorer singleton."""
    global _gpt2_scorer
    if _gpt2_scorer is None:
        _gpt2_scorer = GPT2Scorer()
    return _gpt2_scorer


def get_qwen_scorer() -> QwenScorer:
    """Get or create the Qwen scorer singleton."""
    global _qwen_scorer
    if _qwen_scorer is None:
        _qwen_scorer = QwenScorer()
    return _qwen_scorer


def score_card_pair(
    source_card: str,
    candidate_card: str,
    source_text: str,
    candidate_text: str,
    use_gpt2: bool = True,
    use_qwen: bool = True
) -> dict:
    """
    Score a card pair using available models.

    Args:
        source_card: Name of the original card
        candidate_card: Name of the candidate substitute
        source_text: Oracle text of the source card
        candidate_text: Oracle text of the candidate card
        use_gpt2: Whether to use the GPT2 model for scoring
        use_qwen: Whether to use the Qwen model for scoring

    Returns:
        Dictionary with model names as keys and scores as values,
        e.g., {"gpt2": 0.75, "qwen": 0.8}
    """
    scores = {}

    if use_gpt2:
        try:
            gpt2 = get_gpt2_scorer()
            scores["gpt2"] = gpt2.score_similarity(
                source_card, candidate_card, source_text, candidate_text
            )
        except Exception as e:
            print(f"GPT2 scoring failed: {e}")
            scores["gpt2"] = 0.5

    if use_qwen:
        try:
            qwen = get_qwen_scorer()
            scores["qwen"] = qwen.score_similarity(
                source_card, candidate_card, source_text, candidate_text
            )
        except Exception as e:
            print(f"Qwen scoring failed: {e}")
            scores["qwen"] = 0.5

    return scores


# Qwen3.5-4B GGUF model path
QWEN35_SCORER_PATH = MODELS_DIR / "Qwen35" / "mtg-scorer-gguf"


class Qwen35Scorer:
    """Score card-commander fit using fine-tuned Qwen3.5-4B GGUF model."""

    def __init__(self):
        self.llm = None
        self._load_model()

    def _load_model(self):
        """Load the Qwen3.5-4B GGUF model using llama-cpp-python."""
        try:
            from llama_cpp import Llama
        except ImportError:
            raise ImportError(
                "llama-cpp-python required for Qwen35Scorer. "
                "Install with: pip install llama-cpp-python"
            )

        gguf_files = list(QWEN35_SCORER_PATH.glob("*.gguf"))
        if not gguf_files:
            raise FileNotFoundError(
                f"No GGUF model found in {QWEN35_SCORER_PATH}"
            )

        model_file = gguf_files[0]
        self.llm = Llama(
            model_path=str(model_file),
            n_ctx=512,
            n_gpu_layers=-1,
            n_threads=4,
            verbose=False
        )

    def score_similarity(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str,
        commander_name: str = "",
        commander_colors: str = ""
    ) -> float:
        """
        Score how well a candidate card fits a commander's deck.

        Args:
            source_card: Name of the original card
            candidate_card: Name of the candidate substitute
            source_text: Oracle text of the source card
            candidate_text: Oracle text of the candidate card
            commander_name: Name of the commander (optional)
            commander_colors: Color identity of the commander (optional)

        Returns:
            float between 0 and 1, higher means better fit
        """
        commander_info = ""
        if commander_name:
            commander_info = f"Commander: {commander_name}"
            if commander_colors:
                commander_info += f" ({commander_colors})"
            commander_info += "\n"

        prompt = f"""<|im_start|>system
You are an MTG Commander deckbuilding expert. Rate how well a card fits in this commander's deck.<|im_end|>
<|im_start|>user
{commander_info}Rate how well "{candidate_card}" fits in this commander's deck compared to "{source_card}".
{source_card}: {source_text}
{candidate_card}: {candidate_text}
Reply with just a number 0-10.<|im_end|>
<|im_start|>assistant
"""

        output = self.llm(
            prompt,
            max_tokens=50,
            temperature=0.1,
            stop=["<|im_end|>"]
        )

        response = output['choices'][0]['text'].strip()
        try:
            import re
            match = re.search(r'\d+(?:\.\d+)?', response)
            if match:
                score = float(match.group())
                return min(1.0, max(0.0, score / 10.0))
            return 0.5
        except (ValueError, AttributeError):
            return 0.5

    def generate_tradeoff_explanation(
        self,
        source_card: str,
        candidate_card: str,
        source_text: str,
        candidate_text: str,
        source_price: float,
        candidate_price: float,
        source_cmc: int,
        candidate_cmc: int
    ) -> str:
        """
        Generate a natural language explanation of the trade-offs.

        Args:
            source_card: Name of the original card
            candidate_card: Name of the candidate substitute
            source_text: Oracle text of the source card
            candidate_text: Oracle text of the candidate card
            source_price: Price of the source card in USD
            candidate_price: Price of the candidate card in USD
            source_cmc: Converted mana cost of the source card
            candidate_cmc: Converted mana cost of the candidate card

        Returns:
            A string containing a brief trade-off explanation
        """
        prompt = f"""<|im_start|>system
You are an MTG deck building advisor. Give brief, helpful card comparisons.<|im_end|>
<|im_start|>user
Compare these cards as substitutes:
Original: {source_card} (${source_price:.2f}, {source_cmc} CMC) - {source_text}
Alternative: {candidate_card} (${candidate_price:.2f}, {candidate_cmc} CMC) - {candidate_text}

Give a one-sentence trade-off summary.<|im_end|>
<|im_start|>assistant
"""

        output = self.llm(
            prompt,
            max_tokens=100,
            temperature=0.7,
            stop=["<|im_end|>"]
        )

        return output['choices'][0]['text'].strip()


# Singleton instance for Qwen35Scorer
_qwen35_scorer: Optional[Qwen35Scorer] = None


def get_qwen35_scorer() -> Qwen35Scorer:
    """Get or create the Qwen35 scorer singleton."""
    global _qwen35_scorer
    if _qwen35_scorer is None:
        _qwen35_scorer = Qwen35Scorer()
    return _qwen35_scorer
