"""Audit the DeckReps Magic coverage manifest.

The manifest is intentionally explicit: every rule family we claim for beta
must have a status, priority, next action, and evidence files where possible.
This script makes the current promise measurable instead of vibes-based.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "engine" / "coverage" / "magic-beta-coverage.json"


def load_manifest(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def validate_manifest(manifest: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
    errors: list[str] = []
    areas = manifest.get("areas")
    if not isinstance(areas, list) or not areas:
        return ["Manifest must contain a non-empty 'areas' list."], []

    seen_ids: set[str] = set()
    normalized: list[dict[str, Any]] = []
    allowed_statuses = set(manifest.get("status_meanings", {}).keys())
    allowed_priorities = {"P0", "P1", "P2", "P3"}

    for index, area in enumerate(areas, start=1):
        area_id = str(area.get("id", "")).strip()
        if not area_id:
            errors.append(f"Area #{index} is missing id.")
        elif area_id in seen_ids:
            errors.append(f"Duplicate area id: {area_id}")
        seen_ids.add(area_id)

        status = str(area.get("status", "")).strip()
        if status not in allowed_statuses:
            errors.append(f"{area_id}: unknown status '{status}'.")

        priority = str(area.get("priority", "")).strip()
        if priority not in allowed_priorities:
            errors.append(f"{area_id}: unknown priority '{priority}'.")

        if not str(area.get("promise", "")).strip():
          errors.append(f"{area_id}: missing promise.")
        if not str(area.get("next", "")).strip():
          errors.append(f"{area_id}: missing next action.")

        evidence = area.get("evidence", [])
        if not isinstance(evidence, list):
            errors.append(f"{area_id}: evidence must be a list.")
            evidence = []

        missing_evidence: list[str] = []
        for item in evidence:
            rel = Path(str(item))
            if rel.is_absolute():
                candidate = rel
            else:
                candidate = ROOT / rel
            if not candidate.exists():
                missing_evidence.append(str(item))

        normalized.append({**area, "missing_evidence": missing_evidence})

    return errors, normalized


def make_summary(areas: list[dict[str, Any]]) -> str:
    by_status = Counter(str(area["status"]) for area in areas)
    by_priority = Counter(str(area["priority"]) for area in areas)
    status_order = ["certified", "partial", "gap", "blocked"]
    priority_order = ["P0", "P1", "P2", "P3"]

    lines = [
        "# DeckReps Magic Coverage Audit",
        "",
        f"Total areas: {len(areas)}",
        "",
        "By status:",
    ]
    for status in status_order:
        lines.append(f"- {status}: {by_status.get(status, 0)}")

    lines.append("")
    lines.append("By priority:")
    for priority in priority_order:
        count = by_priority.get(priority, 0)
        if count:
            lines.append(f"- {priority}: {count}")

    lines.append("")
    lines.append("Open P0/P1 gaps:")
    open_high = [
        area for area in areas
        if area["priority"] in {"P0", "P1"} and area["status"] in {"gap", "blocked"}
    ]
    if open_high:
        for area in open_high:
            lines.append(f"- [{area['priority']}] {area['id']}: {area['next']}")
    else:
        lines.append("- none")

    lines.append("")
    lines.append("Missing evidence references:")
    missing_any = False
    for area in areas:
        for missing in area.get("missing_evidence", []):
            lines.append(f"- {area['id']}: {missing}")
            missing_any = True
    if not missing_any:
        lines.append("- none")

    lines.append("")
    lines.append("Area table:")
    lines.append("| Priority | Status | Area | Next |")
    lines.append("| --- | --- | --- | --- |")
    for area in sorted(areas, key=lambda item: (item["priority"], item["status"], item["id"])):
        lines.append(
            f"| {area['priority']} | {area['status']} | {area['id']} | "
            f"{str(area['next']).replace('|', '/')} |"
        )

    return "\n".join(lines)


def write_markdown_report(markdown: str, output: Path | None) -> None:
    if not output:
        print(markdown)
        return

    if not output.is_absolute():
        output = ROOT / output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(markdown + "\n", encoding="utf-8")
    print(f"Wrote {output.relative_to(ROOT)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit Magic beta coverage manifest.")
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Fail if any P0/P1 area is gap/blocked or any evidence path is missing.",
    )
    args = parser.parse_args()

    manifest = load_manifest(args.manifest)
    errors, areas = validate_manifest(manifest)
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 2

    markdown = make_summary(areas)
    write_markdown_report(markdown, args.out)

    if args.strict:
        high_gaps = [
            area for area in areas
            if area["priority"] in {"P0", "P1"} and area["status"] in {"gap", "blocked"}
        ]
        missing_evidence = [
            area for area in areas
            if area.get("missing_evidence")
        ]
        if high_gaps or missing_evidence:
            return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
