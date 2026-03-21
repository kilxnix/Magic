"""Convert training scripts to Colab-ready .ipynb notebooks.

Splits each .py file on "# Cell N:" comments into notebook cells.
Saves .ipynb files to training/ directory for direct Colab upload.
"""

import json
import re
from pathlib import Path

SCRIPTS = [
    ("train_scorer.py", "MTG Scorer — Fine-tune Qwen for Card Rating"),
    ("train_composer.py", "MTG Composer — Fine-tune Qwen for Deck Generation"),
]

TRAINING_DIR = Path(__file__).parent


def script_to_notebook(script_path: Path, title: str) -> dict:
    """Convert a Python script with '# Cell N:' markers into a Jupyter notebook."""
    text = script_path.read_text()

    # Split on cell markers
    # Pattern: line starting with "# ---" followed by "# Cell N:" then "# ---"
    cell_pattern = r'# -{10,}\n# Cell \d+: (.+?)\n# -{10,}\n'
    parts = re.split(cell_pattern, text)

    cells = []

    # First part is the docstring — make it a markdown cell
    docstring = parts[0].strip()
    if docstring.startswith('"""') and '"""' in docstring[3:]:
        doc_content = docstring.split('"""')[1].strip()
        cells.append({
            "cell_type": "markdown",
            "metadata": {},
            "source": [f"# {title}\n\n{doc_content}"]
        })

    # Remaining parts alternate: cell_title, cell_code, cell_title, cell_code...
    for i in range(1, len(parts), 2):
        cell_title = parts[i].strip() if i < len(parts) else ""
        cell_code = parts[i + 1].strip() if i + 1 < len(parts) else ""

        if not cell_code:
            continue

        # Convert "# !pip install" comments to actual pip installs
        cell_code = cell_code.replace("# !pip install", "!pip install")

        # Add title as markdown cell
        if cell_title:
            cells.append({
                "cell_type": "markdown",
                "metadata": {},
                "source": [f"## {cell_title}"]
            })

        # Add code cell
        cells.append({
            "cell_type": "code",
            "metadata": {},
            "execution_count": None,
            "outputs": [],
            "source": cell_code.split("\n")
        })

    # Fix source format: each line needs \n except the last
    for cell in cells:
        lines = cell["source"] if isinstance(cell["source"], list) else cell["source"].split("\n")
        cell["source"] = [line + "\n" for line in lines[:-1]] + [lines[-1]] if lines else []

    notebook = {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {
                "display_name": "Python 3",
                "language": "python",
                "name": "python3"
            },
            "language_info": {"name": "python", "version": "3.10.0"},
            "accelerator": "GPU",
            "gpuClass": "premium",
        },
        "cells": cells,
    }
    return notebook


def main():
    for script_name, title in SCRIPTS:
        script_path = TRAINING_DIR / script_name
        if not script_path.exists():
            print(f"SKIP {script_name} — not found")
            continue

        notebook = script_to_notebook(script_path, title)
        out_path = TRAINING_DIR / script_name.replace(".py", ".ipynb")
        with open(out_path, "w") as f:
            json.dump(notebook, f, indent=2)
        print(f"Created {out_path.name} ({len(notebook['cells'])} cells)")


if __name__ == "__main__":
    main()
