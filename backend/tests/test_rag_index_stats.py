import os
import unittest
from datetime import datetime
from types import SimpleNamespace

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.models import Article, ArticleEmbedding, Base
from backend.app.services.rag.query_cache import QueryEmbeddingCache, query_embedding_cache
from backend.app.services.rag.rag_service import (
    RAGService,
    VectorSearchUnavailable,
    compute_index_stats,
)


def _article(title, url, source, content="long content that must not be required"):
    return Article(
        title=title,
        url=url,
        content=content,
        summary=title.lower(),
        source=source,
        published_at=datetime(2026, 1, 1),
        collected_at=datetime(2026, 1, 1),
    )


class RAGIndexStatsTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        with self.engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS vec_embeddings (
                    article_id INTEGER PRIMARY KEY,
                    embedding TEXT
                )
            """))
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.session = self.SessionLocal()
        self.service = RAGService(
            ai_analyzer=SimpleNamespace(embedding_model="test"),
            db=self.session,
        )

        articles = [
            _article("Alpha paper", "https://example.com/a", "SourceA"),
            _article("Beta paper", "https://example.com/b", "SourceA"),
            _article("Gamma paper", "https://example.com/c", "SourceB"),
        ]
        self.session.add_all(articles)
        self.session.flush()
        self.articles = articles

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
        os.environ.pop("RAG_ALLOW_PYTHON_FULL_SCAN", None)
        self.session.close()
        self.engine.dispose()

    def test_index_stats_uses_counts_not_full_join(self):
        stats = compute_index_stats(self.session)

        self.assertEqual(stats["total_articles"], 3)
        self.assertEqual(stats["indexed_articles"], 2)
        self.assertEqual(stats["unindexed_articles"], 1)
        self.assertAlmostEqual(stats["index_coverage"], 2 / 3)
        self.assertEqual(stats["source_stats"], {"SourceA": 2})
        self.assertEqual(stats["vec_index_count"], 0)
        self.assertEqual(stats["vec_missing_count"], 2)
        self.assertEqual(stats["vector_backend"], "sqlite-vec")

    def test_python_search_allowed_on_small_index(self):
        results = self.service._search_or_refuse_python(
            [0.1, 0.2, 0.3], top_k=2, filters=None, reason="test"
        )
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["title"], "Alpha paper")
        self.assertEqual(self.service._last_search_backend, "python")

    def test_python_search_refused_at_production_scale(self):
        self.service.PYTHON_FULL_SCAN_MAX_ROWS = 1
        with self.assertRaises(VectorSearchUnavailable) as ctx:
            self.service._search_or_refuse_python(
                [0.1, 0.2, 0.3], top_k=2, filters=None, reason="vec empty"
            )
        self.assertEqual(self.service._last_search_backend, "refused")
        self.assertIn("sync-vec", str(ctx.exception))

    def test_env_override_allows_full_scan(self):
        os.environ["RAG_ALLOW_PYTHON_FULL_SCAN"] = "1"
        self.service.PYTHON_FULL_SCAN_MAX_ROWS = 1
        results = self.service._search_or_refuse_python(
            [0.1, 0.2, 0.3], top_k=2, filters=None, reason="debug"
        )
        self.assertEqual(len(results), 2)
        self.assertEqual(self.service._last_search_backend, "python")

    def test_sync_json_to_vec_is_idempotent(self):
        first = self.service.sync_json_to_vec(batch_size=10)
        self.assertEqual(first["synced"], 2)
        self.assertEqual(first["vec_count_after"], 2)
        self.assertEqual(first["missing_before"], 2)

        second = self.service.sync_json_to_vec(batch_size=10)
        self.assertEqual(second["synced"], 0)
        self.assertEqual(second["missing_before"], 0)
        self.assertEqual(second["vec_count_after"], 2)

        stats = compute_index_stats(self.session)
        self.assertEqual(stats["vec_index_count"], 2)
        self.assertEqual(stats["vec_missing_count"], 0)

    def test_query_embedding_cache_skips_second_api_call(self):
        calls = {"n": 0}

        def generate_embedding(text):
            calls["n"] += 1
            return [0.1, 0.2, 0.3]

        self.service.ai_analyzer = SimpleNamespace(
            embedding_model="test-model",
            generate_embedding=generate_embedding,
        )
        query_embedding_cache.clear()
        first = self.service.generate_embedding("hello world")
        second = self.service.generate_embedding("hello world")
        self.assertEqual(first, [0.1, 0.2, 0.3])
        self.assertEqual(second, [0.1, 0.2, 0.3])
        self.assertEqual(calls["n"], 1)
        query_embedding_cache.clear()


class QueryEmbeddingCacheTests(unittest.TestCase):
    def test_hit_and_ttl_and_clear(self):
        cache = QueryEmbeddingCache(maxsize=2, ttl_seconds=60)
        cache.set("m", "hello", [1.0, 2.0])
        self.assertEqual(cache.get("m", "hello"), [1.0, 2.0])
        self.assertIsNone(cache.get("m", "missing"))
        cache.clear()
        self.assertIsNone(cache.get("m", "hello"))

    def test_lru_eviction(self):
        cache = QueryEmbeddingCache(maxsize=2, ttl_seconds=60)
        cache.set("m", "a", [1.0])
        cache.set("m", "b", [2.0])
        cache.set("m", "c", [3.0])
        self.assertIsNone(cache.get("m", "a"))
        self.assertEqual(cache.get("m", "b"), [2.0])
        self.assertEqual(cache.get("m", "c"), [3.0])


if __name__ == "__main__":
    unittest.main()
