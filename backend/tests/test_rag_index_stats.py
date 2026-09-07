import unittest
from datetime import datetime
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.models import Article, ArticleEmbedding, Base
from backend.app.services.rag.rag_service import RAGService


class RAGIndexStatsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.session = self.SessionLocal()
        self.service = RAGService(ai_analyzer=SimpleNamespace(embedding_model="test"), db=self.session)

        articles = [
            Article(
                title="Alpha paper",
                url="https://example.com/a",
                content="long content that must not be required for stats",
                summary="alpha",
                source="SourceA",
                published_at=datetime(2026, 1, 1),
                collected_at=datetime(2026, 1, 1),
            ),
            Article(
                title="Beta paper",
                url="https://example.com/b",
                content="another long body",
                summary="beta",
                source="SourceA",
                published_at=datetime(2026, 1, 2),
                collected_at=datetime(2026, 1, 2),
            ),
            Article(
                title="Gamma paper",
                url="https://example.com/c",
                content="unindexed body",
                summary="gamma",
                source="SourceB",
                published_at=datetime(2026, 1, 3),
                collected_at=datetime(2026, 1, 3),
            ),
        ]
        self.session.add_all(articles)
        self.session.flush()

        self.session.add_all(
            [
                ArticleEmbedding(
                    article_id=articles[0].id,
                    embedding=[0.1, 0.2, 0.3],
                    text_content="indexed alpha text",
                    embedding_model="test",
                ),
                ArticleEmbedding(
                    article_id=articles[1].id,
                    embedding=[0.4, 0.5, 0.6],
                    text_content="indexed beta text",
                    embedding_model="test",
                ),
            ]
        )
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_index_stats_uses_counts_not_full_join(self):
        stats = self.service.get_index_stats()

        self.assertEqual(stats["total_articles"], 3)
        self.assertEqual(stats["indexed_articles"], 2)
        self.assertEqual(stats["unindexed_articles"], 1)
        self.assertAlmostEqual(stats["index_coverage"], 2 / 3)
        self.assertEqual(stats["source_stats"], {"SourceA": 2})
        self.assertIn(stats["vector_backend"], ("python", "none"))
        self.assertIsNone(stats["vec_index_count"])

    def test_python_search_does_not_require_full_article_content(self):
        query_embedding = [0.1, 0.2, 0.3]
        results = self.service._search_with_python(query_embedding, top_k=2)

        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["title"], "Alpha paper")
        self.assertGreater(results[0]["similarity"], results[1]["similarity"])
        self.assertEqual(self.service._last_search_backend, "python")


if __name__ == "__main__":
    unittest.main()
