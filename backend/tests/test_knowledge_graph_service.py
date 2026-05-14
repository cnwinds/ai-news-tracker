import json
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
from backend.app.db.models import (
    Article,
    Base,
    KnowledgeGraphArticleState,
    KnowledgeGraphBuild,
    KnowledgeGraphEdge,
    KnowledgeGraphNode,
)
from backend.app.services.knowledge_graph import KnowledgeGraphService


def make_ai_analyzer(payload: dict) -> SimpleNamespace:
    content = json.dumps(payload, ensure_ascii=False)
    return SimpleNamespace(
        model="test-model",
        client=SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(
                    create=lambda **_: SimpleNamespace(
                        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
                    )
                )
            )
        ),
    )


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
            content="OpenAI introduced GPT-Next. GPT-Next is based on Transformer and offers reasoning optimization.",
            summary="The article discusses OpenAI, GPT-Next and reasoning optimization.",
            detailed_summary="OpenAI 发布 GPT-Next，基于 Transformer，并具备推理优化能力。",
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

        self.default_payload = {
            "entities": [
                {
                    "id": "OpenAI",
                    "canonical_name": "OpenAI",
                    "label": "Organization",
                    "aliases": [],
                    "description": "AI organization",
                    "properties": {"official_site": "https://openai.com"},
                },
                {
                    "id": "GPT-Next",
                    "canonical_name": "GPT-Next",
                    "label": "Product",
                    "aliases": ["reasoning model"],
                    "description": "Reasoning-focused product",
                    "properties": {"model_url": "https://example.com/gpt-next"},
                },
                {
                    "id": "Transformer",
                    "canonical_name": "Transformer",
                    "label": "Technology",
                    "aliases": [],
                    "description": "Foundation model architecture",
                    "properties": {},
                },
                {
                    "id": "推理优化",
                    "canonical_name": "推理优化",
                    "label": "Feature",
                    "aliases": ["reasoning optimization"],
                    "description": "Improves reasoning quality",
                    "properties": {},
                },
            ],
            "relationships": [
                {
                    "source": "OpenAI",
                    "source_label": "Organization",
                    "target": "GPT-Next",
                    "target_label": "Product",
                    "type": "DEVELOPED",
                    "evidence_snippet": "OpenAI introduced GPT-Next",
                    "confidence": "EXTRACTED",
                    "confidence_score": 0.99,
                },
                {
                    "source": "GPT-Next",
                    "source_label": "Product",
                    "target": "Transformer",
                    "target_label": "Technology",
                    "type": "BASED_ON",
                    "evidence_snippet": "GPT-Next is based on Transformer",
                    "confidence": "EXTRACTED",
                    "confidence_score": 0.95,
                },
                {
                    "source": "GPT-Next",
                    "source_label": "Product",
                    "target": "推理优化",
                    "target_label": "Feature",
                    "type": "HAS_FEATURE",
                    "evidence_snippet": "GPT-Next offers reasoning optimization",
                    "confidence": "EXTRACTED",
                    "confidence_score": 0.94,
                },
            ],
        }

        self.service = KnowledgeGraphService(
            db=self.session,
            ai_analyzer=make_ai_analyzer(self.default_payload),
        )
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

    def sync_default_graph(self):
        return self.service.sync_articles(sync_mode="agent", trigger_source="test")

    def test_sync_rejects_removed_deterministic_mode(self):
        with self.assertRaisesRegex(ValueError, "Deterministic graph extraction has been removed"):
            self.service.sync_articles(sync_mode="deterministic", trigger_source="test")

    def test_sync_articles_creates_snapshot_and_graph_records(self):
        result = self.sync_default_graph()

        self.assertEqual(result["build"]["status"], "completed")
        self.assertGreater(result["stats"]["total_nodes"], 0)
        self.assertGreater(result["stats"]["total_edges"], 0)
        self.assertTrue(self.service.snapshot_path.exists())
        self.assertTrue(self.service.report_path.exists())

        matching_nodes = self.service.search_nodes(query="OpenAI", limit=10)
        node_types = {item["node_type"] for item in matching_nodes}
        self.assertIn("organization", node_types)

    def test_answer_question_and_article_context_include_related_article(self):
        self.sync_default_graph()

        response = self.service.answer_question("OpenAI 和 GPT-Next 有什么关系？", mode="graph", top_k=5)
        self.assertEqual(response["resolved_mode"], "graph")
        self.assertGreater(len(response["matched_nodes"]), 0)
        self.assertTrue(any(item["id"] == self.article_id for item in response["related_articles"]))

        article_context = self.service.get_article_context(self.article_id)
        self.assertEqual(article_context["article_id"], self.article_id)
        self.assertGreater(len(article_context["nodes"]), 0)
        self.assertGreater(len(article_context["edges"]), 0)

    def test_answer_question_falls_back_when_llm_response_has_no_choices(self):
        self.sync_default_graph()
        self.service.ai_analyzer = SimpleNamespace(
            model="test-model",
            client=SimpleNamespace(
                chat=SimpleNamespace(
                    completions=SimpleNamespace(create=lambda **_: SimpleNamespace(choices=None))
                )
            ),
        )

        response = self.service.answer_question("OpenAI 和 GPT-Next 有什么关系？", mode="graph", top_k=5)

        self.assertEqual(response["resolved_mode"], "graph")
        self.assertIn("图谱模式(graph)", response["answer"])
        self.assertTrue(any(item["id"] == self.article_id for item in response["related_articles"]))

    def test_find_path_between_organization_and_feature_node(self):
        self.sync_default_graph()

        organization_nodes = self.service.search_nodes(query="OpenAI", node_type="organization", limit=5)
        feature_nodes = self.service.search_nodes(query="推理优化", node_type="feature", limit=5)
        self.assertTrue(organization_nodes)
        self.assertTrue(feature_nodes)

        path = self.service.find_path(organization_nodes[0]["node_key"], feature_nodes[0]["node_key"])
        self.assertTrue(path["found"])
        self.assertGreaterEqual(path["distance"], 2)
        self.assertGreaterEqual(len(path["nodes"]), 3)

    def test_snapshot_view_returns_filtered_nodes_and_links(self):
        self.sync_default_graph()

        snapshot = self.service.get_snapshot_view(node_type="organization", query="OpenAI", limit_nodes=20)
        self.assertGreaterEqual(snapshot["total_nodes"], 1)
        self.assertIn("organization", snapshot["available_node_types"])
        self.assertTrue(any(node["node_type"] == "organization" for node in snapshot["nodes"]))
        self.assertEqual(snapshot["layout_mode"], "distance_weighted_kamada_kawai")
        self.assertTrue(all("layout_x" in node and "layout_y" in node for node in snapshot["nodes"]))

    def test_snapshot_view_supports_focus_node_keys_and_expand_depth(self):
        self.sync_default_graph()

        organization_nodes = self.service.search_nodes(query="OpenAI", node_type="organization", limit=5)
        self.assertTrue(organization_nodes)

        snapshot = self.service.get_snapshot_view(
            focus_node_keys=[organization_nodes[0]["node_key"]],
            expand_depth=1,
            limit_nodes=20,
        )
        node_keys = {node["node_key"] for node in snapshot["nodes"]}
        self.assertIn(organization_nodes[0]["node_key"], node_keys)
        self.assertGreaterEqual(len(snapshot["links"]), 1)

    def test_node_detail_uses_local_queries_without_rebuilding_graph(self):
        self.sync_default_graph()
        organization_nodes = self.service.search_nodes(query="OpenAI", node_type="organization", limit=5)
        self.assertTrue(organization_nodes)

        service = KnowledgeGraphService(db=self.session, ai_analyzer=make_ai_analyzer(self.default_payload))
        service.snapshot_dir = self.temp_dir
        service.snapshot_path = self.temp_dir / "current_snapshot.json"
        service.report_path = self.temp_dir / "latest_report.md"

        with patch.object(
            service,
            "_build_networkx_graph",
            side_effect=AssertionError("node detail should not rebuild the full graph"),
        ):
            detail = service.get_node_detail(organization_nodes[0]["node_key"])

        self.assertEqual(detail["node"]["node_key"], organization_nodes[0]["node_key"])
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
        self.sync_default_graph()
        orphan = KnowledgeGraphNode(node_key="test:orphan", label="Orphan", node_type="test")
        self.session.add(orphan)
        self.session.commit()

        report = self.service.diagnose_integrity(limit=10)

        issue_codes = {issue["code"] for issue in report["issues"]}
        self.assertIn("orphan_nodes", issue_codes)
        self.assertIn("snapshot_db_mismatch", issue_codes)
        self.assertTrue(report["recommendations"])

    def test_repair_integrity_cleans_orphans_and_rebuilds_snapshot(self):
        self.sync_default_graph()
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
                sync_mode="agent",
                last_synced_at=datetime.now(),
            )
        )
        self.session.commit()

        report = self.service.diagnose_integrity(keyword="OpenAI", limit=10)

        issue_codes = {issue["code"] for issue in report["issues"]}
        self.assertIn("keyword_articles_missing_graph", issue_codes)
        self.assertIn(self.article_id, report["suspect_article_ids"])
        self.assertIn(self.article_id, report["keyword_article_ids"])

    def test_agent_sync_uses_domain_ontology_and_merges_aliases(self):
        article = Article(
            title="AGenUI released",
            title_zh="AGenUI 发布",
            url="https://example.com/agenui",
            content="AGenUI is based on Agent-to-UI and solves cross-platform UI adaptation.",
            summary="AGenUI supports iOS and Android.",
            detailed_summary="高德发布 AGenUI，基于 Agent-to-UI / A2UI 协议，解决多端 UI 适配问题。",
            source="Amap",
            author="Bob",
            published_at=datetime(2026, 4, 2, 8, 0, 0),
            collected_at=datetime(2026, 4, 2, 9, 0, 0),
            importance="high",
            created_at=datetime(2026, 4, 2, 9, 0, 0),
            updated_at=datetime(2026, 4, 2, 9, 0, 0),
        )
        self.session.add(article)
        self.session.commit()

        payload = {
            "entities": [
                {
                    "id": "AGenUI",
                    "canonical_name": "AGenUI",
                    "label": "Product",
                    "aliases": [],
                    "description": "跨平台原生 A2UI 框架",
                    "properties": {"github_url": "https://github.com/AGenUI/AGenUI"},
                },
                {
                    "id": "高德",
                    "canonical_name": "高德",
                    "label": "Organization",
                    "aliases": ["Amap"],
                    "description": "发布组织",
                    "properties": {},
                },
                {
                    "id": "Google A2UI协议",
                    "canonical_name": "Agent-to-UI",
                    "label": "Concept",
                    "aliases": ["A2UI", "Agent to UI"],
                    "description": "Agent 与 UI 之间的交互协议",
                    "properties": {},
                },
                {
                    "id": "多端 UI 适配",
                    "canonical_name": "多端 UI 适配",
                    "label": "Feature",
                    "aliases": ["跨平台"],
                    "description": "解决跨平台 UI 适配问题",
                    "properties": {},
                },
            ],
            "relationships": [
                {
                    "source": "高德",
                    "source_label": "Organization",
                    "target": "AGenUI",
                    "target_label": "Product",
                    "type": "DEVELOPED",
                    "evidence_snippet": "高德发布 AGenUI",
                    "confidence": "EXTRACTED",
                    "confidence_score": 0.98,
                },
                {
                    "source": "AGenUI",
                    "source_label": "Product",
                    "target": "Agent-to-UI",
                    "target_label": "Concept",
                    "type": "BASED_ON",
                    "evidence_snippet": "基于 Agent-to-UI / A2UI 协议",
                    "confidence": "EXTRACTED",
                    "confidence_score": 0.95,
                },
                {
                    "source": "AGenUI",
                    "source_label": "Product",
                    "target": "多端 UI 适配",
                    "target_label": "Feature",
                    "type": "SOLVES",
                    "evidence_snippet": "解决多端 UI 适配问题",
                    "confidence": "EXTRACTED",
                    "confidence_score": 0.94,
                },
            ],
        }
        self.service.ai_analyzer = make_ai_analyzer(payload)

        result = self.service.sync_articles(article_ids=[article.id], sync_mode="agent", trigger_source="test")

        self.assertEqual(result["build"]["status"], "completed")
        concept_node = (
            self.session.query(KnowledgeGraphNode)
            .filter(KnowledgeGraphNode.node_type == "concept", KnowledgeGraphNode.label == "Agent-to-UI")
            .first()
        )
        self.assertIsNotNone(concept_node)
        self.assertIn("A2UI", concept_node.aliases or [])
        self.assertIn("Google A2UI协议", concept_node.aliases or [])
        relation_types = {
            row[0]
            for row in self.session.query(KnowledgeGraphEdge.relation_type)
            .filter(KnowledgeGraphEdge.source_article_id == article.id)
            .all()
        }
        self.assertIn("DEVELOPED", relation_types)
        self.assertIn("BASED_ON", relation_types)
        self.assertIn("SOLVES", relation_types)

    def test_structured_query_returns_nodes_edges_and_articles(self):
        product = KnowledgeGraphNode(
            node_key="product:agenui",
            label="AGenUI",
            node_type="product",
            aliases=[],
            metadata_json={"canonical_name": "AGenUI", "description": "跨平台原生 A2UI 框架"},
        )
        concept = KnowledgeGraphNode(
            node_key="concept:agent-to-ui",
            label="Agent-to-UI",
            node_type="concept",
            aliases=["A2UI"],
            metadata_json={"canonical_name": "Agent-to-UI"},
        )
        feature = KnowledgeGraphNode(
            node_key="feature:多端-ui-适配",
            label="多端 UI 适配",
            node_type="feature",
            aliases=["跨平台"],
            metadata_json={"canonical_name": "多端 UI 适配"},
        )
        self.session.add_all([product, concept, feature])
        self.session.flush()
        self.session.add_all([
            KnowledgeGraphEdge(
                source_node_id=product.id,
                target_node_id=concept.id,
                relation_type="BASED_ON",
                confidence="EXTRACTED",
                confidence_score=0.95,
                source_article_id=self.article_id,
                evidence_snippet="基于 Agent-to-UI 协议",
            ),
            KnowledgeGraphEdge(
                source_node_id=product.id,
                target_node_id=feature.id,
                relation_type="SOLVES",
                confidence="EXTRACTED",
                confidence_score=0.93,
                source_article_id=self.article_id,
                evidence_snippet="解决多端 UI 适配问题",
            ),
        ])
        self.session.commit()

        response = self.service.structured_query("帮我找支持 Agent-to-UI 协议，并能解决跨平台的应用", top_k=10)

        self.assertEqual(response["parsed_query"]["target_type"], "product")
        self.assertEqual(len(response["results"]), 1)
        self.assertEqual(response["results"][0]["node"]["label"], "AGenUI")
        self.assertEqual(len(response["results"][0]["matched_edges"]), 2)
        self.assertEqual(response["results"][0]["matched_edges"][0]["source_label"], "AGenUI")
        self.assertTrue(any(article["id"] == self.article_id for article in response["related_articles"]))

    def test_answer_question_marks_query_strategy(self):
        product = KnowledgeGraphNode(
            node_key="product:agenui",
            label="AGenUI",
            node_type="product",
            aliases=[],
            metadata_json={"canonical_name": "AGenUI"},
        )
        concept = KnowledgeGraphNode(
            node_key="concept:agent-to-ui",
            label="Agent-to-UI",
            node_type="concept",
            aliases=["A2UI"],
            metadata_json={"canonical_name": "Agent-to-UI"},
        )
        feature = KnowledgeGraphNode(
            node_key="feature:多端-ui-适配",
            label="多端 UI 适配",
            node_type="feature",
            aliases=["跨平台"],
            metadata_json={"canonical_name": "多端 UI 适配"},
        )
        self.session.add_all([product, concept, feature])
        self.session.flush()
        self.session.add_all([
            KnowledgeGraphEdge(
                source_node_id=product.id,
                target_node_id=concept.id,
                relation_type="BASED_ON",
                confidence="EXTRACTED",
                confidence_score=0.95,
                source_article_id=self.article_id,
            ),
            KnowledgeGraphEdge(
                source_node_id=product.id,
                target_node_id=feature.id,
                relation_type="SOLVES",
                confidence="EXTRACTED",
                confidence_score=0.93,
                source_article_id=self.article_id,
            ),
        ])
        self.session.commit()
        self.service.rebuild_snapshot()

        structured_response = self.service.answer_question("帮我找支持 Agent-to-UI 协议，并能解决跨平台的应用")
        generic_response = self.service.answer_question("OpenAI 最近有什么变化？")

        self.assertEqual(structured_response["query_strategy"], "structured")
        self.assertEqual(generic_response["query_strategy"], "generic_graph")

    def test_force_rebuild_clears_old_build_history(self):
        self.session.add(
            KnowledgeGraphBuild(
                build_id="old-build",
                status="completed",
                trigger_source="test",
                sync_mode="agent",
                total_articles=0,
                processed_articles=0,
                nodes_upserted=0,
                edges_upserted=0,
                started_at=datetime.now(),
                completed_at=datetime.now(),
                extra_data={},
            )
        )
        self.session.commit()

        result = self.service.sync_articles(force_rebuild=True, sync_mode="agent", trigger_source="test")

        builds = self.session.query(KnowledgeGraphBuild).order_by(KnowledgeGraphBuild.started_at.asc()).all()
        self.assertEqual(result["build"]["status"], "completed")
        self.assertEqual(len(builds), 1)
        self.assertEqual(builds[0].build_id, result["build"]["build_id"])


if __name__ == "__main__":
    unittest.main()
