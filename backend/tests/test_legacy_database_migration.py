import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from backend.app.db import DatabaseManager
from backend.app.db.models import AppSettings, Article, Base, LLMProvider, RSSSource


class LegacyDatabaseMigrationTests(unittest.TestCase):
    def test_migrates_articles_and_skips_legacy_knowledge_graph_data(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            legacy_path = temp_path / "ai_news.db"
            target_path = temp_path / "ai_news_v2.db"

            legacy_engine = create_engine(f"sqlite:///{legacy_path.as_posix()}")
            Base.metadata.create_all(bind=legacy_engine)
            SessionLocal = sessionmaker(bind=legacy_engine, autoflush=False, autocommit=False)
            session = SessionLocal()
            try:
                source = RSSSource(
                    name="Example Source",
                    url="https://example.com/feed.xml",
                    source_type="rss",
                    enabled=True,
                )
                session.add(source)
                session.flush()
                session.add(
                    Article(
                        title="Legacy article",
                        title_zh="旧文章",
                        url="https://example.com/legacy",
                        content="Legacy content",
                        summary="Legacy summary",
                        detailed_summary="Legacy detailed summary",
                        source_id=source.id,
                        source="Example Source",
                        published_at=datetime(2026, 5, 1, 8, 0, 0),
                        collected_at=datetime(2026, 5, 1, 9, 0, 0),
                        importance="high",
                        tags=["agent"],
                        topics=["technology_evolution"],
                    )
                )
                session.add(
                    AppSettings(
                        key="selected_llm_provider_id",
                        value="1",
                        value_type="string",
                        description="normal setting",
                    )
                )
                session.add(
                    AppSettings(
                        key="knowledge_graph_layout",
                        value="legacy",
                        value_type="string",
                        description="legacy graph setting",
                    )
                )
                session.add(
                    LLMProvider(
                        name="Example LLM",
                        provider_type="大模型(OpenAI)",
                        api_key="test-key",
                        api_base="https://example.com/v1",
                        llm_model="test-model",
                        enabled=True,
                    )
                )
                session.commit()
                with legacy_engine.connect() as conn:
                    conn.execute(text("CREATE TABLE knowledge_graph_nodes (id INTEGER PRIMARY KEY, name TEXT)"))
                    conn.execute(text("INSERT INTO knowledge_graph_nodes (id, name) VALUES (1, 'legacy')"))
                    conn.commit()
            finally:
                session.close()
                legacy_engine.dispose()

            manager = DatabaseManager(
                database_url=f"sqlite:///{target_path.as_posix()}",
                legacy_database_url=f"sqlite:///{legacy_path.as_posix()}",
            )
            try:
                with manager.get_session() as migrated:
                    self.assertEqual(migrated.query(Article).count(), 1)
                    self.assertEqual(migrated.query(RSSSource).count(), 1)
                    self.assertEqual(migrated.query(LLMProvider).count(), 1)
                    self.assertIsNotNone(
                        migrated.query(AppSettings)
                        .filter(AppSettings.key == "legacy_ai_news_migration_completed_at")
                        .first()
                    )
                    self.assertIsNotNone(
                        migrated.query(AppSettings)
                        .filter(AppSettings.key == "selected_llm_provider_id")
                        .first()
                    )
                    self.assertIsNone(
                        migrated.query(AppSettings)
                        .filter(AppSettings.key == "knowledge_graph_layout")
                        .first()
                    )

                with manager.engine.connect() as conn:
                    legacy_table = conn.exec_driver_sql(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_graph_nodes'"
                    ).fetchone()
                    self.assertIsNone(legacy_table)
            finally:
                manager.engine.dispose()


if __name__ == "__main__":
    unittest.main()
