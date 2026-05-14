"""
Native knowledge graph service.
"""
from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import time
import unicodedata
import uuid
from collections import Counter, defaultdict, deque
from datetime import datetime
from typing import Any, Deque, Dict, Iterable, List, Optional, Sequence, Set, Tuple

import networkx as nx
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, or_
from sqlalchemy.orm import aliased
from sqlalchemy.orm import Session

from backend.app.core.settings import settings
from backend.app.db.models import (
    Article,
    KnowledgeGraphArticleState,
    KnowledgeGraphBuild,
    KnowledgeGraphEdge,
    KnowledgeGraphNode,
)
from backend.app.services.analyzer.ai_analyzer import AIAnalyzer
from backend.app.services.rag.rag_service import RAGService

logger = logging.getLogger(__name__)

NodeSpec = Dict[str, Any]
EdgeSpec = Dict[str, Any]

ALLOWED_SEMANTIC_NODE_TYPES = {
    "org",
    "organization",
    "model",
    "person",
    "concept",
    "dataset",
    "benchmark",
    "company",
    "product",
    "paper",
    "topic",
    "tag",
    "source",
    "author",
}
DOMAIN_NODE_TYPES = {
    "product",
    "organization",
    "platform",
    "technology",
    "concept",
    "feature",
}
DOMAIN_NODE_TYPE_ALIASES = {
    "product": "product",
    "model": "product",
    "framework": "product",
    "tool": "product",
    "application": "product",
    "app": "product",
    "organization": "organization",
    "org": "organization",
    "company": "organization",
    "person": "organization",
    "author": "organization",
    "source": "organization",
    "platform": "platform",
    "technology": "technology",
    "tech": "technology",
    "concept": "concept",
    "paper": "concept",
    "dataset": "concept",
    "benchmark": "concept",
    "topic": "concept",
    "tag": "concept",
    "feature": "feature",
    "capability": "feature",
    "scenario": "feature",
}
DOMAIN_RELATION_TYPES = {
    "DEVELOPED",
    "BASED_ON",
    "USES",
    "SUPPORTS",
    "HAS_FEATURE",
    "SOLVES",
}
STRONG_IDENTITY_FIELDS = (
    "github_url",
    "official_site",
    "paper_url",
    "model_url",
    "arxiv_id",
    "doi",
    "url",
)
CANONICAL_NAME_ALIAS_MAP = {
    "a2ui": "Agent-to-UI",
    "agent-to-ui": "Agent-to-UI",
    "agent to ui": "Agent-to-UI",
    "google a2ui协议": "Agent-to-UI",
    "google a2ui protocol": "Agent-to-UI",
    "ios": "iOS",
    "android": "Android",
    "安卓": "Android",
    "harmony os": "HarmonyOS",
    "harmonyos": "HarmonyOS",
    "鸿蒙": "HarmonyOS",
    "鸿蒙系统": "HarmonyOS",
}
ALLOWED_QUERY_MODES = {"auto", "graph", "hybrid", "rag"}
ALLOWED_RUN_MODES = {"auto", "agent"}
REMOVED_RUN_MODES = {"deterministic"}
LAYOUT_COMPONENT_GAP = 2.8
LAYOUT_MAX_NODES = 500  # 只对前 N 个高度数节点计算布局，避免大图 O(n³) 爆炸


class KnowledgeGraphService:
    """Knowledge graph build, query and QA service."""

    def __init__(self, db: Session, ai_analyzer: Optional[AIAnalyzer] = None):
        self.db = db
        self.ai_analyzer = ai_analyzer
        self.snapshot_dir = settings.get_knowledge_graph_snapshot_dir()
        self.snapshot_path = self.snapshot_dir / "current_snapshot.json"
        self.report_path = self.snapshot_dir / "latest_report.md"
        self._graph: Optional[nx.Graph] = None
        self._node_lookup: Optional[Dict[int, KnowledgeGraphNode]] = None
        self._snapshot_cache: Optional[Dict[str, Any]] = None

    def get_settings_snapshot(self) -> Dict[str, Any]:
        settings.load_settings_from_db(force_reload=True)
        return {
            "enabled": bool(settings.KNOWLEDGE_GRAPH_ENABLED),
            "auto_sync_enabled": bool(settings.KNOWLEDGE_GRAPH_AUTO_SYNC_ENABLED),
            "run_mode": settings.get_knowledge_graph_run_mode(),
            "max_articles_per_sync": int(settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC),
            "query_depth": int(settings.KNOWLEDGE_GRAPH_QUERY_DEPTH),
        }

    def sync_articles(
        self,
        *,
        article_ids: Optional[Sequence[int]] = None,
        force_rebuild: bool = False,
        sync_mode: Optional[str] = None,
        max_articles: Optional[int] = None,
        trigger_source: str = "manual",
    ) -> Dict[str, Any]:
        requested_mode = self._normalize_run_mode(sync_mode or settings.get_knowledge_graph_run_mode())
        resolved_mode = self._resolve_run_mode(requested_mode)
        build = KnowledgeGraphBuild(
            build_id=uuid.uuid4().hex,
            status="running",
            trigger_source=(trigger_source or "manual")[:50],
            sync_mode=resolved_mode,
            started_at=datetime.now(),
            total_articles=0,
            processed_articles=0,
            nodes_upserted=0,
            edges_upserted=0,
            extra_data={},
        )
        self.db.add(build)
        self.db.commit()
        self.db.refresh(build)

        skipped_articles = 0
        failed_articles = 0
        t_sync_start = time.perf_counter()
        try:
            if force_rebuild:
                logger.info("[sync] force_rebuild=True — clearing graph tables")
                t0 = time.perf_counter()
                self._clear_graph_tables(keep_build_id=build.build_id, clear_build_history=True)
                logger.info("[sync] graph tables cleared in %.2fs", time.perf_counter() - t0)

            t0 = time.perf_counter()
            articles = self._select_articles_for_sync(
                article_ids=article_ids,
                run_mode=resolved_mode,
                force_rebuild=force_rebuild,
                max_articles=max_articles,
            )
            build.total_articles = len(articles)
            self.db.commit()
            logger.info(
                "[sync] article selection: %d articles to process (mode=%s, %.2fs)",
                len(articles), resolved_mode, time.perf_counter() - t0,
            )

            t_articles_start = time.perf_counter()
            for index, article in enumerate(articles):
                article_hash = self._compute_article_hash(article)
                try:
                    if not force_rebuild and not self._needs_sync(article, article_hash, resolved_mode):
                        skipped_articles += 1
                        continue

                    t_article = time.perf_counter()
                    sync_result = self._sync_single_article(article, article_hash, resolved_mode)
                    build.processed_articles += 1
                    build.nodes_upserted += sync_result["nodes_upserted"]
                    build.edges_upserted += sync_result["edges_upserted"]
                    self.db.commit()

                    if build.processed_articles % 10 == 0 or build.processed_articles == 1:
                        elapsed = time.perf_counter() - t_articles_start
                        rate = build.processed_articles / max(elapsed, 0.001)
                        remaining = (len(articles) - index - 1) / max(rate, 0.001)
                        logger.info(
                            "[sync] progress %d/%d (skipped=%d, failed=%d) | %.1f art/s | ~%.0fs left | article_id=%d nodes=%d edges=%d (%.2fs)",
                            build.processed_articles, len(articles),
                            skipped_articles, failed_articles,
                            rate, remaining,
                            article.id,
                            sync_result["nodes_upserted"], sync_result["edges_upserted"],
                            time.perf_counter() - t_article,
                        )
                except Exception as exc:
                    failed_articles += 1
                    logger.error("Knowledge graph sync failed for article %s: %s", article.id, exc, exc_info=True)
                    self._mark_article_state_error(article.id, article_hash, resolved_mode, str(exc))
                    self.db.commit()

            logger.info(
                "[sync] article loop done: processed=%d skipped=%d failed=%d in %.2fs",
                build.processed_articles, skipped_articles, failed_articles,
                time.perf_counter() - t_articles_start,
            )

            t0 = time.perf_counter()
            self._cleanup_orphan_nodes()
            logger.info("[sync] orphan cleanup done in %.2fs", time.perf_counter() - t0)

            snapshot = self.rebuild_snapshot(build_id=build.build_id)

            build.status = "completed"
            build.completed_at = datetime.now()
            build.extra_data = {
                "skipped_articles": skipped_articles,
                "failed_articles": failed_articles,
                "snapshot_updated_at": snapshot.get("generated_at"),
            }
            self.db.commit()

            return {
                "build": self._serialize_build(build),
                "stats": self.get_stats(),
            }
        except Exception as exc:
            logger.error("Knowledge graph build failed: %s", exc, exc_info=True)
            self.db.rollback()
            build.status = "failed"
            build.error_message = str(exc)
            build.completed_at = datetime.now()
            build.extra_data = {
                "skipped_articles": skipped_articles,
                "failed_articles": failed_articles + 1,
            }
            self.db.add(build)
            self.db.commit()
            raise

    def get_stats(self) -> Dict[str, Any]:
        snapshot = self._load_snapshot()
        total_articles = self.db.query(func.count(Article.id)).scalar() or 0
        synced_articles = (
            self.db.query(func.count(KnowledgeGraphArticleState.article_id))
            .filter(KnowledgeGraphArticleState.status == "synced")
            .scalar()
            or 0
        )
        failed_articles = (
            self.db.query(func.count(KnowledgeGraphArticleState.article_id))
            .filter(KnowledgeGraphArticleState.status == "error")
            .scalar()
            or 0
        )
        last_build = (
            self.db.query(KnowledgeGraphBuild)
            .order_by(KnowledgeGraphBuild.started_at.desc())
            .first()
        )
        return {
            "enabled": bool(settings.KNOWLEDGE_GRAPH_ENABLED),
            "total_nodes": int(snapshot.get("stats", {}).get("total_nodes", 0)),
            "total_edges": int(snapshot.get("stats", {}).get("total_edges", 0)),
            "total_articles": int(total_articles),
            "synced_articles": int(synced_articles),
            "failed_articles": int(failed_articles),
            "coverage": float((synced_articles / total_articles) if total_articles else 0.0),
            "snapshot_updated_at": self._parse_datetime(snapshot.get("generated_at")),
            "node_type_counts": snapshot.get("stats", {}).get("node_type_counts", {}),
            "relation_type_counts": snapshot.get("stats", {}).get("relation_type_counts", {}),
            "top_nodes": snapshot.get("god_nodes", [])[:8],
            "last_build": self._serialize_build(last_build) if last_build else None,
        }

    def get_builds(self, limit: int = 20) -> List[Dict[str, Any]]:
        rows = (
            self.db.query(KnowledgeGraphBuild)
            .order_by(KnowledgeGraphBuild.started_at.desc())
            .limit(max(1, min(limit, 100)))
            .all()
        )
        return [self._serialize_build(row) for row in rows]

    def diagnose_integrity(self, *, keyword: Optional[str] = None, limit: int = 100) -> Dict[str, Any]:
        safe_limit = max(1, min(int(limit or 100), 500))
        checked_at = datetime.now()
        issues: List[Dict[str, Any]] = []

        db_counts = {
            "nodes": int(self.db.query(func.count(KnowledgeGraphNode.id)).scalar() or 0),
            "edges": int(self.db.query(func.count(KnowledgeGraphEdge.id)).scalar() or 0),
            "articles": int(self.db.query(func.count(Article.id)).scalar() or 0),
            "article_states": int(self.db.query(func.count(KnowledgeGraphArticleState.article_id)).scalar() or 0),
            "synced_articles": int(
                self.db.query(func.count(KnowledgeGraphArticleState.article_id))
                .filter(KnowledgeGraphArticleState.status == "synced")
                .scalar()
                or 0
            ),
            "failed_articles": int(
                self.db.query(func.count(KnowledgeGraphArticleState.article_id))
                .filter(KnowledgeGraphArticleState.status == "error")
                .scalar()
                or 0
            ),
        }

        source_node = aliased(KnowledgeGraphNode)
        target_node = aliased(KnowledgeGraphNode)
        dangling_query = (
            self.db.query(KnowledgeGraphEdge.id)
            .outerjoin(source_node, KnowledgeGraphEdge.source_node_id == source_node.id)
            .outerjoin(target_node, KnowledgeGraphEdge.target_node_id == target_node.id)
            .filter(or_(source_node.id.is_(None), target_node.id.is_(None)))
        )
        dangling_count = int(dangling_query.count())
        dangling_samples = [int(row[0]) for row in dangling_query.order_by(KnowledgeGraphEdge.id).limit(safe_limit).all()]
        if dangling_count:
            issues.append(
                {
                    "code": "dangling_edges",
                    "severity": "error",
                    "message": "存在引用缺失节点的图谱边，需要先清理这些边。",
                    "count": dangling_count,
                    "samples": dangling_samples,
                }
            )

        used_node_ids = (
            self.db.query(KnowledgeGraphEdge.source_node_id.label("node_id"))
            .union(self.db.query(KnowledgeGraphEdge.target_node_id.label("node_id")))
            .subquery()
        )
        orphan_query = self.db.query(KnowledgeGraphNode.node_key).filter(
            ~KnowledgeGraphNode.id.in_(self.db.query(used_node_ids.c.node_id))
        )
        orphan_count = int(orphan_query.count())
        orphan_samples = [row[0] for row in orphan_query.order_by(KnowledgeGraphNode.id).limit(safe_limit).all()]
        if orphan_count:
            issues.append(
                {
                    "code": "orphan_nodes",
                    "severity": "warning",
                    "message": "存在没有任何关系边的孤立节点，会造成节点数量虚高和图谱噪声。",
                    "count": orphan_count,
                    "samples": orphan_samples,
                }
            )

        missing_article_state_query = (
            self.db.query(KnowledgeGraphArticleState.article_id)
            .outerjoin(Article, KnowledgeGraphArticleState.article_id == Article.id)
            .filter(Article.id.is_(None))
        )
        missing_article_state_count = int(missing_article_state_query.count())
        missing_article_state_samples = [
            int(row[0])
            for row in missing_article_state_query.order_by(KnowledgeGraphArticleState.article_id)
            .limit(safe_limit)
            .all()
        ]
        if missing_article_state_count:
            issues.append(
                {
                    "code": "states_without_articles",
                    "severity": "warning",
                    "message": "存在已经没有原文的文章同步状态，可以清理。",
                    "count": missing_article_state_count,
                    "samples": missing_article_state_samples,
                }
            )

        synced_article_rows = (
            self.db.query(Article, KnowledgeGraphArticleState)
            .join(KnowledgeGraphArticleState, KnowledgeGraphArticleState.article_id == Article.id)
            .filter(KnowledgeGraphArticleState.status == "synced")
            .all()
        )
        edge_article_ids = {
            int(row[0])
            for row in self.db.query(KnowledgeGraphEdge.source_article_id)
            .filter(KnowledgeGraphEdge.source_article_id.isnot(None))
            .distinct()
            .all()
        }
        hash_mismatch_ids: List[int] = []
        for article, state in synced_article_rows:
            if not state.last_synced_at or state.content_hash != self._compute_article_hash(article):
                hash_mismatch_ids.append(int(article.id))

        if hash_mismatch_ids:
            issues.append(
                {
                    "code": "stale_synced_articles",
                    "severity": "warning",
                    "message": "部分已同步文章的内容哈希已变化，需要增量重同步。",
                    "count": len(hash_mismatch_ids),
                    "samples": hash_mismatch_ids[:safe_limit],
                }
            )
        unsynced_rows = (
            self.db.query(KnowledgeGraphArticleState.article_id)
            .join(Article, KnowledgeGraphArticleState.article_id == Article.id)
            .filter(KnowledgeGraphArticleState.status != "synced")
            .order_by(KnowledgeGraphArticleState.updated_at.desc())
            .limit(safe_limit)
            .all()
        )
        unsynced_article_ids = [int(row[0]) for row in unsynced_rows]

        keyword_article_ids: List[int] = []
        normalized_keyword = (keyword or "").strip()
        if normalized_keyword:
            keyword_filter = f"%{normalized_keyword}%"
            keyword_rows = (
                self.db.query(Article.id)
                .filter(
                    or_(
                        Article.title.ilike(keyword_filter),
                        Article.title_zh.ilike(keyword_filter),
                        Article.summary.ilike(keyword_filter),
                        Article.detailed_summary.ilike(keyword_filter),
                        Article.content.ilike(keyword_filter),
                    )
                )
                .order_by(Article.updated_at.desc(), Article.id.desc())
                .limit(safe_limit)
                .all()
            )
            keyword_article_ids = [int(row[0]) for row in keyword_rows]
            missing_keyword_ids = [
                article_id
                for article_id in keyword_article_ids
                if article_id not in edge_article_ids
            ]
            if keyword_article_ids and missing_keyword_ids:
                issues.append(
                    {
                        "code": "keyword_articles_missing_graph",
                        "severity": "warning",
                        "message": "关键词命中的文章未完整进入图谱，建议只重同步这些文章。",
                        "count": len(missing_keyword_ids),
                        "samples": missing_keyword_ids[:safe_limit],
                    }
                )

        snapshot, snapshot_error = self._read_snapshot_for_integrity()
        snapshot_nodes = list(snapshot.get("nodes", []) if snapshot else [])
        snapshot_links = list(snapshot.get("links", []) if snapshot else [])
        snapshot_node_keys = {item.get("node_key") for item in snapshot_nodes if item.get("node_key")}
        invalid_snapshot_links = [
            link
            for link in snapshot_links
            if link.get("source") not in snapshot_node_keys or link.get("target") not in snapshot_node_keys
        ]
        graph = self._build_networkx_graph()
        snapshot_counts = {
            "exists": int(bool(snapshot)),
            "nodes": len(snapshot_nodes),
            "links": len(snapshot_links),
            "generated_at": snapshot.get("generated_at") if snapshot else None,
            "graph_nodes_from_db": int(graph.number_of_nodes()),
            "graph_links_from_db": int(graph.number_of_edges()),
        }
        if snapshot_error:
            issues.append(
                {
                    "code": "snapshot_load_failed",
                    "severity": "error",
                    "message": f"快照文件读取失败：{snapshot_error}",
                    "count": 1,
                    "samples": [],
                }
            )
        if invalid_snapshot_links:
            issues.append(
                {
                    "code": "snapshot_invalid_links",
                    "severity": "error",
                    "message": "快照中存在指向不存在节点的关系，需要重建快照。",
                    "count": len(invalid_snapshot_links),
                    "samples": invalid_snapshot_links[:safe_limit],
                }
            )
        if snapshot and (
            len(snapshot_nodes) != graph.number_of_nodes()
            or len(snapshot_links) != graph.number_of_edges()
        ):
            issues.append(
                {
                    "code": "snapshot_db_mismatch",
                    "severity": "warning",
                    "message": "快照与数据库图谱表不一致，建议重建快照。",
                    "count": 1,
                    "samples": [
                        {
                            "snapshot_nodes": len(snapshot_nodes),
                            "db_graph_nodes": graph.number_of_nodes(),
                            "snapshot_links": len(snapshot_links),
                            "db_graph_links": graph.number_of_edges(),
                        }
                    ],
                }
            )
        if not snapshot:
            issues.append(
                {
                    "code": "snapshot_missing",
                    "severity": "warning",
                    "message": "当前没有可用快照，查询和前端展示可能为空或落后。",
                    "count": 1,
                    "samples": [],
                }
            )

        suspect_article_ids = list(
            dict.fromkeys(
                [
                    *hash_mismatch_ids,
                    *unsynced_article_ids,
                    *keyword_article_ids,
                ]
            )
        )[:safe_limit]
        recommendations: List[str] = []
        issue_codes = {issue["code"] for issue in issues}
        if issue_codes & {"dangling_edges", "orphan_nodes", "states_without_articles"}:
            recommendations.append("先执行结构清理，删除悬空边、孤立节点和无原文状态。")
        if issue_codes & {"snapshot_load_failed", "snapshot_invalid_links", "snapshot_db_mismatch", "snapshot_missing"}:
            recommendations.append("重建图谱快照即可让前端和问答读取到数据库中的最新图谱。")
        if suspect_article_ids:
            recommendations.append("仅对 suspect_article_ids 做增量重同步，无需全量重建。")
        if not recommendations:
            recommendations.append("未发现需要修复的结构问题。")

        return {
            "healthy": not any(issue["severity"] == "error" for issue in issues),
            "checked_at": checked_at,
            "db_counts": db_counts,
            "snapshot_counts": snapshot_counts,
            "issues": issues,
            "suspect_article_ids": suspect_article_ids,
            "keyword_article_ids": keyword_article_ids,
            "recommendations": recommendations,
        }

    def repair_integrity(
        self,
        *,
        dry_run: bool = True,
        cleanup_orphans: bool = True,
        rebuild_snapshot: bool = True,
        resync_suspects: bool = False,
        keyword: Optional[str] = None,
        limit: int = 100,
        sync_mode: Optional[str] = None,
    ) -> Dict[str, Any]:
        safe_limit = max(1, min(int(limit or 100), 500))
        before = self.diagnose_integrity(keyword=keyword, limit=safe_limit)
        actions: List[str] = []
        deleted_dangling_edges = 0
        deleted_orphan_nodes = 0
        deleted_missing_article_states = 0
        resync_result: Optional[Dict[str, Any]] = None
        resynced_article_ids: List[int] = []

        if cleanup_orphans:
            actions.append("清理悬空边、孤立节点和无原文状态")
        if rebuild_snapshot:
            actions.append("从数据库重建图谱快照")
        if resync_suspects and before["suspect_article_ids"]:
            actions.append(f"增量重同步 {min(len(before['suspect_article_ids']), safe_limit)} 篇可疑文章")

        if dry_run:
            return {
                "dry_run": True,
                "repaired": False,
                "actions": actions,
                "deleted_dangling_edges": 0,
                "deleted_orphan_nodes": 0,
                "deleted_missing_article_states": 0,
                "resynced_article_ids": [],
                "resync_result": None,
                "before": before,
                "after": None,
            }

        t_repair_start = time.perf_counter()
        logger.info(
            "[repair] starting: cleanup_orphans=%s rebuild_snapshot=%s resync_suspects=%s",
            cleanup_orphans, rebuild_snapshot, resync_suspects,
        )
        try:
            if cleanup_orphans:
                t0 = time.perf_counter()
                source_node = aliased(KnowledgeGraphNode)
                target_node = aliased(KnowledgeGraphNode)
                dangling_ids = [
                    row[0]
                    for row in self.db.query(KnowledgeGraphEdge.id)
                    .outerjoin(source_node, KnowledgeGraphEdge.source_node_id == source_node.id)
                    .outerjoin(target_node, KnowledgeGraphEdge.target_node_id == target_node.id)
                    .filter(or_(source_node.id.is_(None), target_node.id.is_(None)))
                    .all()
                ]
                logger.info("[repair] found %d dangling edges (%.2fs)", len(dangling_ids), time.perf_counter() - t0)
                if dangling_ids:
                    for index in range(0, len(dangling_ids), 500):
                        deleted_dangling_edges += int(
                            self.db.query(KnowledgeGraphEdge)
                            .filter(KnowledgeGraphEdge.id.in_(dangling_ids[index : index + 500]))
                            .delete(synchronize_session=False)
                        )
                    logger.info("[repair] deleted %d dangling edges", deleted_dangling_edges)

                t0 = time.perf_counter()
                missing_article_state_ids = [
                    row[0]
                    for row in self.db.query(KnowledgeGraphArticleState.article_id)
                    .outerjoin(Article, KnowledgeGraphArticleState.article_id == Article.id)
                    .filter(Article.id.is_(None))
                    .all()
                ]
                if missing_article_state_ids:
                    for index in range(0, len(missing_article_state_ids), 500):
                        deleted_missing_article_states += int(
                            self.db.query(KnowledgeGraphArticleState)
                            .filter(
                                KnowledgeGraphArticleState.article_id.in_(
                                    missing_article_state_ids[index : index + 500]
                                )
                            )
                            .delete(synchronize_session=False)
                        )
                    logger.info("[repair] deleted %d stale article states (%.2fs)", deleted_missing_article_states, time.perf_counter() - t0)

                before_orphan_count = next(
                    (issue["count"] for issue in before["issues"] if issue["code"] == "orphan_nodes"),
                    0,
                )
                t0 = time.perf_counter()
                self._cleanup_orphan_nodes()
                deleted_orphan_nodes = int(before_orphan_count)
                self.db.commit()
                logger.info("[repair] orphan cleanup done: ~%d nodes removed (%.2fs)", deleted_orphan_nodes, time.perf_counter() - t0)

            if resync_suspects and before["suspect_article_ids"]:
                resynced_article_ids = [int(item) for item in before["suspect_article_ids"][:safe_limit]]
                logger.info("[repair] starting resync of %d suspect articles", len(resynced_article_ids))
                resync_result = self.sync_articles(
                    article_ids=resynced_article_ids,
                    force_rebuild=False,
                    sync_mode=sync_mode,
                    max_articles=safe_limit,
                    trigger_source="integrity_repair",
                )
            elif rebuild_snapshot:
                # Load snapshot from disk into memory cache so _generate_snapshot_payload
                # can reuse previous layout positions instead of recomputing from scratch.
                if self._snapshot_cache is None and self.snapshot_path.exists():
                    try:
                        self._snapshot_cache = json.loads(
                            self.snapshot_path.read_text(encoding="utf-8")
                        )
                        cached_nodes = len(self._snapshot_cache.get("nodes", []))
                        logger.info(
                            "[repair] loaded snapshot from disk for incremental caching (%d nodes)",
                            cached_nodes,
                        )
                    except Exception as _exc:
                        logger.warning("[repair] could not load snapshot from disk: %s", _exc)

                # Reuse the graph already built by diagnose_integrity (_get_graph) when possible
                # to avoid a second full DB round-trip.
                cached_graph = self._graph
                if cached_graph is not None:
                    logger.info(
                        "[repair] reusing in-memory graph (%d nodes, %d edges) — skipping second DB load",
                        cached_graph.number_of_nodes(), cached_graph.number_of_edges(),
                    )
                else:
                    logger.info("[repair] no in-memory graph; rebuild_snapshot will load from DB")

                logger.info("[repair] rebuilding snapshot (no resync)")
                self.rebuild_snapshot(graph=cached_graph)
                self.db.commit()

            t0 = time.perf_counter()
            after = self.diagnose_integrity(keyword=keyword, limit=safe_limit)
            logger.info("[repair] post-repair diagnosis done (%.2fs)", time.perf_counter() - t0)
            logger.info("[repair] total elapsed %.2fs", time.perf_counter() - t_repair_start)
            return {
                "dry_run": False,
                "repaired": True,
                "actions": actions,
                "deleted_dangling_edges": deleted_dangling_edges,
                "deleted_orphan_nodes": deleted_orphan_nodes,
                "deleted_missing_article_states": deleted_missing_article_states,
                "resynced_article_ids": resynced_article_ids,
                "resync_result": resync_result,
                "before": before,
                "after": after,
            }
        except Exception:
            self.db.rollback()
            raise

    def get_snapshot_view(
        self,
        *,
        node_type: Optional[str] = None,
        query: Optional[str] = None,
        limit_nodes: int = 80,
        focus_node_keys: Optional[Sequence[str]] = None,
        expand_depth: int = 0,
    ) -> Dict[str, Any]:
        snapshot = self._load_snapshot()
        all_nodes = list(snapshot.get("nodes", []))
        all_links = list(snapshot.get("links", []))
        node_map = {
            item["node_key"]: item
            for item in all_nodes
            if item.get("node_key")
        }
        normalized_query = self._normalize_text(query or "")
        safe_limit = max(10, min(limit_nodes, 500))
        safe_expand_depth = max(0, min(int(expand_depth or 0), 2))
        requested_focus_keys: List[str] = []
        for node_key in focus_node_keys or []:
            if node_key in node_map and node_key not in requested_focus_keys:
                requested_focus_keys.append(node_key)

        filtered_nodes = []
        for item in all_nodes:
            if node_type and item.get("node_type") != node_type:
                continue
            if normalized_query and not self._snapshot_node_matches_query(item, normalized_query):
                continue
            filtered_nodes.append(item)

        ordered_nodes = sorted(
            filtered_nodes if filtered_nodes else all_nodes,
            key=lambda item: (-int(item.get("degree", 0)), item.get("label", "")),
        )

        selected_keys: List[str] = []
        selected_set: Set[str] = set()

        def add_selected_key(node_key: Optional[str]) -> None:
            if not node_key or node_key in selected_set or node_key not in node_map:
                return
            selected_keys.append(node_key)
            selected_set.add(node_key)

        for node_key in requested_focus_keys:
            add_selected_key(node_key)

        if requested_focus_keys and safe_expand_depth > 0:
            graph = self._get_graph()
            visited = set(requested_focus_keys)
            queue: Deque[Tuple[str, int]] = deque(
                (node_key, 0)
                for node_key in requested_focus_keys
                if graph.has_node(node_key)
            )
            while queue and len(selected_keys) < safe_limit:
                node_key, depth = queue.popleft()
                add_selected_key(node_key)
                if depth >= safe_expand_depth:
                    continue
                ordered_neighbors = sorted(
                    graph.neighbors(node_key),
                    key=lambda neighbor_key: (
                        -int(node_map.get(neighbor_key, {}).get("degree", 0)),
                        node_map.get(neighbor_key, {}).get("label", ""),
                    ),
                )
                for neighbor_key in ordered_neighbors:
                    if neighbor_key in visited or neighbor_key not in node_map:
                        continue
                    visited.add(neighbor_key)
                    queue.append((neighbor_key, depth + 1))
                    add_selected_key(neighbor_key)
                    if len(selected_keys) >= safe_limit:
                        break

        should_add_ranked_nodes = not requested_focus_keys or any(
            value is not None and value != ""
            for value in (node_type, normalized_query)
        )

        if should_add_ranked_nodes:
            for item in ordered_nodes:
                add_selected_key(item["node_key"])
                if len(selected_keys) >= safe_limit:
                    break

        if filtered_nodes and len(selected_keys) < safe_limit:
            for link in all_links:
                source = link.get("source")
                target = link.get("target")
                if source in selected_set and target not in selected_set:
                    add_selected_key(target)
                elif target in selected_set and source not in selected_set:
                    add_selected_key(source)
                if len(selected_keys) >= safe_limit:
                    break

        selected_nodes = [item for item in all_nodes if item.get("node_key") in selected_set]
        selected_nodes.sort(key=lambda item: (-int(item.get("degree", 0)), item.get("label", "")))

        selected_links = [
            item
            for item in all_links
            if item.get("source") in selected_set and item.get("target") in selected_set
        ]
        selected_links.sort(
            key=lambda item: (
                -float(item.get("weight", 0.0)),
                item.get("source", ""),
                item.get("target", ""),
            )
        )

        available_node_types = sorted(
            {
                str(item.get("node_type"))
                for item in all_nodes
                if item.get("node_type")
            }
        )

        return {
            "generated_at": self._parse_datetime(snapshot.get("generated_at")),
            "build": snapshot.get("build"),
            "nodes": selected_nodes,
            "links": selected_links,
            "total_nodes": len(selected_nodes),
            "total_links": len(selected_links),
            "available_node_types": available_node_types,
            "layout_mode": snapshot.get("layout_mode"),
        }

    def search_nodes(
        self,
        *,
        query: Optional[str] = None,
        node_type: Optional[str] = None,
        limit: int = 25,
    ) -> List[Dict[str, Any]]:
        snapshot = self._load_snapshot()
        items = snapshot.get("nodes", [])
        filtered: List[Dict[str, Any]] = []
        normalized_query = self._normalize_text(query or "")
        for item in items:
            if node_type and item.get("node_type") != node_type:
                continue
            if normalized_query:
                haystacks = [
                    self._normalize_text(item.get("label", "")),
                    self._normalize_text(" ".join(item.get("aliases", []) or [])),
                    self._normalize_text(item.get("node_key", "")),
                ]
                if not any(normalized_query in hay for hay in haystacks):
                    continue
            filtered.append(item)

        filtered.sort(key=lambda item: (-int(item.get("degree", 0)), item.get("label", "")))
        return filtered[: max(1, min(limit, 200))]

    def rebuild_snapshot(
        self,
        *,
        build_id: Optional[str] = None,
        graph: Optional["nx.Graph"] = None,
    ) -> Dict[str, Any]:
        t_total = time.perf_counter()
        logger.info("[snapshot] rebuild_snapshot started")

        if graph is not None:
            logger.info(
                "[snapshot] reusing pre-built graph: %d nodes, %d edges",
                graph.number_of_nodes(), graph.number_of_edges(),
            )
        else:
            t0 = time.perf_counter()
            graph = self._build_networkx_graph()
            logger.info(
                "[snapshot] graph loaded: %d nodes, %d edges (%.2fs)",
                graph.number_of_nodes(), graph.number_of_edges(), time.perf_counter() - t0,
            )

        t0 = time.perf_counter()
        snapshot = jsonable_encoder(self._generate_snapshot_payload(graph, build_id=build_id))
        logger.info("[snapshot] payload generated (%.2fs)", time.perf_counter() - t0)

        t0 = time.perf_counter()
        self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        self.snapshot_path.write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self.report_path.write_text(
            self._render_report(snapshot),
            encoding="utf-8",
        )
        logger.info("[snapshot] written to disk (%.2fs)", time.perf_counter() - t0)

        self._graph = graph
        self._snapshot_cache = snapshot
        logger.info("[snapshot] rebuild_snapshot finished — total %.2fs", time.perf_counter() - t_total)
        return snapshot

    def get_node_detail(self, node_key: str) -> Dict[str, Any]:
        snapshot = self._load_snapshot()
        node_map = {item["node_key"]: item for item in snapshot.get("nodes", [])}
        if node_key not in node_map:
            raise ValueError("Node not found")

        db_node = (
            self.db.query(KnowledgeGraphNode)
            .filter(KnowledgeGraphNode.node_key == node_key)
            .first()
        )
        if not db_node:
            raise ValueError("Node not found")

        db_edges = (
            self.db.query(KnowledgeGraphEdge)
            .filter(
                or_(
                    KnowledgeGraphEdge.source_node_id == db_node.id,
                    KnowledgeGraphEdge.target_node_id == db_node.id,
                )
            )
            .all()
        )
        neighbor_ids = {
            edge.target_node_id if edge.source_node_id == db_node.id else edge.source_node_id
            for edge in db_edges
        }
        neighbor_nodes = (
            self.db.query(KnowledgeGraphNode)
            .filter(KnowledgeGraphNode.id.in_(neighbor_ids))
            .all()
            if neighbor_ids
            else []
        )
        node_key_by_id = {
            db_node.id: db_node.node_key,
            **{node.id: node.node_key for node in neighbor_nodes},
        }
        node_label_by_id = {
            db_node.id: db_node.label,
            **{node.id: node.label for node in neighbor_nodes},
        }

        neighbor_keys = [node.node_key for node in neighbor_nodes]
        neighbors = [node_map[key] for key in neighbor_keys if key in node_map]
        neighbors.sort(key=lambda item: (-int(item.get("degree", 0)), item.get("label", "")))

        edges = []
        article_scores: Counter[int] = Counter()
        if db_node.node_type == "article":
            article_id = (db_node.metadata_json or {}).get("article_id")
            if article_id:
                article_scores[int(article_id)] += 3

        seen_article_edges: Set[Tuple[int, int]] = set()
        for edge in db_edges:
            source_node_key = node_key_by_id.get(edge.source_node_id)
            target_node_key = node_key_by_id.get(edge.target_node_id)
            if not source_node_key or not target_node_key:
                continue
            edges.append(
                {
                    "source_node_key": source_node_key,
                    "target_node_key": target_node_key,
                    "relation_type": edge.relation_type,
                    "confidence": edge.confidence,
                    "confidence_score": float(edge.confidence_score or 0.0),
                    "weight": float(edge.weight or 1.0),
                    "source_article_id": edge.source_article_id,
                    "source_label": node_label_by_id.get(edge.source_node_id),
                    "target_label": node_label_by_id.get(edge.target_node_id),
                    "evidence_snippet": edge.evidence_snippet,
                    "metadata": edge.metadata_json or {},
                }
            )
            if edge.source_article_id:
                neighbor_id = (
                    edge.target_node_id
                    if edge.source_node_id == db_node.id
                    else edge.source_node_id
                )
                article_edge_key = (neighbor_id, int(edge.source_article_id))
                if article_edge_key not in seen_article_edges:
                    seen_article_edges.add(article_edge_key)
                    article_scores[int(edge.source_article_id)] += 1

        related_articles = []
        for article_id, relation_count in article_scores.most_common(30):
            serialized = self._serialize_article_reference(
                article_id,
                relation_count=relation_count,
            )
            if serialized:
                related_articles.append(serialized)
            if len(related_articles) >= 10:
                break

        return {
            "node": node_map[node_key],
            "neighbors": neighbors[:20],
            "edges": edges[:50],
            "related_articles": related_articles,
        }

    def find_path(self, source_node_key: str, target_node_key: str) -> Dict[str, Any]:
        graph = self._get_graph()
        snapshot = self._load_snapshot()
        node_map = {item["node_key"]: item for item in snapshot.get("nodes", [])}

        if source_node_key not in node_map or target_node_key not in node_map:
            return {
                "found": False,
                "source_node_key": source_node_key,
                "target_node_key": target_node_key,
                "message": "One or both nodes do not exist",
                "nodes": [],
                "edges": [],
                "distance": None,
            }

        try:
            path_nodes = nx.shortest_path(graph, source_node_key, target_node_key)
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return {
                "found": False,
                "source_node_key": source_node_key,
                "target_node_key": target_node_key,
                "message": "No path found between the selected nodes",
                "nodes": [],
                "edges": [],
                "distance": None,
            }

        edges: List[Dict[str, Any]] = []
        for start, end in zip(path_nodes[:-1], path_nodes[1:]):
            edge_data = graph.get_edge_data(start, end) or {}
            relation = (edge_data.get("relations") or [{}])[0]
            edges.append(
                {
                    "source_node_key": relation.get("source_node_key", start),
                    "target_node_key": relation.get("target_node_key", end),
                    "relation_type": relation.get("relation_type", "related_to"),
                    "confidence": relation.get("confidence", "EXTRACTED"),
                    "confidence_score": relation.get("confidence_score", 1.0),
                    "weight": relation.get("weight", 1.0),
                    "source_article_id": relation.get("source_article_id"),
                    "evidence_snippet": relation.get("evidence_snippet"),
                    "metadata": relation.get("metadata"),
                }
            )

        return {
            "found": True,
            "source_node_key": source_node_key,
            "target_node_key": target_node_key,
            "distance": len(path_nodes) - 1,
            "nodes": [node_map[node_key] for node_key in path_nodes if node_key in node_map],
            "edges": edges,
            "message": None,
        }

    def get_article_context(self, article_id: int) -> Dict[str, Any]:
        article = self.db.query(Article).filter(Article.id == article_id).first()
        if not article:
            return {
                "article_id": article_id,
                "article": None,
                "nodes": [],
                "edges": [],
                "related_articles": [],
            }

        snapshot = self._load_snapshot()
        node_map = {item["node_key"]: item for item in snapshot.get("nodes", [])}
        source_node = aliased(KnowledgeGraphNode)
        target_node = aliased(KnowledgeGraphNode)
        edge_rows = (
            self.db.query(KnowledgeGraphEdge, source_node, target_node)
            .join(source_node, KnowledgeGraphEdge.source_node_id == source_node.id)
            .join(target_node, KnowledgeGraphEdge.target_node_id == target_node.id)
            .filter(KnowledgeGraphEdge.source_article_id == article_id)
            .all()
        )

        node_keys: Set[str] = set()
        edges: List[Dict[str, Any]] = []
        for edge, source_row, target_row in edge_rows:
            node_keys.add(source_row.node_key)
            node_keys.add(target_row.node_key)
            edges.append(
                {
                    "source_node_key": source_row.node_key,
                    "target_node_key": target_row.node_key,
                    "relation_type": edge.relation_type,
                    "confidence": edge.confidence,
                    "confidence_score": float(edge.confidence_score or 0.0),
                    "weight": float(edge.weight or 1.0),
                    "source_article_id": edge.source_article_id,
                    "source_label": source_row.label,
                    "target_label": target_row.label,
                    "evidence_snippet": edge.evidence_snippet,
                    "metadata": edge.metadata_json or {},
                }
            )

        nodes = [node_map[key] for key in node_keys if key in node_map]
        nodes.sort(key=lambda item: (-int(item.get("degree", 0)), item.get("label", "")))

        related_articles = self._collect_related_articles(node_keys, top_k=8, graph=self._get_graph())
        related_articles = [item for item in related_articles if item["id"] != article_id]

        return {
            "article_id": article_id,
            "article": self._serialize_article_reference(article_id, relation_count=max(len(edges), 1)),
            "nodes": nodes[:20],
            "edges": edges[:30],
            "related_articles": related_articles[:8],
        }

    def answer_question(
        self,
        question: str,
        *,
        mode: str = "graph",
        top_k: int = 5,
        query_depth: Optional[int] = None,
        conversation_history: Optional[Sequence[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        requested_mode = self._normalize_query_mode(mode)
        resolved_mode = self._resolve_query_mode(requested_mode)

        structured_result = self.structured_query(question, top_k=top_k)
        if structured_result.get("results"):
            matched_nodes = [item["node"] for item in structured_result["results"]]
            related_articles = self._merge_articles(
                structured_result.get("related_articles", []),
                self._rag_search(question, top_k=top_k) if resolved_mode in {"rag", "hybrid"} else [],
            )
            graph_context = {
                "matched_nodes": matched_nodes,
                "related_articles": related_articles,
                "context_node_count": len(matched_nodes),
                "context_edge_count": sum(len(item.get("matched_edges", [])) for item in structured_result["results"]),
                "subgraph_nodes": matched_nodes,
                "subgraph_edges": [
                    f"{edge.get('source_label') or edge['source_node_key']} -[{edge['relation_type']}]-> {edge.get('target_label') or edge['target_node_key']}"
                    for item in structured_result["results"]
                    for edge in item.get("matched_edges", [])
                ],
            }
            answer = structured_result.get("answer") or self._generate_answer(
                question=question,
                resolved_mode=resolved_mode,
                graph_context=graph_context,
                related_articles=related_articles,
                conversation_history=conversation_history,
            )
            return {
                "question": question,
                "mode": requested_mode,
                "resolved_mode": resolved_mode,
                "query_strategy": "structured",
                "answer": answer,
                "matched_nodes": matched_nodes,
                "related_articles": related_articles,
                "context_node_count": graph_context["context_node_count"],
                "context_edge_count": graph_context["context_edge_count"],
            }

        graph_context = self._build_generic_graph_context(
            question,
            query_depth=query_depth or settings.KNOWLEDGE_GRAPH_QUERY_DEPTH,
            top_k=top_k,
        )

        related_articles = list(graph_context["related_articles"])
        if resolved_mode in {"rag", "hybrid"}:
            related_articles = self._merge_articles(
                related_articles,
                self._rag_search(question, top_k=top_k),
            )

        answer = self._generate_answer(
            question=question,
            resolved_mode=resolved_mode,
            graph_context=graph_context,
            related_articles=related_articles,
            conversation_history=conversation_history,
        )

        return {
            "question": question,
            "mode": requested_mode,
            "resolved_mode": resolved_mode,
            "query_strategy": "generic_graph",
            "answer": answer,
            "matched_nodes": graph_context["matched_nodes"],
            "related_articles": related_articles,
            "context_node_count": graph_context["context_node_count"],
            "context_edge_count": graph_context["context_edge_count"],
        }

    def stream_answer(
        self,
        question: str,
        *,
        mode: str = "graph",
        top_k: int = 5,
        query_depth: Optional[int] = None,
        conversation_history: Optional[Sequence[Dict[str, str]]] = None,
    ):
        requested_mode = self._normalize_query_mode(mode)
        resolved_mode = self._resolve_query_mode(requested_mode)

        structured_result = self.structured_query(question, top_k=top_k)
        if structured_result.get("results"):
            query_strategy = "structured"
            matched_nodes = [item["node"] for item in structured_result["results"]]
            related_articles = self._merge_articles(
                structured_result.get("related_articles", []),
                self._rag_search(question, top_k=top_k) if resolved_mode in {"rag", "hybrid"} else [],
            )
            graph_context = {
                "matched_nodes": matched_nodes,
                "related_articles": related_articles,
                "context_node_count": len(matched_nodes),
                "context_edge_count": sum(len(item.get("matched_edges", [])) for item in structured_result["results"]),
                "subgraph_nodes": matched_nodes,
                "subgraph_edges": [
                    f"{edge.get('source_label') or edge['source_node_key']} -[{edge['relation_type']}]-> {edge.get('target_label') or edge['target_node_key']}"
                    for item in structured_result["results"]
                    for edge in item.get("matched_edges", [])
                ],
            }
        else:
            query_strategy = "generic_graph"
            graph_context = self._build_generic_graph_context(
                question,
                query_depth=query_depth or settings.KNOWLEDGE_GRAPH_QUERY_DEPTH,
                top_k=top_k,
            )
            related_articles = list(graph_context["related_articles"])
            if resolved_mode in {"rag", "hybrid"}:
                related_articles = self._merge_articles(
                    related_articles,
                    self._rag_search(question, top_k=top_k),
                )

        yield {
            "type": "graph_context",
            "data": {
                "mode": requested_mode,
                "resolved_mode": resolved_mode,
                "query_strategy": query_strategy,
                "matched_nodes": graph_context["matched_nodes"],
                "related_articles": related_articles,
                "context_node_count": graph_context["context_node_count"],
                "context_edge_count": graph_context["context_edge_count"],
            },
        }

        if not self.ai_analyzer:
            yield {
                "type": "content",
                "data": {
                    "content": self._build_generic_graph_fallback_answer(
                        question=question,
                        resolved_mode=resolved_mode,
                        graph_context=graph_context,
                        related_articles=related_articles,
                    )
                },
            }
            yield {"type": "done", "data": {}}
            return

        messages = self._build_query_messages(
            question=question,
            resolved_mode=resolved_mode,
            graph_context=graph_context,
            related_articles=related_articles,
            conversation_history=conversation_history,
        )
        try:
            stream = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=messages,
                temperature=0.2,
                max_tokens=1800,
                stream=True,
            )
            for chunk in stream:
                if chunk.choices and chunk.choices[0].delta.content:
                    yield {
                        "type": "content",
                        "data": {"content": chunk.choices[0].delta.content},
                    }
            yield {"type": "done", "data": {}}
        except Exception as exc:
            logger.error("Knowledge graph streaming answer failed: %s", exc, exc_info=True)
            yield {
                "type": "error",
                "data": {"message": f"Knowledge graph streaming failed: {exc}"},
            }

    def structured_query(self, question: str, *, top_k: int = 10) -> Dict[str, Any]:
        parsed_query = self._extract_structured_graph_query(question)
        if not parsed_query.get("conditions"):
            return {
                "question": question,
                "parsed_query": parsed_query,
                "results": [],
                "related_articles": [],
                "answer": "",
            }

        results = self._execute_structured_graph_query(parsed_query, limit=max(1, min(top_k, 20)))
        related_articles = self._merge_articles(
            [],
            [article for item in results for article in item.get("related_articles", [])],
        )
        answer = self._build_structured_query_answer(question, parsed_query, results)
        return {
            "question": question,
            "parsed_query": parsed_query,
            "results": results,
            "related_articles": related_articles[:top_k],
            "answer": answer,
        }

    def _select_articles_for_sync(
        self,
        *,
        article_ids: Optional[Sequence[int]],
        run_mode: str,
        force_rebuild: bool,
        max_articles: Optional[int],
    ) -> List[Article]:
        query = self.db.query(Article).order_by(Article.updated_at.desc(), Article.id.desc())
        if article_ids:
            rows = query.filter(Article.id.in_(list(article_ids))).all()
            wanted = {int(item) for item in article_ids}
            rows.sort(key=lambda article: (article.id not in wanted, article.id))
            return rows

        rows = query.all()
        if force_rebuild:
            return rows[: self._resolve_sync_limit(max_articles)]

        selected: List[Article] = []
        for article in rows:
            article_hash = self._compute_article_hash(article)
            if self._needs_sync(article, article_hash, run_mode):
                selected.append(article)
            if len(selected) >= self._resolve_sync_limit(max_articles):
                break
        return selected

    def _resolve_sync_limit(self, max_articles: Optional[int]) -> int:
        configured = int(settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC or 100)
        value = int(max_articles or configured)
        return max(1, min(value, 1000))

    def _needs_sync(self, article: Article, content_hash: str, run_mode: str) -> bool:
        state = self.db.query(KnowledgeGraphArticleState).filter(
            KnowledgeGraphArticleState.article_id == article.id
        ).first()
        if not state:
            return True
        return (
            state.content_hash != content_hash
            or state.status != "synced"
            or state.sync_mode != run_mode
        )

    def _sync_single_article(self, article: Article, content_hash: str, run_mode: str) -> Dict[str, int]:
        semantic_nodes, semantic_edges = self._extract_semantic_structure(article)
        nodes_by_key: Dict[str, NodeSpec] = {}
        for spec in semantic_nodes:
            self._merge_node_spec(nodes_by_key, spec)

        edges = self._deduplicate_edges(semantic_edges, article_id=article.id)
        self._replace_article_edges(article.id)
        node_id_map = self._upsert_nodes(list(nodes_by_key.values()))
        edges_upserted = self._insert_edges(edges, node_id_map=node_id_map)
        self._mark_article_state_synced(article.id, content_hash, run_mode)
        self._graph = None
        self._snapshot_cache = None
        return {
            "nodes_upserted": len(nodes_by_key),
            "edges_upserted": edges_upserted,
        }

    def _extract_semantic_structure(
        self,
        article: Article,
    ) -> Tuple[List[NodeSpec], List[EdgeSpec]]:
        if not self.ai_analyzer:
            raise ValueError("Strict ontology extraction requires a configured knowledge-graph AI provider")

        prompt = self._build_semantic_prompt(article)
        try:
            response = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You extract structured entities and relations from AI news articles. "
                            "Return JSON only."
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=1600,
            )
            payload = self._parse_json_block(
                self._extract_chat_message_content(response, operation="semantic extraction") or "{}"
            )
        except Exception as exc:
            logger.warning("Knowledge graph semantic extraction failed for article %s: %s", article.id, exc)
            return [], []

        nodes: List[NodeSpec] = []
        edges: List[EdgeSpec] = []
        entity_index: Dict[Tuple[str, str], NodeSpec] = {}
        for entity in payload.get("entities", []) or []:
            mention_name = str(entity.get("id") or entity.get("canonical_name") or entity.get("label") or "").strip()
            canonical_name = self._canonicalize_entity_name(
                str(entity.get("canonical_name") or mention_name).strip(),
                self._normalize_domain_node_type(entity.get("label") or entity.get("node_type")),
            )
            if not canonical_name:
                continue
            node_type = self._normalize_domain_node_type(entity.get("label") or entity.get("node_type"))
            aliases = self._merge_aliases(
                [],
                [mention_name, *self._coerce_string_list(entity.get("aliases"))],
                canonical_name,
            )
            metadata = {
                "origin": "semantic",
                "canonical_name": canonical_name,
                "description": str(entity.get("description") or "").strip()[:1000] or None,
                **(entity.get("properties") or {}),
            }
            node = self._build_entity_node(
                node_type,
                canonical_name,
                aliases=aliases,
                metadata={k: v for k, v in metadata.items() if v is not None},
            )
            nodes.append(node)
            entity_index[(node_type, self._normalize_text(canonical_name))] = node
            if mention_name:
                entity_index[(node_type, self._normalize_text(mention_name))] = node
            for alias in aliases:
                entity_index[(node_type, self._normalize_text(alias))] = node

        relations = payload.get("relationships", []) or payload.get("relations", []) or []
        for relation in relations:
            source_label = str(relation.get("source") or relation.get("source_label") or "").strip()
            target_label = str(relation.get("target") or relation.get("target_label") or "").strip()
            relation_type = self._normalize_domain_relation_type(relation.get("type") or relation.get("relation_type"))
            if not source_label or not target_label or not relation_type:
                continue

            source_type = self._normalize_domain_node_type(relation.get("source_label") or relation.get("source_type"))
            target_type = self._normalize_domain_node_type(relation.get("target_label") or relation.get("target_type"))
            source_node = entity_index.get((source_type, self._normalize_text(source_label))) or self._build_entity_node(
                source_type,
                self._canonicalize_entity_name(source_label, source_type),
                aliases=self._merge_aliases([], [source_label], self._canonicalize_entity_name(source_label, source_type)),
                metadata={"origin": "semantic", "canonical_name": self._canonicalize_entity_name(source_label, source_type)},
            )
            target_node = entity_index.get((target_type, self._normalize_text(target_label))) or self._build_entity_node(
                target_type,
                self._canonicalize_entity_name(target_label, target_type),
                aliases=self._merge_aliases([], [target_label], self._canonicalize_entity_name(target_label, target_type)),
                metadata={"origin": "semantic", "canonical_name": self._canonicalize_entity_name(target_label, target_type)},
            )
            nodes.extend([source_node, target_node])
            confidence = str(relation.get("confidence") or "EXTRACTED").upper()
            if confidence not in {"EXTRACTED", "INFERRED", "AMBIGUOUS"}:
                confidence = "EXTRACTED"
            confidence_score = float(relation.get("confidence_score") or 0.75)
            if confidence_score < 0.6:
                continue

            edges.append(
                self._build_edge_spec(
                    source_node_key=source_node["node_key"],
                    target_node_key=target_node["node_key"],
                    relation_type=relation_type,
                    article_id=article.id,
                    confidence=confidence,
                    confidence_score=confidence_score,
                    evidence_snippet=str(relation.get("evidence_snippet") or "")[:500] or None,
                    metadata={"origin": "semantic"},
                )
            )

        return nodes, edges

    def _build_entity_node(
        self,
        node_type: str,
        label: str,
        *,
        aliases: Optional[Sequence[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> NodeSpec:
        safe_type = self._normalize_node_type(node_type)
        safe_label = label.strip()[:500]
        safe_metadata = dict(metadata or {})
        canonical_name = self._canonicalize_entity_name(
            str(safe_metadata.get("canonical_name") or safe_label),
            safe_type,
        )
        safe_metadata["canonical_name"] = canonical_name
        merged_aliases = self._merge_aliases(
            [],
            aliases or [],
            canonical_name,
        )
        return {
            "node_key": self._make_node_key(safe_type, canonical_name),
            "label": canonical_name[:500],
            "node_type": safe_type,
            "aliases": merged_aliases,
            "metadata": safe_metadata,
        }

    def _build_edge_spec(
        self,
        *,
        source_node_key: str,
        target_node_key: str,
        relation_type: str,
        article_id: int,
        confidence: str,
        confidence_score: float,
        weight: float = 1.0,
        evidence_snippet: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> EdgeSpec:
        return {
            "source_node_key": source_node_key,
            "target_node_key": target_node_key,
            "relation_type": relation_type.strip()[:100] or "related_to",
            "confidence": confidence,
            "confidence_score": max(0.0, min(float(confidence_score), 1.0)),
            "weight": max(float(weight), 0.1),
            "source_article_id": article_id,
            "evidence_snippet": evidence_snippet,
            "metadata": metadata or {},
        }

    def _merge_node_spec(self, node_specs: Dict[str, NodeSpec], new_spec: NodeSpec) -> None:
        existing = node_specs.get(new_spec["node_key"])
        if not existing:
            node_specs[new_spec["node_key"]] = {
                "node_key": new_spec["node_key"],
                "label": new_spec["label"],
                "node_type": new_spec["node_type"],
                "aliases": self._coerce_string_list(new_spec.get("aliases")),
                "metadata": dict(new_spec.get("metadata") or {}),
            }
            return

        existing_metadata = existing.get("metadata") or {}
        new_metadata = new_spec.get("metadata") or {}
        existing["metadata"] = {
            **existing_metadata,
            **new_metadata,
        }
        canonical_name = str(existing["metadata"].get("canonical_name") or existing["label"])
        description = str(existing_metadata.get("description") or "").strip()
        new_description = str(new_metadata.get("description") or "").strip()
        if new_description and (not description or len(new_description) > len(description)):
            existing["metadata"]["description"] = new_description
        existing["aliases"] = self._merge_aliases(
            existing.get("aliases") or [],
            [new_spec.get("label", ""), *self._coerce_string_list(new_spec.get("aliases"))],
            canonical_name,
        )
        existing["label"] = canonical_name

    def _deduplicate_edges(self, edges: Iterable[EdgeSpec], *, article_id: int) -> List[EdgeSpec]:
        grouped: Dict[Tuple[str, str, str], EdgeSpec] = {}
        for edge in edges:
            source_key = edge["source_node_key"]
            target_key = edge["target_node_key"]
            if source_key == target_key:
                continue
            key = (source_key, target_key, edge["relation_type"])
            current = grouped.get(key)
            if not current or edge["confidence_score"] > current["confidence_score"]:
                grouped[key] = {
                    **edge,
                    "source_article_id": article_id,
                }
        return list(grouped.values())

    def _upsert_nodes(self, nodes: Sequence[NodeSpec]) -> Dict[str, int]:
        node_id_map: Dict[str, int] = {}
        for spec in nodes:
            row = self._resolve_existing_entity_node(spec)
            if row:
                merged_metadata = {
                    **(row.metadata_json or {}),
                    **(spec.get("metadata") or {}),
                }
                canonical_name = self._canonicalize_entity_name(
                    str(merged_metadata.get("canonical_name") or spec["label"]),
                    spec["node_type"],
                )
                row.label = canonical_name
                row.node_type = spec["node_type"]
                row.aliases = self._merge_aliases(
                    row.aliases or [],
                    [spec.get("label", ""), *(spec.get("aliases") or [])],
                    canonical_name,
                )
                merged_metadata["canonical_name"] = canonical_name
                row.metadata_json = merged_metadata
                row.updated_at = datetime.now()
            else:
                row = KnowledgeGraphNode(
                    node_key=spec["node_key"],
                    label=spec["label"],
                    node_type=spec["node_type"],
                    aliases=spec.get("aliases") or [],
                    metadata_json=spec.get("metadata") or {},
                )
                self.db.add(row)
                self.db.flush()
            node_id_map[spec["node_key"]] = row.id
            node_id_map[row.node_key] = row.id
        return node_id_map

    def _insert_edges(self, edges: Sequence[EdgeSpec], *, node_id_map: Dict[str, int]) -> int:
        count = 0
        for spec in edges:
            source_id = node_id_map.get(spec["source_node_key"])
            target_id = node_id_map.get(spec["target_node_key"])
            if not source_id or not target_id:
                continue
            row = KnowledgeGraphEdge(
                source_node_id=source_id,
                target_node_id=target_id,
                relation_type=spec["relation_type"],
                confidence=spec["confidence"],
                confidence_score=spec["confidence_score"],
                weight=spec["weight"],
                source_article_id=spec.get("source_article_id"),
                evidence_snippet=spec.get("evidence_snippet"),
                metadata_json=spec.get("metadata") or {},
            )
            self.db.add(row)
            count += 1
        return count

    def _replace_article_edges(self, article_id: int) -> None:
        self.db.query(KnowledgeGraphEdge).filter(
            KnowledgeGraphEdge.source_article_id == article_id
        ).delete(synchronize_session=False)

    def _mark_article_state_synced(self, article_id: int, content_hash: str, run_mode: str) -> None:
        state = self.db.query(KnowledgeGraphArticleState).filter(
            KnowledgeGraphArticleState.article_id == article_id
        ).first()
        if not state:
            state = KnowledgeGraphArticleState(article_id=article_id)
            self.db.add(state)
        state.content_hash = content_hash
        state.status = "synced"
        state.sync_mode = run_mode
        state.last_synced_at = datetime.now()
        state.last_error = None
        state.updated_at = datetime.now()

    def _mark_article_state_error(
        self,
        article_id: int,
        content_hash: Optional[str],
        run_mode: str,
        error_message: str,
    ) -> None:
        state = self.db.query(KnowledgeGraphArticleState).filter(
            KnowledgeGraphArticleState.article_id == article_id
        ).first()
        if not state:
            state = KnowledgeGraphArticleState(article_id=article_id)
            self.db.add(state)
        state.content_hash = content_hash
        state.status = "error"
        state.sync_mode = run_mode
        state.last_error = error_message[:2000]
        state.updated_at = datetime.now()

    def _cleanup_orphan_nodes(self) -> None:
        used_ids = (
            self.db.query(KnowledgeGraphEdge.source_node_id.label("node_id"))
            .union(self.db.query(KnowledgeGraphEdge.target_node_id.label("node_id")))
            .subquery()
        )
        self.db.query(KnowledgeGraphNode).filter(
            ~KnowledgeGraphNode.id.in_(self.db.query(used_ids.c.node_id))
        ).delete(synchronize_session=False)

    def _clear_graph_tables(
        self,
        *,
        keep_build_id: Optional[str] = None,
        clear_build_history: bool = False,
    ) -> None:
        self.db.query(KnowledgeGraphEdge).delete(synchronize_session=False)
        self.db.query(KnowledgeGraphNode).delete(synchronize_session=False)
        self.db.query(KnowledgeGraphArticleState).delete(synchronize_session=False)
        if clear_build_history:
            build_query = self.db.query(KnowledgeGraphBuild)
            if keep_build_id:
                build_query = build_query.filter(KnowledgeGraphBuild.build_id != keep_build_id)
            build_query.delete(synchronize_session=False)
        self.db.commit()
        self._graph = None
        self._snapshot_cache = None

    def _build_networkx_graph(self) -> nx.Graph:
        t0 = time.perf_counter()
        graph = nx.Graph()
        nodes = self.db.query(KnowledgeGraphNode).all()
        logger.info("[graph_build] DB: loaded %d nodes (%.2fs)", len(nodes), time.perf_counter() - t0)

        t0 = time.perf_counter()
        node_lookup = {node.id: node for node in nodes}
        for node in nodes:
            graph.add_node(
                node.node_key,
                node_type=node.node_type,
                label=node.label,
                aliases=node.aliases or [],
                metadata=node.metadata_json or {},
            )
        logger.info("[graph_build] node objects added to graph (%.2fs)", time.perf_counter() - t0)

        t0 = time.perf_counter()
        edges = self.db.query(KnowledgeGraphEdge).all()
        logger.info("[graph_build] DB: loaded %d edges (%.2fs)", len(edges), time.perf_counter() - t0)

        t0 = time.perf_counter()
        skipped = 0
        for edge in edges:
            source = node_lookup.get(edge.source_node_id)
            target = node_lookup.get(edge.target_node_id)
            if not source or not target:
                skipped += 1
                continue
            relation_payload = {
                "source_node_key": source.node_key,
                "target_node_key": target.node_key,
                "relation_type": edge.relation_type,
                "confidence": edge.confidence,
                "confidence_score": float(edge.confidence_score or 0.0),
                "weight": float(edge.weight or 1.0),
                "source_article_id": edge.source_article_id,
                "source_label": source.label,
                "target_label": target.label,
                "evidence_snippet": edge.evidence_snippet,
                "metadata": edge.metadata_json or {},
            }
            if graph.has_edge(source.node_key, target.node_key):
                graph[source.node_key][target.node_key]["relations"].append(relation_payload)
                graph[source.node_key][target.node_key]["weight"] += relation_payload["weight"]
                if edge.source_article_id:
                    graph[source.node_key][target.node_key]["article_ids"].add(edge.source_article_id)
            else:
                graph.add_edge(
                    source.node_key,
                    target.node_key,
                    relations=[relation_payload],
                    weight=relation_payload["weight"],
                    article_ids={edge.source_article_id} if edge.source_article_id else set(),
                )
        logger.info(
            "[graph_build] edge objects added: %d graph-edges from %d DB-edges (skipped=%d, %.2fs)",
            graph.number_of_edges(), len(edges), skipped, time.perf_counter() - t0,
        )

        self._node_lookup = node_lookup
        return graph

    def _get_graph(self) -> nx.Graph:
        if self._graph is None:
            self._graph = self._build_networkx_graph()
        return self._graph

    def _load_snapshot(self) -> Dict[str, Any]:
        if self._snapshot_cache is not None:
            return self._snapshot_cache
        if self.snapshot_path.exists():
            try:
                self._snapshot_cache = json.loads(self.snapshot_path.read_text(encoding="utf-8"))
                return self._snapshot_cache
            except Exception as exc:
                logger.warning("Failed to load knowledge graph snapshot: %s", exc)
        self._snapshot_cache = self.rebuild_snapshot()
        return self._snapshot_cache

    def _read_snapshot_for_integrity(self) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        if not self.snapshot_path.exists():
            return None, None
        try:
            return json.loads(self.snapshot_path.read_text(encoding="utf-8")), None
        except Exception as exc:
            return None, str(exc)

    def _generate_snapshot_payload(self, graph: nx.Graph, *, build_id: Optional[str]) -> Dict[str, Any]:
        t_payload_start = time.perf_counter()
        logger.info(
            "[payload] _generate_snapshot_payload start: %d nodes, %d edges",
            graph.number_of_nodes(), graph.number_of_edges(),
        )

        t0 = time.perf_counter()
        node_type_counts = Counter()
        relation_type_counts = Counter()
        article_ids_per_node: Dict[str, Set[int]] = defaultdict(set)

        for _, _, edge_data in graph.edges(data=True):
            for relation in edge_data.get("relations", []):
                relation_type_counts[relation["relation_type"]] += 1
                article_id = relation.get("source_article_id")
                if article_id:
                    article_ids_per_node[relation["source_node_key"]].add(article_id)
                    article_ids_per_node[relation["target_node_key"]].add(article_id)

        for node_key, attrs in graph.nodes(data=True):
            node_type_counts[attrs.get("node_type", "unknown")] += 1
        logger.info("[payload] edge/node stats pass done (%.2fs)", time.perf_counter() - t0)

        t0 = time.perf_counter()
        centrality = nx.degree_centrality(graph) if graph.number_of_nodes() else {}
        logger.info("[payload] degree_centrality done (%.2fs)", time.perf_counter() - t0)

        # Extract cached layout positions for incremental reuse.
        t0 = time.perf_counter()
        cached_snapshot = self._snapshot_cache
        cached_layout_positions: Optional[Dict[str, Dict[str, float]]] = None
        if cached_snapshot:
            cached_layout_positions = {
                item["node_key"]: {"x": item["layout_x"], "y": item["layout_y"]}
                for item in cached_snapshot.get("nodes", [])
                if item.get("layout_x") is not None and item.get("layout_y") is not None
            }
        logger.info(
            "[payload] cache extracted: layout_positions=%d (%.2fs)",
            len(cached_layout_positions or {}),
            time.perf_counter() - t0,
        )

        t0 = time.perf_counter()
        layout_positions = self._compute_distance_layout(
            graph,
            cached_positions=cached_layout_positions or None,
        )
        logger.info("[payload] _compute_distance_layout done (%.2fs)", time.perf_counter() - t0)

        t0 = time.perf_counter()
        nodes_payload = []
        for node_key, attrs in graph.nodes(data=True):
            layout_position = layout_positions.get(node_key)
            nodes_payload.append(
                {
                    "node_key": node_key,
                    "label": attrs.get("label", node_key),
                    "node_type": attrs.get("node_type", "unknown"),
                    "aliases": attrs.get("aliases", []) or [],
                    "metadata": attrs.get("metadata", {}) or {},
                    "degree": int(graph.degree(node_key)),
                    "article_count": len(article_ids_per_node.get(node_key, set())),
                    "centrality": round(float(centrality.get(node_key, 0.0)), 6),
                    "layout_x": layout_position["x"] if layout_position else None,
                    "layout_y": layout_position["y"] if layout_position else None,
                }
            )
        nodes_payload.sort(key=lambda item: (-item["degree"], item["label"]))
        logger.info("[payload] nodes_payload built (%d nodes, %.2fs)", len(nodes_payload), time.perf_counter() - t0)

        t0 = time.perf_counter()
        links_payload = []
        for source_key, target_key, edge_data in graph.edges(data=True):
            links_payload.append(
                {
                    "source": source_key,
                    "target": target_key,
                    "weight": round(float(edge_data.get("weight", 1.0)), 4),
                    "relation_types": sorted(
                        {relation["relation_type"] for relation in edge_data.get("relations", [])}
                    ),
                    "article_count": len(edge_data.get("article_ids", set())),
                }
            )
        logger.info("[payload] links_payload built (%d links, %.2fs)", len(links_payload), time.perf_counter() - t0)

        t0 = time.perf_counter()
        total_articles = self.db.query(func.count(Article.id)).scalar() or 0
        synced_articles = (
            self.db.query(func.count(KnowledgeGraphArticleState.article_id))
            .filter(KnowledgeGraphArticleState.status == "synced")
            .scalar()
            or 0
        )
        latest_build = None
        if build_id:
            latest_build = (
                self.db.query(KnowledgeGraphBuild)
                .filter(KnowledgeGraphBuild.build_id == build_id)
                .first()
            )
        if not latest_build:
            latest_build = (
                self.db.query(KnowledgeGraphBuild)
                .order_by(KnowledgeGraphBuild.started_at.desc())
                .first()
            )
        logger.info("[payload] DB stats query done (%.2fs)", time.perf_counter() - t0)
        logger.info(
            "[payload] _generate_snapshot_payload finished — total %.2fs",
            time.perf_counter() - t_payload_start,
        )

        return {
            "generated_at": datetime.now().isoformat(),
            "build": self._serialize_build(latest_build) if latest_build else None,
            "stats": {
                "total_nodes": graph.number_of_nodes(),
                "total_edges": graph.number_of_edges(),
                "node_type_counts": dict(node_type_counts),
                "relation_type_counts": dict(relation_type_counts),
                "coverage": round((synced_articles / total_articles) if total_articles else 0.0, 6),
            },
            "nodes": nodes_payload,
            "links": links_payload,
            "layout_mode": "distance_weighted_kamada_kawai",
            "god_nodes": nodes_payload[:10],
            "article_coverage": {
                "total_articles": total_articles,
                "synced_articles": synced_articles,
            },
        }

    def _compute_distance_layout(
        self,
        graph: nx.Graph,
        *,
        cached_positions: Optional[Dict[str, Dict[str, float]]] = None,
    ) -> Dict[str, Dict[str, float]]:
        """Compute stable coordinates where stronger and shorter graph paths stay closer.

        Only processes the top LAYOUT_MAX_NODES nodes by degree to keep runtime bounded.
        If cached_positions covers a node that is still in the top set, its coordinates are
        reused and only genuinely new top-N nodes are computed from scratch.
        Remaining nodes get no layout coordinates and fall back to client-side placement.
        """
        if graph.number_of_nodes() == 0:
            return {}

        t_layout_start = time.perf_counter()
        top_node_keys: Set[str] = set(
            sorted(graph.nodes(), key=lambda k: -graph.degree(k))[:LAYOUT_MAX_NODES]
        )

        # Nodes whose cached position can be kept as-is
        reused: Dict[str, Dict[str, float]] = {}
        if cached_positions:
            for node_key in list(top_node_keys):
                if node_key in cached_positions:
                    reused[node_key] = cached_positions[node_key]

        nodes_to_compute = top_node_keys - set(reused)
        logger.info(
            "[layout] top-%d nodes selected: reused=%d, to_compute=%d",
            LAYOUT_MAX_NODES, len(reused), len(nodes_to_compute),
        )

        if not nodes_to_compute:
            logger.info("[layout] fully cached — skipping layout computation (%.2fs)", time.perf_counter() - t_layout_start)
            return reused

        t0 = time.perf_counter()
        layout_graph = nx.Graph()
        for node_key in sorted(nodes_to_compute):
            layout_graph.add_node(node_key)
        for source_key, target_key, edge_data in graph.edges(data=True):
            if source_key not in nodes_to_compute or target_key not in nodes_to_compute:
                continue
            weight = max(float(edge_data.get("weight", 1.0) or 1.0), 0.01)
            article_count = max(len(edge_data.get("article_ids", set())), 0)
            relation_count = max(len(edge_data.get("relations", [])), 1)
            strength = weight + article_count * 0.5 + math.log1p(relation_count)
            layout_graph.add_edge(
                source_key,
                target_key,
                layout_distance=1.0 / math.sqrt(max(strength, 0.01)),
                layout_strength=strength,
            )
        logger.info(
            "[layout] sub-graph built: %d nodes, %d edges (%.2fs)",
            layout_graph.number_of_nodes(), layout_graph.number_of_edges(), time.perf_counter() - t0,
        )

        components = sorted(
            (sorted(component) for component in nx.connected_components(layout_graph)),
            key=lambda component: (-len(component), component[0] if component else ""),
        )
        if not components:
            return {}

        component_sizes = [math.sqrt(len(component)) for component in components]
        ring_radius = max(0.0, LAYOUT_COMPONENT_GAP * sum(component_sizes) / max(len(components), 1))
        positions: Dict[str, Tuple[float, float]] = {}
        logger.info("[layout] %d connected components to lay out", len(components))

        t_components = time.perf_counter()
        for index, component in enumerate(components):
            subgraph = layout_graph.subgraph(component).copy()
            component_scale = max(1.0, math.sqrt(len(component)))
            t_comp = time.perf_counter()
            if len(component) == 1:
                local_positions = {component[0]: (0.0, 0.0)}
                algo = "trivial"
            else:
                try:
                    local_positions = nx.kamada_kawai_layout(
                        subgraph,
                        weight="layout_distance",
                        scale=component_scale,
                    )
                    algo = "kamada_kawai"
                except Exception as exc:
                    # Most common cause: scipy not installed (kamada_kawai requires it).
                    # Add scipy to requirements.txt to fix this permanently.
                    logger.warning(
                        "[layout] kamada_kawai_layout failed for component %d (%d nodes), falling back to spring_layout: %s",
                        index, len(component), exc,
                    )
                    local_positions = nx.spring_layout(
                        subgraph,
                        weight="layout_strength",
                        seed=42,
                        scale=component_scale,
                    )
                    algo = "spring_fallback"

            if len(components) > 1 and (index % 5 == 0 or index == len(components) - 1):
                logger.info(
                    "[layout] component %d/%d done: %d nodes algo=%s (%.2fs)",
                    index + 1, len(components), len(component), algo, time.perf_counter() - t_comp,
                )

            if len(components) == 1:
                offset_x = 0.0
                offset_y = 0.0
            else:
                angle = (math.pi * 2 * index) / len(components) - math.pi / 2
                offset_x = math.cos(angle) * ring_radius
                offset_y = math.sin(angle) * ring_radius * 0.72

            for node_key, raw_position in local_positions.items():
                x_value, y_value = raw_position
                positions[node_key] = (float(x_value) + offset_x, float(y_value) + offset_y)

        logger.info(
            "[layout] all components done (%.2fs), normalizing %d positions",
            time.perf_counter() - t_components, len(positions),
        )
        new_normalized = self._normalize_layout_positions(positions)
        # Merge: newly computed positions override nothing in reused (different coordinate spaces),
        # so we simply union them — reused coords are already normalized from a previous run.
        result = {**reused, **new_normalized}
        logger.info(
            "[layout] _compute_distance_layout finished: %d positions total (%.2fs)",
            len(result), time.perf_counter() - t_layout_start,
        )
        return result

    @staticmethod
    def _normalize_layout_positions(
        positions: Dict[str, Tuple[float, float]]
    ) -> Dict[str, Dict[str, float]]:
        if not positions:
            return {}

        x_values = [position[0] for position in positions.values()]
        y_values = [position[1] for position in positions.values()]
        min_x, max_x = min(x_values), max(x_values)
        min_y, max_y = min(y_values), max(y_values)
        span = max(max_x - min_x, max_y - min_y, 1.0)
        center_x = (min_x + max_x) / 2
        center_y = (min_y + max_y) / 2

        return {
            node_key: {
                "x": round((x_value - center_x) / span, 6),
                "y": round((y_value - center_y) / span, 6),
            }
            for node_key, (x_value, y_value) in positions.items()
        }

    def _build_generic_graph_context(
        self,
        question: str,
        *,
        query_depth: int,
        top_k: int,
    ) -> Dict[str, Any]:
        snapshot = self._load_snapshot()
        graph = self._get_graph()
        matched_nodes = self._match_nodes_for_question(question, limit=6)
        if not matched_nodes and graph.number_of_nodes():
            matched_nodes = snapshot.get("god_nodes", [])[:3]

        matched_node_keys = [node["node_key"] for node in matched_nodes]
        subgraph_node_keys = self._expand_from_nodes(graph, matched_node_keys, max_depth=query_depth)
        subgraph = graph.subgraph(subgraph_node_keys)

        related_articles = self._collect_related_articles(
            set(subgraph_node_keys),
            top_k=max(3, top_k),
            graph=graph,
        )

        edge_summaries = []
        for source_key, target_key, edge_data in subgraph.edges(data=True):
            for relation in edge_data.get("relations", []):
                edge_summaries.append(
                    f"{source_key} -[{relation['relation_type']}]-> {target_key}"
                )

        return {
            "matched_nodes": matched_nodes,
            "related_articles": related_articles[: max(1, top_k)],
            "context_node_count": subgraph.number_of_nodes(),
            "context_edge_count": subgraph.number_of_edges(),
            "subgraph_nodes": [
                snapshot_node
                for snapshot_node in snapshot.get("nodes", [])
                if snapshot_node["node_key"] in subgraph_node_keys
            ][:50],
            "subgraph_edges": edge_summaries[:80],
        }

    def _match_nodes_for_question(self, question: str, *, limit: int) -> List[Dict[str, Any]]:
        snapshot = self._load_snapshot()
        nodes = snapshot.get("nodes", [])
        normalized_question = self._normalize_text(question)
        tokens = self._question_tokens(question)
        extracted_terms = self._extract_query_terms(question)
        if extracted_terms:
            tokens.update(self._normalize_text(term) for term in extracted_terms if term)

        scored: List[Tuple[int, Dict[str, Any]]] = []
        for node in nodes:
            score = 0
            label = self._normalize_text(node.get("label", ""))
            aliases = [self._normalize_text(alias) for alias in (node.get("aliases") or [])]

            if label and label in normalized_question:
                score += 8 + min(len(label), 8)
            for alias in aliases:
                if alias and alias in normalized_question:
                    score += 5 + min(len(alias), 5)

            for token in tokens:
                if not token:
                    continue
                if token == label:
                    score += 12
                elif token and token in label:
                    score += 4
                elif any(token in alias for alias in aliases):
                    score += 3

            if score > 0:
                score += min(int(node.get("degree", 0)), 5)
                scored.append((score, node))

        scored.sort(
            key=lambda item: (
                -item[0],
                -int(item[1].get("degree", 0)),
                item[1].get("label", ""),
            )
        )
        return [item[1] for item in scored[:limit]]

    def _expand_from_nodes(self, graph: nx.Graph, start_nodes: Sequence[str], *, max_depth: int) -> List[str]:
        if not start_nodes:
            return []
        visited: Set[str] = set()
        queue: Deque[Tuple[str, int]] = deque((node_key, 0) for node_key in start_nodes if graph.has_node(node_key))
        while queue:
            node_key, depth = queue.popleft()
            if node_key in visited:
                continue
            visited.add(node_key)
            if depth >= max_depth:
                continue
            for neighbor in graph.neighbors(node_key):
                if neighbor not in visited:
                    queue.append((neighbor, depth + 1))
        return sorted(visited)

    def _collect_related_articles(
        self,
        node_keys: Set[str],
        *,
        top_k: int,
        graph: nx.Graph,
    ) -> List[Dict[str, Any]]:
        article_scores: Counter[int] = Counter()
        for node_key in node_keys:
            if not graph.has_node(node_key):
                continue
            for neighbor in graph.neighbors(node_key):
                edge_data = graph.get_edge_data(node_key, neighbor) or {}
                for article_id in edge_data.get("article_ids", set()):
                    if article_id:
                        article_scores[int(article_id)] += 1

        ordered_ids = [article_id for article_id, _ in article_scores.most_common(max(1, top_k * 3))]
        articles = []
        for article_id in ordered_ids:
            serialized = self._serialize_article_reference(
                article_id,
                relation_count=article_scores[article_id],
            )
            if serialized:
                articles.append(serialized)
        return articles[:top_k]

    def _serialize_article_reference(
        self,
        article_id: int,
        *,
        relation_count: int,
        distance: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        article = self.db.query(Article).filter(Article.id == article_id).first()
        if not article:
            return None
        return {
            "id": article.id,
            "title": article.title,
            "title_zh": article.title_zh,
            "url": article.url,
            "source": article.source,
            "published_at": article.published_at,
            "summary": article.summary,
            "detailed_summary": article.detailed_summary,
            "importance": article.importance,
            "tags": self._iter_json_strings(article.tags),
            "relation_count": relation_count,
            "distance": distance,
        }

    def _rag_search(self, question: str, *, top_k: int) -> List[Dict[str, Any]]:
        if not self.ai_analyzer:
            return []
        try:
            rag_service = RAGService(ai_analyzer=self.ai_analyzer, db=self.db)
            results = rag_service.search_articles(question, top_k=top_k)
        except Exception as exc:
            logger.warning("Knowledge graph RAG search fallback failed: %s", exc)
            return []

        articles = []
        for item in results:
            articles.append(
                {
                    "id": int(item["id"]),
                    "title": item["title"],
                    "title_zh": item.get("title_zh"),
                    "url": item["url"],
                    "source": item["source"],
                    "published_at": self._parse_datetime(item.get("published_at")),
                    "summary": item.get("summary"),
                    "detailed_summary": item.get("detailed_summary"),
                    "importance": item.get("importance"),
                    "tags": item.get("tags") or [],
                    "relation_count": 0,
                    "distance": None,
                }
            )
        return articles

    def _merge_articles(
        self,
        primary: Sequence[Dict[str, Any]],
        secondary: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        merged: Dict[int, Dict[str, Any]] = {}
        for item in [*primary, *secondary]:
            article_id = int(item["id"])
            current = merged.get(article_id)
            if not current:
                merged[article_id] = dict(item)
                continue
            current["relation_count"] = max(
                int(current.get("relation_count", 0)),
                int(item.get("relation_count", 0)),
            )
            if not current.get("summary") and item.get("summary"):
                current["summary"] = item["summary"]
            if not current.get("title_zh") and item.get("title_zh"):
                current["title_zh"] = item["title_zh"]
        values = list(merged.values())
        values.sort(key=lambda item: (-int(item.get("relation_count", 0)), item.get("source", ""), item.get("title", "")))
        return values

    def _generate_answer(
        self,
        *,
        question: str,
        resolved_mode: str,
        graph_context: Dict[str, Any],
        related_articles: Sequence[Dict[str, Any]],
        conversation_history: Optional[Sequence[Dict[str, str]]],
    ) -> str:
        if not self.ai_analyzer:
            return self._build_generic_graph_fallback_answer(
                question=question,
                resolved_mode=resolved_mode,
                graph_context=graph_context,
                related_articles=related_articles,
            )

        messages = self._build_query_messages(
            question=question,
            resolved_mode=resolved_mode,
            graph_context=graph_context,
            related_articles=related_articles,
            conversation_history=conversation_history,
        )
        response = self.ai_analyzer.client.chat.completions.create(
            model=self.ai_analyzer.model,
            messages=messages,
            temperature=0.2,
            max_tokens=1800,
        )
        try:
            answer = self._extract_chat_message_content(response, operation="question answering")
        except Exception as exc:
            logger.warning("Knowledge graph LLM answer failed, using fallback answer: %s", exc)
            return self._build_generic_graph_fallback_answer(
                question=question,
                resolved_mode=resolved_mode,
                graph_context=graph_context,
                related_articles=related_articles,
            )
        if answer:
            return answer
        logger.warning("Knowledge graph LLM answer was empty, using fallback answer")
        return self._build_generic_graph_fallback_answer(
            question=question,
            resolved_mode=resolved_mode,
            graph_context=graph_context,
            related_articles=related_articles,
        )

    def _build_query_messages(
        self,
        *,
        question: str,
        resolved_mode: str,
        graph_context: Dict[str, Any],
        related_articles: Sequence[Dict[str, Any]],
        conversation_history: Optional[Sequence[Dict[str, str]]],
    ) -> List[Dict[str, str]]:
        graph_lines = []
        for node in graph_context["matched_nodes"]:
            graph_lines.append(
                f"- Node: {node['label']} ({node['node_type']}, degree={node['degree']})"
            )
        for edge_text in graph_context["subgraph_edges"][:40]:
            graph_lines.append(f"- Edge: {edge_text}")

        article_lines = []
        for idx, article in enumerate(related_articles[:8], start=1):
            summary = (article.get("summary") or article.get("detailed_summary") or "")[:600]
            article_lines.append(
                f"[{idx}] {article.get('title_zh') or article.get('title')} | source={article.get('source')} | "
                f"relation_count={article.get('relation_count', 0)}\n{summary}"
            )

        prompt = (
            f"Question: {question}\n"
            f"Answer mode: {resolved_mode}\n\n"
            f"Graph context summary:\n"
            f"- Matched node count: {graph_context['context_node_count']}\n"
            f"- Matched edge count: {graph_context['context_edge_count']}\n"
            f"{chr(10).join(graph_lines) if graph_lines else '- No graph matches'}\n\n"
            f"Related articles:\n"
            f"{chr(10).join(article_lines) if article_lines else '- No related articles'}\n\n"
            "Write the answer in Chinese. "
            "Focus on entities, relations and cross-article structure. "
            "If article evidence is available, cite it with [1], [2] style markers. "
            "If the graph context is weak, say so explicitly."
        )

        messages: List[Dict[str, str]] = [
            {
                "role": "system",
                "content": (
                    "You are an AI news assistant that answers with structured graph reasoning. "
                    "Prefer relationships, clusters and supporting article evidence over vague summaries."
                ),
            }
        ]
        if conversation_history:
            recent_history = list(conversation_history)[-8:]
            for item in recent_history:
                role = item.get("role")
                content = item.get("content")
                if role in {"user", "assistant"} and content:
                    messages.append({"role": role, "content": content[:1000]})
        messages.append({"role": "user", "content": prompt})
        return messages

    def _build_generic_graph_fallback_answer(
        self,
        *,
        question: str,
        resolved_mode: str,
        graph_context: Dict[str, Any],
        related_articles: Sequence[Dict[str, Any]],
    ) -> str:
        matched_nodes = graph_context["matched_nodes"]
        if not matched_nodes:
            return f"当前知识图谱没有找到与“{question}”直接匹配的节点。"

        node_labels = "、".join(node["label"] for node in matched_nodes[:5])
        article_titles = "；".join(
            (article.get("title_zh") or article.get("title") or "")[:60]
            for article in related_articles[:3]
        ) or "暂无相关文章"
        return (
            f"图谱模式({resolved_mode})命中了这些核心节点：{node_labels}。"
            f"可继续参考的文章有：{article_titles}。"
        )

    def _extract_chat_message_content(self, response: Any, *, operation: str) -> str:
        choices = getattr(response, "choices", None)
        if not choices:
            raise ValueError(f"LLM response for {operation} did not include choices")
        message = getattr(choices[0], "message", None)
        if message is None:
            raise ValueError(f"LLM response for {operation} did not include a message")
        return str(getattr(message, "content", "") or "").strip()

    def _render_report(self, snapshot: Dict[str, Any]) -> str:
        stats = snapshot.get("stats", {})
        nodes = snapshot.get("god_nodes", [])[:10]

        lines = [
            "# Knowledge Graph Report",
            "",
            f"- Generated at: {snapshot.get('generated_at')}",
            f"- Total nodes: {stats.get('total_nodes', 0)}",
            f"- Total edges: {stats.get('total_edges', 0)}",
            f"- Article coverage: {snapshot.get('article_coverage', {}).get('synced_articles', 0)}/"
            f"{snapshot.get('article_coverage', {}).get('total_articles', 0)}",
            "",
            "## Top Nodes",
        ]
        for node in nodes:
            lines.append(
                f"- {node['label']} ({node['node_type']}): degree={node['degree']}, "
                f"articles={node['article_count']}"
            )
        lines.append("")
        lines.append("## Node Types")
        for key, value in sorted((stats.get("node_type_counts") or {}).items()):
            lines.append(f"- {key}: {value}")
        lines.append("")
        lines.append("## Relation Types")
        for key, value in sorted((stats.get("relation_type_counts") or {}).items()):
            lines.append(f"- {key}: {value}")
        return "\n".join(lines) + "\n"

    def _serialize_build(self, build: Optional[KnowledgeGraphBuild]) -> Optional[Dict[str, Any]]:
        if not build:
            return None
        extra_data = build.extra_data or {}
        return {
            "build_id": build.build_id,
            "status": build.status,
            "trigger_source": build.trigger_source,
            "sync_mode": build.sync_mode,
            "total_articles": int(build.total_articles or 0),
            "processed_articles": int(build.processed_articles or 0),
            "skipped_articles": int(extra_data.get("skipped_articles", 0)),
            "failed_articles": int(extra_data.get("failed_articles", 0)),
            "nodes_upserted": int(build.nodes_upserted or 0),
            "edges_upserted": int(build.edges_upserted or 0),
            "error_message": build.error_message,
            "started_at": build.started_at,
            "completed_at": build.completed_at,
            "extra_data": extra_data,
        }

    def _compute_article_hash(self, article: Article) -> str:
        payload = {
            "title": article.title,
            "title_zh": article.title_zh,
            "summary": article.summary,
            "detailed_summary": article.detailed_summary,
            "content": article.content,
            "source": article.source,
            "author": article.author,
            "tags": self._iter_json_strings(article.tags),
            "topics": self._iter_json_strings(getattr(article, "topics", None)),
            "related_papers": self._iter_json_strings(getattr(article, "related_papers", None)),
            "user_notes": article.user_notes,
            "published_at": article.published_at.isoformat() if article.published_at else None,
            "updated_at": article.updated_at.isoformat() if article.updated_at else None,
        }
        return hashlib.sha256(
            json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()

    def _build_semantic_prompt(self, article: Article) -> str:
        title = article.title_zh or article.title
        summary_parts = [
            f"Title: {title}",
            f"Source: {article.source}",
        ]
        if article.summary:
            summary_parts.append(f"Summary: {article.summary}")
        if article.detailed_summary:
            summary_parts.append(f"Detailed summary: {article.detailed_summary[:3000]}")
        if article.user_notes:
            summary_parts.append(f"User notes: {article.user_notes[:1000]}")
        if article.content and not article.detailed_summary:
            summary_parts.append(f"Content excerpt: {article.content[:3000]}")
        summary_parts.append(
            """
你是 AI 领域知识图谱提取专家。请从 AI 新闻文章中提取结构化知识图谱。

实体类型只能使用：Product, Organization, Platform, Technology, Concept, Feature。
关系类型只能使用：DEVELOPED, BASED_ON, USES, SUPPORTS, HAS_FEATURE, SOLVES。

规则：
1. 同一实体多种叫法只输出一个实体，其他名称放入 aliases。
2. 同名实体如果上下文含义或实体类型不同，不要合并。
3. URL、时间、指标、组件数量不要提取成节点，放入 properties。
4. 只输出高价值实体和明确关系。
5. 返回 JSON only。

输出格式：
{
  "entities": [
    {
      "id": "实体在文中的名称",
      "canonical_name": "标准名称",
      "label": "Product | Organization | Platform | Technology | Concept | Feature",
      "aliases": ["别名1", "别名2"],
      "description": "一句话说明实体是什么",
      "properties": {
        "url": null,
        "github_url": null,
        "official_site": null,
        "paper_url": null,
        "model_url": null
      }
    }
  ],
  "relationships": [
    {
      "source": "源实体 canonical_name",
      "source_label": "源实体类型",
      "target": "目标实体 canonical_name",
      "target_label": "目标实体类型",
      "type": "DEVELOPED | BASED_ON | USES | SUPPORTS | HAS_FEATURE | SOLVES",
      "evidence_snippet": "原文证据片段",
      "confidence": "EXTRACTED | INFERRED | AMBIGUOUS",
      "confidence_score": 0.0
    }
  ]
}
"""
        )
        return "\n\n".join(summary_parts)

    def _extract_query_terms(self, question: str) -> List[str]:
        if not self.ai_analyzer:
            return []
        prompt = (
            "Extract up to 5 entity or concept phrases from the question. "
            "Return JSON: {\"terms\": [\"...\"]}\n\n"
            f"Question: {question}"
        )
        try:
            response = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {
                        "role": "system",
                        "content": "You only return JSON for entity extraction.",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0,
                max_tokens=200,
            )
            payload = self._parse_json_block(
                self._extract_chat_message_content(response, operation="query term extraction") or "{}"
            )
            return self._coerce_string_list(payload.get("terms"))
        except Exception:
            return []

    def _parse_json_block(self, text: str) -> Dict[str, Any]:
        raw = text.strip()
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?", "", raw).strip()
            raw = re.sub(r"```$", "", raw).strip()
        return json.loads(raw or "{}")

    def _iter_json_strings(self, value: Any) -> List[str]:
        if not value:
            return []
        if isinstance(value, str):
            return [item.strip() for item in self._split_multi_value(value) if item.strip()]
        if isinstance(value, (list, tuple, set)):
            return [str(item).strip() for item in value if str(item).strip()]
        return [str(value).strip()]

    def _coerce_string_list(self, value: Any) -> List[str]:
        if not value:
            return []
        if isinstance(value, str):
            return [value.strip()] if value.strip() else []
        if isinstance(value, (list, tuple, set)):
            return [str(item).strip() for item in value if str(item).strip()]
        return [str(value).strip()]

    def _split_multi_value(self, value: str) -> List[str]:
        return [part.strip() for part in re.split(r"[,;/|、，]+", value) if part.strip()]

    def _normalize_node_type(self, node_type: str) -> str:
        safe = self._normalize_text(str(node_type or "concept")).replace(" ", "_")
        return safe[:50] or "concept"

    def _normalize_semantic_node_type(self, node_type: Any) -> str:
        safe = self._normalize_node_type(str(node_type or "concept"))
        if safe in ALLOWED_SEMANTIC_NODE_TYPES:
            return "org" if safe == "organization" else safe
        return "concept"

    def _normalize_domain_node_type(self, value: Any) -> str:
        safe = self._normalize_node_type(str(value or "concept"))
        return DOMAIN_NODE_TYPE_ALIASES.get(safe, "concept")

    def _normalize_domain_relation_type(self, value: Any) -> Optional[str]:
        raw = str(value or "").strip()
        if not raw:
            return None
        normalized = self._normalize_text(raw).replace("-", "_").replace(" ", "_")
        alias_map = {
            "developed": "DEVELOPED",
            "develops": "DEVELOPED",
            "released": "DEVELOPED",
            "launched": "DEVELOPED",
            "built": "DEVELOPED",
            "created": "DEVELOPED",
            "based_on": "BASED_ON",
            "basedon": "BASED_ON",
            "follows": "BASED_ON",
            "uses": "USES",
            "use": "USES",
            "integrates": "USES",
            "supports": "SUPPORTS",
            "support": "SUPPORTS",
            "compatible_with": "SUPPORTS",
            "has_feature": "HAS_FEATURE",
            "feature": "HAS_FEATURE",
            "provides": "HAS_FEATURE",
            "solves": "SOLVES",
            "addresses": "SOLVES",
            "targets": "SOLVES",
        }
        if raw.upper() in DOMAIN_RELATION_TYPES:
            return raw.upper()
        return alias_map.get(normalized)

    def _canonicalize_entity_name(self, name: str, node_type: str) -> str:
        normalized = self._normalize_text(name)
        canonical = CANONICAL_NAME_ALIAS_MAP.get(normalized, name.strip())
        return canonical[:500]

    def _merge_aliases(self, existing_aliases: Sequence[str], new_names: Sequence[str], canonical_name: str) -> List[str]:
        aliases: List[str] = []
        seen: Set[str] = set()
        canonical_norm = self._normalize_text(canonical_name)
        for raw_name in [*(existing_aliases or []), *(new_names or [])]:
            name = str(raw_name or "").strip()
            if not name:
                continue
            if self._normalize_text(name) == canonical_norm:
                continue
            key = self._normalize_text(name)
            if key in seen:
                continue
            seen.add(key)
            aliases.append(name[:500])
        return aliases

    def _description_meaning_matches(self, left: str, right: str) -> bool:
        left_tokens = self._question_tokens(left)
        right_tokens = self._question_tokens(right)
        if not left_tokens or not right_tokens:
            return False
        overlap = len(left_tokens & right_tokens)
        minimum = min(len(left_tokens), len(right_tokens))
        return overlap >= max(2, minimum)

    def _resolve_existing_entity_node(self, spec: NodeSpec) -> Optional[KnowledgeGraphNode]:
        metadata = spec.get("metadata") or {}
        node_type = spec["node_type"]
        for field in STRONG_IDENTITY_FIELDS:
            value = metadata.get(field)
            if not value:
                continue
            row = (
                self.db.query(KnowledgeGraphNode)
                .filter(KnowledgeGraphNode.node_type == node_type)
                .filter(func.json_extract(KnowledgeGraphNode.metadata_json, f'$.{field}') == value)
                .first()
            )
            if row:
                return row

        canonical_name = self._normalize_text(str(metadata.get("canonical_name") or spec["label"]))
        candidates = self.db.query(KnowledgeGraphNode).filter(KnowledgeGraphNode.node_type == node_type).all()
        for row in candidates:
            row_canonical = self._normalize_text(str((row.metadata_json or {}).get("canonical_name") or row.label))
            if row_canonical == canonical_name:
                return row

        spec_aliases = {self._normalize_text(alias) for alias in self._coerce_string_list(spec.get("aliases"))}
        spec_aliases.add(canonical_name)
        for row in candidates:
            row_aliases = {self._normalize_text(alias) for alias in (row.aliases or [])}
            row_aliases.add(self._normalize_text(row.label))
            row_aliases.add(self._normalize_text(str((row.metadata_json or {}).get("canonical_name") or row.label)))
            if spec_aliases & row_aliases:
                return row

        spec_description = str(metadata.get("description") or "").strip()
        if spec_description:
            for row in candidates:
                row_description = str((row.metadata_json or {}).get("description") or "").strip()
                if row_description and self._description_meaning_matches(spec_description, row_description):
                    return row
        return None

    def _extract_structured_graph_query(self, question: str) -> Dict[str, Any]:
        normalized = self._normalize_text(question)
        target_type = "product"
        if any(token in normalized for token in ["应用", "产品", "项目", "框架", "工具", "模型"]):
            target_type = "product"

        conditions: List[Dict[str, Any]] = []
        if any(token in normalized for token in ["agent-to-ui", "a2ui", "agent to ui"]):
            conditions.append(
                {
                    "relation_type": "BASED_ON",
                    "target_type": "concept",
                    "target_terms": ["Agent-to-UI", "A2UI"],
                }
            )
        if any(token in normalized for token in ["跨平台", "多端", "多端ui适配", "ui 适配", "ui适配"]):
            conditions.append(
                {
                    "relation_type": "SOLVES",
                    "target_type": "feature",
                    "target_terms": ["跨平台", "多端 UI 适配", "多端UI适配"],
                }
            )
        return {
            "target_type": target_type,
            "conditions": conditions,
        }

    def _edge_is_allowed_for_structured_query(self, edge: KnowledgeGraphEdge) -> bool:
        if float(edge.confidence_score or 0.0) < 0.6:
            return False
        if edge.confidence == "AMBIGUOUS":
            return False
        if edge.confidence == "INFERRED" and float(edge.confidence_score or 0.0) < 0.75:
            return False
        return True

    def _node_matches_terms(self, node: KnowledgeGraphNode, terms: Sequence[str]) -> bool:
        haystacks = {
            self._normalize_text(node.label),
            self._normalize_text(str((node.metadata_json or {}).get("canonical_name") or "")),
            *[self._normalize_text(alias) for alias in (node.aliases or [])],
        }
        for term in terms:
            normalized_term = self._normalize_text(term)
            if any(normalized_term and normalized_term in hay for hay in haystacks):
                return True
        return False

    def _execute_structured_graph_query(self, parsed_query: Dict[str, Any], *, limit: int) -> List[Dict[str, Any]]:
        target_type = parsed_query.get("target_type") or "product"
        candidates = self.db.query(KnowledgeGraphNode).filter(KnowledgeGraphNode.node_type == target_type).all()
        results: List[Dict[str, Any]] = []
        for candidate in candidates:
            matched_edges: List[Dict[str, Any]] = []
            matched_article_ids: Set[int] = set()
            all_conditions_passed = True
            for condition in parsed_query.get("conditions", []):
                relation_type = condition.get("relation_type")
                condition_target_type = condition.get("target_type")
                condition_terms = condition.get("target_terms") or []
                condition_matched = False
                edges = (
                    self.db.query(KnowledgeGraphEdge, KnowledgeGraphNode)
                    .join(KnowledgeGraphNode, KnowledgeGraphEdge.target_node_id == KnowledgeGraphNode.id)
                    .filter(KnowledgeGraphEdge.source_node_id == candidate.id)
                    .filter(KnowledgeGraphEdge.relation_type == relation_type)
                    .filter(KnowledgeGraphNode.node_type == condition_target_type)
                    .all()
                )
                for edge, target_node in edges:
                    if not self._edge_is_allowed_for_structured_query(edge):
                        continue
                    if not self._node_matches_terms(target_node, condition_terms):
                        continue
                    condition_matched = True
                    if edge.source_article_id:
                        matched_article_ids.add(int(edge.source_article_id))
                    matched_edges.append(
                        {
                            "source_node_key": candidate.node_key,
                            "target_node_key": target_node.node_key,
                            "relation_type": edge.relation_type,
                            "confidence": edge.confidence,
                            "confidence_score": float(edge.confidence_score or 0.0),
                            "weight": float(edge.weight or 1.0),
                            "source_article_id": edge.source_article_id,
                            "source_label": candidate.label,
                            "target_label": target_node.label,
                            "evidence_snippet": edge.evidence_snippet,
                            "metadata": edge.metadata_json or {},
                        }
                    )
                if not condition_matched:
                    all_conditions_passed = False
                    break
            if not all_conditions_passed:
                continue
            related_articles = [
                article
                for article in (
                    self._serialize_article_reference(article_id, relation_count=len(matched_edges))
                    for article_id in sorted(matched_article_ids)
                )
                if article
            ]
            results.append(
                {
                    "node": self._serialize_node_summary(candidate),
                    "matched_edges": matched_edges,
                    "related_articles": related_articles,
                }
            )
        results.sort(
            key=lambda item: (
                -len(item.get("matched_edges", [])),
                -(item.get("node", {}).get("article_count") or 0),
                item.get("node", {}).get("label", ""),
            )
        )
        return results[:limit]

    def _serialize_node_summary(self, node: KnowledgeGraphNode) -> Dict[str, Any]:
        article_count = int(
            self.db.query(func.count(KnowledgeGraphEdge.id))
            .filter(
                or_(
                    KnowledgeGraphEdge.source_node_id == node.id,
                    KnowledgeGraphEdge.target_node_id == node.id,
                )
            )
            .filter(KnowledgeGraphEdge.source_article_id.isnot(None))
            .scalar()
            or 0
        )
        return {
            "node_key": node.node_key,
            "label": node.label,
            "node_type": node.node_type,
            "aliases": node.aliases or [],
            "metadata": node.metadata_json or {},
            "degree": int(
                self.db.query(func.count(KnowledgeGraphEdge.id))
                .filter(
                    or_(
                        KnowledgeGraphEdge.source_node_id == node.id,
                        KnowledgeGraphEdge.target_node_id == node.id,
                    )
                )
                .scalar()
                or 0
            ),
            "article_count": article_count,
            "centrality": 0.0,
            "layout_x": None,
            "layout_y": None,
        }

    def _build_structured_query_answer(
        self,
        question: str,
        parsed_query: Dict[str, Any],
        results: Sequence[Dict[str, Any]],
    ) -> str:
        if not results:
            return f"当前知识图谱没有找到满足“{question}”条件的结果。"
        top = results[0]
        node = top.get("node") or {}
        edge_summaries = []
        for edge in top.get("matched_edges", [])[:4]:
            edge_summaries.append(f"{edge['relation_type']} -> {edge.get('target_label') or edge['target_node_key'].split(':', 1)[-1]}")
        summary_text = "；".join(edge_summaries) or "无关系摘要"
        return f"根据知识图谱检索，命中结果：{node.get('label')}。满足条件的关系包括：{summary_text}。"

    def _normalize_run_mode(self, run_mode: str) -> str:
        normalized = str(run_mode or "auto").strip().lower()
        if normalized in REMOVED_RUN_MODES:
            return normalized
        return normalized if normalized in ALLOWED_RUN_MODES else "auto"

    def _resolve_run_mode(self, run_mode: str) -> str:
        if run_mode == "auto":
            if not self.ai_analyzer:
                raise ValueError("Strict ontology extraction requires a configured knowledge-graph AI provider")
            return "agent"
        if run_mode == "deterministic":
            raise ValueError("Deterministic graph extraction has been removed; please use agent mode")
        if run_mode == "agent" and not self.ai_analyzer:
            raise ValueError("Strict ontology extraction requires a configured knowledge-graph AI provider")
        return run_mode

    def _normalize_query_mode(self, mode: str) -> str:
        normalized = str(mode or "graph").strip().lower()
        return normalized if normalized in ALLOWED_QUERY_MODES else "graph"

    def _resolve_query_mode(self, mode: str) -> str:
        if mode == "auto":
            if settings.is_knowledge_graph_enabled():
                return "hybrid" if self.ai_analyzer else "graph"
            return "rag"
        if mode in {"graph", "hybrid"} and not settings.is_knowledge_graph_enabled():
            raise ValueError("Knowledge graph is disabled")
        return mode

    def _make_node_key(self, node_type: str, label: str) -> str:
        normalized = unicodedata.normalize("NFKC", label).strip().lower()
        normalized = re.sub(r"\s+", "-", normalized)
        normalized = re.sub(r"[^0-9a-z\u4e00-\u9fff_-]+", "-", normalized)
        normalized = re.sub(r"-{2,}", "-", normalized).strip("-_")
        if not normalized:
            normalized = hashlib.sha1(label.encode("utf-8")).hexdigest()[:16]
        max_slug_length = max(16, 255 - len(node_type) - 1)
        return f"{node_type}:{normalized[:max_slug_length]}"

    def _normalize_text(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKC", text or "").lower().strip()
        normalized = re.sub(r"\s+", " ", normalized)
        return normalized

    def _snapshot_node_matches_query(self, node: Dict[str, Any], normalized_query: str) -> bool:
        haystacks = [
            self._normalize_text(node.get("label", "")),
            self._normalize_text(node.get("node_key", "")),
            self._normalize_text(" ".join(node.get("aliases", []) or [])),
        ]
        return any(normalized_query in hay for hay in haystacks)

    def _question_tokens(self, text: str) -> Set[str]:
        normalized = self._normalize_text(text)
        chunks = re.findall(r"[0-9a-z\u4e00-\u9fff_+-]{2,}", normalized)
        return {chunk for chunk in chunks if len(chunk) >= 2}

    def _parse_datetime(self, value: Any) -> Optional[datetime]:
        if not value:
            return None
        if isinstance(value, datetime):
            return value
        try:
            return datetime.fromisoformat(str(value))
        except Exception:
            return None
