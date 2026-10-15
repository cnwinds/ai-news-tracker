import unittest
from pathlib import Path

RAG_ENDPOINTS = Path(__file__).resolve().parents[1] / "app" / "api" / "v1" / "endpoints" / "rag.py"


class RAGRouteOrderTests(unittest.TestCase):
    def test_sync_vec_declared_before_article_id(self):
        source = RAG_ENDPOINTS.read_text(encoding="utf-8")
        sync_pos = source.index('@router.post("/index/sync-vec"')
        article_pos = source.index('@router.post("/index/{article_id}"')
        self.assertLess(
            sync_pos,
            article_pos,
            "/index/sync-vec must be declared before /index/{article_id}; "
            "otherwise FastAPI treats 'sync-vec' as article_id and returns 422",
        )


if __name__ == "__main__":
    unittest.main()
