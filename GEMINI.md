# MTG Commander Deck Generator

## Project Overview

This project is a Magic: The Gathering (MTG) Commander deck generation system. It leverages semantic search (FAISS + SentenceTransformers) and fine-tuned LLMs (GPT2/Qwen) to generate synergistic, rule-compliant, and power-level-aware Commander decks.

**Key Features:**
*   **Deck Generation:** Generates 100-card decks based on a commander, power bracket (1-5), theme, and budget.
*   **Card Scoring:** Uses "Perplexity Scoring" via LLMs to evaluate card synergy with the commander.
*   **Rules Enforcement:** Adheres to Commander deck construction rules, including banned lists and color identity.
*   **Optimization:** "Card Alternatives" feature to suggest upgrades or budget swaps.
*   **Visuals:** React frontend for deck viewing, generation, and export (Moxfield, Archidekt).

## Architecture & Tech Stack

### Backend (`backend/`)
*   **Framework:** FastAPI (Python)
*   **ML/AI:** PyTorch, Transformers (HuggingFace), FAISS (Semantic Search).
*   **Database:** SQLite (`data/decks.db` for decks, `data/card_images.db` for caching images).
*   **External APIs:** Scryfall (Card data & images), MTGJson (Prices).

### Frontend (`frontend/`)
*   **Framework:** React + Vite
*   **Language:** TypeScript
*   **Styling:** Tailwind CSS
*   **State:** React Hooks

### Data Pipeline (`data/`)
*   **Ingestion:** Downloads bulk data from Scryfall.
*   **Processing:** Extracts Commander-legal cards, generates embeddings (SentenceTransformers), builds FAISS index.

## Getting Started

### Prerequisites
*   Python 3.x
*   Node.js & npm

### Running the Application
The project includes a unified startup script that sets up the Python virtual environment, installs dependencies, and starts both the backend and frontend.

```bash
./start.sh
```

### Manual Commands

**Backend:**
```bash
# Activate venv
source .venv/bin/activate

# Run Server (Port 8000)
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Run Tests
pytest backend/tests/
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev # Runs on Port 5173
```

**Data Pipeline (Rebuild Index):**
```bash
python -m data.data_pipeline download extract embed index
```

## Development Conventions

*   **Code Style:**
    *   **Python:** Follow PEP 8. Type hints are used (`typing` module, Pydantic models).
    *   **TypeScript:** React functional components with hooks. Interface definitions in `types.ts`.
*   **Testing:**
    *   Backend tests reside in `backend/tests/`. Run with `pytest`.
    *   Ensure new logic is covered by unit tests, especially for scoring and rules.
*   **Project Structure:**
    *   `backend/main.py`: API entry point.
    *   `backend/deck_generator.py`: Core logic for deck construction.
    *   `backend/model_scorers.py`: LLM integration.
    *   `frontend/src/pages/`: Main application views.

## Critical Data Files
*   `mtg_data/cards_min.jsonl`: Minimal card data (cached).
*   `mtg_data/card_index.faiss`: Semantic search index.
*   `models/`: Directory containing fine-tuned local models.
