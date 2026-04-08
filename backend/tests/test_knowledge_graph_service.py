import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.app.core.settings import settings
from backend.app.db.models import Article, Base
from backend.app.services.knowledge_graph import KnowledgeGraphService


class KnowledgeGraphServiceTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.session = self.SessionLocal()
        self.temp_dir = tempfile.TemporaryDirectory()

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
        snapshot_root = Path(self.temp_dir.name)
        self.service.snapshot_dir = snapshot_root
        self.service.snapshot_path = snapshot_root / "current_snapshot.json"
        self.service.report_path = snapshot_root / "latest_report.md"

    def tearDown(self):
        settings.KNOWLEDGE_GRAPH_ENABLED = self.original_enabled
        settings.KNOWLEDGE_GRAPH_QUERY_DEPTH = self.original_query_depth
        settings.KNOWLEDGE_GRAPH_MAX_ARTICLES_PER_SYNC = self.original_max_articles
        self.session.close()
        self.temp_dir.cleanup()

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


if __name__ == "__main__":
    unittest.main()
