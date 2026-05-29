"""Generate high-risk Magic rules edge-case candidates from local card data.

Run this after refreshing ``mtg_data/cards_min.jsonl``. The output is not a
claim of support; it is a living queue of cards whose oracle text should be
covered by targeted engine regressions before we call high-power play mature.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CARDS = ROOT / "mtg_data" / "cards_min.jsonl"
DEFAULT_MARKDOWN = ROOT / "docs" / "high-power-edge-case-candidates.md"
DEFAULT_JSON = ROOT / "engine" / "coverage" / "high-power-edge-case-candidates.json"


@dataclass(frozen=True)
class Category:
    id: str
    title: str
    why: str
    suggested_test: str
    patterns: tuple[str, ...]


CATEGORIES: tuple[Category, ...] = (
    Category(
        id="layers-type-changing",
        title="Layers and Type-Changing",
        why="These cards stress type-changing, devotion, ability grants/removes, and timestamp/dependency ordering.",
        suggested_test="engine/src/__tests__/rules-maturity-1v1.test.ts",
        patterns=(
            r"\bas long as\b[^.]+isn'?t a creature",
            r"\bbecomes? (?:a|an)? ?(?:artifact |enchantment |creature)",
            r"\bloses? all abilities\b",
            r"\bare? still lands\b",
            r"\bin addition to (?:its|their) other types\b",
        ),
    ),
    Category(
        id="replacement-prevention",
        title="Replacement and Prevention",
        why="Replacement effects are non-stack effects and are easy to order incorrectly with SBAs, damage, draw, and zone changes.",
        suggested_test="engine/src/__tests__/rules-maturity-1v1.test.ts",
        patterns=(
            r"\binstead\b",
            r"\bprevent (?:all |the next |\d+ )?damage\b",
            r"\bif .* would\b",
            r"\bcan'?t lose the game\b",
            r"\bwould draw a card\b",
        ),
    ),
    Category(
        id="stack-priority-tax",
        title="Stack, Priority, and Tax Triggers",
        why="High-power games frequently stack free spells, counterspells, Rhystic-style triggers, and multiple may-pay choices.",
        suggested_test="engine/src/high-power-interactions.test.ts",
        patterns=(
            r"\bcounter target\b",
            r"\bunless (?:that player|its controller|they) pays?\b",
            r"\bwhenever an opponent casts\b",
            r"\byou may pay\b",
            r"\bwithout paying (?:its|their) mana cost\b",
        ),
    ),
    Category(
        id="hidden-info-search",
        title="Hidden Information and Library Search",
        why="Tutors, naming, look effects, and top-library placement need scoped UI choices and deterministic engine state.",
        suggested_test="engine/src/playtesting-report-regressions.test.ts",
        patterns=(
            r"\bsearch your library\b",
            r"\blook at the top\b",
            r"\breveal cards? from the top\b",
            r"\bname a card\b",
            r"\bput .* on top of (?:your|its owner'?s) library\b",
        ),
    ),
    Category(
        id="tokens-counters-dice",
        title="Tokens, Counters, and Randomization",
        why="Commander board states often hinge on token typing, counter replacement, dice rolls, and future token counting.",
        suggested_test="engine/src/__tests__/starter-decks-card-qa.test.ts",
        patterns=(
            r"\bcreate .* token",
            r"\b(?:put|gets?) .* counters?\b",
            r"\broll a d20\b",
            r"\btreasure\b|\bclue\b|\bfood\b|\bblood\b|\bmap\b",
            r"\bfor each (?:artifact|creature|enchantment|token|opponent)\b",
        ),
    ),
    Category(
        id="silver-unusual",
        title="Silver-Bordered and Unusual Text",
        why="Un-cards and unusual physical/random instructions must either work generically or degrade without crashing.",
        suggested_test="engine/src/__tests__/rules-maturity-1v1.test.ts",
        patterns=(
            r"\btear\b",
            r"\boutside the game\b",
            r"\bfrom the game\b",
            r"\bperson outside\b",
            r"\bd20\b|\bcoin\b",
        ),
    ),
)


def iter_cards(path: Path) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
      for line in handle:
        line = line.strip()
        if not line:
            continue
        yield json.loads(line)


def card_text(card: dict[str, Any]) -> str:
    parts = [
        str(card.get("name") or ""),
        str(card.get("type_line") or ""),
        str(card.get("oracle_text") or ""),
    ]
    for face in card.get("card_faces") or []:
        parts.extend([
            str(face.get("name") or ""),
            str(face.get("type_line") or ""),
            str(face.get("oracle_text") or ""),
        ])
    return "\n".join(parts)


def commander_legal(card: dict[str, Any]) -> bool:
    legalities = card.get("legalities") or {}
    return legalities.get("commander") == "legal"


def score_card(card: dict[str, Any], matched_patterns: list[str]) -> tuple[int, str]:
    rarity_weight = {"mythic": 30, "rare": 20, "uncommon": 8, "common": 2}.get(str(card.get("rarity")), 0)
    price = 0
    prices = card.get("prices") or {}
    for key in ("usd", "usd_foil", "tix"):
        try:
            price = max(price, int(float(prices.get(key) or 0) * 2))
        except (TypeError, ValueError):
            pass
    text_weight = min(40, len(card_text(card)) // 30)
    return rarity_weight + price + text_weight + len(matched_patterns) * 10, str(card.get("name") or "")


def build_candidates(cards: list[dict[str, Any]], max_per_category: int) -> dict[str, Any]:
    report: dict[str, Any] = {
        "schema_version": 1,
        "source": str(DEFAULT_CARDS.relative_to(ROOT)),
        "note": "Regenerate after refreshing local Scryfall/MTGJSON data.",
        "categories": [],
    }

    for category in CATEGORIES:
        matches: list[dict[str, Any]] = []
        compiled = [re.compile(pattern, re.IGNORECASE) for pattern in category.patterns]

        for card in cards:
            if not commander_legal(card):
                continue
            text = card_text(card)
            matched = [pattern.pattern for pattern in compiled if pattern.search(text)]
            if not matched:
                continue
            score, name = score_card(card, matched)
            matches.append({
                "name": name,
                "set": card.get("set"),
                "type_line": card.get("type_line"),
                "rarity": card.get("rarity"),
                "matched_patterns": matched,
                "score": score,
            })

        matches.sort(key=lambda item: (-int(item["score"]), str(item["name"])))
        report["categories"].append({
            "id": category.id,
            "title": category.title,
            "why": category.why,
            "suggested_test": category.suggested_test,
            "patterns": list(category.patterns),
            "candidates": matches[:max_per_category],
            "total_matches": len(matches),
        })

    return report


def markdown(report: dict[str, Any]) -> str:
    lines = [
        "# High-Power Edge-Case Candidates",
        "",
        "Generated from local card data. This is a test backlog, not a support claim.",
        "",
    ]
    for category in report["categories"]:
        lines.extend([
            f"## {category['title']}",
            "",
            category["why"],
            "",
            f"Suggested test file: `{category['suggested_test']}`",
            "",
            f"Total local matches: {category['total_matches']}",
            "",
            "| Card | Set | Type | Matched Pattern Count |",
            "| --- | --- | --- | --- |",
        ])
        for card in category["candidates"]:
            lines.append(
                f"| {card['name']} | {card.get('set') or ''} | "
                f"{str(card.get('type_line') or '').replace('|', '/')} | "
                f"{len(card['matched_patterns'])} |"
            )
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate high-power rules edge-case candidates.")
    parser.add_argument("--cards", type=Path, default=DEFAULT_CARDS)
    parser.add_argument("--out", type=Path, default=DEFAULT_MARKDOWN)
    parser.add_argument("--json-out", type=Path, default=DEFAULT_JSON)
    parser.add_argument("--max-per-category", type=int, default=25)
    args = parser.parse_args()

    cards_path = args.cards if args.cards.is_absolute() else ROOT / args.cards
    cards = list(iter_cards(cards_path))
    report = build_candidates(cards, args.max_per_category)

    out_path = args.out if args.out.is_absolute() else ROOT / args.out
    json_path = args.json_out if args.json_out.is_absolute() else ROOT / args.json_out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(markdown(report) + "\n", encoding="utf-8")
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote {out_path.relative_to(ROOT)}")
    print(f"Wrote {json_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
