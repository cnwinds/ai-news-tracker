import json
import unittest
from datetime import datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.api.v1.endpoints import industry_graph as industry_graph_endpoints
from backend.app.db.models import Article, Base, IndustryDocument
from backend.app.services.industry_graph import IndustryGraphService


class IndustryGraphApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=self.engine)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        self.session = self.SessionLocal()
        self.service = IndustryGraphService(db=self.session)

        article = Article(
            title="Diffusion transformer planning reaches production robotics",
            title_zh="扩散 Transformer 规划进入生产机器人",
            url="https://example.com/diffusion-transformer-robotics",
            content="Diffusion Transformer Planning is used by robotics companies.",
            summary="The technology is moving from papers into robotics products.",
            detailed_summary="扩散 Transformer 规划正在从论文进入机器人产品。",
            source="Example Robotics",
            author="Bob",
            published_at=datetime(2026, 4, 18, 8, 0, 0),
            collected_at=datetime(2026, 4, 18, 9, 0, 0),
            importance="high",
            tags=["robotics", "diffusion"],
            topics=["technology_evolution"],
            is_processed=True,
            is_sent=False,
            is_favorited=False,
        )
        self.session.add(article)
        self.session.commit()
        self.service.import_articles()

        document = self.session.query(IndustryDocument).one()
        technology = self.service.upsert_entity(
            entity_type="Technology",
            canonical_name="Diffusion Transformer Planning",
            aliases=["扩散 Transformer 规划"],
        )
        product = self.service.upsert_entity(
            entity_type="Product",
            canonical_name="Robotics Planner",
        )
        company = self.service.upsert_entity(
            entity_type="Company",
            canonical_name="Example Robotics",
        )
        self.service.upsert_relation(
            source_entity=technology,
            target_entity=product,
            relation_type="USES",
            document=document,
            evidence_snippet="Diffusion Transformer Planning is used by robotics products.",
            confidence_score=0.92,
        )
        self.service.upsert_relation(
            source_entity=company,
            target_entity=product,
            relation_type="DEVELOPED",
            document=document,
            evidence_snippet="Example Robotics developed Robotics Planner.",
            confidence_score=0.91,
        )
        self.session.commit()

        self.app = FastAPI()
        self.app.include_router(industry_graph_endpoints.router, prefix="/industry-graph")
        self.app.dependency_overrides[industry_graph_endpoints.get_industry_graph_service] = (
            lambda: self.service
        )
        self.app.dependency_overrides[industry_graph_endpoints.require_auth] = lambda: "test-user"
        self.client = TestClient(self.app)

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def test_stats_endpoint(self):
        response = self.client.get("/industry-graph/stats")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["total_documents"], 1)
        self.assertEqual(payload["total_entities"], 3)
        self.assertEqual(payload["total_relations"], 2)

    def test_suggested_questions_endpoint_generates_defaults(self):
        response = self.client.get("/industry-graph/suggested-questions?limit=3")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["items"]), 3)
        self.assertIn("question", payload["items"][0])

    def test_process_articles_endpoint_runs_incremental_extraction(self):
        response = self.client.post(
            "/industry-graph/documents/process-articles",
            json={"limit": 1, "import_first": True},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["processed"], 1)
        self.assertEqual(payload["failed"], 0)
        self.assertGreaterEqual(payload["entities_upserted"], 1)
        self.assertGreaterEqual(payload["relations_upserted"], 1)

    def test_rebuild_endpoint_runs_batch_rebuild(self):
        response = self.client.post(
            "/industry-graph/documents/rebuild",
            json={"batch_size": 1, "max_documents": 1, "clear_existing_graph": True},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["processed"], 1)
        self.assertEqual(payload["failed"], 0)
        self.assertGreaterEqual(payload["stats"]["total_entities"], 1)

    def test_query_endpoint_returns_chat_report(self):
        response = self.client.post(
            "/industry-graph/query",
            json={"question": "最近 3 个月技术方面有什么新的变化趋势？", "top_k": 5},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertGreater(payload["conversation_id"], 0)
        self.assertEqual(payload["query_plan"]["primary_scenario"], "technology_evolution")
        self.assertTrue(payload["trends"])
        self.assertTrue(payload["subgraph"]["nodes"])
        self.assertTrue(any(block["type"] == "local_graph" for block in payload["content_blocks"]))

    def test_conversation_followup_reuses_context(self):
        first = self.client.post(
            "/industry-graph/query",
            json={"question": "哪些技术在升温？", "top_k": 5},
        )
        conversation_id = first.json()["conversation_id"]

        second = self.client.post(
            "/industry-graph/query",
            json={"question": "有哪些证据？", "conversation_id": conversation_id, "top_k": 5},
        )

        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["conversation_id"], conversation_id)

        conversation_response = self.client.get(f"/industry-graph/conversations/{conversation_id}")
        self.assertEqual(conversation_response.status_code, 200)
        self.assertEqual(len(conversation_response.json()["messages"]), 4)

    def test_stream_query_endpoint_returns_sse_chunks(self):
        with self.client.stream(
            "POST",
            "/industry-graph/query/stream",
            json={"question": "哪些技术正在进入产品？", "top_k": 5},
        ) as response:
            self.assertEqual(response.status_code, 200)
            raw = response.read().decode("utf-8")

        chunks = []
        for block in raw.strip().split("\n\n"):
            if not block.startswith("data: "):
                continue
            chunks.append(json.loads(block[6:]))

        chunk_types = [chunk["type"] for chunk in chunks]
        self.assertEqual(chunk_types[0], "query_plan")
        self.assertIn("trend_card", chunk_types)
        self.assertIn("local_graph", chunk_types)
        self.assertEqual(chunk_types[-1], "done")


if __name__ == "__main__":
    unittest.main()
