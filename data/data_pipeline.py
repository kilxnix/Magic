from __future__ import annotations

import argparse
import sys
import json
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import faiss  # type: ignore
import numpy as np
from sentence_transformers import SentenceTransformer

from .scryfall_client import download_bulk_data, iter_cards_from_bulk

DATA_DIR = Path("mtg_data")
BULK_JSON_PATH = DATA_DIR / "scryfall_oracle_cards.json"
CARDS_JSONL_PATH = DATA_DIR / "cards_min.jsonl"
EMBEDDINGS_PATH = DATA_DIR / "card_embeddings.npy"
EMBEDDINGS_META_PATH = DATA_DIR / "card_embeddings_meta.json"
FAISS_INDEX_PATH = DATA_DIR / "card_index.faiss"


def _card_to_text(card: Dict) -> str:
    parts = [
        card.get("name", ""),
        card.get("mana_cost", ""),
        card.get("type_line", ""),
        card.get("oracle_text", ""),
        " ".join(card.get("keywords") or []),
    ]
    return "\n".join(p for p in parts if p)


def _minimize_card(card: Dict) -> Dict:
    return {
        "id": card.get("id"),
        "name": card.get("name"),
        "layout": card.get("layout"),
        "type_line": card.get("type_line"),
        "oracle_text": card.get("oracle_text"),
        "mana_cost": card.get("mana_cost"),
        "cmc": card.get("cmc"),
        "colors": card.get("colors"),
        "color_identity": card.get("color_identity"),
        "keywords": card.get("keywords"),
        "legalities": card.get("legalities"),
        "rarity": card.get("rarity"),
        "prices": card.get("prices"),
        "set": card.get("set"),
        "collector_number": card.get("collector_number"),
        "image_uris": card.get("image_uris"),
        "card_faces": card.get("card_faces"),
        "reserved": card.get("reserved", False),
    }


class MTGDataPipeline:
    def __init__(
        self,
        data_dir: Path = DATA_DIR,
        model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    ) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.model_name = model_name

    def download_bulk(self, force: bool = False) -> Path:
        if BULK_JSON_PATH.exists() and not force:
            return BULK_JSON_PATH
        return download_bulk_data(BULK_JSON_PATH)

    def extract_cards(
        self,
        force: bool = False,
        legal_in: Optional[Iterable[str]] = None,
    ) -> Path:
        if CARDS_JSONL_PATH.exists() and not force:
            return CARDS_JSONL_PATH
        source_path = self.download_bulk(force=False)
        legal_set = {fmt.strip().lower() for fmt in (legal_in or []) if fmt}
        with open(CARDS_JSONL_PATH, "w", encoding="utf-8") as f:
            for card in iter_cards_from_bulk(source_path):
                if card.get("lang") != "en":
                    continue
                if card.get("type_line") is None:
                    continue
                if legal_set:
                    legalities = card.get("legalities") or {}
                    if any(legalities.get(fmt) != "legal" for fmt in legal_set):
                        continue
                minimized = _minimize_card(card)
                f.write(json.dumps(minimized, default=str) + "\n")
        return CARDS_JSONL_PATH

    def load_cards(self) -> List[Dict]:
        cards = []
        with open(CARDS_JSONL_PATH, "r", encoding="utf-8") as f:
            for line in f:
                cards.append(json.loads(line))
        return cards

    def build_embeddings(
        self,
        batch_size: int = 256,
        force: bool = False,
    ) -> Path:
        if EMBEDDINGS_PATH.exists() and not force:
            return EMBEDDINGS_PATH
        self.extract_cards(force=False)
        model = SentenceTransformer(self.model_name)
        texts = []
        ids = []
        with open(CARDS_JSONL_PATH, "r", encoding="utf-8") as f:
            for line in f:
                card = json.loads(line)
                ids.append(card["id"])
                texts.append(_card_to_text(card))
        embeddings = model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=True,
            normalize_embeddings=True,
        )
        embeddings = np.asarray(embeddings, dtype="float32")
        np.save(EMBEDDINGS_PATH, embeddings)
        with open(EMBEDDINGS_META_PATH, "w", encoding="utf-8") as f:
            json.dump({"ids": ids}, f)
        return EMBEDDINGS_PATH

    def build_faiss_index(self, force: bool = False) -> Path:
        if FAISS_INDEX_PATH.exists() and not force:
            return FAISS_INDEX_PATH
        self.build_embeddings(force=False)
        embeddings = np.load(EMBEDDINGS_PATH)
        index = faiss.IndexFlatIP(embeddings.shape[1])
        index.add(embeddings)
        faiss.write_index(index, str(FAISS_INDEX_PATH))
        return FAISS_INDEX_PATH

    def search(self, query: str, k: int = 10) -> List[Dict]:
        self.build_faiss_index(force=False)
        index = faiss.read_index(str(FAISS_INDEX_PATH))
        model = SentenceTransformer(self.model_name)
        query_vec = model.encode([query], normalize_embeddings=True).astype("float32")
        scores, indices = index.search(query_vec, k)
        ids = []
        with open(EMBEDDINGS_META_PATH, "r", encoding="utf-8") as f:
            meta = json.load(f)
            ids = meta["ids"]
        results = []
        with open(CARDS_JSONL_PATH, "r", encoding="utf-8") as f:
            cards = [json.loads(line) for line in f]
        for idx, score in zip(indices[0], scores[0]):
            if idx == -1:
                continue
            card = cards[idx]
            card["score"] = float(score)
            results.append(card)
        return results


def _cmd_download(args: argparse.Namespace) -> None:
    MTGDataPipeline().download_bulk(force=args.force)


def _cmd_extract(args: argparse.Namespace) -> None:
    MTGDataPipeline().extract_cards(force=args.force, legal_in=args.legal)


def _cmd_embed(args: argparse.Namespace) -> None:
    MTGDataPipeline().build_embeddings(batch_size=args.batch_size, force=args.force)


def _cmd_index(args: argparse.Namespace) -> None:
    MTGDataPipeline().build_faiss_index(force=args.force)


def _cmd_search(args: argparse.Namespace) -> None:
    pipeline = MTGDataPipeline()
    results = pipeline.search(args.query, k=args.k)
    for card in results:
        print(f"{card['name']} ({card.get('type_line', '')}) score={card['score']:.3f}")


def main() -> None:
    parser = argparse.ArgumentParser(description="MTG local data pipeline")
    sub = parser.add_subparsers(dest="command", required=True)

    download_p = sub.add_parser("download", help="download Scryfall bulk JSON")
    download_p.add_argument("--force", action="store_true")
    download_p.set_defaults(func=_cmd_download)

    extract_p = sub.add_parser("extract", help="extract minimal card data")
    extract_p.add_argument("--force", action="store_true")
    extract_p.add_argument(
        "--legal",
        action="append",
        default=[],
        help="require legal in format (repeatable, e.g. --legal commander --legal standard)",
    )
    extract_p.set_defaults(func=_cmd_extract)

    embed_p = sub.add_parser("embed", help="build embeddings")
    embed_p.add_argument("--force", action="store_true")
    embed_p.add_argument("--batch-size", type=int, default=256)
    embed_p.set_defaults(func=_cmd_embed)

    index_p = sub.add_parser("index", help="build FAISS index")
    index_p.add_argument("--force", action="store_true")
    index_p.set_defaults(func=_cmd_index)

    search_p = sub.add_parser("search", help="semantic search")
    search_p.add_argument("query")
    search_p.add_argument("-k", type=int, default=10)
    search_p.set_defaults(func=_cmd_search)

    # Support "all" shortcut to run full pipeline
    if len(sys.argv) > 1 and sys.argv[1] == "all":
        force = "--force" in sys.argv
        steps = [
            ("Downloading Scryfall bulk data", _cmd_download),
            ("Extracting Commander-legal cards", _cmd_extract),
            ("Building embeddings", _cmd_embed),
            ("Building FAISS index", _cmd_index),
        ]
        for i, (label, func) in enumerate(steps, 1):
            print(f"\n[{i}/4] {label}...")
            func(argparse.Namespace(force=force, legal=[], batch_size=256))
            print(f"[{i}/4] {label} — done!")
        print("\nPipeline complete!")
        return

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
