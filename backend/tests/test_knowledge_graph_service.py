import shutil
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.app.core.settings import settings
from backend.app.db.models import Article, Base, KnowledgeGraphArticleState, KnowledgeGraphEdge, KnowledgeGraphNode
from backend.app.services.knowledge_graph import KnowledgeGraphService


class KnowledgeGraphServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.session = self.SessionLocal()
        temp_root = Path(__file__).resolve().parent / ".tmp"
        temp_root.mkdir(parents=True, exist_ok=True)
        self.temp_dir = temp_root / uuid.uuid4().hex
        self.temp_dir.mkdir(parents=True, exist_ok=True)

        self.original_enabled = settings.KNOWLEDGE_GRAPH_ENABLED
        self.original_query_depth = settings.KNOWLEDGE_GRAPH_QUERY_DEPTH
        self.original_max_articles = settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC

        settings.KNOWLEDGE_GRAPH_ENABLED = True
        settings.KNOWLEDGE_GRAPH_QUERY_DEPTH = 2
        settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC = 100

        article = Article(
            title="OpenAI ships a new reasoning model",
            title_zh="OpenAI 发布新的推理模型",
            url="https://example.com/openai-reasoning-model",
            content="OpenAI introduced a reasoning model and compared it with previous systems.",
            summary="The article discusses OpenAI, reasoning systems and model evaluation.",
            detailed_summary="OpenAI introduced a reasoning-focused model and highlighted evaluation benchmarks.",
            source="OpenAI",
            author="Alice",
            published_at=datetime(2026, 4, 1, 8, 0, 0),
            collected_at=datetime(2026, 4, 1, 9, 0, 0),
            importance="high",
            tags=["OpenAI", "reasoning"],
            topics=["reasoning", "evaluation"],
            related_papers=["Reasoning Paper"],
            is_processed=True,
            is_sent=False,
            is_favorited=False,
            created_at=datetime(2026, 4, 1, 9, 0, 0),
            updated_at=datetime(2026, 4, 1, 9, 0, 0),
        )
        self.session.add(article)
        self.session.commit()
        self.article_id = article.id

        self.service = KnowledgeGraphService(db=self.session, ai_analyzer=None)
        self.service.snapshot_dir = self.temp_dir
        self.service.snapshot_path = self.temp_dir / "current_snapshot.json"
        self.service.report_path = self.temp_dir / "latest_report.md"

    def tearDown(self):
        settings.KNOWLEDGE_GRAPH_ENABLED = self.original_enabled
        settings.KNOWLEDGE_GRAPH_QUERY_DEPTH = self.original_query_depth
        settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC = self.original_max_articles
        self.session.close()
        self.engine.dispose()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_sync_articles_creates_snapshot_and_graph_records(self):
        result = self.service.sync_articles(sync_mode="deterministic", trigger_source="test")

        self.assertEqual(result["build"]["status"], "completed")
        self.assertGreater(result["stats"]["total_nodes"], 0)
        self.assertGreater(result["stats"]["total_edges"], 0)
        self.assertTrue(self.service.snapshot_path.exists())
        self.assertTrue(self.service.report_path.exists())

        matching_nodes = self.service.search_nodes(query="OpenAI", limit=10)
        node_types = {item["node_type"] for item in matching_nodes}
        self.assertIn("source", node_types)

    def test_answer_question_and_article_context_include_related_article(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")

        response = self.service.answer_question("OpenAI 和 reasoning 有什么关系？", mode="graph", top_k=5)
        self.assertEqual(response["resolved_mode"], "graph")
        self.assertGreater(len(response["matched_nodes"]), 0)
        self.assertTrue(any(item["id"] == self.article_id for item in response["related_articles"]))

        article_context = self.service.get_article_context(self.article_id)
        self.assertEqual(article_context["article_id"], self.article_id)
        self.assertGreater(len(article_context["nodes"]), 0)

    def test_answer_question_falls_back_when_llm_response_has_no_choices(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")
        self.service.ai_analyzer = SimpleNamespace(
            model="test-model",
            client=SimpleNamespace(
                chat=SimpleNamespace(
                    completions=SimpleNamespace(
                        create=lambda **_: SimpleNamespace(choices=None)
                    )
                )
            ),
        )

        response = self.service.answer_question("OpenAI 和 reasoning 有什么关系？", mode="graph", top_k=5)

        self.assertEqual(response["resolved_mode"], "graph")
        self.assertIn("图谱模式(graph)", response["answer"])
        self.assertTrue(any(item["id"] == self.article_id for item in response["related_articles"]))

    def test_find_path_between_article_and_source_node(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")

        source_nodes = self.service.search_nodes(query="OpenAI", node_type="source", limit=5)
        self.assertTrue(source_nodes)

        path = self.service.find_path(f"article:{self.article_id}", source_nodes[0]["node_key"])
        self.assertTrue(path["found"])
        self.assertGreaterEqual(path["distance"], 1)
        self.assertGreaterEqual(len(path["nodes"]), 2)

    def test_snapshot_view_returns_filtered_nodes_and_links(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")

        snapshot = self.service.get_snapshot_view(node_type="source", query="OpenAI", limit_nodes=20)
        self.assertGreaterEqual(snapshot["total_nodes"], 1)
        self.assertIn("source", snapshot["available_node_types"])
        self.assertTrue(any(node["node_type"] == "source" for node in snapshot["nodes"]))
        self.assertEqual(snapshot["layout_mode"], "distance_weighted_kamada_kawai")
        self.assertTrue(all("layout_x" in node and "layout_y" in node for node in snapshot["nodes"]))

    def test_snapshot_view_supports_focus_node_keys_and_expand_depth(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")

        source_nodes = self.service.search_nodes(query="OpenAI", node_type="source", limit=5)
        self.assertTrue(source_nodes)

        snapshot = self.service.get_snapshot_view(
            focus_node_keys=[source_nodes[0]["node_key"]],
            expand_depth=1,
            limit_nodes=20,
        )
        node_keys = {node["node_key"] for node in snapshot["nodes"]}
        self.assertIn(source_nodes[0]["node_key"], node_keys)
        self.assertGreaterEqual(len(snapshot["links"]), 1)

    def test_community_detail_includes_summary_text_and_relation_types(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")

        communities = self.service.get_communities(limit=5)
        self.assertTrue(communities)

        detail = self.service.get_community_detail(communities[0]["community_id"])
        self.assertIn(communities[0]["label"], detail["summary_text"])
        self.assertIsInstance(detail["relation_types"], list)
        self.assertGreaterEqual(len(detail["nodes"]), 1)

    def test_node_detail_uses_local_queries_without_rebuilding_graph(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")
        source_nodes = self.service.search_nodes(query="OpenAI", node_type="source", limit=5)
        self.assertTrue(source_nodes)

        service = KnowledgeGraphService(db=self.session, ai_analyzer=None)
        service.snapshot_dir = self.temp_dir
        service.snapshot_path = self.temp_dir / "current_snapshot.json"
        service.report_path = self.temp_dir / "latest_report.md"

        with patch.object(
            service,
            "_build_networkx_graph",
            side_effect=AssertionError("node detail should not rebuild the full graph"),
        ):
            detail = service.get_node_detail(source_nodes[0]["node_key"])

        self.assertEqual(detail["node"]["node_key"], source_nodes[0]["node_key"])
        self.assertGreaterEqual(len(detail["neighbors"]), 1)
        self.assertGreaterEqual(len(detail["edges"]), 1)
        self.assertTrue(any(item["id"] == self.article_id for item in detail["related_articles"]))

    def test_cleanup_orphan_nodes_uses_subquery_without_expanding_ids(self):
        source = KnowledgeGraphNode(node_key="test:source", label="Source", node_type="test")
        target = KnowledgeGraphNode(node_key="test:target", label="Target", node_type="test")
        orphan = KnowledgeGraphNode(node_key="test:orphan", label="Orphan", node_type="test")
        self.session.add_all([source, target, orphan])
        self.session.flush()
        self.session.add(
            KnowledgeGraphEdge(
                source_node_id=source.id,
                target_node_id=target.id,
                relation_type="related_to",
                confidence="EXTRACTED",
                confidence_score=1.0,
            )
        )
        self.session.commit()

        delete_statements = []

        def capture_delete(conn, cursor, statement, parameters, context, executemany):
            if statement.lstrip().upper().startswith("DELETE FROM knowledge_graph_nodes".upper()):
                delete_statements.append((statement, parameters))

        event.listen(self.engine, "before_cursor_execute", capture_delete)
        try:
            self.service._cleanup_orphan_nodes()
            self.session.commit()
        finally:
            event.remove(self.engine, "before_cursor_execute", capture_delete)

        remaining_keys = {node.node_key for node in self.session.query(KnowledgeGraphNode).all()}
        self.assertEqual(remaining_keys, {"test:source", "test:target"})
        self.assertEqual(len(delete_statements), 1)
        delete_sql, parameters = delete_statements[0]
        self.assertIn("SELECT", delete_sql.upper())
        self.assertEqual(parameters, ())

    def test_diagnose_integrity_reports_snapshot_and_orphan_issues(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")
        orphan = KnowledgeGraphNode(node_key="test:orphan", label="Orphan", node_type="test")
        self.session.add(orphan)
        self.session.commit()

        report = self.service.diagnose_integrity(limit=10)

        issue_codes = {issue["code"] for issue in report["issues"]}
        self.assertIn("orphan_nodes", issue_codes)
        self.assertIn("snapshot_db_mismatch", issue_codes)
        self.assertTrue(report["recommendations"])

    def test_repair_integrity_cleans_orphans_and_rebuilds_snapshot(self):
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")
        orphan = KnowledgeGraphNode(node_key="test:orphan", label="Orphan", node_type="test")
        self.session.add(orphan)
        self.session.commit()

        response = self.service.repair_integrity(dry_run=False, resync_suspects=False, limit=10)

        self.assertTrue(response["repaired"])
        self.assertGreaterEqual(response["deleted_orphan_nodes"], 1)
        remaining_orphan = (
            self.session.query(KnowledgeGraphNode)
            .filter(KnowledgeGraphNode.node_key == "test:orphan")
            .first()
        )
        self.assertIsNone(remaining_orphan)
        self.assertNotIn(
            "snapshot_db_mismatch",
            {issue["code"] for issue in (response["after"] or {})["issues"]},
        )

    def test_diagnose_integrity_marks_synced_article_missing_graph_as_suspect(self):
        article = self.session.get(Article, self.article_id)
        content_hash = self.service._compute_article_hash(article)
        self.session.add(
            KnowledgeGraphArticleState(
                article_id=self.article_id,
                content_hash=content_hash,
                status="synced",
                sync_mode="deterministic",
                last_synced_at=datetime.now(),
            )
        )
        self.session.commit()

        report = self.service.diagnose_integrity(keyword="OpenAI", limit=10)

        issue_codes = {issue["code"] for issue in report["issues"]}
        self.assertIn("synced_articles_missing_graph", issue_codes)
        self.assertIn(self.article_id, report["suspect_article_ids"])
        self.assertIn(self.article_id, report["keyword_article_ids"])


if __name__ == "__main__":
    unittest.main()
