from __future__ import annotations

import gzip
import json
import time
from pathlib import Path
from typing import Dict, Iterator, Optional

import requests

BULK_DATA_URL = "https://api.scryfall.com/bulk-data"
DEFAULT_BULK_NAME = "Oracle Cards"


def _request_json(url: str, retries: int = 5, backoff_s: float = 0.5) -> Dict:
    for attempt in range(retries):
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(backoff_s * (2 ** attempt))
    raise RuntimeError("unreachable")


def get_bulk_data_url(bulk_name: str = DEFAULT_BULK_NAME) -> str:
    payload = _request_json(BULK_DATA_URL)
    for item in payload.get("data", []):
        if item.get("name") == bulk_name:
            return item["download_uri"]
    raise ValueError(f"bulk data name not found: {bulk_name}")


def download_bulk_data(dest_path: Path, bulk_name: str = DEFAULT_BULK_NAME) -> Path:
    dest_path.parent.mkdir(parents=True, exist_ok=True)
    url = get_bulk_data_url(bulk_name)
    with requests.get(url, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        with open(dest_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
    return dest_path


def _open_json(path: Path):
    if path.suffix == ".gz":
        return gzip.open(path, "rt", encoding="utf-8")
    return open(path, "r", encoding="utf-8")


def iter_cards_from_bulk(path: Path) -> Iterator[Dict]:
    try:
        import ijson  # type: ignore
    except Exception:
        ijson = None

    with _open_json(path) as f:
        if ijson is None:
            data = json.load(f)
            for card in data:
                yield card
        else:
            for card in ijson.items(f, "item"):
                yield card
