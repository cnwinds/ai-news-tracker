"""Rebuild industry graph facts from migrated articles.

Usage:
    python -m backend.app.scripts.rebuild_industry_graph --clear-existing-graph --batch-size 50
"""
from __future__ import annotations

import argparse
import json
from typing import Any, Dict

from backend.app.db import get_db
from backend.app.services.industry_graph import IndustryGraphService
from backend.app.utils import create_ai_analyzer


def write_progress(message: str) -> None:
    print(message, flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild industry graph facts from articles.")
    parser.add_argument("--batch-size", type=int, default=50, help="Documents per extraction batch, max 50.")
    parser.add_argument("--max-documents", type=int, default=None, help="Optional limit for a smoke run.")
    parser.add_argument(
        "--clear-existing-graph",
        action="store_true",
        help="Delete current industry graph facts before rebuilding.",
    )
    args = parser.parse_args()

    db = get_db()
    with db.get_session() as session:
        service = IndustryGraphService(db=session, ai_analyzer=create_ai_analyzer())
        batch_size = max(1, min(int(args.batch_size or 50), 50))
        max_documents = None if args.max_documents is None else max(1, int(args.max_documents))
        totals: Dict[str, Any] = {
            "imported": 0,
            "import_skipped": 0,
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "entities_upserted": 0,
            "relations_upserted": 0,
            "evidence_upserted": 0,
            "batches": 0,
            "cleared": {},
            "errors": [],
        }

        write_progress("[IndustryGraph] Rebuild started.")
        if args.clear_existing_graph:
            write_progress("[IndustryGraph] Clearing existing graph facts...")
            totals["cleared"] = service.clear_graph_facts()
            write_progress(f"[IndustryGraph] Cleared: {json.dumps(totals['cleared'], ensure_ascii=False)}")

        write_progress("[IndustryGraph] Importing legacy/articles table into industry_documents...")
        import_result = service.import_articles(limit=None)
        totals["imported"] = int(import_result.get("imported", 0))
        totals["import_skipped"] = int(import_result.get("skipped", 0))
        write_progress(
            "[IndustryGraph] Import complete: "
            f"imported={totals['imported']} skipped={totals['import_skipped']}"
        )

        while True:
            if max_documents is not None:
                remaining = max_documents - totals["processed"] - totals["failed"]
                if remaining <= 0:
                    break
                current_limit = min(batch_size, remaining)
            else:
                current_limit = batch_size

            next_batch = totals["batches"] + 1
            write_progress(f"[IndustryGraph] Processing batch {next_batch}, limit={current_limit}...")
            result = service.process_articles(
                limit=current_limit,
                import_first=False,
                force=False,
            )

            if result["processed"] == 0 and result["failed"] == 0:
                totals["skipped"] += int(result.get("skipped", 0))
                write_progress("[IndustryGraph] No pending documents found. Rebuild finished.")
                break

            totals["batches"] += 1
            for key in [
                "processed",
                "skipped",
                "failed",
                "entities_upserted",
                "relations_upserted",
                "evidence_upserted",
            ]:
                totals[key] += int(result.get(key, 0))
            totals["errors"].extend(result.get("errors", []))
            write_progress(
                "[IndustryGraph] Batch complete: "
                f"processed={result.get('processed', 0)} failed={result.get('failed', 0)} "
                f"entities+={result.get('entities_upserted', 0)} "
                f"relations+={result.get('relations_upserted', 0)} "
                f"total_processed={totals['processed']} total_failed={totals['failed']}"
            )

        totals["stats"] = service.get_stats()

    write_progress("[IndustryGraph] Final summary:")
    print(json.dumps(totals, ensure_ascii=False, default=str, indent=2), flush=True)


if __name__ == "__main__":
    main()
