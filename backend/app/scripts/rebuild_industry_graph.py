"""Rebuild industry graph facts from migrated articles.

Usage:
    python -m backend.app.scripts.rebuild_industry_graph --clear-existing-graph --batch-size 50
"""
from __future__ import annotations

import argparse
import json

from backend.app.db import get_db
from backend.app.services.industry_graph import IndustryGraphService
from backend.app.utils import create_ai_analyzer


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
        result = service.rebuild_all_articles(
            batch_size=args.batch_size,
            max_documents=args.max_documents,
            clear_existing_graph=args.clear_existing_graph,
        )

    print(json.dumps(result, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    main()
