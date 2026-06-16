from __future__ import annotations

import argparse
import sys
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional

import faiss  # type: ignore
import numpy as np
from sentence_transformers import SentenceTransformer

from .scryfall_client import download_bulk_data, get_sets_data, iter_cards_from_bulk

DATA_DIR = Path("mtg_data")
BULK_JSON_PATH = DATA_DIR / "scryfall_oracle_cards.json"
DEFAULT_CARDS_JSON_PATH = DATA_DIR / "scryfall_default_cards.json"
SETS_JSON_PATH = DATA_DIR / "scryfall_sets.json"
CARDS_JSONL_PATH = DATA_DIR / "cards_min.jsonl"
DRAFT_CARDS_JSONL_PATH = DATA_DIR / "draft_cards.jsonl"
EMBEDDINGS_PATH = DATA_DIR / "card_embeddings.npy"
EMBEDDINGS_META_PATH = DATA_DIR / "card_embeddings_meta.json"
FAISS_INDEX_PATH = DATA_DIR / "card_index.faiss"
PIPELINE_META_PATH = DATA_DIR / "pipeline_meta.json"
FLAVOR_NAMES_JSON_PATH = DATA_DIR / "flavor_names.json"


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
        "power": card.get("power"),
        "toughness": card.get("toughness"),
        "set": card.get("set"),
        "set_name": card.get("set_name"),
        "set_type": card.get("set_type"),
        "released_at": card.get("released_at"),
        "collector_number": card.get("collector_number"),
        "booster": card.get("booster"),
        "digital": card.get("digital", False),
        "games": card.get("games"),
        "image_uris": card.get("image_uris"),
        "card_faces": card.get("card_faces"),
        "reserved": card.get("reserved", False),
    }


def _count_jsonl(path: Path) -> int:
    if not path.exists():
        return 0
    with open(path, "r", encoding="utf-8") as f:
        return sum(1 for line in f if line.strip())


class MTGDataPipeline:
    def __init__(
        self,
        data_dir: Path = DATA_DIR,
        model_name: str = "sentence-transformers/all-MiniLM-L6-v2",
    ) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.model_name = model_name

    def _write_meta(self, **updates: Dict) -> None:
        meta = {}
        if PIPELINE_META_PATH.exists():
            try:
                with open(PIPELINE_META_PATH, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except (json.JSONDecodeError, OSError):
                meta = {}
        meta.update(updates)
        meta["updated_at"] = datetime.now().isoformat()
        with open(PIPELINE_META_PATH, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

    def status(self) -> Dict:
        """Return local pipeline freshness and artifact counts."""
        meta = {}
        if PIPELINE_META_PATH.exists():
            try:
                with open(PIPELINE_META_PATH, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except (json.JSONDecodeError, OSError):
                meta = {}
        artifacts = {
            "oracle_bulk": BULK_JSON_PATH,
            "default_cards": DEFAULT_CARDS_JSON_PATH,
            "sets": SETS_JSON_PATH,
            "cards": CARDS_JSONL_PATH,
            "draft_cards": DRAFT_CARDS_JSONL_PATH,
            "embeddings": EMBEDDINGS_PATH,
            "faiss_index": FAISS_INDEX_PATH,
        }
        return {
            "meta": meta,
            "artifacts": {
                name: {
                    "exists": path.exists(),
                    "modified_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat() if path.exists() else None,
                    "size": path.stat().st_size if path.exists() else 0,
                }
                for name, path in artifacts.items()
            },
            "counts": {
                "cards": _count_jsonl(CARDS_JSONL_PATH),
                "draft_cards": _count_jsonl(DRAFT_CARDS_JSONL_PATH),
            },
        }

    def download_bulk(self, force: bool = False) -> Path:
        if BULK_JSON_PATH.exists() and not force:
            return BULK_JSON_PATH
        path = download_bulk_data(BULK_JSON_PATH)
        self._write_meta(oracle_bulk_downloaded_at=datetime.now().isoformat())
        return path

    def download_default_cards(self, force: bool = False) -> Path:
        if DEFAULT_CARDS_JSON_PATH.exists() and not force:
            return DEFAULT_CARDS_JSON_PATH
        path = download_bulk_data(DEFAULT_CARDS_JSON_PATH, bulk_name="Default Cards")
        self._write_meta(default_cards_downloaded_at=datetime.now().isoformat())
        return path

    def download_sets(self, force: bool = False) -> Path:
        if SETS_JSON_PATH.exists() and not force:
            return SETS_JSON_PATH
        payload = get_sets_data()
        with open(SETS_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(payload.get("data", []), f, indent=2)
        self._write_meta(sets_downloaded_at=datetime.now().isoformat(), set_count=len(payload.get("data", [])))
        return SETS_JSON_PATH

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
            count = 0
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
                count += 1
        self._write_meta(
            cards_extracted_at=datetime.now().isoformat(),
            card_count=count,
            legal_filter=sorted(legal_set),
        )
        return CARDS_JSONL_PATH

    def extract_draft_cards(self, force: bool = False) -> Path:
        """Extract set-printing card data for Limited draft pools."""
        if DRAFT_CARDS_JSONL_PATH.exists() and not force:
            return DRAFT_CARDS_JSONL_PATH
        source_path = self.download_default_cards(force=False)
        with open(DRAFT_CARDS_JSONL_PATH, "w", encoding="utf-8") as f:
            count = 0
            for card in iter_cards_from_bulk(source_path):
                if card.get("lang") != "en":
                    continue
                if card.get("type_line") is None:
                    continue
                minimized = _minimize_card(card)
                f.write(json.dumps(minimized, default=str) + "\n")
                count += 1
        self._write_meta(draft_cards_extracted_at=datetime.now().isoformat(), draft_card_count=count)
        return DRAFT_CARDS_JSONL_PATH

    def extract_flavor_names(self, force: bool = False) -> Path:
        """Map alternate printing names (flavor names) to canonical card names.

        Themed reprints (e.g. FINAL FANTASY: Through the Ages prints Lightning
        Bolt as "Thrum of the Vestige") carry a printing-level flavor_name that
        deck builders export instead of the real name. Flavor names only exist
        in the default-cards bulk (oracle cards are canonical-only), so this
        scans printings and writes a flavor -> canonical name map.
        """
        if FLAVOR_NAMES_JSON_PATH.exists() and not force:
            return FLAVOR_NAMES_JSON_PATH
        source_path = self.download_default_cards(force=False)
        mapping: Dict[str, str] = {}
        for card in iter_cards_from_bulk(source_path):
            if card.get("lang") != "en":
                continue
            name = card.get("name")
            if not name:
                continue
            flavor = card.get("flavor_name")
            if flavor and flavor != name:
                mapping[flavor] = name
            for face in card.get("card_faces") or []:
                face_flavor = face.get("flavor_name")
                if face_flavor and face_flavor != face.get("name"):
                    # Map face flavor names to the full canonical card name so
                    # lookups resolve to a real card_db entry.
                    mapping.setdefault(face_flavor, name)
        with open(FLAVOR_NAMES_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, sort_keys=True)
        self._write_meta(
            flavor_names_extracted_at=datetime.now().isoformat(),
            flavor_name_count=len(mapping),
        )
        return FLAVOR_NAMES_JSON_PATH

    def refresh_prices(self, force: bool = True) -> int:
        """Refresh current Scryfall price fields while preserving card order.

        Embeddings and FAISS indices depend on the order of cards_min.jsonl, so
        this updates only the `prices` object for existing card rows.
        """
        source_path = self.download_bulk(force=force)
        prices_by_id: Dict[str, Dict] = {}
        for card in iter_cards_from_bulk(source_path):
            card_id = card.get("id")
            if card_id:
                prices_by_id[card_id] = card.get("prices") or {}

        if not CARDS_JSONL_PATH.exists():
            self.extract_cards(force=True)
            return _count_jsonl(CARDS_JSONL_PATH)

        tmp_path = CARDS_JSONL_PATH.with_suffix(".jsonl.tmp")
        updated = 0
        with open(CARDS_JSONL_PATH, "r", encoding="utf-8") as src, open(tmp_path, "w", encoding="utf-8") as dst:
            for line in src:
                if not line.strip():
                    continue
                card = json.loads(line)
                card_id = card.get("id")
                if card_id in prices_by_id:
                    card["prices"] = prices_by_id[card_id]
                    if prices_by_id[card_id].get("usd"):
                        updated += 1
                dst.write(json.dumps(card, default=str) + "\n")
        tmp_path.replace(CARDS_JSONL_PATH)
        self._write_meta(prices_refreshed_at=datetime.now().isoformat(), priced_card_count=updated)
        return updated

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
        self._write_meta(
            embeddings_built_at=datetime.now().isoformat(),
            embedding_count=len(ids),
            embedding_model=self.model_name,
        )
        return EMBEDDINGS_PATH

    def build_faiss_index(self, force: bool = False) -> Path:
        if FAISS_INDEX_PATH.exists() and not force:
            return FAISS_INDEX_PATH
        self.build_embeddings(force=False)
        embeddings = np.load(EMBEDDINGS_PATH)
        index = faiss.IndexFlatIP(embeddings.shape[1])
        index.add(embeddings)
        faiss.write_index(index, str(FAISS_INDEX_PATH))
        self._write_meta(faiss_built_at=datetime.now().isoformat(), faiss_size=int(index.ntotal))
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


def _cmd_download_default(args: argparse.Namespace) -> None:
    MTGDataPipeline().download_default_cards(force=args.force)


def _cmd_sets(args: argparse.Namespace) -> None:
    MTGDataPipeline().download_sets(force=args.force)


def _cmd_extract(args: argparse.Namespace) -> None:
    MTGDataPipeline().extract_cards(force=args.force, legal_in=args.legal)


def _cmd_extract_draft(args: argparse.Namespace) -> None:
    MTGDataPipeline().extract_draft_cards(force=args.force)


def _cmd_extract_flavors(args: argparse.Namespace) -> None:
    path = MTGDataPipeline().extract_flavor_names(force=args.force)
    print(f"Flavor name map written to {path}")


def _cmd_embed(args: argparse.Namespace) -> None:
    MTGDataPipeline().build_embeddings(batch_size=args.batch_size, force=args.force)


def _cmd_index(args: argparse.Namespace) -> None:
    MTGDataPipeline().build_faiss_index(force=args.force)


def _cmd_prices(args: argparse.Namespace) -> None:
    updated = MTGDataPipeline().refresh_prices(force=args.force)
    print(f"Updated current Scryfall prices for {updated} cards")


def _cmd_status(args: argparse.Namespace) -> None:
    print(json.dumps(MTGDataPipeline().status(), indent=2))


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

    download_default_p = sub.add_parser("download-default", help="download Scryfall default cards JSON")
    download_default_p.add_argument("--force", action="store_true")
    download_default_p.set_defaults(func=_cmd_download_default)

    sets_p = sub.add_parser("sets", help="download Scryfall set metadata")
    sets_p.add_argument("--force", action="store_true")
    sets_p.set_defaults(func=_cmd_sets)

    extract_p = sub.add_parser("extract", help="extract minimal card data")
    extract_p.add_argument("--force", action="store_true")
    extract_p.add_argument(
        "--legal",
        action="append",
        default=[],
        help="require legal in format (repeatable, e.g. --legal commander --legal standard)",
    )
    extract_p.set_defaults(func=_cmd_extract)

    draft_p = sub.add_parser("extract-draft", help="extract set-printing data for draft pools")
    draft_p.add_argument("--force", action="store_true")
    draft_p.set_defaults(func=_cmd_extract_draft)

    flavors_p = sub.add_parser("extract-flavors", help="extract flavor-name -> canonical-name map")
    flavors_p.add_argument("--force", action="store_true")
    flavors_p.set_defaults(func=_cmd_extract_flavors)

    embed_p = sub.add_parser("embed", help="build embeddings")
    embed_p.add_argument("--force", action="store_true")
    embed_p.add_argument("--batch-size", type=int, default=256)
    embed_p.set_defaults(func=_cmd_embed)

    index_p = sub.add_parser("index", help="build FAISS index")
    index_p.add_argument("--force", action="store_true")
    index_p.set_defaults(func=_cmd_index)

    prices_p = sub.add_parser("prices", help="refresh current price fields without rebuilding embeddings")
    prices_p.add_argument("--force", action="store_true")
    prices_p.set_defaults(func=_cmd_prices)

    status_p = sub.add_parser("status", help="show local data pipeline status")
    status_p.set_defaults(func=_cmd_status)

    search_p = sub.add_parser("search", help="semantic search")
    search_p.add_argument("query")
    search_p.add_argument("-k", type=int, default=10)
    search_p.set_defaults(func=_cmd_search)

    if len(sys.argv) > 1 and sys.argv[1] == "draft":
        force = "--force" in sys.argv
        steps = [
            ("Downloading Scryfall set metadata", _cmd_sets),
            ("Downloading Scryfall default cards", _cmd_download_default),
            ("Extracting draft card printings", _cmd_extract_draft),
        ]
        for i, (label, func) in enumerate(steps, 1):
            print(f"\n[{i}/{len(steps)}] {label}...")
            func(argparse.Namespace(force=force))
            print(f"[{i}/{len(steps)}] {label} - done!")
        print("\nDraft data refresh complete!")
        return

    # Support "all" shortcut to run full pipeline
    if len(sys.argv) > 1 and sys.argv[1] == "all":
        force = "--force" in sys.argv
        steps = [
            ("Downloading Scryfall bulk data", _cmd_download),
            ("Downloading Scryfall set metadata", _cmd_sets),
            ("Downloading Scryfall default cards", _cmd_download_default),
            ("Extracting deck-generator cards", _cmd_extract),
            ("Extracting draft card printings", _cmd_extract_draft),
            ("Building embeddings", _cmd_embed),
            ("Building FAISS index", _cmd_index),
        ]
        for i, (label, func) in enumerate(steps, 1):
            print(f"\n[{i}/{len(steps)}] {label}...")
            func(argparse.Namespace(force=force, legal=[], batch_size=256))
            print(f"[{i}/{len(steps)}] {label} - done!")
        print("\nPipeline complete!")
        return

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
