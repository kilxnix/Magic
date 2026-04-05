#!/usr/bin/env python3
"""End-to-end test: composer generates a deck, scorer rates cards, all against real card DB.

Run:  python -m backend.test_e2e_models  (from the Magic/ directory)
"""

import json
import sys
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def load_card_db():
    """Load the real card database, or build a small test DB from Scryfall."""
    cards_path = PROJECT_ROOT / "mtg_data" / "cards_min.jsonl"
    if cards_path.exists():
        db = {}
        with open(cards_path, "r", encoding="utf-8") as f:
            for line in f:
                card = json.loads(line)
                db[card["name"]] = card
        print(f"  Loaded {len(db)} cards from database")
        return db

    # No card DB yet — build a small one from Scryfall for testing
    print("  Card database not found — fetching test cards from Scryfall...")
    import requests

    test_card_names = [
        # Commander
        "Atraxa, Praetors' Voice",
        # High-fit (counters/proliferate)
        "Hardened Scales", "Doubling Season", "Evolution Sage",
        "Winding Constrictor", "Deepglow Skate", "Vorinclex, Monstrous Raider",
        "Branching Evolution", "Kalonian Hydra", "Ozolith, the Shattered Spire",
        "Roalesk, Apex Hybrid", "Fertilid", "Grateful Apparition",
        "Flux Channeler", "Karn's Bastion", "Contentious Plan",
        "Inexorable Tide", "Contagion Clasp", "Contagion Engine",
        "Experimental Augmenter", "Pollenbright Druid",
        # Staples
        "Sol Ring", "Arcane Signet", "Command Tower", "Swords to Plowshares",
        "Rhystic Study", "Cultivate", "Kodama's Reach", "Beast Within",
        "Counterspell", "Path to Exile", "Sylvan Library", "Birds of Paradise",
        "Farseek", "Nature's Lore", "Three Visits", "Rampant Growth",
        "Llanowar Elves", "Elvish Mystic", "Fyndhorn Elves",
        # Removal/interaction
        "Anguished Unmaking", "Vindicate", "Generous Gift", "Despark",
        "Assassin's Trophy", "Abrupt Decay", "Heroic Intervention",
        # Lands
        "Breeding Pool", "Hallowed Fountain", "Watery Grave", "Temple Garden",
        "Overgrown Tomb", "Godless Shrine", "Zagoth Triome", "Indatha Triome",
        "Exotic Orchard", "Mana Confluence", "City of Brass",
        "Forest", "Island", "Plains", "Swamp",
        # Low-fit (red, wrong strategy)
        "Goblin Guide", "Lightning Bolt", "Monastery Swiftspear",
    ]

    db = {}
    time.sleep(0.1)
    for name in test_card_names:
        try:
            resp = requests.get(
                "https://api.scryfall.com/cards/named",
                params={"exact": name},
                timeout=10,
            )
            if resp.status_code == 200:
                data = resp.json()
                db[data["name"]] = {
                    "name": data["name"],
                    "type_line": data.get("type_line", ""),
                    "oracle_text": data.get("oracle_text", ""),
                    "mana_cost": data.get("mana_cost", ""),
                    "cmc": data.get("cmc", 0),
                    "colors": data.get("colors", []),
                    "color_identity": data.get("color_identity", []),
                    "keywords": data.get("keywords", []),
                    "rarity": data.get("rarity", ""),
                }
            time.sleep(0.1)  # Scryfall rate limit
        except Exception as e:
            print(f"    Skipping {name}: {e}")

    print(f"  Built test DB with {len(db)} cards from Scryfall")
    return db


def test_composer(card_db):
    """Test full deck composition pipeline."""
    from backend.model_composer import get_composer

    print("\n" + "=" * 60)
    print("TEST 1: COMPOSER — Full Deck Generation")
    print("=" * 60)

    composer = get_composer()

    commander = "Atraxa, Praetors' Voice"
    colors = ["W", "U", "B", "G"]
    bracket = 3
    theme = "+1/+1 counters and proliferate"

    print(f"  Commander: {commander}")
    print(f"  Colors:    {''.join(colors)}")
    print(f"  Bracket:   {bracket}")
    print(f"  Theme:     {theme}")
    print(f"  Generating deck...")

    start = time.time()
    cards, lands = composer.compose_deck(
        commander_name=commander,
        colors=colors,
        bracket=bracket,
        theme=theme,
        card_db=card_db,
    )
    elapsed = time.time() - start

    total = len(cards) + len(lands)
    print(f"\n  Results ({elapsed:.1f}s):")
    print(f"    Non-land cards: {len(cards)}")
    print(f"    Lands:          {len(lands)}")
    print(f"    Total:          {total} / 99")

    if cards:
        print(f"\n  Sample non-land cards (first 15):")
        for c in cards[:15]:
            card_data = card_db.get(c, {})
            cmc = card_data.get("cmc", "?")
            print(f"    - {c}  (CMC {cmc})")

    if lands:
        print(f"\n  Sample lands (first 10):")
        for l in lands[:10]:
            print(f"    - {l}")

    # Validate
    dupes = len(cards) + len(lands) - len(set(cards + lands))
    color_violations = []
    identity_set = set(colors)
    for name in cards:
        card_data = card_db.get(name, {})
        ci = set(card_data.get("color_identity", []))
        if not ci.issubset(identity_set):
            color_violations.append((name, ci))

    print(f"\n  Validation:")
    print(f"    Duplicates:        {dupes}")
    print(f"    Color violations:  {len(color_violations)}")
    if total >= 90:
        print(f"    PASS: {total} cards (>= 90 threshold for model-based generation)")
    elif total >= 50:
        print(f"    PARTIAL: {total} cards (would need FAISS backfill for remaining {99 - total})")
    else:
        print(f"    WARN: Only {total} cards — model may need more training or models may be swapped")

    return cards, lands


def test_scorer(card_db, composer_cards):
    """Test scorer on cards from the composed deck."""
    from backend.model_scorers import get_qwen35_scorer

    print("\n" + "=" * 60)
    print("TEST 2: SCORER — Rate Cards for Commander Fit")
    print("=" * 60)

    scorer = get_qwen35_scorer()

    commander = "Atraxa, Praetors' Voice"
    commander_data = card_db.get(commander, {})
    commander_text = commander_data.get("oracle_text", "Flying, vigilance, deathtouch, lifelink. At the beginning of your end step, proliferate.")

    # Test cards: some that should score high, some low
    test_cards = []

    # High-fit cards (proliferate/counters synergy)
    high_fit = ["Hardened Scales", "Doubling Season", "Evolution Sage",
                "Winding Constrictor", "Deepglow Skate"]
    for name in high_fit:
        if name in card_db:
            test_cards.append((name, "high"))

    # Medium-fit (generally good but not synergistic)
    med_fit = ["Sol Ring", "Swords to Plowshares", "Rhystic Study"]
    for name in med_fit:
        if name in card_db:
            test_cards.append((name, "medium"))

    # Low-fit (wrong strategy)
    low_fit = ["Goblin Guide", "Lightning Bolt", "Monastery Swiftspear"]
    for name in low_fit:
        if name in card_db:
            test_cards.append((name, "low"))

    # Also score a few cards from the composer output
    if composer_cards:
        for name in composer_cards[:3]:
            if name in card_db and name not in [t[0] for t in test_cards]:
                test_cards.append((name, "from-composer"))

    print(f"  Scoring {len(test_cards)} cards against {commander}...\n")

    results = []
    for name, expected in test_cards:
        card_data = card_db[name]
        oracle = card_data.get("oracle_text", "")
        start = time.time()
        score = scorer.score_similarity(
            source_card=commander,
            candidate_card=name,
            source_text=commander_text,
            candidate_text=oracle,
            commander_name=commander,
            commander_colors="WUBG",
        )
        elapsed = time.time() - start
        results.append((name, expected, score, elapsed))
        print(f"    {score:.2f}  {name:<30s}  (expected: {expected}, {elapsed:.1f}s)")

    # Check if scoring makes directional sense
    high_scores = [s for _, e, s, _ in results if e == "high"]
    low_scores = [s for _, e, s, _ in results if e == "low"]

    print(f"\n  Score summary:")
    if high_scores:
        print(f"    High-fit avg:  {sum(high_scores)/len(high_scores):.2f}")
    if low_scores:
        print(f"    Low-fit avg:   {sum(low_scores)/len(low_scores):.2f}")

    if high_scores and low_scores:
        if sum(high_scores)/len(high_scores) > sum(low_scores)/len(low_scores):
            print(f"    PASS: high-fit cards scored higher than low-fit cards")
        else:
            print(f"    WARN: scoring doesn't differentiate well — model may need more training")

    avg_time = sum(t for _, _, _, t in results) / len(results) if results else 0
    print(f"    Avg inference time: {avg_time:.1f}s per card")


def test_tradeoff_explanation(card_db):
    """Test the scorer's tradeoff explanation generation."""
    from backend.model_scorers import get_qwen35_scorer

    print("\n" + "=" * 60)
    print("TEST 3: SCORER — Tradeoff Explanation")
    print("=" * 60)

    scorer = get_qwen35_scorer()

    source = "Doubling Season"
    candidate = "Hardened Scales"
    source_data = card_db.get(source, {})
    candidate_data = card_db.get(candidate, {})

    if not source_data or not candidate_data:
        print(f"  SKIP: cards not found in database")
        return

    print(f"  Comparing: {source} vs {candidate}")
    start = time.time()
    explanation = scorer.generate_tradeoff_explanation(
        source_card=source,
        candidate_card=candidate,
        source_text=source_data.get("oracle_text", ""),
        candidate_text=candidate_data.get("oracle_text", ""),
        source_price=50.0,
        candidate_price=5.0,
        source_cmc=int(source_data.get("cmc", 5)),
        candidate_cmc=int(candidate_data.get("cmc", 1)),
    )
    elapsed = time.time() - start
    print(f"  Explanation ({elapsed:.1f}s):")
    print(f"    {explanation}")
    if len(explanation) > 10:
        print(f"  PASS: generated meaningful explanation")
    else:
        print(f"  WARN: explanation too short")


if __name__ == "__main__":
    print("=" * 60)
    print("END-TO-END MODEL TEST")
    print("=" * 60)

    card_db = load_card_db()
    if not card_db:
        sys.exit(1)

    # Test composer
    cards, lands = test_composer(card_db)

    # Test scorer (reuses composer output)
    test_scorer(card_db, cards)

    # Test tradeoff explanation
    test_tradeoff_explanation(card_db)

    print("\n" + "=" * 60)
    print("ALL TESTS COMPLETE")
    print("=" * 60)
