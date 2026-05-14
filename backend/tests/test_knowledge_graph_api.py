import json
import shutil
import unittest
import uuid
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api.v1.endpoints import knowledge_graph as knowledge_graph_endpoints
from backend.app.core.settings import settings
from backend.app.db.models import Article, Base
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


class KnowledgeGraphApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
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
            title="OpenAI launches GPT-Next",
            title_zh="OpenAI 发布 GPT-Next",
            url="https://example.com/openai-gpt-next",
            content="OpenAI discussed GPT-Next, Transformer and reasoning optimization.",
            summary="The article covers OpenAI, GPT-Next and its reasoning improvements.",
            detailed_summary="OpenAI 发布 GPT-Next，基于 Transformer，并具备推理优化能力。",
            source="OpenAI",
            author="Alice",
            published_at=datetime(2026, 4, 1, 8, 0, 0),
            collected_at=datetime(2026, 4, 1, 9, 0, 0),
            importance="high",
            tags=["OpenAI", "benchmark"],
            topics=["reasoning", "evaluation"],
            related_papers=["Reasoning Benchmark"],
            is_processed=True,
            is_sent=False,
            is_favorited=False,
            created_at=datetime(2026, 4, 1, 9, 0, 0),
            updated_at=datetime(2026, 4, 1, 9, 0, 0),
        )
        self.session.add(article)
        self.session.commit()
        self.article_id = article.id

        payload = {
            "entities": [
                {
                    "id": "OpenAI",
                    "canonical_name": "OpenAI",
                    "label": "Organization",
                    "aliases": [],
                    "description": "AI organization",
                    "properties": {},
                },
                {
                    "id": "GPT-Next",
                    "canonical_name": "GPT-Next",
                    "label": "Product",
                    "aliases": [],
                    "description": "Reasoning-focused product",
                    "properties": {},
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
                    "evidence_snippet": "OpenAI launched GPT-Next",
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

        self.service = KnowledgeGraphService(db=self.session, ai_analyzer=make_ai_analyzer(payload))
        self.service.snapshot_dir = self.temp_dir
        self.service.snapshot_path = self.temp_dir / "current_snapshot.json"
        self.service.report_path = self.temp_dir / "latest_report.md"
        self.service.sync_articles(sync_mode="agent", trigger_source="test")

        self.app = FastAPI()
        self.app.include_router(knowledge_graph_endpoints.router, prefix="/knowledge-graph")
        self.app.dependency_overrides[knowledge_graph_endpoints.get_knowledge_graph_service] = (
            lambda: self.service
        )
        self.app.dependency_overrides[knowledge_graph_endpoints.require_auth] = lambda: "test-user"
        self.client = TestClient(self.app)

    def tearDown(self):
        settings.KNOWLEDGE_GRAPH_ENABLED = self.original_enabled
        settings.KNOWLEDGE_GRAPH_QUERY_DEPTH = self.original_query_depth
        settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC = self.original_max_articles
        self.session.close()
        self.engine.dispose()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_snapshot_endpoint_accepts_focus_node_keys(self):
        organization_nodes = self.service.search_nodes(query="OpenAI", node_type="organization", limit=5)
        self.assertTrue(organization_nodes)

        response = self.client.get(
            "/knowledge-graph/snapshot",
            params=[
                ("focus_node_keys", organization_nodes[0]["node_key"]),
                ("expand_depth", "1"),
                ("limit_nodes", "20"),
            ],
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        node_keys = {node["node_key"] for node in payload["nodes"]}
        self.assertIn(organization_nodes[0]["node_key"], node_keys)
        self.assertGreaterEqual(payload["total_links"], 1)

    def test_article_context_endpoint_returns_related_nodes_and_edges(self):
        response = self.client.get(f"/knowledge-graph/articles/{self.article_id}/context")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["article_id"], self.article_id)
        self.assertGreaterEqual(len(payload["nodes"]), 1)
        self.assertGreaterEqual(len(payload["edges"]), 1)

    def test_sync_endpoint_rejects_removed_deterministic_mode(self):
        response = self.client.post(
            "/knowledge-graph/sync",
            json={"sync_mode": "deterministic", "trigger_source": "test"},
        )

        self.assertEqual(response.status_code, 422)

    def test_integrity_endpoint_returns_report(self):
        response = self.client.get("/knowledge-graph/integrity")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("healthy", payload)
        self.assertIn("issues", payload)
        self.assertIn("recommendations", payload)

    def test_integrity_repair_endpoint_supports_dry_run(self):
        response = self.client.post(
            "/knowledge-graph/integrity/repair",
            json={"dry_run": True, "cleanup_orphans": True, "rebuild_snapshot": True},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["dry_run"])
        self.assertFalse(payload["repaired"])
        self.assertIn("before", payload)

    def test_structured_query_endpoint_returns_results(self):
        article = self.session.query(Article).first()
        from backend.app.db.models import KnowledgeGraphEdge, KnowledgeGraphNode

        product_node = KnowledgeGraphNode(
            node_key="product:agenui",
            label="AGenUI",
            node_type="product",
            aliases=[],
            metadata_json={"canonical_name": "AGenUI"},
        )
        concept_node = KnowledgeGraphNode(
            node_key="concept:agent-to-ui",
            label="Agent-to-UI",
            node_type="concept",
            aliases=["A2UI"],
            metadata_json={"canonical_name": "Agent-to-UI"},
        )
        feature_node = KnowledgeGraphNode(
            node_key="feature:多端-ui-适配",
            label="多端 UI 适配",
            node_type="feature",
            aliases=["跨平台"],
            metadata_json={"canonical_name": "多端 UI 适配"},
        )
        self.session.add_all([product_node, concept_node, feature_node])
        self.session.flush()
        self.session.add_all([
            KnowledgeGraphEdge(
                source_node_id=product_node.id,
                target_node_id=concept_node.id,
                relation_type="BASED_ON",
                confidence="EXTRACTED",
                confidence_score=0.95,
                source_article_id=article.id,
                evidence_snippet="基于 Agent-to-UI 协议",
            ),
            KnowledgeGraphEdge(
                source_node_id=product_node.id,
                target_node_id=feature_node.id,
                relation_type="SOLVES",
                confidence="EXTRACTED",
                confidence_score=0.93,
                source_article_id=article.id,
                evidence_snippet="解决多端 UI 适配问题",
            ),
        ])
        self.session.commit()
        self.service._graph = None
        self.service._snapshot_cache = None

        response = self.client.post(
            "/knowledge-graph/structured-query",
            json={"question": "帮我找支持 Agent-to-UI 协议，并能解决跨平台的应用", "top_k": 10},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["parsed_query"]["target_type"], "product")
        self.assertEqual(len(payload["results"]), 1)
        self.assertEqual(payload["results"][0]["node"]["label"], "AGenUI")
        self.assertGreaterEqual(len(payload["related_articles"]), 1)


if __name__ == "__main__":
    unittest.main()
