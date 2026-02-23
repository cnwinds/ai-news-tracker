"""
为 discovered_models 表新增结构化活动字段：
- last_activity_at
- activity_type
- activity_confidence

并回填历史数据（优先 extra_data.updated_at，其次 release_date）。

执行方式：
python -m backend.app.db.migrations.add_model_activity_fields
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Dict, Optional

from sqlalchemy import create_engine, text

from backend.app.core.config import settings

logger = logging.getLogger(__name__)


def _has_column(conn, table: str, column: str) -> bool:
    rows = conn.execute(text(f"PRAGMA table_info('{table}')")).mappings().all()
    return any(str(row.get("name")) == column for row in rows)


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized).replace(tzinfo=None)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _parse_extra_data(extra_data: Any) -> Dict[str, Any]:
    if isinstance(extra_data, dict):
        return extra_data
    if extra_data is None:
        return {}
    if isinstance(extra_data, str):
        text_data = extra_data.strip()
        if not text_data:
            return {}
        try:
            data = json.loads(text_data)
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def upgrade() -> bool:
    engine = create_engine(settings.DATABASE_URL)
    with engine.connect() as conn:
        has_last_activity_at = _has_column(conn, "discovered_models", "last_activity_at")
        has_activity_type = _has_column(conn, "discovered_models", "activity_type")
        has_activity_confidence = _has_column(conn, "discovered_models", "activity_confidence")

        if not has_last_activity_at:
            conn.execute(text("ALTER TABLE discovered_models ADD COLUMN last_activity_at TIMESTAMP"))
        if not has_activity_type:
            conn.execute(text("ALTER TABLE discovered_models ADD COLUMN activity_type VARCHAR(50)"))
        if not has_activity_confidence:
            conn.execute(text("ALTER TABLE discovered_models ADD COLUMN activity_confidence REAL"))

        conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS idx_model_last_activity "
                "ON discovered_models(last_activity_at)"
            )
        )

        rows = conn.execute(
            text(
                "SELECT id, release_date, extra_data, last_activity_at, activity_type, activity_confidence "
                "FROM discovered_models"
            )
        ).mappings().all()

        updated = 0
        for row in rows:
            extra = _parse_extra_data(row.get("extra_data"))
            updated_at = _parse_dt(extra.get("updated_at"))
            release_date = _parse_dt(row.get("release_date"))
            last_activity_at = _parse_dt(row.get("last_activity_at")) or updated_at or release_date

            current_type = row.get("activity_type")
            next_type = current_type or (str(extra.get("update_type") or "").strip() or None)

            current_conf = row.get("activity_confidence")
            conf_from_extra = extra.get("release_confidence")
            try:
                next_conf = float(current_conf if current_conf is not None else conf_from_extra)
            except (TypeError, ValueError):
                next_conf = None

            if (
                _parse_dt(row.get("last_activity_at")) == last_activity_at
                and current_type == next_type
                and row.get("activity_confidence") == next_conf
            ):
                continue

            conn.execute(
                text(
                    "UPDATE discovered_models "
                    "SET last_activity_at=:last_activity_at, activity_type=:activity_type, activity_confidence=:activity_confidence "
                    "WHERE id=:id"
                ),
                {
                    "id": row["id"],
                    "last_activity_at": last_activity_at,
                    "activity_type": next_type,
                    "activity_confidence": next_conf,
                },
            )
            updated += 1

        conn.commit()
        logger.info("✅ 新增模型活动字段完成，回填记录 %s 条", updated)
        return True


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    upgrade()
