import json
import unittest
from datetime import datetime
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from backend.app.db.models import Article, Base, IndustryDocument, IndustryDocumentScenarioState
from backend.app.services.industry_graph import IndustryGraphService


def make_ai_analyzer(content: str) -> SimpleNamespace:
    def create(**kwargs):
        if kwargs.get("stream"):
            midpoint = max(1, len(content) // 2)
            return iter(
                [
                    SimpleNamespace(
                        choices=[SimpleNamespace(delta=SimpleNamespace(content=content[:midpoint]))]
                    ),
                    SimpleNamespace(
                        choices=[SimpleNamespace(delta=SimpleNamespace(content=content[midpoint:]))]
                    ),
                ]
            )
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
        )

    return SimpleNamespace(
        model="test-model",
        client=SimpleNamespace(
            chat=SimpleNamespace(
                completions=SimpleNamespace(
                    create=create
                )
            )
        ),
    )


class IndustryGraphServiceTests(unittest.TestCase):
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

        self.article = Article(
            title="New agent memory architecture improves tool use",
            title_zh="新的 Agent 记忆架构提升工具使用能力",
            url="https://example.com/agent-memory",
            content="A paper proposes Agent Memory Graph and connects it with product copilots.",
            summary="Agent Memory Graph is gaining adoption in product copilots.",
            detailed_summary="论文提出 Agent Memory Graph，并被产品型 Copilot 采用。",
            source="Example Research",
            author="Alice",
            published_at=datetime(2026, 4, 10, 8, 0, 0),
            collected_at=datetime(2026, 4, 10, 9, 0, 0),
            importance="high",
            tags=["agent", "memory"],
            topics=["technology_evolution"],
            is_processed=True,
            is_sent=False,
            is_favorited=False,
        )
        self.session.add(self.article)
        self.session.commit()

    def tearDown(self):
        self.session.close()
        self.engine.dispose()

    def _seed_graph(self):
        import_result = self.service.import_articles()
        self.assertEqual(import_result, {"imported": 1, "skipped": 0})
        document = self.session.query(IndustryDocument).one()

        technology = self.service.upsert_entity(
            entity_type="Technology",
            canonical_name="Agent Memory Graph",
            aliases=["代理记忆图"],
            description="Graph-based long-term memory for agents.",
        )
        product = self.service.upsert_entity(
            entity_type="Product",
            canonical_name="Copilot Studio",
            description="Product copilot platform.",
        )
        paper = self.service.upsert_entity(
            entity_type="Paper",
            canonical_name="Agent Memory Graph Paper",
        )

        self.service.upsert_relation(
            source_entity=paper,
            target_entity=technology,
            relation_type="PROPOSES",
            document=document,
            evidence_snippet="论文提出 Agent Memory Graph。",
            confidence_score=0.94,
        )
        self.service.upsert_relation(
            source_entity=technology,
            target_entity=product,
            relation_type="USES",
            document=document,
            evidence_snippet="Agent Memory Graph 被产品型 Copilot 采用。",
            confidence_score=0.9,
        )
        self.session.commit()
        return technology, product, paper

    def test_import_articles_is_idempotent(self):
        first = self.service.import_articles()
        second = self.service.import_articles()

        self.assertEqual(first, {"imported": 1, "skipped": 0})
        self.assertEqual(second, {"imported": 0, "skipped": 1})
        self.assertEqual(self.session.query(IndustryDocument).count(), 1)

    def test_process_articles_extracts_graph_facts_with_fallback(self):
        result = self.service.process_articles(limit=1, import_first=True)

        self.assertEqual(result["processed"], 1)
        self.assertGreaterEqual(result["entities_upserted"], 1)
        self.assertGreaterEqual(result["relations_upserted"], 1)
        self.assertEqual(result["failed"], 0)

        stats = self.service.get_stats()
        self.assertEqual(stats["processed_documents"], 1)
        self.assertEqual(stats["pending_documents"], 0)

        state = self.session.query(IndustryDocumentScenarioState).one()
        self.assertEqual(state.status, "completed")

    def test_process_articles_uses_llm_extraction_when_available(self):
        service = IndustryGraphService(
            db=self.session,
            ai_analyzer=make_ai_analyzer(
                json.dumps(
                    {
                        "entities": [
                            {"id": "paper", "type": "Paper", "name": "Agent Memory Graph Paper"},
                            {"id": "tech", "type": "Technology", "name": "Agent Memory Graph"},
                            {"id": "product", "type": "Product", "name": "Copilot Studio"},
                        ],
                        "relations": [
                            {
                                "source": "paper",
                                "target": "tech",
                                "type": "PROPOSES",
                                "evidence_snippet": "论文提出 Agent Memory Graph。",
                                "confidence_score": 0.94,
                            },
                            {
                                "source": "tech",
                                "target": "product",
                                "type": "USES",
                                "evidence_snippet": "Agent Memory Graph 被产品型 Copilot 采用。",
                                "confidence_score": 0.9,
                            },
                        ],
                    },
                    ensure_ascii=False,
                )
            ),
        )

        result = service.process_articles(limit=1, import_first=True)

        self.assertEqual(result["processed"], 1)
        self.assertEqual(result["processed_documents"][0]["entities"], 3)
        self.assertEqual(result["processed_documents"][0]["relations"], 2)
        self.assertEqual(service.get_stats()["total_relations"], 2)

    def test_upsert_relation_stores_evidence_and_updates_stats(self):
        technology, product, _ = self._seed_graph()

        stats = self.service.get_stats()
        self.assertEqual(stats["total_documents"], 1)
        self.assertEqual(stats["total_entities"], 3)
        self.assertEqual(stats["total_relations"], 2)
        self.assertEqual(stats["total_evidence"], 2)

        self.session.refresh(technology)
        self.session.refresh(product)
        self.assertGreaterEqual(technology.degree, 2)
        self.assertGreaterEqual(product.article_count, 1)

    def test_answer_question_returns_report_blocks_and_conversation(self):
        self._seed_graph()

        result = self.service.answer_question("最近 3 个月技术方面有什么新的变化趋势？", top_k=5)

        self.assertGreater(result["conversation_id"], 0)
        self.assertEqual(result["query_plan"]["primary_scenario"], "technology_evolution")
        self.assertTrue(result["trends"])
        self.assertTrue(result["evidence"])
        self.assertTrue(result["subgraph"]["nodes"])
        self.assertTrue(any(block["type"] == "trend_card" for block in result["content_blocks"]))
        self.assertIn("总体判断", result["content_blocks"][0]["data"]["text"])

        conversation = self.service.get_conversation(result["conversation_id"])
        self.assertEqual(len(conversation["messages"]), 2)
        self.assertEqual(conversation["messages"][0]["role"], "user")
        self.assertEqual(conversation["messages"][1]["role"], "assistant")

    def test_answer_question_uses_llm_to_synthesize_final_answer(self):
        self._seed_graph()
        service = IndustryGraphService(
            db=self.session,
            ai_analyzer=make_ai_analyzer("总体判断：Agent Memory Graph 正在从论文信号走向产品化验证。"),
        )

        result = service.answer_question("最近 3 个月技术方面有什么新的变化趋势？", top_k=5)

        self.assertEqual(
            result["content_blocks"][0]["data"]["text"],
            "总体判断：Agent Memory Graph 正在从论文信号走向产品化验证。",
        )
        self.assertTrue(any(block["type"] == "evidence_card" for block in result["content_blocks"]))

    def test_stream_answer_emits_report_chunks(self):
        self._seed_graph()
        service = IndustryGraphService(
            db=self.session,
            ai_analyzer=make_ai_analyzer("总体判断：Agent Memory Graph 正在升温。"),
        )

        chunks = list(service.stream_answer("哪些技术在升温？", top_k=5))
        chunk_types = [chunk["type"] for chunk in chunks]

        self.assertEqual(chunk_types[0], "query_plan")
        self.assertIn("text_delta", chunk_types)
        self.assertIn("trend_card", chunk_types)
        self.assertIn("local_graph", chunk_types)
        self.assertLess(chunk_types.index("trend_card"), chunk_types.index("text_delta"))
        self.assertEqual(
            "".join(chunk["data"]["content"] for chunk in chunks if chunk["type"] == "text_delta"),
            "总体判断：Agent Memory Graph 正在升温。",
        )
        self.assertEqual(chunk_types[-1], "done")
        self.assertGreater(chunks[-1]["data"]["conversation_id"], 0)

    def test_generate_suggested_questions(self):
        self._seed_graph()

        questions = self.service.generate_suggested_questions(limit=4)

        self.assertEqual(len(questions), 4)
        self.assertTrue(any("Agent Memory Graph" in item["question"] for item in questions))

    def test_generate_suggested_questions_uses_llm_when_available(self):
        self._seed_graph()
        service = IndustryGraphService(
            db=self.session,
            ai_analyzer=make_ai_analyzer('["哪些技术正在发生融合？", "论文到产品路径有哪些新信号？"]'),
        )

        questions = service.generate_suggested_questions(limit=2)

        self.assertEqual([item["question"] for item in questions], [
            "哪些技术正在发生融合？",
            "论文到产品路径有哪些新信号？",
        ])

    def test_rebuild_all_articles_can_clear_existing_graph(self):
        self._seed_graph()

        result = self.service.rebuild_all_articles(
            batch_size=1,
            max_documents=1,
            clear_existing_graph=True,
        )

        self.assertEqual(result["processed"], 1)
        self.assertGreater(result["cleared"]["entities"], 0)
        self.assertGreaterEqual(result["stats"]["total_entities"], 1)
        self.assertEqual(result["stats"]["processed_documents"], 1)


if __name__ == "__main__":
    unittest.main()
