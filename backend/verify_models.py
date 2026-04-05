#!/usr/bin/env python3
"""Quick verification script to confirm scorer/composer model placement.

Run:  python -m backend.verify_models  (from the Magic/ directory)

Expected output:
  - Scorer model should respond with a number (0-10) for a card rating
  - Composer model should respond with card names grouped by category headers

If the outputs appear swapped, swap the safetensors files between the two
model directories and re-run.
"""

import sys
from pathlib import Path

# Ensure project root is on the path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def verify_scorer():
    """Test the scorer model with a simple card-rating prompt."""
    from backend.model_scorers import Qwen35Scorer, QWEN35_SCORER_PATH

    print(f"Scorer model path: {QWEN35_SCORER_PATH}")
    print(f"  safetensors: {list(QWEN35_SCORER_PATH.glob('*.safetensors'))}")
    print(f"  gguf:        {list(QWEN35_SCORER_PATH.glob('*.gguf'))}")
    print()

    scorer = Qwen35Scorer()
    print(f"  Backend: {scorer._backend}")

    score = scorer.score_similarity(
        source_card="Sol Ring",
        candidate_card="Arcane Signet",
        source_text="Tap: Add two colorless mana.",
        candidate_text="Tap: Add one mana of any color in your commander's color identity.",
        commander_name="Atraxa, Praetors' Voice",
        commander_colors="WUBG",
    )
    print(f"  Score (Sol Ring vs Arcane Signet): {score:.2f}")
    print(f"  PASS: scorer returned a numeric score" if 0 <= score <= 1 else "  WARN: unexpected score range")
    return score


def verify_composer():
    """Test the composer model with a short deck prompt."""
    from backend.model_composer import DeckComposer, COMPOSER_MODEL_PATH

    print(f"Composer model path: {COMPOSER_MODEL_PATH}")
    print(f"  safetensors: {list(COMPOSER_MODEL_PATH.glob('*.safetensors'))}")
    print(f"  gguf:        {list(COMPOSER_MODEL_PATH.glob('*.gguf'))}")
    print()

    composer = DeckComposer()
    composer._load_model()
    print(f"  Backend: {composer._backend}")

    # Build a test prompt manually and generate a short response
    prompt = """<|im_start|>system
You are an expert MTG Commander deckbuilder. Build a 99-card deck for the given commander.<|im_end|>
<|im_start|>user
Build a 99-card Commander deck for Atraxa, Praetors' Voice.
Colors: WUBG
Power Level (Bracket): 3
Theme/Strategy: +1/+1 counters

List cards grouped by category using '## Category (N)' headers. End with '## Lands (N)' for the land base. One card per line.<|im_end|>
<|im_start|>assistant
"""

    if composer._backend == "llama_cpp":
        output = composer.llm(prompt, max_tokens=200, temperature=0.7, stop=["<|im_end|>"])
        text = output["choices"][0]["text"]
    else:
        import torch
        messages = [
            {"role": "system", "content": "You are an expert MTG Commander deckbuilder. Build a 99-card deck for the given commander."},
            {"role": "user", "content": "Build a 99-card Commander deck for Atraxa, Praetors' Voice.\nColors: WUBG\nPower Level (Bracket): 3\nTheme/Strategy: +1/+1 counters\n\nList cards grouped by category using '## Category (N)' headers. End with '## Lands (N)' for the land base. One card per line."},
        ]
        input_text = composer.tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True,
            enable_thinking=False,
        )
        inputs = composer.tokenizer(input_text, return_tensors="pt").to(composer.model.device)
        with torch.no_grad():
            output_ids = composer.model.generate(
                **inputs,
                max_new_tokens=200,
                temperature=0.7,
                do_sample=True,
                pad_token_id=composer.tokenizer.pad_token_id or composer.tokenizer.eos_token_id,
            )
        new_tokens = output_ids[0][inputs["input_ids"].shape[1]:]
        text = composer.tokenizer.decode(new_tokens, skip_special_tokens=True)

    print(f"  First 500 chars of output:\n{text[:500]}")
    has_headers = "##" in text
    print(f"  PASS: output contains category headers" if has_headers else "  WARN: no '##' headers found — models may be swapped")
    return text


if __name__ == "__main__":
    print("=" * 60)
    print("MODEL VERIFICATION")
    print("=" * 60)
    print()

    print("--- SCORER ---")
    try:
        verify_scorer()
    except Exception as e:
        print(f"  ERROR: {e}")
    print()

    print("--- COMPOSER ---")
    try:
        verify_composer()
    except Exception as e:
        print(f"  ERROR: {e}")
    print()

    print("=" * 60)
    print("If outputs look swapped, run:")
    print("  python -m backend.swap_models")
    print("to swap the weight files between scorer and composer dirs.")
    print("=" * 60)
