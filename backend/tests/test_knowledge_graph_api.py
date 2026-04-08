import shutil
import unittest
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.api.v1.endpoints import knowledge_graph as knowledge_graph_endpoints
from backend.app.core.settings import settings
from backend.app.db.models import Article, Base
from backend.app.services.knowledge_graph import KnowledgeGraphService


class KnowledgeGraphApiTests(unittest.TestCase):
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
            title="OpenAI launches a reasoning benchmark",
            title_zh="OpenAI 发布推理基准",
            url="https://example.com/openai-benchmark",
            content="OpenAI discussed reasoning, evaluation and benchmark performance.",
            summary="The article covers OpenAI reasoning and evaluation benchmarks.",
            detailed_summary="OpenAI introduced a new reasoning benchmark and compared model performance.",
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

        self.service = KnowledgeGraphService(db=self.session, ai_analyzer=None)
        self.service.snapshot_dir = self.temp_dir
        self.service.snapshot_path = self.temp_dir / "current_snapshot.json"
        self.service.report_path = self.temp_dir / "latest_report.md"
        self.service.sync_articles(sync_mode="deterministic", trigger_source="test")

        self.app = FastAPI()
        self.app.include_router(knowledge_graph_endpoints.router, prefix="/knowledge-graph")
        self.app.dependency_overrides[knowledge_graph_endpoints.get_knowledge_graph_service] = (
            lambda: self.service
        )
        self.client = TestClient(self.app)

    def tearDown(self):
        settings.KNOWLEDGE_GRAPH_ENABLED = self.original_enabled
        settings.KNOWLEDGE_GRAPH_QUERY_DEPTH = self.original_query_depth
        settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC = self.original_max_articles
        self.session.close()
        self.engine.dispose()
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_snapshot_endpoint_accepts_focus_node_keys(self):
        source_nodes = self.service.search_nodes(query="OpenAI", node_type="source", limit=5)
        self.assertTrue(source_nodes)

        response = self.client.get(
            "/knowledge-graph/snapshot",
            params=[
                ("focus_node_keys", source_nodes[0]["node_key"]),
                ("expand_depth", "1"),
                ("limit_nodes", "20"),
            ],
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        node_keys = {node["node_key"] for node in payload["nodes"]}
        self.assertIn(source_nodes[0]["node_key"], node_keys)
        self.assertGreaterEqual(payload["total_links"], 1)

    def test_community_detail_endpoint_returns_summary_text(self):
        communities = self.service.get_communities(limit=5)
        self.assertTrue(communities)

        response = self.client.get(f"/knowledge-graph/communities/{communities[0]['community_id']}")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("summary_text", payload)
        self.assertIn(communities[0]["label"], payload["summary_text"])
        self.assertIn("relation_types", payload)


if __name__ == "__main__":
    unittest.main()
