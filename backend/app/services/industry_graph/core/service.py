"""
Industry trend graph service.

This first version focuses on the technology-evolution scenario and keeps
PostgreSQL/SQLAlchemy as the source of truth. Neo4j synchronization is a
separate replaceable layer and is intentionally not required for unit tests.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
import unicodedata
from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, Generator, Iterable, List, Optional, Sequence, Set, Tuple

from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.db.models import (
    Article,
    IndustryDocument,
    IndustryGraphBuild,
    IndustryDocumentScenarioState,
    IndustryGraphConversation,
    IndustryGraphEntity,
    IndustryGraphEntityIdentity,
    IndustryGraphEntityName,
    IndustryGraphMessage,
    IndustryGraphRelation,
    IndustryGraphRelationEvidence,
    IndustryGraphSuggestedQuestion,
    TechnologyTrendMetric,
)

TECHNOLOGY_SCENARIO = "technology_evolution"
DEFAULT_GRAPH_VERSION = 1
logger = logging.getLogger(__name__)

TECHNOLOGY_RELATION_TYPES = {
    "PROPOSES",
    "BUILDS_ON",
    "USES",
    "DEVELOPED",
    "PUBLISHED",
    "EVALUATES_ON",
    "IMPROVES",
    "HAS_FEATURE",
    "SOLVES",
    "BELONGS_TO",
    "CONVERGES_WITH",
}

TECHNOLOGY_ENTITY_TYPES = {
    "Paper",
    "Technology",
    "Concept",
    "Product",
    "Company",
    "Person",
    "Benchmark",
    "Feature",
    "Industry",
    "Event",
}


class IndustryGraphService:
    """Service for industry graph facts, reports and chat conversations."""

    def __init__(self, db: Session, ai_analyzer: Optional[Any] = None):
        self.db = db
        self.ai_analyzer = ai_analyzer

    def get_stats(self) -> Dict[str, Any]:
        latest_metric = (
            self.db.query(func.max(TechnologyTrendMetric.generated_at)).scalar()
        )
        completed_documents = int(
            self.db.query(func.count(IndustryDocumentScenarioState.id))
            .filter(IndustryDocumentScenarioState.scenario_key == TECHNOLOGY_SCENARIO)
            .filter(IndustryDocumentScenarioState.status == "completed")
            .scalar()
            or 0
        )
        failed_documents = int(
            self.db.query(func.count(IndustryDocumentScenarioState.id))
            .filter(IndustryDocumentScenarioState.scenario_key == TECHNOLOGY_SCENARIO)
            .filter(IndustryDocumentScenarioState.status == "failed")
            .scalar()
            or 0
        )
        total_documents = int(self.db.query(func.count(IndustryDocument.id)).scalar() or 0)
        return {
            "total_documents": total_documents,
            "processed_documents": completed_documents,
            "failed_documents": failed_documents,
            "pending_documents": max(0, total_documents - completed_documents - failed_documents),
            "total_entities": int(self.db.query(func.count(IndustryGraphEntity.id)).scalar() or 0),
            "total_relations": int(self.db.query(func.count(IndustryGraphRelation.id)).scalar() or 0),
            "total_evidence": int(self.db.query(func.count(IndustryGraphRelationEvidence.id)).scalar() or 0),
            "total_conversations": int(self.db.query(func.count(IndustryGraphConversation.id)).scalar() or 0),
            "latest_metric_generated_at": latest_metric,
        }

    def import_articles(self, *, limit: Optional[int] = None) -> Dict[str, int]:
        query = self.db.query(Article).order_by(
            Article.published_at.is_(None).asc(),
            Article.published_at.desc(),
            Article.id.desc(),
        )
        if limit:
            query = query.limit(max(1, int(limit)))
        imported = 0
        skipped = 0
        for article in query.all():
            content_hash = self._compute_article_hash(article)
            existing = (
                self.db.query(IndustryDocument)
                .filter(IndustryDocument.source_type == "news")
                .filter(IndustryDocument.source_ref_id == article.id)
                .first()
            )
            if existing and existing.content_hash == content_hash:
                skipped += 1
                continue
            content_text = "\n\n".join(
                part for part in [
                    article.title or "",
                    article.title_zh or "",
                    article.summary or "",
                    article.detailed_summary or "",
                    article.content or "",
                ] if part
            )
            if existing:
                existing.title = article.title
                existing.title_zh = article.title_zh
                existing.url = article.url
                existing.source = article.source
                existing.author = article.author
                existing.published_at = article.published_at
                existing.collected_at = article.collected_at
                existing.content_hash = content_hash
                existing.content_text = content_text
                existing.metadata_json = {
                    "importance": article.importance,
                    "tags": article.tags or [],
                    "topics": article.topics or [],
                }
                existing.updated_at = datetime.now()
            else:
                self.db.add(
                    IndustryDocument(
                        source_type="news",
                        source_ref_id=article.id,
                        title=article.title,
                        title_zh=article.title_zh,
                        url=article.url,
                        source=article.source,
                        author=article.author,
                        published_at=article.published_at,
                        collected_at=article.collected_at,
                        language="zh" if article.title_zh else None,
                        content_hash=content_hash,
                        content_text=content_text,
                        metadata_json={
                            "importance": article.importance,
                            "tags": article.tags or [],
                            "topics": article.topics or [],
                        },
                    )
                )
            imported += 1
        self.db.commit()
        return {"imported": imported, "skipped": skipped}

    def process_articles(
        self,
        *,
        limit: int = 5,
        article_ids: Optional[Sequence[int]] = None,
        force: bool = False,
        import_first: bool = True,
    ) -> Dict[str, Any]:
        safe_limit = max(1, min(int(limit or 5), 50))
        imported = {"imported": 0, "skipped": 0}
        if import_first:
            imported = self.import_articles(limit=max(safe_limit * 3, safe_limit))

        documents = self._select_documents_for_processing(
            limit=safe_limit,
            article_ids=article_ids,
            force=force,
        )
        result = {
            "imported": int(imported.get("imported", 0)),
            "import_skipped": int(imported.get("skipped", 0)),
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "entities_upserted": 0,
            "relations_upserted": 0,
            "evidence_upserted": 0,
            "processed_documents": [],
            "errors": [],
        }
        if not documents:
            return result

        for document in documents:
            state = self._get_or_create_document_state(document)
            if not force and state.status == "completed" and state.content_hash == document.content_hash:
                result["skipped"] += 1
                continue

            state.status = "processing"
            state.content_hash = document.content_hash
            state.last_error = None
            state.updated_at = datetime.now()
            self.db.commit()

            try:
                before_entities = int(self.db.query(func.count(IndustryGraphEntity.id)).scalar() or 0)
                before_relations = int(self.db.query(func.count(IndustryGraphRelation.id)).scalar() or 0)
                before_evidence = int(self.db.query(func.count(IndustryGraphRelationEvidence.id)).scalar() or 0)
                payload = self._extract_technology_facts(document)
                applied = self._apply_extraction_payload(document, payload)

                state.status = "completed"
                state.last_extracted_at = datetime.now()
                state.last_error = None
                state.updated_at = datetime.now()
                self.db.commit()

                after_entities = int(self.db.query(func.count(IndustryGraphEntity.id)).scalar() or 0)
                after_relations = int(self.db.query(func.count(IndustryGraphRelation.id)).scalar() or 0)
                after_evidence = int(self.db.query(func.count(IndustryGraphRelationEvidence.id)).scalar() or 0)
                entities_delta = max(0, after_entities - before_entities)
                relations_delta = max(0, after_relations - before_relations)
                evidence_delta = max(0, after_evidence - before_evidence)
                result["processed"] += 1
                result["entities_upserted"] += entities_delta
                result["relations_upserted"] += relations_delta
                result["evidence_upserted"] += evidence_delta
                result["processed_documents"].append(
                    {
                        "document_id": document.id,
                        "article_id": document.source_ref_id,
                        "title": document.title,
                        "title_zh": document.title_zh,
                        "entities": applied["entities"],
                        "relations": applied["relations"],
                    }
                )
            except Exception as exc:
                self.db.rollback()
                state = self._get_or_create_document_state(document)
                state.status = "failed"
                state.last_error = str(exc)[:2000]
                state.updated_at = datetime.now()
                self.db.commit()
                result["failed"] += 1
                result["errors"].append(
                    {
                        "document_id": document.id,
                        "article_id": document.source_ref_id,
                        "title": document.title,
                        "error": str(exc),
                    }
                )
        return result

    def clear_graph_facts(self) -> Dict[str, int]:
        """清空行业图谱事实和抽取状态，保留已导入的文档和聊天会话。"""
        deleted_counts = {
            "trend_metrics": self.db.query(TechnologyTrendMetric).delete(synchronize_session=False),
            "evidence": self.db.query(IndustryGraphRelationEvidence).delete(synchronize_session=False),
            "relations": self.db.query(IndustryGraphRelation).delete(synchronize_session=False),
            "entity_names": self.db.query(IndustryGraphEntityName).delete(synchronize_session=False),
            "entity_identities": self.db.query(IndustryGraphEntityIdentity).delete(synchronize_session=False),
            "entities": self.db.query(IndustryGraphEntity).delete(synchronize_session=False),
            "scenario_states": self.db.query(IndustryDocumentScenarioState).delete(synchronize_session=False),
            "suggested_questions": self.db.query(IndustryGraphSuggestedQuestion).delete(synchronize_session=False),
            "builds": self.db.query(IndustryGraphBuild).delete(synchronize_session=False),
        }
        self.db.commit()
        return {key: int(value or 0) for key, value in deleted_counts.items()}

    def rebuild_all_articles(
        self,
        *,
        batch_size: int = 50,
        max_documents: Optional[int] = None,
        clear_existing_graph: bool = False,
    ) -> Dict[str, Any]:
        safe_batch_size = max(1, min(int(batch_size or 50), 50))
        safe_max_documents = None if max_documents is None else max(1, int(max_documents))
        cleared = self.clear_graph_facts() if clear_existing_graph else {}
        imported = self.import_articles(limit=None)

        totals = {
            "imported": int(imported.get("imported", 0)),
            "import_skipped": int(imported.get("skipped", 0)),
            "processed": 0,
            "skipped": 0,
            "failed": 0,
            "entities_upserted": 0,
            "relations_upserted": 0,
            "evidence_upserted": 0,
            "batches": 0,
            "cleared": cleared,
            "errors": [],
        }

        while True:
            if safe_max_documents is not None:
                remaining = safe_max_documents - totals["processed"] - totals["failed"]
                if remaining <= 0:
                    break
                current_limit = min(safe_batch_size, remaining)
            else:
                current_limit = safe_batch_size

            result = self.process_articles(
                limit=current_limit,
                import_first=False,
                force=False,
            )
            if result["processed"] == 0 and result["failed"] == 0:
                totals["skipped"] += int(result.get("skipped", 0))
                break

            totals["batches"] += 1
            for key in [
                "processed",
                "skipped",
                "failed",
                "entities_upserted",
                "relations_upserted",
                "evidence_upserted",
            ]:
                totals[key] += int(result.get(key, 0))
            totals["errors"].extend(result.get("errors", []))

        totals["stats"] = self.get_stats()
        return totals

    def upsert_entity(
        self,
        *,
        entity_type: str,
        canonical_name: str,
        aliases: Optional[Sequence[str]] = None,
        description: Optional[str] = None,
        properties: Optional[Dict[str, Any]] = None,
        graph_version: int = DEFAULT_GRAPH_VERSION,
    ) -> IndustryGraphEntity:
        safe_type = self._normalize_entity_type(entity_type)
        safe_name = canonical_name.strip()
        if not safe_name:
            raise ValueError("canonical_name is required")
        normalized_name = self._normalize_text(safe_name)
        row = self._find_entity_by_name(safe_type, normalized_name, aliases or [])
        if row:
            row.canonical_name = row.canonical_name or safe_name
            row.description = description or row.description
            row.properties_json = {**(row.properties_json or {}), **(properties or {})}
            row.graph_version = graph_version
            row.updated_at = datetime.now()
        else:
            row = IndustryGraphEntity(
                entity_key=self._make_entity_key(safe_type, safe_name),
                entity_type=safe_type,
                canonical_name=safe_name,
                normalized_name=normalized_name,
                description=description,
                properties_json=properties or {},
                graph_version=graph_version,
            )
            self.db.add(row)
            try:
                self.db.flush()
            except IntegrityError:
                self.db.rollback()
                row = (
                    self.db.query(IndustryGraphEntity)
                    .filter(IndustryGraphEntity.entity_key == self._make_entity_key(safe_type, safe_name))
                    .first()
                )
                if not row:
                    raise
        self._ensure_entity_name(row, safe_name, "canonical")
        for alias in aliases or []:
            if alias and self._normalize_text(alias) != normalized_name:
                self._ensure_entity_name(row, alias, "alias")
        self.db.flush()
        return row

    def upsert_relation(
        self,
        *,
        source_entity: IndustryGraphEntity,
        target_entity: IndustryGraphEntity,
        relation_type: str,
        document: Optional[IndustryDocument] = None,
        evidence_snippet: Optional[str] = None,
        confidence: str = "EXTRACTED",
        confidence_score: float = 1.0,
        properties: Optional[Dict[str, Any]] = None,
        scenario_key: str = TECHNOLOGY_SCENARIO,
        graph_version: int = DEFAULT_GRAPH_VERSION,
    ) -> IndustryGraphRelation:
        safe_relation_type = self._normalize_relation_type(relation_type)
        if source_entity.id == target_entity.id:
            raise ValueError("source and target must differ")
        relation = (
            self.db.query(IndustryGraphRelation)
            .filter(IndustryGraphRelation.source_entity_id == source_entity.id)
            .filter(IndustryGraphRelation.target_entity_id == target_entity.id)
            .filter(IndustryGraphRelation.relation_type == safe_relation_type)
            .first()
        )
        now = datetime.now()
        if not relation:
            relation = IndustryGraphRelation(
                source_entity_id=source_entity.id,
                target_entity_id=target_entity.id,
                relation_type=safe_relation_type,
                confidence=confidence,
                confidence_score=self._clamp_score(confidence_score),
                weight=1.0,
                evidence_count=0,
                first_seen_at=document.published_at if document else now,
                last_seen_at=document.published_at if document else now,
                properties_json=properties or {},
                graph_version=graph_version,
            )
            self.db.add(relation)
            self.db.flush()
        else:
            relation.confidence_score = max(float(relation.confidence_score or 0), self._clamp_score(confidence_score))
            relation.confidence = confidence if confidence == "EXTRACTED" else relation.confidence
            relation.weight = float(relation.weight or 1.0) + 1.0
            relation.properties_json = {**(relation.properties_json or {}), **(properties or {})}
            relation.graph_version = graph_version
            if document and document.published_at:
                relation.first_seen_at = min(filter(None, [relation.first_seen_at, document.published_at]))
                relation.last_seen_at = max(filter(None, [relation.last_seen_at, document.published_at]))
            relation.updated_at = now
        if document:
            self._add_evidence(
                relation=relation,
                document=document,
                evidence_snippet=evidence_snippet,
                confidence=confidence,
                confidence_score=confidence_score,
                scenario_key=scenario_key,
            )
            self.db.flush()
        self._refresh_entity_counters([source_entity.id, target_entity.id])
        self.db.flush()
        return relation

    def get_suggested_questions(self, *, limit: int = 6) -> List[Dict[str, Any]]:
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        questions = (
            self.db.query(IndustryGraphSuggestedQuestion)
            .filter(IndustryGraphSuggestedQuestion.generated_for_date >= today_start)
            .order_by(IndustryGraphSuggestedQuestion.priority.asc(), IndustryGraphSuggestedQuestion.id.asc())
            .limit(max(1, min(limit, 20)))
            .all()
        )
        if not questions:
            self.generate_suggested_questions()
            questions = (
                self.db.query(IndustryGraphSuggestedQuestion)
                .filter(IndustryGraphSuggestedQuestion.generated_for_date >= today_start)
                .order_by(IndustryGraphSuggestedQuestion.priority.asc(), IndustryGraphSuggestedQuestion.id.asc())
                .limit(max(1, min(limit, 20)))
                .all()
            )
        return [self._serialize_suggested_question(row) for row in questions]

    def generate_suggested_questions(self, *, limit: int = 6) -> List[Dict[str, Any]]:
        today_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        existing_count = (
            self.db.query(func.count(IndustryGraphSuggestedQuestion.id))
            .filter(IndustryGraphSuggestedQuestion.generated_for_date >= today_start)
            .scalar()
            or 0
        )
        if existing_count:
            return self.get_suggested_questions(limit=limit)
        trends = self.get_technology_trends(limit=4)
        base_questions = [
            "最近 3 个月技术方面有什么新的变化趋势？",
            "最近 3 个月哪些 AI 技术方向升温最快？",
            "哪些技术正在从论文进入产品应用？",
            "哪些技术方向正在发生融合？",
        ]
        trend_questions = [
            f"{trend['technology']} 最近有哪些代表论文、产品和公司？"
            for trend in trends[:2]
        ]
        questions = self._generate_questions_with_llm(trends, limit=limit) or [*trend_questions, *base_questions]
        created: List[IndustryGraphSuggestedQuestion] = []
        for index, question in enumerate(questions[:limit]):
            row = IndustryGraphSuggestedQuestion(
                question=question,
                scenario_key=TECHNOLOGY_SCENARIO,
                reason="基于近期技术趋势指标和文章热点生成",
                source_period_start=datetime.now() - timedelta(days=90),
                source_period_end=datetime.now(),
                hot_entities_json=[],
                priority=index + 1,
                generated_for_date=today_start,
            )
            self.db.add(row)
            created.append(row)
        self.db.commit()
        return [self._serialize_suggested_question(row) for row in created]

    def _generate_questions_with_llm(self, trends: Sequence[Dict[str, Any]], *, limit: int) -> List[str]:
        if not self.ai_analyzer:
            return []
        trend_summary = [
            {
                "technology": item.get("technology"),
                "trend_score": item.get("trend_score"),
                "evidence_count": item.get("evidence_count"),
                "summary": item.get("summary"),
            }
            for item in trends[:8]
        ]
        prompt = (
            "你是行业技术趋势分析助手。请基于最近 3 个月的技术趋势信号，"
            f"生成 {limit} 个适合用户点击追问的中文分析问题。"
            "问题要聚焦技术演进、技术融合、论文到产品路径、证据强度。"
            "只返回 JSON 数组字符串，不要解释。\n\n"
            f"趋势信号：{json.dumps(trend_summary, ensure_ascii=False)}"
        )
        try:
            response = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {"role": "system", "content": "你只输出 JSON 数组。"},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.4,
                max_tokens=600,
            )
            content = response.choices[0].message.content or "[]"
            questions = self._parse_llm_question_list(content)
            return questions[: max(1, min(limit, 20))]
        except Exception:
            return []

    def _parse_llm_question_list(self, content: str) -> List[str]:
        raw = (content or "").strip()
        if not raw:
            return []
        match = re.search(r"\[[\s\S]*\]", raw)
        if match:
            raw = match.group(0)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        if not isinstance(parsed, list):
            return []
        questions = []
        for item in parsed:
            if isinstance(item, str):
                question = item.strip()
            elif isinstance(item, dict):
                question = str(item.get("question") or "").strip()
            else:
                question = ""
            if question and question not in questions:
                questions.append(question[:1000])
        return questions

    def _select_documents_for_processing(
        self,
        *,
        limit: int,
        article_ids: Optional[Sequence[int]],
        force: bool,
    ) -> List[IndustryDocument]:
        query = self.db.query(IndustryDocument).order_by(
            IndustryDocument.published_at.is_(None).asc(),
            IndustryDocument.published_at.desc(),
            IndustryDocument.id.desc(),
        )
        if article_ids:
            query = query.filter(IndustryDocument.source_type == "news")
            query = query.filter(IndustryDocument.source_ref_id.in_(list(article_ids)))
        candidates = query.limit(max(limit * 10, limit)).all()
        if force:
            return candidates[:limit]

        selected: List[IndustryDocument] = []
        for document in candidates:
            state = (
                self.db.query(IndustryDocumentScenarioState)
                .filter(IndustryDocumentScenarioState.document_id == document.id)
                .filter(IndustryDocumentScenarioState.scenario_key == TECHNOLOGY_SCENARIO)
                .filter(IndustryDocumentScenarioState.extractor_version == "v1")
                .first()
            )
            if state and state.status == "completed" and state.content_hash == document.content_hash:
                continue
            selected.append(document)
            if len(selected) >= limit:
                break
        return selected

    def _get_or_create_document_state(self, document: IndustryDocument) -> IndustryDocumentScenarioState:
        state = (
            self.db.query(IndustryDocumentScenarioState)
            .filter(IndustryDocumentScenarioState.document_id == document.id)
            .filter(IndustryDocumentScenarioState.scenario_key == TECHNOLOGY_SCENARIO)
            .filter(IndustryDocumentScenarioState.extractor_version == "v1")
            .first()
        )
        if state:
            return state
        state = IndustryDocumentScenarioState(
            document_id=document.id,
            scenario_key=TECHNOLOGY_SCENARIO,
            extractor_version="v1",
            content_hash=document.content_hash,
            status="pending",
        )
        self.db.add(state)
        self.db.flush()
        return state

    def _extract_technology_facts(self, document: IndustryDocument) -> Dict[str, Any]:
        if self.ai_analyzer:
            payload = self._extract_technology_facts_with_llm(document)
            if payload.get("entities") or payload.get("relations"):
                return payload
        return self._fallback_extract_technology_facts(document)

    def _extract_technology_facts_with_llm(self, document: IndustryDocument) -> Dict[str, Any]:
        prompt = self._build_extraction_prompt(document)
        try:
            response = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {
                        "role": "system",
                        "content": "你是技术演进行业图谱抽取器，只输出 JSON 对象。",
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                max_tokens=1600,
            )
            content = response.choices[0].message.content or "{}"
            return self._parse_extraction_payload(content)
        except Exception:
            return {"entities": [], "relations": []}

    def _build_extraction_prompt(self, document: IndustryDocument) -> str:
        text = "\n\n".join(
            part for part in [
                f"标题：{document.title}",
                f"中文标题：{document.title_zh or ''}",
                f"来源：{document.source or ''}",
                f"发布时间：{document.published_at.isoformat() if document.published_at else ''}",
                document.content_text or "",
            ] if part
        )
        return (
            "请从文章中抽取技术演进场景需要的实体和关系。\n"
            "实体类型只能使用：Paper, Technology, Concept, Product, Company, Person, Benchmark, Feature, Industry, Event。\n"
            "关系类型只能使用：PROPOSES, BUILDS_ON, USES, DEVELOPED, PUBLISHED, EVALUATES_ON, IMPROVES, "
            "HAS_FEATURE, SOLVES, BELONGS_TO, CONVERGES_WITH。\n"
            "只抽取文章中有明确证据的事实，不要编造。\n"
            "输出 JSON 对象，格式如下：\n"
            "{\n"
            '  "entities": [{"id": "e1", "type": "Technology", "name": "技术名", "aliases": [], "description": ""}],\n'
            '  "relations": [{"source": "e1", "target": "e2", "type": "USES", "evidence_snippet": "原文证据", "confidence_score": 0.9}]\n'
            "}\n\n"
            f"文章内容：\n{text[:12000]}"
        )

    def _parse_extraction_payload(self, content: str) -> Dict[str, Any]:
        raw = (content or "").strip()
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            raw = match.group(0)
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {"entities": [], "relations": []}
        if not isinstance(parsed, dict):
            return {"entities": [], "relations": []}
        entities = parsed.get("entities") if isinstance(parsed.get("entities"), list) else []
        relations = parsed.get("relations")
        if not isinstance(relations, list):
            relations = parsed.get("relationships") if isinstance(parsed.get("relationships"), list) else []
        return {"entities": entities[:60], "relations": relations[:120]}

    def _fallback_extract_technology_facts(self, document: IndustryDocument) -> Dict[str, Any]:
        text = "\n".join(
            str(part or "")
            for part in [document.title, document.title_zh, document.content_text]
        )
        candidates = self._extract_technology_candidates(text, document.metadata_json or {})
        title = document.title_zh or document.title
        entities: List[Dict[str, Any]] = [
            {
                "id": "paper:main",
                "type": "Paper",
                "name": title[:500],
                "aliases": [document.title] if document.title_zh and document.title != document.title_zh else [],
                "description": "由文章标题生成的文档级论文/事件节点。",
            }
        ]
        if document.source:
            entities.append(
                {
                    "id": "company:source",
                    "type": "Company",
                    "name": document.source,
                    "aliases": [],
                    "description": "文章来源或发布机构。",
                }
            )
        for index, candidate in enumerate(candidates):
            entities.append(
                {
                    "id": f"technology:{index}",
                    "type": "Technology",
                    "name": candidate,
                    "aliases": [],
                    "description": "规则抽取的候选技术方向。",
                }
            )
        relations: List[Dict[str, Any]] = []
        if document.source:
            relations.append(
                {
                    "source": "company:source",
                    "target": "paper:main",
                    "type": "PUBLISHED",
                    "evidence_snippet": title,
                    "confidence_score": 0.55,
                }
            )
        for index, candidate in enumerate(candidates):
            relations.append(
                {
                    "source": "paper:main",
                    "target": f"technology:{index}",
                    "type": "PROPOSES",
                    "evidence_snippet": self._find_snippet(text, candidate),
                    "confidence_score": 0.6,
                }
            )
        return {"entities": entities, "relations": relations}

    def _extract_technology_candidates(self, text: str, metadata: Dict[str, Any]) -> List[str]:
        candidates: List[str] = []
        for field in ["tags", "topics"]:
            values = metadata.get(field) or []
            if isinstance(values, list):
                for item in values:
                    value = str(item or "").strip()
                    if self._looks_like_technology(value):
                        candidates.append(value)

        english_phrases = re.findall(
            r"\b[A-Z][A-Za-z0-9]*(?:[- ][A-Z][A-Za-z0-9]+){1,5}\b",
            text or "",
        )
        chinese_phrases = re.findall(
            r"[\u4e00-\u9fffA-Za-z0-9-]{2,28}(?:模型|技术|架构|算法|芯片|机器人|智能体|框架|平台|规划|推理|记忆)",
            text or "",
        )
        for value in [*english_phrases, *chinese_phrases]:
            cleaned = re.sub(r"\s+", " ", value).strip(" ,.;:，。；：")
            if self._looks_like_technology(cleaned):
                candidates.append(cleaned)

        seen: Set[str] = set()
        deduped: List[str] = []
        for candidate in candidates:
            normalized = self._normalize_text(candidate)
            if normalized in seen:
                continue
            seen.add(normalized)
            deduped.append(candidate[:500])
            if len(deduped) >= 8:
                break
        if not deduped:
            title = text.splitlines()[0].strip() if text else ""
            if title:
                deduped.append(title[:120])
        return deduped

    def _looks_like_technology(self, value: str) -> bool:
        cleaned = value.strip()
        if len(cleaned) < 3:
            return False
        lowered = cleaned.lower()
        blocked = {"new", "the", "and", "for", "with", "example research", "example robotics"}
        if lowered in blocked:
            return False
        tech_terms = [
            "ai",
            "agent",
            "transformer",
            "diffusion",
            "model",
            "memory",
            "graph",
            "robot",
            "llm",
            "rag",
            "模型",
            "技术",
            "架构",
            "算法",
            "芯片",
            "机器人",
            "智能体",
            "框架",
            "平台",
            "规划",
            "推理",
            "记忆",
        ]
        if any(term in lowered for term in tech_terms):
            return True
        return bool(re.search(r"[\u4e00-\u9fff]", cleaned)) and len(cleaned) <= 24

    def _find_snippet(self, text: str, term: str) -> str:
        if not term:
            return (text or "")[:300]
        index = (text or "").find(term)
        if index < 0:
            return (text or "")[:300]
        start = max(0, index - 120)
        end = min(len(text), index + len(term) + 180)
        return text[start:end].strip()

    def _apply_extraction_payload(self, document: IndustryDocument, payload: Dict[str, Any]) -> Dict[str, int]:
        entity_lookup: Dict[str, IndustryGraphEntity] = {}
        applied_entities = 0
        applied_relations = 0
        for raw_entity in payload.get("entities") or []:
            if not isinstance(raw_entity, dict):
                continue
            name = str(raw_entity.get("name") or raw_entity.get("canonical_name") or "").strip()
            if not name:
                continue
            entity_type = str(raw_entity.get("type") or raw_entity.get("entity_type") or "Concept")
            aliases = raw_entity.get("aliases") if isinstance(raw_entity.get("aliases"), list) else []
            properties = raw_entity.get("properties") if isinstance(raw_entity.get("properties"), dict) else {}
            entity = self.upsert_entity(
                entity_type=entity_type,
                canonical_name=name,
                aliases=[str(alias) for alias in aliases if str(alias).strip()],
                description=raw_entity.get("description"),
                properties=properties,
            )
            applied_entities += 1
            keys = {
                str(raw_entity.get("id") or "").strip(),
                name,
                self._normalize_text(name),
            }
            for key in keys:
                if key:
                    entity_lookup[key] = entity

        for raw_relation in payload.get("relations") or []:
            if not isinstance(raw_relation, dict):
                continue
            source = self._resolve_extracted_entity(raw_relation.get("source"), entity_lookup)
            target = self._resolve_extracted_entity(raw_relation.get("target"), entity_lookup)
            if not source or not target:
                continue
            relation_type = str(raw_relation.get("type") or raw_relation.get("relation_type") or "").upper()
            if relation_type not in TECHNOLOGY_RELATION_TYPES:
                continue
            self.upsert_relation(
                source_entity=source,
                target_entity=target,
                relation_type=relation_type,
                document=document,
                evidence_snippet=raw_relation.get("evidence_snippet") or raw_relation.get("evidence"),
                confidence=str(raw_relation.get("confidence") or "EXTRACTED"),
                confidence_score=self._clamp_score(float(raw_relation.get("confidence_score") or 0.75)),
            )
            applied_relations += 1
        self.db.flush()
        return {"entities": applied_entities, "relations": applied_relations}

    def _resolve_extracted_entity(
        self,
        value: Any,
        entity_lookup: Dict[str, IndustryGraphEntity],
    ) -> Optional[IndustryGraphEntity]:
        raw = str(value or "").strip()
        if not raw:
            return None
        return entity_lookup.get(raw) or entity_lookup.get(self._normalize_text(raw))

    def create_conversation(
        self,
        *,
        title: Optional[str] = None,
        primary_scenario: str = TECHNOLOGY_SCENARIO,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        row = IndustryGraphConversation(
            title=(title or "行业趋势分析")[:500],
            primary_scenario=primary_scenario,
            user_id=user_id,
        )
        self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return self._serialize_conversation(row, include_messages=True)

    def get_conversation(self, conversation_id: int, *, user_id: Optional[str] = None) -> Dict[str, Any]:
        row = self.db.query(IndustryGraphConversation).filter(IndustryGraphConversation.id == conversation_id).first()
        if not row or (user_id is not None and row.user_id != user_id):
            raise ValueError("Conversation not found")
        return self._serialize_conversation(row, include_messages=True)

    def list_conversations(self, *, limit: int = 20, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query = self.db.query(IndustryGraphConversation)
        if user_id is not None:
            query = query.filter(IndustryGraphConversation.user_id == user_id)
        rows = query.order_by(
            IndustryGraphConversation.updated_at.desc(),
            IndustryGraphConversation.id.desc(),
        ).limit(max(1, min(limit, 100))).all()
        return [self._serialize_conversation(row, include_messages=False) for row in rows]

    def answer_question(
        self,
        question: str,
        *,
        conversation_id: Optional[int] = None,
        scenario: str = "auto",
        time_range: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        conversation = self._get_or_create_conversation(conversation_id, question, user_id=user_id)
        plan = self._build_query_plan(question, scenario=scenario, time_range=time_range)
        self._append_message(conversation.id, "user", question, [], None)

        trends, evidence, subgraph = self._prepare_answer_materials(question, plan, top_k)
        followups = self._build_followup_questions(trends)
        answer_text = self._synthesize_answer(question, plan, trends, evidence, subgraph)
        content_blocks = self._build_content_blocks(answer_text, trends, evidence, subgraph, followups)
        answer_text = self._content_blocks_to_text(content_blocks)
        self._append_message(conversation.id, "assistant", answer_text, content_blocks, plan)
        conversation.updated_at = datetime.now()
        self.db.commit()
        return {
            "question": question,
            "conversation_id": conversation.id,
            "query_plan": plan,
            "content_blocks": content_blocks,
            "trends": trends,
            "evidence": evidence,
            "subgraph": subgraph,
            "followup_questions": followups,
        }

    def stream_answer(
        self,
        question: str,
        *,
        conversation_id: Optional[int] = None,
        scenario: str = "auto",
        time_range: Optional[Dict[str, Any]] = None,
        top_k: int = 10,
        user_id: Optional[str] = None,
    ) -> Generator[Dict[str, Any], None, None]:
        conversation = self._get_or_create_conversation(conversation_id, question, user_id=user_id)
        plan = self._build_query_plan(question, scenario=scenario, time_range=time_range)
        self._append_message(conversation.id, "user", question, [], None)

        trends, evidence, subgraph = self._prepare_answer_materials(question, plan, top_k)
        followups = self._build_followup_questions(trends)
        reference_blocks = self._build_reference_blocks(trends, evidence, subgraph)

        yield {"type": "query_plan", "data": plan}
        for block in reference_blocks:
            block_type = block.get("type")
            data = block.get("data") or {}
            yield {"type": block_type, "data": data}

        answer_parts: List[str] = []
        for delta in self._stream_synthesized_answer(question, plan, trends, evidence, subgraph):
            if not delta:
                continue
            answer_parts.append(delta)
            yield {"type": "text_delta", "data": {"content": delta}}

        answer_text = "".join(answer_parts).strip()
        if not answer_text:
            answer_text = self._fallback_synthesize_answer(question, trends, evidence, subgraph)
            for delta in self._chunk_text(answer_text):
                yield {"type": "text_delta", "data": {"content": delta}}

        content_blocks = [{"type": "text", "data": {"text": answer_text}}, *reference_blocks]
        self._append_message(conversation.id, "assistant", answer_text, content_blocks, plan)
        conversation.updated_at = datetime.now()
        self.db.commit()

        yield {
            "type": "done",
            "data": {
                "conversation_id": conversation.id,
                "followup_questions": followups,
            },
        }

    def _prepare_answer_materials(
        self,
        question: str,
        plan: Dict[str, Any],
        top_k: int,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], Dict[str, Any]]:
        trends = self.get_technology_trends(limit=top_k, time_range=plan["time_range"])
        trends = self._prioritize_trends_for_question(question, trends)
        evidence = self._collect_evidence_for_trends(trends, limit=max(3, top_k))
        subgraph = self._build_subgraph_for_trends(trends, limit_nodes=120, limit_edges=300)
        return trends, evidence, subgraph

    def get_technology_trends(
        self,
        *,
        limit: int = 10,
        time_range: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        start, end = self._resolve_time_range(time_range)
        metric_rows = (
            self.db.query(TechnologyTrendMetric, IndustryGraphEntity)
            .join(IndustryGraphEntity, TechnologyTrendMetric.technology_id == IndustryGraphEntity.id)
            .filter(TechnologyTrendMetric.period_start >= start)
            .filter(TechnologyTrendMetric.period_end <= end)
            .order_by(TechnologyTrendMetric.trend_score.desc(), TechnologyTrendMetric.evidence_count.desc())
            .limit(max(1, min(limit, 50)))
            .all()
        )
        if metric_rows:
            return [self._serialize_trend(metric, entity) for metric, entity in metric_rows]
        return self._derive_trends_from_relations(start=start, end=end, limit=limit)

    def _derive_trends_from_relations(self, *, start: datetime, end: datetime, limit: int) -> List[Dict[str, Any]]:
        relation_rows = (
            self.db.query(IndustryGraphRelation, IndustryGraphEntity)
            .join(
                IndustryGraphEntity,
                or_(
                    IndustryGraphRelation.source_entity_id == IndustryGraphEntity.id,
                    IndustryGraphRelation.target_entity_id == IndustryGraphEntity.id,
                ),
            )
            .filter(IndustryGraphEntity.entity_type == "Technology")
            .filter(or_(IndustryGraphRelation.last_seen_at.is_(None), IndustryGraphRelation.last_seen_at <= end))
            .all()
        )
        scores: Dict[int, Dict[str, Any]] = {}
        for relation, entity in relation_rows:
            item = scores.setdefault(
                entity.id,
                {
                    "technology_id": entity.id,
                    "technology": entity.canonical_name,
                    "trend_score": 0.0,
                    "growth_rate": 0.0,
                    "document_count": 0,
                    "paper_count": 0,
                    "product_count": 0,
                    "company_count": 0,
                    "benchmark_count": 0,
                    "evidence_count": 0,
                    "summary": f"{entity.canonical_name} 在近期技术图谱中出现了新的关联信号。",
                },
            )
            evidence_count = int(relation.evidence_count or 0)
            item["evidence_count"] += evidence_count
            item["document_count"] += evidence_count
            item["trend_score"] += 1.0 + evidence_count * 0.5 + float(relation.confidence_score or 0)
        values = list(scores.values())
        values.sort(key=lambda item: (-item["trend_score"], -item["evidence_count"], item["technology"]))
        return values[: max(1, min(limit, 50))]

    def _prioritize_trends_for_question(
        self,
        question: str,
        trends: Sequence[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        normalized_question = self._normalize_text(question)
        if not normalized_question:
            return list(trends)

        def rank(item: Dict[str, Any]) -> Tuple[int, float, int, str]:
            technology = str(item.get("technology") or "")
            normalized_technology = self._normalize_text(technology)
            direct_match = 1 if normalized_technology and normalized_technology in normalized_question else 0
            return (
                -direct_match,
                -float(item.get("trend_score") or 0.0),
                -int(item.get("evidence_count") or 0),
                technology,
            )

        return sorted(list(trends), key=rank)

    def _build_query_plan(self, question: str, *, scenario: str, time_range: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        normalized = self._normalize_text(question)
        analysis_tasks = ["trend_detection"]
        if any(term in normalized for term in ["融合", "交叉", "结合"]):
            analysis_tasks.append("convergence_detection")
        if any(term in normalized for term in ["路径", "扩散", "论文", "产品"]):
            analysis_tasks.append("technology_path")
        return {
            "primary_scenario": TECHNOLOGY_SCENARIO if scenario in {"auto", TECHNOLOGY_SCENARIO, None} else scenario,
            "secondary_scenarios": [],
            "time_range": time_range or {"preset": "last_3_months"},
            "analysis_tasks": analysis_tasks,
            "entities": [],
            "output": ["summary", "ranked_trends", "local_graph", "evidence"],
        }

    def _collect_evidence_for_trends(self, trends: Sequence[Dict[str, Any]], *, limit: int) -> List[Dict[str, Any]]:
        technology_ids = [int(item["technology_id"]) for item in trends]
        if not technology_ids:
            return []
        rows = (
            self.db.query(IndustryGraphRelationEvidence, IndustryGraphRelation, IndustryDocument)
            .join(IndustryGraphRelation, IndustryGraphRelationEvidence.relation_id == IndustryGraphRelation.id)
            .join(IndustryDocument, IndustryGraphRelationEvidence.document_id == IndustryDocument.id)
            .filter(
                or_(
                    IndustryGraphRelation.source_entity_id.in_(technology_ids),
                    IndustryGraphRelation.target_entity_id.in_(technology_ids),
                )
            )
            .order_by(IndustryGraphRelationEvidence.confidence_score.desc(), IndustryGraphRelationEvidence.id.asc())
            .limit(max(1, min(limit * 10, 200)))
            .all()
        )
        technology_priority = {technology_id: index for index, technology_id in enumerate(technology_ids)}
        rows = sorted(
            rows,
            key=lambda row: (
                min(
                    technology_priority.get(int(row[1].source_entity_id), 9999),
                    technology_priority.get(int(row[1].target_entity_id), 9999),
                ),
                -float(row[0].confidence_score or 0),
                int(row[0].id),
            ),
        )
        evidence = []
        seen_documents: Set[int] = set()
        for evidence_row, relation, document in rows:
            if document.id in seen_documents and len(evidence) >= limit:
                continue
            seen_documents.add(document.id)
            source_label = relation.source_entity.canonical_name if relation.source_entity else None
            target_label = relation.target_entity.canonical_name if relation.target_entity else None
            evidence.append(
                {
                    "id": evidence_row.id,
                    "relation_id": relation.id,
                    "relation_type": relation.relation_type,
                    "source_entity": source_label,
                    "target_entity": target_label,
                    "document_id": document.id,
                    "title": document.title,
                    "title_zh": document.title_zh,
                    "url": document.url,
                    "source": document.source,
                    "published_at": document.published_at,
                    "evidence_snippet": evidence_row.evidence_snippet,
                    "confidence": evidence_row.confidence,
                    "confidence_score": float(evidence_row.confidence_score or 0),
                }
            )
            if len(evidence) >= limit:
                break
        return evidence

    def _build_subgraph_for_trends(
        self,
        trends: Sequence[Dict[str, Any]],
        *,
        limit_nodes: int,
        limit_edges: int,
    ) -> Dict[str, Any]:
        seed_ids = [int(item["technology_id"]) for item in trends]
        if not seed_ids:
            return {"nodes": [], "edges": []}
        relation_rows = (
            self.db.query(IndustryGraphRelation)
            .filter(
                or_(
                    IndustryGraphRelation.source_entity_id.in_(seed_ids),
                    IndustryGraphRelation.target_entity_id.in_(seed_ids),
                )
            )
            .order_by(IndustryGraphRelation.evidence_count.desc(), IndustryGraphRelation.confidence_score.desc())
            .limit(max(1, min(limit_edges, 1500)))
            .all()
        )
        node_ids: Set[int] = set(seed_ids)
        for relation in relation_rows:
            node_ids.add(int(relation.source_entity_id))
            node_ids.add(int(relation.target_entity_id))
            if len(node_ids) >= limit_nodes:
                break
        nodes = (
            self.db.query(IndustryGraphEntity)
            .filter(IndustryGraphEntity.id.in_(list(node_ids)))
            .limit(max(1, min(limit_nodes, 500)))
            .all()
        )
        node_id_set = {node.id for node in nodes}
        return {
            "nodes": [self._serialize_node(node) for node in nodes],
            "edges": [
                self._serialize_edge(relation)
                for relation in relation_rows
                if relation.source_entity_id in node_id_set and relation.target_entity_id in node_id_set
            ],
        }

    def _synthesize_answer(
        self,
        question: str,
        plan: Dict[str, Any],
        trends: Sequence[Dict[str, Any]],
        evidence: Sequence[Dict[str, Any]],
        subgraph: Dict[str, Any],
    ) -> str:
        if not trends:
            return f"当前图谱还没有足够证据回答“{question}”。可以先导入文章并运行技术演进抽取。"

        if self.ai_analyzer:
            answer = self._synthesize_answer_with_llm(question, plan, trends, evidence, subgraph)
            if answer:
                return answer

        return self._fallback_synthesize_answer(question, trends, evidence, subgraph)

    def _synthesize_answer_with_llm(
        self,
        question: str,
        plan: Dict[str, Any],
        trends: Sequence[Dict[str, Any]],
        evidence: Sequence[Dict[str, Any]],
        subgraph: Dict[str, Any],
    ) -> str:
        prompt = self._build_answer_prompt(question, plan, trends, evidence, subgraph)
        try:
            response = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是行业技术趋势分析师。你要基于给定证据做综合判断，"
                            "不要只罗列资料，不要编造未给出的事实。"
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.25,
                max_tokens=1400,
            )
            content = (response.choices[0].message.content or "").strip()
            return self._clean_synthesized_answer(content)
        except Exception as exc:
            logger.warning("Industry graph LLM synthesis failed, falling back to deterministic answer: %s", exc)
            return ""

    def _stream_synthesized_answer(
        self,
        question: str,
        plan: Dict[str, Any],
        trends: Sequence[Dict[str, Any]],
        evidence: Sequence[Dict[str, Any]],
        subgraph: Dict[str, Any],
    ) -> Generator[str, None, None]:
        if not trends:
            yield from self._chunk_text(f"当前图谱还没有足够证据回答“{question}”。可以先导入文章并运行技术演进抽取。")
            return

        if not self.ai_analyzer:
            yield from self._chunk_text(self._fallback_synthesize_answer(question, trends, evidence, subgraph))
            return

        prompt = self._build_answer_prompt(question, plan, trends, evidence, subgraph)
        try:
            stream = self.ai_analyzer.client.chat.completions.create(
                model=self.ai_analyzer.model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "你是行业技术趋势分析师。你要基于给定证据做综合判断，"
                            "不要只罗列资料，不要编造未给出的事实。"
                        ),
                    },
                    {"role": "user", "content": prompt},
                ],
                temperature=0.25,
                max_tokens=1400,
                stream=True,
            )
            for chunk in stream:
                content = self._extract_stream_delta(chunk)
                if content:
                    yield content
        except Exception as exc:
            logger.warning("Industry graph streaming synthesis failed, falling back to deterministic answer: %s", exc)
            yield from self._chunk_text(self._fallback_synthesize_answer(question, trends, evidence, subgraph))

    def _extract_stream_delta(self, chunk: Any) -> str:
        choices = getattr(chunk, "choices", None)
        if choices is None and isinstance(chunk, dict):
            choices = chunk.get("choices")
        if not choices:
            return ""
        choice = choices[0]
        delta = getattr(choice, "delta", None)
        if delta is None and isinstance(choice, dict):
            delta = choice.get("delta")
        if delta is not None:
            content = getattr(delta, "content", None)
            if content is None and isinstance(delta, dict):
                content = delta.get("content")
            return str(content or "")
        message = getattr(choice, "message", None)
        if message is None and isinstance(choice, dict):
            message = choice.get("message")
        if message is not None:
            content = getattr(message, "content", None)
            if content is None and isinstance(message, dict):
                content = message.get("content")
            return str(content or "")
        return ""

    def _chunk_text(self, text: str, *, chunk_size: int = 80) -> Generator[str, None, None]:
        safe_text = text or ""
        for index in range(0, len(safe_text), chunk_size):
            yield safe_text[index:index + chunk_size]

    def _build_answer_prompt(
        self,
        question: str,
        plan: Dict[str, Any],
        trends: Sequence[Dict[str, Any]],
        evidence: Sequence[Dict[str, Any]],
        subgraph: Dict[str, Any],
    ) -> str:
        trend_inputs = [
            {
                "technology": item.get("technology"),
                "trend_score": item.get("trend_score"),
                "document_count": item.get("document_count"),
                "paper_count": item.get("paper_count"),
                "product_count": item.get("product_count"),
                "company_count": item.get("company_count"),
                "evidence_count": item.get("evidence_count"),
                "summary": item.get("summary"),
            }
            for item in trends[:8]
        ]
        evidence_inputs = [
            {
                "index": index + 1,
                "title": item.get("title_zh") or item.get("title"),
                "source": item.get("source"),
                "published_at": item.get("published_at"),
                "relation": {
                    "source": item.get("source_entity"),
                    "type": item.get("relation_type"),
                    "target": item.get("target_entity"),
                },
                "snippet": item.get("evidence_snippet"),
                "confidence_score": item.get("confidence_score"),
            }
            for index, item in enumerate(evidence[:10])
        ]
        graph_inputs = {
            "node_count": len(subgraph.get("nodes") or []),
            "edge_count": len(subgraph.get("edges") or []),
            "relation_types": Counter(edge.get("relation_type") for edge in subgraph.get("edges") or []).most_common(8),
        }
        payload = {
            "question": question,
            "query_plan": plan,
            "trends": trend_inputs,
            "evidence": jsonable_encoder(evidence_inputs),
            "graph": graph_inputs,
        }
        return (
            "请基于下面的结构化输入，直接回答用户问题。\n"
            "写作要求：\n"
            "1. 先给出一句总体判断。\n"
            "2. 再给出 3-5 条关键结论，每条说明原因和证据强弱。\n"
            "3. 最后给出一个“需要继续验证”的保守提示。\n"
            "4. 可以用 [证据1] 这样的标记引用证据编号，但不要输出资料清单。\n"
            "5. 如果证据不足，要明确说明不确定性。\n"
            "只输出中文回答正文，不要输出 JSON。\n\n"
            f"输入：{json.dumps(payload, ensure_ascii=False, default=str)}"
        )

    def _clean_synthesized_answer(self, content: str) -> str:
        text = (content or "").strip()
        if not text:
            return ""
        if text.startswith("{") or text.startswith("["):
            return ""
        text = re.sub(r"^```(?:markdown|text)?", "", text).strip()
        text = re.sub(r"```$", "", text).strip()
        return text[:5000]

    def _fallback_synthesize_answer(
        self,
        question: str,
        trends: Sequence[Dict[str, Any]],
        evidence: Sequence[Dict[str, Any]],
        subgraph: Dict[str, Any],
    ) -> str:
        top_trends = list(trends[:5])
        top_names = "、".join(str(item.get("technology") or "") for item in top_trends if item.get("technology"))
        evidence_count = len(evidence)
        node_count = len(subgraph.get("nodes") or [])
        edge_count = len(subgraph.get("edges") or [])

        lines = [
            f"总体判断：基于当前已解析文章和图谱信号，问题“{question}”的主要答案是：近期技术变化集中在 {top_names}，其中排名靠前的方向同时具备文档证据、实体连接和产品/公司关联。",
            "",
            "关键结论：",
        ]
        for index, trend in enumerate(top_trends, start=1):
            lines.append(
                f"{index}. {trend.get('technology')} 值得优先关注。它的趋势分为 {float(trend.get('trend_score') or 0):.2f}，"
                f"关联 {int(trend.get('document_count') or 0)} 篇文档、{int(trend.get('evidence_count') or 0)} 条证据；"
                f"如果它同时连接论文、产品或公司节点，说明它不只是概念热度，而可能已经进入落地路径。"
            )
        lines.extend(
            [
                "",
                f"证据强度：本次回答使用了 {evidence_count} 条高置信证据和一个包含 {node_count} 个节点、{edge_count} 条边的局部图谱。证据越集中在不同来源、不同实体类型之间，结论可信度越高。",
                "需要继续验证：当前结论依赖已导入并解析的文章范围。如果要做投资级或战略级判断，还需要继续补充论文、专利、投融资和政策文本，观察这些趋势是否在多类数据源中同时增强。",
            ]
        )
        return "\n".join(lines)

    def _build_content_blocks(
        self,
        answer_text: str,
        trends: Sequence[Dict[str, Any]],
        evidence: Sequence[Dict[str, Any]],
        subgraph: Dict[str, Any],
        followups: Sequence[str],
    ) -> List[Dict[str, Any]]:
        if not trends:
            return [
                {
                    "type": "text",
                    "data": {"text": answer_text},
                }
            ]
        return [
            {"type": "text", "data": {"text": answer_text}},
            *self._build_reference_blocks(trends, evidence, subgraph),
        ]

    def _build_reference_blocks(
        self,
        trends: Sequence[Dict[str, Any]],
        evidence: Sequence[Dict[str, Any]],
        subgraph: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        if not trends:
            return []
        blocks: List[Dict[str, Any]] = [
            {
                "type": "report_section",
                "data": {
                    "title": "参考趋势",
                    "summary": "以下是支撑回答的趋势信号、证据文档和局部图谱，默认作为参考资料查看。",
                },
            },
        ]
        for trend in trends[:5]:
            blocks.append({"type": "trend_card", "data": trend})
        if evidence:
            blocks.append({"type": "report_section", "data": {"title": "关键证据", "summary": "这些结论来自以下文档证据。"}})
            for item in evidence[:5]:
                blocks.append({"type": "evidence_card", "data": item})
        if subgraph.get("nodes"):
            blocks.append({"type": "local_graph", "data": subgraph})
        return blocks

    def _build_followup_questions(self, trends: Sequence[Dict[str, Any]]) -> List[str]:
        if not trends:
            return ["我应该先导入哪些技术数据源？", "如何开始构建技术演进图谱？"]
        top = trends[0]["technology"]
        return [
            f"{top} 最近有哪些代表公司和产品？",
            f"{top} 是从哪些论文或技术路线演进来的？",
            "这些趋势里哪些证据最强？",
        ]

    def _append_message(
        self,
        conversation_id: int,
        role: str,
        content_text: str,
        content_blocks: Sequence[Dict[str, Any]],
        query_plan: Optional[Dict[str, Any]],
    ) -> IndustryGraphMessage:
        row = IndustryGraphMessage(
            conversation_id=conversation_id,
            role=role,
            content_text=content_text,
            content_blocks_json=jsonable_encoder(list(content_blocks)),
            query_plan_json=jsonable_encoder(query_plan) if query_plan else None,
        )
        self.db.add(row)
        self.db.flush()
        return row

    def _get_or_create_conversation(
        self,
        conversation_id: Optional[int],
        question: str,
        *,
        user_id: Optional[str] = None,
    ) -> IndustryGraphConversation:
        if conversation_id:
            row = self.db.query(IndustryGraphConversation).filter(IndustryGraphConversation.id == conversation_id).first()
            if not row or (user_id is not None and row.user_id != user_id):
                raise ValueError("Conversation not found")
            return row
        title = question.strip()[:80] or "行业趋势分析"
        row = IndustryGraphConversation(title=title, primary_scenario=TECHNOLOGY_SCENARIO, user_id=user_id)
        self.db.add(row)
        self.db.flush()
        return row

    def _serialize_conversation(self, row: IndustryGraphConversation, *, include_messages: bool) -> Dict[str, Any]:
        messages = []
        if include_messages:
            rows = (
                self.db.query(IndustryGraphMessage)
                .filter(IndustryGraphMessage.conversation_id == row.id)
                .order_by(IndustryGraphMessage.created_at.asc(), IndustryGraphMessage.id.asc())
                .all()
            )
            messages = [self._serialize_message(message) for message in rows]
        return {
            "id": row.id,
            "title": row.title,
            "primary_scenario": row.primary_scenario,
            "created_at": row.created_at,
            "updated_at": row.updated_at,
            "messages": messages,
        }

    def _serialize_message(self, row: IndustryGraphMessage) -> Dict[str, Any]:
        return {
            "id": row.id,
            "role": row.role,
            "content_text": row.content_text,
            "content_blocks": row.content_blocks_json or [],
            "query_plan": row.query_plan_json,
            "created_at": row.created_at,
        }

    def _serialize_suggested_question(self, row: IndustryGraphSuggestedQuestion) -> Dict[str, Any]:
        return {
            "id": row.id,
            "question": row.question,
            "scenario_key": row.scenario_key,
            "reason": row.reason,
            "hot_entities": row.hot_entities_json or [],
            "priority": row.priority,
            "generated_for_date": row.generated_for_date,
        }

    def _serialize_trend(self, metric: TechnologyTrendMetric, entity: IndustryGraphEntity) -> Dict[str, Any]:
        return {
            "technology_id": entity.id,
            "technology": entity.canonical_name,
            "trend_score": round(float(metric.trend_score or 0.0), 4),
            "growth_rate": round(float(metric.growth_rate or 0.0), 4),
            "document_count": int(metric.document_count or 0),
            "paper_count": int(metric.paper_count or 0),
            "product_count": int(metric.product_count or 0),
            "company_count": int(metric.company_count or 0),
            "benchmark_count": int(metric.benchmark_count or 0),
            "evidence_count": int(metric.evidence_count or 0),
            "summary": f"{entity.canonical_name} 在当前周期趋势分为 {round(float(metric.trend_score or 0.0), 2)}。",
        }

    def _serialize_node(self, row: IndustryGraphEntity) -> Dict[str, Any]:
        return {
            "id": row.id,
            "entity_key": row.entity_key,
            "entity_type": row.entity_type,
            "label": row.canonical_name,
            "description": row.description,
            "properties": row.properties_json or {},
        }

    def _serialize_edge(self, row: IndustryGraphRelation) -> Dict[str, Any]:
        return {
            "id": row.id,
            "source_id": row.source_entity_id,
            "target_id": row.target_entity_id,
            "relation_type": row.relation_type,
            "confidence": row.confidence,
            "confidence_score": float(row.confidence_score or 0.0),
            "evidence_count": int(row.evidence_count or 0),
        }

    def _add_evidence(
        self,
        *,
        relation: IndustryGraphRelation,
        document: IndustryDocument,
        evidence_snippet: Optional[str],
        confidence: str,
        confidence_score: float,
        scenario_key: str,
    ) -> None:
        snippet_hash = hashlib.sha1(
            f"{relation.id}:{document.id}:{evidence_snippet or ''}".encode("utf-8")
        ).hexdigest()
        existing = (
            self.db.query(IndustryGraphRelationEvidence)
            .filter(IndustryGraphRelationEvidence.relation_id == relation.id)
            .filter(IndustryGraphRelationEvidence.document_id == document.id)
            .filter(IndustryGraphRelationEvidence.snippet_hash == snippet_hash)
            .first()
        )
        if existing:
            return
        self.db.add(
            IndustryGraphRelationEvidence(
                relation_id=relation.id,
                document_id=document.id,
                evidence_snippet=evidence_snippet,
                confidence=confidence,
                confidence_score=self._clamp_score(confidence_score),
                snippet_hash=snippet_hash,
                scenario_key=scenario_key,
            )
        )
        relation.evidence_count = int(relation.evidence_count or 0) + 1

    def _refresh_entity_counters(self, entity_ids: Iterable[int]) -> None:
        for entity_id in set(entity_ids):
            degree = (
                self.db.query(func.count(IndustryGraphRelation.id))
                .filter(
                    or_(
                        IndustryGraphRelation.source_entity_id == entity_id,
                        IndustryGraphRelation.target_entity_id == entity_id,
                    )
                )
                .scalar()
                or 0
            )
            evidence_docs = (
                self.db.query(func.count(func.distinct(IndustryGraphRelationEvidence.document_id)))
                .join(IndustryGraphRelation, IndustryGraphRelationEvidence.relation_id == IndustryGraphRelation.id)
                .filter(
                    or_(
                        IndustryGraphRelation.source_entity_id == entity_id,
                        IndustryGraphRelation.target_entity_id == entity_id,
                    )
                )
                .scalar()
                or 0
            )
            self.db.query(IndustryGraphEntity).filter(IndustryGraphEntity.id == entity_id).update(
                {"degree": int(degree), "article_count": int(evidence_docs), "updated_at": datetime.now()},
                synchronize_session=False,
            )

    def _find_entity_by_name(
        self,
        entity_type: str,
        normalized_name: str,
        aliases: Sequence[str],
    ) -> Optional[IndustryGraphEntity]:
        row = (
            self.db.query(IndustryGraphEntity)
            .filter(IndustryGraphEntity.entity_type == entity_type)
            .filter(IndustryGraphEntity.normalized_name == normalized_name)
            .first()
        )
        if row:
            return row
        alias_names = [self._normalize_text(alias) for alias in aliases if alias]
        if not alias_names:
            return None
        name_row = (
            self.db.query(IndustryGraphEntityName)
            .filter(IndustryGraphEntityName.entity_type == entity_type)
            .filter(IndustryGraphEntityName.normalized_name.in_(alias_names))
            .first()
        )
        if not name_row:
            return None
        return self.db.query(IndustryGraphEntity).filter(IndustryGraphEntity.id == name_row.entity_id).first()

    def _ensure_entity_name(self, entity: IndustryGraphEntity, name: str, name_kind: str) -> None:
        normalized = self._normalize_text(name)
        existing = (
            self.db.query(IndustryGraphEntityName)
            .filter(IndustryGraphEntityName.entity_id == entity.id)
            .filter(IndustryGraphEntityName.normalized_name == normalized)
            .first()
        )
        if existing:
            return
        self.db.add(
            IndustryGraphEntityName(
                entity_id=entity.id,
                entity_type=entity.entity_type,
                name=name.strip()[:500],
                normalized_name=normalized,
                name_kind=name_kind,
            )
        )

    def _content_blocks_to_text(self, blocks: Sequence[Dict[str, Any]]) -> str:
        parts = []
        for block in blocks:
            data = block.get("data") or {}
            if block.get("type") == "text":
                parts.append(str(data.get("text") or ""))
            elif block.get("type") == "report_section":
                parts.append(str(data.get("title") or ""))
                parts.append(str(data.get("summary") or ""))
        return "\n".join(part for part in parts if part)

    def _resolve_time_range(self, value: Optional[Dict[str, Any]]) -> Tuple[datetime, datetime]:
        now = datetime.now()
        if not value:
            return now - timedelta(days=90), now
        start = value.get("start")
        end = value.get("end")
        if isinstance(start, str):
            try:
                start = datetime.fromisoformat(start)
            except ValueError:
                start = None
        if isinstance(end, str):
            try:
                end = datetime.fromisoformat(end)
            except ValueError:
                end = None
        if isinstance(start, datetime) and isinstance(end, datetime):
            return start, end
        preset = value.get("preset") or "last_3_months"
        if preset == "last_30_days":
            return now - timedelta(days=30), now
        return now - timedelta(days=90), now

    def _normalize_entity_type(self, value: str) -> str:
        raw = str(value or "Concept").strip()
        return raw if raw in TECHNOLOGY_ENTITY_TYPES else "Concept"

    def _normalize_relation_type(self, value: str) -> str:
        raw = str(value or "").strip().upper()
        if raw not in TECHNOLOGY_RELATION_TYPES:
            raise ValueError(f"Unsupported relation type: {value}")
        return raw

    def _make_entity_key(self, entity_type: str, canonical_name: str) -> str:
        normalized = self._normalize_text(canonical_name)
        slug = re.sub(r"\s+", "-", normalized)
        slug = re.sub(r"[^0-9a-z\u4e00-\u9fff_-]+", "-", slug)
        slug = re.sub(r"-{2,}", "-", slug).strip("-_")
        if not slug:
            slug = hashlib.sha1(canonical_name.encode("utf-8")).hexdigest()[:16]
        return f"{entity_type.lower()}:{slug[:220]}"

    def _normalize_text(self, value: str) -> str:
        normalized = unicodedata.normalize("NFKC", value or "").lower().strip()
        return re.sub(r"\s+", " ", normalized)

    def _compute_article_hash(self, article: Article) -> str:
        payload = "\n".join(
            str(part or "")
            for part in [article.title, article.title_zh, article.summary, article.detailed_summary, article.content]
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _clamp_score(self, score: float) -> float:
        return max(0.0, min(float(score or 0.0), 1.0))
