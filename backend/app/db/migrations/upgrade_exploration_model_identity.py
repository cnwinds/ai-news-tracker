"""
升级自主探索模型标识：
1. discovered_models 新增 source_uid
2. 唯一键从 model_name 切换为 (source_platform, source_uid)
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional, Set, Tuple
from urllib.parse import urlparse

from sqlalchemy import text

logger = logging.getLogger(__name__)


def _index_columns(conn, index_name: str) -> List[str]:
    rows = conn.execute(text(f"PRAGMA index_info('{index_name}')")).fetchall()
    return [str(row[2]) for row in rows]


def _extract_repo_from_url(url: Any, host: str) -> Optional[str]:
    if not url:
        return None
    try:
        parsed = urlparse(str(url).strip())
        if host not in (parsed.netloc or "").lower():
            return None
        parts = [part for part in (parsed.path or "").split("/") if part]
        if len(parts) < 2:
            return None
        repo = f"{parts[0]}/{parts[1]}"
        if repo.endswith(".git"):
            repo = repo[:-4]
        return repo.lower()
    except Exception:  # noqa: BLE001
        return None


def _extract_arxiv_id(url: Any) -> Optional[str]:
    if not url:
        return None
    text_value = str(url).strip()
    if not text_value:
        return None
    match = re.search(r"arxiv\.org/(?:abs|pdf)/([0-9]+\.[0-9]+)(?:v[0-9]+)?", text_value)
    if match:
        return match.group(1).lower()
    match = re.search(r"^([0-9]+\.[0-9]+)(?:v[0-9]+)?$", text_value)
    if match:
        return match.group(1).lower()
    return None


def _derive_source_uid(row: Dict[str, Any]) -> str:
    source_platform = str(row.get("source_platform") or "unknown").strip().lower() or "unknown"
    existing_uid = str(row.get("source_uid") or "").strip().lower()
    if existing_uid:
        return existing_uid

    if source_platform == "github":
        repo = _extract_repo_from_url(row.get("github_url"), host="github.com")
        if repo:
            return repo
    elif source_platform == "huggingface":
        repo = _extract_repo_from_url(row.get("model_url"), host="huggingface.co")
        if repo:
            return repo
    elif source_platform == "arxiv":
        arxiv_id = _extract_arxiv_id(row.get("paper_url"))
        if arxiv_id:
            return arxiv_id

    organization = str(row.get("organization") or "unknown-org").strip().lower().replace(" ", "-")
    model_name = str(row.get("model_name") or "unknown-model").strip().lower().replace(" ", "-")
    return f"{organization}/{model_name}"


def _is_identity_upgraded(conn) -> Tuple[bool, bool, bool]:
    columns = [str(row[1]) for row in conn.execute(text("PRAGMA table_info('discovered_models')")).fetchall()]
    has_source_uid = "source_uid" in columns

    has_unique_model_name = False
    has_unique_source_uid = False
    index_rows = conn.execute(text("PRAGMA index_list('discovered_models')")).fetchall()
    for index_row in index_rows:
        index_name = str(index_row[1])
        is_unique = bool(index_row[2])
        if not is_unique:
            continue
        cols = _index_columns(conn, index_name)
        if cols == ["model_name"]:
            has_unique_model_name = True
        if cols == ["source_platform", "source_uid"]:
            has_unique_source_uid = True

    upgraded = has_source_uid and has_unique_source_uid and not has_unique_model_name
    return upgraded, has_source_uid, has_unique_model_name


def upgrade_exploration_model_identity(engine) -> bool:
    """
    升级 discovered_models 的唯一标识逻辑。

    Returns:
        bool: 是否执行了升级
    """
    try:
        with engine.connect() as conn:
            table_exists = conn.execute(
                text(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='discovered_models'"
                )
            ).fetchone()
            if not table_exists:
                logger.debug("discovered_models 表不存在，跳过模型标识升级")
                return False

            upgraded, has_source_uid, has_unique_model_name = _is_identity_upgraded(conn)
            if upgraded:
                logger.debug("自主探索模型标识已是最新结构，跳过升级")
                return False

            logger.info(
                "🔄 开始升级 discovered_models 标识结构 (has_source_uid=%s has_unique_model_name=%s)",
                has_source_uid,
                has_unique_model_name,
            )

            select_columns = [
                "id",
                "model_name",
                "model_type",
                "organization",
                "release_date",
                "source_platform",
                "github_url",
                "paper_url",
                "model_url",
                "license",
                "description",
                "github_stars",
                "github_forks",
                "paper_citations",
                "social_mentions",
                "impact_score",
                "quality_score",
                "innovation_score",
                "practicality_score",
                "final_score",
                "status",
                "is_notable",
                "extra_data",
                "created_at",
                "updated_at",
            ]
            if has_source_uid:
                select_columns.append("source_uid")

            rows = conn.execute(
                text(f"SELECT {', '.join(select_columns)} FROM discovered_models ORDER BY id")
            ).mappings().all()

            conn.execute(text("PRAGMA foreign_keys=OFF"))

            conn.execute(text("""
                CREATE TABLE discovered_models_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    model_name VARCHAR(255) NOT NULL,
                    model_type VARCHAR(50),
                    organization VARCHAR(255),
                    release_date TIMESTAMP,
                    source_platform VARCHAR(50) NOT NULL,
                    source_uid VARCHAR(512) NOT NULL,
                    github_url VARCHAR(512),
                    paper_url VARCHAR(512),
                    model_url VARCHAR(512),
                    license VARCHAR(50),
                    description TEXT,
                    github_stars INTEGER DEFAULT 0,
                    github_forks INTEGER DEFAULT 0,
                    paper_citations INTEGER DEFAULT 0,
                    social_mentions INTEGER DEFAULT 0,
                    impact_score REAL,
                    quality_score REAL,
                    innovation_score REAL,
                    practicality_score REAL,
                    final_score REAL,
                    status VARCHAR(20) DEFAULT 'discovered',
                    is_notable BOOLEAN DEFAULT 0,
                    extra_data JSON,
                    created_at TIMESTAMP,
                    updated_at TIMESTAMP
                )
            """))

            insert_sql = text("""
                INSERT INTO discovered_models_new (
                    id, model_name, model_type, organization, release_date,
                    source_platform, source_uid, github_url, paper_url, model_url,
                    license, description, github_stars, github_forks,
                    paper_citations, social_mentions, impact_score, quality_score,
                    innovation_score, practicality_score, final_score, status,
                    is_notable, extra_data, created_at, updated_at
                ) VALUES (
                    :id, :model_name, :model_type, :organization, :release_date,
                    :source_platform, :source_uid, :github_url, :paper_url, :model_url,
                    :license, :description, :github_stars, :github_forks,
                    :paper_citations, :social_mentions, :impact_score, :quality_score,
                    :innovation_score, :practicality_score, :final_score, :status,
                    :is_notable, :extra_data, :created_at, :updated_at
                )
            """)

            used_keys: Set[Tuple[str, str]] = set()
            for row in rows:
                payload = dict(row)
                source_platform = str(payload.get("source_platform") or "unknown").strip().lower() or "unknown"
                payload["source_platform"] = source_platform
                source_uid = _derive_source_uid(payload)
                unique_key = (source_platform, source_uid)
                if unique_key in used_keys:
                    source_uid = f"{source_uid}#{payload.get('id')}"
                    unique_key = (source_platform, source_uid)
                used_keys.add(unique_key)
                payload["source_uid"] = source_uid
                conn.execute(insert_sql, payload)

            conn.execute(text("DROP TABLE discovered_models"))
            conn.execute(text("ALTER TABLE discovered_models_new RENAME TO discovered_models"))

            conn.execute(text("CREATE INDEX idx_model_score_date ON discovered_models(final_score, release_date)"))
            conn.execute(text("CREATE INDEX idx_model_status_score ON discovered_models(status, final_score)"))
            conn.execute(text("CREATE UNIQUE INDEX idx_model_source_uid_unique ON discovered_models(source_platform, source_uid)"))
            conn.execute(text("CREATE INDEX ix_discovered_models_model_name ON discovered_models(model_name)"))
            conn.execute(text("CREATE INDEX ix_discovered_models_release_date ON discovered_models(release_date)"))
            conn.execute(text("CREATE INDEX ix_discovered_models_source_uid ON discovered_models(source_uid)"))
            conn.execute(text("CREATE INDEX ix_discovered_models_final_score ON discovered_models(final_score)"))
            conn.execute(text("CREATE INDEX ix_discovered_models_status ON discovered_models(status)"))
            conn.execute(text("CREATE INDEX ix_discovered_models_is_notable ON discovered_models(is_notable)"))

            conn.execute(text("PRAGMA foreign_keys=ON"))
            conn.commit()
            logger.info("✅ discovered_models 标识结构升级完成，处理记录 %s 条", len(rows))
            return True
    except Exception as exc:  # noqa: BLE001
        logger.error("❌ 升级 discovered_models 标识结构失败: %s", exc)
        raise
