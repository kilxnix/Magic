#!/usr/bin/env python3
"""Daily update job for MTG card data, prices, and images.

Runs at 3 AM daily via cron:
    0 3 * * * sheltron cd /home/sheltron/Documents/Magic && ./venv/bin/python backend/daily_update.py

Steps:
1. Fetch new cards from Scryfall bulk data
2. Update prices from Scryfall API
3. Regenerate embeddings for new cards
4. Rebuild FAISS index
5. Download images for new cards
6. Generate functional tags

Usage:
    python backend/daily_update.py              # Run full update
    python backend/daily_update.py --cards      # Cards + embeddings only
    python backend/daily_update.py --prices     # Prices only
    python backend/daily_update.py --images     # Images only
    python backend/daily_update.py --dry-run    # Check what would be updated
"""

import argparse
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Set

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from data.data_pipeline import MTGDataPipeline, CARDS_JSONL_PATH, BULK_JSON_PATH

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('data/update.log'),
    ]
)
logger = logging.getLogger(__name__)


class DailyUpdater:
    """Orchestrates daily updates for MTG data."""

    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.pipeline = MTGDataPipeline()
        self.stats = {
            'new_cards': 0,
            'updated_prices': 0,
            'new_images': 0,
            'errors': [],
            'start_time': datetime.now().isoformat(),
        }

    def _load_existing_card_ids(self) -> Set[str]:
        """Load IDs of existing cards."""
        if not CARDS_JSONL_PATH.exists():
            return set()

        ids = set()
        with open(CARDS_JSONL_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                card = json.loads(line)
                ids.add(card['id'])
        return ids

    def update_cards(self) -> int:
        """
        Fetch new cards from Scryfall and update the database.

        Returns the number of new cards found.
        """
        logger.info("Checking for new cards from Scryfall...")

        # Get existing card IDs
        existing_ids = self._load_existing_card_ids()
        logger.info(f"Found {len(existing_ids)} existing cards")

        if self.dry_run:
            logger.info("[DRY RUN] Would download fresh Scryfall data")
            return 0

        # Download fresh bulk data
        try:
            self.pipeline.download_bulk(force=True)
        except Exception as e:
            logger.error(f"Failed to download Scryfall bulk data: {e}")
            self.stats['errors'].append(f"Scryfall download: {e}")
            return 0

        # Extract cards (this will rebuild cards_min.jsonl)
        try:
            self.pipeline.extract_cards(force=True, legal_in=['commander'])
        except Exception as e:
            logger.error(f"Failed to extract cards: {e}")
            self.stats['errors'].append(f"Card extraction: {e}")
            return 0

        # Count new cards
        new_ids = self._load_existing_card_ids()
        new_count = len(new_ids - existing_ids)
        self.stats['new_cards'] = new_count

        if new_count > 0:
            logger.info(f"Found {new_count} new cards")
        else:
            logger.info("No new cards found")

        return new_count

    def update_embeddings(self) -> bool:
        """Regenerate embeddings and FAISS index."""
        logger.info("Rebuilding embeddings and FAISS index...")

        if self.dry_run:
            logger.info("[DRY RUN] Would rebuild embeddings")
            return True

        try:
            self.pipeline.build_embeddings(force=True)
            self.pipeline.build_faiss_index(force=True)
            logger.info("Embeddings and index rebuilt successfully")
            return True
        except Exception as e:
            logger.error(f"Failed to rebuild embeddings: {e}")
            self.stats['errors'].append(f"Embeddings: {e}")
            return False

    def update_prices(self) -> int:
        """
        Update prices for cards from Scryfall.

        Uses the already-downloaded bulk data which includes prices.
        """
        logger.info("Updating card prices...")

        if self.dry_run:
            logger.info("[DRY RUN] Would update prices")
            return 0

        if not CARDS_JSONL_PATH.exists():
            logger.error("No cards file found - run update_cards first")
            return 0

        # Prices are already included in Scryfall bulk data
        # The extract_cards step pulls them automatically
        # Here we just count cards with prices

        updated = 0
        with open(CARDS_JSONL_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                card = json.loads(line)
                prices = card.get('prices', {})
                if prices and prices.get('usd'):
                    updated += 1

        self.stats['updated_prices'] = updated
        logger.info(f"Updated prices for {updated} cards")

        # Also refresh the price cache
        try:
            from backend.price_service import SCRYFALL_CACHE_PATH
            if SCRYFALL_CACHE_PATH.exists():
                SCRYFALL_CACHE_PATH.unlink()
                logger.info("Cleared Scryfall price cache")
        except Exception as e:
            logger.warning(f"Failed to clear price cache: {e}")

        return updated

    def update_images(self, limit: Optional[int] = None) -> int:
        """
        Download images for cards that don't have cached images.

        Args:
            limit: Maximum number of images to download (None = all)
        """
        logger.info("Checking for missing card images...")

        if self.dry_run:
            logger.info("[DRY RUN] Would download missing images")
            return 0

        try:
            from backend.database import init_images_db, has_card_image, save_card_image
            import requests
        except ImportError as e:
            logger.error(f"Failed to import image modules: {e}")
            return 0

        init_images_db()

        # Load cards and find those without images
        missing = []
        with open(CARDS_JSONL_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                card = json.loads(line)
                name = card.get('name')
                if not name:
                    continue

                # Check if we have this image
                if not has_card_image(name, None, 'normal'):
                    image_uri = None
                    if 'image_uris' in card:
                        image_uri = card['image_uris'].get('normal')
                    elif 'card_faces' in card and len(card['card_faces']) > 0:
                        face = card['card_faces'][0]
                        if 'image_uris' in face:
                            image_uri = face['image_uris'].get('normal')

                    if image_uri:
                        missing.append((name, card.get('set', ''), image_uri))

        logger.info(f"Found {len(missing)} cards without cached images")

        if not missing:
            return 0

        if limit:
            missing = missing[:limit]
            logger.info(f"Limiting to {limit} images")

        # Download images with rate limiting
        downloaded = 0
        for name, set_code, url in missing:
            try:
                # Rate limit: 100ms between requests
                time.sleep(0.1)

                response = requests.get(url, timeout=30)
                response.raise_for_status()

                content_type = response.headers.get('Content-Type', 'image/jpeg')
                save_card_image(name, set_code, 'normal', response.content, content_type)
                downloaded += 1

                if downloaded % 100 == 0:
                    logger.info(f"Downloaded {downloaded}/{len(missing)} images")

            except Exception as e:
                logger.warning(f"Failed to download image for {name}: {e}")
                continue

        self.stats['new_images'] = downloaded
        logger.info(f"Downloaded {downloaded} new images")

        return downloaded

    def update_functional_tags(self) -> int:
        """
        Generate functional tags for all cards.

        Tags are generated on-the-fly when needed, but we can pre-compute
        them and store in a cache for faster lookups.
        """
        logger.info("Generating functional tags...")

        if self.dry_run:
            logger.info("[DRY RUN] Would generate functional tags")
            return 0

        try:
            from backend.functional_tags import detect_tags
        except ImportError as e:
            logger.error(f"Failed to import functional_tags: {e}")
            return 0

        # Load all cards and compute tags
        tags_cache = {}
        with open(CARDS_JSONL_PATH, 'r', encoding='utf-8') as f:
            for line in f:
                card = json.loads(line)
                name = card.get('name')
                if not name:
                    continue

                text = card.get('oracle_text', '')
                type_line = card.get('type_line', '')
                keywords = card.get('keywords', [])

                tags = detect_tags(text, type_line, keywords)
                if tags:
                    tags_cache[name] = list(tags)

        # Save tags cache
        cache_path = Path('data/functional_tags_cache.json')
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cache_path, 'w', encoding='utf-8') as f:
            json.dump(tags_cache, f)

        logger.info(f"Generated tags for {len(tags_cache)} cards")
        return len(tags_cache)

    def run_full_update(self) -> Dict:
        """Run all update steps."""
        logger.info("=" * 50)
        logger.info("Starting daily update...")
        logger.info("=" * 50)

        # Step 1: Update cards
        new_cards = self.update_cards()

        # Step 2: Rebuild embeddings if there are new cards
        if new_cards > 0 or not Path('mtg_data/card_embeddings.npy').exists():
            self.update_embeddings()

        # Step 3: Update prices (included in bulk data)
        self.update_prices()

        # Step 4: Download new images (limit to 500 per run to avoid long runtime)
        self.update_images(limit=500)

        # Step 5: Generate functional tags
        self.update_functional_tags()

        # Summary
        self.stats['end_time'] = datetime.now().isoformat()
        logger.info("=" * 50)
        logger.info("Update complete!")
        logger.info(f"New cards: {self.stats['new_cards']}")
        logger.info(f"Cards with prices: {self.stats['updated_prices']}")
        logger.info(f"New images: {self.stats['new_images']}")
        if self.stats['errors']:
            logger.warning(f"Errors: {len(self.stats['errors'])}")
            for err in self.stats['errors']:
                logger.warning(f"  - {err}")
        logger.info("=" * 50)

        return self.stats


def main():
    parser = argparse.ArgumentParser(description="Daily update for MTG card data")
    parser.add_argument('--dry-run', action='store_true', help="Check what would be updated")
    parser.add_argument('--cards', action='store_true', help="Update cards and embeddings only")
    parser.add_argument('--prices', action='store_true', help="Update prices only")
    parser.add_argument('--images', action='store_true', help="Download new images only")
    parser.add_argument('--image-limit', type=int, default=500, help="Max images to download")

    args = parser.parse_args()

    updater = DailyUpdater(dry_run=args.dry_run)

    # Run specific steps or full update
    if args.cards:
        new_cards = updater.update_cards()
        if new_cards > 0:
            updater.update_embeddings()
    elif args.prices:
        updater.update_prices()
    elif args.images:
        updater.update_images(limit=args.image_limit)
    else:
        # Full update
        stats = updater.run_full_update()

        # Write stats to file for monitoring
        stats_path = Path('data/last_update_stats.json')
        with open(stats_path, 'w') as f:
            json.dump(stats, f, indent=2)


if __name__ == "__main__":
    main()
