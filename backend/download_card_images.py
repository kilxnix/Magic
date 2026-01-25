#!/usr/bin/env python3
"""
Download all Commander-legal card images from Scryfall.

This script downloads both normal (488x680) and small (146x204) versions
of every Commander-legal card and stores them in SQLite.

Usage:
    python download_card_images.py [--resume] [--small-only] [--normal-only]

Estimated time: ~2-3 hours for ~25,000 cards (respecting 100ms rate limit)
Estimated storage: ~3GB total (2.5GB normal + 400MB small)
"""

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import requests

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.database import (
    init_images_db,
    save_card_image,
    has_card_image,
    update_download_progress,
    get_image_stats,
)

# Scryfall API settings
SCRYFALL_BULK_API = "https://api.scryfall.com/bulk-data"
RATE_LIMIT_MS = 100  # Scryfall requires 100ms between requests
REQUEST_TIMEOUT = 30

# Image versions to download
IMAGE_SIZES = {
    'normal': 'normal',  # 488x680
    'small': 'small',    # 146x204
}


def get_bulk_data_url() -> str:
    """Get the URL for the Oracle Cards bulk data."""
    print("Fetching bulk data manifest...")
    response = requests.get(SCRYFALL_BULK_API, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()

    data = response.json()
    for item in data['data']:
        if item['type'] == 'oracle_cards':
            print(f"Found Oracle Cards data, updated: {item['updated_at']}")
            return item['download_uri']

    raise ValueError("Could not find Oracle Cards bulk data")


def download_bulk_data(url: str) -> list[dict]:
    """Download and parse the bulk card data."""
    print(f"Downloading bulk card data from {url}...")
    response = requests.get(url, timeout=120, stream=True)
    response.raise_for_status()

    # Parse JSON
    cards = response.json()
    print(f"Downloaded {len(cards)} total cards")
    return cards


def filter_commander_legal(cards: list[dict]) -> list[dict]:
    """Filter cards to only Commander-legal ones."""
    commander_cards = []

    for card in cards:
        # Check if legal in Commander
        legalities = card.get('legalities', {})
        if legalities.get('commander') not in ('legal', 'restricted'):
            continue

        # Skip tokens, emblems, etc.
        layout = card.get('layout', '')
        if layout in ('token', 'emblem', 'art_series', 'double_faced_token'):
            continue

        # Must have image URIs
        if not card.get('image_uris') and not card.get('card_faces'):
            continue

        commander_cards.append(card)

    print(f"Found {len(commander_cards)} Commander-legal cards")
    return commander_cards


def get_image_uri(card: dict, size: str) -> Optional[str]:
    """Get the image URI for a card at the specified size."""
    # Regular cards
    if card.get('image_uris'):
        return card['image_uris'].get(size)

    # Double-faced cards - get front face
    if card.get('card_faces') and len(card['card_faces']) > 0:
        face = card['card_faces'][0]
        if face.get('image_uris'):
            return face['image_uris'].get(size)

    return None


def download_image(url: str) -> Optional[bytes]:
    """Download an image from a URL."""
    try:
        response = requests.get(url, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()
        return response.content
    except requests.RequestException as e:
        print(f"  Error downloading: {e}")
        return None


def process_card(card: dict, sizes: list[str], skip_existing: bool = True) -> int:
    """
    Process a single card, downloading requested image sizes.
    Returns the number of images downloaded.
    """
    card_name = card['name']
    set_code = card.get('set', 'unknown')
    downloaded = 0

    for size in sizes:
        # Check if already exists
        if skip_existing and has_card_image(card_name, set_code, size):
            continue

        # Get image URL
        image_url = get_image_uri(card, size)
        if not image_url:
            continue

        # Download image
        image_data = download_image(image_url)
        if image_data:
            # Determine content type
            content_type = 'image/jpeg'
            if image_url.endswith('.png'):
                content_type = 'image/png'

            # Save to database
            save_card_image(card_name, set_code, size, image_data, content_type)
            downloaded += 1

        # Rate limit
        time.sleep(RATE_LIMIT_MS / 1000)

    return downloaded


def main():
    parser = argparse.ArgumentParser(description='Download Commander card images from Scryfall')
    parser.add_argument('--resume', action='store_true', help='Skip cards already downloaded')
    parser.add_argument('--small-only', action='store_true', help='Only download small images')
    parser.add_argument('--normal-only', action='store_true', help='Only download normal images')
    parser.add_argument('--limit', type=int, help='Limit number of cards to process')
    parser.add_argument('--stats', action='store_true', help='Show download stats and exit')
    args = parser.parse_args()

    # Initialize database
    init_images_db()

    # Show stats if requested
    if args.stats:
        stats = get_image_stats()
        print(f"\nImage Database Statistics:")
        print(f"  Total images: {stats['total_images']}")
        print(f"  Unique cards: {stats['unique_cards']}")
        print(f"  Normal size: {stats['normal_images']}")
        print(f"  Small size: {stats['small_images']}")
        if stats['download_progress']:
            prog = stats['download_progress']
            pct = (prog['downloaded_cards'] / prog['total_cards'] * 100) if prog['total_cards'] > 0 else 0
            print(f"\nDownload Progress:")
            print(f"  {prog['downloaded_cards']} / {prog['total_cards']} ({pct:.1f}%)")
            print(f"  Last card: {prog['last_card']}")
            print(f"  Started: {prog['started_at']}")
        return

    # Determine which sizes to download
    sizes = []
    if args.small_only:
        sizes = ['small']
    elif args.normal_only:
        sizes = ['normal']
    else:
        sizes = ['normal', 'small']

    print(f"Downloading image sizes: {sizes}")
    print(f"Resume mode: {args.resume}")

    # Get bulk data
    bulk_url = get_bulk_data_url()
    time.sleep(RATE_LIMIT_MS / 1000)

    cards = download_bulk_data(bulk_url)
    cards = filter_commander_legal(cards)

    # Apply limit if specified
    if args.limit:
        cards = cards[:args.limit]
        print(f"Limited to {args.limit} cards")

    # Download images
    total_cards = len(cards)
    total_downloaded = 0
    start_time = datetime.now()

    print(f"\nStarting download of {total_cards} cards...")
    print(f"Estimated time: {total_cards * len(sizes) * RATE_LIMIT_MS / 1000 / 60:.0f} minutes")
    print("-" * 60)

    for i, card in enumerate(cards):
        card_name = card['name']

        # Progress update every 100 cards
        if i % 100 == 0:
            elapsed = (datetime.now() - start_time).total_seconds()
            rate = i / elapsed if elapsed > 0 else 0
            remaining = (total_cards - i) / rate / 60 if rate > 0 else 0
            print(f"[{i}/{total_cards}] {i/total_cards*100:.1f}% - {rate:.1f} cards/sec - ~{remaining:.0f} min remaining")
            update_download_progress(total_cards, i, card_name)

        # Process card
        downloaded = process_card(card, sizes, skip_existing=args.resume)
        total_downloaded += downloaded

        if downloaded > 0:
            print(f"  Downloaded {downloaded} image(s) for: {card_name}")

    # Final stats
    elapsed = (datetime.now() - start_time).total_seconds()
    print("-" * 60)
    print(f"Download complete!")
    print(f"  Total time: {elapsed/60:.1f} minutes")
    print(f"  Cards processed: {total_cards}")
    print(f"  Images downloaded: {total_downloaded}")

    # Update progress
    update_download_progress(total_cards, total_cards, "COMPLETE")

    # Show final stats
    stats = get_image_stats()
    print(f"\nFinal Statistics:")
    print(f"  Total images in DB: {stats['total_images']}")
    print(f"  Unique cards: {stats['unique_cards']}")


if __name__ == '__main__':
    main()
