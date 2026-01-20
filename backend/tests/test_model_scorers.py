# backend/tests/test_model_scorers.py
"""Tests for the model scorers module."""

import pytest
from pathlib import Path

# Model paths for checking availability
MODELS_DIR = Path(__file__).parent.parent.parent / "models"
GPT2_MODEL_PATH = MODELS_DIR / "GPT2 Model"
QWEN_MODEL_PATH = MODELS_DIR / "QWEN Model" / "mtg_brain_card_knowledge.Q4_K_M.gguf"

# Check if llama_cpp is available for Qwen
try:
    import llama_cpp
    LLAMA_CPP_AVAILABLE = True
except ImportError:
    LLAMA_CPP_AVAILABLE = False

# Skip markers for slow model tests
requires_gpt2 = pytest.mark.skipif(
    not GPT2_MODEL_PATH.exists(),
    reason="GPT2 model not found"
)
requires_qwen = pytest.mark.skipif(
    not (QWEN_MODEL_PATH.exists() and LLAMA_CPP_AVAILABLE),
    reason="Qwen GGUF model not found or llama-cpp-python not installed"
)

# Mark model tests as slow since they require loading large models
slow = pytest.mark.slow


class TestGPT2Scorer:
    """Tests for GPT2Scorer class."""

    @requires_gpt2
    @slow
    def test_gpt2_scorer_loads(self):
        """Test that GPT2 model loads successfully."""
        from backend.model_scorers import GPT2Scorer

        scorer = GPT2Scorer()
        assert scorer.model is not None
        assert scorer.tokenizer is not None

    @requires_gpt2
    @slow
    def test_score_similarity_returns_float(self):
        """Test scoring a pair of cards returns a float 0-1."""
        from backend.model_scorers import GPT2Scorer

        scorer = GPT2Scorer()
        score = scorer.score_similarity(
            source_card="Swords to Plowshares",
            candidate_card="Path to Exile",
            source_text="Exile target creature. Its controller gains life equal to its power.",
            candidate_text="Exile target creature. Its controller searches their library for a basic land card, puts that card onto the battlefield tapped, then shuffles."
        )
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0

    @requires_gpt2
    @slow
    def test_score_similarity_different_cards(self):
        """Test that similar cards score higher than dissimilar cards."""
        from backend.model_scorers import GPT2Scorer

        scorer = GPT2Scorer()

        # Similar removal spells
        similar_score = scorer.score_similarity(
            source_card="Swords to Plowshares",
            candidate_card="Path to Exile",
            source_text="Exile target creature. Its controller gains life equal to its power.",
            candidate_text="Exile target creature. Its controller searches their library for a basic land card."
        )

        # Dissimilar cards (removal vs ramp)
        dissimilar_score = scorer.score_similarity(
            source_card="Swords to Plowshares",
            candidate_card="Cultivate",
            source_text="Exile target creature. Its controller gains life equal to its power.",
            candidate_text="Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle."
        )

        # Both should be valid scores
        assert 0.0 <= similar_score <= 1.0
        assert 0.0 <= dissimilar_score <= 1.0

    @requires_gpt2
    @slow
    def test_batch_score(self):
        """Test batch scoring multiple candidates."""
        from backend.model_scorers import GPT2Scorer

        scorer = GPT2Scorer()
        candidates = [
            ("Path to Exile", "Exile target creature. Its controller searches their library for a basic land card."),
            ("Cultivate", "Search your library for up to two basic land cards."),
        ]

        scores = scorer.batch_score(
            source_card="Swords to Plowshares",
            source_text="Exile target creature. Its controller gains life equal to its power.",
            candidates=candidates
        )

        assert len(scores) == 2
        assert all(isinstance(s, float) for s in scores)
        assert all(0.0 <= s <= 1.0 for s in scores)


class TestQwenScorer:
    """Tests for QwenScorer class."""

    @requires_qwen
    @slow
    def test_qwen_scorer_loads(self):
        """Test that Qwen model loads successfully."""
        from backend.model_scorers import QwenScorer

        scorer = QwenScorer()
        assert scorer.llm is not None

    @requires_qwen
    @slow
    def test_qwen_score_similarity(self):
        """Test Qwen scoring returns a float 0-1."""
        from backend.model_scorers import QwenScorer

        scorer = QwenScorer()
        score = scorer.score_similarity(
            source_card="Swords to Plowshares",
            candidate_card="Path to Exile",
            source_text="Exile target creature. Its controller gains life equal to its power.",
            candidate_text="Exile target creature. Its controller searches their library for a basic land card."
        )
        assert isinstance(score, float)
        assert 0.0 <= score <= 1.0

    @requires_qwen
    @slow
    def test_qwen_generate_tradeoff_explanation(self):
        """Test that Qwen can generate trade-off explanations."""
        from backend.model_scorers import QwenScorer

        scorer = QwenScorer()
        explanation = scorer.generate_tradeoff_explanation(
            source_card="Swords to Plowshares",
            candidate_card="Path to Exile",
            source_text="Exile target creature. Its controller gains life equal to its power.",
            candidate_text="Exile target creature. Its controller searches their library for a basic land card.",
            source_price=2.50,
            candidate_price=5.00,
            source_cmc=1,
            candidate_cmc=1
        )
        assert isinstance(explanation, str)
        assert len(explanation) > 0


class TestScoreCardPair:
    """Tests for the score_card_pair convenience function."""

    @requires_gpt2
    @slow
    def test_score_card_pair_gpt2_only(self):
        """Test scoring with only GPT2."""
        from backend.model_scorers import score_card_pair

        scores = score_card_pair(
            source_card="Sol Ring",
            candidate_card="Arcane Signet",
            source_text="{T}: Add {C}{C}.",
            candidate_text="{T}: Add one mana of any color in your commander's color identity.",
            use_gpt2=True,
            use_qwen=False
        )

        assert "gpt2" in scores
        assert isinstance(scores["gpt2"], float)
        assert 0.0 <= scores["gpt2"] <= 1.0

    @requires_gpt2
    @requires_qwen
    @slow
    def test_score_card_pair_both_models(self):
        """Test scoring with both models."""
        from backend.model_scorers import score_card_pair

        scores = score_card_pair(
            source_card="Sol Ring",
            candidate_card="Arcane Signet",
            source_text="{T}: Add {C}{C}.",
            candidate_text="{T}: Add one mana of any color in your commander's color identity.",
            use_gpt2=True,
            use_qwen=True
        )

        assert "gpt2" in scores
        assert "qwen" in scores
        assert all(isinstance(v, float) for v in scores.values())
        assert all(0.0 <= v <= 1.0 for v in scores.values())


class TestSingletonGetters:
    """Tests for singleton getter functions."""

    @requires_gpt2
    @slow
    def test_get_gpt2_scorer_returns_same_instance(self):
        """Test that get_gpt2_scorer returns the same instance."""
        from backend.model_scorers import get_gpt2_scorer

        scorer1 = get_gpt2_scorer()
        scorer2 = get_gpt2_scorer()
        assert scorer1 is scorer2

    @requires_qwen
    @slow
    def test_get_qwen_scorer_returns_same_instance(self):
        """Test that get_qwen_scorer returns the same instance."""
        from backend.model_scorers import get_qwen_scorer

        scorer1 = get_qwen_scorer()
        scorer2 = get_qwen_scorer()
        assert scorer1 is scorer2


class TestModelPaths:
    """Tests for model path configuration (fast, no model loading)."""

    def test_model_paths_configured(self):
        """Test that model paths are correctly configured."""
        from backend.model_scorers import GPT2_MODEL_PATH, QWEN_MODEL_PATH, MODELS_DIR

        assert MODELS_DIR.name == "models"
        assert "GPT2" in str(GPT2_MODEL_PATH)
        assert "QWEN" in str(QWEN_MODEL_PATH)

    def test_gpt2_model_exists(self):
        """Test that GPT2 model directory exists."""
        assert GPT2_MODEL_PATH.exists(), f"GPT2 model not found at {GPT2_MODEL_PATH}"

    def test_qwen_model_exists(self):
        """Test that Qwen model file exists."""
        assert QWEN_MODEL_PATH.exists(), f"Qwen model not found at {QWEN_MODEL_PATH}"
