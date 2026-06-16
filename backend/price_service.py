"""Service for fetching card prices from multiple sources.

Supports:
- Scryfall API for individual card lookups (fast, practical)
- MTGJson for bulk price data (optional, for offline use)
"""

import json
import time
import logging
import requests
from typing import Dict, Optional
from pathlib import Path
from datetime import datetime
from urllib.parse import quote_plus

logger = logging.getLogger(__name__)

# API URLs
SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named"
MTGJSON_PRICES_URL = "https://mtgjson.com/api/v5/AllPrices.json"

# Scryfall now rejects requests that use the default ``python-requests`` (or an
# empty) User-Agent with HTTP 400. Their API policy requires clients to send a
# descriptive User-Agent and an Accept header, so set both on every request.
# See https://scryfall.com/docs/api (Rate Limits & Good Citizenship).
SCRYFALL_HEADERS = {
    "User-Agent": "MagicBrains/1.0 (+https://deckreps.app)",
    "Accept": "application/json;q=0.9,*/*;q=0.8",
}

# Cache paths
PRICE_CACHE_PATH = Path(__file__).parent.parent / "data" / "price_cache.json"
SCRYFALL_CACHE_PATH = Path(__file__).parent.parent / "data" / "scryfall_price_cache.json"

# Module-level caches
_mtgjson_cache: Optional[Dict] = None
_mtgjson_cache_timestamp: Optional[datetime] = None
_scryfall_cache: Dict[str, Dict] = {}
_scryfall_cache_timestamp: Optional[datetime] = None


def fetch_mtgjson_prices(force_refresh: bool = False) -> Dict:
    """
    Fetch all card prices from MTGJson.
    Caches results to avoid repeated downloads.

    Warning: The AllPrices.json file is ~1.4GB. Consider using
    fetch_card_prices_scryfall() for individual lookups instead.
    """
    global _mtgjson_cache, _mtgjson_cache_timestamp

    # Return cached if available and fresh (< 1 hour)
    if not force_refresh and _mtgjson_cache is not None:
        if _mtgjson_cache_timestamp and (datetime.now() - _mtgjson_cache_timestamp).seconds < 3600:
            return _mtgjson_cache

    # Try loading from disk cache first
    if not force_refresh and PRICE_CACHE_PATH.exists():
        try:
            with open(PRICE_CACHE_PATH, 'r') as f:
                cached = json.load(f)
                if cached.get('timestamp'):
                    cache_time = datetime.fromisoformat(cached['timestamp'])
                    # Use disk cache if less than 24 hours old
                    if (datetime.now() - cache_time).days < 1:
                        _mtgjson_cache = cached.get('data', {})
                        _mtgjson_cache_timestamp = cache_time
                        return _mtgjson_cache
        except (json.JSONDecodeError, KeyError):
            pass

    # Fetch from MTGJson (large file, may take several minutes)
    print("Fetching prices from MTGJson (this may take several minutes, file is ~1.4GB)...")
    response = requests.get(MTGJSON_PRICES_URL, timeout=600, stream=True)
    response.raise_for_status()

    data = response.json()
    _mtgjson_cache = data.get('data', {})
    _mtgjson_cache_timestamp = datetime.now()

    # Save to disk cache
    PRICE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(PRICE_CACHE_PATH, 'w') as f:
        json.dump({
            'timestamp': _mtgjson_cache_timestamp.isoformat(),
            'data': _mtgjson_cache
        }, f)

    return _mtgjson_cache


def fetch_card_prices_scryfall(card_name: str, force_refresh: bool = False) -> Dict:
    """
    Fetch prices for a single card from Scryfall API.

    This is much faster than MTGJson for individual lookups.
    Scryfall requires 100ms delay between requests.

    Returns raw Scryfall price data:
        {"usd": "1.29", "usd_foil": null, "eur": "1.70", ...}
    """
    global _scryfall_cache, _scryfall_cache_timestamp

    cache_key = card_name.lower().strip()

    # Check memory cache (valid for 1 hour)
    if not force_refresh and cache_key in _scryfall_cache:
        entry = _scryfall_cache[cache_key]
        if entry.get('timestamp'):
            cache_time = datetime.fromisoformat(entry['timestamp'])
            if (datetime.now() - cache_time).seconds < 3600:
                return entry.get('prices', {})

    # Load disk cache if not loaded
    if not _scryfall_cache and SCRYFALL_CACHE_PATH.exists():
        try:
            with open(SCRYFALL_CACHE_PATH, 'r') as f:
                _scryfall_cache = json.load(f)
        except (json.JSONDecodeError, IOError):
            _scryfall_cache = {}

    # Check disk cache
    if not force_refresh and cache_key in _scryfall_cache:
        entry = _scryfall_cache[cache_key]
        if entry.get('timestamp'):
            cache_time = datetime.fromisoformat(entry['timestamp'])
            if (datetime.now() - cache_time).days < 1:
                return entry.get('prices', {})

    # Fetch from Scryfall
    try:
        # Scryfall rate limit: 100ms between requests
        time.sleep(0.1)

        response = requests.get(
            SCRYFALL_NAMED_URL,
            params={"fuzzy": card_name},
            headers=SCRYFALL_HEADERS,
            timeout=30
        )
        response.raise_for_status()

        data = response.json()
        prices = data.get('prices', {})

        # Cache the result
        _scryfall_cache[cache_key] = {
            'timestamp': datetime.now().isoformat(),
            'prices': prices,
            'name': data.get('name'),
            'scryfall_uri': data.get('scryfall_uri')
        }

        # Save to disk periodically
        _save_scryfall_cache()

        return prices

    except requests.exceptions.HTTPError as e:
        status = getattr(e.response, "status_code", None)
        if status == 404:
            # Card not found
            return {}
        # Any other HTTP error (e.g. Scryfall 400/403/429) must not take down the
        # whole alternatives feature. Degrade gracefully to "no price data".
        logger.warning("Scryfall price lookup failed for %r: HTTP %s", card_name, status)
        return {}
    except requests.exceptions.RequestException as e:
        # Network/timeout errors are transient; degrade gracefully.
        logger.warning("Scryfall price lookup error for %r: %s", card_name, e)
        return {}


def _save_scryfall_cache() -> None:
    """Save Scryfall cache to disk."""
    SCRYFALL_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(SCRYFALL_CACHE_PATH, 'w') as f:
            json.dump(_scryfall_cache, f)
    except IOError:
        pass


def get_card_prices(card_name: str, card_uuid: Optional[str] = None) -> Dict:
    """
    Get prices for a specific card from multiple vendors.

    Uses Scryfall API for fast individual lookups. For bulk operations,
    use fetch_mtgjson_prices() to get all prices at once.

    Returns:
        {
            "tcgplayer": {"usd": 2.50, "url": "https://..."},
            "cardkingdom": {"usd": 2.99, "url": "https://..."},
            "cardmarket": {"eur": 1.80, "url": "https://..."}
        }
    """
    result = {
        "tcgplayer": {"usd": None, "url": None},
        "cardkingdom": {"usd": None, "url": None},
        "cardmarket": {"eur": None, "url": None}
    }

    # Use Scryfall for individual lookups (fast and practical)
    scryfall_prices = fetch_card_prices_scryfall(card_name)

    if scryfall_prices:
        encoded_name = quote_plus(card_name)

        # TCGPlayer price from Scryfall
        usd_price = scryfall_prices.get('usd')
        if usd_price:
            result['tcgplayer']['usd'] = float(usd_price)
            result['tcgplayer']['url'] = f"https://www.tcgplayer.com/search/magic/product?q={encoded_name}"

        # Card Kingdom (Scryfall USD is typically TCGPlayer market price)
        # Card Kingdom prices are usually similar, use same as estimate
        if usd_price:
            result['cardkingdom']['usd'] = float(usd_price)
            result['cardkingdom']['url'] = f"https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D={encoded_name}"

        # Cardmarket EUR price
        eur_price = scryfall_prices.get('eur')
        if eur_price:
            result['cardmarket']['eur'] = float(eur_price)
            result['cardmarket']['url'] = f"https://www.cardmarket.com/en/Magic/Products/Search?searchString={encoded_name}"

    return result


def get_cheapest_price(card_name: str, card_uuid: Optional[str] = None) -> Optional[float]:
    """Get the cheapest USD price across all vendors."""
    prices = get_card_prices(card_name, card_uuid)

    usd_prices = []
    if prices['tcgplayer']['usd']:
        usd_prices.append(prices['tcgplayer']['usd'])
    if prices['cardkingdom']['usd']:
        usd_prices.append(prices['cardkingdom']['usd'])
    if prices['cardmarket']['eur']:
        # Rough EUR to USD conversion
        usd_prices.append(prices['cardmarket']['eur'] * 1.1)

    return min(usd_prices) if usd_prices else None


def get_price_category(price_usd: Optional[float]) -> str:
    """
    Categorize a price according to project conventions.

    Categories (from CLAUDE.md):
    - Budget: < $1
    - Affordable: $1-5
    - Moderate: $5-20
    - Premium: $20-50
    - High-End: > $50
    """
    if price_usd is None:
        return "Unknown"

    if price_usd < 1:
        return "Budget"
    elif price_usd < 5:
        return "Affordable"
    elif price_usd < 20:
        return "Moderate"
    elif price_usd < 50:
        return "Premium"
    else:
        return "High-End"
