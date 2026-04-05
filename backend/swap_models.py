#!/usr/bin/env python3
"""Swap scorer and composer safetensors weight files.

Run if verify_models.py shows the models are in the wrong directories.

Usage:  python -m backend.swap_models  (from the Magic/ directory)
"""

import shutil
from pathlib import Path

MODELS_DIR = Path(__file__).parent.parent / "models" / "Qwen35"
SCORER_DIR = MODELS_DIR / "mtg-scorer-gguf"
COMPOSER_DIR = MODELS_DIR / "mtg-composer-gguf"
TMP_DIR = MODELS_DIR / "_swap_tmp"

WEIGHT_FILES = [
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
]


def main():
    print("Swapping weight files between scorer and composer directories...")

    # Move scorer weights to temp
    TMP_DIR.mkdir(exist_ok=True)
    for f in WEIGHT_FILES:
        src = SCORER_DIR / f
        if src.exists():
            print(f"  {src} -> {TMP_DIR / f}")
            shutil.move(str(src), str(TMP_DIR / f))

    # Move composer weights to scorer
    for f in WEIGHT_FILES:
        src = COMPOSER_DIR / f
        if src.exists():
            print(f"  {src} -> {SCORER_DIR / f}")
            shutil.move(str(src), str(SCORER_DIR / f))

    # Move temp (old scorer) to composer
    for f in WEIGHT_FILES:
        src = TMP_DIR / f
        if src.exists():
            print(f"  {src} -> {COMPOSER_DIR / f}")
            shutil.move(str(src), str(COMPOSER_DIR / f))

    TMP_DIR.rmdir()
    print("Done! Re-run: python -m backend.verify_models")


if __name__ == "__main__":
    main()
