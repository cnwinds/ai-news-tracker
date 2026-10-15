import sqlite3
import tempfile
import unittest
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from backend.app.db import load_sqlite_vec_on_dbapi, sqlite_vec_extension_loaded


def _sqlite_vec_available() -> bool:
    try:
        import sqlite_vec  # noqa: F401
    except ImportError:
        return False
    return sqlite3.sqlite_version_info >= (3, 41, 0)


@unittest.skipUnless(_sqlite_vec_available(), "sqlite-vec not installed")
class SQLiteVecSessionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "vec.db")
        raw = sqlite3.connect(self.db_path)
        raw.enable_load_extension(True)
        import sqlite_vec
        sqlite_vec.load(raw)
        raw.execute(
            "CREATE VIRTUAL TABLE vec_embeddings USING vec0("
            "article_id INTEGER PRIMARY KEY, embedding float[2] DISTANCE_METRIC=cosine)"
        )
        raw.execute("INSERT INTO vec_embeddings (article_id, embedding) VALUES (1, '[0.1,0.2]')")
        raw.commit()
        raw.close()

        self.engine = create_engine(
            f"sqlite:///{self.db_path}",
            connect_args={"check_same_thread": False, "timeout": 30},
        )
        # 模拟旧顺序：先占用连接池，此时还没有 sqlite-vec
        with self.engine.connect() as conn:
            conn.execute(text("PRAGMA journal_mode=WAL"))
            conn.commit()

    def tearDown(self):
        self.engine.dispose()
        self.tmp.cleanup()

    def test_pooled_session_lacks_vec0_until_checkout_load(self):
        SessionLocal = sessionmaker(bind=self.engine)
        session = SessionLocal()
        try:
            with self.assertRaises(Exception) as ctx:
                session.execute(text("SELECT COUNT(*) FROM vec_embeddings")).scalar()
            self.assertIn("vec0", str(ctx.exception).lower())
        finally:
            session.close()

        @event.listens_for(self.engine, "checkout")
        def load_on_checkout(dbapi_conn, connection_record, _proxy):
            load_sqlite_vec_on_dbapi(dbapi_conn)
            connection_record.info["sqlite_vec_loaded"] = True

        session = SessionLocal()
        try:
            count = session.execute(text("SELECT COUNT(*) FROM vec_embeddings")).scalar()
            self.assertEqual(count, 1)
            dbapi_conn = session.connection().connection.dbapi_connection
            self.assertTrue(sqlite_vec_extension_loaded(dbapi_conn))
        finally:
            session.close()


if __name__ == "__main__":
    unittest.main()
